import { CuaDriver } from "./automation/drivers/cua-driver";
import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import {
  ROBOT_CAPTURE_WINDOW_CHANNEL,
  ROBOT_ACTIONS_LIST_CHANNEL,
  ROBOT_ACTIONS_RUN_CHANNEL,
  TRPC_FETCH_CHANNEL,
  type RobotActionRunRequest,
  type RobotWindowCaptureResponse,
  type TrpcFetchRequest,
  type TrpcFetchResponse,
} from "./ipc";
import {
  createAutomationContext,
  createAutomationRegistry,
} from "./automation";

const orquestadorTrpcUrl =
  process.env.ORQUESTADOR_TRPC_URL ?? "http://localhost:6543/api/trpc";

const allowedUrl = new URL(orquestadorTrpcUrl);

const automationRegistry = createAutomationRegistry();
const cua = new CuaDriver("rpa-local");
app.on("before-quit", () => {
  void cua.shutdown();
});

const captureWindowForSender = async (
  event: Electron.IpcMainInvokeEvent,
): Promise<RobotWindowCaptureResponse> => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);

  if (!senderWindow) {
    throw new Error("No se encontró ventana activa para capturar screenshot.");
  }

  const image = await senderWindow.capturePage();
  const size = image.getSize();
  const jpegBuffer = image.toJPEG(70);

  return {
    image_data_url: `data:image/jpeg;base64,${jpegBuffer.toString("base64")}`,
    captured_at: new Date().toISOString(),
    width: size.width,
    height: size.height,
  };
};

const isAllowedTrpcUrl = (rawUrl: string) => {
  try {
    const parsed = new URL(rawUrl);

    return (
      parsed.origin === allowedUrl.origin &&
      parsed.pathname.startsWith("/api/trpc")
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

ipcMain.handle(
  ROBOT_CAPTURE_WINDOW_CHANNEL,
  async (event): Promise<RobotWindowCaptureResponse> => {
    return captureWindowForSender(event);
  },
);

ipcMain.handle(
  TRPC_FETCH_CHANNEL,
  async (_event, request: TrpcFetchRequest): Promise<TrpcFetchResponse> => {
    const targetUrl = request.url || orquestadorTrpcUrl;

    if (!isAllowedTrpcUrl(targetUrl)) {
      throw new Error(`Target URL is not allowed: ${targetUrl}`);
    }

    const response = await fetch(toAllowedTrpcUrl(targetUrl), {
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

ipcMain.handle(ROBOT_ACTIONS_LIST_CHANNEL, async (event) => {
  const context = createAutomationContext({
    cua,
  });

  return {
    actions: await automationRegistry.listActions(context),
    generatedAt: new Date().toISOString(),
  };
});

ipcMain.handle(
  ROBOT_ACTIONS_RUN_CHANNEL,
  async (event, request: RobotActionRunRequest) => {
    const context = createAutomationContext({
      cua,
    });

    return automationRegistry.execute(request.actionId, request.input, context);
  },
);

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      sandbox: false,
    },
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on("ready", createWindow);

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
