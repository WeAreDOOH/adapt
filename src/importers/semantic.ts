import type { LayerKind, LayerRole, SemanticLayer } from "../core/schema";

const RULES: Array<[LayerRole, RegExp]> = [
  ["background", /\b(bg|back|background|extend|bleed)\b/i],
  ["logo", /\b(logo|brand|lock[ -]?up|wordmark|mark)\b/i],
  ["headline", /\b(head|headline|title|hero copy)\b/i],
  ["eyebrow", /\b(eyebrow|campaign|label|kicker)\b/i],
  ["body", /\b(body|description|support|subcopy)\b/i],
  ["cta", /\b(cta|button|call.to.action)\b/i],
  ["legal", /\b(legal|terms|disclaimer|footer)\b/i],
  ["hero", /\b(hero|product|pack|bottle|key.visual)\b/i],
];

export function inferRole(name: string): { role: LayerRole; confidence: number } {
  const match = RULES.find(([, pattern]) => pattern.test(name.replaceAll("_", " ")));
  return match ? { role: match[0], confidence: 0.94 } : { role: "hero", confidence: 0.52 };
}

export function semanticLayerFromSource(input: { id: string; name: string; kind?: LayerKind; text?: string; x?: number; y?: number; width?: number; height?: number; intrinsicAspectRatio?: number }): SemanticLayer {
  const inferred = inferRole(input.name);
  return {
    id: input.id,
    sourceName: input.name,
    name: input.name.replace(/^\d+[_ -]*/, "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
    role: inferred.role,
    kind: input.kind || (input.text ? "text" : "image"),
    confidence: inferred.confidence,
    style: {
      content: input.text,
      x: input.x ?? 10,
      y: input.y ?? 10,
      width: input.width ?? 40,
      height: input.height ?? 20,
      fit: "contain",
      color: "#f4f2ea",
      fontSize: inferred.role === "headline" ? 7 : 1.4,
      minFontSize: inferred.role === "headline" ? 3 : 0.8,
      maxLines: inferred.role === "headline" ? 3 : 4,
      lineHeight: inferred.role === "headline" ? 0.9 : 1.25,
      intrinsicAspectRatio: input.intrinsicAspectRatio,
    },
  };
}
