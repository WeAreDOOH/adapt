# Adapt

Adapt is a client-demo creative versioning studio for turning one prepared layered source into a coherent family of DOOH layouts. It demonstrates semantic layer mapping, responsive artboards, background bleed and focal positioning, shared copy and intelligent type fitting, logo anchoring, layout guides, scope-aware overrides, and deliberate refinement of similar aspect ratios.

## Run locally

```bash
npm install
npm run dev
```

Open the URL printed by Vite. Run the complete local check with:

```bash
npm run check
```

## PSD support and demo fallback

- **Real PSD support:** the browser-side `ag-psd` adapter reads a selected `.psd`, walks its layer tree, imports text and source geometry, and maps layer names to semantic roles. The file remains in the browser. An automated round-trip test builds and imports a genuine layered PSD binary.
- **Demo fallback:** the included Northstar campaign is generated from the versioned DCO schema because no prepared PSD was supplied with the handoff. The interface labels this source as `DEMO` throughout.
- Photoshop fidelity still needs a representative prepared PSD acceptance fixture. The current importer deliberately skips layer pixel data and focuses on the editable structure needed for the layout demo.

## Architecture

- `src/core/schema.ts` — `dooh.adapt-template` v1 schema, cascade resolution, ratio similarity and smart type fitting.
- `src/importers/` — modular adapters. PSD is available; After Effects, InDesign and Figma are explicit planned seams.
- `src/components/Artboard.tsx` — deterministic responsive preview shared by every format.
- `src/core/sample.ts` — client-safe sample campaign and curated OOH formats used only when no real PSD has been imported.

The cascade resolves `Global → family → local`, preserving deliberate exceptions while shared edits keep flowing. Export produces a portable versioned JSON DCO template.

## Reference decisions

- Ratios inspired fidelity-first geometry, shared placement rules and visible verification.
- Rush Studio inspired the inheritance cascade, artboard workspace and scoped editing.
- UGC Studio inspired versioned contracts and independent adapter boundaries.
- Plume inspired local-first operation, strong presets and graceful capability fallback.

No reference studio was merged wholesale.
