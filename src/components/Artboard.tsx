import type { CSSProperties } from "react";
import { AlertTriangle, Check, MoveUpRight } from "lucide-react";
import type { DcoTemplate, FormatDefinition, LayerStyle, SemanticLayer } from "../core/schema";
import { fitTypeToBox, layerWithinCanvas, resolveLayer, smartTypeSize } from "../core/schema";

interface ArtboardProps {
  template: DcoTemplate;
  format: FormatDefinition;
  active: boolean;
  selectedLayerId: string;
  guides: boolean;
  tints: boolean;
  onSelect: () => void;
  onLayerSelect: (id: string) => void;
}

function layerCss(style: LayerStyle, format: FormatDefinition): CSSProperties {
  return {
    left: `${style.x}%`,
    top: `${style.y}%`,
    width: `${style.width}%`,
    height: `${style.height}%`,
    opacity: style.opacity ?? 1,
    color: style.color,
    fontSize: `${smartTypeSize(style, format)}cqmin`,
    lineHeight: style.lineHeight,
    WebkitLineClamp: style.maxLines,
  };
}

function layerNode(layer: SemanticLayer, style: LayerStyle, format: FormatDefinition) {
  if (layer.role === "background") {
    return <div className="creative-background" style={{ backgroundPosition: `${style.focalX}% ${style.focalY}%`, inset: `-${style.bleed || 0}%` }} />;
  }
  if (layer.role === "hero") {
    const gradientId = `glass-${layer.id}-${format.id}`.replace(/[^a-z0-9-]/gi, "-");
    const glowId = `glow-${layer.id}-${format.id}`.replace(/[^a-z0-9-]/gi, "-");
    return (
      <svg className="hero-product" viewBox="0 0 820 1280" preserveAspectRatio="xMidYMid meet" role="img" aria-label={`${layer.name}, proportions preserved`}>
        <defs>
          <radialGradient id={glowId}><stop offset="0" stopColor="#9affdf" stopOpacity=".52" /><stop offset="1" stopColor="#9affdf" stopOpacity="0" /></radialGradient>
          <linearGradient id={gradientId} x1="0" x2="1"><stop stopColor="#dffff8" stopOpacity=".34" /><stop offset=".4" stopColor="#35d9bc" stopOpacity=".14" /><stop offset=".8" stopColor="#551a77" stopOpacity=".48" /><stop offset="1" stopColor="#ffffff" stopOpacity=".2" /></linearGradient>
        </defs>
        <ellipse cx="410" cy="690" rx="390" ry="560" fill={`url(#${glowId})`} />
        <path d="M330 210V70Q330 35 365 35H455Q490 35 490 70V210" fill={`url(#${gradientId})`} stroke="#e8fff7" strokeOpacity=".62" strokeWidth="9" />
        <rect x="105" y="190" width="610" height="1025" rx="155" fill={`url(#${gradientId})`} stroke="#e8fff7" strokeOpacity=".7" strokeWidth="10" />
        <path d="M170 315Q155 650 205 1030" fill="none" stroke="#ffffff" strokeOpacity=".2" strokeWidth="18" strokeLinecap="round" />
        <text x="410" y="410" textAnchor="middle" fill="#effff6" fontSize="42" fontWeight="700">0.0</text>
        <text x="410" y="710" textAnchor="middle" fill="#effff6" fontSize="190" fontWeight="800">N★</text>
        <text x="410" y="815" textAnchor="middle" fill="#effff6" fontSize="34" fontWeight="700" letterSpacing="8">BOTANICAL</text>
      </svg>
    );
  }
  if (layer.role === "cta") return <span className="cta-copy">{style.content}<MoveUpRight size="1em" /></span>;
  return <span className={`copy copy-${layer.role}`}>{style.content}</span>;
}

export function Artboard({ template, format, active, selectedLayerId, guides, tints, onSelect, onLayerSelect }: ArtboardProps) {
  const ratio = format.width / format.height;
  const resolvedLayers = template.layers.map((layer) => ({ layer, style: resolveLayer(template, layer.id, format) }));
  const reviewReasons = resolvedLayers.flatMap(({ layer, style }) => {
    const reasons: string[] = [];
    if (!layerWithinCanvas(style) && layer.role !== "background") reasons.push(`${layer.name} exceeds the canvas`);
    if (style.content && fitTypeToBox(style, format).belowMinimum) reasons.push(`${layer.name} falls below its minimum type size`);
    return reasons;
  });
  const frameStyle = {
    "--format-ratio": ratio,
    aspectRatio: ratio,
    width: ratio >= 1 ? "100%" : "auto",
    height: ratio >= 1 ? "auto" : "166px",
  } as CSSProperties;
  return (
    <article className={`artboard-card ${active ? "active" : ""}`} onClick={onSelect}>
      <header>
        <div>
          <strong>{format.name}</strong>
          <span>{format.mediaOwner}</span>
        </div>
        <span className="format-size">{format.width} × {format.height}</span>
      </header>
      <div className="artboard-viewport">
        <div className="creative-stage" style={frameStyle} data-family={format.family}>
          {resolvedLayers.map(({ layer, style }) => {
            return (
              <button
                key={layer.id}
                type="button"
                className={`creative-layer role-${layer.role} ${selectedLayerId === layer.id && active ? "selected" : ""}`}
                style={layerCss(style, format)}
                onClick={(event) => { event.stopPropagation(); onSelect(); onLayerSelect(layer.id); }}
                aria-label={`Select ${layer.name}`}
              >
                {layerNode(layer, style, format)}
              </button>
            );
          })}
          {tints && <div className="layout-tints" aria-hidden="true"><span /><span /><span /></div>}
          {guides && <div className="safe-guide" style={{ inset: `${template.rules.safeArea}%` }} aria-hidden="true"><span>safe</span></div>}
        </div>
      </div>
      <footer>
        <span className={reviewReasons.length ? "verified needs-review" : "verified"} title={reviewReasons.join("; ")}>
          {reviewReasons.length ? <AlertTriangle size={12} /> : <Check size={12} />}{reviewReasons.length ? "Needs refinement" : "Verified"}
        </span>
        <span>{format.family}</span>
      </footer>
    </article>
  );
}
