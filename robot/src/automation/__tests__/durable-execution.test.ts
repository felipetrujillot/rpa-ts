import { createWorkflow, PROTOCOL_VERSION } from "@rpa/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { CommandJournal } from "../execution/command-journal";
import { RemoteExecutor } from "../execution/remote-executor";
import { CommandAdmissionGate } from "../execution/command-admission";
import type { DurableCommand } from "../execution/types";
import type { FlowExecutionResult } from "../flow/types";
const directories: string[] = [];
const journal = async () => {
  const directory = await mkdtemp(join(tmpdir(), "rpa-journal-"));
  directories.push(directory);
  return { directory, journal: new CommandJournal(directory) };
};
const command = (overrides: Partial<DurableCommand> = {}): DurableCommand => ({
  protocolVersion: PROTOCOL_VERSION,
  command_id: randomUUID(),
  uuid_agente: "agent",
  uuid_flow_run: randomUUID(),
  lease_token: randomUUID(),
  lease_expires_at: new Date(Date.now() + 60000).toISOString(),
  may_have_started: false,
  kind: "run_flow",
  document: createWorkflow(),
  runtime: {},
  ...overrides,
});
const result = (): FlowExecutionResult => ({
  status: "success",
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  outputs: { vars: {}, nodeOutputs: { expected: 42 } },
  nodeRuns: [],
});
afterEach(async () => {
  vi.useRealTimers();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe("durable execution", () => {
  it("allows the next command after a definite flow failure without requiring reconciliation", async () => {
    const { journal: store } = await journal();
    const first = command();
    const second = command();
    const execute = vi.fn(async (cmd: DurableCommand): Promise<FlowExecutionResult> =>
      cmd.command_id === first.command_id
        ? { ...result(), status: "failed", error: { code: "CUA_ACTION_FAILED", message: "launch_app: APP_NOT_INSTALLED" } }
        : result());
    const remote = new RemoteExecutor(store, execute, vi.fn());
    await remote.accept(first);
    expect((await remote.run(first.command_id, 'agent')).error?.code).toBe('CUA_ACTION_FAILED');
    expect((await remote.snapshot('agent')).lease).toBeUndefined();
    await remote.accept(second);
    expect((await remote.run(second.command_id, 'agent')).status).toBe('success');
    expect(execute).toHaveBeenCalledTimes(2);
  });
  it("deduplicates concurrent delivery and keeps the result across restart and receipt loss", async () => {
    const { directory, journal: store } = await journal();
    const cmd = command();
    let complete!: (value: FlowExecutionResult) => void;
    const execute = vi.fn(
      () =>
        new Promise<FlowExecutionResult>((resolve) => {
          complete = resolve;
        }),
    );
    const remote = new RemoteExecutor(store, execute, vi.fn());
    await remote.accept(cmd);
    const first = remote.run(cmd.command_id, "agent");
    const duplicate = remote.run(cmd.command_id, "agent");
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    complete(result());
    expect(await first).toEqual(await duplicate);
    const restarted = new CommandJournal(directory);
    expect(
      (await restarted.list("agent"))[0]?.result?.outputs.nodeOutputs.expected,
    ).toBe(42);
    await restarted.receipt(cmd.command_id, "agent");
    expect(await restarted.list("agent")).toEqual([]);
    expect((await restarted.accept(cmd)).state).toBe("completed");
    expect(await restarted.list("other-agent")).toEqual([]);
  });
  it("does not replay an interrupted action after process restart", async () => {
    const { directory, journal: store } = await journal();
    const cmd = command();
    await store.accept(cmd);
    await store.start(cmd.command_id);
    const record = (await new CommandJournal(directory).list("agent"))[0]!;
    expect(record.state).toBe("completed");
    expect(record.result?.error?.code).toBe("EXECUTION_INTERRUPTED");
  });
  it("refuses changed payloads and does not execute when the local journal is missing", async () => {
    const { journal: store } = await journal();
    const cmd = command();
    await store.accept(cmd);
    await expect(
      store.accept({ ...cmd, document: createWorkflow("Different") }),
    ).rejects.toThrow("cambió");
    const missing = await store.accept(command({ may_have_started: true }));
    expect(missing.result?.error?.code).toBe("EXECUTION_INTERRUPTED");
  });
  it("persists cancellation arriving before execution", async () => {
    const { journal: store } = await journal();
    const run = command();
    const cancel = command({
      kind: "cancel_flow",
      uuid_flow_run: run.uuid_flow_run,
      lease_token: run.lease_token,
    });
    const execute = vi.fn();
    const remote = new RemoteExecutor(store, execute, vi.fn());
    await remote.accept(cancel);
    await remote.cancel(cancel.command_id, "agent");
    await remote.accept(run);
    expect((await remote.run(run.command_id, "agent")).status).toBe(
      "cancelled",
    );
    expect(execute).not.toHaveBeenCalled();
  });
  it("does not release execution until an expired lease has actually stopped its action", async () => {
    const { journal: store } = await journal();
    const cmd = command({
      lease_expires_at: new Date(Date.now() + 150).toISOString(),
    });
    let finish!: (value: FlowExecutionResult) => void;
    const execute = vi.fn(
      () =>
        new Promise<FlowExecutionResult>((resolve) => {
          finish = resolve;
        }),
    );
    const stop = vi.fn(async () => {});
    const remote = new RemoteExecutor(store, execute, stop);
    await remote.accept(cmd);
    const running = remote.run(cmd.command_id, "agent");
    await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(1), {
      timeout: 2000,
    });
    expect((await remote.snapshot("agent")).lease).toBeDefined();
    finish(result());
    expect((await running).error?.code).toBe("LEASE_EXPIRED");
    expect((await remote.snapshot("agent")).lease).toBeUndefined();
  });
  it("waits for durable server admission and refuses a stale confirmation or a lost connection", async () => {
    const gate = new CommandAdmissionGate();
    const execute = vi.fn();
    const waiting = gate.wait("command", "fence").then(execute);
    gate.confirm("command", "stale");
    await Promise.resolve();
    expect(execute).not.toHaveBeenCalled();
    gate.confirm("command", "fence");
    await waiting;
    expect(execute).toHaveBeenCalledTimes(1);
    const lost = gate.wait("next", "fence");
    const rejected = expect(lost).rejects.toThrow("Conexión cerrada");
    gate.disconnect();
    await rejected;
    const retried = gate.wait("next", "fence");
    gate.confirm("next", "fence");
    await retried;
  });
  it("persists an unexpected driver exception without replaying the action on redelivery", async () => {
    const { journal: store } = await journal();
    const cmd = command();
    const execute = vi.fn(async () => {
      throw new Error("transport disconnected after input");
    });
    const remote = new RemoteExecutor(store, execute, vi.fn());
    await remote.accept(cmd);
    expect((await remote.run(cmd.command_id, "agent")).error?.code).toBe(
      "EXECUTION_INTERRUPTED",
    );
    await remote.run(cmd.command_id, "agent");
    expect(execute).toHaveBeenCalledTimes(1);
    const cancel = command({
      kind: "cancel_flow",
      uuid_flow_run: cmd.uuid_flow_run,
      lease_token: cmd.lease_token,
    });
    await remote.accept(cancel);
    await remote.cancel(cancel.command_id, "agent");
    expect(
      (await store.get(cancel.command_id, "agent"))?.result?.error?.code,
    ).toBe("EXECUTION_INTERRUPTED");
  });
  it("resumes a persisted but unstarted command after reconnect without discarding its payload", async () => {
    const { directory, journal: store } = await journal();
    const cmd = command();
    await store.accept(cmd);
    const execute = vi.fn(async () => result());
    const remote = new RemoteExecutor(
      new CommandJournal(directory),
      execute,
      vi.fn(),
    );
    await remote.accept({ ...cmd, may_have_started: true });
    expect((await remote.run(cmd.command_id, "agent")).status).toBe("success");
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("preserves an uncertain native effect even when cancellation overrides the flow error", async () => {
    const { journal: store } = await journal();
    const cmd = command();
    const cancelled: FlowExecutionResult = {
      ...result(),
      status: "cancelled",
      error: { code: "FLOW_CANCELLED", message: "Ejecución cancelada." },
      nodeRuns: [
        {
          nodeId: "click",
          finishedAt: new Date().toISOString(),
          type: "rpa.action",
          nodeName: "click",
          outputIndex: 0,

          status: "failed",
          startedAt: new Date().toISOString(),
          error: {
            code: "CUA_ACTION_FAILED",
            message: "CUA_DRIVER_UNCERTAIN_OR_UNAVAILABLE: timeout",
          },
        },
      ],
    };
    const remote = new RemoteExecutor(store, async () => cancelled, vi.fn());
    await remote.accept(cmd);
    expect((await remote.run(cmd.command_id, "agent")).error?.code).toBe(
      "EXECUTION_INTERRUPTED",
    );
  });
});
