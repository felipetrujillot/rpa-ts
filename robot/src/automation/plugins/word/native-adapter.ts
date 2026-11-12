import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { wordPluginManifest, type PluginInventory } from "@rpa/contracts";
import { WordError, type WordAdapter, type WordRequest, type WordResponse } from "./adapter";
import macSource from "./macos.applescript?raw";
import windowsSource from "./windows.ps1?raw";

export async function inspectWordAvailability(): Promise<PluginInventory["plugins"][number]> {
  let available = process.platform === "darwin" || process.platform === "win32";
  let reason: string | undefined;
  let appVersion: string | undefined;
  if (process.platform === "darwin") {
    try { await access("/Applications/Microsoft Word.app"); } catch { available = false; reason = "Microsoft Word no está instalado en /Applications."; }
    if (available) try { appVersion = (await promisify(execFile)("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleShortVersionString", "/Applications/Microsoft Word.app/Contents/Info.plist"], { timeout: 3000 })).stdout.trim(); } catch { /* Installed, but its version could not be read. */ }
  } else if (process.platform === "win32") {
    try { await promisify(execFile)("reg.exe", ["query", "HKCR\\Word.Application\\CLSID"], { timeout: 3000, windowsHide: true }); }
    catch { available = false; reason = "Word COM no está registrado."; }
  }
  if (!available) reason ??= "Se requiere Word de escritorio en macOS o Windows.";
  return { pluginId: "word", packageVersion: wordPluginManifest.packageVersion, sdkVersion: wordPluginManifest.sdkVersion,
    actions: Object.fromEntries(wordPluginManifest.actions.map((a) => [a.id, a.contractVersion])), platform: process.platform, available, reason,
    capabilities: wordPluginManifest.capabilities, permissions: process.platform === "darwin" ? ["apple-events:com.microsoft.Word"] : ["interactive-desktop", "word-com"], verified: false,
    state: !available ? "unavailable" : process.platform === "darwin" ? "permissions-pending" : "installed", appVersion };
}

export class NativeWordAdapter implements WordAdapter {
  private child?: ChildProcessWithoutNullStreams;
  private directory?: string;
  private invalid = false;
  private buffer = "";
  private pending?: { id: string; resolve: (response: WordResponse) => void; reject: (error: Error) => void };
  private async start() {
    if (this.invalid) throw new WordError("Sesión Word invalidada; requiere reconciliación.", "ACTION_EFFECT_UNCERTAIN", true);
    if (this.child) return;
    if (!["darwin", "win32"].includes(process.platform)) throw new WordError("Plataforma Word no soportada.");
    this.directory = await mkdtemp(join(tmpdir(), "rpa-word-helper-"));
    const file = join(this.directory, process.platform === "darwin" ? "word.applescript" : "word.ps1");
    await writeFile(file, process.platform === "darwin" ? macSource : `\uFEFF${windowsSource}`, { mode: 0o600 });
    const child = spawn(process.platform === "darwin" ? "/usr/bin/osascript" : "powershell.exe", process.platform === "darwin" ? [file] : ["-NoProfile", "-NonInteractive", "-STA", "-File", file], { stdio: "pipe", windowsHide: true });
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      if (Buffer.byteLength(this.buffer) > 2_000_000) { this.fail("Respuesta Word fuera de límites."); return; }
      let end: number;
      while ((end = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
        try {
          const response = JSON.parse(line) as WordResponse;
          if (!this.pending || response.id !== this.pending.id || typeof response.ok !== "boolean" ||
            (!response.ok && !["none", "uncertain"].includes(response.effect ?? "")) ||
            (response.ok && (!response.output || typeof response.output !== "object" || Array.isArray(response.output)))) throw new Error("Respuesta inválida");
          const pending = this.pending; this.pending = undefined; pending.resolve(response);
        } catch { this.fail("Protocolo Word inválido."); }
      }
    });
    child.stderr.on("data", () => {});
    child.on("error", () => this.fail("No se pudo iniciar el auxiliar Word."));
    child.on("exit", () => { if (!this.invalid) this.fail("El auxiliar Word se cerró inesperadamente."); });
  }
  private fail(message: string) {
    const pending = this.pending; this.pending = undefined; this.invalid = true;
    this.child?.kill();
    pending?.reject(new WordError(message, "ACTION_EFFECT_UNCERTAIN", true));
  }
  async request(request: WordRequest, signal?: AbortSignal): Promise<WordResponse> {
    if (signal?.aborted) throw new WordError("Cancelado antes de enviarse.", "WORD_CANCELLED");
    await this.start();
    if (this.pending) throw new WordError("Las solicitudes Word deben serializarse.");
    if (signal?.aborted) throw new WordError("Cancelado antes de enviarse.", "WORD_CANCELLED");
    return new Promise((resolve, reject) => {
      const abort = () => this.fail("Word pudo haber aplicado la operación. Reconcilia el documento antes de reintentar.");
      const timer = setTimeout(abort, Number(request.input.timeoutMs ?? 60000));
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
      this.pending = { id: request.id, resolve: (r) => { cleanup(); resolve(r); }, reject: (e) => { cleanup(); reject(e); } };
      signal?.addEventListener("abort", abort, { once: true });
      this.child!.stdin.write(JSON.stringify(request) + "\n", (error) => { if (error) this.fail("No se pudo entregar la solicitud Word."); });
    });
  }
  async dispose() {
    this.invalid = true;
    const child = this.child;
    if (child && child.exitCode === null && !child.killed) await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { child.kill(); resolve(); }, 2000);
      child.once("exit", () => { clearTimeout(timer); resolve(); }); child.stdin.end();
    });
    if (this.directory) await rm(this.directory, { recursive: true, force: true });
  }
}
