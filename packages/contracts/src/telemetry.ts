import { z } from "zod";
import type { FlowNodeRun } from "./workflow";

export const MAX_ARTIFACT_BYTES = 4_000_000;
export const REDACTED = "[REDACTED]";
const secretKey =
  /(?:password|passwd|secret|token|authorization|cookie|apikey|privatekey|credential)/i;
export const isSecretKey = (key: string) =>
  secretKey.test(key.replace(/[-_\s]/g, ""));
export const collectSecretValues = (input: unknown): string[] => {
  const values = new Set<string>();
  const visit = (value: unknown, sensitive = false, depth = 0) => {
    if (depth > 100) return;
    if (typeof value === "string" && sensitive && value.length >= 4)
      values.add(value);
    else if (value && typeof value === "object")
      for (const [key, child] of Object.entries(value))
        visit(child, sensitive || isSecretKey(key), depth + 1);
  };
  visit(input);
  return [...values].sort((a, b) => b.length - a.length);
};
// Applied to evidence only, never to values used by the execution engine.
export const redactTelemetry = (
  input: unknown,
  secrets: readonly string[] = [],
): unknown => {
  const visit = (value: unknown, depth: number): unknown => {
    if (depth > 100) return "[DEPTH_LIMIT]";
    if (typeof value === "string") {
      let text = value;
      for (const secret of secrets)
        if (secret.length >= 4) text = text.split(secret).join(REDACTED);
      return text
        .replace(/Bearer\s+[^\s"'<>]+/gi, `Bearer ${REDACTED}`)
        .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, `$1${REDACTED}@`);
    }
    if (Array.isArray(value))
      return value.map((item) => visit(item, depth + 1));
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .filter(
            ([key]) => !["__proto__", "constructor", "prototype"].includes(key),
          )
          .map(([key, child]) => [
            key,
            isSecretKey(key) ? REDACTED : visit(child, depth + 1),
          ]),
      );
    return value;
  };
  return visit(input, 0);
};
export const nodeRunSchema = z.strictObject({
  nodeId: z.string().min(1).max(255),
  nodeName: z.string().min(1).max(255),
  type: z.enum([
    "rpa.manualTrigger",
    "rpa.action",
    "rpa.if",
    "rpa.set",
    "rpa.while",
    "rpa.forEach",
    "rpa.noOp",
    "rpa.end",
  ]),
  status: z.enum(["success", "failed"]),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime(),
  outputIndex: z.number().int().min(-1).max(1),
  output: z.unknown().optional(),
  error: z
    .strictObject({ message: z.string(), code: z.string().optional() })
    .optional(),
});
export const nodeEventSchema = z.discriminatedUnion("phase", [
  z.strictObject({
    phase: z.literal("started"),
    executionIndex: z.number().int().min(1).max(100000),
    node: nodeRunSchema.pick({
      nodeId: true,
      nodeName: true,
      type: true,
      startedAt: true,
    }),
  }),
  z.strictObject({
    phase: z.literal("finished"),
    executionIndex: z.number().int().min(1).max(100000),
    node: nodeRunSchema,
  }),
]);
export type FlowNodeEvent = z.infer<typeof nodeEventSchema>;
export type NodeEventListener = (event: FlowNodeEvent) => Promise<void>;
export const artifactSchema = z.strictObject({
  artifact_id: z.uuid(),
  content_type: z.enum(["image/png", "image/jpeg", "image/webp"]),
  byte_length: z.number().int().min(1).max(MAX_ARTIFACT_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  content_base64: z
    .string()
    .min(4)
    .max(Math.ceil(MAX_ARTIFACT_BYTES / 3) * 4)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
});
export type TelemetryArtifact = z.infer<typeof artifactSchema>;
export const telemetryPacketSchema = z.strictObject({
  event_id: z.uuid(),
  uuid_flow_run: z.string().min(1).max(255),
  command_id: z.uuid(),
  lease_token: z.uuid(),
  payload: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("node"), event: nodeEventSchema }),
    z.strictObject({ kind: z.literal("artifact"), artifact: artifactSchema }),
  ]),
});
export type TelemetryPacket = z.infer<typeof telemetryPacketSchema>;
export const runResultSchema = z.strictObject({
  status: z.enum(["success", "failed", "cancelled"]),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime(),
  // Individual node results travel through the persistent telemetry outbox.
  outputs: z.strictObject({
    vars: z.record(z.string(), z.unknown()),
    nodeOutputs: z.record(z.string(), z.unknown()),
    last: z.unknown().optional(),
  }),
  error: z
    .strictObject({
      nodeId: z.string().optional(),
      message: z.string(),
      code: z.string().optional(),
    })
    .optional(),
});
export type RunResult = z.infer<typeof runResultSchema>;
export type RunNodeTrace = FlowNodeRun & { executionIndex: number };
export const runDetailInputSchema = z.strictObject({
  uuid_flow_run: z.string().min(1).max(255),
  after: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(200).default(100),
});
export const artifactInputSchema = z.strictObject({ artifact_id: z.uuid() });
export const metricsInputSchema = z.strictObject({
  days: z.number().int().min(1).max(90).default(7),
});

export const retentionPolicySchema = z.strictObject({
  evidenceDays: z.number().int().min(1).max(365),
  auditDays: z.number().int().min(30).max(3650),
});
export type RetentionPolicy = z.infer<typeof retentionPolicySchema>;
export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  evidenceDays: 30,
  auditDays: 90,
};
export type OperationalMetrics = {
  days: number;
  runs: Array<{
    status: string;
    count: number;
    averageDurationMs: number | null;
  }>;
  nodes: { count: number; failed: number; averageDurationMs: number | null };
  artifacts: { count: number; bytes: number };
};
