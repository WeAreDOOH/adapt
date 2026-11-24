import type { DcoTemplate, FormatFamily, LayerStyle, SemanticLayer } from "./schema";

const PATCHES: Record<FormatFamily, Partial<Record<string, Partial<LayerStyle>>>> = {
  landscape: {},
  portrait: {
    hero: { x: 18, y: 36, width: 68, height: 52 },
    headline: { x: 8, y: 17, width: 84, height: 23, fontSize: 8.4 },
    eyebrow: { x: 8, y: 12, width: 76 },
    body: { x: 8, y: 75, width: 70 },
    cta: { x: 8, y: 86, width: 42 },
    legal: { x: 8, y: 95, width: 70 },
    logo: { x: 68, y: 6, width: 24, height: 8 },
  },
  square: {
    hero: { x: 43, y: 22, width: 52, height: 66 },
    headline: { x: 7, y: 29, width: 48, fontSize: 7.1 },
  },
  ribbon: {
    hero: { x: 64, y: 5, width: 30, height: 90 },
    logo: { x: 3, y: 9, width: 10, height: 16 },
    eyebrow: { x: 19, y: 17, width: 32 },
    headline: { x: 19, y: 29, width: 42, height: 40, fontSize: 6.4 },
    body: { x: 19, y: 74, width: 27 },
    cta: { x: 49, y: 72, width: 12 },
    legal: { x: 83, y: 90, width: 14 },
  },
};

export function responsiveOverrides(layers: SemanticLayer[]): DcoTemplate["overrides"]["families"] {
  const output: DcoTemplate["overrides"]["families"] = {};
  for (const family of ["portrait", "square", "ribbon"] as FormatFamily[]) {
    const familyLayers: Record<string, Partial<LayerStyle>> = {};
    for (const layer of layers) {
      const patch = PATCHES[family][layer.role];
      if (patch) familyLayers[layer.id] = patch;
    }
    output[family] = familyLayers;
  }
  return output;
}
