import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ExcelSession } from "../../../src/automation/plugins/excel/session";
import type { ExcelActionId, ExcelRangeResult } from "@rpa/contracts";

// Opt-in: real Excel, a signed-in interactive desktop, and no user workbooks on macOS.
describe.skipIf(process.env.RPA_EXCEL_DESKTOP !== "1")("Excel native desktop circuit", () => {
  it("opens a copy, writes literal values/formulas, recalculates cross-sheet dependencies, exports and reopens", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rpa-excel-desktop-"));
    const source = resolve("tests/desktop/excel/template.xlsx");
    const original = await readFile(source);
    const session = new ExcelSession();
    const run = (action: ExcelActionId, input: Record<string, unknown>) => { console.info(action); return session.execute(action, { ...input, timeoutMs: 30000 }); };
    try {
      const opened = await run("excel.workbook.open", { path: source }) as { workbookId: string; excelVersion: string };
      console.info(`Native Excel ${opened.excelVersion}, ${process.platform}, ${process.arch}`);
      const book = { workbookId: opened.workbookId };
      const listed = await run("excel.worksheet.list", book) as { worksheets: { worksheetId: string; name: string }[] };
      expect(listed.worksheets.map((s) => s.name)).toEqual(["Datos", "Resumen"]);
      const datos = { ...book, worksheetId: listed.worksheets[0]!.worksheetId };
      const resumen = { ...book, worksheetId: listed.worksheets[1]!.worksheetId };
      const added = await run("excel.worksheet.add", { ...book, name: "Texto áé" }) as { worksheetId: string };
      await expect(run("excel.worksheet.add", { ...book, name: "Texto áé" })).rejects.toThrow(/duplicado/i);
      const literal = [["001", "=1+1", "+2", "-3", "@SUM(A1)", "", null, 0, true, 'á\n"test"']];
      await run("excel.range.writeValues", { ...book, worksheetId: added.worksheetId, address: "A1:J1", values: literal });
      let result = await run("excel.range.read", { ...book, worksheetId: added.worksheetId, address: "A1:J1" }) as ExcelRangeResult;
      expect(result.values).toEqual(literal);
      expect(result.types[0]).toEqual(["string", "string", "string", "string", "string", "string", "empty", "number", "boolean", "string"]);
      expect(result.formulas[0]).toEqual(Array(10).fill(null));
      expect(result.calculationPending).toBe(true);
      await run("excel.range.writeValues", { ...datos, address: "A2:B3", values: [[12.5, 4], [3, 2]] });
      await run("excel.range.writeFormulas", { ...datos, address: "C2:C3", formulas: [["=A2*B2"], ["=A3*B3"]] });
      await run("excel.range.format", { ...datos, address: "A1:C3", format: { numberFormat: "0.00", bold: true, fill: "#DDEEFF", columnWidth: 18 } });
      await run("excel.workbook.calculate", book);
      result = await run("excel.range.read", { ...resumen, address: "B1" }) as ExcelRangeResult;
      expect(result.values).toEqual([[56]]);
      expect(result.calculationPending).toBe(false);
      await run("excel.range.writeValues", { ...datos, address: "B2", values: [[2]] });
      await run("excel.workbook.calculate", book);
      expect((await run("excel.range.read", { ...resumen, address: "B1" }) as ExcelRangeResult).values).toEqual([[31]]);
      await run("excel.range.writeFormulas", { ...book, worksheetId: added.worksheetId, address: "A2", formulas: [["=1/0"]] });
      await run("excel.workbook.calculate", book);
      result = await run("excel.range.read", { ...book, worksheetId: added.worksheetId, address: "A2" }) as ExcelRangeResult;
      expect(result.types).toEqual([["error"]]); expect(result.errors[0]![0]).toBeTruthy();
      await run("excel.range.clear", { ...book, worksheetId: added.worksheetId, address: "A2" });
      await run("excel.workbook.calculate", book);
      const pdf = join(directory, "hoja á.pdf");
      await run("excel.worksheet.exportPdf", { ...resumen, address: "A1:B1", path: pdf, overwrite: false, page: { orientation: "portrait", fitToPagesWide: 1, fitToPagesTall: 1 } });
      expect((await readFile(pdf)).subarray(0, 5).toString()).toBe("%PDF-");
      if (process.env.RPA_PDFTOTEXT) {
        const text = (await promisify(execFile)(process.env.RPA_PDFTOTEXT, [pdf, "-"])).stdout;
        expect(text).toContain("Total"); expect(text).toContain("31"); expect(text).not.toContain("Precio");
      }
      const saved = join(directory, "resultado á.xlsx");
      await run("excel.workbook.saveAs", { ...book, path: saved, overwrite: false });
      await expect(run("excel.workbook.saveAs", { ...book, path: saved, overwrite: false })).rejects.toThrow(/ya existe/);
      await run("excel.workbook.saveAs", { ...book, path: saved, overwrite: true });
      await run("excel.range.writeValues", { ...datos, address: "B2", values: [[3]] });
      await run("excel.workbook.calculate", book);
      await run("excel.workbook.close", { ...book, saveChanges: true });
      await expect(run("excel.worksheet.list", book)).rejects.toThrow(/no pertenece/);
      const reopened = await run("excel.workbook.open", { path: saved }) as { workbookId: string };
      const reopenedBook = { workbookId: reopened.workbookId };
      await run("excel.workbook.calculate", reopenedBook);
      result = await run("excel.range.read", { ...reopenedBook, worksheetId: "Resumen", address: "B1" }) as ExcelRangeResult;
      expect(result.values).toEqual([[43.5]]);
      await run("excel.workbook.close", { ...reopenedBook, saveChanges: false });
      expect(await readFile(source)).toEqual(original);
    } finally { await session.dispose(); await rm(directory, { recursive: true, force: true }); }
  }, 120000);
  it("reads date serials without regional inference in the 1904 date system", async () => {
    const session = new ExcelSession();
    try {
      const opened = await session.execute("excel.workbook.open", { path: resolve("tests/desktop/excel/dates-1904.xlsx") }) as { workbookId: string; dateSystem: string };
      expect(opened.dateSystem).toBe("1904");
      const target = { workbookId: opened.workbookId, worksheetId: "Datos", address: "A1:A4" };
      await session.execute("excel.range.writeValues", { ...target, values: [[0], [1], [1462], ["2026-11-03"]] });
      await session.execute("excel.range.format", { ...target, format: { numberFormat: "yyyy-mm-dd" } });
      const result = await session.execute("excel.range.read", target) as ExcelRangeResult;
      expect(result.dateSystem).toBe("1904"); expect(result.values).toEqual([[0], [1], [1462], ["2026-11-03"]]);
      await session.execute("excel.workbook.close", { workbookId: opened.workbookId, saveChanges: false });
    } finally { await session.dispose(); }
  });
  it.skipIf(process.platform !== "darwin")("rejects a workbook owned by another session without changing it", async () => {
    const owner = new ExcelSession(), other = new ExcelSession();
    try {
      const b = await owner.execute("excel.workbook.open", { path: resolve("tests/desktop/excel/template.xlsx") }) as { workbookId: string };
      await expect(other.execute("excel.workbook.open", { path: resolve("tests/desktop/excel/template.xlsx") })).rejects.toThrow(/ajenos/);
      const result = await owner.execute("excel.range.read", { workbookId: b.workbookId, worksheetId: "Datos", address: "A2:B2" }) as ExcelRangeResult;
      expect(result.values).toEqual([[10, 2]]);
      await owner.execute("excel.workbook.close", { workbookId: b.workbookId, saveChanges: false });
    } finally { await other.dispose(); await owner.dispose(); }
  });

});
