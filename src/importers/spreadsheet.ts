import type { FormatDefinition } from "../core/schema";
import { familyForDimensions } from "../core/catalog";

export type SizeUnit = "px" | "mm" | "cm" | "m" | "in" | "ft";

export interface ExtractedFormat extends FormatDefinition {
  sourceRow: number;
  sourceText: string;
  sourceUnit: SizeUnit;
  sourceWidth: number;
  sourceHeight: number;
  dpi: number | null;
  printScalePercent: number | null;
  confidence: number;
}

export interface SpreadsheetExtraction {
  fileName: string;
  sheetName: string;
  headers: string[];
  sampleRows: unknown[][];
  formats: ExtractedFormat[];
  skippedRows: number;
  digitalRows: number;
  physicalRows: number;
  method: string;
}

export interface ExtractionOptions {
  printDpi: number;
  printScalePercent: number;
}

function normaliseHeader(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");
}

function inferUnit(value: string, header: string): SizeUnit {
  const haystack = `${value} ${header}`.toLowerCase();
  if (/\b(mm|millimet(?:re|er)s?)\b/.test(haystack)) return "mm";
  if (/\b(cm|centimet(?:re|er)s?)\b/.test(haystack)) return "cm";
  if (/\b(ft|feet|foot)\b/.test(haystack)) return "ft";
  if (/\b(in|inch|inches)\b/.test(haystack) || /["″]/.test(haystack)) return "in";
  if (/\b(m|met(?:re|er)s?)\b/.test(haystack)) return "m";
  return "px";
}

function toPixels(value: number, unit: SizeUnit, dpi: number, scalePercent: number) {
  if (unit === "px") return Math.round(value);
  const inches = unit === "mm" ? value / 25.4 : unit === "cm" ? value / 2.54 : unit === "m" ? value * 39.3700787 : unit === "ft" ? value * 12 : value;
  return Math.max(1, Math.round(inches * dpi * (scalePercent / 100)));
}

function parseDimension(value: unknown, header = ""): { width: number; height: number; unit: SizeUnit; raw: string } | null {
  const raw = String(value ?? "").trim();
  const match = raw.match(/(\d+(?:[.,]\d+)?)\s*(?:x|×|by|\*)\s*(\d+(?:[.,]\d+)?)\s*(px|pixels?|mm|cm|m|metres?|meters?|in|inch(?:es)?|ft|feet|foot|["″])?/i);
  if (!match) return null;
  const width = Number(match[1].replace(",", "."));
  const height = Number(match[2].replace(",", "."));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width, height, unit: inferUnit(match[3] || raw, header), raw };
}

function numeric(value: unknown) {
  const match = String(value ?? "").replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : NaN;
}

export async function readSpreadsheet(file: File, options: ExtractionOptions): Promise<SpreadsheetExtraction> {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: false, codepage: 65001 });
  const sheetName = workbook.SheetNames[0];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: "", raw: false });
  const headerIndex = matrix.findIndex((row) => row.some((cell) => String(cell).trim()));
  const headers = (matrix[headerIndex] || []).map((cell) => String(cell).trim());
  const headerKeys = headers.map(normaliseHeader);
  const rows = matrix.slice(headerIndex + 1);
  const combinedIndex = headerKeys.findIndex((header) => /(^| )(dimensions?|resolution|pixel dimensions?|format size|artwork size|screen size)( |$)/.test(header));
  const widthIndex = headerKeys.findIndex((header) => /(^| )(pixel )?(artwork )?(screen )?width( |$)/.test(header) || header === "w");
  const heightIndex = headerKeys.findIndex((header) => /(^| )(pixel )?(artwork )?(screen )?height( |$)/.test(header) || header === "h");
  const nameIndex = headerKeys.findIndex((header) => /(^| )(format|screen|site|placement|name|description)( |$)/.test(header));
  const ownerIndex = headerKeys.findIndex((header) => /(^| )(media owner|owner|supplier|network)( |$)/.test(header));
  const unitIndex = headerKeys.findIndex((header) => header === "unit" || header === "units");
  const formats: ExtractedFormat[] = [];
  let skippedRows = 0;

  rows.forEach((row, rowIndex) => {
    if (!row.some((cell) => String(cell).trim())) return;
    let parsed = combinedIndex >= 0 ? parseDimension(row[combinedIndex], headers[combinedIndex]) : null;
    if (!parsed) {
      for (let column = 0; column < row.length; column += 1) {
        parsed = parseDimension(row[column], headers[column] || "");
        if (parsed) break;
      }
    }
    if (!parsed && widthIndex >= 0 && heightIndex >= 0) {
      const width = numeric(row[widthIndex]);
      const height = numeric(row[heightIndex]);
      if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
        const unitText = unitIndex >= 0 ? String(row[unitIndex]) : `${headers[widthIndex]} ${headers[heightIndex]}`;
        parsed = { width, height, unit: inferUnit(unitText, unitText), raw: `${row[widthIndex]} × ${row[heightIndex]} ${unitText}`.trim() };
      }
    }
    if (!parsed) { skippedRows += 1; return; }
    const width = toPixels(parsed.width, parsed.unit, options.printDpi, options.printScalePercent);
    const height = toPixels(parsed.height, parsed.unit, options.printDpi, options.printScalePercent);
    const sourceRow = headerIndex + rowIndex + 2;
    const name = nameIndex >= 0 && String(row[nameIndex]).trim() ? String(row[nameIndex]).trim() : `Format ${sourceRow}`;
    const mediaOwner = ownerIndex >= 0 && String(row[ownerIndex]).trim() ? String(row[ownerIndex]).trim() : file.name;
    formats.push({
      id: `import-${sourceRow}-${width}x${height}`,
      name,
      width,
      height,
      family: familyForDimensions(width, height),
      mediaOwner,
      sourceRow,
      sourceText: parsed.raw,
      sourceUnit: parsed.unit,
      sourceWidth: parsed.width,
      sourceHeight: parsed.height,
      dpi: parsed.unit === "px" ? null : options.printDpi,
      printScalePercent: parsed.unit === "px" ? null : options.printScalePercent,
      confidence: combinedIndex >= 0 || (widthIndex >= 0 && heightIndex >= 0) ? 0.99 : 0.82,
    });
  });

  return {
    fileName: file.name,
    sheetName,
    headers,
    sampleRows: rows.slice(0, 12),
    formats,
    skippedRows,
    digitalRows: formats.filter((format) => format.sourceUnit === "px").length,
    physicalRows: formats.filter((format) => format.sourceUnit !== "px").length,
    method: combinedIndex >= 0 ? `Combined dimensions in “${headers[combinedIndex]}”` : widthIndex >= 0 && heightIndex >= 0 ? `Separate “${headers[widthIndex]}” and “${headers[heightIndex]}” columns` : "Dimensions detected across mixed columns",
  };
}
