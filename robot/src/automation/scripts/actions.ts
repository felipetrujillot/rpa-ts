import {
  declaredScriptActions,
  SCRIPT_MAX_ACTIONS,
  scriptSdkActionIds,
  scriptSdkOutputSchemas,
  validateScriptSdkInput,
  hasUncertainEffect,
  type ScriptActionTrace,
  type AutomationInput,
  type ActionRunResult,
} from "@rpa/contracts";
import { MAX_SCRIPT_BYTES } from "./http";

const error = (message: string, code: string) =>
  Object.assign(new Error(message), { code });
export type ScriptActionAuthorizer = (
  actionId: string,
  signal: AbortSignal,
) => Promise<boolean>;
export type ScriptActionExecutor = (
  actionId: string,
  input: AutomationInput,
  signal: AbortSignal,
) => Promise<ActionRunResult>;

export class ScriptActionBroker {
  readonly traces: ScriptActionTrace[] = [];
  private tail = Promise.resolve();
  private pending = 0;
  private active?: ScriptActionTrace;
  private outputBytes = 0;
  private declared: Set<string>;
  constructor(
    allowedActions: unknown,
    private readonly execute: ScriptActionExecutor | undefined,
    private readonly signal: AbortSignal,
    private readonly deadline: number,
    private readonly fatal: (message: string) => void,
    private readonly authorize?: ScriptActionAuthorizer,
  ) {
    this.declared = new Set(declaredScriptActions(allowedActions));
  }
  get hasPending() {
    return this.pending > 0;
  }
  interrupt(): boolean {
    for (const trace of this.traces)
      if (trace.status === "running" && trace !== this.active) {
        trace.status = "failed";
        trace.errorCode = "FLOW_CANCELLED";
        trace.message = "La acción no llegó a iniciarse.";
        trace.finishedAt = new Date().toISOString();
      }
    if (!this.active) return false;
    if (this.active.status === "uncertain") return true;
    this.active.status = "uncertain";
    this.active.finishedAt = new Date().toISOString();
    this.active.errorCode = "ACTION_EFFECT_UNCERTAIN";
    this.active.message =
      "El script terminó mientras la acción estaba en curso. Revisa sus efectos antes de reintentar.";
    return true;
  }
  request(request: unknown): Promise<unknown> {
    if (!request || typeof request !== "object" || Array.isArray(request))
      return Promise.reject(
        error("Solicitud SDK inválida.", "SCRIPT_ACTION_INVALID"),
      );
    const { actionId, input } = request as {
      actionId?: unknown;
      input?: unknown;
    };
    if (
      typeof actionId !== "string" ||
      !scriptSdkActionIds.includes(actionId) ||
      actionId.startsWith("script.")
    )
      return Promise.reject(
        error("Acción SDK desconocida o recursiva.", "SCRIPT_ACTION_DENIED"),
      );
    if (this.traces.length >= SCRIPT_MAX_ACTIONS || this.pending >= 4)
      return Promise.reject(
        error(
          "Límite de acciones SDK excedido (100 llamadas, 4 pendientes).",
          "SCRIPT_LIMIT",
        ),
      );
    const trace: ScriptActionTrace = {
      sequence: this.traces.length + 1,
      actionId,
      startedAt: new Date().toISOString(),
      status: "running",
    };
    this.traces.push(trace);
    this.pending++;
    const operation = this.tail.then(async () => {
      try {
        this.signal.throwIfAborted();
        if (!this.declared.has(actionId))
          throw error(
            `Declara ${actionId} en los permisos del script.`,
            "SCRIPT_ACTION_DENIED",
          );
        if (!this.execute)
          throw error(
            "El robot no tiene un ejecutor de acciones configurado.",
            "SCRIPT_ACTION_UNAVAILABLE",
          );
        const validated = validateScriptSdkInput(actionId, input ?? {});
        if (!this.authorize)
          throw error(
            "El SDK requiere autorización del servidor. Configúrala en Equipo y acceso del robot.",
            "SCRIPT_ACTION_DENIED",
          );
        let authorized: boolean;
        try {
          authorized = await this.authorize(actionId, this.signal);
        } catch {
          this.signal.throwIfAborted();
          throw error(
            "No se pudo verificar el permiso del SDK con el servidor. La acción no se ejecutó.",
            "SCRIPT_POLICY_UNAVAILABLE",
          );
        }
        this.signal.throwIfAborted();
        if (authorized !== true)
          throw error(
            `El servidor no autoriza ${actionId} para este robot. Revisa Equipo y acceso → Permisos del SDK.`,
            "SCRIPT_ACTION_DENIED",
          );
        const remaining = this.deadline - Date.now();
        if (remaining < 100)
          throw error(
            "No queda tiempo para iniciar la acción.",
            "SCRIPT_TIMEOUT",
          );
        if ("timeoutMs" in validated)
          validated.timeoutMs = Math.min(
            Number(validated.timeoutMs),
            remaining,
          );
        this.active = trace;
        trace.startedAt = new Date().toISOString();
        let result: ActionRunResult;
        try {
          result = await this.execute(actionId, validated, this.signal);
        } catch (cause) {
          const detail = cause instanceof Error ? cause.message : String(cause);
          throw error(
            `${actionId}: el ejecutor terminó sin confirmar el resultado de la acción. ${detail}`,
            "ACTION_EFFECT_UNCERTAIN",
          );
        }
        if (!result.ok)
          throw error(
            result.message,
            result.errorCode ?? "SCRIPT_ACTION_FAILED",
          );
        // JSON is the only transport across the sandbox, with a bounded response.
        let encoded: string;
        try {
          encoded = JSON.stringify(result.output ?? null);
        } catch {
          throw error(
            "La acción terminó con una respuesta que no se puede serializar como JSON.",
            "ACTION_EFFECT_UNCERTAIN",
          );
        }
        if (Buffer.byteLength(encoded) > MAX_SCRIPT_BYTES)
          throw error(
            "La respuesta de la acción excede 1 MiB.",
            "ACTION_EFFECT_UNCERTAIN",
          );
        const output: unknown = JSON.parse(encoded);
        const schema = scriptSdkOutputSchemas[actionId];
        if (schema && !schema.safeParse(output).success)
          throw error(
            `Respuesta incompatible con el contrato de ${actionId}.`,
            "ACTION_EFFECT_UNCERTAIN",
          );
        if (this.signal.aborted)
          throw error(
            "La acción terminó después de cancelar el script.",
            "ACTION_EFFECT_UNCERTAIN",
          );
        trace.status = "success";
        if (this.outputBytes + Buffer.byteLength(encoded) <= 128 * 1024) {
          trace.output = output;
          this.outputBytes += Buffer.byteLength(encoded);
        } else trace.outputOmitted = true;
        return output;
      } catch (cause) {
        const code =
          typeof (cause as { code?: unknown })?.code === "string"
            ? (cause as { code: string }).code
            : "SCRIPT_ACTION_INVALID";
        trace.status = hasUncertainEffect({
          code,
          message: cause instanceof Error ? cause.message : String(cause),
        })
          ? "uncertain"
          : "failed";
        trace.errorCode =
          trace.status === "uncertain" ? "ACTION_EFFECT_UNCERTAIN" : code;
        trace.message = (
          cause instanceof Error ? cause.message : String(cause)
        ).slice(0, 8192);
        if (trace.status === "uncertain") this.fatal(trace.message);
        throw error(trace.message, trace.errorCode);
      } finally {
        trace.finishedAt = new Date().toISOString();
        if (this.active === trace) this.active = undefined;
        this.pending--;
      }
    });
    this.tail = operation.then(
      () => {},
      () => {},
    );
    return operation;
  }
}
