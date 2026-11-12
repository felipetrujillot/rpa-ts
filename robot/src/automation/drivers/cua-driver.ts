import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type CuaTool =
  | "list_apps"
  | "launch_app"
  | "list_windows"
  | "get_window_state"
  | "click"
  | "type_text"
  | "press_key"
  | "invoke_menu"
  | "double_click"
  | "set_value"
  | "hotkey"
  | "bring_to_front"
  | "set_window_frame"
  | "zoom"
  | "get_desktop_state"
  | "get_accessibility_tree"
  | "get_screen_size"
  | "get_cursor_position"
  | "move_cursor"
  | "drag"
  | "scroll"
  | "clipboard_read"
  | "clipboard_write"
  | "verify_state"
  | "parse_visual_regions"
  | "end_session";
export type CuaElement = {
  element_token: string;
  role?: string;
  label?: string;
  value?: unknown;
};
export type CuaWindow = {
  pid: number;
  window_id: number;
  title?: string;
  app_name?: string;
};
export type CuaSnapshot = {
  snapshot_id?: string;
  capture_id?: string;
  elements?: CuaElement[];
  images: Array<{ data: string; mimeType: string }>;
  [key: string]: unknown;
};
export type CuaTransport = (
  tool: CuaTool,
  args: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

export const cuaBinary = () =>
  process.env.CUA_DRIVER_PATH ||
  (process.platform === "darwin" &&
  existsSync("/Applications/CuaDriver.app/Contents/MacOS/cua-driver")
    ? "/Applications/CuaDriver.app/Contents/MacOS/cua-driver"
    : existsSync(
          join(
            homedir(),
            ".local/bin",
            process.platform === "win32" ? "cua-driver.exe" : "cua-driver",
          ),
        )
      ? join(
          homedir(),
          ".local/bin",
          process.platform === "win32" ? "cua-driver.exe" : "cua-driver",
        )
      : process.platform === "win32"
        ? "cua-driver.exe"
        : "cua-driver");

class CuaToolError extends Error {
  constructor(
    message: string,
    readonly refused: boolean,
    readonly driverCode: unknown,
  ) {
    super(message);
  }
}

export const parseCuaResult = (raw: string): Record<string, unknown> => {
  const envelope = JSON.parse(raw) as Record<string, unknown>;
  const result = (
    envelope.result && typeof envelope.result === "object"
      ? envelope.result
      : envelope
  ) as Record<string, unknown>;
  const content = Array.isArray(result.content)
    ? (result.content as Array<{
        type: string;
        text?: string;
        data?: string;
        mimeType?: string;
      }>)
    : [];
  if (
    result.isError ||
    result.error ||
    result.effect === "refused" ||
    result.ok === false
  )
    throw new CuaToolError(
      content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n") ||
        (typeof result.error === "string"
          ? result.error
          : JSON.stringify(result.error)),
      result.effect === "refused",
      result.error,
    );
  let structured = result.structuredContent as
    Record<string, unknown> | undefined;
  if (!structured) {
    const text = content.find((c) => c.type === "text")?.text;
    if (text?.trim().startsWith("{")) {
      try {
        structured = JSON.parse(text);
      } catch {
        /* Preserve the text alongside images. */
      }
    }
  }
  const merged = { ...result, ...structured };
  const { screenshot_png_b64, ...metadata } = merged;
  const images = content
    .filter((c) => c.type === "image")
    .map((c) => ({ data: c.data, mimeType: c.mimeType }));
  if (typeof screenshot_png_b64 === "string")
    images.push({
      data: screenshot_png_b64,
      mimeType: String(merged.screenshot_mime_type || "image/png"),
    });
  return { ...metadata, images };
};

// Arguments go over stdin, never through a shell or the process command line.
// A timed-out action is uncertain and must not be retried automatically.
export const callCua: CuaTransport = (tool, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(cuaBinary(), ["call", tool], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, CUA_TELEMETRY_ENABLED: "false" },
    });
    let stdout = "";
    let stderr = "";
    let tooLarge = false;
    let timedOut = false;
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.length > 16_000_000) {
        tooLarge = true;
        child.kill();
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 30_000);
    timer.unref();
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code !== 0 || signal || tooLarge || timedOut) {
        // The CLI also reports failures as JSON on stdout with exit code 1.
        // Keep the uncertainty marker: a failed CLI does not prove that no
        // native action was delivered. Never retry automatically here.
        let detail = stderr.trim();
        if (stdout.trim()) {
          try {
            parseCuaResult(stdout);
          } catch (error) {
            // Only explicit refusals and a missing launch target prove that
            // no action occurred. Other failures still require review.
            if (
              code === 1 &&
              !signal &&
              !tooLarge &&
              !timedOut &&
              error instanceof CuaToolError &&
              (error.refused ||
                (tool === "launch_app" &&
                  error.driverCode === "APP_NOT_INSTALLED"))
            ) {
              reject(new Error(`${tool}: ${error.message}`));
              return;
            }
            if (error instanceof Error && !(error instanceof SyntaxError))
              detail ||= error.message;
          }
        }
        reject(
          new Error(
            `CUA_DRIVER_UNCERTAIN_OR_UNAVAILABLE: ${tool}: ${detail || signal || (timedOut ? "tiempo de espera agotado" : tooLarge ? "respuesta demasiado grande" : `código de salida ${code}`)}`,
          ),
        );
        return;
      }
      try {
        resolve(parseCuaResult(stdout));
      } catch (error) {
        reject(
          error instanceof SyntaxError
            ? new Error(
                `CUA_DRIVER_UNCERTAIN_OR_UNAVAILABLE: respuesta inválida: ${error.message}`,
              )
            : error,
        );
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(args));
  });

export class CuaDriver {
  private pending = new Set<Promise<unknown>>();
  private stopped = false;
  private used = false;
  private closing: Promise<void> | null = null;
  constructor(
    readonly session: string,
    private transport: CuaTransport = callCua,
  ) {}
  async call(tool: CuaTool, args: Record<string, unknown> = {}) {
    if (this.stopped && tool !== "end_session")
      throw new Error("CUA_SESSION_STOPPED");
    this.used = true;
    const pending = this.transport(tool, { ...args, session: this.session });
    this.pending.add(pending);
    try {
      return await pending;
    } finally {
      this.pending.delete(pending);
    }
  }
  async snapshot(pid: number, windowId: number): Promise<CuaSnapshot> {
    if (
      !Number.isSafeInteger(pid) ||
      pid <= 0 ||
      !Number.isSafeInteger(windowId) ||
      windowId < 0
    )
      throw new Error("CUA_WINDOW_ID_INVALID");
    const state = await this.call("get_window_state", {
      pid,
      window_id: windowId,
      tree_format: "elements",
      max_elements: 1000,
      max_dimension: 1400,
    });
    return state as CuaSnapshot;
  }
  shutdown(): Promise<void> {
    return (this.closing ??= this.close());
  }
  private async close() {
    this.stopped = true;
    if (!this.used) return;
    await Promise.allSettled([...this.pending]);
    // Do not claim that stopping the CLI undoes actions already delivered to the OS.
    await this.call("end_session").catch(() => {});
  }
}
