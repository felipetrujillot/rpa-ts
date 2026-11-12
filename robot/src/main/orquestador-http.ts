import { setTimeout as delay } from "node:timers/promises";

const unavailable = new Set([502, 503, 504]);

export async function fetchTrpcJson(
  input: string | URL | Request,
  init?: RequestInit,
  retrySessionRefresh = false,
): Promise<Response> {
  const attempts = retrySessionRefresh ? 3 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const response = await fetch(input, { ...init, redirect: "error" });
    if (unavailable.has(response.status) && attempt + 1 < attempts) {
      await response.body?.cancel();
      await delay(750);
      continue;
    }
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (contentType !== "application/json" && !contentType?.endsWith("+json")) {
      // Never include the query string, request body or HTML in diagnostics:
      // they can contain credentials or private application data.
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      await response.body?.cancel();
      throw new Error(
        `El orquestador devolvió ${contentType === "text/html" ? "HTML" : "una respuesta que no es JSON"} (HTTP ${response.status}) en ${url.origin}${url.pathname}. ` +
        (unavailable.has(response.status)
          ? "El servidor no está disponible; el robot volverá a intentar conectarse."
          : "Comprueba que ORQUESTADOR_TRPC_URL apunte a la API /api/trpc y que el orquestador esté iniciado."),
      );
    }
    return response;
  }
  throw new Error("El orquestador no está disponible.");
}
