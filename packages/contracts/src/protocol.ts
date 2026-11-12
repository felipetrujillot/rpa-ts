import { z } from "zod";
import { pluginInventorySchema } from "./plugins";
import { telemetryPacketSchema, runResultSchema } from "./telemetry";
import { PROTOCOL_VERSION, durableCommandSchema } from "./workflow";
export const MAX_WIRE_MESSAGE_LENGTH = 6_010_000;
const version = { protocolVersion: z.literal(PROTOCOL_VERSION) };
export const leaseSchema = z.strictObject({
  uuid_flow_run: z.string().min(1).max(255),
  lease_token: z.uuid(),
});
export const runReportSchema = leaseSchema.extend({
  command_id: z.uuid(),
  status: z.enum(["running", "success", "failed", "cancelled"]),
  error_message: z.string().max(500).optional(),
  requires_reconciliation: z.boolean().optional(),
  result: runResultSchema.optional(),
});
export type RunReport = z.infer<typeof runReportSchema>;
export const agentSystemMetricsSchema = z.object({
  sampled_at: z.iso.datetime(),
  cpu_usage_percent: z.number().min(0).max(100).nullable(),
  memory_used_bytes: z.number().int().nonnegative(),
  memory_total_bytes: z.number().int().positive(),
  storage_used_bytes: z.number().int().nonnegative().nullable(),
  storage_available_bytes: z.number().int().nonnegative().nullable(),
  storage_total_bytes: z.number().int().positive().nullable(),
});
export type AgentSystemMetrics = z.infer<typeof agentSystemMetricsSchema>;

export const screenshotSchema = z.object({
  image_data_url: z
    .string()
    .max(6_000_000)
    .regex(/^data:image\/(png|jpeg|webp);base64,/),
  captured_at: z.iso.datetime(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  source: z.string().max(80).optional(),
});
export const agentMessageSchema = z.discriminatedUnion("type", [
  z.object({
    ...version,
    type: z.literal("command_ack"),
    command_id: z.uuid(),
    lease_token: z.uuid(),
  }),
  z.object({
    ...version,
    type: z.literal("heartbeat"),
    status: z.enum(["online", "ejecutando"]).optional(),
    lease: leaseSchema.optional(),
    system_metrics: agentSystemMetricsSchema.optional(),
    plugins: pluginInventorySchema.optional(),
  }),
  z.object({
    ...version,
    type: z.literal("event"),
    event: z.literal("flow_run_status"),
    data: runReportSchema,
  }),
  z.object({
    ...version,
    type: z.literal("agent_screenshot"),
    data: screenshotSchema,
  }),
  z.object({
    ...version,
    type: z.literal("agent_error"),
    operation: z.literal("capture_screenshot"),
    message: z.string().max(500),
  }),
  z.strictObject({
    ...version,
    type: z.literal("run_telemetry"),
    data: telemetryPacketSchema,
  }),
]);
export type AgentMessage = z.infer<typeof agentMessageSchema>;
// Wire commands retain the same durable payload fields; kind is conveyed by command.
export const serverMessageSchema = z.union([
  z
    .object({
      ...version,
      type: z.literal("command"),
      command: z.enum(["run_flow", "cancel_flow"]),
      data: z.record(z.string(), z.unknown()),
    })
    .superRefine((message, ctx) => {
      const { uuid_agente_flujo, uuid_flujo, nombre_flujo, ...payload } =
        message.data;
      const command = durableCommandSchema.safeParse({
        ...payload,
        protocolVersion: PROTOCOL_VERSION,
        kind: message.command,
      });
      if (!command.success)
        for (const issue of command.error.issues)
          ctx.addIssue({
            code: "custom",
            path: ["data", ...issue.path],
            message: issue.message,
          });
    }),
  z.object({
    ...version,
    type: z.literal("command"),
    command: z.literal("capture_screenshot"),
    data: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    ...version,
    type: z.literal("command_accepted"),
    data: z.object({ command_id: z.uuid(), lease_token: z.uuid() }),
  }),
  z.object({
    ...version,
    type: z.literal("telemetry_receipt"),
    data: z.object({ event_id: z.uuid() }),
  }),
  z.object({
    ...version,
    type: z.literal("flow_run_receipt"),
    data: z.object({ uuid_flow_run: z.string(), command_id: z.uuid() }),
  }),
  z.object({
    ...version,
    type: z.literal("lease_renewed"),
    data: leaseSchema.extend({ lease_expires_at: z.iso.datetime() }),
  }),
  z.object({
    ...version,
    type: z.literal("ack"),
    data: z.record(z.string(), z.unknown()),
  }),
  z.object({
    ...version,
    type: z.literal("connected"),
    data: z.record(z.string(), z.unknown()),
  }),
  z.object({ ...version, type: z.literal("error"), message: z.string() }),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;

// Common envelope for UI observers. Wire boundaries validate the discriminated schemas above.
export type RobotRealtimeMessage = {
  type?: string;
  command?: string;
  event?: string;
  name?: string;
  kind?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
};
