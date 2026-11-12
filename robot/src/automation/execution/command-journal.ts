import { durableCommandSchema, PROTOCOL_VERSION } from "@rpa/contracts";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { FlowExecutionResult } from "../flow/types";

import type { DurableCommand, CommandRecord } from "./types";
export type { DurableCommand, CommandRecord } from "./types";
const interrupted = (
  message: string,
  status: FlowExecutionResult["status"] = "failed",
): FlowExecutionResult => {
  const time = new Date().toISOString();
  return {
    status,
    startedAt: time,
    finishedAt: time,
    nodeRuns: [],
    outputs: { vars: {}, nodeOutputs: {} },
    error: {
      code: status === "cancelled" ? "FLOW_CANCELLED" : "EXECUTION_INTERRUPTED",
      message,
    },
  };
};
const digest = (command: DurableCommand) =>
  createHash("sha256")
    .update(
      JSON.stringify([
        command.protocolVersion,
        command.uuid_agente,
        command.uuid_flow_run,
        command.lease_token,
        command.kind,
        command.document,
        command.runtime,
      ]),
    )
    .digest("hex");

// Per-command write-ahead records: no side effect is admitted before its running record is fsynced.
export class CommandJournal {
  private records = new Map<string, CommandRecord>();
  private tail: Promise<unknown> = Promise.resolve();
  private initialized: Promise<void> | null = null;
  constructor(private readonly directory: string) {}
  private path(id: string) {
    return join(
      this.directory,
      `${createHash("sha256").update(id).digest("hex")}.json`,
    );
  }
  private async write(record: CommandRecord) {
    const target = this.path(record.command.command_id);
    const temporary = `${target}.${randomUUID()}.tmp`;
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify(record));
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, target);
    if (process.platform !== "win32") {
      const dir = await open(this.directory, "r");
      try {
        await dir.sync();
      } finally {
        await dir.close();
      }
    }
    this.records.set(record.command.command_id, record);
  }
  private init() {
    return (this.initialized ??= (async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      for (const name of await readdir(this.directory)) {
        if (name.endsWith(".tmp")) {
          await rm(join(this.directory, name));
          continue;
        }
        if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
        const record = JSON.parse(
          await readFile(join(this.directory, name), "utf8"),
        ) as CommandRecord;
        if (record.command?.protocolVersion !== PROTOCOL_VERSION)
          throw new Error(
            "El diario pertenece a un protocolo incompatible; revisar sus efectos y usar un perfil de desarrollo nuevo.",
          );
        if (
          !record.command?.command_id ||
          record.digest !== digest(record.command) ||
          this.path(record.command.command_id) !== join(this.directory, name)
        )
          throw new Error(
            "Diario de ejecución inválido; revisar antes de continuar.",
          );
        if (record.state === "running") {
          record.state = "completed";
          record.delivered = false;
          record.result = interrupted(
            "El proceso se interrumpió durante la ejecución. Revisar los efectos antes de reintentar.",
          );
          await this.write(record);
        } else this.records.set(record.command.command_id, record);
      }
    })());
  }
  private serialized<T>(fn: () => Promise<T>): Promise<T> {
    const job = this.tail.then(async () => {
      await this.init();
      return fn();
    });
    this.tail = job.catch(() => {});
    return job;
  }
  accept(command: DurableCommand): Promise<CommandRecord> {
    return this.serialized(async () => {
      if (
        !command ||
        !/^[a-f0-9-]{36}$/.test(command.command_id) ||
        !command.uuid_agente ||
        !command.uuid_flow_run ||
        !/^[a-f0-9-]{36}$/.test(command.lease_token) ||
        !Number.isFinite(Date.parse(command.lease_expires_at)) ||
        !["run_flow", "cancel_flow"].includes(command.kind)
      )
        throw new Error("Comando inválido.");
      command = durableCommandSchema.parse(command);
      const hash = digest(command);
      const existing = this.records.get(command.command_id);
      if (existing) {
        if (existing.digest !== hash)
          throw new Error("El comando cambió después de ser recibido.");
        if (existing.state === "accepted") {
          const refreshed = { ...existing, command };
          await this.write(refreshed);
          return refreshed;
        }
        return existing;
      }
      const record: CommandRecord = {
        command,
        digest: hash,
        state: "accepted",
        delivered: false,
      };
      if (command.kind === "run_flow" && command.may_have_started) {
        record.state = "completed";
        record.result = interrupted(
          "El servidor ya entregó este comando pero falta su diario local. No se repetirá automáticamente.",
        );
      }
      await this.write(record);
      return record;
    });
  }
  start(id: string): Promise<CommandRecord> {
    return this.serialized(async () => {
      const record = this.records.get(id);
      if (!record) throw new Error("Comando no persistido.");
      if (record.state === "running")
        throw new Error("La ejecución ya fue admitida; no se repetirá.");
      if (record.state === "completed") return record;
      if (record.command.kind !== "run_flow")
        throw new Error("No es un comando de ejecución.");
      if (Date.parse(record.command.lease_expires_at) <= Date.now())
        throw new Error("La reserva expiró antes de comenzar.");
      const cancelled = [...this.records.values()].some(
        (r) =>
          r.command.uuid_agente === record.command.uuid_agente &&
          r.command.uuid_flow_run === record.command.uuid_flow_run &&
          r.command.kind === "cancel_flow",
      );
      const next: CommandRecord = {
        ...record,
        state: cancelled ? "completed" : "running",
        result: cancelled
          ? interrupted("Cancelado antes de iniciar.", "cancelled")
          : undefined,
      };
      await this.write(next);
      return next;
    });
  }
  complete(id: string, result: FlowExecutionResult): Promise<void> {
    return this.serialized(async () => {
      const record = this.records.get(id);
      if (!record) throw new Error("Comando no persistido.");
      if (record.state === "completed") return;
      await this.write({
        ...record,
        state: "completed",
        result,
        delivered: false,
      });
    });
  }
  renew(runId: string, token: string, expires: string) {
    return this.serialized(async () => {
      if (!Number.isFinite(Date.parse(expires)))
        throw new Error("Reserva inválida.");
      for (const record of this.records.values())
        if (
          record.command.uuid_flow_run === runId &&
          record.command.lease_token === token &&
          record.state !== "completed"
        ) {
          await this.write({
            ...record,
            command: { ...record.command, lease_expires_at: expires },
          });
        }
    });
  }
  receipt(id: string, agent: string) {
    return this.serialized(async () => {
      const record = this.records.get(id);
      if (record?.command.uuid_agente === agent && record.state === "completed")
        await this.write({ ...record, delivered: true });
    });
  }
  get(id: string, agent: string) {
    return this.serialized(async () => {
      const record = this.records.get(id);
      return record?.command.uuid_agente === agent ? record : undefined;
    });
  }
  list(agent: string) {
    return this.serialized(async () =>
      [...this.records.values()].filter(
        (r) =>
          r.command.uuid_agente === agent &&
          (!r.delivered || r.state !== "completed"),
      ),
    );
  }
}
