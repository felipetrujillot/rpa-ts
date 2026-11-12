import { afterAll, beforeAll, expect, it } from "vitest";
import { _electron, type ElectronApplication, type Page } from "playwright";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

let electron: ElectronApplication;
let page: Page;
let profile: string;
const errors: string[] = [];
const artifacts = process.env.RPA_UI_ARTIFACTS;
async function capture(name: string) {
  if (!artifacts) return;
  await mkdir(artifacts, { recursive: true });
  await page.screenshot({ path: join(artifacts, `${name}.png`) });
}
beforeAll(async () => {
  profile = await mkdtemp(join(tmpdir(), "rpa-library-ui-"));
  const env = { ...process.env, RPA_UI_USER_DATA: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  electron = await _electron.launch({
    args: [resolve("tests/ui/fixtures/main.cjs")],
    env,
  });
  page = await electron.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.waitForLoadState("domcontentloaded");
});
afterAll(async () => {
  await electron?.close();
  if (profile) await rm(profile, { recursive: true, force: true });
});
it("links with Enter, loads the library, searches and keeps inactive flows disabled", async () => {
  await page.getByLabel("Código de vinculación").fill("TEST-1234");
  await capture("link");
  await page.getByLabel("Código de vinculación").press("Enter");
  await page.getByRole("heading", { name: "Descargar facturas" }).waitFor();
  await capture("library");
  await page.getByRole("button", { name: /Conciliar pagos/ }).click();
  expect(
    await page.getByRole("button", { name: "Ejecutar flujo" }).isDisabled(),
  ).toBe(true);
  await page.getByRole("searchbox").fill("sin coincidencias");
  await page
    .getByRole("heading", { name: "No encontramos ese flujo" })
    .waitFor();
  await page.getByRole("searchbox").fill("facturas");
  await page.getByRole("heading", { name: "Descargar facturas" }).waitFor();
  expect(
    await page.getByRole("button", { name: "Ejecutar flujo" }).isEnabled(),
  ).toBe(true);
});
it("queues an execution, filters activity, cancels it and opens its trace", async () => {
  await page.getByRole("button", { name: "Ejecutar flujo" }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Ejecución añadida a la cola." })
    .waitFor();
  await page
    .locator(".sidebar-nav")
    .getByRole("link", { name: /Actividad/ })
    .click();
  await page.getByRole("button", { name: "En curso", exact: true }).click();
  expect(await page.locator(".run-row").count()).toBe(1);
  await capture("activity");
  await page
    .getByRole("button", { name: "Cancelar Descargar facturas" })
    .click();
  await page
    .getByText("No hay ejecuciones en esta vista", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Todas", exact: true }).click();
  await page
    .locator(".run-row")
    .filter({ hasText: "Completado" })
    .getByRole("link", { name: "Ver detalle de ejecución" })
    .click();
  await page
    .getByText("Facturas descargadas correctamente.", { exact: false })
    .waitFor();
  expect(await page.locator("details").first().getAttribute("open")).toBeNull();
  await capture("run-detail");
});
it("shows blocked queue recovery, waits for the deadline and resumes after review", async () => {
  await electron.evaluate(() => {
    (globalThis as any).uiReservation = {
      uuid_flow_run: 'completed-run', requires_reconciliation: 1,
      lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
    };
  });
  await page.locator('.sidebar-nav').getByRole('link', { name: 'Flujos', exact: true }).click();
  await page.getByRole('button', { name: 'Actualizar flujos y actividad' }).click();
  const banner = page.getByRole('region', { name: 'Recuperar cola bloqueada' });
  await banner.waitFor();
  const resume = banner.getByRole('button', { name: 'Reanudar cola' });
  expect(await resume.isDisabled()).toBe(true);
  await banner.getByRole('checkbox').check();
  expect(await resume.isDisabled()).toBe(true);
  await electron.evaluate(() => {
    (globalThis as any).uiReservation.lease_expires_at = new Date(Date.now() - 120_000).toISOString();
  });
  await page.getByRole('button', { name: 'Actualizar flujos y actividad' }).click();
  await expect.poll(() => resume.isEnabled()).toBe(true);
  await banner.getByRole('checkbox').uncheck();
  expect(await resume.isDisabled()).toBe(true);
  await banner.getByRole('checkbox').check();
  await resume.click();
  await banner.waitFor({ state: 'detached' });
  const calls = await electron.evaluate(() => (globalThis as any).uiCalls as string[]);
  expect(calls.indexOf('stopAllFlows')).toBeLessThan(calls.indexOf('agentes.releaseAgenteReservation'));
});
it("restores the linked session, fits desktop window sizes and guards unlinking", async () => {
  await page.reload();
  await page.getByRole("heading", { name: "Descargar facturas" }).waitFor();
  await page
    .locator(".sidebar-nav")
    .getByRole("link", { name: "Flujos", exact: true })
    .click();
  await page.getByRole("heading", { name: "Descargar facturas" }).waitFor();
  const window = await electron.browserWindow(page);
  for (const width of [720, 1440, 900]) {
    await window.evaluate(
      (nativeWindow, width) => nativeWindow.setContentSize(width, 670),
      width,
    );
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(
      await page
        .locator(".flow-detail")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await capture(`library-${width}`);
  }
  await page.getByRole("link", { name: "Ajustes", exact: true }).click();
  await capture("settings");
  await page
    .getByRole("button", { name: "Desvincular robot…", exact: true })
    .click();
  await page.getByRole("button", { name: "Volver", exact: true }).click();
  expect(
    await page.getByText("Robot de prueba", { exact: true }).count(),
  ).toBeGreaterThan(0);
  await page
    .getByRole("button", { name: "Desvincular robot…", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirmar desvinculación" }).click();
  await page.getByLabel("Código de vinculación").waitFor();
  expect(
    await page.evaluate(() => localStorage.getItem("robot.agente.token")),
  ).toBeNull();
  expect(errors).toEqual([]);
});
