import { describe, expect, it } from "vitest";
import { readSpreadsheet } from "./spreadsheet";

describe("spreadsheet size extraction", () => {
  it("finds combined pixel dimensions in a CSV", async () => {
    const file = new File([
      "Media Owner,Format,Dimensions\nOcean,Landscape,1920x1080\nGlobal,Portrait,1080 × 1920\n",
    ], "formats.csv", { type: "text/csv" });
    const result = await readSpreadsheet(file, { printDpi: 400, printScalePercent: 10 });
    expect(result.formats).toHaveLength(2);
    expect(result.formats.map(({ width, height }) => [width, height])).toEqual([[1920, 1080], [1080, 1920]]);
    expect(result.digitalRows).toBe(2);
  });

  it("converts separate physical dimensions using DPI and artwork scale", async () => {
    const file = new File([
      "Name,Width (mm),Height (mm),Unit\nBillboard,6000,3000,mm\n",
    ], "print.csv", { type: "text/csv" });
    const result = await readSpreadsheet(file, { printDpi: 300, printScalePercent: 10 });
    expect(result.formats).toHaveLength(1);
    expect(result.formats[0]).toMatchObject({ width: 7087, height: 3543, sourceUnit: "mm", dpi: 300, printScalePercent: 10 });
    expect(result.physicalRows).toBe(1);
  });

  it("skips non-dimension rows instead of inventing sizes", async () => {
    const file = new File(["Format,Notes\nA,Awaiting spec\nB,1080x1080\n"], "mixed.csv", { type: "text/csv" });
    const result = await readSpreadsheet(file, { printDpi: 400, printScalePercent: 10 });
    expect(result.formats).toHaveLength(1);
    expect(result.skippedRows).toBe(1);
  });
});

