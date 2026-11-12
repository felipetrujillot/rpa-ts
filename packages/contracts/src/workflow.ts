import { z } from "zod";
import { pluginRequirementSchema } from "./plugins";
import type { AutomationInput, ActionRunResult } from "./automation";
export const FLOW_SCHEMA_VERSION = "2.0.0" as const;
export const PROTOCOL_VERSION = 2 as const;
export type FlowValue =
  string | number | boolean | null | FlowValue[] | { [key: string]: FlowValue };
export type FlowExpression =
  | { op: "and" | "or"; args: FlowExpression[] }
  | { op: "not"; arg: FlowExpression }
  | {
      op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "contains" | "in";
      left: FlowValue;
      right: FlowValue;
    }
  | { op: "truthy" | "falsy"; value: FlowValue };
const safeKey = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (value) => !["__proto__", "prototype", "constructor"].includes(value),
    "Clave reservada",
  );
const value: z.ZodType<FlowValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(value),
    z.record(safeKey, value),
  ]),
);
const expression: z.ZodType<FlowExpression> = z.lazy(() =>
  z.union([
    z.strictObject({
      op: z.enum(["and", "or"]),
      args: z.array(expression).min(1),
    }),
    z.strictObject({ op: z.literal("not"), arg: expression }),
    z.strictObject({
      op: z.enum(["eq", "ne", "gt", "gte", "lt", "lte", "contains", "in"]),
      left: value,
      right: value,
    }),
    z.strictObject({ op: z.enum(["truthy", "falsy"]), value }),
  ]),
);
const base = {
  id: safeKey,
  name: safeKey,
  typeVersion: z.literal(1),
  position: z.tuple([z.number().finite(), z.number().finite()]),
  disabled: z.boolean().optional(),
  notes: z.string().optional(),
  sensitiveOutput: z.boolean().optional(),
  onError: z.enum(["stopWorkflow", "continueRegularOutput"]).optional(),
};
export const workflowNodeSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...base,
    type: z.literal("rpa.manualTrigger"),
    parameters: z.strictObject({}),
  }),
  z.strictObject({
    ...base,
    type: z.literal("rpa.action"),
    parameters: z.strictObject({
      actionId: z.string().min(1),
      input: z.record(safeKey, value).default({}),
    }),
  }),
  z.strictObject({
    ...base,
    type: z.literal("rpa.if"),
    parameters: z.strictObject({ condition: expression }),
  }),
  z.strictObject({
    ...base,
    type: z.literal("rpa.set"),
    parameters: z.strictObject({ values: z.record(safeKey, value) }),
  }),
  z.strictObject({
    ...base,
    type: z.literal("rpa.while"),
    parameters: z.strictObject({
      condition: expression,
      maxIterations: z.number().int().min(1).max(10000).default(100),
    }),
  }),
  z.strictObject({
    ...base,
    type: z.literal("rpa.forEach"),
    parameters: z.strictObject({
      items: value,
      itemVar: safeKey,
      indexVar: safeKey.optional(),
      maxIterations: z.number().int().min(1).max(10000).default(100),
    }),
  }),
  z.strictObject({
    ...base,
    type: z.literal("rpa.noOp"),
    parameters: z.strictObject({}),
  }),
  z.strictObject({
    ...base,
    type: z.literal("rpa.end"),
    parameters: z.strictObject({}),
  }),
]);
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export const connectionSchema = z.strictObject({
  node: safeKey,
  type: z.literal("main"),
  index: z.literal(0),
});
export const workflowSchema = z.strictObject({
  id: safeKey,
  name: z.string().min(1).max(250),
  nodes: z.array(workflowNodeSchema).min(1).max(1000),
  connections: z.record(
    safeKey,
    z.strictObject({ main: z.array(z.array(connectionSchema)).max(2) }),
  ),
  settings: z
    .strictObject({
      executionOrder: z.literal("fifo"),
      maxNodeExecutions: z.number().int().min(1).max(100000).default(1000),
    })
    .default({ executionOrder: "fifo", maxNodeExecutions: 1000 }),
  variables: z.record(safeKey, value).default({}),
});
// executionOrder is deliberately our deterministic FIFO policy, not an n8n engine version.
export const flowDocumentSchema = z.strictObject({
  kind: z.literal("rpa.workflow"),
  schemaVersion: z.literal(FLOW_SCHEMA_VERSION),
  workflow: workflowSchema,
  pluginRequirements: z.array(pluginRequirementSchema).max(50).optional(),
});
export type FlowDocument = z.infer<typeof flowDocumentSchema>;
export type Workflow = FlowDocument["workflow"];
export type WorkflowConnections = Workflow["connections"];
export type FlowValidationError = {
  code: string;
  path: string;
  message: string;
};
export type FlowValidationResult = {
  ok: boolean;
  errors: FlowValidationError[];
  normalized?: FlowDocument;
};
export const nodeOutputCount = (node: WorkflowNode) =>
  node.type === "rpa.end"
    ? 0
    : ["rpa.if", "rpa.while", "rpa.forEach"].includes(node.type)
      ? 2
      : 1;
export const nodeInputCount = (node: WorkflowNode) =>
  node.type === "rpa.manualTrigger" ? 0 : 1;
export const nodeTypes = [
  {
    type: "rpa.manualTrigger",
    displayName: "Inicio manual",
    inputs: 0,
    outputs: ["Continuar"],
  },
  {
    type: "rpa.action",
    displayName: "Acción",
    inputs: 1,
    outputs: ["Resultado"],
  },
  {
    type: "rpa.if",
    displayName: "Condición",
    inputs: 1,
    outputs: ["Verdadero", "Falso"],
  },
  {
    type: "rpa.set",
    displayName: "Variables",
    inputs: 1,
    outputs: ["Continuar"],
  },
  {
    type: "rpa.while",
    displayName: "Mientras",
    inputs: 1,
    outputs: ["Cuerpo", "Terminado"],
  },
  {
    type: "rpa.forEach",
    displayName: "Por cada elemento",
    inputs: 1,
    outputs: ["Elemento", "Terminado"],
  },
  {
    type: "rpa.noOp",
    displayName: "Continuar",
    inputs: 1,
    outputs: ["Continuar"],
  },
  { type: "rpa.end", displayName: "Fin", inputs: 1, outputs: [] },
] as const;
export function createWorkflow(
  name = "Nuevo flujo",
  id = "workflow",
): FlowDocument {
  return {
    kind: "rpa.workflow",
    schemaVersion: FLOW_SCHEMA_VERSION,
    workflow: {
      id,
      name,
      nodes: [
        {
          id: "start",
          name: "Inicio",
          type: "rpa.manualTrigger",
          typeVersion: 1,
          parameters: {},
          position: [80, 160],
        },
      ],
      connections: {},
      settings: { executionOrder: "fifo", maxNodeExecutions: 1000 },
      variables: {},
    },
  };
}
export type FlowRunStatus = "success" | "failed" | "cancelled";
export type FlowNodeRun = {
  nodeId: string;
  nodeName: string;
  type: WorkflowNode["type"];
  status: "success" | "failed";
  startedAt: string;
  finishedAt: string;
  outputIndex: number;
  output?: unknown;
  error?: { message: string; code?: string };
};
export type FlowExecutionResult = {
  status: FlowRunStatus;
  startedAt: string;
  finishedAt: string;
  nodeRuns: FlowNodeRun[];
  outputs: {
    vars: Record<string, unknown>;
    nodeOutputs: Record<string, unknown>;
    last?: unknown;
  };
  error?: { nodeId?: string; message: string; code?: string };
};
export type FlowRuntimeContext = { input?: Record<string, unknown> };
export type FlowExecutionEnvironment = {
  plugins?: import("./plugins").PluginInventory;
  runAction: (
    actionId: string,
    input: AutomationInput | undefined,
  ) => Promise<ActionRunResult>;
};
export type DurableCommand = {
  protocolVersion: typeof PROTOCOL_VERSION;
  command_id: string;
  uuid_agente: string;
  uuid_flow_run: string;
  lease_token: string;
  lease_expires_at: string;
  may_have_started: boolean;
  kind: "run_flow" | "cancel_flow";
  document?: FlowDocument;
  runtime?: FlowRuntimeContext;
};
export type CommandRecord = {
  command: DurableCommand;
  digest: string;
  state: "accepted" | "running" | "completed";
  result?: FlowExecutionResult;
  delivered: boolean;
};
export const flowRuntimeSchema = z.strictObject({
  input: z.record(z.string(), z.unknown()).optional(),
});
export const durableCommandSchema = z
  .strictObject({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    command_id: z.uuid(),
    uuid_agente: z.string().min(1),
    uuid_flow_run: z.string().min(1),
    lease_token: z.uuid(),
    lease_expires_at: z.iso.datetime(),
    may_have_started: z.boolean(),
    kind: z.enum(["run_flow", "cancel_flow"]),
    document: flowDocumentSchema.optional(),
    runtime: flowRuntimeSchema.optional(),
  })
  .superRefine((command, ctx) => {
    if (command.kind === "run_flow" && !command.document)
      ctx.addIssue({
        code: "custom",
        path: ["document"],
        message: "El comando requiere un documento v2.",
      });
  });
