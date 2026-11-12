import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, realpath, rm, writeFile, link } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createWorkflow, wordPluginManifest } from "@rpa/contracts";
import { WordSession, wordWorkspace } from "../plugins/word/session";
import type { WordAdapter, WordRequest } from "../plugins/word/adapter";
import { AutomationRegistry } from "../core/registry";
import { wordApp } from "../apps/word.app";
import { executeFlowDocument } from "../flow/runner";
const sessions: WordSession[] = [], directories: string[] = [];
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "word-unit-")); directories.push(directory);
  const path = join(directory, "source.docx"); await writeFile(path, "disposable bytes; native adapter simulated");
  let body = "{{cliente.nombre}} / {{items.0}} / {{cliente.nombre}}\r";
  const adapter: WordAdapter = { request: vi.fn(async (r: WordRequest) => {
    if (r.action === "word.document.readText") return { id: r.id, ok: true, output: { text: body } };
    if (r.action === "word.document.close") return { id: r.id, ok: true, output: { closed: true } };
    if (r.action === "word.document.applyEdits") for (const edit of r.input.edits as Array<{start: number; end: number; text: string}>) body = body.slice(0, edit.start) + edit.text + body.slice(edit.end);
    return { id: r.id, ok: true, output: {} };
  }), dispose: vi.fn(async () => {}) };
  const session = new WordSession(adapter); sessions.push(session);
  const opened = await session.execute("word.document.open", { path }) as { documentId: string; path: string };
  directories.push(dirname(opened.path));
  return { directory, path, adapter, session, opened };
}
afterEach(async () => { for (const s of sessions.splice(0)) await s.dispose(); for (const d of directories.splice(0)) await rm(d, { recursive: true, force: true }); });

it("isolates documents across runs, preserves originals, and invalidates closed IDs", async () => {
  const a = await setup(), b = await setup();
  expect(await readFile(a.opened.path)).toEqual(await readFile(a.path));
  await expect(b.session.execute("word.document.readText", { documentId: a.opened.documentId })).rejects.toThrow(/ajeno/);
  await a.session.execute("word.document.close", { documentId: a.opened.documentId, changes: "discard" });
  await expect(a.session.execute("word.document.readText", { documentId: a.opened.documentId })).rejects.toThrow(/ajeno/);
});
it("validates all markers before writes and handles nested JSON, multiple matches and literal values", async () => {
  const { session, adapter, opened } = await setup();
  await expect(session.execute("word.document.fillTemplate", { documentId: opened.documentId, data: { cliente: { nombre: "María" }, absent: "x" } })).rejects.toThrow(/inexistente/);
  expect(vi.mocked(adapter.request).mock.calls.some(([r]) => r.action.endsWith("applyEdits"))).toBe(false);
  const result = await session.execute("word.document.fillTemplate", { documentId: opened.documentId, data: { cliente: { nombre: '^& " ñ' }, items: [42] } }) as { replacements: number };
  expect(result.replacements).toBe(3);
  expect(await session.execute("word.document.readText", { documentId: opened.documentId })).toMatchObject({ text: '^& " ñ / 42 / ^& " ñ' });
});
it("protects sources and hardlink aliases even when overwrite is explicitly enabled", async () => {
  const { session, opened, path, directory } = await setup();
  const alias = join(directory, "alias.docx"); await link(path, alias);
  for (const destination of [path, alias]) await expect(session.execute("word.document.saveAs", { documentId: opened.documentId, path: destination, overwrite: true })).rejects.toThrow(/origen/);
});
it("quarantines uncertain effects, rejects queued operations, and does not retry or write during cleanup", async () => {
  const { session, opened, adapter } = await setup();
  vi.mocked(adapter.request).mockResolvedValue({ id: "unused", ok: false, error: "timeout", effect: "uncertain" });
  await expect(session.execute("word.document.readText", { documentId: opened.documentId })).rejects.toMatchObject({ code: "ACTION_EFFECT_UNCERTAIN" });
  const count = vi.mocked(adapter.request).mock.calls.length;
  await expect(session.execute("word.document.appendText", { documentId: opened.documentId, text: "unsafe" })).rejects.toMatchObject({ code: "ACTION_EFFECT_UNCERTAIN" });
  await session.dispose(); sessions.splice(sessions.indexOf(session), 1);
  expect(adapter.request).toHaveBeenCalledTimes(count); expect(session.cleanupFailures).toContain(opened.path);
});
it("rejects pre-cancelled operations without sending them", async () => {
  const { session, opened, adapter } = await setup(); const signal = AbortSignal.abort();
  const count = vi.mocked(adapter.request).mock.calls.length;
  await expect(session.execute("word.document.readText", { documentId: opened.documentId }, signal)).rejects.toMatchObject({ code: "WORD_CANCELLED" });
  expect(adapter.request).toHaveBeenCalledTimes(count);
});
it.skipIf(process.platform !== "darwin")("rejects external direct opens before contacting Word, and stages files in its container", async () => {
  const { opened, path, adapter } = await setup();
  expect(opened.path.startsWith(wordWorkspace() + "/")).toBe(true);
  const second = new WordSession(adapter); sessions.push(second);
  const count = vi.mocked(adapter.request).mock.calls.length;
  await expect(second.execute("word.document.open", { path, copy: false })).rejects.toMatchObject({ code: "WORD_FILE_PERMISSION_REQUIRED", uncertain: false });
  expect(adapter.request).toHaveBeenCalledTimes(count);
});
it.skipIf(process.platform !== "darwin")("publishes DOCX/PDF without exposing external paths to Word and persists close-save changes", async () => {
  const { session, opened, directory, adapter } = await setup();
  const saved = join(directory, "resultado ñ.docx"), pdf = join(directory, "resultado ñ.pdf");
  let nativePath = opened.path;
  vi.mocked(adapter.request).mockImplementation(async (r) => {
    if (r.action.endsWith("saveAs")) { nativePath = String(r.input.path); await writeFile(nativePath, "DOCX guardado"); }
    if (r.action.endsWith("exportPdf")) await writeFile(String(r.input.path), "%PDF prueba");
    if (r.action.endsWith("close")) { await writeFile(nativePath, "DOCX cambios al cerrar"); return { id: r.id, ok: true, output: { closed: true } }; }
    return { id: r.id, ok: true, output: {} };
  });
  await expect(session.execute("word.document.saveAs", { documentId: opened.documentId, path: saved })).resolves.toMatchObject({ path: join(await realpath(directory), "resultado ñ.docx") });
  await session.execute("word.document.exportPdf", { documentId: opened.documentId, path: pdf });
  expect(await readFile(saved, "utf8")).toBe("DOCX guardado");
  expect(await readFile(pdf, "utf8")).toBe("%PDF prueba");
  const writes = vi.mocked(adapter.request).mock.calls.filter(([r]) => r.action.endsWith("saveAs") || r.action.endsWith("exportPdf"));
  for (const [r] of writes) expect(String(r.input.path).startsWith(wordWorkspace() + "/")).toBe(true);
  await session.execute("word.document.close", { documentId: opened.documentId, changes: "save" });
  expect(await readFile(saved, "utf8")).toBe("DOCX cambios al cerrar");
});
it.skipIf(process.platform !== "darwin")("does not overwrite an output modified after saveAs when closing", async () => {
  const { session, opened, directory, adapter } = await setup();
  vi.mocked(adapter.request).mockImplementation(async (r) => {
    if (r.action.endsWith("saveAs")) await writeFile(String(r.input.path), "saved");
    return { id: r.id, ok: true, output: r.action.endsWith("close") ? { closed: true } : {} };
  });
  const saved = join(directory, "output.docx");
  await session.execute("word.document.saveAs", { documentId: opened.documentId, path: saved });
  await writeFile(saved, "changed elsewhere");
  const count = vi.mocked(adapter.request).mock.calls.length;
  await expect(session.execute("word.document.close", { documentId: opened.documentId, changes: "save" })).rejects.toThrow(/cambió/);
  expect(adapter.request).toHaveBeenCalledTimes(count);
  expect(await readFile(saved, "utf8")).toBe("changed elsewhere");
});
it("registers plugins atomically when a manifest has invalid versions, IDs or schemas", () => {
  for (const mutate of [
    (m: any) => { m.packageVersion = "invalid"; },
    (m: any) => { m.actions[1] = m.actions[0]; },
    (m: any) => { m.actions[0].inputSchema.type = "not-a-type"; },
  ]) {
    const registry = new AutomationRegistry(), plugin = structuredClone(wordPluginManifest); mutate(plugin);
    expect(() => registry.registerApp({ ...wordApp, plugin })).toThrow();
    expect(registry.listApps()).toEqual([]); expect(registry.getActionIds()).toEqual([]);
  }
});
it("stops generic uncertain effects with continueRegularOutput and retains trace classification", async () => {
  const flow = createWorkflow();
  flow.workflow.nodes.push({ id: "write", name: "write", type: "rpa.action", typeVersion: 1, position: [100, 100], onError: "continueRegularOutput", parameters: { actionId: "fixture.write", input: {} } });
  flow.workflow.connections.Inicio = { main: [[{ node: "write", type: "main", index: 0 }]] };
  const result = await executeFlowDocument(flow, {}, { runAction: async () => ({ ok: false, message: "uncertain", errorCode: "ACTION_EFFECT_UNCERTAIN" }) });
  expect(result.status).toBe("failed"); expect(result.error?.code).toBe("ACTION_EFFECT_UNCERTAIN"); expect(result.nodeRuns.at(-1)?.error?.code).toBe("ACTION_EFFECT_UNCERTAIN");
});
