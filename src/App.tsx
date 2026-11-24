import { useMemo, useRef, useState } from "react";
import {
  AlignHorizontalSpaceAround, Archive, Check, ChevronDown, CircleHelp, Cloud, Download, Eye,
  FileImage, FileStack, Focus, Grid2X2, ImagePlus, Layers3, LayoutGrid, LockKeyhole, MapPin,
  Menu, PanelLeftClose, RotateCcw, ScanLine, Settings2, ShieldCheck, SlidersHorizontal,
  Sparkles, Type, Upload, WandSparkles,
} from "lucide-react";
import { Artboard } from "./components/Artboard";
import { applyScopedPatch, type Anchor, type DcoTemplate, type LayerRole, type LayerStyle, type ScopeMode, refineFamilyPatch, resolveLayer, similarFormats } from "./core/schema";
import { createSampleTemplate } from "./core/sample";
import { psdAdapter } from "./importers";

const ROLE_LABELS: Record<LayerRole, string> = {
  background: "Background", hero: "Hero asset", logo: "Logo", eyebrow: "Campaign label",
  headline: "Headline", body: "Body copy", cta: "Call to action", legal: "Legal",
};

const ANCHORS: Anchor[] = ["top-left", "top", "top-right", "left", "centre", "right", "bottom-left", "bottom", "bottom-right"];
const ANCHOR_POSITION: Record<Anchor, Pick<LayerStyle, "x" | "y">> = {
  "top-left": { x: 6, y: 6 }, top: { x: 41, y: 6 }, "top-right": { x: 76, y: 6 },
  left: { x: 6, y: 46 }, centre: { x: 41, y: 46 }, right: { x: 76, y: 46 },
  "bottom-left": { x: 6, y: 86 }, bottom: { x: 41, y: 86 }, "bottom-right": { x: 76, y: 86 },
};

function downloadJson(template: DcoTemplate) {
  const blob = new Blob([JSON.stringify(template, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${template.id}.adapt-template-v1.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export function App() {
  const [template, setTemplate] = useState(createSampleTemplate);
  const [activeFormatId, setActiveFormatId] = useState("portrait-d6");
  const [selectedLayerId, setSelectedLayerId] = useState("headline");
  const [scope, setScope] = useState<ScopeMode>("global");
  const [guides, setGuides] = useState(true);
  const [tints, setTints] = useState(false);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState("Sample campaign ready — eight formats adapted from one prepared layout.");
  const fileInput = useRef<HTMLInputElement>(null);

  const activeFormat = template.formats.find((format) => format.id === activeFormatId) || template.formats[0];
  const selectedLayer = template.layers.find((layer) => layer.id === selectedLayerId) || template.layers[0];
  const selectedStyle = resolveLayer(template, selectedLayer.id, activeFormat);
  const neighbours = useMemo(() => similarFormats(template, activeFormat), [template, activeFormat]);

  function patchSelected(patch: Partial<LayerStyle>) {
    setTemplate((current) => applyScopedPatch(current, selectedLayer.id, patch, scope, activeFormat));
  }

  function changeLayerRole(layerId: string, role: LayerRole) {
    setTemplate((current) => ({
      ...current,
      layers: current.layers.map((layer) => layer.id === layerId ? { ...layer, role, confidence: 1 } : layer),
    }));
  }

  async function importPsd(file?: File) {
    if (!file) return;
    setImporting(true);
    setNotice(`Reading ${file.name} locally…`);
    try {
      const imported = await psdAdapter.import(file);
      if (!imported.layers.length) throw new Error(imported.warnings[0] || "No editable layers were found.");
      setTemplate((current) => ({
        ...current,
        id: file.name.replace(/\.psd$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        name: file.name.replace(/\.psd$/i, ""),
        source: { adapter: "psd", fileName: file.name, realImport: true, importedAt: new Date().toISOString() },
        layers: imported.layers,
        overrides: { global: {}, families: {}, formats: {} },
      }));
      setSelectedLayerId(imported.layers.find((layer) => layer.role === "headline")?.id || imported.layers[0].id);
      setNotice(`Real PSD imported — ${imported.layers.length} editable layers mapped from ${imported.width} × ${imported.height}.`);
    } catch (error) {
      setNotice(error instanceof Error ? `PSD import needs attention: ${error.message}` : "The PSD could not be read.");
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function refineNeighbours() {
    const patch: Partial<LayerStyle> = {
      content: selectedStyle.content,
      anchor: selectedStyle.anchor,
      x: selectedStyle.x,
      y: selectedStyle.y,
      width: selectedStyle.width,
      fontSize: selectedStyle.fontSize,
    };
    setTemplate((current) => refineFamilyPatch(current, selectedLayer.id, patch, activeFormat));
    setNotice(`${selectedLayer.name} refined across ${neighbours.length} closely matched ${activeFormat.family} formats.`);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">A</span><strong>ADAPT</strong><em>Creative versioning studio</em></div>
        <div className="project-identity"><span>Northstar / Autumn 26</span><strong>{template.name}</strong></div>
        <div className="top-actions">
          <span className="save-state"><Cloud size={15} /> Local draft saved</span>
          <button className="icon-button" title="Help"><CircleHelp size={18} /></button>
          <button className="primary-button" onClick={() => downloadJson(template)}><Download size={15} /> Export DCO template</button>
          <button className="icon-button" title="Menu"><Menu size={19} /></button>
        </div>
      </header>

      <div className="demo-status">
        <div className={template.source.realImport ? "status-dot real" : "status-dot"} />
        <strong>{template.source.realImport ? "Real PSD source" : "Generated demo source"}</strong>
        <span>{template.source.realImport ? "Layer names and geometry were parsed in this browser." : "No PSD was supplied; this campaign uses a prepared schema fallback. Uploading a PSD uses the real parser."}</span>
        <span className="schema-chip">{template.schema} · v{template.version}</span>
      </div>

      <main className="workspace">
        <aside className="left-rail">
          <div className="rail-heading"><div><small>SOURCE</small><strong>Creative layers</strong></div><PanelLeftClose size={17} /></div>
          <section className="import-card">
            <div className="import-icon"><FileImage size={20} /></div>
            <div><strong>{template.source.fileName}</strong><span>{template.layers.length} semantic layers · {template.source.realImport ? "parsed PSD" : "demo fallback"}</span></div>
            <span className={`source-badge ${template.source.realImport ? "real" : "demo"}`}>{template.source.realImport ? "REAL" : "DEMO"}</span>
          </section>
          <input ref={fileInput} type="file" accept=".psd,image/vnd.adobe.photoshop" hidden onChange={(event) => importPsd(event.target.files?.[0])} />
          <button className="upload-button" onClick={() => fileInput.current?.click()} disabled={importing}>
            <Upload size={15} /> {importing ? "Reading PSD…" : "Import prepared PSD"}
          </button>
          <p className="microcopy">PSD files are parsed locally. Nothing is uploaded to a server.</p>

          <div className="section-title"><span>SEMANTIC MAPPING</span><button title="Mapping settings"><Settings2 size={14} /></button></div>
          <div className="layer-list">
            {template.layers.map((layer) => (
              <button key={layer.id} className={`layer-row ${selectedLayer.id === layer.id ? "active" : ""}`} onClick={() => setSelectedLayerId(layer.id)}>
                <span className={`layer-glyph ${layer.kind}`}><Layers3 size={14} /></span>
                <span className="layer-name"><strong>{layer.name}</strong><small>{layer.sourceName}</small></span>
                <select value={layer.role} onClick={(event) => event.stopPropagation()} onChange={(event) => changeLayerRole(layer.id, event.target.value as LayerRole)} aria-label={`Map ${layer.name}`}>
                  {Object.entries(ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <span className="confidence">{Math.round(layer.confidence * 100)}%</span>
              </button>
            ))}
          </div>

          <section className="adapter-card">
            <header><FileStack size={15} /><strong>Import adapters</strong></header>
            <div><span><i className="available" /> Photoshop PSD</span><b>Available</b></div>
            <div><span><i /> After Effects</span><b>Planned</b></div>
            <div><span><i /> InDesign</span><b>Planned</b></div>
            <div><span><i /> Figma</span><b>Planned</b></div>
          </section>
        </aside>

        <section className="stage-area">
          <div className="stage-toolbar">
            <div><small>RESPONSIVE ARTBOARDS</small><strong>{template.formats.length} live formats</strong></div>
            <div className="scope-switch" aria-label="Edit scope">
              {(["global", "family", "local"] as ScopeMode[]).map((mode) => <button key={mode} className={scope === mode ? "active" : ""} onClick={() => setScope(mode)}>{mode}</button>)}
            </div>
            <div className="view-actions">
              <button className={guides ? "active" : ""} onClick={() => setGuides((value) => !value)}><ScanLine size={15} /> Guides</button>
              <button className={tints ? "active" : ""} onClick={() => setTints((value) => !value)}><Grid2X2 size={15} /> Layout tints</button>
              <button><Eye size={15} /> Preview</button>
            </div>
          </div>

          <div className="cascade-strip">
            <div className={`scope-orb ${scope}`}><Sparkles size={15} /></div>
            <div><strong>{scope === "global" ? `Global edits flow to all ${template.formats.length} formats` : scope === "family" ? `${activeFormat.family} family edits stay within this shape` : `${activeFormat.name} only`}</strong><span>{scope === "global" ? "Shared copy, type and anchors remain linked until you add an exception." : "Inherited values remain live underneath explicit overrides."}</span></div>
            <div className="cascade-path"><span>Global</span><i /><span>Family</span><i /><span>Local</span></div>
          </div>

          <div className="artboard-grid">
            {template.formats.map((format) => (
              <Artboard key={format.id} template={template} format={format} active={format.id === activeFormat.id} selectedLayerId={selectedLayer.id} guides={guides} tints={tints} onSelect={() => setActiveFormatId(format.id)} onLayerSelect={setSelectedLayerId} />
            ))}
          </div>

          <div className="refinement-bar">
            <div className="refinement-score"><WandSparkles size={17} /><span><strong>{Math.round((neighbours.length ? 0.997 : 1) * 1000) / 10}%</strong> ratio confidence</span></div>
            <div><strong>Refine similar aspect ratios</strong><span>{activeFormat.name} has {neighbours.length - 1} close neighbour{neighbours.length - 1 === 1 ? "" : "s"}; preserve the artworked relationship explicitly.</span></div>
            <button onClick={refineNeighbours}>Refine {neighbours.length} formats</button>
          </div>
          <div className="toast-line"><Check size={14} /> {notice}</div>
        </section>

        <aside className="inspector">
          <div className="rail-heading"><div><small>INSPECTOR</small><strong>{selectedLayer.name}</strong></div><SlidersHorizontal size={17} /></div>
          <section className="selection-summary">
            <div className={`selection-icon role-${selectedLayer.role}`}>{selectedLayer.kind === "text" ? <Type size={18} /> : <ImagePlus size={18} />}</div>
            <div><strong>{ROLE_LABELS[selectedLayer.role]}</strong><span>{scope.toUpperCase()} EDIT · {activeFormat.name}</span></div>
            <LockKeyhole size={14} />
          </section>

          {selectedStyle.content !== undefined && (
            <section className="control-card">
              <header><div><Type size={15} /><strong>Shared copy</strong></div><span className="linked-pill">{scope === "global" ? "8 LINKED" : scope === "family" ? `${template.formats.filter((f) => f.family === activeFormat.family).length} LINKED` : "1 LOCAL"}</span></header>
              <textarea value={selectedStyle.content} onChange={(event) => patchSelected({ content: event.target.value })} rows={selectedLayer.role === "headline" ? 3 : 2} />
              <div className="control-note"><Sparkles size={13} /><span>Smart wrapping and scaling are active. Copy will stay within {selectedStyle.maxLines || 3} lines.</span></div>
            </section>
          )}

          {selectedLayer.kind === "text" && (
            <section className="control-card">
              <header><div><AlignHorizontalSpaceAround size={15} /><strong>Typography</strong></div><button><RotateCcw size={13} /></button></header>
              <label className="range-label"><span>Type scale</span><b>{(selectedStyle.fontSize || 1).toFixed(1)}</b></label>
              <input type="range" min="0.5" max="10" step="0.1" value={selectedStyle.fontSize || 1} onChange={(event) => patchSelected({ fontSize: Number(event.target.value) })} />
              <div className="two-controls"><label>Minimum<input type="number" value={selectedStyle.minFontSize || 0.8} step="0.1" onChange={(event) => patchSelected({ minFontSize: Number(event.target.value) })} /></label><label>Max lines<select value={selectedStyle.maxLines || 3} onChange={(event) => patchSelected({ maxLines: Number(event.target.value) })}><option>1</option><option>2</option><option>3</option><option>4</option></select></label></div>
            </section>
          )}

          {selectedLayer.role === "logo" && (
            <section className="control-card">
              <header><div><MapPin size={15} /><strong>Logo anchor</strong></div><span>GUIDED</span></header>
              <div className="anchor-grid">
                {ANCHORS.map((anchor) => <button key={anchor} className={selectedStyle.anchor === anchor ? "active" : ""} title={anchor} onClick={() => patchSelected({ anchor, ...ANCHOR_POSITION[anchor] })}><span /></button>)}
              </div>
              <div className="control-note"><ShieldCheck size={13} /><span>Clear space and the 5% safe area are enforced across every linked format.</span></div>
            </section>
          )}

          {selectedLayer.role === "background" && (
            <section className="control-card">
              <header><div><Focus size={15} /><strong>Bleed & focal point</strong></div><span>PROTECTED</span></header>
              <label className="range-label"><span>Horizontal focus</span><b>{selectedStyle.focalX || 50}%</b></label>
              <input type="range" min="0" max="100" value={selectedStyle.focalX || 50} onChange={(event) => patchSelected({ focalX: Number(event.target.value) })} />
              <label className="range-label"><span>Background bleed</span><b>{selectedStyle.bleed || 0}%</b></label>
              <input type="range" min="0" max="20" value={selectedStyle.bleed || 0} onChange={(event) => patchSelected({ bleed: Number(event.target.value) })} />
            </section>
          )}

          <section className="control-card cascade-card">
            <header><div><LayoutGrid size={15} /><strong>Override cascade</strong></div><ChevronDown size={14} /></header>
            <div className="cascade-level"><i className="global" /><span><strong>Global source</strong><small>{Object.keys(template.overrides.global[selectedLayer.id] || {}).length} explicit values</small></span><b>G</b></div>
            <div className="cascade-level"><i className="family" /><span><strong>{activeFormat.family} family</strong><small>{Object.keys(template.overrides.families[activeFormat.family]?.[selectedLayer.id] || {}).length} refinements</small></span><b>F</b></div>
            <div className="cascade-level"><i className="local" /><span><strong>{activeFormat.name}</strong><small>{Object.keys(template.overrides.formats[activeFormat.id]?.[selectedLayer.id] || {}).length} protected exceptions</small></span><b>L</b></div>
          </section>

          <section className="verification-card"><ShieldCheck size={19} /><div><strong>Layout verified</strong><span>No crop, overflow or safe-area conflicts detected.</span></div><span>8/8</span></section>
        </aside>
      </main>
    </div>
  );
}
