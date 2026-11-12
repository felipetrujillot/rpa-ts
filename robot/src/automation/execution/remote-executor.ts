import { hasUncertainEffect } from "@rpa/contracts";
import type { NodeEventListener } from "@rpa/contracts";
import type { TelemetryOutbox } from "./telemetry-outbox";
import {
  CommandJournal,
  type DurableCommand,
  type CommandRecord,
} from "./command-journal";
import type { FlowExecutionResult } from "../flow/types";

export class RemoteExecutor {
  private active: {
    command: DurableCommand;
    promise: Promise<FlowExecutionResult>;
    timer: ReturnType<typeof setTimeout> | null;
    leaseExpired: boolean;
  } | null = null;
  private storageFailed = false;
  constructor(
    readonly journal: CommandJournal,
    private execute: (
      command: DurableCommand,
      onNodeEvent?: NodeEventListener,
    ) => Promise<FlowExecutionResult>,
    private stop: (runId: string) => Promise<void>,
    readonly telemetry?: TelemetryOutbox,
  ) {}
  accept(command: DurableCommand) {
    return this.journal.accept(command);
  }
  async run(id: string, agent: string): Promise<FlowExecutionResult> {
    if (this.storageFailed)
      throw new Error(
        "El diario no pudo persistirse. Reinicia y revisa la ejecución antes de continuar.",
      );
    // Reserve synchronously before yielding: concurrent deliveries cannot both start.
    let resolve!: (result: FlowExecutionResult) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<FlowExecutionResult>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const record = await this.journal.get(id, agent);
    if (!record) throw new Error("Comando ajeno o no persistido.");
    if (this.active) {
      if (this.active.command.command_id === id) return this.active.promise;
      throw new Error("Dispositivo ocupado.");
    }
    this.active = {
      command: record.command,
      promise,
      timer: null,
      leaseExpired: false,
    };
    void (async () => {
      try {
        const started = await this.journal.start(id);
        if (started.result) {
          resolve(started.result);
          return;
        }
        if (started.state !== "running")
          throw new Error("Estado de ejecución inválido.");
        this.armLease(started.command);
        let result = await this.execute(
          started.command,
          this.telemetry
            ? (event) => this.telemetry!.node(started.command, event)
            : undefined,
        );
        if (this.active?.leaseExpired)
          result = {
            ...result,
            status: "failed",
            error: {
              code: "LEASE_EXPIRED",
              message:
                "La reserva expiró sin conexión. La acción se detuvo; revisar sus efectos antes de reintentar.",
            },
          };
        const uncertain = [
          result.error,
          ...result.nodeRuns.map((step) => step.error),
        ].find(hasUncertainEffect);
        if (uncertain)
          result = {
            ...result,
            status: "failed",
            error: { ...uncertain, code: "EXECUTION_INTERRUPTED" },
          };
        if (this.telemetry)
          result = await this.telemetry.result(started.command, result);
        await this.journal.complete(id, result);
        resolve(result);
      } catch (error) {
        const now = new Date().toISOString();
        const failure: FlowExecutionResult = {
          status: "failed",
          startedAt: now,
          finishedAt: now,
          outputs: { vars: {}, nodeOutputs: {} },
          nodeRuns: [],
          error: {
            code: "EXECUTION_INTERRUPTED",
            message: error instanceof Error ? error.message : String(error),
          },
        };
        try {
          const safeFailure = this.telemetry
            ? await this.telemetry.result(record.command, failure)
            : failure;
          await this.journal.complete(id, safeFailure);
          resolve(safeFailure);
        } catch (storageError) {
          this.storageFailed = true;
          reject(storageError);
        }
      } finally {
        if (this.active?.command.command_id === id) {
          if (this.active.timer) clearTimeout(this.active.timer);
          this.active = null;
        }
      }
    })();
    return promise;
  }
  private armLease(command: DurableCommand) {
    if (!this.active || this.active.command.command_id !== command.command_id)
      return;
    if (this.active.timer) clearTimeout(this.active.timer);
    this.active.command = command;
    this.active.timer = setTimeout(
      () => {
        if (this.active) this.active.leaseExpired = true;
        void this.stop(command.uuid_flow_run).catch(() => {});
      },
      Math.max(1, Date.parse(command.lease_expires_at) - Date.now()),
    );
    this.active.timer.unref?.();
  }
  async renew(runId: string, token: string, expires: string) {
    await this.journal.renew(runId, token, expires);
    if (
      this.active?.command.uuid_flow_run === runId &&
      this.active.command.lease_token === token
    )
      this.armLease({ ...this.active.command, lease_expires_at: expires });
  }
  async cancel(id: string, agent: string) {
    const record = await this.journal.get(id, agent);
    if (!record || record.command.kind !== "cancel_flow")
      throw new Error("Cancelación no persistida.");
    await this.stop(record.command.uuid_flow_run);
    const active = this.active;
    const activeResult =
      active?.command.uuid_flow_run === record.command.uuid_flow_run
        ? await active.promise
        : undefined;
    const runRecord = (await this.journal.list(agent)).find(
      (entry) =>
        entry.command.kind === "run_flow" &&
        entry.command.uuid_flow_run === record.command.uuid_flow_run &&
        entry.command.lease_token === record.command.lease_token,
    );
    const previous = activeResult || runRecord?.result;
    if (previous?.error?.code === "EXECUTION_INTERRUPTED") {
      await this.journal.complete(id, previous);
      return;
    }
    const now = new Date().toISOString();
    const result: FlowExecutionResult = {
      status: "cancelled",
      startedAt: now,
      finishedAt: now,
      nodeRuns: [],
      outputs: { vars: {}, nodeOutputs: {} },
    };
    await this.journal.complete(id, result);
  }
  async drain() {
    await this.active?.promise;
  }
  async snapshot(agent: string): Promise<{
    records: CommandRecord[];
    lease?: { uuid_flow_run: string; lease_token: string };
  }> {
    const records = await this.journal.list(agent);
    const active = this.active?.command;
    return {
      records,
      lease:
        active?.uuid_agente === agent
          ? {
              uuid_flow_run: active.uuid_flow_run,
              lease_token: active.lease_token,
            }
          : undefined,
    };
  }
}
