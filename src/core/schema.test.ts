import { describe, expect, it } from "vitest";
import { createSampleTemplate } from "./sample";
import { applyScopedPatch, ratioSimilarity, resolveLayer, similarFormats, smartTypeSize } from "./schema";

describe("DCO template cascade", () => {
  it("resolves global, family, then local values in order", () => {
    const template = createSampleTemplate();
    const format = template.formats.find((item) => item.id === "six-sheet")!;
    const withGlobal = applyScopedPatch(template, "headline", { fontSize: 9, content: "GLOBAL" }, "global", format);
    const withFamily = applyScopedPatch(withGlobal, "headline", { content: "PORTRAIT" }, "family", format);
    const withLocal = applyScopedPatch(withFamily, "headline", { content: "LOCAL" }, "local", format);
    expect(resolveLayer(withLocal, "headline", format).fontSize).toBe(7.2);
    expect(resolveLayer(withLocal, "headline", format).content).toBe("LOCAL");
  });

  it("finds closely matched ratios without merging different families blindly", () => {
    const template = createSampleTemplate();
    const portrait = template.formats.find((item) => item.id === "portrait-d6")!;
    const neighbours = similarFormats(template, portrait);
    expect(neighbours.map((item) => item.id)).toContain("portrait-4k");
    expect(neighbours.map((item) => item.id)).not.toContain("square");
    expect(ratioSimilarity(portrait, template.formats.find((item) => item.id === "portrait-4k")!)).toBe(1);
  });

  it("scales long copy while respecting the minimum type size", () => {
    const template = createSampleTemplate();
    const ribbon = template.formats.find((item) => item.id === "ribbon")!;
    const style = { ...resolveLayer(template, "headline", ribbon), content: "A MUCH LONGER HEADLINE FOR A VERY WIDE OOH RIBBON" };
    const size = smartTypeSize(style, ribbon);
    expect(size).toBeGreaterThanOrEqual(style.minFontSize!);
    expect(size).toBeLessThan(style.fontSize!);
  });
});
