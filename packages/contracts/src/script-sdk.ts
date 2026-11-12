import { z } from "zod";
import { scriptAllowedActionsSchema } from "./script-policy";
import type { AutomationInput } from "./automation";
import { browserInputSchemas, browserOutputSchemas } from "./browser";
import { cuaActionDefinitions } from "./cua";
import {
  excelInputSchemas,
  excelOutputSchemas,
  validateExcelInput,
  type ExcelActionId,
} from "./excel";
import {
  wordInputSchemas,
  wordOutputSchemas,
  validateWordInput,
  type WordActionId,
} from "./word";

export const SCRIPT_SDK_VERSION = "1.0.0";
export {
  SCRIPT_MAX_ACTIONS,
  scriptAllowedActionsSchema,
  declaredScriptActions,
  workflowActionIds,
} from "./script-policy";

const cuaSchemas: Record<string, z.ZodType> = Object.fromEntries(
  cuaActionDefinitions.map((action) => {
    const shape: Record<string, z.ZodType> = {};
    const scoped = action.inputFields.some((field) => field.key === "scope");
    for (const field of action.inputFields) {
      let schema: z.ZodType = field.options?.length
        ? z.enum(
            field.options.map((option) => option.value) as [
              string,
              ...string[],
            ],
          )
        : field.type === "number"
          ? z.number().finite()
          : field.type === "boolean"
            ? z.boolean()
            : z.string();
      if (
        ["modifiers", "keys", "urls"].includes(field.key) &&
        action.id !== "cua.clipboard.write"
      )
        schema = z.union([z.string(), z.array(z.string())]);
      if (field.key === "scales")
        schema = z.union([z.string(), z.array(z.number().positive())]);
      if (field.key === "region")
        schema = z.strictObject({
          x: z.number(),
          y: z.number(),
          width: z.number().positive(),
          height: z.number().positive(),
        });
      if (field.key === "pid") schema = z.number().int().positive();
      if (field.key === "windowId") schema = z.number().int().nonnegative();
      // Coordinates and geometry in the form are placeholders, not runtime defaults.
      const explicit = [
        "pid",
        "windowId",
        "x",
        "y",
        "x1",
        "y1",
        "x2",
        "y2",
        "fromX",
        "fromY",
        "toX",
        "toY",
        "width",
        "height",
      ];
      const hasDefault =
        Object.hasOwn(action.defaults, field.key) &&
        action.defaults[field.key] !== "" &&
        !explicit.includes(field.key);
      shape[field.key] =
        !field.required ||
        hasDefault ||
        (scoped && ["pid", "windowId"].includes(field.key))
          ? schema.optional()
          : schema;
    }
    const schema = z.strictObject(shape);
    return [
      action.id,
      scoped
        ? z.union([
            schema.extend({ scope: z.literal("desktop") }),
            schema.extend({
              scope: z.literal("window").optional(),
              pid: z.number().int().positive(),
              windowId: z.number().int().nonnegative(),
            }),
          ])
        : schema,
    ];
  }),
);
export const scriptSdkInputSchemas: Record<string, z.ZodType> = {
  ...cuaSchemas,
  ...browserInputSchemas,
  ...excelInputSchemas,
  ...wordInputSchemas,
};
export const scriptSdkOutputSchemas: Record<string, z.ZodType> = {
  ...browserOutputSchemas,
  ...excelOutputSchemas,
  ...wordOutputSchemas,
};
export const scriptSdkActionIds = Object.keys(scriptSdkInputSchemas);
/** Policy stored by the server; distinct from the permissions declared by a workflow. */
export const scriptSdkAllowedActionsSchema = scriptAllowedActionsSchema.refine(
  (ids) => ids.every((id) => scriptSdkActionIds.includes(id)),
  "La política contiene acciones SDK desconocidas.",
);
export const scriptAuthorizationResponseSchema = z.strictObject({
  allowed: z.boolean(),
});

/** Maps friendly SDK paths to the existing action IDs; also used inside QuickJS. */
export const scriptSdkMethods: Record<string, string> = Object.fromEntries(
  scriptSdkActionIds.map((id) => {
    if (id.startsWith("playwright.")) {
      const method = id.split(".").slice(-1)[0]!;
      return [`browser.${method}`, id];
    }
    return [id.startsWith("cua.") ? `desktop.${id.slice(4)}` : id, id];
  }),
);

export function validateScriptSdkInput(
  actionId: string,
  input: unknown,
): AutomationInput {
  if (!Object.hasOwn(scriptSdkInputSchemas, actionId))
    throw new Error(`Acción SDK desconocida: ${actionId}`);
  if (Object.hasOwn(excelInputSchemas, actionId))
    return validateExcelInput(
      actionId as ExcelActionId,
      input,
    ) as AutomationInput;
  if (Object.hasOwn(wordInputSchemas, actionId))
    return validateWordInput(
      actionId as WordActionId,
      input,
    ) as AutomationInput;
  return scriptSdkInputSchemas[actionId]!.parse(input) as AutomationInput;
}

type JsonSchema = Record<string, unknown>;
function schemaType(
  schema: JsonSchema,
  root: JsonSchema,
  seen = new Set<string>(),
): string {
  if (typeof schema.$ref === "string") {
    if (seen.has(schema.$ref)) return "RpaJsonValue";
    const key = schema.$ref.split("/").pop()!;
    const definition = (root.$defs as Record<string, JsonSchema> | undefined)?.[
      key
    ];
    return definition
      ? schemaType(definition, root, new Set([...seen, schema.$ref]))
      : "unknown";
  }
  if ("const" in schema) return JSON.stringify(schema.const);
  if (Array.isArray(schema.enum))
    return (
      schema.enum.map((value) => JSON.stringify(value)).join(" | ") || "never"
    );
  const variants = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(variants))
    return variants
      .map((value) => `(${schemaType(value as JsonSchema, root, seen)})`)
      .join(" | ");
  if (Array.isArray(schema.type))
    return schema.type
      .map((type) => schemaType({ ...schema, type }, root, seen))
      .join(" | ");
  switch (schema.type) {
    case "string":
      return "string";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "array":
      return `Array<${schemaType((schema.items ?? {}) as JsonSchema, root, seen)}>`;
    case "object": {
      const properties = (schema.properties ?? {}) as Record<
        string,
        JsonSchema
      >;
      const required = new Set((schema.required ?? []) as string[]);
      const fields = Object.entries(properties).map(
        ([key, value]) =>
          `${JSON.stringify(key)}${required.has(key) ? "" : "?"}: ${schemaType(value, root, seen)};`,
      );
      if (
        schema.additionalProperties &&
        typeof schema.additionalProperties === "object"
      )
        fields.push(
          `[key: string]: ${schemaType(schema.additionalProperties as JsonSchema, root, seen)};`,
        );
      return `{ ${fields.join(" ")} }`;
    }
    default:
      return "unknown";
  }
}
function declaration(schema: z.ZodType, io: "input" | "output") {
  const json = z.toJSONSchema(schema, {
    io,
    unrepresentable: "any",
  }) as JsonSchema;
  return schemaType(json, json);
}
function methodTree(paths: string[], prefix = ""): string {
  return [
    ...new Set(paths.map((path) => path.slice(prefix.length).split(".")[0]!)),
  ]
    .map((key) => {
      const path = `${prefix}${key}`;
      const id = scriptSdkMethods[path];
      if (id)
        return `${JSON.stringify(key)}: (input: RpaActionInputs[${JSON.stringify(id)}]) => Promise<RpaActionOutputs[${JSON.stringify(id)}]>;`;
      return `${JSON.stringify(key)}: { ${methodTree(
        paths.filter((item) => item.startsWith(`${path}.`)),
        `${path}.`,
      )} };`;
    })
    .join("\n");
}
/** Standalone ambient declarations: no Node, DOM, module loader, or installed SDK needed. */
export function scriptSdkDeclarations(): string {
  return `
type RpaJsonValue = string | number | boolean | null | RpaJsonValue[] | { [key: string]: RpaJsonValue };
interface RpaActionInputs { ${scriptSdkActionIds.map((id) => `${JSON.stringify(id)}: ${declaration(scriptSdkInputSchemas[id]!, "input")};`).join("\n")} }
interface RpaActionOutputs { ${scriptSdkActionIds.map((id) => `${JSON.stringify(id)}: ${scriptSdkOutputSchemas[id] ? declaration(scriptSdkOutputSchemas[id]!, "output") : "Record<string, unknown>"};`).join("\n")} }
type RpaActionId = keyof RpaActionInputs;
/** Error de acción. code y actionId permiten decidir qué errores gestionar. */
declare class RpaActionError extends Error { readonly code: string; readonly actionId: string; }
/** SDK del robot. Requiere permiso explícito del nodo y de la política del servidor. */
declare const rpa: {
  readonly version: ${JSON.stringify(SCRIPT_SDK_VERSION)};
  readonly actions: { execute<K extends RpaActionId>(actionId: K, input: RpaActionInputs[K]): Promise<RpaActionOutputs[K]>; };
  ${methodTree(Object.keys(scriptSdkMethods))}
};`;
}

export type ScriptActionTrace = {
  sequence: number;
  actionId: string;
  startedAt: string;
  finishedAt?: string;
  status: "running" | "success" | "failed" | "uncertain";
  errorCode?: string;
  message?: string;
  output?: unknown;
  outputOmitted?: boolean;
};

/** Read bounded persisted traces; ignore unrelated or redacted node output. */
export function scriptActionTraces(output: unknown): ScriptActionTrace[] {
  if (
    !output ||
    typeof output !== "object" ||
    !("actions" in output) ||
    !Array.isArray(output.actions)
  )
    return [];
  return output.actions
    .slice(0, 100)
    .filter(
      (trace): trace is ScriptActionTrace =>
        !!trace &&
        typeof trace === "object" &&
        Number.isInteger(trace.sequence) &&
        typeof trace.actionId === "string" &&
        typeof trace.startedAt === "string" &&
        ["running", "success", "failed", "uncertain"].includes(trace.status) &&
        (trace.finishedAt === undefined ||
          typeof trace.finishedAt === "string") &&
        (trace.errorCode === undefined ||
          typeof trace.errorCode === "string") &&
        (trace.message === undefined || typeof trace.message === "string"),
    );
}
