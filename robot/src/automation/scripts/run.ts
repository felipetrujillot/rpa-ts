import { Worker } from "node:worker_threads";
import workerSource from "./worker.cjs?raw";
import {
  declaredScriptActions,
  scriptSdkMethods,
  SCRIPT_SDK_VERSION,
  type ScriptActionTrace,
} from "@rpa/contracts";
import {
  ScriptActionBroker,
  type ScriptActionAuthorizer,
  type ScriptActionExecutor,
} from "./actions";
import {
  MAX_SCRIPT_BYTES,
  scriptAllowedOrigins,
  scriptHttpRequest,
} from "./http";

export type ScriptResult = {
  ok: boolean;
  result?: unknown;
  logs: unknown[][];
  error?: string;
  errorCode?: string;
  actions?: ScriptActionTrace[];
};

export async function runTypeScript(
  code: string,
  data: unknown,
  timeoutMs: number,
  signal?: AbortSignal,
  sdk?: {
    allowedActions: unknown;
    execute?: ScriptActionExecutor;
    authorize?: ScriptActionAuthorizer;
  },
): Promise<ScriptResult> {
  const inputJson = JSON.stringify(data ?? {});
  if (!code.trim() || Buffer.byteLength(code) > 65536)
    throw new Error("Escribe código TypeScript (máximo 64 KiB).");
  if (!inputJson || Buffer.byteLength(inputJson) > MAX_SCRIPT_BYTES)
    throw new Error("Los datos de entrada exceden 1 MiB o no son JSON.");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000)
    throw new Error("timeoutMs debe ser un entero entre 100 y 30000.");
  if (signal?.aborted)
    return {
      ok: false,
      logs: [],
      error: "Ejecución cancelada.",
      errorCode: "FLOW_CANCELLED",
    };
  const allowedOrigins = scriptAllowedOrigins();
  declaredScriptActions(sdk?.allowedActions);
  const controller = new AbortController();
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const worker = new Worker(workerSource, {
      eval: true,
      workerData: {
        code,
        inputJson,
        deadline,
        sdkMethods: scriptSdkMethods,
        sdkVersion: SCRIPT_SDK_VERSION,
        typescriptPath: require.resolve("typescript"),
        quickjsPath: require.resolve("quickjs-emscripten"),
      },
      // This bounds the trusted bootstrap's V8 heap; guest memory is separately bounded by QuickJS.
      resourceLimits: {
        maxOldGenerationSizeMb: 128,
        maxYoungGenerationSizeMb: 16,
        stackSizeMb: 4,
      },
    });
    let settled = false;
    let requests = 0;
    const logs: unknown[][] = [];
    const broker = new ScriptActionBroker(
      sdk?.allowedActions,
      sdk?.execute,
      controller.signal,
      deadline,
      (message) =>
        finish({
          ok: false,
          logs: [],
          error: message,
          errorCode: "ACTION_EFFECT_UNCERTAIN",
        }),
      sdk?.authorize,
    );
    const finish = (result: ScriptResult) => {
      if (settled) return;
      settled = true;
      if (broker.interrupt())
        result = {
          ...result,
          ok: false,
          result: undefined,
          error:
            result.errorCode === "ACTION_EFFECT_UNCERTAIN"
              ? result.error
              : "La ejecución de una acción quedó interrumpida. Revisa sus efectos antes de reintentar.",
          errorCode: "ACTION_EFFECT_UNCERTAIN",
        };
      else if (result.ok && broker.hasPending)
        result = {
          ok: false,
          logs: [],
          error:
            "Espera todas las llamadas del SDK con await antes de terminar el script.",
          errorCode: "SCRIPT_UNAWAITED_ACTION",
        };
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      controller.abort();
      const completed = {
        ...result,
        logs,
        ...(broker.traces.length
          ? {
              actions: JSON.parse(
                JSON.stringify(broker.traces),
              ) as ScriptActionTrace[],
            }
          : {}),
      };
      void worker.terminate().then(
        () => resolve(completed),
        () => resolve(completed),
      );
    };
    const cancel = () =>
      finish({
        ok: false,
        logs: [],
        error: "Ejecución cancelada.",
        errorCode: "FLOW_CANCELLED",
      });
    const timer = setTimeout(
      () =>
        finish({
          ok: false,
          logs: [],
          error: "Tiempo máximo de ejecución excedido.",
          errorCode: "SCRIPT_TIMEOUT",
        }),
      timeoutMs,
    );
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    worker.on("message", (message) => {
      if (settled) return;
      if (message.type === "log") {
        logs.push(message.entry);
      } else if (message.type === "done") {
        finish({
          ok: message.ok === true,
          result: message.result,
          logs: message.logs ?? [],
          error: message.error,
          errorCode: message.ok
            ? undefined
            : message.errorCode || "SCRIPT_FAILED",
        });
      } else if (message.type === "action") {
        void broker.request(message.request).then(
          (result) => {
            if (!settled) worker.postMessage({ id: message.id, result });
          },
          (error) => {
            if (!settled)
              worker.postMessage({
                id: message.id,
                error: {
                  message:
                    error instanceof Error ? error.message : String(error),
                  code:
                    typeof error?.code === "string"
                      ? error.code
                      : "SCRIPT_ACTION_FAILED",
                  actionId: message.request?.actionId,
                },
              });
          },
        );
      } else if (message.type === "http") {
        if (++requests > 20) {
          finish({
            ok: false,
            logs: [],
            error: "Límite de solicitudes HTTP excedido.",
            errorCode: "SCRIPT_LIMIT",
          });
          return;
        }
        void scriptHttpRequest(
          message.request,
          allowedOrigins,
          controller.signal,
        ).then(
          (result) => {
            if (!settled) worker.postMessage({ id: message.id, result });
          },
          (error) => {
            if (!settled)
              worker.postMessage({
                id: message.id,
                error: error instanceof Error ? error.message : String(error),
              });
          },
        );
      }
    });
    worker.on("error", (error) =>
      finish({
        ok: false,
        logs: [],
        error: error.message,
        errorCode: "SCRIPT_WORKER_FAILED",
      }),
    );
    worker.on("exit", (code) => {
      if (!settled)
        finish({
          ok: false,
          logs: [],
          error: `El worker terminó inesperadamente (${code}).`,
          errorCode: "SCRIPT_WORKER_FAILED",
        });
    });
  });
}
