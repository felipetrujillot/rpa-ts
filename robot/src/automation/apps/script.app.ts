import { scriptActionDefinition } from "@rpa/contracts";
import type { AutomationApp } from "../core/types";
import { runTypeScript } from "../scripts/run";

export const scriptApp: AutomationApp = {
  id: "script",
  name: "Código",
  description:
    "Scripts TypeScript aislados para transformar datos e integrar APIs.",
  actions: [
    {
      ...scriptActionDefinition,
      appId: "script",
      tags: ["typescript", "script", "integration"],
      run: async (input, context) => {
        try {
          if (typeof input?.code !== "string")
            throw new Error("El campo code es obligatorio.");
          const data =
            typeof input.data === "string"
              ? JSON.parse(input.data)
              : (input.data ?? {});
          const timeout =
            input.timeoutMs === undefined ? 5000 : Number(input.timeoutMs);
          const result = await runTypeScript(
            input.code,
            data,
            timeout,
            context.signal,
            {
              allowedActions: input.allowedActions,
              execute: context.executeAction,
              authorize: context.authorizeScriptAction,
            },
          );
          return {
            ok: result.ok,
            message: result.ok
              ? "TypeScript ejecutado correctamente."
              : (result.error ?? "Falló el script."),
            output: {
              result: result.result,
              logs: result.logs,
              ...(result.actions ? { actions: result.actions } : {}),
            },
            errorCode: result.errorCode,
          };
        } catch (error) {
          return {
            ok: false,
            message: error instanceof Error ? error.message : String(error),
            errorCode:
              typeof (error as { code?: unknown })?.code === "string"
                ? (error as { code: string }).code
                : "SCRIPT_VALIDATION_ERROR",
          };
        }
      },
    },
  ],
};
