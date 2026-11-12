import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  collectSecretValues,
  redactTelemetry,
  telemetryPacketSchema,
  MAX_ARTIFACT_BYTES,
  MAX_WIRE_MESSAGE_LENGTH,
  type DurableCommand,
  type FlowNodeEvent,
  type FlowExecutionResult,
  type TelemetryPacket,
} from "@rpa/contracts";

// One fsynced file per message. Deletion requires the server's per-message receipt.
export class TelemetryOutbox {
  private tail: Promise<unknown> = Promise.resolve();
  private secrets = new Map<string, Set<string>>();
  constructor(
    private directory: string,
    private notify: () => void = () => {},
  ) {}
  private serialized<T>(job: () => Promise<T>): Promise<T> {
    const next = this.tail.then(async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      return job();
    });
    this.tail = next.catch(() => {});
    return next;
  }
  private async syncDirectory() {
    if (process.platform === "win32") return;
    const directory = await open(this.directory, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
  private async write(
    command: DurableCommand,
    payload: TelemetryPacket["payload"],
  ) {
    const packet: TelemetryPacket = {
      event_id: randomUUID(),
      command_id: command.command_id,
      lease_token: command.lease_token,
      uuid_flow_run: command.uuid_flow_run,
      payload,
    };
    telemetryPacketSchema.parse(packet);
    if (JSON.stringify(packet).length + 100 > MAX_WIRE_MESSAGE_LENGTH)
      throw new Error(
        "TELEMETRY_LIMIT: la evidencia supera el límite por mensaje; revisar la ejecución.",
      );
    const destination = join(this.directory, `${packet.event_id}.json`);
    const temporary = `${destination}.tmp`;
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(
        JSON.stringify({ agent: command.uuid_agente, packet }),
      );
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, destination);
    await this.syncDirectory();
    // Notification failure cannot invalidate an already persisted message.
    try {
      this.notify();
    } catch {
      /* heartbeat retries */
    }
  }
  private safeError<T extends { message: string }>(
    command: DurableCommand,
    error: T,
  ): T {
    const secrets = [
      ...collectSecretValues({
        document: command.document,
        runtime: command.runtime,
      }),
      ...(this.secrets.get(command.command_id) ?? []),
    ];
    return {
      ...error,
      message: String(redactTelemetry(error.message, secrets)),
    };
  }
  private async prepare(
    command: DurableCommand,
    data: unknown,
  ): Promise<unknown> {
    const secrets = [
      ...collectSecretValues({
        document: command.document,
        runtime: command.runtime,
      }),
      ...(this.secrets.get(command.command_id) ?? []),
    ];
    const visit = async (value: unknown): Promise<unknown> => {
      if (typeof value === "string") {
        const image =
          /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(
            value,
          );
        if (!image) return value;
        if (secrets.includes(value) || secrets.includes(image[2]!))
          return "[REDACTED]";
        const bytes = Buffer.from(image[2]!, "base64");
        if (!bytes.length || bytes.length > MAX_ARTIFACT_BYTES)
          throw new Error(
            "ARTIFACT_LIMIT: la captura supera el límite de 4 MB; la ejecución requiere revisión.",
          );
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        const hash = createHash("sha256")
          .update(`${command.command_id}:${sha256}`)
          .digest("hex");
        const artifactId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
        await this.write(command, {
          kind: "artifact",
          artifact: {
            artifact_id: artifactId,
            content_type: image[1] as "image/png" | "image/jpeg" | "image/webp",
            byte_length: bytes.length,
            sha256,
            content_base64: bytes.toString("base64"),
          },
        });
        return { $artifact: artifactId };
      }
      if (Array.isArray(value)) return Promise.all(value.map(visit));
      if (value && typeof value === "object") {
        const image = value as Record<string, unknown>;
        if (
          typeof image.data === "string" &&
          typeof image.mimeType === "string" &&
          /^image\/(png|jpeg|webp)$/.test(image.mimeType)
        )
          return visit(`data:${image.mimeType};base64,${image.data}`);
        const entries: Array<[string, unknown]> = [];
        for (const [key, child] of Object.entries(value))
          entries.push([key, await visit(child)]);
        return Object.fromEntries(entries);
      }
      return value;
    };
    return redactTelemetry(await visit(data), secrets);
  }
  node(command: DurableCommand, event: FlowNodeEvent) {
    return this.serialized(async () => {
      const definition = command.document?.workflow.nodes.find(
        (node) => node.id === event.node.nodeId,
      );
      if (event.phase === "finished" && definition?.sensitiveOutput) {
        const secrets =
          this.secrets.get(command.command_id) ?? new Set<string>();
        for (const value of collectSecretValues({ secret: event.node.output }))
          secrets.add(value);
        this.secrets.set(command.command_id, secrets);
        event = { ...event, node: { ...event.node, output: "[REDACTED]" } };
      }
      const prepared: FlowNodeEvent =
        event.phase === "finished"
          ? {
              ...event,
              node: {
                ...event.node,
                output: await this.prepare(command, event.node.output),
                error: event.node.error
                  ? this.safeError(command, event.node.error)
                  : undefined,
              },
            }
          : event;
      await this.write(command, { kind: "node", event: prepared });
    });
  }
  result(
    command: DurableCommand,
    result: FlowExecutionResult,
  ): Promise<FlowExecutionResult> {
    return this.serialized(async () => {
      const privateIds = new Set(
        command.document?.workflow.nodes
          .filter((node) => node.sensitiveOutput)
          .map((node) => node.id),
      );
      const safe = {
        ...result,
        outputs: {
          ...result.outputs,
          nodeOutputs: Object.fromEntries(
            Object.entries(result.outputs.nodeOutputs).map(([id, value]) => [
              id,
              privateIds.has(id) ? "[REDACTED]" : value,
            ]),
          ),
          last: privateIds.has(result.nodeRuns.at(-1)?.nodeId ?? "")
            ? "[REDACTED]"
            : result.outputs.last,
        },
        nodeRuns: result.nodeRuns.map((run) =>
          privateIds.has(run.nodeId) ? { ...run, output: "[REDACTED]" } : run,
        ),
      };
      const prepared: FlowExecutionResult = {
        ...safe,
        outputs: (await this.prepare(
          command,
          safe.outputs,
        )) as FlowExecutionResult["outputs"],
        error: safe.error ? this.safeError(command, safe.error) : undefined,
        nodeRuns: [],
      };
      for (const run of safe.nodeRuns)
        prepared.nodeRuns.push({
          ...run,
          output: await this.prepare(command, run.output),
          error: run.error ? this.safeError(command, run.error) : undefined,
        });
      const { nodeRuns, ...summary } = prepared;
      if (JSON.stringify(summary).length + 1000 > MAX_WIRE_MESSAGE_LENGTH)
        throw new Error(
          "TELEMETRY_LIMIT: el resultado supera el límite por mensaje; revisar las trazas de los nodos.",
        );
      this.secrets.delete(command.command_id);
      return prepared;
    });
  }
  pending(agent: string): Promise<TelemetryPacket[]> {
    return this.serialized(async () => {
      const packets: TelemetryPacket[] = [];
      let bytes = 0;
      for (const name of (await readdir(this.directory)).sort()) {
        if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
        const stored = JSON.parse(
          await readFile(join(this.directory, name), "utf8"),
        );
        if (stored.agent !== agent) continue;
        const packet = telemetryPacketSchema.parse(stored.packet);
        const size = JSON.stringify(packet).length;
        if (packets.length && bytes + size > 8_000_000) break;
        bytes += size;
        packets.push(packet);
        if (packets.length >= 30) break;
      }
      return packets;
    });
  }
  receipt(eventId: string, agent: string): Promise<void> {
    return this.serialized(async () => {
      if (!/^[a-f0-9-]{36}$/.test(eventId)) throw new Error("Recibo inválido.");
      const target = join(this.directory, `${eventId}.json`);
      let stored;
      try {
        stored = JSON.parse(await readFile(target, "utf8"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
      if (stored.agent !== agent) throw new Error("Recibo de otro agente.");
      await rm(target);
      await this.syncDirectory();
    });
  }
}
