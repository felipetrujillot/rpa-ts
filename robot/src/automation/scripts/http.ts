import { lookup } from "node:dns/promises";
import { request } from "node:https";
import ipaddr from "ipaddr.js";

export const MAX_SCRIPT_BYTES = 1024 * 1024;
const fail = (message: string) => new Error(`HTTP: ${message}`);

// This policy belongs to the robot's operator, never to a downloaded workflow.
export function scriptAllowedOrigins(
  value = process.env.RPA_SCRIPT_ALLOWED_ORIGINS ?? "",
): Set<string> {
  return new Set(
    value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const url = new URL(part);
        if (
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          url.pathname !== "/" ||
          url.search ||
          url.hash
        )
          throw fail(
            "Configura únicamente orígenes HTTPS, sin rutas ni credenciales.",
          );
        return url.origin;
      }),
  );
}

export function isPublicAddress(address: string): boolean {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}

export type ScriptHttpRequest = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
};

export async function scriptHttpRequest(
  input: ScriptHttpRequest,
  allowedOrigins: Set<string>,
  signal: AbortSignal,
): Promise<unknown> {
  if (!input || typeof input.url !== "string") throw fail("URL inválida.");
  const url = new URL(input.url);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !allowedOrigins.has(url.origin)
  )
    throw fail(
      "Destino no autorizado. Configura RPA_SCRIPT_ALLOWED_ORIGINS en el robot.",
    );
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  signal.throwIfAborted();
  if (
    !addresses.length ||
    addresses.some(({ address }) => !isPublicAddress(address))
  )
    throw fail(
      "Las direcciones locales, privadas y reservadas están bloqueadas.",
    );
  const method = input.method ?? "GET";
  if (!["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].includes(method))
    throw fail("Método no permitido.");
  const headers: Record<string, string> = {};
  if (input.headers !== undefined) {
    if (
      !input.headers ||
      typeof input.headers !== "object" ||
      Array.isArray(input.headers)
    )
      throw fail("Cabeceras inválidas.");
    for (const [key, value] of Object.entries(input.headers)) {
      if (
        typeof value !== "string" ||
        /^(host|connection|content-length|transfer-encoding|upgrade|proxy-.*|te|trailer|expect)$/i.test(
          key,
        )
      )
        throw fail("Cabecera no permitida.");
      headers[key.toLowerCase()] = value;
    }
  }
  if (JSON.stringify(headers).length > 16384)
    throw fail("Cabeceras demasiado grandes.");
  const body =
    input.body === undefined
      ? undefined
      : typeof input.body === "string"
        ? input.body
        : JSON.stringify(input.body);
  if (body && Buffer.byteLength(body) > 256 * 1024)
    throw fail("Cuerpo demasiado grande.");
  if (body && typeof input.body !== "string" && !headers["content-type"])
    headers["content-type"] = "application/json";
  return new Promise((resolve, reject) => {
    // Pin the validated IP. TLS still verifies the original hostname; no second DNS lookup.
    const pinned = addresses[0]!;
    const req = request(
      url,
      {
        method,
        headers,
        signal,
        agent: false,
        family: pinned.family,
        maxHeaderSize: 16384,
        lookup: (_host, _options, callback) =>
          callback(null, pinned.address, pinned.family),
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          res.destroy();
          reject(fail(`Respuesta ${status}. No se siguen redirecciones.`));
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > MAX_SCRIPT_BYTES) {
            res.destroy(fail("Respuesta demasiado grande (máximo 1 MiB)."));
          } else chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("aborted", () => reject(fail("Respuesta interrumpida.")));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          try {
            resolve(JSON.parse(text));
          } catch {
            resolve(text);
          }
        });
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}
