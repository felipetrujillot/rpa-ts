import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import { cuaActionDefinitions, type AutomationInput } from "@rpa/contracts";
import {
  cuaBinary,
  CuaDriver,
  type CuaTool,
  type CuaTransport,
} from "../../src/automation/drivers/cua-driver";
import { cuaApp } from "../../src/automation/apps/cua.app";
import { AutomationRegistry } from "../../src/automation/core/registry";

type Schema = {
  type?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: Schema;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
};
const validateArguments = (schema: Schema, value: unknown) => {
  if (schema.type === "object") {
    expect(value).toBeTypeOf("object");
    const object = value as Record<string, unknown>;
    for (const key of schema.required ?? []) expect(object).toHaveProperty(key);
    for (const [key, child] of Object.entries(object)) {
      if (schema.additionalProperties === false)
        expect(
          schema.properties,
          `Argumento desconocido: ${key}`,
        ).toHaveProperty(key);
      if (schema.properties?.[key])
        validateArguments(schema.properties[key], child);
    }
  } else if (schema.type === "array") {
    expect(Array.isArray(value)).toBe(true);
    if (schema.items)
      for (const child of value as unknown[])
        validateArguments(schema.items, child);
  } else if (schema.type === "integer") {
    expect(Number.isSafeInteger(value)).toBe(true);
  } else if (schema.type) {
    expect(typeof value).toBe(schema.type);
  }
  if (schema.enum) expect(schema.enum).toContain(value);
  if (schema.minimum !== undefined)
    expect(value as number).toBeGreaterThanOrEqual(schema.minimum);
  if (schema.maximum !== undefined)
    expect(value as number).toBeLessThanOrEqual(schema.maximum);
};
it("el catálogo genera argumentos compatibles con los esquemas del driver instalado sin ejecutar efectos", async () => {
  const schemas = new Map<CuaTool, Schema>();
  const transport: CuaTransport = async (tool, args) => {
    if (!schemas.has(tool)) {
      const description = execFileSync(cuaBinary(), ["describe", tool], {
        encoding: "utf8",
      });
      schemas.set(
        tool,
        JSON.parse(description.split("input_schema:\n")[1]!) as Schema,
      );
    }
    validateArguments(schemas.get(tool)!, JSON.parse(JSON.stringify(args)));
    if (tool === "list_windows")
      return {
        windows: [
          { app_name: "Nombre", title: "Nombre", pid: 10, window_id: 20 },
        ],
      };
    if (tool === "verify_state") return { status: "satisfied", predicates: [] };
    if (tool === "parse_visual_regions") return { regions: [] };
    return {
      capture_id: "capture-1",
      elements: [
        { element_token: "s00000001:1", label: "Nombre", value: "Nombre" },
      ],
      images: [{ data: "png", mimeType: "image/png" }],
    };
  };
  const registry = new AutomationRegistry();
  registry.registerApp(cuaApp);
  const context = {
    appContexts: { cua: new CuaDriver("schema-check", transport) },
  };
  for (const definition of cuaActionDefinitions) {
    // OCR already has a real fixture; the transport here returns no actual image.
    if (["cua.window.assertVisualText", "cua.image.click"].includes(definition.id)) continue;
    for (const scope of "scope" in definition.defaults
      ? ["window", "desktop"]
      : ["window"]) {
      const input = {
        ...definition.defaults,
        pid: 10,
        windowId: 20,
      } as AutomationInput;
      for (const key of [
        "application",
        "label",
        "labelContains",
        "text",
        "key",
        "value",
        "path",
        "expected",
      ])
        if (key in input) input[key] = "Nombre";
      if ("keys" in input) input.keys = "cmd,c";
      if ("scope" in input) input.scope = scope;
      if (scope === "desktop") delete input.label;
      const result = await registry.execute(definition.id, input, context);
      expect(result, `${definition.id}: ${result.message}`).toMatchObject({
        ok: true,
      });
    }
  }
});
it("consulta pantalla, cursor y escritorio mediante las nuevas acciones CUA reales", async () => {
  const driver = new CuaDriver(`rpa-desktop-catalog-${Date.now()}`);
  const registry = new AutomationRegistry();
  registry.registerApp(cuaApp);
  try {
    for (const id of [
      "cua.screen.size",
      "cua.cursor.position",
      "cua.desktop.tree",
      "cua.desktop.capture",
    ]) {
      const result = await registry.execute(
        id,
        { maxDimension: 800 },
        { appContexts: { cua: driver } },
      );
      expect(result, id).toMatchObject({ ok: true });
      expect(result.output).toBeTypeOf("object");
      if (id === "cua.desktop.capture")
        expect(
          (result.output as { images: unknown[] }).images.length,
        ).toBeGreaterThan(0);
    }
  } finally {
    await driver.shutdown();
  }
});
