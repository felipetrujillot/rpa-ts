import { inspectWordAvailability } from "../../src/automation/plugins/word/native-adapter";
import { expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createWorkflow, pinWordRequirements, type FlowDocument } from "@rpa/contracts";
import { WordSession } from "../../src/automation/plugins/word/session";
import { AutomationRegistry } from "../../src/automation/core/registry";
import { wordApp } from "../../src/automation/apps/word.app";
import { executeFlowDocument } from "../../src/automation/flow/runner";

it("Word real: acciones de Canvas, origen intacto, DOCX reabierto y PDF verificable", async () => {
  const directory = resolve("artifacts/word-plugin"); await mkdir(directory, { recursive: true });
  const artifacts = await mkdtemp(join(directory, "Word ñ "));
  const python = process.env.RPA_WORD_PYTHON || (process.platform === "win32" ? "python" : "python3");
  const exec = promisify(execFile);
  const fixture = JSON.parse((await exec(python, [resolve("scripts/word/fixture.py"), "create", artifacts])).stdout);
  const path = join(artifacts, "Resultado ñ.docx"), pdf = join(artifacts, "Resultado ñ.pdf"), pdfText = join(artifacts, "Resultado ñ.txt");
  const session = new WordSession(); const context = { appContexts: { word: session } };
  const registry = new AutomationRegistry(); registry.registerApp(wordApp);
  const document = createWorkflow("Word real");
  const steps: Array<[string, string, Record<string, any>]> = [
    ["open", "open", { path: fixture.source }],
    ["read", "readText", {}],
    ["fill", "fillTemplate", { data: { cliente: fixture.replacement } }],
    ["replace", "replaceText", { find: "Fin de la prueba.", replacement: "Fin revisado." }],
    ["append", "appendText", { text: "\nAnexo de prueba." }],
    ["save", "saveAs", { path }],
    ["pdf", "exportPdf", { path: pdf }],
    ["close", "close", { changes: "discard" }],
    ["reopen", "open", { path }],
    ["verify", "readText", { documentId: { $ref: "nodeOutputs.reopen.documentId" } }],
    ["finish", "close", { documentId: { $ref: "nodeOutputs.reopen.documentId" }, changes: "discard" }],
  ];
  let previous = "Inicio";
  for (const [id, suffix, input] of steps) {
    document.workflow.nodes.push({ id, name: id, type: "rpa.action", typeVersion: 1, position: [200, 100], parameters: {
      actionId: `word.document.${suffix}`, input: { ...(suffix === "open" ? {} : { documentId: { $ref: "nodeOutputs.open.documentId" } }), ...input },
    } });
    document.workflow.connections[previous] = { main: [[{ node: id, type: "main", index: 0 }]] }; previous = id;
  }
  try {
    const result = await executeFlowDocument(pinWordRequirements(document) as FlowDocument, {}, { plugins: { sampledAt: new Date().toISOString(), plugins: [await inspectWordAvailability()] }, runAction: (id, input) => registry.execute(id, input, context) });
    await writeFile(join(artifacts, "run.json"), JSON.stringify(result, null, 2));
    expect(result.error?.message ?? result.status).toBe("success");
    const expected = fixture.expected.replace("Fin de la prueba.", "Fin revisado.") + "\nAnexo de prueba.";
    expect((result.outputs.nodeOutputs.verify as { text: string }).text).toBe(expected);
    await exec("pdftotext", ["-enc", "UTF-8", pdf, pdfText]);
    const request = join(artifacts, "verification-request.json");
    await writeFile(request, JSON.stringify({ ...fixture, expected, output: path, pdf, pdfText }));
    const verified = JSON.parse((await exec(python, [resolve("scripts/word/fixture.py"), "verify", request])).stdout);
    await writeFile(join(artifacts, "verification.json"), JSON.stringify(verified, null, 2));
    expect(verified.ok).toBe(true);
  } finally { await session.dispose(); }
});

it("Word real: rechaza marcadores ausentes, destino ocupado, documento ajeno abierto y documento protegido", async () => {
  const root = resolve("artifacts/word-plugin"); await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, "Negativos ñ "));
  const python = process.env.RPA_WORD_PYTHON || (process.platform === "win32" ? "python" : "python3"), exec = promisify(execFile);
  const fixture = JSON.parse((await exec(python, [resolve("scripts/word/fixture.py"), "create", directory])).stdout);
  const protectedDir = join(directory, "Protegido"); await mkdir(protectedDir);
  const protectedFixture = JSON.parse((await exec(python, [resolve("scripts/word/fixture.py"), "create-protected", protectedDir])).stdout);
  const session = new WordSession(), other = new WordSession();
  try {
    const opened = await session.execute("word.document.open", { path: fixture.source }) as { documentId: string; path: string };
    // Use the managed fixture, without asking Word to access a new external original.
    await expect(other.execute("word.document.open", { path: opened.path, copy: false })).rejects.toThrow(/CONFLICT|conflicto|already/i);
    await expect(session.execute("word.document.replaceText", { documentId: opened.documentId, find: "ausente", replacement: "x" })).rejects.toThrow(/inexistente/);
    const occupied = join(directory, "ocupado.docx"); await writeFile(occupied, "contenido anterior");
    await expect(session.execute("word.document.saveAs", { documentId: opened.documentId, path: occupied })).rejects.toThrow(/ya existe/);
    expect(await readFile(occupied, "utf8")).toBe("contenido anterior");
    await session.execute("word.document.close", { documentId: opened.documentId, changes: "discard" });
    const protectedDoc = await session.execute("word.document.open", { path: protectedFixture.source }) as { documentId: string };
    await expect(session.execute("word.document.appendText", { documentId: protectedDoc.documentId, text: "rechazar" })).rejects.toThrow(/PROTECTED/);
    await session.execute("word.document.close", { documentId: protectedDoc.documentId, changes: "discard" });
    await writeFile(join(directory, "negative-results.json"), JSON.stringify({ platform: process.platform, missingMarker: "passed", occupiedPath: "passed", openDocumentConflict: "passed", protectedDocument: "passed" }, null, 2));
  } finally { await session.dispose(); await other.dispose(); }
});
