import "dotenv/config";
import dotenv from "dotenv";
import express from "express";
import OpenAI from "openai";
import path from "node:path";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { createServer as createViteServer } from "vite";

dotenv.config({ path: ".env.local", override: true });

const app = express();
const port = Number(process.env.PORT || 4173);
app.use(express.json({ limit: "5mb" }));

const ExtractionAnalysis = z.object({
  width_column: z.string(),
  height_column: z.string(),
  combined_dimension_column: z.string(),
  physical_unit_column: z.string(),
  aspect_ratio_column: z.string(),
  inferred_unit: z.enum(["px", "mm", "cm", "m", "in", "ft", "mixed", "unknown"]),
  confidence: z.number(),
  notes: z.array(z.string()),
});

const LayoutAnalysis = z.object({
  background_strategy: z.string(),
  focal_point: z.object({ x_percent: z.number(), y_percent: z.number() }),
  background_coverage: z.string(),
  layers: z.array(z.object({
    layer_id: z.string(),
    role: z.enum(["background", "hero", "logo", "eyebrow", "headline", "body", "cta", "legal"]),
    reasoning: z.string(),
  })),
  format_rules: z.array(z.object({ family: z.enum(["landscape", "portrait", "square", "ribbon"]), instruction: z.string() })),
  warnings: z.array(z.string()),
});

app.get("/api/ai-status", (_request, response) => {
  response.json({ configured: Boolean(process.env.OPENAI_API_KEY), model: process.env.OPENAI_ADAPT_MODEL || "gpt-6.2-astra" });
});

app.post("/api/analyse", async (request, response) => {
  if (!process.env.OPENAI_API_KEY) return response.status(503).json({ error: "OpenAI API is not configured." });
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_ADAPT_MODEL || "gpt-6.2-astra";
  try {
    if (request.body?.mode === "spreadsheet") {
      const result = await openai.responses.parse({
        model,
        input: [
          { role: "system", content: "You inspect OOH delivery spreadsheets. Identify width, height, combined dimension, physical-unit, and aspect-ratio columns. Empty strings mean absent. Distinguish pixels from physical print dimensions. Do not invent columns." },
          { role: "user", content: JSON.stringify({ headers: request.body.headers, sample_rows: request.body.sampleRows }) },
        ],
        text: { format: zodTextFormat(ExtractionAnalysis, "ooh_size_extraction") },
      });
      return response.json({ source: "openai", model, analysis: result.output_parsed });
    }
    if (request.body?.mode === "layout") {
      const result = await openai.responses.parse({
        model,
        input: [
          { role: "system", content: "You are a senior DOOH artworker. Map prepared PSD layers to semantic DCO roles and recommend deterministic layout rules for landscape, portrait, square, and ribbon families. Preserve brand fidelity, legibility, safe areas, and logo clear space. Assess whether the background can cover the requested master formats without upscaling; recommend crop, float, or generative extension explicitly." },
          { role: "user", content: JSON.stringify({ source: request.body.source, layers: request.body.layers, master_formats: request.body.masters }) },
        ],
        text: { format: zodTextFormat(LayoutAnalysis, "dco_layout_analysis") },
      });
      return response.json({ source: "openai", model, analysis: result.output_parsed });
    }
    return response.status(400).json({ error: "Unknown analysis mode." });
  } catch (error) {
    console.error("OpenAI analysis failed", error instanceof Error ? error.message : error);
    return response.status(502).json({ error: error instanceof Error ? error.message : "Analysis failed." });
  }
});

if (process.env.ADAPT_STATIC === "1") {
  const dist = path.resolve("dist");
  app.use(express.static(dist));
  app.get("/*splat", (_request, response) => response.sendFile(path.join(dist, "index.html")));
} else {
  const vite = await createViteServer({ server: { middlewareMode: true, hmr: false }, appType: "spa" });
  app.use(vite.middlewares);
}
const server = app.listen(port, "127.0.0.1", () => console.log(`Adapt ready at http://127.0.0.1:${port}`));
server.on("error", (error) => {
  console.error("Adapt server failed", error);
  process.exitCode = 1;
});
