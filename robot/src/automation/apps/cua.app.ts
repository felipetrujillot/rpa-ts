import { isAbsolute } from "node:path";
import { cuaActionDefinitions } from "@rpa/contracts";
import { recognizeMacText } from "../drivers/macos-vision";
import { clickImage, ImageClickError } from "../vision/click";
import type {
  AutomationAction,
  AutomationApp,
  AutomationContext,
  AutomationInput,
} from "../core/types";
import {
  CuaDriver,
  type CuaElement,
  type CuaTool,
} from "../drivers/cua-driver";

const driver = (context: AutomationContext): CuaDriver => {
  const runtime = context.appContexts?.cua;
  if (!(runtime instanceof CuaDriver))
    throw new Error("CUA no está configurado.");
  return runtime;
};
const required = (
  input: AutomationInput | undefined,
  key: string,
  allowEmpty = false,
): string => {
  const value = input?.[key];
  if (typeof value !== "string" || (!allowEmpty && !value.trim()))
    throw new Error(`Falta ${key}.`);
  return value;
};
const numeric = (
  input: AutomationInput | undefined,
  key: string,
  fallback?: number,
): number => {
  const raw = input?.[key] ?? fallback;
  if (
    (typeof raw !== "number" && typeof raw !== "string") ||
    raw === "" ||
    (typeof raw === "string" && !raw.trim())
  )
    throw new Error(`Falta ${key}.`);
  const value = Number(raw);
  if (!Number.isFinite(value))
    throw new Error(`${key} debe ser un número finito.`);
  return value;
};
const integer = (
  input: AutomationInput | undefined,
  key: string,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
  fallback?: number,
) => {
  const value = numeric(input, key, fallback);
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`${key} debe ser un entero entre ${min} y ${max}.`);
  return value;
};
const choice = (
  input: AutomationInput | undefined,
  key: string,
  values: string[],
  fallback: string,
) => {
  const value = input?.[key] ?? fallback;
  if (typeof value !== "string" || !values.includes(value))
    throw new Error(`${key} inválido: ${values.join(", ")}.`);
  return value;
};
const target = (input: AutomationInput | undefined) => ({
  pid: integer(input, "pid", 1),
  window_id: integer(input, "windowId", 0),
});
const delivery = (input: AutomationInput | undefined) =>
  choice(input, "deliveryMode", ["background", "foreground"], "background");
const scopedTarget = (input: AutomationInput | undefined) =>
  choice(input, "scope", ["window", "desktop"], "window") === "desktop"
    ? { scope: "desktop" as const }
    : { scope: "window" as const, ...target(input) };
const point = (input: AutomationInput | undefined) => ({
  x: numeric(input, "x"),
  y: numeric(input, "y"),
});
const button = (input: AutomationInput | undefined) =>
  choice(input, "button", ["left", "right", "middle"], "left");
const strings = (input: AutomationInput | undefined, key: string): string[] => {
  const value = input?.[key];
  if (value === undefined || value === "") return [];
  const values = typeof value === "string" ? value.split(",") : value;
  if (
    !Array.isArray(values) ||
    values.some((v) => typeof v !== "string" || !v.trim())
  )
    throw new Error(
      `${key} debe ser una lista de textos o texto separado por comas.`,
    );
  return (values as string[]).map((v) => v.trim());
};
const pause = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const selector = (input: AutomationInput | undefined) => {
  const label = input?.labelContains;
  const role = input?.role;
  if (typeof label !== "string" && typeof role !== "string")
    throw new Error("Indica labelContains o role para seleccionar el elemento.");
  const normalizedLabel = typeof label === "string" ? label.trim() : "";
  const normalizedRole = typeof role === "string" ? role.trim() : "";
  if (!normalizedLabel && !normalizedRole)
    throw new Error("Indica labelContains o role para seleccionar el elemento.");
  return {
    ...(normalizedLabel ? { label_contains: normalizedLabel } : {}),
    ...(normalizedRole ? { role: normalizedRole } : {}),
  };
};
const selectElement = (
  elements: CuaElement[],
  input: AutomationInput | undefined,
) => {
  const label = input?.label,
    role = input?.role;
  const found = elements.filter(
    (e) => (!role || e.role === role) && (!label || e.label === label),
  );
  if ((!role && !label) || found.length !== 1)
    throw new Error(
      `El control debe coincidir exactamente una vez; coincidencias: ${found.length}.`,
    );
  return found[0]!;
};
const elementTarget = async (
  input: AutomationInput | undefined,
  context: AutomationContext,
) => {
  const t = target(input);
  const state = await driver(context).snapshot(t.pid, t.window_id);
  return {
    ...t,
    element_token: selectElement(state.elements || [], input).element_token,
  };
};
// Never infer a window or silently fall back to the active app. Desktop scope
// must be explicit. Resolve fresh element tokens immediately before each action.
const textTarget = async (
  input: AutomationInput | undefined,
  context: AutomationContext,
) => {
  const t = scopedTarget(input);
  if (t.scope === "desktop") {
    if (input?.label || input?.role)
      throw new Error("La selección por etiqueta o rol requiere scope window.");
    return t;
  }
  return input?.label || input?.role
    ? { scope: "window", ...(await elementTarget(input, context)) }
    : t;
};
type Handler = (
  input: AutomationInput | undefined,
  context: AutomationContext,
) => Promise<unknown>;
const call =
  (
    tool: CuaTool,
    args: (
      input: AutomationInput | undefined,
    ) => Record<string, unknown> = () => ({}),
  ): Handler =>
  async (input, ctx) =>
    driver(ctx).call(tool, args(input));
const handlers: Record<string, Handler> = {
  "cua.image.click": clickImage,
  "cua.apps.list": call("list_apps"),
  "cua.app.launch": async (input, ctx) => {
    const application = required(input, "application").trim();
    const isBundleId =
      process.platform === "darwin" &&
      /^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/.test(application) &&
      !application.toLowerCase().endsWith(".app");
    const urls =
      input?.urls === undefined || input.urls === ""
        ? undefined
        : strings(input, "urls");
    return driver(ctx).call("launch_app", {
      ...(isBundleId ? { bundle_id: application } : { name: application }),
      urls,
    });
  },
  "cua.windows.list": call("list_windows", (input) => ({
    ...(input?.application ? { app: required(input, "application") } : {}),
    ...(input?.pid !== undefined ? { pid: integer(input, "pid", 1) } : {}),
  })),
  "cua.windows.waitFor": async (input, ctx) => {
    const application = input?.application
      ? required(input, "application").trim()
      : "";
    const pid = input?.pid === undefined ? undefined : integer(input, "pid", 1);
    const titleContains = input?.titleContains
      ? required(input, "titleContains").trim()
      : "";
    if (!application && pid === undefined && !titleContains)
      throw new Error("Indica application, pid o titleContains para buscar la ventana.");
    const timeoutMs = integer(input, "timeoutMs", 0, 30000, 10000);
    const stableSamples = integer(input, "stableSamples", 1, 5, 1);
    const started = Date.now();
    let previousWindowId: number | undefined;
    let consecutive = 0;
    let samples = 0;
    while (true) {
      const listing = await driver(ctx).call("list_windows", {
        ...(application ? { app: application } : {}),
        ...(pid === undefined ? {} : { pid }),
      });
      const windows = listing.windows;
      if (!Array.isArray(windows))
        throw new Error("CUA no devolvió una lista de ventanas válida.");
      samples += 1;
      const window = windows.find((candidate) => {
        if (!candidate || typeof candidate !== "object") return false;
        const row = candidate as Record<string, unknown>;
        return (
          (pid === undefined || row.pid === pid) &&
          (!application ||
            (typeof row.app_name === "string" &&
              row.app_name.toLowerCase().includes(application.toLowerCase()))) &&
          (!titleContains ||
            (typeof row.title === "string" &&
              row.title.toLowerCase().includes(titleContains.toLowerCase())))
        );
      }) as Record<string, unknown> | undefined;
      if (window && typeof window.window_id === "number") {
        consecutive = window.window_id === previousWindowId ? consecutive + 1 : 1;
        previousWindowId = window.window_id;
        if (consecutive >= stableSamples)
          return { found: true, samples, window };
      } else {
        consecutive = 0;
        previousWindowId = undefined;
      }
      const elapsed = Date.now() - started;
      if (elapsed >= timeoutMs) break;
      await pause(Math.min(200, timeoutMs - elapsed));
    }
    throw new Error(`No apareció una ventana coincidente en ${timeoutMs} ms.`);
  },
  "cua.window.capture": async (input, ctx) => {
    const t = target(input);
    return driver(ctx).snapshot(t.pid, t.window_id);
  },
  "cua.element.click": async (input, ctx) => {
    const args = { button: button(input), delivery_mode: delivery(input) };
    return driver(ctx).call("click", {
      ...(await elementTarget(input, ctx)),
      ...args,
    });
  },
  "cua.element.doubleClick": async (input, ctx) => {
    const mode = delivery(input);
    return driver(ctx).call("double_click", {
      ...(await elementTarget(input, ctx)),
      delivery_mode: mode,
    });
  },
  "cua.element.setValue": async (input, ctx) => {
    const value = required(input, "value", true);
    return driver(ctx).call("set_value", {
      ...(await elementTarget(input, ctx)),
      value,
    });
  },
  "cua.text.type": async (input, ctx) => {
    const text = required(input, "text"),
      mode = delivery(input);
    return driver(ctx).call("type_text", {
      ...(await textTarget(input, ctx)),
      text,
      delivery_mode: mode,
    });
  },
  "cua.key.press": call("press_key", (input) => ({
    ...scopedTarget(input),
    key: required(input, "key"),
    modifiers: strings(input, "modifiers"),
    delivery_mode: delivery(input),
  })),
  "cua.key.hotkey": call("hotkey", (input) => {
    const keys = strings(input, "keys");
    if (keys.length < 2)
      throw new Error("El atajo requiere al menos dos teclas.");
    return { ...scopedTarget(input), keys, delivery_mode: delivery(input) };
  }),
  "cua.menu.invoke": call("invoke_menu", (input) => {
    const path = required(input, "path")
      .split(">")
      .map((part) => part.trim());
    if (path.some((part) => !part)) throw new Error("Ruta de menú inválida.");
    return { ...target(input), path };
  }),
  "cua.window.focus": call("bring_to_front", target),
  "cua.window.setFrame": call("set_window_frame", (input) => {
    const width = numeric(input, "width"),
      height = numeric(input, "height");
    if (width < 1 || height < 1)
      throw new Error("Ancho y alto deben ser al menos 1.");
    return { ...target(input), ...point(input), width, height };
  }),
  "cua.window.zoom": async (input, ctx) => {
    const t = target(input);
    const x1 = numeric(input, "x1"),
      y1 = numeric(input, "y1"),
      x2 = numeric(input, "x2"),
      y2 = numeric(input, "y2");
    if (x1 < 0 || y1 < 0 || x2 <= x1 || y2 <= y1)
      throw new Error(
        "La región debe tener ancho y alto positivos y origen no negativo.",
      );
    await driver(ctx).snapshot(t.pid, t.window_id);
    return driver(ctx).call("zoom", { ...t, x1, y1, x2, y2 });
  },
  "cua.desktop.capture": call("get_desktop_state", (input) => ({
    max_image_dimension: integer(
      input,
      "maxDimension",
      0,
      Number.MAX_SAFE_INTEGER,
      0,
    ),
  })),
  "cua.desktop.tree": call("get_accessibility_tree"),
  "cua.screen.size": call("get_screen_size"),
  "cua.cursor.position": call("get_cursor_position"),
  "cua.cursor.move": call("move_cursor", (input) => {
    const t = scopedTarget(input);
    return {
      scope: t.scope,
      target:
        t.scope === "desktop"
          ? { kind: "desktop", display_id: "primary" }
          : { kind: "window", pid: t.pid, window_id: t.window_id },
      ...point(input),
      delivery_mode: delivery(input),
    };
  }),
  "cua.mouse.click": call("click", (input) => ({
    ...scopedTarget(input),
    ...point(input),
    button: button(input),
    count: integer(input, "count", 1, 3, 1),
    delivery_mode: delivery(input),
  })),
  "cua.mouse.drag": call("drag", (input) => ({
    ...scopedTarget(input),
    from_x: numeric(input, "fromX"),
    from_y: numeric(input, "fromY"),
    to_x: numeric(input, "toX"),
    to_y: numeric(input, "toY"),
    duration_ms: integer(input, "durationMs", 0, 10000, 500),
    button: button(input),
    delivery_mode: delivery(input),
  })),
  "cua.mouse.scroll": call("scroll", (input) => ({
    ...scopedTarget(input),
    ...point(input),
    direction: choice(
      input,
      "direction",
      ["up", "down", "left", "right"],
      "down",
    ),
    amount: integer(input, "amount", 1, 50, 3),
    by: choice(input, "by", ["line", "page"], "line"),
    delivery_mode: delivery(input),
  })),
  "cua.clipboard.read": call("clipboard_read", (input) => {
    if (
      input?.includeText !== undefined &&
      typeof input.includeText !== "boolean"
    )
      throw new Error("includeText debe ser booleano.");
    return { include_text: input?.includeText ?? false };
  }),
  "cua.clipboard.write": call("clipboard_write", (input) => {
    const format = choice(input, "format", ["text", "image", "file"], "text"),
      value = required(input, "value", format === "text");
    if (format !== "text" && !isAbsolute(value))
      throw new Error("Se requiere una ruta absoluta.");
    return {
      [format === "text"
        ? "text"
        : format === "image"
          ? "image_path"
          : "file_path"]: value,
    };
  }),
  "cua.window.assertVisualText": async (input, ctx) => {
    const t = target(input),
      expected = required(input, "expected"),
      minimumY = numeric(input, "minimumY", 0);
    if (minimumY < 0 || minimumY > 1) throw new Error("Región inválida.");
    const state = await driver(ctx).snapshot(t.pid, t.window_id);
    const image = state.images?.[0];
    if (!image) throw new Error("Falta captura para comprobar el resultado.");
    const lines = await recognizeMacText(image.data);
    const matched = lines.filter(
      (line) =>
        line.text === expected && line.confidence >= 0.9 && line.y >= minimumY,
    );
    if (matched.length !== 1)
      throw new Error(`OCR no comprobó un resultado único: ${expected}.`);
    return {
      verified: true,
      method: "apple-vision",
      expected,
      observed: matched[0],
      ...state,
    };
  },
  "cua.window.assert": async (input, ctx) => {
    const t = target(input),
      expected = required(input, "expected");
    const state = await driver(ctx).snapshot(t.pid, t.window_id);
    const elements = (state.elements || []).filter(
      (e) =>
        (!input?.label || e.label === input.label) &&
        (!input?.role || e.role === input.role),
    );
    const found = elements.filter(
      (e) => String(e.value ?? "") === expected || e.label === expected,
    );
    if (found.length !== 1)
      throw new Error(`No se comprobó un resultado único igual a ${expected}.`);
    if (!state.images?.length)
      throw new Error("CUA no devolvió captura; falta evidencia visual.");
    return { verified: true, expected, observed: found[0], ...state };
  },
  "cua.window.verify": async (input, ctx) => {
    const t = target(input);
    const predicate = choice(
      input,
      "predicate",
      [
        "windowExists",
        "elementExists",
        "elementValue",
        "elementEnabled",
        "elementSelected",
      ],
      "elementExists",
    );
    const timeoutMs = integer(input, "timeoutMs", 0, 10000, 5000);
    const stableSamples = integer(input, "stableSamples", 1, 5, 2);
    let expect: Record<string, unknown>;
    if (predicate === "windowExists") {
      expect = { window: { exists: true } };
    } else {
      const element: Record<string, unknown> = {
        selector: selector(input),
      };
      if (predicate === "elementExists") element.exists = true;
      if (predicate === "elementValue")
        element.value_equals = required(input, "expectedValue", true);
      if (predicate === "elementEnabled" || predicate === "elementSelected") {
        const expectedState = input?.expectedState ?? true;
        if (typeof expectedState !== "boolean")
          throw new Error("expectedState debe ser booleano.");
        element[predicate === "elementEnabled" ? "enabled" : "selected"] =
          expectedState;
      }
      expect = { element };
    }
    const result = await driver(ctx).call("verify_state", {
      ...t,
      expect: [expect],
      timeout_ms: timeoutMs,
      stable_samples: stableSamples,
    });
    if (result.status !== "satisfied")
      throw new Error(`La comprobación CUA terminó con estado ${String(result.status ?? "desconocido")}.`);
    return { verified: true, ...result };
  },
  "cua.window.visualRegions": async (input, ctx) => {
    const t = target(input);
    const maxRegions = integer(input, "maxRegions", 1, 100, 50);
    const minConfidence = numeric(input, "minConfidence", 0.25);
    if (minConfidence < 0 || minConfidence > 1)
      throw new Error("minConfidence debe estar entre 0 y 1.");
    const snapshot = await driver(ctx).snapshot(t.pid, t.window_id);
    if (typeof snapshot.capture_id !== "string" || !snapshot.capture_id)
      throw new Error("La captura no contiene capture_id para analizar regiones visuales.");
    const regions = await driver(ctx).call("parse_visual_regions", {
      capture_id: snapshot.capture_id,
      options: { max_regions: maxRegions, min_confidence: minConfidence },
    });
    return {
      ...regions,
      capture_id: snapshot.capture_id,
      pid: t.pid,
      window_id: t.window_id,
    };
  },
};
export const cuaApp: AutomationApp = {
  id: "cua",
  name: "CUA Desktop",
  description: "Automatización de escritorio mediante CUA Driver.",
  actions: cuaActionDefinitions.map((definition): AutomationAction => {
    const handler = handlers[definition.id];
    if (!handler) throw new Error(`Falta implementación de ${definition.id}.`);
    return {
      id: definition.id,
      appId: "cua",
      name: definition.name,
      description: definition.description,
      inputFields: definition.inputFields,
      availability: (context) => ({
        available: context.appContexts?.cua instanceof CuaDriver &&
          (definition.id !== "cua.image.click" || !!context.appContexts?.imageAssets),
        unavailableReason: definition.id === "cua.image.click"
          ? "Instala CUA Driver y vincula el robot al orquestador para acceder a las imágenes."
          : "Instala CUA Driver y habilita sus permisos.",
      }),
      run: async (input, context) => {
        try {
          return {
            ok: true,
            message: definition.name,
            output: await handler(input, context),
          };
        } catch (error) {
          return {
            ok: false,
            message: error instanceof Error ? error.message : String(error),
            errorCode: context.signal?.aborted ? "FLOW_CANCELLED" : error instanceof ImageClickError ? error.code : "CUA_ACTION_FAILED",
          };
        }
      },
    };
  }),
};
