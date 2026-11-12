import { createTRPCUntypedClient, httpBatchLink } from "@trpc/client";

const orquestadorTrpcUrl =
  process.env.ORQUESTADOR_TRPC_URL ?? "http://localhost:6543/api/trpc";

const ORQUESTADOR_TRPC_URL = orquestadorTrpcUrl;
export const AGENTE_TOKEN_STORAGE_KEY = "robot.agente.token";

import type {
  VincularAgenteInput,
  VincularAgenteResponse,
  DesvincularAgenteResponse,
  AgenteFlowAssignment,
  ExecuteAgenteFlowAssignmentResponse,
  AgenteFlowRunTrace,
  GetAgenteFlowRunsInput,
  GetAgenteFlowQueueInput,
  CancelAgenteFlowRunInput,
  CancelAgenteFlowRunResponse,
} from "@rpa/contracts";
export type {
  VincularAgenteInput,
  VincularAgenteResponse,
  DesvincularAgenteResponse,
  AgenteFlowAssignment,
  ExecuteAgenteFlowAssignmentResponse,
  FlowRunTraceStatus,
  AgenteFlowRunLog,
  AgenteFlowRunTrace,
  GetAgenteFlowRunsInput,
  GetAgenteFlowQueueInput,
  CancelAgenteFlowRunInput,
  CancelAgenteFlowRunResponse,
} from "@rpa/contracts";

const normalizeHeaders = (
  headersInit?: HeadersInit,
): Record<string, string> | undefined => {
  if (!headersInit) {
    return undefined;
  }

  const headers = new Headers(headersInit);
  return Object.fromEntries(headers.entries());
};

export const orquestadorTrpc = createTRPCUntypedClient({
  links: [
    httpBatchLink({
      url: ORQUESTADOR_TRPC_URL,
      headers: () => {
        const token = localStorage.getItem(AGENTE_TOKEN_STORAGE_KEY);

        if (!token) {
          return {};
        }

        return {
          authorization: `Bearer ${token}`,
        };
      },
      fetch: async (url, options) => {
        const response = await window.robot.trpcFetch({
          url: String(url),
          method: options?.method,
          headers: normalizeHeaders(options?.headers),
          body:
            typeof options?.body === "string"
              ? options.body
              : options?.body
                ? String(options.body)
                : undefined,
        });

        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      },
    }),
  ],
});

export const vincularAgente = (input: VincularAgenteInput) => {
  return orquestadorTrpc.mutation(
    "agentes.vincularAgente",
    input,
  ) as Promise<VincularAgenteResponse>;
};

export const desvincularAgente = () => {
  return orquestadorTrpc.mutation(
    "agentes.desvincularAgenteCliente",
    {},
  ) as Promise<DesvincularAgenteResponse>;
};

export const getAgenteFlowAssignments = (uuid_agente: string) => {
  return orquestadorTrpc.query("agentes.getAgenteFlowAssignments", {
    uuid_agente,
  }) as Promise<AgenteFlowAssignment[]>;
};

export const executeAgenteFlowAssignment = (
  uuid_agente_flujo: string,
  runtimeInput?: Record<string, unknown>,
) => {
  return orquestadorTrpc.mutation("agentes.executeAgenteFlowAssignment", {
    uuid_agente_flujo,
    runtimeInput,
  }) as Promise<ExecuteAgenteFlowAssignmentResponse>;
};

export const getAgenteFlowRuns = (input: GetAgenteFlowRunsInput) => {
  return orquestadorTrpc.query("agentes.getAgenteFlowRuns", input) as Promise<
    AgenteFlowRunTrace[]
  >;
};

export const getAgenteFlowQueue = (input: GetAgenteFlowQueueInput) => {
  return orquestadorTrpc.query("agentes.getAgenteFlowQueue", input) as Promise<
    AgenteFlowRunTrace[]
  >;
};

export const cancelAgenteFlowRun = (input: CancelAgenteFlowRunInput) => {
  return orquestadorTrpc.mutation(
    "agentes.cancelAgenteFlowRun",
    input,
  ) as Promise<CancelAgenteFlowRunResponse>;
};

export const createAgentSocketTicket = () =>
  orquestadorTrpc.mutation("agentes.createSocketTicket") as Promise<{
    ticket: string;
  }>;

export type AgenteExecutionState = {
  uuid_flow_run: string | null;
  lease_expires_at: string | null;
  requires_reconciliation: number;
};

export const getAgenteExecutionState = (uuid_agente: string) =>
  orquestadorTrpc.query("agentes.getAgenteExecutionState", { uuid_agente }) as Promise<AgenteExecutionState | null>;

export const releaseAgenteReservation = (uuid_agente: string, uuid_flow_run: string) =>
  orquestadorTrpc.mutation("agentes.releaseAgenteReservation", {
    uuid_agente, uuid_flow_run, confirmed_stopped_and_reviewed: true,
  });
