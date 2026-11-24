import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight, BrainCircuit, Check, ChevronRight, Download, FileImage, FileSpreadsheet,
  Gauge, Layers3, LoaderCircle, Maximize2, PackageCheck, Ruler, ScanSearch, Sparkles, Upload,
} from "lucide-react";
import { DCO_SCHEMA, DCO_VERSION, type DcoTemplate, type LayerRole, type SemanticLayer } from "../core/schema";
import { createSampleTemplate } from "../core/sample";
import { downloadTemplatePsds } from "../core/psdExport";
import { planRatioFootprint, type RatioPlan } from "../core/ratioPlanner";
import { responsiveOverrides } from "../core/responsive";
import { psdAdapter } from "../importers";
import { readSpreadsheet, type SpreadsheetExtraction } from "../importers/spreadsheet";

type Step = "sizes" | "footprint" | "psd" | "layout";

interface AiState {
  configured: boolean;
  model: string;
}

interface LayoutAnalysis {
  background_strategy: string;
  background_coverage: string;
  focal_point: { x_percent: number; y_percent: number };
  layers: Array<{ layer_id: string; role: LayerRole; reasoning: string }>;
  format_rules: Array<{ family: string; instruction: string }>;
  warnings: string[];
}

interface Props {
  onOpenStudio: (template: DcoTemplate, notice: string) => void;
}

const WORKFLOW: Array<{ id: Step; number: string; label: string }> = [
  { id: "sizes", number: "01", label: "Extract sizes" },
  { id: "footprint", number: "02", label: "Plan footprint" },
  { id: "psd", number: "03", label: "Prepare PSDs" },
  { id: "layout", number: "04", label: "Adapt layout" },
];

function postAnalysis(body: unknown) {
  return fetch("/api/analyse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (response) => {
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Analysis returned ${response.status}`);
    return data;
  });
}

function mergeAiRoles(layers: SemanticLayer[], analysis?: LayoutAnalysis) {
  if (!analysis) return layers;
  const byId = new Map(analysis.layers.map((item) => [item.layer_id, item.role]));
  return layers.map((layer) => byId.has(layer.id) ? { ...layer, role: byId.get(layer.id)!, confidence: 1 } : layer);
}

function enrichStyles(layers: SemanticLayer[]) {
  const sampleByRole = new Map(createSampleTemplate().layers.map((layer) => [layer.role, layer.style]));
  return layers.map((layer) => {
    const sample = sampleByRole.get(layer.role);
    return sample ? { ...layer, style: { ...sample, content: layer.style.content ?? sample.content } } : layer;
  });
}

export function DemoWorkflow({ onOpenStudio }: Props) {
  const [step, setStep] = useState<Step>("sizes");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [ai, setAi] = useState<AiState>({ configured: false, model: "" });
  const [aiSizeNote, setAiSizeNote] = useState("");
  const [extraction, setExtraction] = useState<SpreadsheetExtraction | null>(null);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [printDpi, setPrintDpi] = useState(400);
  const [printScale, setPrintScale] = useState(10);
  const [floatTolerance, setFloatTolerance] = useState(8);
  const [cropTolerance, setCropTolerance] = useState(6);
  const [psdLayers, setPsdLayers] = useState<SemanticLayer[]>([]);
  const [psdName, setPsdName] = useState("");
  const [psdGeometry, setPsdGeometry] = useState("");
  const [layoutAnalysis, setLayoutAnalysis] = useState<LayoutAnalysis | undefined>();
  const sheetInput = useRef<HTMLInputElement>(null);
  const psdInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/ai-status").then((response) => response.json()).then(setAi).catch(() => undefined);
  }, []);

  const plan = useMemo<RatioPlan | null>(() => extraction ? planRatioFootprint(extraction.formats, {
    allowDownscale: true,
    floatTolerance: floatTolerance / 100,
    cropTolerance: cropTolerance / 100,
  }) : null, [cropTolerance, extraction, floatTolerance]);

  async function analyseSheet(file: File) {
    setBusy("Reading delivery sheet");
    setError("");
    setAiSizeNote("");
    try {
      const result = await readSpreadsheet(file, { printDpi, printScalePercent: printScale });
      if (!result.formats.length) throw new Error("No width × height pairs could be found. Check the first sheet and its headers.");
      setSourceFile(file);
      setExtraction(result);
      if (ai.configured) {
        try {
          const response = await postAnalysis({ mode: "spreadsheet", headers: result.headers, sampleRows: result.sampleRows });
          const notes = response.analysis?.notes?.filter(Boolean) || [];
          setAiSizeNote(`OpenAI confirmed the structure${notes.length ? ` — ${notes[0]}` : "."}`);
        } catch {
          setAiSizeNote("Deterministic extraction used; the OpenAI cross-check was unavailable.");
        }
      } else {
        setAiSizeNote("Deterministic extraction used; OpenAI is not configured.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The spreadsheet could not be read.");
    } finally {
      setBusy("");
      if (sheetInput.current) sheetInput.current.value = "";
    }
  }

  async function loadDeliverDemo() {
    setBusy("Loading Deliver catalogue");
    setError("");
    try {
      const response = await fetch("/data/deliver_unique_format_sizes.csv");
      if (!response.ok) throw new Error("The Deliver catalogue is unavailable.");
      const blob = await response.blob();
      await analyseSheet(new File([blob], "deliver_unique_format_sizes.csv", { type: "text/csv" }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The catalogue could not be loaded.");
      setBusy("");
    }
  }

  async function reprocessPrint() {
    if (sourceFile) await analyseSheet(sourceFile);
  }

  async function importPsd(file?: File) {
    if (!file) return;
    setBusy("Extracting PSD layers");
    setError("");
    setLayoutAnalysis(undefined);
    try {
      const imported = await psdAdapter.import(file);
      if (!imported.layers.length) throw new Error(imported.warnings[0] || "No editable layers were found.");
      setPsdLayers(imported.layers);
      setPsdName(file.name);
      setPsdGeometry(`${imported.width} × ${imported.height}`);
      setStep("layout");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The PSD could not be read.");
    } finally {
      setBusy("");
      if (psdInput.current) psdInput.current.value = "";
    }
  }

  async function analyseLayout() {
    if (!plan || !psdLayers.length) return;
    setBusy(ai.configured ? "OpenAI is examining the layout" : "Applying semantic layout rules");
    setError("");
    let analysis: LayoutAnalysis | undefined;
    if (ai.configured) {
      try {
        const response = await postAnalysis({
          mode: "layout",
          source: { fileName: psdName, geometry: psdGeometry },
          layers: psdLayers.map((layer) => ({ id: layer.id, name: layer.sourceName, kind: layer.kind, geometry: layer.style })),
          masters: plan.masters.map((master) => master.format),
        });
        analysis = response.analysis;
        setLayoutAnalysis(analysis);
      } catch {
        setLayoutAnalysis(undefined);
      }
    }
    const mappedLayers = enrichStyles(mergeAiRoles(psdLayers, analysis));
    const formats = plan.masters.slice(0, 12).map((master) => master.format);
    const fallbackFormats = extraction?.formats.slice(0, 8) || [];
    const template: DcoTemplate = {
      schema: DCO_SCHEMA,
      version: DCO_VERSION,
      id: psdName.replace(/\.psd$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-") || "adapt-campaign",
      name: psdName.replace(/\.psd$/i, "") || "Adapt campaign",
      source: { adapter: "psd", fileName: psdName, realImport: true, importedAt: new Date().toISOString() },
      formats: formats.length ? formats : fallbackFormats,
      layers: mappedLayers,
      overrides: { global: {}, families: responsiveOverrides(mappedLayers), formats: {} },
      rules: { safeArea: 5, backgroundBleed: 8, refineSimilarRatios: true, similarityTolerance: 0.035 },
    };
    setBusy("");
    onOpenStudio(template, analysis
      ? `OpenAI mapped ${mappedLayers.length} PSD layers and proposed rules for ${plan.masters.length} master formats.`
      : `Deterministic semantic mapping created ${plan.masters.length} master formats; OpenAI analysis was unavailable.`);
  }

  const currentIndex = WORKFLOW.findIndex((item) => item.id === step);

  return (
    <div className="workflow-shell">
      <header className="workflow-topbar">
        <div className="brand"><span className="brand-mark">A</span><strong>ADAPT</strong><em>Creative versioning studio</em></div>
        <div className="workflow-steps">
          {WORKFLOW.map((item, index) => (
            <button key={item.id} disabled={index > currentIndex || (item.id !== "sizes" && !extraction)} className={`${step === item.id ? "active" : ""} ${index < currentIndex ? "done" : ""}`} onClick={() => setStep(item.id)}>
              <span>{index < currentIndex ? <Check size={12} /> : item.number}</span>{item.label}
            </button>
          ))}
        </div>
        <div className={`ai-indicator ${ai.configured ? "online" : ""}`}><i /><span>{ai.configured ? "OpenAI connected" : "Rules engine ready"}<small>{ai.configured ? ai.model : "Deterministic fallback"}</small></span></div>
      </header>

      <main className="workflow-main">
        {step === "sizes" && !extraction && (
          <section className="empty-import">
            <div className="empty-orbit"><Ruler /><span><Maximize2 /></span></div>
            <p className="eyebrow-label">START WITH THE DELIVERY LIST</p>
            <h1>Turn a messy size sheet into<br /><em>one intelligent artwork plan.</em></h1>
            <p className="empty-lede">Upload Excel or CSV. Adapt finds pixel dimensions in separate columns or combined values such as 1080 × 1920, and converts physical print sizes using an explicit DPI and artwork scale.</p>
            <div className="empty-actions">
              <input ref={sheetInput} hidden type="file" accept=".csv,.xlsx,.xls,text/csv" onChange={(event) => analyseSheet(event.target.files?.[0] as File)} />
              <button className="workflow-primary" onClick={() => sheetInput.current?.click()} disabled={Boolean(busy)}><Upload size={17} /> Import Excel or CSV</button>
              <button className="workflow-secondary" onClick={loadDeliverDemo} disabled={Boolean(busy)}><FileSpreadsheet size={17} /> Use Deliver catalogue demo</button>
            </div>
            <div className="capability-row">
              <span><ScanSearch /> Flexible column detection</span><span><BrainCircuit /> AI structure check</span><span><Gauge /> 300–500 DPI print logic</span>
            </div>
          </section>
        )}

        {step === "sizes" && extraction && (
          <section className="workflow-panel">
            <div className="workflow-heading"><div><span>01 / SIZE EXTRACTION</span><h1>Delivery sizes found and normalised</h1><p>{extraction.method}. The original rows remain untouched.</p></div><div className="source-proof"><Check /><span><strong>{extraction.fileName}</strong><small>{aiSizeNote}</small></span></div></div>
            <div className="metric-grid five">
              <Metric value={extraction.formats.length} label="formats found" />
              <Metric value={new Set(extraction.formats.map((format) => `${format.width}x${format.height}`)).size} label="unique dimensions" />
              <Metric value={extraction.digitalRows} label="digital rows" />
              <Metric value={extraction.physicalRows} label="print rows" />
              <Metric value={extraction.skippedRows} label="rows needing review" muted={!extraction.skippedRows} />
            </div>
            <div className="review-layout">
              <section className="data-card">
                <header><div><FileSpreadsheet /><span><strong>Extracted dimensions</strong><small>First 12 of {extraction.formats.length}</small></span></div><button onClick={() => { setExtraction(null); setSourceFile(null); }}>Replace file</button></header>
                <div className="review-table"><div className="review-row head"><span>Source row</span><span>Name</span><span>Input</span><span>Production pixels</span><span>Type</span></div>
                  {extraction.formats.slice(0, 12).map((format) => <div className="review-row" key={format.id}><span>#{format.sourceRow}</span><span>{format.name}</span><span>{format.sourceText}</span><strong>{format.width} × {format.height}</strong><span className={`unit-pill ${format.sourceUnit === "px" ? "digital" : "print"}`}>{format.sourceUnit === "px" ? "DIGITAL" : "PRINT"}</span></div>)}
                </div>
              </section>
              <aside className="print-card"><header><Ruler /><div><strong>Print interpretation</strong><span>Only applies to physical dimensions</span></div></header><label>DPI<select value={printDpi} onChange={(event) => setPrintDpi(Number(event.target.value))}><option>300</option><option>400</option><option>500</option></select></label><label>Artwork scale<select value={printScale} onChange={(event) => setPrintScale(Number(event.target.value))}><option value="10">10%</option><option value="25">25%</option><option value="50">50%</option><option value="100">100%</option></select></label><button onClick={reprocessPrint}>Recalculate print rows</button><p>Physical dimensions are converted to pixels at the chosen production scale; their aspect ratio is preserved exactly.</p></aside>
            </div>
            <ContinueButton onClick={() => setStep("footprint")} label="Build minimal format footprint" />
          </section>
        )}

        {step === "footprint" && plan && (
          <section className="workflow-panel">
            <div className="workflow-heading"><div><span>02 / RATIOS FOOTPRINT</span><h1>{plan.uniqueCount} sizes reduced to {plan.masters.length} artwork masters</h1><p>Largest-first grouping preserves resolution, then uses exact downscale, approved float, or approved crop.</p></div><div className="saving-badge"><Sparkles /><strong>{Math.round((plan.savedFiles / Math.max(1, plan.uniqueCount)) * 100)}%</strong><span>fewer source files</span></div></div>
            <div className="metric-grid four"><Metric value={plan.inputCount} label="input rows" /><Metric value={plan.uniqueCount} label="unique sizes" /><Metric value={plan.exactRatioCount} label="exact ratios" /><Metric value={plan.masters.length} label="PSD masters" accent /></div>
            <div className="tolerance-strip"><div><strong>Ratios tolerance</strong><span>Control how closely neighbouring formats can share a master.</span></div><label><span>Float allowance <b>{floatTolerance}%</b></span><input type="range" min="0" max="20" value={floatTolerance} onChange={(event) => setFloatTolerance(Number(event.target.value))} /></label><label><span>Crop allowance <b>{cropTolerance}%</b></span><input type="range" min="0" max="15" value={cropTolerance} onChange={(event) => setCropTolerance(Number(event.target.value))} /></label></div>
            <section className="master-list"><header><span>Artwork master</span><span>Family</span><span>Services</span><span>Adaptation methods</span></header>{plan.masters.slice(0, 18).map((master) => <div key={master.id}><span><i style={{ aspectRatio: `${master.format.width}/${master.format.height}` }} /><strong>{master.format.width} × {master.format.height}</strong></span><span>{master.format.family}</span><span>{master.targets.length} format{master.targets.length === 1 ? "" : "s"}</span><span>{[...new Set(master.targets.map((target) => target.method))].map((method) => <b key={method} className={method}>{method}</b>)}</span></div>)}</section>
            {plan.masters.length > 18 && <p className="list-note">Showing the first 18 of {plan.masters.length} masters. All masters are included when PSD templates are generated.</p>}
            <ContinueButton onClick={() => setStep("psd")} label="Prepare layered PSD masters" />
          </section>
        )}

        {step === "psd" && plan && (
          <section className="workflow-panel psd-step">
            <div className="workflow-heading"><div><span>03 / PREPARED PSD</span><h1>Start from production-ready layer semantics</h1><p>Generate blank masters for the entire footprint, or use the prepared Brighter After Dark campaign for this demo.</p></div></div>
            <div className="psd-choice-grid">
              <section className="psd-choice"><span className="choice-icon"><PackageCheck /></span><div><small>YOUR DELIVERY PLAN</small><h2>{plan.masters.length} layered PSD templates</h2><p>Correct canvas sizes, safe-area guides, editable copy, logo and hero smart-object targets, and a background extension layer.</p></div><button onClick={() => downloadTemplatePsds(plan.masters)}><Download /> Download template pack</button></section>
              <section className="psd-choice featured"><span className="prepared-pill">PREPARED DEMO</span><div className="psd-preview"><div className="psd-creative"><b>BRIGHTER<br />AFTER DARK</b><i /></div><span><Layers3 /> 8 editable layers</span></div><div><small>NORTHSTAR CAMPAIGN</small><h2>Brighter After Dark.psd</h2><p>A real layered 2400 × 1600 PSD with editable type, hero artwork, bleed master, guides and explicit smart-object preparation notes.</p></div><a href="/demo/brighter-after-dark-prepared.psd" download><Download /> Download prepared PSD</a></section>
            </div>
            <div className="psd-upload-zone"><input ref={psdInput} hidden type="file" accept=".psd,image/vnd.adobe.photoshop" onChange={(event) => importPsd(event.target.files?.[0])} /><FileImage /><div><strong>Upload the prepared PSD to continue</strong><span>The browser reads the actual PSD layer tree and geometry. No flattened demo substitute.</span></div><button onClick={() => psdInput.current?.click()}><Upload /> Choose PSD</button></div>
          </section>
        )}

        {step === "layout" && plan && psdLayers.length > 0 && (
          <section className="workflow-panel">
            <div className="workflow-heading"><div><span>04 / PSD TO DCO</span><h1>PSD layers extracted into a responsive creative system</h1><p>Review semantic mapping, then let the layout engine extrapolate family rules across the format footprint.</p></div><div className="source-proof real"><Check /><span><strong>Real PSD parsed</strong><small>{psdName} · {psdGeometry}</small></span></div></div>
            <div className="layout-review">
              <section className="data-card layer-map-card"><header><div><Layers3 /><span><strong>Semantic layer mapping</strong><small>{psdLayers.length} editable source layers</small></span></div><span className="real-chip">REAL PSD</span></header>{psdLayers.map((layer) => <div className="semantic-row" key={layer.id}><span className={`semantic-kind ${layer.kind}`}>{layer.kind === "text" ? "T" : "◇"}</span><span><strong>{layer.name}</strong><small>{layer.sourceName}</small></span><b>{layer.role}</b><em>{Math.round(layer.confidence * 100)}%</em></div>)}</section>
              <aside className="coverage-card"><span><Maximize2 /></span><h2>Background coverage strategy</h2><p>{layoutAnalysis?.background_strategy || "Preserve the focal subject in the source master. Use cover crop for close ratios, float where brand-approved negative space exists, and extend the background for extreme ribbons or towers."}</p><div><strong>Source master</strong><b>{psdGeometry}</b></div><div><strong>Requested masters</strong><b>{plan.masters.length}</b></div><div><strong>Extreme ratios</strong><b>Smart extend</b></div><small>A single finite raster cannot cover every catalogue extreme without crop or upscaling. Adapt makes that decision explicit.</small></aside>
            </div>
            <div className="analysis-callout"><BrainCircuit /><div><strong>{ai.configured ? "OpenAI layout analysis is ready" : "Deterministic layout rules are ready"}</strong><span>{ai.configured ? "Layer names, geometry and master ratios will be evaluated; structured recommendations remain editable." : "Semantic names and verified family rules will be applied and clearly labelled as the fallback."}</span></div></div>
            <ContinueButton onClick={analyseLayout} label={ai.configured ? "Analyse and open responsive studio" : "Apply rules and open responsive studio"} />
          </section>
        )}

        {busy && <div className="workflow-busy"><LoaderCircle /><span>{busy}…</span></div>}
        {error && <div className="workflow-error"><strong>Needs attention</strong><span>{error}</span><button onClick={() => setError("")}>Dismiss</button></div>}
      </main>
      <footer className="workflow-footer"><span><i /> Local-first PSD parsing</span><span>Versioned {DCO_SCHEMA} · {DCO_VERSION}</span><span>AE · InDesign · Figma adapters preserved</span></footer>
    </div>
  );
}

function Metric({ value, label, accent, muted }: { value: number; label: string; accent?: boolean; muted?: boolean }) {
  return <div className={`${accent ? "accent" : ""} ${muted ? "muted" : ""}`}><strong>{value.toLocaleString()}</strong><span>{label}</span></div>;
}

function ContinueButton({ onClick, label }: { onClick: () => void; label: string }) {
  return <div className="continue-row"><button className="workflow-primary" onClick={onClick}>{label}<ArrowRight size={17} /></button></div>;
}
