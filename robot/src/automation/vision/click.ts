import { setTimeout as delay } from "node:timers/promises";
import type { AutomationContext, AutomationInput } from "../core/types";
import { CuaDriver, type CuaSnapshot } from "../drivers/cua-driver";
import { findImage } from "./match";
import type { ImageAssets, ImageRegion, ImageSearchOptions } from "./types";

export class ImageClickError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
const invalid = (message: string): never => {
  throw new ImageClickError("VALIDATION_ERROR", message);
};
const number = (
  input: AutomationInput | undefined,
  key: string,
  fallback: number,
  min: number,
  max: number,
  integer = false,
) => {
  const raw = input?.[key] ?? fallback;
  if (
    (typeof raw !== "number" && typeof raw !== "string") ||
    raw === "" ||
    (typeof raw === "string" && !raw.trim())
  )
    return invalid(`${key} debe ser un número.`);
  const value = Number(raw);
  if (
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isSafeInteger(value))
  )
    return invalid(
      `${key} debe estar entre ${min} y ${max}${integer ? " y ser entero" : ""}.`,
    );
  return value;
};
function choice(
  input: AutomationInput | undefined,
  key: string,
  values: string[],
  fallback: string,
) {
  const value = input?.[key] ?? fallback;
  if (typeof value !== "string" || !values.includes(value))
    return invalid(`${key} inválido.`);
  return value;
}
export function imageClickParameters(input: AutomationInput | undefined) {
  const id = input?.assetId;
  if (
    typeof id !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)
  )
    return invalid("Selecciona una imagen de referencia válida.");
  const scope = choice(input, "scope", ["window", "desktop"], "window");
  const target =
    scope === "desktop"
      ? { scope }
      : {
          scope,
          pid: number(input, "pid", 0, 1, Number.MAX_SAFE_INTEGER, true),
          window_id: number(
            input,
            "windowId",
            -1,
            0,
            Number.MAX_SAFE_INTEGER,
            true,
          ),
        };
  const rawScales = input?.scales ?? "0.5,0.67,0.75,1,1.25,1.5,2";
  if (typeof rawScales !== "string")
    return invalid("scales debe ser texto separado por comas.");
  const parts = rawScales.split(",");
  const scales = [...new Set(parts.map((value) => Number(value)))];
  if (
    !parts.length ||
    parts.length > 20 ||
    parts.some((value) => !value.trim()) ||
    scales.some((value) => !Number.isFinite(value) || value < 0.25 || value > 4)
  )
    return invalid("Indica entre 1 y 20 escalas, entre 0.25 y 4.");
  let region: ImageRegion | undefined;
  if (
    input?.region !== undefined &&
    input.region !== "" &&
    input.region !== null
  ) {
    const raw = input.region;
    if (typeof raw !== "object" || Array.isArray(raw))
      return invalid("region debe ser un objeto JSON { x, y, width, height }.");
    region = {
      x: number(raw, "x", -1, 0, 25000000, true),
      y: number(raw, "y", -1, 0, 25000000, true),
      width: number(raw, "width", 0, 1, 25000000, true),
      height: number(raw, "height", 0, 1, 25000000, true),
    };
  }
  return {
    id,
    target,
    options: {
      scales,
      region,
      minSimilarity: number(input, "minSimilarity", 0.9, 0.5, 1),
    } satisfies ImageSearchOptions,
    timeoutMs: number(input, "timeoutMs", 10000, 1000, 60000, true),
    button: choice(input, "button", ["left", "right", "middle"], "left"),
    count: number(input, "count", 1, 1, 3, true),
    delivery_mode: choice(
      input,
      "deliveryMode",
      ["background", "foreground"],
      "background",
    ),
  };
}

export async function clickImage(
  input: AutomationInput | undefined,
  context: AutomationContext,
  match = findImage,
) {
  const params = imageClickParameters(input);
  const driver = context.appContexts?.cua;
  const assets = context.appContexts?.imageAssets as ImageAssets | undefined;
  if (!(driver instanceof CuaDriver) || !assets?.load)
    throw new ImageClickError(
      "ACTION_UNAVAILABLE",
      "Configura CUA y vincula el robot al orquestador para usar imágenes.",
    );
  const signal = context.signal;
  signal?.throwIfAborted();
  const reference = await assets.load(params.id, signal);
  signal?.throwIfAborted();
  const deadline = Date.now() + params.timeoutMs;
  let attempts = 0;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const state = (await driver.call(
      params.target.scope === "desktop"
        ? "get_desktop_state"
        : "get_window_state",
      params.target.scope === "desktop"
        ? { max_image_dimension: 0 }
        : {
            pid: params.target.pid,
            window_id: params.target.window_id,
            max_dimension: 10000,
            include_accessibility_tree: false,
            include_screenshot: true,
          },
    )) as CuaSnapshot;
    signal?.throwIfAborted();
    if (
      !state.images?.[0]?.data ||
      typeof state.capture_id !== "string" ||
      !state.capture_id
    )
      throw new ImageClickError(
        "IMAGE_CAPTURE_UNAVAILABLE",
        "Falta una captura válida con capture_id para buscar la imagen.",
      );
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const matches = await match(
      state.images[0].data,
      reference,
      params.options,
      remaining,
      signal,
    );
    attempts++;
    signal?.throwIfAborted();
    if (Date.now() >= deadline) break;
    if (matches.length > 1)
      throw new ImageClickError(
        "IMAGE_MATCH_AMBIGUOUS",
        "Hay varias coincidencias de la imagen. Usa un recorte más específico o limita la región.",
      );
    const found = matches[0];
    if (found) {
      const x = found.x + found.width / 2,
        y = found.y + found.height / 2;
      // The driver consumes the capture atomically and refuses stale/moved targets.
      const click = await driver.call("click", {
        ...params.target,
        x,
        y,
        capture_id: state.capture_id,
        button: params.button,
        count: params.count,
        delivery_mode: params.delivery_mode,
      });
      return {
        clicked: true,
        assetId: params.id,
        match: found,
        x,
        y,
        attempts,
        capture_id: state.capture_id,
        click,
      };
    }
    await delay(Math.min(200, Math.max(1, deadline - Date.now())), undefined, {
      signal,
    });
  }
  throw new ImageClickError(
    "IMAGE_NOT_FOUND",
    `No apareció una coincidencia única en ${params.timeoutMs} ms.`,
  );
}
