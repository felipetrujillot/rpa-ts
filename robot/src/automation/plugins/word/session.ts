import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, copyFile, mkdir, mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative } from "node:path";
import { validateWordInput, wordOutputSchemas, type WordActionId } from "@rpa/contracts";
import { WordError, type WordAdapter } from "./adapter";
import { NativeWordAdapter } from "./native-adapter";

type Document = { path: string; sourcePath: string; directory?: string; published?: { path: string; fingerprint: string } };
export function wordWorkspace(platform: NodeJS.Platform = process.platform) {
  return platform === "darwin" ? join(homedir(), "Library/Containers/com.microsoft.Word/Data/Library/Caches/rpa-automation") : tmpdir();
}
const fingerprint = (info: Awaited<ReturnType<typeof stat>>) => `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}`;
type Edit = { start: number; end: number; text: string };
// Word on macOS is shared by all sessions: serialize the complete read/check/write operation.
let wordQueue: Promise<unknown> = Promise.resolve();
export class WordSession {
  private documents = new Map<string, Document>();
  private sources = new Set<string>();
  private invalid = false;
  private disposed = false;
  readonly cleanupFailures: string[] = [];
  constructor(private adapter: WordAdapter = new NativeWordAdapter()) {}
  execute(action: WordActionId, raw: unknown, signal?: AbortSignal): Promise<unknown> {
    const operation = wordQueue.then(() => this.perform(action, raw, signal));
    wordQueue = operation.catch(() => {});
    return operation;
  }
  private async path(path: string, extension: string, existing: boolean) {
    if (!isAbsolute(path) || extname(path).toLowerCase() !== extension) throw new WordError(`Se requiere una ruta absoluta ${extension}.`);
    return existing ? realpath(path) : join(await realpath(dirname(path)), basename(path));
  }
  private async request(action: string, input: Record<string, unknown>, signal?: AbortSignal) {
    const response = await this.adapter.request({ id: randomUUID(), action, input }, signal);
    if (!response.ok) throw new WordError(response.error ?? "Falló Word.", response.effect === "uncertain" ? "ACTION_EFFECT_UNCERTAIN" : "WORD_REJECTED", response.effect === "uncertain");
    return response.output ?? {};
  }
  private async perform(action: WordActionId, raw: unknown, signal?: AbortSignal): Promise<unknown> {
    if (this.disposed) throw new WordError("Sesión Word cerrada.");
    if (this.invalid) throw new WordError("Sesión Word invalidada. Reconcilia los documentos.", "ACTION_EFFECT_UNCERTAIN", true);
    const input = validateWordInput(action, raw);
    if (signal?.aborted) throw new WordError("Cancelado antes de enviarse.", "WORD_CANCELLED");
    let documentId = String(input.documentId ?? "");
    let opened: Document | undefined;
    if (action === "word.document.open") {
      const sourcePath = await this.path(String(input.path), ".docx", true);
      const info = await stat(sourcePath);
      if (!info.isFile() || info.size > 50_000_000) throw new WordError("El DOCX debe ser un archivo local de hasta 50 MB.");
      if ([...this.documents.values()].some((d) => d.sourcePath === sourcePath || d.path === sourcePath)) throw new WordError("Documento ya administrado por esta ejecución.");
      const workspace = wordWorkspace();
      if (process.platform === "darwin") {
        await mkdir(workspace, { recursive: true, mode: 0o700 });
        const inside = relative(await realpath(workspace), sourcePath);
        if (!input.copy && (inside.startsWith("..") || isAbsolute(inside))) throw new WordError("En macOS, abrir un original externo requiere permisos de Word. Usa copy=true para trabajar sin solicitudes de acceso repetidas.", "WORD_FILE_PERMISSION_REQUIRED");
      }
      const directory = input.copy || process.platform === "darwin" ? await mkdtemp(join(workspace, "rpa-word-document-")) : undefined;
      // Unique ASCII basename avoids Word's cross-directory duplicate-name restriction.
      const path = input.copy ? join(directory!, `${randomUUID()}.docx`) : sourcePath;
      if (input.copy) await copyFile(sourcePath, path, constants.COPYFILE_EXCL);
      opened = { path, sourcePath, directory };
      this.sources.add(sourcePath);
      documentId = randomUUID(); input.documentId = documentId; input.documentPath = path;
    } else {
      const document = this.documents.get(documentId);
      if (!document) throw new WordError("documentId ajeno, cerrado o de una ejecución anterior.");
      input.documentPath = document.path;
      if (action === "word.document.close" && input.changes === "save" && document.path === document.sourcePath) throw new WordError("Guarda una copia con saveAs antes de cerrar con guardado.");
      if (action === "word.document.close" && input.changes === "save" && document.published) {
        const current = await stat(document.published.path).catch(() => undefined);
        if (!current || fingerprint(current) !== document.published.fingerprint) throw new WordError("El DOCX de salida cambió fuera de la ejecución. No se sobrescribirá al cerrar.");
      }
    }
    try {
      let output: Record<string, unknown>;
      if (["word.document.replaceText", "word.document.fillTemplate", "word.document.appendText"].includes(action)) {
        const read = await this.request("word.document.readText", input, signal);
        if (typeof read.text !== "string" || read.text.length > 500_000) throw new WordError("El cuerpo Word supera los límites o su respuesta es inválida.");
        const body = read.text;
        const edits: Edit[] = [];
        const counts: Record<string, number> = Object.create(null);
        if (action.endsWith("appendText")) {
          const end = body.endsWith("\r") ? body.length - 1 : body.length;
          edits.push({ start: end, end, text: String(input.text).replace(/\r?\n/g, "\r") });
          output = { appendedCharacters: String(input.text).length };
        } else {
          const pairs: string[][] = [];
          const flatten = (value: unknown, path: string) => {
            if (value && typeof value === "object") for (const [key, nested] of Object.entries(value)) flatten(nested, path ? `${path}.${key}` : key);
            else pairs.push([`{{${path}}}`, value === null ? "" : String(value)]);
          };
          if (action.endsWith("fillTemplate")) flatten(input.data, "");
          else pairs.push([String(input.find), String(input.replacement)]);
          if (!pairs.length) throw new WordError("No hay valores de marcadores en los datos.");
          if (new Set(pairs.map(([find]) => find)).size !== pairs.length) throw new WordError("Marcadores ambiguos en los datos.");
          for (const [find, replacement] of pairs) {
            let start = 0, count = 0, index: number;
            while ((index = body.indexOf(find!, start)) >= 0) {
              edits.push({ start: index, end: index + find!.length, text: replacement!.replace(/\r?\n/g, "\r") });
              count++; start = index + find!.length;
              if (input.matches === "first") break;
              if (edits.length > 10000) throw new WordError("Más de 10000 coincidencias.");
            }
            counts[find!] = count;
            if (!count && input.missing === "error") throw new WordError(`Marcador inexistente: ${find}`);
          }
          output = { replacements: edits.length, counts: pairs.map(([marker]) => ({ marker, count: counts[marker!] })) };
        }
        edits.sort((a, b) => b.start - a.start);
        for (let i = 1; i < edits.length; i++) if (edits[i]!.end > edits[i - 1]!.start) throw new WordError("Marcadores superpuestos.");
        if (edits.length) await this.request("word.document.applyEdits", { ...input, expectedText: body, edits }, signal);
      } else {
        if (action.endsWith("saveAs") || action.endsWith("exportPdf")) {
          input.path = await this.path(String(input.path), action.endsWith("saveAs") ? ".docx" : ".pdf", false);
          const destination = String(input.path);
          if (this.sources.has(destination) || [...this.documents.values()].some((d) => d.path === destination)) throw new WordError("El destino coincide con un origen o documento administrado.");
          try { await access(destination); if (!input.overwrite) throw new WordError("El destino ya existe; requiere overwrite=true."); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
          // Reject symlink aliases to a source, even with overwrite=true.
          try {
            const target = await realpath(destination);
            if (this.sources.has(target) || [...this.documents.values()].some((d) => d.path === target)) throw new WordError("El destino apunta a un documento protegido.");
            const destinationStat = await stat(target);
            for (const source of this.sources) {
              const sourceStat = await stat(source);
              if (destinationStat.dev === sourceStat.dev && destinationStat.ino === sourceStat.ino) throw new WordError("El destino es un enlace a un origen protegido.");
            }
          }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        }
        // Word only sees files in its own container on macOS. The robot publishes
        // local outputs with its existing filesystem permissions, without granting Word access.
        const destination = (action.endsWith("saveAs") || action.endsWith("exportPdf")) ? String(input.path) : undefined;
        const managed = this.documents.get(documentId);
        const staged = process.platform === "darwin" && destination && managed?.directory
          ? join(managed.directory, `${randomUUID()}${extname(destination)}`) : undefined;
        output = await this.request(action, staged ? { ...input, path: staged } : input, signal);
        if (opened) { this.documents.set(documentId, opened); output = { ...output, path: opened.path, sourcePath: opened.sourcePath }; }
        if (action.endsWith("readText") && typeof output.text === "string") output.text = output.text.replace(/\r$/, "").replace(/\r/g, "\n");
        if (action.endsWith("saveAs")) this.documents.get(documentId)!.path = staged ?? String(input.path);
        if (action.endsWith("saveAs") || action.endsWith("exportPdf")) {
          try {
            if (staged) await copyFile(staged, destination!, input.overwrite ? 0 : constants.COPYFILE_EXCL);
            const info = await stat(String(input.path)); output.bytes = info.size; output.path = input.path;
            if (staged && action.endsWith("saveAs")) managed!.published = { path: destination!, fingerprint: fingerprint(info) };
            if (staged && action.endsWith("exportPdf")) await rm(staged, { force: true });
          }
          catch { throw new WordError("Word informó guardado pero no se pudo verificar el archivo.", "ACTION_EFFECT_UNCERTAIN", true); }
        }
        if (action.endsWith("close")) {
          const document = this.documents.get(documentId)!;
          if (input.changes === "save" && document.published) {
            try { await copyFile(document.path, document.published.path); }
            catch { throw new WordError("Word cerró el documento pero no se pudo actualizar el DOCX de salida.", "ACTION_EFFECT_UNCERTAIN", true); }
          }
          this.documents.delete(documentId);
          if (document.directory) await rm(document.directory, { recursive: true, force: true });
        }
      }
      try { return wordOutputSchemas[action].parse({ ...output, documentId }); }
      catch { throw new WordError("Respuesta Word incompatible con el contrato de salida.", "ACTION_EFFECT_UNCERTAIN", true); }
    } catch (error) {
      if ((error as WordError).uncertain || (error as WordError).code === "ACTION_EFFECT_UNCERTAIN") this.invalid = true;
      if (opened && this.invalid) this.documents.set(documentId, opened);
      if (opened?.directory && !this.invalid) await rm(opened.directory, { recursive: true, force: true });
      throw error;
    }
  }
  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const operation = wordQueue.then(async () => {
      if (!this.invalid) for (const [documentId, document] of this.documents) {
        try {
          await this.request("word.document.close", { documentId, documentPath: document.path, changes: "discard", timeoutMs: 5000 });
          if (document.directory) await rm(document.directory, { recursive: true, force: true });
        } catch { this.cleanupFailures.push(document.path); break; }
      }
      else this.cleanupFailures.push(...[...this.documents.values()].map((d) => d.path));
      this.documents.clear(); await this.adapter.dispose();
    });
    wordQueue = operation.catch(() => {}); await operation;
  }
}
