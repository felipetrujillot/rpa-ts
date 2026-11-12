import { z } from "zod";
export const vincularAgenteInputSchema = z.object({
  codigo_vinculacion: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/),
  hostname: z.string().trim().max(255).optional(),
  sistema_operativo: z.string().trim().max(100).optional(),
  sistema_operativo_version: z.string().trim().max(100).optional(),
  arquitectura: z.string().trim().max(50).optional(),
  version_electron: z.string().trim().max(50).optional(),
});
export type VincularAgenteInput = z.input<typeof vincularAgenteInputSchema>;
export const getAgenteFlowRunsInputSchema = z.object({
  uuid_agente: z.string().min(1),
  limit: z.number().int().positive().max(200).optional(),
});
export const getAgenteFlowQueueInputSchema = getAgenteFlowRunsInputSchema;
export const cancelAgenteFlowRunInputSchema = z.object({
  uuid_flow_run: z.string().min(1),
  uuid_agente: z.string().min(1).optional(),
});
export const executeAgenteFlowAssignmentInputSchema = z.object({
  uuid_agente_flujo: z.string().min(1),
  runtimeInput: z.record(z.string(), z.unknown()).optional(),
});
export const runStatusSchema = z.enum([
  "queued",
  "running",
  "cancelling",
  "success",
  "failed",
  "cancelled",
]);
export type RunStatus = z.infer<typeof runStatusSchema>;
export type RobotRunStatus = Exclude<RunStatus, "queued" | "cancelling">;
export type VincularAgenteResponse = {
  status: "ok";
  data: {
    token: string;
    refresh_token: string;
    agente: {
      uuid_agente: string;
      uuid_empresa: string;
      nombre: string;
    };
  };
};

export type DesvincularAgenteResponse = {
  status: "ok";
  data: {
    uuid_agente: string;
    estado: "desvinculado";
  };
};

export type AgenteFlowAssignment = {
  uuid_agente_flujo: string;
  uuid_agente: string;
  uuid_flujo: string;
  uuid_flow_version: string | null;
  cron_expression: string | null;
  schedule_timezone?: string;
  next_scheduled_at?: string | null;
  scheduling_error?: string | null;
  activo: number;
  created_at: string;
  updated_at: string;
  nombre_flujo: string;
  estado_publicacion: "draft" | "published" | "archived";
  version_publicada: number | null;
};

export type ExecuteAgenteFlowAssignmentResponse = {
  status: "ok";
  data: {
    uuid_flow_run: string;
    uuid_agente_flujo: string;
    uuid_agente: string;
    uuid_flujo: string;
    uuid_flow_version: string;
    execution: {
      mode: "agent-linked";
      queueStatus: "queued" | "running";
      dispatch?: {
        dispatched: boolean;
        reason?:
          | "missing-context"
          | "agent-offline"
          | "locked"
          | "already-running"
          | "empty-queue"
          | "send-failed";
        uuid_flow_run?: string;
      };
    };
  };
};

export type FlowRunTraceStatus = RunStatus | "unknown";

export type AgenteFlowRunLog = {
  id?: string;
  level?: "debug" | "info" | "warn" | "error" | string;
  message: string;
  created_at?: string;
  node_id?: string;
  meta?: Record<string, unknown>;
};

export type AgenteFlowRunTrace = {
  uuid_flow_run: string;
  uuid_agente?: string;
  uuid_agente_flujo?: string;
  uuid_flujo?: string;
  nombre_flujo?: string;
  status: FlowRunTraceStatus;
  queue_position?: number | null;
  created_at?: string;
  queued_at?: string;
  started_at?: string;
  finished_at?: string;
  duration_ms?: number | null;
  error_message?: string | null;
  logs?: AgenteFlowRunLog[];
};

export type GetAgenteFlowRunsInput = z.input<
  typeof getAgenteFlowRunsInputSchema
>;

export type GetAgenteFlowQueueInput = z.input<
  typeof getAgenteFlowQueueInputSchema
>;

export type CancelAgenteFlowRunInput = z.input<
  typeof cancelAgenteFlowRunInputSchema
>;

export type CancelAgenteFlowRunResponse = {
  status: "ok";
  data: {
    uuid_flow_run: string;
    cancelled: boolean;
    current_status:
      "queued" | "running" | "cancelling" | "success" | "failed" | "cancelled";
  };
};
