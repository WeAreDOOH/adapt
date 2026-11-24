import type { ImportAdapter } from "./types";
import { psdAdapter } from "./psd";

function plannedAdapter(id: "after-effects" | "indesign" | "figma", label: string, extensions: string[]): ImportAdapter {
  return {
    id,
    label,
    extensions,
    status: "planned",
    async import() {
      throw new Error(`${label} import is planned but not enabled in this demo.`);
    },
  };
}

export const importAdapters: ImportAdapter[] = [
  psdAdapter,
  plannedAdapter("after-effects", "After Effects", [".aep", ".aepx"]),
  plannedAdapter("indesign", "InDesign", [".indd", ".idml"]),
  plannedAdapter("figma", "Figma", [".fig", ".json"]),
];

export { psdAdapter } from "./psd";
