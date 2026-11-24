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
  intrinsicAspectRatio?: number;
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

export interface TypeFitResult {
  fontSize: number;
  requestedSize: number;
  minimumSize: number;
  belowMinimum: boolean;
  estimatedLines: number;
}

function characterWidth(text: string) {
  return [...text].reduce((total, character) => total + (character === " " ? 0.3 : /[MW@#★]/.test(character) ? 0.82 : /[I1|]/.test(character) ? 0.34 : 0.56), 0);
}

export function fitTypeToBox(style: LayerStyle, format: FormatDefinition): TypeFitResult {
  const copy = (style.content || "").trim();
  const aspect = format.width / format.height;
  const collapseToOneLine = format.family === "ribbon";
  const lines = collapseToOneLine ? [copy.replace(/\s+/g, " ")] : (copy.split(/\n/).filter(Boolean).length ? copy.split(/\n/).filter(Boolean) : [copy]);
  const longestLine = Math.max(1, ...lines.map(characterWidth));
  // Type is expressed in cqmin: a percentage of the shorter canvas edge. This
  // remains stable for towers and ribbons, unlike width-only cqw sizing.
  const boxWidth = aspect >= 1 ? style.width * aspect : style.width;
  const boxHeight = aspect >= 1 ? style.height : style.height / Math.max(aspect, 0.0001);
  const widthLimit = boxWidth / longestLine;
  const heightLimit = boxHeight / (Math.max(1, lines.length) * Math.max(0.72, style.lineHeight || 1) * 1.08);
  const requestedSize = style.fontSize || 6;
  const fontSize = Math.max(0.25, Math.min(requestedSize, widthLimit, heightLimit));
  const minimumSize = style.minFontSize || Math.min(1, requestedSize);
  return { fontSize, requestedSize, minimumSize, belowMinimum: fontSize + 0.001 < minimumSize, estimatedLines: lines.length };
}

export function smartTypeSize(style: LayerStyle, format: FormatDefinition): number {
  return fitTypeToBox(style, format).fontSize;
}

export function layerWithinCanvas(style: LayerStyle): boolean {
  return style.x >= 0 && style.y >= 0 && style.width >= 0 && style.height >= 0 && style.x + style.width <= 100 && style.y + style.height <= 100;
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
