import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdtemp, realpath, stat, lstat, rm, readFile, rename, link, unlink, mkdir } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { basename, extname, isAbsolute, join, dirname } from "node:path";
import { validateExcelInput, excelRangeResultSchema, parseExcelAddress, EXCEL_MAX_BYTES, type ExcelActionId } from "@rpa/contracts";
import { ExcelError, type ExcelAdapter } from "./adapter";
import { preflightXlsx } from "./xlsx-preflight";
import { NativeExcelAdapter } from "./native-adapter";

type Book = {
  path: string; sourcePath: string; directory?: string; staging: string[];
  saved?: { path: string; hash: string };
};
const digest = async (path: string) => createHash("sha256").update(await readFile(path)).digest("hex");
export class ExcelSession {
  private books = new Map<string, Book>();
  private sources = new Set<string>();
  private queue: Promise<unknown> = Promise.resolve();
  private invalid = false;
  constructor(private adapter: ExcelAdapter = new NativeExcelAdapter(), private options: { workingDirectory?: string } = {}) {}
  execute(action: ExcelActionId, raw: unknown, signal?: AbortSignal): Promise<unknown> {
    const operation = this.queue.then(() => this.perform(action, raw, signal));
    this.queue = operation.catch(() => {});
    return operation;
  }
  private async perform(action: ExcelActionId, raw: unknown, signal?: AbortSignal) {
    if (this.invalid) throw new ExcelError("Sesión inválida: reconcilia los efectos de Excel antes de continuar.", "ACTION_EFFECT_UNCERTAIN", true);
    const input = validateExcelInput(action, raw);
    if (signal?.aborted) throw new ExcelError("Operación cancelada antes de enviarse.", "EXCEL_CANCELLED");
    let opened: Book | undefined;
    let workbookId = String(input.workbookId ?? "");
    if (action === "excel.workbook.open") {
      const sourcePath = await this.localPath(String(input.path), ".xlsx", true);
      if ([...this.books.values()].some((book) => book.path === sourcePath || book.sourcePath === sourcePath || basename(book.path).toLowerCase() === basename(sourcePath).toLowerCase()))
        throw new ExcelError("El archivo o un libro con el mismo nombre ya está administrado por esta ejecución.");
      const info = await stat(sourcePath);
      if (!info.isFile() || info.size > 50_000_000) throw new ExcelError("El XLSX debe ser un archivo local de hasta 50 MB.");
      const directory = input.copy ? await mkdtemp(join(await this.workingRoot(), "rpa-excel-book-")) : undefined;
      const path = directory ? join(directory, basename(sourcePath)) : sourcePath;
      try {
        if (directory) await copyFile(sourcePath, path);
        await preflightXlsx(path);
      } catch (error) { if (directory) await rm(directory, { recursive: true, force: true }); throw error; }
      opened = { path, sourcePath, directory, staging: [] };
      this.sources.add(sourcePath);
      workbookId = randomUUID();
      input.workbookId = workbookId; input.path = path;
    } else if (!this.books.has(workbookId)) throw new ExcelError("workbookId no pertenece a esta ejecución o ya se cerró.");
    const book = this.books.get(workbookId);
    let destination: string | undefined, staging: string | undefined;
    if (action === "excel.workbook.saveAs" || action === "excel.worksheet.exportPdf") {
      destination = await this.localPath(String(input.path), action.endsWith("saveAs") ? ".xlsx" : ".pdf", false);
      if (this.sources.has(destination) || [...this.books.values()].some((b) => b.path === destination)) throw new ExcelError("El destino coincide con una plantilla o un libro abierto.");
      try {
        const existing = await lstat(destination);
        if (!existing.isFile()) throw new ExcelError("El destino debe ser un archivo regular, sin enlaces simbólicos.");
        if (!input.overwrite) throw new ExcelError("El destino ya existe; overwrite debe ser true.");
      } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
      // Excel always saves to a fresh path, avoiding overwrite dialogs or global DisplayAlerts changes.
      staging = await mkdtemp(join(await this.workingRoot(), "rpa-excel-output-"));
      input.path = join(staging, basename(destination));
    }
    if (action === "excel.workbook.close" && input.saveChanges && book?.saved)
      await this.assertSavedArtifactUnchanged(book);
    let confirmed = false;
    try {
      const response = await this.adapter.request({ id: randomUUID(), action, input }, signal);
      if (!response.ok) throw new ExcelError(response.error ?? "Falló Excel.", response.effect === "uncertain" ? "ACTION_EFFECT_UNCERTAIN" : response.code ?? "EXCEL_REJECTED", response.effect === "uncertain");
      confirmed = true;
      if (opened) this.books.set(workbookId, opened);
      if (action === "excel.range.read") {
        const result = excelRangeResultSchema.parse(response.output);
        const d = parseExcelAddress(String(input.address));
        for (const matrix of [result.values, result.types, result.formulas, result.errors])
          if (matrix.length !== d.rows || matrix.some((row) => row.length !== d.columns)) throw new Error("Excel devolvió dimensiones incorrectas.");
        if (Buffer.byteLength(JSON.stringify(result)) > EXCEL_MAX_BYTES) throw new Error("La salida Excel supera 1 MB.");
      }
      if (destination && staging) {
        if (action === "excel.workbook.saveAs") { book!.path = String(input.path); book!.staging.push(staging); }
        await this.publish(String(input.path), destination, Boolean(input.overwrite));
        if (action === "excel.workbook.saveAs") book!.saved = { path: destination, hash: await digest(destination) };
        else await rm(staging, { recursive: true, force: true });
        return { path: destination, ...(action === "excel.workbook.saveAs" ? { workingPath: input.path } : {}) };
      }
      if (action === "excel.workbook.close") {
        if (input.saveChanges && book?.saved) {
          await this.assertSavedArtifactUnchanged(book);
          await this.publish(book.path, book.saved.path, true);
        }
        this.books.delete(workbookId);
        await this.cleanBook(book!);
      }
      return opened ? { ...(response.output as object), workbookId, path: opened.path, sourcePath: opened.sourcePath } : response.output;
    } catch (error) {
      if ((error as ExcelError).uncertain || confirmed) {
        this.invalid = true;
        throw new ExcelError(`${error instanceof Error ? error.message : String(error)} Revisa los efectos antes de reintentar.`, "ACTION_EFFECT_UNCERTAIN", true);
      }
      if (opened?.directory) await rm(opened.directory, { recursive: true, force: true });
      if (staging) await rm(staging, { recursive: true, force: true });
      throw error;
    }
  }
  private async assertSavedArtifactUnchanged(book: Book) {
    if (book.saved && await digest(book.saved.path) !== book.saved.hash)
      throw new ExcelError("El archivo guardado cambió fuera de esta ejecución. No se sobrescribirá al cerrar.");
  }
  private async publish(source: string, destination: string, overwrite: boolean) {
    const directory = await mkdtemp(join(dirname(destination), ".rpa-excel-publish-"));
    const snapshot = join(directory, "snapshot");
    try {
      await copyFile(source, snapshot);
      if (overwrite) await rename(snapshot, destination);
      else { await link(snapshot, destination); await unlink(snapshot); }
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  private async cleanBook(book: Book) {
    for (const directory of [...book.staging, ...(book.directory ? [book.directory] : [])]) await rm(directory, { recursive: true, force: true });
  }
  private async workingRoot() {
    // Excel's own sandbox can open these copies without per-file Grant Access dialogs.
    const root = this.options.workingDirectory ?? (process.platform === "darwin" ? join(homedir(), "Library", "Containers", "com.microsoft.Excel", "Data", "tmp") : tmpdir());
    await mkdir(root, { recursive: true });
    return root;
  }
  private async localPath(path: string, extension: string, exists: boolean) {
    if (!isAbsolute(path) || extname(path).toLowerCase() !== extension) throw new ExcelError(`Se requiere una ruta absoluta ${extension}.`);
    return exists ? realpath(path) : join(await realpath(dirname(path)), basename(path));
  }
  async dispose() {
    await this.queue;
    // End-of-run policy: discard only owned copies; originals and uncertain operations stay open.
    if (!this.invalid) for (const [workbookId, book] of this.books) {
      if (!book.directory && !book.staging.length) continue;
      try {
        const result = await this.adapter.request({ id: randomUUID(), action: "excel.workbook.close", input: { workbookId, saveChanges: false, timeoutMs: 5000 } });
        if (result.ok) await this.cleanBook(book);
        else break;
      } catch { break; }
    }
    this.books.clear();
    await this.adapter.dispose();
  }
}
