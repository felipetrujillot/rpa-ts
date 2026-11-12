const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("robot", {
  trpcFetch: (request) => ipcRenderer.invoke("ui:trpc", request),
  saveAgentCredentials: async () => {},
  clearAgentCredentials: async () => {},
  stopAllFlows: () => ipcRenderer.invoke("ui:stop"),
  commandSnapshot: () => ipcRenderer.invoke("ui:snapshot"),
  onTelemetryAvailable: () => () => {},
  // No live socket, credentials, or desktop automation in renderer tests.
  refreshAgentSession: async () => {
    throw new Error("Live sessions disabled in UI tests");
  },
});
