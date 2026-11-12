import { contextBridge, ipcRenderer } from "electron";
import { electronAPI } from "@electron-toolkit/preload";
import {
  ROBOT_TELEMETRY_LIST_CHANNEL,
  ROBOT_TELEMETRY_RECEIPT_CHANNEL,
  ROBOT_TELEMETRY_AVAILABLE_CHANNEL,
  ROBOT_COMMAND_ACCEPT_CHANNEL,
  ROBOT_COMMAND_RUN_CHANNEL,
  ROBOT_COMMAND_CANCEL_CHANNEL,
  ROBOT_COMMAND_SNAPSHOT_CHANNEL,
  ROBOT_COMMAND_RECEIPT_CHANNEL,
  ROBOT_COMMAND_RENEW_CHANNEL,
  ROBOT_CAPTURE_WINDOW_CHANNEL,
  ROBOT_SYSTEM_METRICS_CHANNEL,
  ROBOT_SETUP_STATUS_CHANNEL,
  ROBOT_SETUP_PERMISSIONS_CHANNEL,
  ROBOT_SETUP_OPEN_SETTINGS_CHANNEL,
  ROBOT_ACTIONS_LIST_CHANNEL,
  ROBOT_ACTIONS_RUN_CHANNEL,
  ROBOT_FLOW_RUN_CHANNEL,
  ROBOT_FLOW_CANCEL_CHANNEL,
  ROBOT_STOP_ALL_CHANNEL,
  ROBOT_CREDENTIALS_SAVE_CHANNEL,
  ROBOT_CREDENTIALS_CLEAR_CHANNEL,
  ROBOT_SESSION_REFRESH_CHANNEL,
  type AgentCredentials,
  type RobotFlowCancelResponse,
  ROBOT_FLOW_VALIDATE_CHANNEL,
  TRPC_FETCH_CHANNEL,
  type RobotApi,
  type RobotActionRunRequest,
  type RobotActionRunResponse,
  type RobotActionsListResponse,
  type RobotWindowCaptureResponse,
  type RobotFlowRunRequest,
  type RobotFlowRunResponse,
  type RobotFlowValidateRequest,
  type RobotFlowValidateResponse,
  type TrpcFetchRequest,
  type TrpcFetchResponse,
  type RobotSetupStatus,
} from "../ipc";

// Custom APIs for renderer
const api = {};

const robotApi: RobotApi = {
  telemetrySnapshot: () => ipcRenderer.invoke(ROBOT_TELEMETRY_LIST_CHANNEL),
  telemetryReceipt: (eventId) =>
    ipcRenderer.invoke(ROBOT_TELEMETRY_RECEIPT_CHANNEL, eventId),
  onTelemetryAvailable: (listener) => {
    const handler = () => listener();
    ipcRenderer.on(ROBOT_TELEMETRY_AVAILABLE_CHANNEL, handler);
    return () =>
      ipcRenderer.removeListener(ROBOT_TELEMETRY_AVAILABLE_CHANNEL, handler);
  },
  acceptCommand: (command) =>
    ipcRenderer.invoke(ROBOT_COMMAND_ACCEPT_CHANNEL, command),
  runCommand: (id) => ipcRenderer.invoke(ROBOT_COMMAND_RUN_CHANNEL, id),
  cancelCommand: (id) => ipcRenderer.invoke(ROBOT_COMMAND_CANCEL_CHANNEL, id),
  commandSnapshot: () => ipcRenderer.invoke(ROBOT_COMMAND_SNAPSHOT_CHANNEL),
  commandReceipt: (id) => ipcRenderer.invoke(ROBOT_COMMAND_RECEIPT_CHANNEL, id),
  renewCommandLease: (runId, token, expires) =>
    ipcRenderer.invoke(ROBOT_COMMAND_RENEW_CHANNEL, runId, token, expires),
  listActions: () =>
    ipcRenderer.invoke(
      ROBOT_ACTIONS_LIST_CHANNEL,
    ) as Promise<RobotActionsListResponse>,
  runAction: (request: RobotActionRunRequest) =>
    ipcRenderer.invoke(
      ROBOT_ACTIONS_RUN_CHANNEL,
      request,
    ) as Promise<RobotActionRunResponse>,
  validateFlow: (request: RobotFlowValidateRequest) =>
    ipcRenderer.invoke(
      ROBOT_FLOW_VALIDATE_CHANNEL,
      request,
    ) as Promise<RobotFlowValidateResponse>,
  runFlow: (request: RobotFlowRunRequest) =>
    ipcRenderer.invoke(
      ROBOT_FLOW_RUN_CHANNEL,
      request,
    ) as Promise<RobotFlowRunResponse>,
  stopAllFlows: () =>
    ipcRenderer.invoke(ROBOT_STOP_ALL_CHANNEL) as Promise<void>,
  cancelFlow: (runId: string) =>
    ipcRenderer.invoke(
      ROBOT_FLOW_CANCEL_CHANNEL,
      runId,
    ) as Promise<RobotFlowCancelResponse>,
  saveAgentCredentials: (credentials: AgentCredentials) =>
    ipcRenderer.invoke(
      ROBOT_CREDENTIALS_SAVE_CHANNEL,
      credentials,
    ) as Promise<void>,
  clearAgentCredentials: () =>
    ipcRenderer.invoke(ROBOT_CREDENTIALS_CLEAR_CHANNEL) as Promise<void>,
  refreshAgentSession: () =>
    ipcRenderer.invoke(ROBOT_SESSION_REFRESH_CHANNEL) as Promise<{
      token: string;
    }>,
  captureWindowScreenshot: () =>
    ipcRenderer.invoke(
      ROBOT_CAPTURE_WINDOW_CHANNEL,
    ) as Promise<RobotWindowCaptureResponse>,
  getSystemMetrics: () => ipcRenderer.invoke(ROBOT_SYSTEM_METRICS_CHANNEL),
  getSetupStatus: () =>
    ipcRenderer.invoke(ROBOT_SETUP_STATUS_CHANNEL) as Promise<RobotSetupStatus>,
  requestSetupPermissions: () =>
    ipcRenderer.invoke(ROBOT_SETUP_PERMISSIONS_CHANNEL) as Promise<{ output: string }>,
  openSetupSettings: (permission: "accessibility" | "screen-recording") =>
    ipcRenderer.invoke(ROBOT_SETUP_OPEN_SETTINGS_CHANNEL, permission) as Promise<void>,
  trpcFetch: (request: TrpcFetchRequest) =>
    ipcRenderer.invoke(
      TRPC_FETCH_CHANNEL,
      request,
    ) as Promise<TrpcFetchResponse>,
};

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("api", api);
    contextBridge.exposeInMainWorld("robot", robotApi);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI;
  // @ts-ignore (define in dts)
  window.api = api;
  // @ts-ignore (define in dts)
  window.robot = robotApi;
}
