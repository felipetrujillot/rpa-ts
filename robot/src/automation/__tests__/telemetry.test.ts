import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  createWorkflow,
  PROTOCOL_VERSION,
  agentMessageSchema,
  type DurableCommand,
  type FlowNodeEvent,
} from "@rpa/contracts";
import { executeFlowDocument } from "../flow/runner";
import { TelemetryOutbox } from "../execution/telemetry-outbox";
import { CommandJournal } from "../execution/command-journal";
import { RemoteExecutor } from "../execution/remote-executor";
const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0))
    await rm(path, { recursive: true, force: true });
});
const cmd = (): DurableCommand => ({
  protocolVersion: PROTOCOL_VERSION,
  command_id: randomUUID(),
  uuid_agente: "agent",
  uuid_flow_run: "run",
  lease_token: randomUUID(),
  lease_expires_at: new Date(Date.now() + 60000).toISOString(),
  may_have_started: false,
  kind: "run_flow",
  document: createWorkflow(),
  runtime: { input: { password: "hidden-value" } },
});
const directory = async () => {
  const path = await mkdtemp(join(tmpdir(), "rpa-telemetry-"));
  directories.push(path);
  return path;
};
const finished = (output: unknown): FlowNodeEvent => ({
  phase: "finished",
  executionIndex: 1,
  node: {
    nodeId: "start",
    nodeName: "Inicio",
    type: "rpa.manualTrigger",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    status: "success",
    outputIndex: 0,
    output,
  },
});
describe("persistent execution telemetry", () => {
  it("emits and awaits a start event before effects, then finishes while later nodes still run", async () => {
    const document = createWorkflow();
    document.workflow.nodes.push({
      id: "action",
      name: "Action",
      type: "rpa.action",
      typeVersion: 1,
      position: [0, 0],
      parameters: { actionId: "wait", input: {} },
    });
    document.workflow.connections = {
      Inicio: { main: [[{ node: "Action", type: "main", index: 0 }]] },
    };
    const events: FlowNodeEvent[] = [];
    let release!: () => void;
    const action = vi.fn(
      () =>
        new Promise<{ ok: boolean; message: string }>((resolve) => {
          release = () => resolve({ ok: true, message: "ok" });
        }),
    );
    const running = executeFlowDocument(
      document,
      {},
      { runAction: action },
      {
        onNodeEvent: async (event) => {
          events.push(event);
        },
      },
    );
    await vi.waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(events.map((event) => [event.executionIndex, event.phase])).toEqual([
      [1, "started"],
      [1, "finished"],
      [2, "started"],
    ]);
    release();
    expect((await running).status).toBe("success");
    expect(events.at(-1)?.phase).toBe("finished");
    const blocked = vi.fn(async () => ({ ok: true, message: "must not run" }));
    await expect(
      executeFlowDocument(
        document,
        {},
        { runAction: blocked },
        {
          onNodeEvent: async () => {
            throw new Error("disk full");
          },
        },
      ),
    ).rejects.toThrow("disk full");
    expect(blocked).not.toHaveBeenCalled();
  });
  it("survives restart and receipt loss, isolates acknowledgements and redacts evidence before disk", async () => {
    const path = await directory();
    const command = cmd();
    const notify = vi.fn();
    await new TelemetryOutbox(path, notify).node(
      command,
      finished({
        password: "hidden-value",
        text: "echo hidden-value",
        authorization: "Bearer abcdef",
        answer: 42,
      }),
    );
    expect(notify).toHaveBeenCalled();
    const restarted = new TelemetryOutbox(path);
    const [packet] = await restarted.pending("agent");
    expect(packet).toBeDefined();
    expect(
      agentMessageSchema.safeParse({
        protocolVersion: 2,
        type: "run_telemetry",
        data: packet,
      }).success,
    ).toBe(true);
    expect(JSON.stringify(packet)).not.toContain("hidden-value");
    expect(JSON.stringify(packet)).toContain('"answer":42');
    const stored = await readFile(
      join(
        path,
        (await readdir(path)).find((name) => name.endsWith(".json"))!,
      ),
      "utf8",
    );
    expect(stored).not.toContain("hidden-value");
    expect(await restarted.pending("other")).toEqual([]);
    await expect(restarted.receipt(packet!.event_id, "other")).rejects.toThrow(
      "otro agente",
    );
    expect((await restarted.pending("agent"))[0]?.event_id).toBe(
      packet!.event_id,
    );
    await restarted.receipt(packet!.event_id, "agent");
    await restarted.receipt(packet!.event_id, "agent");
    expect(await restarted.pending("agent")).toEqual([]);
  });
  it("extracts CUA and data-URL images into stable artifact references without modifying runtime output", async () => {
    const path = await directory();
    const command = cmd();
    const outbox = new TelemetryOutbox(path);
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6r0AAAAASUVORK5CYII=";
    const raw = {
      images: [{ data: png, mimeType: "image/png" }],
      screenshot: `data:image/png;base64,${png}`,
    };
    await outbox.node(command, finished(raw));
    const packets = await outbox.pending("agent");
    const artifacts = packets.filter(
      (packet) => packet.payload.kind === "artifact",
    );
    expect(artifacts).toHaveLength(2);
    if (
      artifacts[0]!.payload.kind !== "artifact" ||
      artifacts[1]!.payload.kind !== "artifact"
    )
      throw new Error();
    expect(artifacts[0]!.payload.artifact.artifact_id).toBe(
      artifacts[1]!.payload.artifact.artifact_id,
    );
    const node = packets.find((packet) => packet.payload.kind === "node")!;
    expect(JSON.stringify(node)).not.toContain(png);
    expect(JSON.stringify(node)).toContain("$artifact");
    expect(raw.images[0]!.data).toBe(png);
  });
  it("suppresses sensitive node output and screenshots in both events and final summaries", async () => {
    const path = await directory();
    const command = cmd();
    command.document!.workflow.nodes[0]!.sensitiveOutput = true;
    const outbox = new TelemetryOutbox(path);
    await outbox.node(
      command,
      finished({
        text: "confidential-text",
        image_data_url: "data:image/png;base64,aGVsbG8=",
      }),
    );
    const packets = await outbox.pending("agent");
    expect(packets).toHaveLength(1);
    expect(JSON.stringify(packets)).not.toContain("confidential-text");
    const result = await outbox.result(command, {
      status: "success",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      nodeRuns: [],
      outputs: {
        vars: { copied: "confidential-text" },
        nodeOutputs: { start: "confidential-text" },
        last: "confidential-text",
      },
    });
    expect(JSON.stringify(result)).not.toContain("confidential-text");
    expect(result.outputs.vars.copied).toBe("[REDACTED]");
  });
  it("reports failed evidence persistence as uncertain and never repeats the completed native effect", async () => {
    const path = await directory();
    const command = cmd();
    command.document!.workflow.nodes.push({
      id: "action",
      name: "Action",
      type: "rpa.action",
      typeVersion: 1,
      position: [0, 0],
      parameters: { actionId: "once", input: {} },
    });
    command.document!.workflow.connections = {
      Inicio: { main: [[{ node: "Action", type: "main", index: 0 }]] },
    };
    const runAction = vi.fn(async () => ({
      ok: true,
      message: "done",
      output: "x".repeat(6_100_000),
    }));
    const outbox = new TelemetryOutbox(join(path, "outbox"));
    const journal = new CommandJournal(join(path, "journal"));
    const remote = new RemoteExecutor(
      journal,
      (command, onNodeEvent) =>
        executeFlowDocument(
          command.document!,
          {},
          { runAction },
          { onNodeEvent },
        ),
      vi.fn(),
      outbox,
    );
    await remote.accept(command);
    expect((await remote.run(command.command_id, "agent")).error?.code).toBe(
      "EXECUTION_INTERRUPTED",
    );
    expect(runAction).toHaveBeenCalledTimes(1);
    const restarted = new CommandJournal(join(path, "journal"));
    expect(
      (await restarted.get(command.command_id, "agent"))?.result?.error?.code,
    ).toBe("EXECUTION_INTERRUPTED");
    await remote.run(command.command_id, "agent");
    expect(runAction).toHaveBeenCalledTimes(1);
  });
  it("redacts error text without changing the reconciliation code or timestamps", async () => {
    const command = cmd();
    command.runtime = {
      input: { password: "EXECUTION_INTERRUPTED", token: "2026" },
    };
    const result = await new TelemetryOutbox(await directory()).result(
      command,
      {
        status: "failed",
        startedAt: "2026-11-03T00:00:00.000Z",
        finishedAt: "2026-11-03T00:00:01.000Z",
        nodeRuns: [],
        outputs: { vars: {}, nodeOutputs: {} },
        error: {
          code: "EXECUTION_INTERRUPTED",
          message: "echo EXECUTION_INTERRUPTED in 2026",
        },
      },
    );
    expect(result.error?.code).toBe("EXECUTION_INTERRUPTED");
    expect(result.error?.message).toBe("echo [REDACTED] in [REDACTED]");
    expect(result.startedAt).toBe("2026-11-03T00:00:00.000Z");
  });
});
