import type { CSSProperties } from "react";
import { Check, MoveUpRight } from "lucide-react";
import type { DcoTemplate, FormatDefinition, LayerStyle, SemanticLayer } from "../core/schema";
import { resolveLayer, smartTypeSize } from "../core/schema";

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
    fontSize: `${smartTypeSize(style, format)}cqw`,
    lineHeight: style.lineHeight,
    WebkitLineClamp: style.maxLines,
  };
}

function layerNode(layer: SemanticLayer, style: LayerStyle) {
  if (layer.role === "background") {
    return <div className="creative-background" style={{ backgroundPosition: `${style.focalX}% ${style.focalY}%`, inset: `-${style.bleed || 0}%` }} />;
  }
  if (layer.role === "hero") {
    return (
      <div className="hero-product" aria-label={layer.name}>
        <span className="hero-glow" />
        <span className="bottle-neck" />
        <span className="bottle-body"><i>0.0</i><b>N★</b><small>BOTANICAL</small></span>
      </div>
    );
  }
  if (layer.role === "cta") return <span className="cta-copy">{style.content}<MoveUpRight size="1em" /></span>;
  return <span className={`copy copy-${layer.role}`}>{style.content}</span>;
}

export function Artboard({ template, format, active, selectedLayerId, guides, tints, onSelect, onLayerSelect }: ArtboardProps) {
  const ratio = format.width / format.height;
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
        <div className="creative-stage" style={frameStyle}>
          {template.layers.map((layer) => {
            const style = resolveLayer(template, layer.id, format);
            return (
              <button
                key={layer.id}
                type="button"
                className={`creative-layer role-${layer.role} ${selectedLayerId === layer.id && active ? "selected" : ""}`}
                style={layerCss(style, format)}
                onClick={(event) => { event.stopPropagation(); onSelect(); onLayerSelect(layer.id); }}
                aria-label={`Select ${layer.name}`}
              >
                {layerNode(layer, style)}
              </button>
            );
          })}
          {tints && <div className="layout-tints" aria-hidden="true"><span /><span /><span /></div>}
          {guides && <div className="safe-guide" style={{ inset: `${template.rules.safeArea}%` }} aria-hidden="true"><span>safe</span></div>}
        </div>
      </div>
      <footer>
        <span className="verified"><Check size={12} /> Verified</span>
        <span>{format.family}</span>
      </footer>
    </article>
  );
}
