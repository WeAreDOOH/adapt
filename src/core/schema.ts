export const DCO_SCHEMA = "dooh.adapt-template" as const;
export const DCO_VERSION = "1.0.0" as const;

export type LayerRole = "background" | "hero" | "logo" | "eyebrow" | "headline" | "body" | "cta" | "legal";
export type LayerKind = "image" | "text" | "shape";
export type FormatFamily = "landscape" | "portrait" | "square" | "ribbon";
export type Anchor = "top-left" | "top" | "top-right" | "left" | "centre" | "right" | "bottom-left" | "bottom" | "bottom-right";
export type ScopeMode = "global" | "family" | "local";

export interface FormatDefinition {
  id: string;
  name: string;
  width: number;
  height: number;
  family: FormatFamily;
  mediaOwner: string;
}

export interface LayerStyle {
  content?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  anchor?: Anchor;
  fontSize?: number;
  minFontSize?: number;
  maxLines?: number;
  lineHeight?: number;
  fit?: "cover" | "contain";
  focalX?: number;
  focalY?: number;
  bleed?: number;
  color?: string;
  opacity?: number;
}

export interface SemanticLayer {
  id: string;
  sourceName: string;
  name: string;
  role: LayerRole;
  kind: LayerKind;
  confidence: number;
  style: LayerStyle;
}

export interface ScopedOverrides {
  global: Record<string, Partial<LayerStyle>>;
  families: Partial<Record<FormatFamily, Record<string, Partial<LayerStyle>>>>;
  formats: Record<string, Record<string, Partial<LayerStyle>>>;
}

export interface DcoTemplate {
  schema: typeof DCO_SCHEMA;
  version: typeof DCO_VERSION;
  id: string;
  name: string;
  source: {
    adapter: "psd" | "demo" | "after-effects" | "indesign" | "figma";
    fileName: string;
    realImport: boolean;
    importedAt: string;
  };
  formats: FormatDefinition[];
  layers: SemanticLayer[];
  overrides: ScopedOverrides;
  rules: {
    safeArea: number;
    backgroundBleed: number;
    refineSimilarRatios: boolean;
    similarityTolerance: number;
  };
}

export function resolveLayer(template: DcoTemplate, layerId: string, format: FormatDefinition): LayerStyle {
  const layer = template.layers.find((candidate) => candidate.id === layerId);
  if (!layer) throw new Error(`Unknown layer: ${layerId}`);
  return {
    ...layer.style,
    ...(template.overrides.global[layerId] || {}),
    ...(template.overrides.families[format.family]?.[layerId] || {}),
    ...(template.overrides.formats[format.id]?.[layerId] || {}),
  };
}

export function ratioSimilarity(a: FormatDefinition, b: FormatDefinition): number {
  const first = a.width / a.height;
  const second = b.width / b.height;
  return Math.max(0, 1 - Math.abs(first / second - 1));
}

export function similarFormats(template: DcoTemplate, format: FormatDefinition): FormatDefinition[] {
  return template.formats.filter((candidate) => ratioSimilarity(format, candidate) >= 1 - template.rules.similarityTolerance);
}

export function smartTypeSize(style: LayerStyle, format: FormatDefinition): number {
  const copy = (style.content || "").trim();
  const words = Math.max(1, copy.split(/\s+/).length);
  const aspect = format.width / format.height;
  const shapeFactor = aspect > 2.4 ? 0.72 : aspect < 0.7 ? 0.9 : 1;
  const copyFactor = Math.max(0.62, Math.min(1, 7 / words));
  const requested = (style.fontSize || 6) * shapeFactor * copyFactor;
  return Math.max(style.minFontSize || 2.6, requested);
}

export function applyScopedPatch(
  template: DcoTemplate,
  layerId: string,
  patch: Partial<LayerStyle>,
  scope: ScopeMode,
  format: FormatDefinition,
): DcoTemplate {
  const next = structuredClone(template);
  if (scope === "global") {
    next.overrides.global[layerId] = { ...(next.overrides.global[layerId] || {}), ...patch };
  } else if (scope === "family") {
    const family = next.overrides.families[format.family] || {};
    family[layerId] = { ...(family[layerId] || {}), ...patch };
    next.overrides.families[format.family] = family;
  } else {
    const local = next.overrides.formats[format.id] || {};
    local[layerId] = { ...(local[layerId] || {}), ...patch };
    next.overrides.formats[format.id] = local;
  }
  return next;
}

export function refineFamilyPatch(template: DcoTemplate, layerId: string, patch: Partial<LayerStyle>, format: FormatDefinition): DcoTemplate {
  const next = structuredClone(template);
  for (const candidate of similarFormats(next, format)) {
    const local = next.overrides.formats[candidate.id] || {};
    local[layerId] = { ...(local[layerId] || {}), ...patch };
    next.overrides.formats[candidate.id] = local;
  }
  return next;
}
