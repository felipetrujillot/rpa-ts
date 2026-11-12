import { describe, expect, it, vi } from "vitest";
import { cuaActionDefinitions, type AutomationInput } from "@rpa/contracts";
import { createAutomationRegistry } from "../index";
import {
  CuaDriver,
  type CuaTool,
  type CuaTransport,
} from "../drivers/cua-driver";

const windowTarget = { pid: 10, windowId: 20 };
const nativeTarget = { pid: 10, window_id: 20 };
const setup = () => {
  const transport = vi.fn<CuaTransport>(async () => ({
    snapshot_id: "s00000001",
    elements: [
      { element_token: "s00000001:1", label: "Nombre", role: "AXTextField" },
    ],
    images: [],
  }));
  return {
    registry: createAutomationRegistry(),
    transport,
    context: { appContexts: { cua: new CuaDriver("test", transport) } },
  };
};
describe("CUA desktop actions", () => {
  it("registers the shared catalog and marks CUA unavailable without its runtime", async () => {
    const { registry, context } = setup();
    const actions = await registry.listActions(context);
    expect(
      actions
        .filter((action) => action.appId === "cua")
        .map((action) => action.id),
    ).toEqual(cuaActionDefinitions.map((action) => action.id));
    expect(
      actions.every(
        (action) =>
          !action.id.startsWith("robotjs.") &&
          action.id !== "robot.window.screenshot",
      ),
    ).toBe(true);
    expect(
      (await registry.execute("cua.cursor.position", {}, {})).errorCode,
    ).toBe("ACTION_UNAVAILABLE");
    expect(
      (
        await registry.execute(
          "puppeteer.page.navigate",
          { url: "https://example.com" },
          {},
        )
      ).errorCode,
    ).toBe("ACTION_UNAVAILABLE");
  });
  const cases: Array<
    [string, AutomationInput, CuaTool, Record<string, unknown>]
  > = [
    [
      "cua.desktop.capture",
      { maxDimension: 1400 },
      "get_desktop_state",
      { max_image_dimension: 1400 },
    ],
    ["cua.desktop.tree", {}, "get_accessibility_tree", {}],
    ["cua.cursor.position", {}, "get_cursor_position", {}],
    ["cua.screen.size", {}, "get_screen_size", {}],
    [
      "cua.cursor.move",
      { ...windowTarget, x: 12, y: 34 },
      "move_cursor",
      {
        target: { kind: "window", ...nativeTarget },
        scope: "window",
        x: 12,
        y: 34,
        delivery_mode: "background",
      },
    ],
    [
      "cua.cursor.move",
      { scope: "desktop", x: 12, y: 34, deliveryMode: "foreground" },
      "move_cursor",
      {
        target: { kind: "desktop", display_id: "primary" },
        scope: "desktop",
        x: 12,
        y: 34,
        delivery_mode: "foreground",
      },
    ],
    [
      "cua.mouse.click",
      { ...windowTarget, x: 12, y: 34, button: "right", count: 2 },
      "click",
      {
        ...nativeTarget,
        scope: "window",
        x: 12,
        y: 34,
        button: "right",
        count: 2,
        delivery_mode: "background",
      },
    ],
    [
      "cua.mouse.click",
      { scope: "desktop", pid: 0, windowId: 0, x: 12, y: 34 },
      "click",
      {
        scope: "desktop",
        x: 12,
        y: 34,
        button: "left",
        count: 1,
        delivery_mode: "background",
      },
    ],
    [
      "cua.mouse.drag",
      {
        ...windowTarget,
        fromX: 10,
        fromY: 20,
        toX: 100,
        toY: 200,
        durationMs: 750,
      },
      "drag",
      {
        ...nativeTarget,
        scope: "window",
        from_x: 10,
        from_y: 20,
        to_x: 100,
        to_y: 200,
        duration_ms: 750,
        button: "left",
        delivery_mode: "background",
      },
    ],
    [
      "cua.mouse.scroll",
      {
        scope: "desktop",
        x: 10,
        y: 20,
        direction: "left",
        amount: 4,
        by: "page",
      },
      "scroll",
      {
        scope: "desktop",
        x: 10,
        y: 20,
        direction: "left",
        amount: 4,
        by: "page",
        delivery_mode: "background",
      },
    ],
    [
      "cua.key.press",
      { ...windowTarget, key: "a", modifiers: "cmd, shift" },
      "press_key",
      {
        ...nativeTarget,
        scope: "window",
        key: "a",
        modifiers: ["cmd", "shift"],
        delivery_mode: "background",
      },
    ],
    [
      "cua.key.press",
      { scope: "desktop", key: "enter", modifiers: ["ctrl"] },
      "press_key",
      {
        scope: "desktop",
        key: "enter",
        modifiers: ["ctrl"],
        delivery_mode: "background",
      },
    ],
    [
      "cua.key.hotkey",
      { ...windowTarget, keys: "cmd, c" },
      "hotkey",
      {
        ...nativeTarget,
        scope: "window",
        keys: ["cmd", "c"],
        delivery_mode: "background",
      },
    ],
    [
      "cua.text.type",
      { scope: "desktop", text: "Hola" },
      "type_text",
      { scope: "desktop", text: "Hola", delivery_mode: "background" },
    ],
    [
      "cua.text.type",
      { ...windowTarget, text: "Hola" },
      "type_text",
      {
        ...nativeTarget,
        scope: "window",
        text: "Hola",
        delivery_mode: "background",
      },
    ],
    ["cua.window.focus", windowTarget, "bring_to_front", nativeTarget],
    [
      "cua.window.setFrame",
      { ...windowTarget, x: -200, y: 20, width: 800, height: 600 },
      "set_window_frame",
      { ...nativeTarget, x: -200, y: 20, width: 800, height: 600 },
    ],
    [
      "cua.window.zoom",
      { ...windowTarget, x1: 10, y1: 20, x2: 100, y2: 200 },
      "zoom",
      { ...nativeTarget, x1: 10, y1: 20, x2: 100, y2: 200 },
    ],
    ["cua.windows.list", {}, "list_windows", {}],
    [
      "cua.windows.list",
      { pid: 10, application: "Editor" },
      "list_windows",
      { pid: 10, app: "Editor" },
    ],
    ["cua.clipboard.read", {}, "clipboard_read", { include_text: false }],
    [
      "cua.clipboard.read",
      { includeText: true },
      "clipboard_read",
      { include_text: true },
    ],
    ["cua.clipboard.write", { value: "" }, "clipboard_write", { text: "" }],
    [
      "cua.clipboard.write",
      {
        format: "image",
        value:
          process.platform === "win32"
            ? "C:\\tmp\\image.png"
            : "/tmp/image.png",
      },
      "clipboard_write",
      {
        image_path:
          process.platform === "win32"
            ? "C:\\tmp\\image.png"
            : "/tmp/image.png",
      },
    ],
  ];
  it.each(cases)(
    "translates %s inputs to the native schema (%#)",
    async (id, input, tool, args) => {
      const { registry, transport, context } = setup();
      expect((await registry.execute(id, input, context)).ok).toBe(true);
      expect(transport).toHaveBeenLastCalledWith(tool, {
        ...args,
        session: "test",
      });
      if (id === "cua.window.zoom")
        expect(transport.mock.calls[0]).toMatchObject([
          "get_window_state",
          nativeTarget,
        ]);
    },
  );
  it.each([
    ["cua.element.doubleClick", {}, "double_click"],
    ["cua.element.setValue", { value: "" }, "set_value"],
    ["cua.text.type", { text: "Hola" }, "type_text"],
  ] as const)("resolves fresh tokens for %s", async (id, input, tool) => {
    const { registry, transport, context } = setup();
    expect(
      (
        await registry.execute(
          id,
          { ...windowTarget, label: "Nombre", ...input },
          context,
        )
      ).ok,
    ).toBe(true);
    expect(transport.mock.calls[0]).toMatchObject([
      "get_window_state",
      nativeTarget,
    ]);
    expect(transport).toHaveBeenLastCalledWith(
      tool,
      expect.objectContaining({
        ...nativeTarget,
        element_token: "s00000001:1",
      }),
    );
  });
  const invalid: Array<[string, AutomationInput]> = [
    ["cua.mouse.click", { x: 0, y: 0 }],
    ["cua.mouse.click", { ...windowTarget, x: null, y: 0 }],
    ["cua.mouse.click", { ...windowTarget, x: " ", y: 0 }],
    ["cua.mouse.click", { ...windowTarget, x: 0, y: Infinity }],
    ["cua.mouse.click", { ...windowTarget, x: 0, y: 0, scope: "active" }],
    ["cua.mouse.click", { ...windowTarget, x: 0, y: 0, button: "other" }],
    ["cua.mouse.click", { ...windowTarget, x: 0, y: 0, count: 0 }],
    ["cua.mouse.scroll", { ...windowTarget, x: 0, y: 0, amount: 51 }],
    [
      "cua.mouse.drag",
      { ...windowTarget, fromX: 0, fromY: 0, toX: 1, toY: 1, durationMs: -1 },
    ],
    [
      "cua.window.setFrame",
      { ...windowTarget, x: 0, y: 0, width: 0, height: 1 },
    ],
    ["cua.window.zoom", { ...windowTarget, x1: 1, y1: 0, x2: 0, y2: 10 }],
    ["cua.key.press", { ...windowTarget, key: "a", modifiers: [true] }],
    ["cua.key.hotkey", { ...windowTarget, keys: "cmd" }],
    ["cua.text.type", { scope: "desktop", label: "Nombre", text: "Hola" }],
    ["cua.clipboard.write", { format: "file", value: "relative.txt" }],
    ["cua.clipboard.read", { includeText: "false" }],
    ["cua.desktop.capture", { maxDimension: -1 }],
    ["cua.menu.invoke", { ...windowTarget, path: "File > > Save" }],
  ];
  it.each(invalid)(
    "refuses invalid %s before calling the driver (%#)",
    async (id, input) => {
      const { registry, transport, context } = setup();
      expect((await registry.execute(id, input, context)).ok).toBe(false);
      expect(transport).not.toHaveBeenCalled();
    },
  );
  it("preserves uncertainty from native actions and never retries", async () => {
    const { registry, transport, context } = setup();
    transport.mockRejectedValueOnce(
      new Error("CUA_DRIVER_UNCERTAIN_OR_UNAVAILABLE: scroll"),
    );
    const result = await registry.execute(
      "cua.mouse.scroll",
      { ...windowTarget, x: 0, y: 0 },
      context,
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("CUA_DRIVER_UNCERTAIN_OR_UNAVAILABLE");
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
