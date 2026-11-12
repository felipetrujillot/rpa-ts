import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { join } from "node:path";
import { excelPluginManifest } from "@rpa/contracts";
import type { ExcelAdapter, ExcelAvailability, ExcelRequest, ExcelResponse } from "./adapter";
import { ExcelError } from "./adapter";
import macSource from "./macos.jxa?raw";
import windowsSource from "./windows.ps1?raw";

export async function inspectExcelAvailability(): Promise<ExcelAvailability> {
  const platform = process.platform;
  let available = platform === "darwin" || platform === "win32";
  let reason: string | undefined;
  if (platform === "darwin") {
    try { await access("/Applications/Microsoft Excel.app"); } catch { available = false; reason = "Microsoft Excel no está instalado en /Applications."; }
  }
  if (platform === "win32") {
    try { await promisify(execFile)("reg.exe", ["query", "HKCR\\Excel.Application\\CLSID"], { timeout: 3000, windowsHide: true }); }
    catch { available = false; reason = "Microsoft Excel COM no está registrado en este equipo."; }
  }
  if (!available) reason ??= "Excel de escritorio requiere macOS o Windows.";
  return { pluginId: "excel", packageVersion: excelPluginManifest.packageVersion, sdkVersion: excelPluginManifest.sdkVersion,
    actions: Object.fromEntries(excelPluginManifest.actions.map((a) => [a.id, a.contractVersion])), platform, available, reason,
    capabilities: excelPluginManifest.capabilities, permissions: platform === "darwin" ? ["apple-events:com.microsoft.Excel"] : ["interactive-desktop", "excel-com"], verified: false };
}

// One worker per execution. No shell and no interpolation of workbook data into source.
export class NativeExcelAdapter implements ExcelAdapter {
  private child?: ChildProcessWithoutNullStreams;
  private directory?: string;
  private closed = false;
  private pending?: { id: string; resolve: (r: ExcelResponse) => void; reject: (e: Error) => void };
  private buffer = "";
  private async start() {
    if (this.closed) throw new ExcelError("La sesión Excel fue invalidada.");
    if (this.child) return;
    if (process.platform !== "darwin" && process.platform !== "win32") throw new ExcelError("Sistema operativo no soportado.");
    this.directory = await mkdtemp(join(tmpdir(), "rpa-excel-helper-"));
    const file = join(this.directory, process.platform === "darwin" ? "excel.jxa" : "excel.ps1");
    await writeFile(file, process.platform === "darwin" ? macSource : `\uFEFF${windowsSource}`, { mode: 0o600 });
    const child = spawn(process.platform === "darwin" ? "/usr/bin/osascript" : "powershell.exe", process.platform === "darwin" ? ["-l", "JavaScript", file] : ["-NoLogo", "-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-File", file], { stdio: "pipe", windowsHide: true });
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      if (this.buffer.length > 4_000_000) { this.fail("Respuesta Excel fuera de límites."); return; }
      let end: number;
      while ((end = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
        try {
          const response = JSON.parse(line) as ExcelResponse;
          if (!this.pending || !response || response.id !== this.pending.id || typeof response.ok !== "boolean" ||
            (!response.ok && !["none", "uncertain"].includes(response.effect ?? "")) ||
            (response.ok && (!response.output || typeof response.output !== "object" || Array.isArray(response.output)))) throw new Error("Respuesta inválida");
          const pending = this.pending; this.pending = undefined; pending.resolve(response);
        } catch { this.fail("Protocolo del auxiliar Excel inválido."); }
      }
    });
    // Drain diagnostics without exposing workbook contents through logs.
    child.stderr.on("data", () => {});
    child.on("error", () => this.fail("No se pudo iniciar el auxiliar de Excel."));
    child.on("exit", () => { if (!this.closed) this.fail("El auxiliar Excel se cerró inesperadamente."); });
  }
  private fail(message: string) {
    const pending = this.pending; this.pending = undefined;
    this.closed = true; this.child?.kill();
    pending?.reject(new ExcelError(message, "ACTION_EFFECT_UNCERTAIN", true));
  }
  async request(request: ExcelRequest, signal?: AbortSignal): Promise<ExcelResponse> {
    if (signal?.aborted) throw new ExcelError("Operación cancelada antes de enviarse.", "EXCEL_CANCELLED");
    await this.start();
    if (this.pending) throw new ExcelError("Las operaciones Excel deben serializarse.");
    if (signal?.aborted) throw new ExcelError("Operación cancelada antes de enviarse.", "EXCEL_CANCELLED");
    return new Promise((resolve, reject) => {
      const abort = () => this.fail("Excel pudo haber aplicado la operación antes de cancelarse o vencer su tiempo. Revisa el libro antes de reintentar.");
      const timer = setTimeout(abort, Number(request.input.timeoutMs ?? 30000));
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
      this.pending = { id: request.id, resolve: (r) => { cleanup(); resolve(r); }, reject: (e) => { cleanup(); reject(e); } };
      signal?.addEventListener("abort", abort, { once: true });
      this.child!.stdin.write(JSON.stringify(request) + "\n", (error) => { if (error) this.fail("No se pudo entregar la solicitud Excel."); });
    });
  }
  async dispose() {
    this.closed = true;
    const child = this.child;
    if (child && child.exitCode === null && !child.killed) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => { child.kill(); resolve(); }, 2000);
        child.once("exit", () => { clearTimeout(timer); resolve(); });
        child.stdin.end();
      });
    }
    if (this.directory) await rm(this.directory, { recursive: true, force: true });
  }
}
