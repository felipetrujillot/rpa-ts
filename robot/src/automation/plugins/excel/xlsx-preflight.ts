import { assertSupportedExcelFormula } from "@rpa/contracts";
import { readFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import { ExcelError } from "./adapter";

// Bounded ZIP reader: no extraction, paths or executable code. ZIP64/encryption are outside the MVP.
export async function preflightXlsx(path: string) {
  const data = await readFile(path);
  let end = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) {
    if (data.readUInt32LE(i) === 0x06054b50 && i + 22 + data.readUInt16LE(i + 20) === data.length) { end = i; break; }
  }
  const reject = (message: string): never => { throw new ExcelError(message); };
  if (end < 0 || data.readUInt16LE(end + 4) || data.readUInt16LE(end + 6)) reject("XLSX ZIP inválido, cifrado o multipartes.");
  const count = data.readUInt16LE(end + 10);
  let offset = data.readUInt32LE(end + 16), bytes = 0;
  let workbook = false, contentTypes = false;
  const names = new Set<string>();
  if (count === 65535 || count > 10000 || offset === 0xffffffff) reject("XLSX ZIP64 o demasiado complejo.");
  for (let i = 0; i < count; i++) {
    if (offset + 46 > data.length || data.readUInt32LE(offset) !== 0x02014b50) reject("Directorio XLSX inválido.");
    const flags = data.readUInt16LE(offset + 8), method = data.readUInt16LE(offset + 10);
    const compressed = data.readUInt32LE(offset + 20), size = data.readUInt32LE(offset + 24);
    const nameLength = data.readUInt16LE(offset + 28), extra = data.readUInt16LE(offset + 30), comment = data.readUInt16LE(offset + 32);
    const local = data.readUInt32LE(offset + 42);
    const name = data.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    offset += 46 + nameLength + extra + comment;
    if (flags & 1 || ![0, 8].includes(method) || names.has(name) || name.includes("..") || name.startsWith("/") || name.includes("\\")) reject("Entrada ZIP XLSX no soportada.");
    names.add(name);
    bytes += size;
    if (bytes > 100_000_000 || size > 20_000_000) reject("Contenido XLSX descomprimido fuera de límites.");
    if (/vbaProject|macroSheets|dialogSheets|externalLinks|connections\.xml|queryTables|activeX|embeddings|webExtensions/i.test(name)) reject("El XLSX contiene macros, conexiones u objetos externos no soportados.");
    if (local + 30 > data.length || data.readUInt32LE(local) !== 0x04034b50) reject("Entrada local ZIP inválida.");
    const localNameLength = data.readUInt16LE(local + 26);
    if (data.readUInt16LE(local + 6) !== flags || data.readUInt16LE(local + 8) !== method || data.subarray(local + 30, local + 30 + localNameLength).toString("utf8") !== name) reject("Cabecera ZIP inconsistente.");
    const start = local + 30 + localNameLength + data.readUInt16LE(local + 28);
    if (start + compressed > data.length) reject("Entrada ZIP truncada.");
    if (!/\.(xml|rels)$/i.test(name)) continue;
    const packed = data.subarray(start, start + compressed);
    const rawXml = (method === 0 ? packed : inflateRawSync(packed, { maxOutputLength: 20_000_000 })).toString("utf8");
    if (Buffer.byteLength(rawXml) !== size) reject("Tamaño ZIP inválido.");
    const xml = rawXml.replace(/&#(x[0-9a-f]+|[0-9]+);|&(amp|quot|apos|lt|gt);/gi, (_, numeric: string | undefined, named: string | undefined) => {
      if (numeric) return String.fromCodePoint(numeric.toLowerCase().startsWith("x") ? parseInt(numeric.slice(1), 16) : Number(numeric));
      return ({ amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" } as Record<string, string>)[named!.toLowerCase()]!;
    });
    if (/<!DOCTYPE|<!ENTITY|TargetMode\s*=\s*["']External["']|macroEnabled|macrosheet/i.test(xml)) reject("Referencias externas o macros no soportadas.");
    if (/<(?:\w+:)?f\b[^>]*\bt=["']array["']|_xlfn\./i.test(xml)) reject("Fórmulas matriciales o de versión futura no soportadas.");
    for (const match of xml.matchAll(/<(?:\w+:)?(?:f|definedName)\b[^>]*>([^<]*)<\//gi)) {
      try { assertSupportedExcelFormula(match[1]!); }
      catch { reject("El XLSX contiene fórmulas externas o dinámicas no soportadas."); }
    }
    if (name === "xl/workbook.xml") workbook = true;
    if (name === "[Content_Types].xml" && xml.includes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml")) contentTypes = true;
  }
  if (!workbook || !contentTypes) reject("El archivo no es un libro XLSX sin macros.");
}
