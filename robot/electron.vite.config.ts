import { resolve } from "path";
import { defineConfig } from "electron-vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

const rendererCsp =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://localhost:6543 http://localhost:6543 ws://127.0.0.1:6543 http://127.0.0.1:6543";

const serverEnvironment = {
  "process.env.ORQUESTADOR_TRPC_URL": JSON.stringify(
    process.env.ORQUESTADOR_TRPC_URL ?? "http://localhost:6543/api/trpc",
  ),
  "process.env.VITE_ORQUESTADOR_WS_URL": JSON.stringify(
    process.env.VITE_ORQUESTADOR_WS_URL ?? "ws://localhost:6543/api/rpa/ws",
  ),
};

export default defineConfig({
  main: {
    define: serverEnvironment,
    build: {
      externalizeDeps: { exclude: ["@rpa/contracts"] },
      commonjsOptions: {
        include: [/node_modules/, /packages\/contracts\/dist/],
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: { exclude: ["@rpa/contracts"] },
      commonjsOptions: {
        include: [/node_modules/, /packages\/contracts\/dist/],
      },
    },
  },
  renderer: {
    build: {
      commonjsOptions: {
        include: [/node_modules/, /packages\/contracts\/dist/],
      },
    },
    define: serverEnvironment,
    resolve: {
      alias: {
        "@": resolve("src/renderer/src"),
        "@renderer": resolve("src/renderer/src"),
      },
    },
    server: {
      headers: {
        "Content-Security-Policy": rendererCsp,
      },
    },
    plugins: [vue(), tailwindcss()],
  },
});
