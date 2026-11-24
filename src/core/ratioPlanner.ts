import type { FormatDefinition } from "./schema";

export interface RatioPlanOptions {
  floatTolerance: number;
  cropTolerance: number;
  allowDownscale: boolean;
}

export interface PlannedTarget {
  format: FormatDefinition;
  method: "master" | "downscale" | "float" | "crop";
  loss: number;
}

export interface PlannedMaster {
  id: string;
  format: FormatDefinition;
  targets: PlannedTarget[];
}

export interface RatioPlan {
  inputCount: number;
  uniqueCount: number;
  exactRatioCount: number;
  masters: PlannedMaster[];
  savedFiles: number;
}

const area = (format: FormatDefinition) => format.width * format.height;
const ratio = (format: FormatDefinition) => format.width / format.height;
const sameRatio = (a: FormatDefinition, b: FormatDefinition) => Math.abs(a.width * b.height - a.height * b.width) < 1e-6 * a.width * b.height;

function fitCandidate(master: FormatDefinition, target: FormatDefinition, options: RatioPlanOptions) {
  const fitScale = Math.min(target.width / master.width, target.height / master.height);
  const coverScale = Math.max(target.width / master.width, target.height / master.height);
  if (sameRatio(master, target) && coverScale <= 1 + 1e-9 && options.allowDownscale) return { method: "downscale" as const, loss: 0 };
  if (fitScale <= 1 + 1e-9) {
    const fittedArea = master.width * fitScale * master.height * fitScale;
    const floatLoss = 1 - fittedArea / area(target);
    if (floatLoss <= options.floatTolerance) return { method: "float" as const, loss: floatLoss };
  }
  if (coverScale <= 1 + 1e-9) {
    const coveredArea = master.width * coverScale * master.height * coverScale;
    const cropLoss = 1 - area(target) / coveredArea;
    if (cropLoss <= options.cropTolerance) return { method: "crop" as const, loss: cropLoss };
  }
  return null;
}

export function planRatioFootprint(formats: FormatDefinition[], options: RatioPlanOptions): RatioPlan {
  const unique = [...new Map(formats.map((format) => [`${format.width}x${format.height}`, format])).values()].sort((a, b) => area(b) - area(a));
  const masters: PlannedMaster[] = [];
  for (const target of unique) {
    const candidates = masters.map((master) => ({ master, fit: fitCandidate(master.format, target, options) })).filter((candidate) => candidate.fit).sort((a, b) => a.fit!.loss - b.fit!.loss);
    if (candidates.length) {
      candidates[0].master.targets.push({ format: target, method: candidates[0].fit!.method, loss: candidates[0].fit!.loss });
    } else {
      masters.push({ id: `master-${target.width}x${target.height}`, format: target, targets: [{ format: target, method: "master", loss: 0 }] });
    }
  }
  return {
    inputCount: formats.length,
    uniqueCount: unique.length,
    exactRatioCount: new Set(unique.map((format) => ratio(format).toFixed(8))).size,
    masters,
    savedFiles: Math.max(0, unique.length - masters.length),
  };
}
