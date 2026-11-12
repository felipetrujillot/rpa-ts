import { scriptSdkDeclarations } from "@rpa/contracts";
// The editor describes the script's capabilities, not the browser or Node environment.
export const scriptEditorLibrary =
  scriptSdkDeclarations() +
  `
/** Datos recibidos en el campo data. Usa una aserción de tipo para describirlos. */
declare const input: unknown;
/** Registra argumentos en la salida del nodo. No incluyas credenciales. */
declare function log(...values: unknown[]): void;
declare const console: {
  log: typeof log;
  info: typeof log;
  warn: typeof log;
  error: typeof log;
};
interface ScriptHttpOptions {
  headers?: Record<string, string>;
}
interface ScriptHttpRequestOptions extends ScriptHttpOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
  body?: unknown;
}
declare const http: {
  /** Consulta un destino HTTPS autorizado por el operador del robot. Devuelve JSON o texto. */
  get<T = unknown>(url: string, options?: ScriptHttpOptions): Promise<T>;
  /** Envía un cuerpo JSON o texto a un destino HTTPS autorizado. */
  post<T = unknown>(url: string, body: unknown, options?: ScriptHttpOptions): Promise<T>;
  /** No sigue redirecciones ni comparte las cookies del navegador. */
  request<T = unknown>(url: string, options?: ScriptHttpRequestOptions): Promise<T>;
};
`;

// Scripts are async function bodies at runtime, so top-level return/await are valid here.
export const scriptDiagnosticCodesToIgnore = [1108, 1375, 1378];
