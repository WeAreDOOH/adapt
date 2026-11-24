import type { FormatDefinition, FormatFamily } from "./schema";

export interface CatalogFormat extends FormatDefinition {
  aspectRatio: string;
  sourceRow: number;
}

export interface CatalogSummary {
  specifications: number;
  uniqueDimensions: number;
  uniqueRatios: number;
  mediaOwners: number;
}

function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

export function familyForDimensions(width: number, height: number): FormatFamily {
  const ratio = width / height;
  if (ratio >= 2.4) return "ribbon";
  if (ratio > 1.08) return "landscape";
  if (ratio < 0.92) return "portrait";
  return "square";
}

export function parseFormatCatalog(text: string): CatalogFormat[] {
  const [header, ...data] = csvRows(text.replace(/^\uFEFF/, ""));
  if (!header) return [];
  const columns = Object.fromEntries(header.map((name, index) => [name.trim(), index]));
  return data.flatMap((values, index) => {
    const dimensions = values[columns.Dimensions]?.trim() || "";
    const match = dimensions.match(/^(\d+)\s*[x×]\s*(\d+)$/i);
    if (!match) return [];
    const width = Number(match[1]);
    const height = Number(match[2]);
    const mediaOwner = values[columns["Media Owner"]]?.trim() || "Unknown media owner";
    const name = values[columns.Format]?.trim() || dimensions;
    return [{
      id: `catalog-${index + 2}-${width}x${height}`,
      name,
      width,
      height,
      family: familyForDimensions(width, height),
      mediaOwner,
      aspectRatio: values[columns["Aspect Ratio"]]?.trim() || `${width}:${height}`,
      sourceRow: index + 2,
    }];
  });
}

export function summariseCatalog(formats: CatalogFormat[]): CatalogSummary {
  return {
    specifications: formats.length,
    uniqueDimensions: new Set(formats.map((format) => `${format.width}x${format.height}`)).size,
    uniqueRatios: new Set(formats.map((format) => format.aspectRatio)).size,
    mediaOwners: new Set(formats.map((format) => format.mediaOwner)).size,
  };
}
