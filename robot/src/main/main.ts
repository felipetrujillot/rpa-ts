import { OrquestadorScriptAuthorization } from "../automation/scripts/authorization";
import { pluginCompatibility, pinBuiltinPluginRequirements } from "@rpa/contracts";
import { inspectBuiltinPlugins } from "../automation/plugins/inventory";
import { disposeAutomationContext } from "../automation";
import { TelemetryOutbox } from "../automation/execution/telemetry-outbox";
import type { NodeEventListener } from "@rpa/contracts";
import { durableCommandSchema, flowRuntimeSchema } from "@rpa/contracts";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { CuaDriver } from "../automation/drivers/cua-driver";
import {
  CommandJournal,
  type DurableCommand,
} from "../automation/execution/command-journal";
import { RemoteExecutor } from "../automation/execution/remote-executor";
import { currentAgentId } from "./agent-credentials";
import { OrquestadorImageAssets } from "../automation/vision/asset-client";
import { fetchTrpcJson } from "./orquestador-http";
import { ExecutionController } from "../automation/flow/execution-controller";
import {
  assertSecureServerUrl,
  saveAgentCredentials,
  clearAgentCredentials,
  refreshAgentSession,
} from "./agent-credentials";
import { app, shell, BrowserWindow, ipcMain, webContents, Menu, Tray, nativeImage } from "electron";
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import icon from "../../resources/icon.png?asset";
import trayIcon from "../../resources/robotTemplate.png?asset";
import trayIcon2x from "../../resources/robotTemplate@2x.png?asset";
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
  ROBOT_FLOW_VALIDATE_CHANNEL,
  TRPC_FETCH_CHANNEL,
  type RobotActionRunRequest,
  type RobotFlowRunRequest,
  type RobotFlowRunResponse,
  type RobotFlowValidateRequest,
  type RobotFlowValidateResponse,
  type RobotWindowCaptureResponse,
  type TrpcFetchRequest,
  type TrpcFetchResponse,
} from "../ipc";
import {
  createAutomationContext,
  createAutomationRegistry,
  executeFlowDocument,
  validateFlowDocument,
} from "../automation";
import { getSharedPlaywrightRuntime } from "../automation/apps/playwright.runtime";
import { collectSystemMetrics } from "./system-metrics";
import { inspectRobotSetup, requestCuaPermissions } from "./setup";

const orquestadorTrpcUrl =
  process.env.ORQUESTADOR_TRPC_URL ?? "http://localhost:6543/api/trpc";

const orquestadorWsUrl =
  process.env.VITE_ORQUESTADOR_WS_URL ?? "ws://localhost:6543/api/rpa/ws";

const buildRendererCsp = () => {
  const connectSrc = new Set([
    "'self'",
    "ws://localhost:6543",
    "http://localhost:6543",
    "ws://127.0.0.1:6543",
    "http://127.0.0.1:6543",
  ]);

  for (const rawUrl of [orquestadorTrpcUrl, orquestadorWsUrl]) {
    try {
      connectSrc.add(new URL(rawUrl).origin);
    } catch {
      // ignore invalid configured URLs
    }
  }

  return `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src ${Array.from(connectSrc).join(" ")}`;
};

const rendererCsp = buildRendererCsp();

const allowedUrl = assertSecureServerUrl(orquestadorTrpcUrl);
const automationRegistry = createAutomationRegistry();
const scriptAuthorization = new OrquestadorScriptAuthorization({
  trpcUrl: orquestadorTrpcUrl,
  authenticate: async () => (await refreshAgentSession(orquestadorTrpcUrl)).token,
});
const authorizeScriptAction = (actionId: string, signal: AbortSignal) => scriptAuthorization.authorize(actionId, signal);
const imageAssets = new OrquestadorImageAssets({
  trpcUrl: orquestadorTrpcUrl,
  cacheDirectory: join(app.getPath("userData"), "image-assets"),
  authenticate: async () => (await refreshAgentSession(orquestadorTrpcUrl)).token,
});
const executions = new ExecutionController();
let currentCua: CuaDriver | null = null;
const localCua = new CuaDriver("rpa-local");
const stopDrivers = async () => {
  await Promise.all([
    getSharedPlaywrightRuntime().shutdown(),
    currentCua?.shutdown(),
  ]);
};
const stopRun = async (runId: string) => {
  if (executions.cancel(runId, remoteOwner)) await stopDrivers();
};
let remoteOwner = 0;
let remoteExecutor: RemoteExecutor | null = null;
const remote = () =>
  (remoteExecutor ??= new RemoteExecutor(
    new CommandJournal(join(app.getPath("userData"), "execution-journal")),
    (command, onNodeEvent) =>
      runFlowForSender(
        remoteOwner,
        {
          runId: command.uuid_flow_run,
          document: command.document,
          runtime: command.runtime,
        },
        onNodeEvent,
      ),
    stopRun,
    new TelemetryOutbox(
      join(app.getPath("userData"), "telemetry-outbox"),
      () => {
        webContents
          .fromId(remoteOwner)
          ?.send(ROBOT_TELEMETRY_AVAILABLE_CHANNEL);
      },
    ),
  ));
const handleTrusted: typeof ipcMain.handle = (channel, listener) =>
  ipcMain.handle(channel, (event, ...args) => {
    const expected = new URL(
      is.dev && process.env.ELECTRON_RENDERER_URL
        ? process.env.ELECTRON_RENDERER_URL
        : pathToFileURL(join(__dirname, "../renderer/index.html")).href,
    );
    const frame = event.senderFrame;
    if (!frame || frame !== event.sender.mainFrame)
      throw new Error("IPC no autorizado.");
    const actual = new URL(frame.url);
    if (
      actual.origin !== expected.origin ||
      actual.pathname !== expected.pathname
    )
      throw new Error("Origen IPC no autorizado.");
    return listener(event, ...args);
  });
handleTrusted(ROBOT_CREDENTIALS_SAVE_CHANNEL, (_event, credentials) =>
  saveAgentCredentials(credentials, orquestadorTrpcUrl),
);
handleTrusted(ROBOT_CREDENTIALS_CLEAR_CHANNEL, () => clearAgentCredentials());
handleTrusted(ROBOT_SESSION_REFRESH_CHANNEL, () =>
  refreshAgentSession(orquestadorTrpcUrl),
);
handleTrusted(ROBOT_STOP_ALL_CHANNEL, () => executions.stopAll(stopDrivers));
handleTrusted(ROBOT_FLOW_CANCEL_CHANNEL, async (event, runId: string) => {
  if (typeof runId !== "string" || !runId || runId.length > 255)
    throw new Error("ID de ejecución inválido.");
  const active = executions.cancel(runId, event.sender.id);
  if (active) await stopDrivers();
  return { active };
});

const captureDesktopForAdmin = async (): Promise<RobotWindowCaptureResponse> => {
  const cua = new CuaDriver(`rpa-screenshot-${randomUUID()}`);

  try {
    const result = await cua.call("get_desktop_state", {
      max_image_dimension: 1400,
    });
    const images = result.images as
      | Array<{ data?: unknown }>
      | undefined;
    const image = images?.find(
      (candidate) => typeof candidate.data === "string" && candidate.data,
    );

    if (!image || typeof image.data !== "string") {
      throw new Error("CUA no devolvió una captura del escritorio.");
    }

    const bitmap = nativeImage.createFromBuffer(
      Buffer.from(image.data, "base64"),
    );
    if (bitmap.isEmpty()) {
      throw new Error("CUA devolvió una captura de escritorio inválida.");
    }

    const size = bitmap.getSize();
    const jpegBuffer = bitmap.toJPEG(70);
    return {
      image_data_url: `data:image/jpeg;base64,${jpegBuffer.toString("base64")}`,
      captured_at: new Date().toISOString(),
      width: size.width,
      height: size.height,
    };
  } finally {
    await cua.shutdown();
  }
};

const isAllowedTrpcUrl = (rawUrl: string) => {
  try {
    const parsed = new URL(rawUrl);

    return (
      parsed.origin === allowedUrl.origin &&
      (parsed.pathname === "/api/trpc" ||
        parsed.pathname.startsWith("/api/trpc/"))
    );
  } catch {
    return false;
  }
};

const toAllowedTrpcUrl = (rawUrl?: string) => {
  if (!rawUrl) {
    return orquestadorTrpcUrl;
  }

  const parsed = new URL(rawUrl);
  return new URL(
    `${parsed.pathname}${parsed.search}`,
    allowedUrl.origin,
  ).toString();
};

handleTrusted(
  ROBOT_CAPTURE_WINDOW_CHANNEL,
  async (): Promise<RobotWindowCaptureResponse> => {
    return captureDesktopForAdmin();
  },
);

handleTrusted(ROBOT_SYSTEM_METRICS_CHANNEL, () => collectSystemMetrics());

handleTrusted(ROBOT_SETUP_STATUS_CHANNEL, () => inspectRobotSetup());
handleTrusted(ROBOT_SETUP_PERMISSIONS_CHANNEL, () => requestCuaPermissions());
handleTrusted(
  ROBOT_SETUP_OPEN_SETTINGS_CHANNEL,
  async (_event, permission: "accessibility" | "screen-recording") => {
    if (permission !== "accessibility" && permission !== "screen-recording") {
      throw new Error("Permiso no válido.");
    }
    const settingsUrl = process.platform === "darwin"
      ? permission === "accessibility"
        ? "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
        : "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
      : "https://github.com/trycua/cua/tree/main/libs/cua-driver";
    await shell.openExternal(settingsUrl);
  },
);

handleTrusted(ROBOT_ACTIONS_LIST_CHANNEL, async (_event) => {
  const context = createAutomationContext({ authorizeScriptAction,
    cua: localCua,
    imageAssets,
  });

  return {
    actions: await automationRegistry.listActions(context),
    generatedAt: new Date().toISOString(),
    plugins: { sampledAt: new Date().toISOString(), plugins: await inspectBuiltinPlugins() },
  };
});

const localActionContext = createAutomationContext({ authorizeScriptAction, cua: localCua, imageAssets });

handleTrusted(
  ROBOT_ACTIONS_RUN_CHANNEL,
  async (event, request: RobotActionRunRequest) => {
    const context = localActionContext;

    if (executions.busy)
      throw new Error("El escritorio tiene una ejecución activa.");
    const id = randomUUID();
    const signal = executions.begin(id, event.sender.id);
    try {
      return await automationRegistry.execute(
        request.actionId,
        request.input,
        { ...context, signal },
      );
    } finally {
      executions.finish(id);
    }
  },
);

handleTrusted(
  ROBOT_FLOW_VALIDATE_CHANNEL,
  async (
    _event,
    request: RobotFlowValidateRequest,
  ): Promise<RobotFlowValidateResponse> => {
    const context = createAutomationContext({ authorizeScriptAction,
      cua: localCua,
      imageAssets,
    });
    const actions = await automationRegistry.listActions(context);
    const knownActionIds = new Set(actions.map((action) => action.id));

    return validateFlowDocument(request.document, { knownActionIds });
  },
);

const runFlowForSender = async (
  owner: number,
  request: RobotFlowRunRequest,
  onNodeEvent?: NodeEventListener,
): Promise<RobotFlowRunResponse> => {
  request.runtime = flowRuntimeSchema.parse(request.runtime ?? {});
  const cua = new CuaDriver(`rpa-${request.runId || randomUUID()}`);
  const context = createAutomationContext({ authorizeScriptAction,
    cua,
    imageAssets,
  });
  const actions = await automationRegistry.listActions(context);
  const knownActionIds = new Set(actions.map((action) => action.id));

  const validation = validateFlowDocument(request.document, {
    knownActionIds,
  });
  if (validation.normalized) {
    const pinned = pinBuiltinPluginRequirements(validation.normalized);
    const errors = pluginCompatibility(pinned.pluginRequirements ?? [], { sampledAt: new Date().toISOString(), plugins: await inspectBuiltinPlugins() });
    if (errors.length) { validation.ok = false; validation.errors.push(...errors.map((message) => ({ code: "PLUGIN_INCOMPATIBLE", path: "pluginRequirements", message }))); }
  }
  if (!validation.ok || !validation.normalized) {
    const now = new Date().toISOString();
    const details = validation.errors
      .map((error) => `${error.path}: ${error.message}`)
      .join(" | ");

    return {
      status: "failed",
      startedAt: now,
      finishedAt: now,
      nodeRuns: [],
      outputs: {
        vars: {},
        nodeOutputs: {},
      },
      error: {
        code: "INVALID_FLOW_DOCUMENT",
        message: details || "Flow document validation failed.",
      },
    };
  }

  const runId = request.runId || randomUUID();
  const signal = executions.begin(runId, owner);
  currentCua = cua;
  try {
    const result = await executeFlowDocument(
      validation.normalized,
      request.runtime ?? {},
      {
        plugins: { sampledAt: new Date().toISOString(), plugins: await inspectBuiltinPlugins() },
        runAction: (actionId, input) =>
          automationRegistry.execute(actionId, input, { ...context, signal }),
      },
      {
        signal,
        onNodeEvent: onNodeEvent
          ? async (event) => {
              try {
                await onNodeEvent(event);
              } catch (error) {
                throw Object.assign(
                  new Error(
                    `No se pudo persistir la evidencia: ${error instanceof Error ? error.message : String(error)}`,
                  ),
                  { code: "EXECUTION_INTERRUPTED" },
                );
              }
            }
          : undefined,
      },
    );

    if (result.status === "failed" || result.status === "cancelled") {
      await stopDrivers();
    }

    return result;
  } catch (error) {
    await stopDrivers();

    const now = new Date().toISOString();
    const message =
      error instanceof Error
        ? error.message
        : "Flow execution failed unexpectedly.";

    const interrupted =
      (error as { code?: string })?.code === "EXECUTION_INTERRUPTED";
    return {
      status: interrupted ? "failed" : signal.aborted ? "cancelled" : "failed",
      startedAt: now,
      finishedAt: now,
      nodeRuns: [],
      outputs: {
        vars: {},
        nodeOutputs: {},
      },
      error: {
        code: interrupted
          ? "EXECUTION_INTERRUPTED"
          : signal.aborted
            ? "FLOW_CANCELLED"
            : "FLOW_EXECUTION_ERROR",
        message,
      },
    };
  } finally {
    await disposeAutomationContext(context);
    await cua.shutdown();
    currentCua = null;
    executions.finish(runId);
  }
};

handleTrusted(ROBOT_FLOW_RUN_CHANNEL, (event, request: RobotFlowRunRequest) =>
  runFlowForSender(event.sender.id, request),
);
handleTrusted(
  ROBOT_COMMAND_ACCEPT_CHANNEL,
  async (event, command: DurableCommand) => {
    const agent = await currentAgentId();
    command = durableCommandSchema.parse(command);
    if (command.uuid_agente !== agent)
      throw new Error("Comando de otro agente.");
    remoteOwner = event.sender.id;
    const record = await remote().accept(command);
    return { state: record.state };
  },
);
handleTrusted(ROBOT_COMMAND_RUN_CHANNEL, async (_event, id: string) =>
  remote().run(id, await currentAgentId()),
);
handleTrusted(ROBOT_COMMAND_CANCEL_CHANNEL, async (_event, id: string) =>
  remote().cancel(id, await currentAgentId()),
);
handleTrusted(ROBOT_TELEMETRY_LIST_CHANNEL, async () =>
  remote().telemetry!.pending(await currentAgentId()),
);
handleTrusted(
  ROBOT_TELEMETRY_RECEIPT_CHANNEL,
  async (_event, eventId: string) =>
    remote().telemetry!.receipt(eventId, await currentAgentId()),
);
handleTrusted(ROBOT_COMMAND_SNAPSHOT_CHANNEL, async () =>
  remote().snapshot(await currentAgentId()),
);
handleTrusted(ROBOT_COMMAND_RECEIPT_CHANNEL, async (_event, id: string) =>
  remote().journal.receipt(id, await currentAgentId()),
);
handleTrusted(
  ROBOT_COMMAND_RENEW_CHANNEL,
  (_event, runId: string, token: string, expires: string) =>
    remote().renew(runId, token, expires),
);

handleTrusted(
  TRPC_FETCH_CHANNEL,
  async (_event, request: TrpcFetchRequest): Promise<TrpcFetchResponse> => {
    const targetUrl = request.url || orquestadorTrpcUrl;

    if (!isAllowedTrpcUrl(targetUrl)) {
      throw new Error(`Target URL is not allowed: ${targetUrl}`);
    }

    const response = await fetchTrpcJson(toAllowedTrpcUrl(targetUrl), {
      redirect: "error",
      method: request.method ?? "POST",
      headers: request.headers,
      body: request.body,
    });

    return {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body: await response.text(),
    };
  },
);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

function showMainWindow(): void {
  if (quitting) return;
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (mainWindow!.isMinimized()) mainWindow!.restore();
  mainWindow!.show();
  mainWindow!.focus();
}

function createTray(): void {
  const image = process.platform === "darwin"
    ? nativeImage.createFromPath(trayIcon)
    : nativeImage.createFromPath(icon).resize({ width: 16, height: 16 });
  if (process.platform === "darwin") {
    image.addRepresentation({
      scaleFactor: 2,
      dataURL: nativeImage.createFromPath(trayIcon2x).toDataURL(),
    });
    image.setTemplateImage(true);
  }
  tray = new Tray(image);
  tray.setToolTip("Robot RPA — activo en segundo plano");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Abrir robot", click: showMainWindow },
    { type: "separator" },
    { label: "Salir", click: () => app.quit() },
  ]));
  // macOS uses a click to open the context menu; Windows/Linux can reopen directly.
  if (process.platform !== "darwin") tray.on("click", showMainWindow);
  tray.on("double-click", showMainWindow);
}

function createWindow(): void {
  // Create the browser window.
  const window = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === "linux" ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/preload.js"),
      sandbox: false,
      // Heartbeats, lease renewals and reconnects must keep running while hidden.
      backgroundThrottling: false,
    },
  });

  mainWindow = window;
  window.on("ready-to-show", () => {
    if (!quitting) window.show();
  });

  window.on("close", (event) => {
    if (quitting || !tray || tray.isDestroyed()) return;
    event.preventDefault();
    window.hide();
  });
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });

  window.webContents.session.webRequest.onHeadersReceived(
    (details, callback) => {
      if (details.resourceType !== "mainFrame") {
        callback({ responseHeaders: details.responseHeaders });
        return;
      }

      const responseHeaders = { ...(details.responseHeaders ?? {}) };
      delete responseHeaders["content-security-policy"];
      delete responseHeaders["Content-Security-Policy"];
      responseHeaders["Content-Security-Policy"] = [rendererCsp];

      callback({ responseHeaders });
    },
  );

  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler((details) => {
    if (["https:", "http:"].includes(new URL(details.url).protocol))
      void shell.openExternal(details.url);
    return { action: "deny" };
  });

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    window.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    window.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
let quitReady = false;
let quitting = false;
app.on("before-quit", (event) => {
  if (quitReady || !ownsInstance) return;
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  void (async () => {
    try {
      await executions.stopAll(stopDrivers);
      await remoteExecutor?.drain();
      await disposeAutomationContext(localActionContext);
      await localCua.shutdown();
    } catch (error) {
      console.error("No se pudo cerrar limpiamente la ejecución:", error);
    } finally {
      quitReady = true;
      app.quit();
    }
  })();
});
app.on("second-instance", () => {
  showMainWindow();
});
app.on("will-quit", () => {
  tray?.destroy();
  tray = null;
});
app.whenReady().then(() => {
  if (!ownsInstance) return;
  // Set app user model id for windows
  electronApp.setAppUserModelId("com.electron");

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  // IPC test
  ipcMain.on("ping", () => console.log("pong"));

  createTray();
  createWindow();

  app.on("activate", function () {
    showMainWindow();
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
