import { scriptSdkActionIds } from "@rpa/contracts";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { createServer, type ViteDevServer } from "vite";
import vue from "@vitejs/plugin-vue";
import { chromium, type Browser, type Page } from "playwright";
import { resolve } from "node:path";

let server: ViteDevServer;
let browser: Browser;
let page: Page;
const errors: string[] = [];

beforeAll(async () => {
  server = await createServer({
    configFile: false,
    root: resolve("orquestador"),
    plugins: [vue()],
    optimizeDeps: {
      force: true,
      include: [
        "@rpa/contracts",
        "@vue-flow/core",
        "@vue-flow/background",
        "@vue-flow/minimap",
      ],
    },
    esbuild: { tsconfigRaw: { compilerOptions: { target: "ES2020" } } },
    server: {
      host: "127.0.0.1",
      port: 0,
      watch: {
        ignored: ["**/.nuxt/**", "**/.data/**", "**/node_modules/.cache/**"],
      },
    },
  });
  await server.listen();
  browser = await chromium.launch({
    channel: process.env.RPA_BROWSER_CHANNEL || "chrome",
    headless: true,
  });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(8000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") console.log("Browser:", message.text());
  });
  await page.goto(
    `${server.resolvedUrls!.local[0]}tests/fixtures/script-editor.html`,
  );
  try {
    await page.locator(".monaco-editor").waitFor();
  } catch (cause) {
    console.log({ errors, text: await page.locator("body").innerText() });
    throw cause;
  }
}, 60000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

afterEach(async (context) => {
  if (context.task.result?.state === "fail")
    console.log({ errors, text: await page.locator("body").innerText() });
});

async function replaceCode(code: string) {
  await page.getByRole("textbox", { name: /Código TypeScript/ }).focus();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText(code);
  await page.waitForFunction(
    (value) => document.querySelector("output")?.textContent === value,
    code,
    { timeout: 8000 },
  );
}

it("edits scripts, formats, expands and preserves undo history", async () => {
  await replaceCode("const item={a:1,b:2};\nreturn item;");
  await page.getByRole("button", { name: "Formatear", exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector("output")?.textContent?.includes("a: 1"),
  );
  const formatted = await page.getByLabel("Código guardado").textContent();
  await page.getByRole("textbox", { name: /Código TypeScript/ }).focus();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText("\n//nota");
  await page.getByRole("button", { name: "Ampliar editor" }).click();
  expect(
    await page
      .locator("dialog")
      .evaluate((element) => element.matches(":modal")),
  ).toBe(true);
  await page.keyboard.press("Escape");
  expect(
    await page
      .locator("dialog")
      .evaluate((element) => element.matches(":modal")),
  ).toBe(false);
  await page.getByRole("textbox", { name: /Código TypeScript/ }).focus();
  for (
    let i = 0;
    i < 10 &&
    (await page.getByLabel("Código guardado").textContent()) !== formatted;
    i++
  )
    await page.keyboard.press("ControlOrMeta+Z");
  expect(await page.getByLabel("Código guardado").textContent()).toBe(
    formatted,
  );
  await page.getByRole("button", { name: "Reemplazar código" }).click();
  await page.waitForFunction(() =>
    document.querySelector(".view-lines")?.textContent?.includes("123"),
  );
  expect(errors).toEqual([]);
});

it("supports return/await, reports type errors and completes robot APIs", async () => {
  await replaceCode('const value: number = "texto";\nreturn value;');
  await page.getByText("1 aviso", { exact: true }).waitFor();
  await replaceCode("return await Promise.resolve(42);");
  await page.getByText("Sin problemas", { exact: true }).waitFor();
  await replaceCode("const title = document.title;\nreturn title;");
  await page.getByText("1 aviso", { exact: true }).waitFor();
  await replaceCode("http.");
  await page.keyboard.press("Control+Space");
  await page
    .locator(".suggest-widget .monaco-list-row")
    .filter({ hasText: "get" })
    .first()
    .waitFor();
  expect(errors).toEqual([]);
}, 30000);

it("completes SDK methods and validates action arguments and returned types", async () => {
  await replaceCode("rpa.browser.");
  await page.keyboard.press("Control+Space");
  await page
    .locator(".suggest-widget .monaco-list-row")
    .filter({ hasText: "openTab" })
    .first()
    .waitFor();
  await page.keyboard.press("Escape");
  await replaceCode(
    'const tab = await rpa.browser.openTab({ url: "https://example.com" });\nconst id: string = tab.tabId;',
  );
  await page.getByText("Sin problemas", { exact: true }).waitFor();
  await replaceCode(
    "const tab = await rpa.browser.openTab({ url: 42 });\nconst id: number = tab.tabId;",
  );
  await page.getByText("2 avisos", { exact: true }).waitFor();
  expect(errors).toEqual([]);
}, 30000);

it("selects stable data sources and shows dependencies without changing execution order", async () => {
  const url = new URL(page.url());
  url.search = "references";
  await page.goto(url.toString());
  const consumer = page
    .locator(".workflow-node")
    .filter({ has: page.getByText("Saludar", { exact: true }) });
  await consumer.click();
  const panel = page.getByRole("complementary", {
    name: "Configuración del nodo",
  });
  await panel.getByRole("button", { name: "Usar datos del flujo" }).click();
  await panel
    .getByRole("combobox", { name: "Origen de input", exact: true })
    .selectOption("node:source-id");
  await page.waitForFunction(
    () =>
      document.querySelector<HTMLOptionElement>(
        'option[value="node:future-id"]',
      )?.disabled === true,
  );
  await panel
    .getByText("Obtener cliente · resultado", { exact: true })
    .waitFor();
  await page
    .locator(".workflow-node.is-input-source")
    .filter({ hasText: "Obtener cliente" })
    .waitFor();
  await page.getByText("Datos → input", { exact: true }).waitFor();
  await panel.locator(".wf-script-input-context").scrollIntoViewIfNeeded();
  expect(
    await panel.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  if (process.env.RPA_EDITOR_SCREENSHOT)
    await page.screenshot({ path: process.env.RPA_EDITOR_SCREENSHOT });
  await panel.getByText("Ver ejemplo de ejecución", { exact: true }).click();
  await panel.getByRole("button", { name: "Cargar último ejemplo" }).click();
  await panel
    .locator("pre")
    .filter({ hasText: '"nombre": "Felipe"' })
    .waitFor();
  await panel.getByRole("button", { name: "Aplicar cambios" }).click();
  const saved = JSON.parse(
    (await page.getByLabel("Flujo guardado").textContent())!,
  );
  expect(
    saved.workflow.nodes.find(
      (node: { id: string }) => node.id === "consumer-id",
    ).parameters.input.data,
  ).toEqual({ $ref: "nodeOutputs.source-id.result" });
  expect(saved.workflow.connections["Obtener cliente"].main[0]).toEqual([
    { node: "Saludar", type: "main", index: 0 },
  ]);
  expect(
    Object.values(saved.workflow.connections).flatMap((ports) =>
      (ports as { main: unknown[][] }).main.flat(),
    ).length,
  ).toBe(3);
  await page.getByRole("button", { name: "Renombrar origen" }).click();
  await consumer
    .getByText("Entrada: Consultar cliente · resultado", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Insertar paso intermedio" }).click();
  await consumer.click();
  await panel
    .getByText("Consultar cliente · resultado", { exact: true })
    .waitFor();
  expect(
    await panel
      .getByRole("combobox", { name: "Origen de input", exact: true })
      .inputValue(),
  ).toBe("node:source-id");
  await page.getByRole("button", { name: "Eliminar origen" }).click();
  await consumer
    .getByText("Entrada: Referencia sin origen", { exact: true })
    .waitFor();
  await consumer.click();
  await panel
    .getByRole("alert")
    .filter({ hasText: "El paso de origen ya no existe" })
    .waitFor();
  expect(errors).toEqual([]);
}, 30000);

it("edits JSON and reference fields, preserves drafts and reports invalid JSON", async () => {
  const panel = page.getByRole("complementary", {
    name: "Configuración del nodo",
  });
  await panel
    .getByRole("combobox", { name: "Origen de input", exact: true })
    .selectOption("input");
  await panel
    .getByLabel("Campo dentro de los datos (opcional)", { exact: true })
    .fill("cliente");
  await panel.getByText("Ver referencia técnica", { exact: true }).click();
  await panel
    .locator(".wf-reference-details code")
    .filter({ hasText: "input.cliente" })
    .waitFor();
  await panel.getByRole("button", { name: "Escribir JSON" }).click();
  await panel
    .getByLabel("Datos JSON", { exact: true })
    .fill('{"nombre":"Ana"}');
  await panel.getByLabel("Datos JSON", { exact: true }).fill('{"nombre":');
  await panel
    .getByRole("alert")
    .filter({ hasText: "Escribe JSON válido" })
    .waitFor();
  await panel.getByRole("button", { name: "Usar datos del flujo" }).click();
  expect(
    await panel
      .getByLabel("Campo dentro de los datos (opcional)", { exact: true })
      .inputValue(),
  ).toBe("cliente");
  await panel.getByRole("button", { name: "Escribir JSON" }).click();
  expect(
    await panel.getByLabel("Datos JSON", { exact: true }).inputValue(),
  ).toBe('{"nombre":');
  await panel
    .getByLabel("Datos JSON", { exact: true })
    .fill('{"nombre":"Ana"}');
  await panel.getByRole("button", { name: "Aplicar cambios" }).click();
  const saved = JSON.parse(
    (await page.getByLabel("Flujo guardado").textContent())!,
  );
  expect(
    saved.workflow.nodes.find(
      (node: { id: string }) => node.id === "consumer-id",
    ).parameters.input.data,
  ).toEqual({ nombre: "Ana" });
  expect(await page.getByLabel("Cambios pendientes").textContent()).toBe(
    "false",
  );
  expect(errors).toEqual([]);
}, 30000);

it("saves explicit SDK permissions in the script inspector", async () => {
  const panel = page.getByRole("complementary", {
    name: "Configuración del nodo",
  });
  await page
    .locator(".workflow-node")
    .filter({ has: page.getByText("Saludar", { exact: true }) })
    .click();
  await panel.locator(".wf-sdk-permissions > summary").click();
  await panel
    .getByLabel("Buscar acciones del SDK")
    .fill("playwright.browser.openTab");
  await panel
    .getByRole("checkbox", { name: /playwright.browser.openTab/ })
    .check();
  await panel
    .getByRole("button", { name: "Desmarcar todas", exact: true })
    .click();
  expect(
    await panel
      .getByRole("checkbox", { name: /playwright.browser.openTab/ })
      .isChecked(),
  ).toBe(false);
  await panel
    .getByRole("button", { name: "Habilitar todas", exact: true })
    .click();
  expect(
    await panel
      .getByRole("button", { name: "Habilitar todas", exact: true })
      .isDisabled(),
  ).toBe(true);
  await panel.getByRole("button", { name: "Aplicar cambios" }).click();
  const saved = JSON.parse(
    (await page.getByLabel("Flujo guardado").textContent())!,
  );
  expect(
    saved.workflow.nodes.find(
      (node: { id: string }) => node.id === "consumer-id",
    ).parameters.input.allowedActions,
  ).toEqual(["playwright.browser.openTab", "playwright.browser.closeTab"]);
  expect(errors).toEqual([]);
}, 30000);

it("administers SDK grants from the server panel and preserves changes on save failure", async () => {
  const url = new URL(page.url());
  url.search = "policy";
  await page.goto(url.toString());
  await page.getByRole("heading", { name: "Permisos del SDK" }).waitFor();
  const save = page.getByRole("button", {
    name: "Guardar permisos",
    exact: true,
  });
  expect(await save.isDisabled()).toBe(true);
  await page
    .getByRole("textbox", { name: "Buscar acciones autorizables del SDK" })
    .fill("playwright.browser.openTab");
  const action = page.getByRole("checkbox", {
    name: /playwright.browser.openTab/,
  });
  await action.check();
  expect(await page.getByLabel("Política guardada").textContent()).toBe("[]");
  await save.click();
  await page.getByText("Permisos guardados.", { exact: true }).waitFor();
  expect(
    JSON.parse((await page.getByLabel("Política guardada").textContent())!),
  ).toEqual(["playwright.browser.openTab"]);
  await action.uncheck();
  await page.getByRole("button", { name: "Simular error de guardado" }).click();
  await save.click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Servidor no disponible" })
    .waitFor();
  expect(await action.isChecked()).toBe(false);
  expect(await save.isDisabled()).toBe(false);
  expect(
    JSON.parse((await page.getByLabel("Política guardada").textContent())!),
  ).toEqual(["playwright.browser.openTab"]);
  await page.getByRole("button", { name: "Simular error de guardado" }).click();
  await save.click();
  await page.getByText("Permisos guardados.", { exact: true }).waitFor();
  expect(await page.getByLabel("Política guardada").textContent()).toBe("[]");
  await page
    .getByRole("button", { name: "Habilitar todas", exact: true })
    .click();
  expect(
    await page
      .getByRole("button", { name: "Habilitar todas", exact: true })
      .isDisabled(),
  ).toBe(true);
  expect(await page.getByLabel("Política guardada").textContent()).toBe("[]");
  await save.click();
  await page.getByText("Permisos guardados.", { exact: true }).waitFor();
  expect(
    JSON.parse((await page.getByLabel("Política guardada").textContent())!),
  ).toEqual(scriptSdkActionIds);
  await page
    .getByRole("button", { name: "Desmarcar todas", exact: true })
    .click();
  await save.click();
  await page.getByText("Permisos guardados.", { exact: true }).waitFor();
  expect(await page.getByLabel("Política guardada").textContent()).toBe("[]");
  expect(errors).toEqual([]);
}, 30000);
