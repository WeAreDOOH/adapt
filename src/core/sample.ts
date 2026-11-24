import type { DcoTemplate, FormatDefinition, SemanticLayer } from "./schema";
import { DCO_SCHEMA, DCO_VERSION } from "./schema";

export const SAMPLE_FORMATS: FormatDefinition[] = [
  { id: "landscape-6x3", name: "Landscape 6×3", width: 1920, height: 1080, family: "landscape", mediaOwner: "Ocean" },
  { id: "landscape-hd", name: "Landscape HD", width: 1366, height: 768, family: "landscape", mediaOwner: "JCDecaux" },
  { id: "portrait-d6", name: "Portrait D6", width: 1080, height: 1920, family: "portrait", mediaOwner: "Clear Channel" },
  { id: "portrait-4k", name: "Portrait 4K", width: 2160, height: 3840, family: "portrait", mediaOwner: "Ocean" },
  { id: "six-sheet", name: "Digital six sheet", width: 768, height: 1024, family: "portrait", mediaOwner: "Global" },
  { id: "square", name: "Square retail", width: 1080, height: 1080, family: "square", mediaOwner: "Retail" },
  { id: "ribbon", name: "Ribbon XL", width: 2560, height: 640, family: "ribbon", mediaOwner: "Network Rail" },
  { id: "cinema", name: "Ultra landscape", width: 3840, height: 1080, family: "ribbon", mediaOwner: "Ocean" },
];

const layers: SemanticLayer[] = [
  { id: "background", sourceName: "01_BG_EXTEND", name: "Night gradient", role: "background", kind: "image", confidence: 1, style: { x: 0, y: 0, width: 100, height: 100, fit: "cover", focalX: 62, focalY: 48, bleed: 8 } },
  { id: "hero", sourceName: "02_HERO_PRODUCT", name: "Aurora bottle", role: "hero", kind: "image", confidence: 0.98, style: { x: 48, y: 12, width: 46, height: 76, fit: "contain", anchor: "right" } },
  { id: "logo", sourceName: "03_LOGO_LOCKUP", name: "Northstar lock-up", role: "logo", kind: "text", confidence: 1, style: { content: "NORTH\nSTAR", x: 6, y: 6, width: 18, height: 8, anchor: "top-left", fontSize: 2.4, minFontSize: 1.8, maxLines: 2, lineHeight: 0.8, color: "#efffe4" } },
  { id: "eyebrow", sourceName: "04_CAMPAIGN_LABEL", name: "Campaign label", role: "eyebrow", kind: "text", confidence: 0.96, style: { content: "ZERO PROOF / FULL COLOUR", x: 7, y: 25, width: 42, height: 5, anchor: "left", fontSize: 1.35, minFontSize: 1, maxLines: 1, lineHeight: 1, color: "#d8ff62" } },
  { id: "headline", sourceName: "05_HEADLINE_EDITABLE", name: "Hero headline", role: "headline", kind: "text", confidence: 1, style: { content: "BRIGHTER\nAFTER DARK", x: 7, y: 31, width: 48, height: 32, anchor: "left", fontSize: 7.6, minFontSize: 3.2, maxLines: 3, lineHeight: 0.84, color: "#f4f2ea" } },
  { id: "body", sourceName: "06_BODY_COPY", name: "Supporting copy", role: "body", kind: "text", confidence: 0.94, style: { content: "Botanical flavour. Electric finish.\nA new kind of nightcap.", x: 7, y: 68, width: 36, height: 10, anchor: "bottom-left", fontSize: 1.45, minFontSize: 1.05, maxLines: 3, lineHeight: 1.35, color: "#c8ccd3" } },
  { id: "cta", sourceName: "07_CTA", name: "Call to action", role: "cta", kind: "shape", confidence: 0.93, style: { content: "TASTE THE NIGHT  ↗", x: 7, y: 82, width: 21, height: 7, anchor: "bottom-left", fontSize: 1.05, minFontSize: 0.9, maxLines: 1, lineHeight: 1, color: "#10110f" } },
  { id: "legal", sourceName: "08_LEGAL", name: "Legal copy", role: "legal", kind: "text", confidence: 0.91, style: { content: "NORTHSTARDRINKS.COM   0.0% ABV", x: 7, y: 93, width: 36, height: 3, anchor: "bottom-left", fontSize: 0.66, minFontSize: 0.55, maxLines: 1, lineHeight: 1, color: "#878b91" } },
];

export function createSampleTemplate(): DcoTemplate {
  return {
    schema: DCO_SCHEMA,
    version: DCO_VERSION,
    id: "northstar-night-001",
    name: "Northstar / Brighter after dark",
    source: {
      adapter: "demo",
      fileName: "northstar-prepared-layout.demo.psd",
      realImport: false,
      importedAt: "2026-11-24T09:45:00.000Z",
    },
    formats: structuredClone(SAMPLE_FORMATS),
    layers: structuredClone(layers),
    overrides: {
      global: {},
      families: {
        portrait: {
          hero: { x: 18, y: 36, width: 68, height: 52 },
          headline: { x: 8, y: 17, width: 84, height: 23, fontSize: 8.4 },
          eyebrow: { x: 8, y: 12, width: 76 },
          body: { x: 8, y: 75, width: 70 },
          cta: { x: 8, y: 86, width: 42 },
          legal: { x: 8, y: 95, width: 70 },
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
      },
      formats: {
        "six-sheet": {
          headline: { fontSize: 7.2, y: 18 },
          hero: { x: 16, y: 38, width: 72, height: 48 },
        },
      },
    },
    rules: { safeArea: 5, backgroundBleed: 8, refineSimilarRatios: true, similarityTolerance: 0.035 },
  };
}
