declare global {
  namespace NodeJS {
    interface Process {
      viteDevServers: Record<string, import("vite").ViteDevServer>;
    }
  }
}

import { Plugin } from "vite";

/**
 *
 *
 */
export function pluginHotRestart(command: "reload" | "restart"): Plugin {
  return {
    name: "electron-vite:hot-restart",
    closeBundle() {
      if (command === "reload") {
        for (const server of Object.values(process.viteDevServers)) {
          // Preload scripts hot reload.
          server.ws.send({ type: "full-reload" });
        }
      } else {
        // Main process hot restart.
        // Mirrors restart signaling used by electron-vite templates.
        process.stdin.emit("data", "rs");
      }
    },
  };
}
