// Trusted worker bootstrap. User code runs only inside QuickJS WASM, never in Node.
const { parentPort, workerData } = require("node:worker_threads");
const ts = require(workerData.typescriptPath);
const { newQuickJSWASMModule, newVariant, RELEASE_SYNC } = require(
  workerData.quickjsPath,
);
const MAX_BYTES = 1024 * 1024;

async function main() {
  const source = `(async function(input) {\n${workerData.code}\n})`;
  const compiled = ts.transpileModule(source, {
    fileName: "script.ts",
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.None,
      strict: true,
      alwaysStrict: false,
    },
    reportDiagnostics: true,
  });
  const errors = (compiled.diagnostics || []).filter(
    (d) => d.category === ts.DiagnosticCategory.Error,
  );
  if (errors.length) {
    const diagnostic = errors[0];
    const position =
      diagnostic.file && diagnostic.start !== undefined
        ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
        : undefined;
    throw new Error(
      `TypeScript${position ? ` línea ${Math.max(1, position.line)}, columna ${position.character + 1}` : ""}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`,
    );
  }
  const engine = await newQuickJSWASMModule(
    newVariant(RELEASE_SYNC, {
      wasmMemory: new WebAssembly.Memory({ initial: 256, maximum: 1024 }),
    }),
  );
  const runtime = engine.newRuntime();
  runtime.setMemoryLimit(32 * 1024 * 1024);
  runtime.setMaxStackSize(512 * 1024);
  runtime.setInterruptHandler(() => Date.now() >= workerData.deadline);
  const vm = runtime.newContext();
  const pending = new Map();
  const logs = [];
  let logBytes = 0;
  let nextId = 0;
  let httpRequests = 0;
  let actionRequests = 0;
  let outcome;
  const expose = (name, fn) => {
    const handle = vm.newFunction(name, fn);
    vm.setProp(vm.global, name, handle);
    handle.dispose();
  };
  expose("__log", (encoded) => {
    const text = vm.getString(encoded);
    logBytes += Buffer.byteLength(text);
    if (logs.length >= 100 || logBytes > 65536)
      throw new Error("Límite de logs excedido.");
    logs.push(JSON.parse(text));
    parentPort.postMessage({ type: "log", entry: logs[logs.length - 1] });
  });
  expose("__finish", (encoded) => {
    const text = vm.getString(encoded);
    if (Buffer.byteLength(text) > MAX_BYTES)
      throw new Error("Resultado demasiado grande (máximo 1 MiB).");
    outcome = { ok: true, result: JSON.parse(text), logs };
  });
  expose("__fail", (error) => {
    const detail = JSON.parse(vm.getString(error));
    outcome = {
      ok: false,
      error: String(detail.message).slice(0, 8192),
      errorCode:
        typeof detail.code === "string" ? detail.code.slice(0, 100) : undefined,
      logs,
    };
  });
  expose("__http", (encoded) => {
    const text = vm.getString(encoded);
    if (
      ++httpRequests > 20 ||
      pending.size >= 4 ||
      Buffer.byteLength(text) > 300 * 1024
    )
      throw new Error("Límite de solicitudes HTTP excedido.");
    const deferred = vm.newPromise();
    ++nextId;
    pending.set(nextId, deferred);
    parentPort.postMessage({
      type: "http",
      id: nextId,
      request: JSON.parse(text),
    });
    return deferred.handle;
  });
  expose("__action", (encoded) => {
    const text = vm.getString(encoded);
    if (
      ++actionRequests > 100 ||
      pending.size >= 4 ||
      Buffer.byteLength(text) > MAX_BYTES
    )
      throw new Error("Límite de acciones SDK excedido.");
    const deferred = vm.newPromise();
    pending.set(++nextId, deferred);
    parentPort.postMessage({
      type: "action",
      id: nextId,
      request: JSON.parse(text),
    });
    return deferred.handle;
  });
  parentPort.on("message", (message) => {
    const deferred = pending.get(message.id);
    if (!deferred) return;
    pending.delete(message.id);
    const value = vm.newString(
      message.error
        ? typeof message.error === "string"
          ? message.error
          : JSON.stringify(message.error)
        : JSON.stringify(message.result ?? null),
    );
    if (message.error) deferred.reject(value);
    else deferred.resolve(value);
    value.dispose();
    deferred.dispose();
  });
  const input = vm.newString(workerData.inputJson);
  vm.setProp(vm.global, "__inputJson", input);
  input.dispose();
  // Strings/JSON are the only values crossing the interpreter boundary.
  const bootstrap = vm.evalCode(
    `
    const log = (...args) => __log(JSON.stringify(args));
    const console = Object.freeze({ log, info: log, warn: log, error: log });
    const http = Object.freeze({
      request: async (url, options = {}) => JSON.parse(await __http(JSON.stringify({ ...options, url }))),
      get: async (url, options = {}) => http.request(url, { ...options, method: "GET" }),
      post: async (url, body, options = {}) => http.request(url, { ...options, method: "POST", body }),
    });
    class RpaActionError extends Error {
      constructor(message, code, actionId) { super(message); this.name = "RpaActionError"; this.code = code; this.actionId = actionId; }
    }
    const executeAction = async (actionId, input = {}) => {
      try { return JSON.parse(await __action(JSON.stringify({ actionId, input }))); }
      catch (cause) {
        let detail;
        try { detail = JSON.parse(String(cause)); } catch { detail = { message: String(cause), code: "SCRIPT_ACTION_FAILED" }; }
        throw new RpaActionError(detail.message, detail.code, actionId);
      }
    };
    const rpa = Object.create(null);
    rpa.version = ${JSON.stringify(workerData.sdkVersion)};
    rpa.actions = { execute: executeAction };
    for (const [path, actionId] of Object.entries(${JSON.stringify(workerData.sdkMethods)})) {
      const parts = path.split("."); let target = rpa;
      for (const part of parts.slice(0, -1)) target = target[part] ||= Object.create(null);
      target[parts[parts.length - 1]] = input => executeAction(actionId, input);
    }
    const freeze = value => { for (const child of Object.values(value)) if (child && typeof child === "object") freeze(child); return Object.freeze(value); };
    freeze(rpa);
    (${compiled.outputText.trim().replace(/;$/, "")})(JSON.parse(__inputJson))
      .then(value => __finish(JSON.stringify(value === undefined ? null : value)))
      .catch(error => __fail(JSON.stringify({ message: String(error) + (error && error.stack ? "\\n" + error.stack : ""), code: error && error.code })));
  `,
    "script.js",
  );
  if (bootstrap.error) {
    const detail = vm.dump(bootstrap.error);
    bootstrap.error.dispose();
    throw new Error(
      `${detail.name || "Error"}: ${detail.message || String(detail)}\n${detail.stack || ""}`,
    );
  }
  bootstrap.value.dispose();
  while (!outcome) {
    if (Date.now() >= workerData.deadline)
      throw new Error("Tiempo máximo de ejecución excedido.");
    const jobs = runtime.executePendingJobs(20);
    if (jobs.error) {
      const detail = vm.dump(jobs.error);
      jobs.error.dispose();
      throw new Error(
        `${detail.name || "Error"}: ${detail.message || String(detail)}\n${detail.stack || ""}`,
      );
    }
    if (!outcome) await new Promise((resolve) => setTimeout(resolve, 2));
  }
  parentPort.postMessage({ type: "done", ...outcome });
  // The owner always terminates this disposable worker, including outstanding promises.
}
main().catch((error) =>
  parentPort.postMessage({
    type: "done",
    ok: false,
    error: String(error.stack || error).slice(0, 8192),
  }),
);
