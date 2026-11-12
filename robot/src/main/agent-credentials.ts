import { app, safeStorage } from "electron";
import { readFile, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { createTRPCUntypedClient, httpLink } from "@trpc/client";
import type { AgentCredentials } from "../ipc";
import { fetchTrpcJson } from "./orquestador-http";

export const assertSecureServerUrl = (url: string) => {
  const endpoint = new URL(url);
  if (
    endpoint.username ||
    endpoint.password ||
    (endpoint.protocol !== "https:" &&
      !(
        endpoint.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)
      ))
  ) {
    throw new Error(
      "El servidor debe utilizar HTTPS; HTTP solo está permitido en localhost.",
    );
  }
  return endpoint;
};

const path = () => join(app.getPath("userData"), "agent-credentials.enc");
export const saveAgentCredentials = async (
  credentials: AgentCredentials,
  url: string,
) => {
  assertSecureServerUrl(url);
  if (
    !credentials ||
    typeof credentials.uuid_agente !== "string" ||
    !/^[a-f0-9]{64}$/.test(credentials.refresh_token)
  )
    throw new Error("Credencial inválida.");
  if (
    !safeStorage.isEncryptionAvailable() ||
    (process.platform === "linux" &&
      safeStorage.getSelectedStorageBackend() === "basic_text")
  ) {
    throw new Error(
      "Configura el almacén seguro del sistema antes de vincular el equipo.",
    );
  }
  const encrypted = safeStorage.encryptString(
    JSON.stringify({ ...credentials, origin: new URL(url).origin }),
  );
  await writeFile(`${path()}.tmp`, encrypted, { mode: 0o600 });
  await rename(`${path()}.tmp`, path());
};
export const currentAgentId = async (): Promise<string> => {
  const credentials = JSON.parse(safeStorage.decryptString(await readFile(path()))) as AgentCredentials;
  if (typeof credentials.uuid_agente !== "string") throw new Error("Credencial inválida.");
  return credentials.uuid_agente;
};
export const clearAgentCredentials = () => rm(path(), { force: true });
export const refreshAgentSession = async (
  url: string,
): Promise<{ token: string }> => {
  const credentials = JSON.parse(
    safeStorage.decryptString(await readFile(path())),
  ) as AgentCredentials & { origin: string };
  const endpoint = assertSecureServerUrl(url);
  if (
    credentials.origin !== endpoint.origin ||
    (endpoint.protocol !== "https:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname))
  ) {
    throw new Error(
      "El servidor cambió o no utiliza HTTPS. Vuelve a vincular con un servidor seguro.",
    );
  }
  const client = createTRPCUntypedClient({
    links: [
      httpLink({
        url,
        fetch: (input, init) => fetchTrpcJson(input, {
          ...init, signal: init?.signal ?? AbortSignal.timeout(10_000),
        }, true),
      }),
    ],
  });
  const response = (await client.mutation(
    "agentes.refreshAgente",
    credentials,
  )) as { token: string };
  if (!response || typeof response.token !== "string")
    throw new Error("Respuesta de sesión inválida.");
  return { token: response.token };
};
