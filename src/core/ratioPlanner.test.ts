import { describe, expect, it } from "vitest";
import type { FormatDefinition } from "./schema";
import { planRatioFootprint } from "./ratioPlanner";

const make = (id: string, width: number, height: number): FormatDefinition => ({ id, name: id, width, height, family: width > height ? "landscape" : "portrait", mediaOwner: "Test" });

describe("Ratios-style footprint planner", () => {
  it("uses one master for exact-ratio downscales", () => {
    const plan = planRatioFootprint([make("4k", 3840, 2160), make("hd", 1920, 1080), make("small", 1280, 720)], { allowDownscale: true, floatTolerance: 0, cropTolerance: 0 });
    expect(plan.masters).toHaveLength(1);
    expect(plan.masters[0].targets.map((target) => target.method)).toEqual(["master", "downscale", "downscale"]);
  });

  it("combines close ratios only when the declared tolerance allows it", () => {
    const formats = [make("master", 2000, 1000), make("near", 1920, 1080)];
    expect(planRatioFootprint(formats, { allowDownscale: true, floatTolerance: 0, cropTolerance: 0 }).masters).toHaveLength(2);
    expect(planRatioFootprint(formats, { allowDownscale: true, floatTolerance: 0.12, cropTolerance: 0 }).masters).toHaveLength(1);
  });

  it("deduplicates repeated delivery sizes while preserving the input count", () => {
    const plan = planRatioFootprint([make("a", 1080, 1920), make("b", 1080, 1920)], { allowDownscale: true, floatTolerance: 0.1, cropTolerance: 0.05 });
    expect(plan.inputCount).toBe(2);
    expect(plan.uniqueCount).toBe(1);
  });
});
