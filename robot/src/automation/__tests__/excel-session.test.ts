import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, writeFile, rm, readdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ExcelSession } from "../plugins/excel/session";
import { ExcelError, type ExcelAdapter, type ExcelRequest, type ExcelResponse } from "../plugins/excel/adapter";
import { preflightXlsx } from "../plugins/excel/xlsx-preflight";
import { AutomationRegistry } from "../core/registry";
const fixture = resolve("tests/desktop/excel/template.xlsx");
const directories: string[] = [];
const sessions: ExcelSession[] = [];
const directory = async () => { const d = await mkdtemp(join(tmpdir(), "excel-test-")); directories.push(d); return d; };
const create = (override?: ExcelAdapter["request"]) => {
  const adapter: ExcelAdapter = {
    request: vi.fn(override ?? (async (r: ExcelRequest): Promise<ExcelResponse> => {
      if (r.action === "excel.workbook.saveAs" || r.action === "excel.worksheet.exportPdf") await writeFile(String(r.input.path), await readFile(fixture));
      return { id: r.id, ok: true, output: { dateSystem: "1900" } };
    })), dispose: vi.fn(async () => {}),
  };
  const session = new ExcelSession(adapter, { workingDirectory: tmpdir() }); sessions.push(session); return { session, adapter };
};
const open = async (session: ExcelSession) => session.execute("excel.workbook.open", { path: fixture }) as Promise<{ workbookId: string; path: string }>;
afterEach(async () => { for (const s of sessions.splice(0)) await s.dispose(); for (const d of directories.splice(0)) await rm(d, { recursive: true, force: true }); });
describe("Excel managed sessions", () => {
  it("opens copies, rejects foreign/stale IDs and preserves template bytes", async () => {
    const source = await readFile(fixture);
    const { session, adapter } = create();
    const b = await open(session);
    expect(b.path).not.toBe(fixture); expect(await readFile(b.path)).toEqual(source);
    await expect(session.execute("excel.worksheet.list", { workbookId: "foreign" })).rejects.toThrow(/no pertenece/);
    await session.execute("excel.range.writeValues", { workbookId: b.workbookId, worksheetId: "Datos", address: "A1:B1", values: [["=1+1", "001"]] });
    expect(vi.mocked(adapter.request).mock.calls.at(-1)![0].input.values).toEqual([["=1+1", "001"]]);
    await session.execute("excel.workbook.close", { workbookId: b.workbookId, saveChanges: false });
    await expect(session.execute("excel.worksheet.list", { workbookId: b.workbookId })).rejects.toThrow(/no pertenece/);
    expect(await readFile(fixture)).toEqual(source);
    const next = await session.execute("excel.workbook.open", { path: resolve("tests/desktop/excel/dates-1904.xlsx") }) as { workbookId: string };
    await expect(session.execute("excel.workbook.saveAs", { workbookId: next.workbookId, path: fixture, overwrite: true })).rejects.toThrow(/plantilla/);
  });
  it("validates before effects, including duplicates, dimensions and pre-cancelled actions", async () => {
    const { session, adapter } = create(); const b = await open(session);
    const calls = vi.mocked(adapter.request).mock.calls.length;
    await expect(open(session)).rejects.toThrow(/ya está administrado/);
    await expect(session.execute("excel.range.writeValues", { workbookId: b.workbookId, worksheetId: "Datos", address: "A1:B2", values: [[1]] })).rejects.toThrow(/dimensiones/);
    const controller = new AbortController(); controller.abort();
    await expect(session.execute("excel.worksheet.list", { workbookId: b.workbookId }, controller.signal)).rejects.toMatchObject({ code: "EXCEL_CANCELLED" });
    expect(adapter.request).toHaveBeenCalledTimes(calls);
  });
  it("serializes concurrent operations and quarantines uncertain effects without retries or cleanup writes", async () => {
    let reject!: (error: Error) => void;
    const { session, adapter } = create(async (r) => {
      if (r.action.endsWith("open")) return { id: r.id, ok: true, output: {} };
      return new Promise((_, no) => { reject = no; });
    });
    const b = await open(session);
    const first = session.execute("excel.range.clear", { workbookId: b.workbookId, worksheetId: "Datos", address: "A1" });
    const second = session.execute("excel.worksheet.list", { workbookId: b.workbookId });
    const firstCheck = expect(first).rejects.toMatchObject({ code: "ACTION_EFFECT_UNCERTAIN" });
    const secondCheck = expect(second).rejects.toMatchObject({ code: "ACTION_EFFECT_UNCERTAIN" });
    await vi.waitFor(() => expect(adapter.request).toHaveBeenCalledTimes(2));
    reject(new ExcelError("timeout", "ACTION_EFFECT_UNCERTAIN", true));
    await Promise.all([firstCheck, secondCheck]);
    await session.dispose(); expect(adapter.request).toHaveBeenCalledTimes(2);
    // Session intentionally preserves the copy for reconciliation; remove it after assertions.
    await rm(join(b.path, ".."), { recursive: true, force: true });
  });
  it("publishes staged saves with explicit overwrite and protects externally changed artifacts", async () => {
    const { session, adapter } = create(); const b = await open(session); const d = await directory(); const path = join(d, "saved.xlsx");
    const result = await session.execute("excel.workbook.saveAs", { workbookId: b.workbookId, path, overwrite: false }) as { path: string; workingPath: string };
    expect(result.path).toBe(await realpath(path)); expect(result.workingPath).not.toBe(path);
    expect(await readFile(path)).toEqual(await readFile(fixture));
    const calls = vi.mocked(adapter.request).mock.calls.length;
    await expect(session.execute("excel.workbook.saveAs", { workbookId: b.workbookId, path, overwrite: false })).rejects.toThrow(/ya existe/);
    expect(adapter.request).toHaveBeenCalledTimes(calls);
    await writeFile(path, "user update");
    await expect(session.execute("excel.workbook.close", { workbookId: b.workbookId, saveChanges: true })).rejects.toThrow(/cambió fuera/);
    await session.execute("excel.workbook.close", { workbookId: b.workbookId, saveChanges: false });
    expect(await readFile(path, "utf8")).toBe("user update");
    expect(await readdir(d)).toEqual(["saved.xlsx"]);
  });
  it("quarantines explicit native partial-write responses", async () => {
    const { session, adapter } = create(async (r) => r.action.endsWith("open") ? { id: r.id, ok: true, output: {} } : { id: r.id, ok: false, effect: "uncertain", error: "Celdas escritas: 2" });
    const b = await open(session);
    await expect(session.execute("excel.range.clear", { workbookId: b.workbookId, worksheetId: "Datos", address: "A1" })).rejects.toMatchObject({ code: "ACTION_EFFECT_UNCERTAIN" });
    await session.dispose(); expect(adapter.request).toHaveBeenCalledTimes(2);
    await rm(join(b.path, ".."), { recursive: true, force: true });
  });
  it("rejects malformed XLSX before launching Excel", async () => {
    const { session, adapter } = create(); const path = join(await directory(), "invalid.xlsx"); await writeFile(path, "not a ZIP");
    await expect(session.execute("excel.workbook.open", { path })).rejects.toThrow(/ZIP/);
    expect(adapter.request).not.toHaveBeenCalled();
    await expect(preflightXlsx(fixture)).resolves.toBeUndefined();
    await expect(preflightXlsx(resolve("tests/desktop/excel/external-links.xlsx"))).rejects.toThrow(/externas/);
  });
  it("registers plugins atomically without leaving partial apps or actions", () => {
    const registry = new AutomationRegistry();
    const action = { id: "test.a", appId: "test", name: "a", description: "a", run: async () => ({ ok: true, message: "ok" }) };
    expect(() => registry.registerApp({ id: "test", name: "test", description: "test", actions: [action, action] })).toThrow(/duplicate/);
    expect(registry.listApps()).toEqual([]); expect(registry.getActionIds()).toEqual([]);
    registry.registerApp({ id: "test", name: "test", description: "test", actions: [action] });
    expect(registry.getActionIds()).toEqual(["test.a"]);
  });
});
