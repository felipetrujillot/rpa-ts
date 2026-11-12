import type { TelemetryPacket } from "./telemetry";
import type { AgentSystemMetrics } from "./protocol";
import type {
  DurableCommand,
  CommandRecord,
  FlowExecutionResult,
  FlowRuntimeContext,
  FlowValidationResult,
} from "./workflow";
import type {
  ActionDescriptor,
  ActionRunResult,
  AutomationInput,
} from "./automation";
export const ROBOT_ACTIONS_LIST_CHANNEL = "robot:actions:list";
export const ROBOT_ACTIONS_RUN_CHANNEL = "robot:actions:run";
export const ROBOT_FLOW_VALIDATE_CHANNEL = "robot:flow:validate";
export const ROBOT_COMMAND_ACCEPT_CHANNEL = "robot:command:accept";
export const ROBOT_COMMAND_RUN_CHANNEL = "robot:command:run";
export const ROBOT_COMMAND_CANCEL_CHANNEL = "robot:command:cancel";
export const ROBOT_COMMAND_SNAPSHOT_CHANNEL = "robot:command:snapshot";
export const ROBOT_COMMAND_RECEIPT_CHANNEL = "robot:command:receipt";
export const ROBOT_COMMAND_RENEW_CHANNEL = "robot:command:renew";
export const ROBOT_STOP_ALL_CHANNEL = "robot:flow:stop-all";
export const ROBOT_FLOW_CANCEL_CHANNEL = "robot:flow:cancel";
export const ROBOT_CREDENTIALS_SAVE_CHANNEL = "robot:credentials:save";
export const ROBOT_CREDENTIALS_CLEAR_CHANNEL = "robot:credentials:clear";
export const ROBOT_SESSION_REFRESH_CHANNEL = "robot:session:refresh";
export type AgentCredentials = { uuid_agente: string; refresh_token: string };
export type RobotFlowCancelResponse = { active: boolean };
export const ROBOT_FLOW_RUN_CHANNEL = "robot:flow:run";
export const TRPC_FETCH_CHANNEL = "orquestador:trpc:fetch";
export const ROBOT_CAPTURE_WINDOW_CHANNEL = "robot:window:capture";
export const ROBOT_SYSTEM_METRICS_CHANNEL = "robot:system:metrics";
export const ROBOT_SETUP_STATUS_CHANNEL = "robot:setup:status";
export const ROBOT_SETUP_PERMISSIONS_CHANNEL = "robot:setup:permissions";
export const ROBOT_SETUP_OPEN_SETTINGS_CHANNEL = "robot:setup:open-settings";

export type RobotActionDescriptor = ActionDescriptor;
export type RobotActionRunResponse = ActionRunResult;

export type RobotActionsListResponse = {
  actions: RobotActionDescriptor[];
  generatedAt: string;
  plugins?: import("./plugins").PluginInventory;
};

export type RobotActionRunRequest = {
  actionId: string;
  input?: AutomationInput;
};

export type RobotFlowValidateRequest = {
  document: unknown;
};

export type RobotFlowValidateResponse = FlowValidationResult;

export type RobotFlowRunRequest = {
  runId?: string;
  document: unknown;
  runtime?: FlowRuntimeContext;
};

export type RobotFlowRunResponse = FlowExecutionResult;

export type TrpcFetchRequest = {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

export type TrpcFetchResponse = {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
};

export type RobotWindowCaptureResponse = {
  image_data_url: string;
  captured_at: string;
  width: number;
  height: number;
};

export type RobotSetupRequirement = {
  id: "cua-driver" | "accessibility" | "screen-recording";
  label: string;
  ready: boolean;
  detail: string;
};

export type RobotSetupStatus = {
  ready: boolean;
  checkedAt: string;
  platform: string;
  driverVersion: string | null;
  requirements: RobotSetupRequirement[];
};

export type RobotApi = {
  telemetrySnapshot: () => Promise<TelemetryPacket[]>;
  telemetryReceipt: (eventId: string) => Promise<void>;
  onTelemetryAvailable: (listener: () => void) => () => void;
  acceptCommand: (
    command: DurableCommand,
  ) => Promise<{ state: CommandRecord["state"] }>;
  runCommand: (id: string) => Promise<FlowExecutionResult>;
  cancelCommand: (id: string) => Promise<void>;
  commandSnapshot: () => Promise<{
    records: CommandRecord[];
    lease?: { uuid_flow_run: string; lease_token: string };
  }>;
  commandReceipt: (id: string) => Promise<void>;
  renewCommandLease: (
    runId: string,
    token: string,
    expires: string,
  ) => Promise<void>;
  listActions: () => Promise<RobotActionsListResponse>;
  runAction: (
    request: RobotActionRunRequest,
  ) => Promise<RobotActionRunResponse>;
  validateFlow: (
    request: RobotFlowValidateRequest,
  ) => Promise<RobotFlowValidateResponse>;
  runFlow: (request: RobotFlowRunRequest) => Promise<RobotFlowRunResponse>;
  stopAllFlows: () => Promise<void>;
  cancelFlow: (runId: string) => Promise<RobotFlowCancelResponse>;
  saveAgentCredentials: (credentials: AgentCredentials) => Promise<void>;
  clearAgentCredentials: () => Promise<void>;
  refreshAgentSession: () => Promise<{ token: string }>;
  captureWindowScreenshot: () => Promise<RobotWindowCaptureResponse>;
  getSystemMetrics: () => Promise<AgentSystemMetrics>;
  getSetupStatus: () => Promise<RobotSetupStatus>;
  requestSetupPermissions: () => Promise<{ output: string }>;
  openSetupSettings: (permission: "accessibility" | "screen-recording") => Promise<void>;
  trpcFetch: (request: TrpcFetchRequest) => Promise<TrpcFetchResponse>;
};

export const ROBOT_TELEMETRY_LIST_CHANNEL = "robot:telemetry:list";
export const ROBOT_TELEMETRY_RECEIPT_CHANNEL = "robot:telemetry:receipt";
export const ROBOT_TELEMETRY_AVAILABLE_CHANNEL = "robot:telemetry:available";
