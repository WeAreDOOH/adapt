# Ratios. — technical handoff

Prepared 23 November 2026. Source of truth: `src/aspect-ratios.html` (2,086 lines, 180 KB), identical
to the live page at https://claude.ai/artifact/XneDxHjc9rPQNz7M1pavYW at the time of packaging.

## 1. What it does

A planner pastes screen sizes. The tool groups them by exact aspect ratio, then works out the fewest
artwork files that cover every size, using only the scaling rules the user allows, ordered by risk:

| Rule | Risk colour | Default | What it permits |
| --- | --- | --- | --- |
| Allow downscaling | green | on | make a size by shrinking a larger file of the same shape |
| Float artwork with tramlines | amber | off | fit a file inside a near-fit screen, empty bands ("tramlines") on one axis; limit = max % of screen left empty (default 10%) |
| Allow upscaling | amber | off | enlarge a file (for distant viewing) |
| Portrait and landscape as one | amber | off | group 9:16 with 16:9 |
| Crop to fill | red | off | fill a near-fit screen and trim the overhang; limit = max % of artwork cropped (default 5%) |

Every size is then re-checked independently, and the plan can be exported or handed to artworkers.

## 2. Architecture

* One HTML file; one IIFE. Every input event calls `render()`, which rebuilds everything from scratch:
  `parse` (text → sizes) → `compute` (group by exact ratio) → `computePlans` (choose each size's source,
  its "root") → `renderSpec` / `verifyFormat` (independent re-check) → views and exports.
* Globals worth knowing: `current` (ratio groups), `allTargets` (unique sizes), `planMap`, `specRows`
  (one row per file: `F` the file, `fm` the sizes made from it with their check), `artwork` (existing
  artwork list), `artMap` (dropped artwork images by file label), `fileColors` (per-file tramline colours).
* Runtimes: as a plain local file everything works except downloads. Inside the claude.ai viewer,
  `window.claude.use('downloads')` provides saving; the page is published with `capabilities: {downloads: true}`.
  When republishing, omit `capabilities` (keeps it) or restate it; an empty object removes downloads.
  For self-hosting, replace `save(filename, data)` with an ordinary Blob + `<a download>` link.

## 3. Core logic

* **Parsing** (`parse`): any line with `W` + separator (x × * : , ; tab space) + `H`, decimals allowed.
  Unreadable non-blank lines are reported with their line number.
* **Grouping** (`compute`): reduce by GCD to a ratio key; duplicates merge with a count.
* **Planning** (`computePlans`), largest area first. Pool = roots chosen so far, or the Existing
  artwork list when given. First rule that succeeds wins:
  1. same-ratio downscale (needs Allow downscaling unless same size);
  2. near-fit (`nearFit`): best float (`floatFit`, smallest empty share) vs best crop (`clipInfo`, smallest
     trim); the smaller loss wins, a tie goes to floating;
  3. upscale paths (only with Existing artwork and Allow upscaling);
  4. otherwise a new master, or "needs artwork".
* **Placement** (`placeIn(row, size)`): the single geometry rule. Floats fit inside, everything else
  fills and trims; whole pixels; odd leftovers nudged by 1 px so margins are equal.
* **Supplied artwork** (`artPlace`): same shape as its file → follows `placeIn`; different shape →
  fitted straight into each screen (tramlines on one axis only), trimmed only if Crop to fill allows it.
* **Verification** (`verifyFormat`): re-derives each size from geometry alone and checks it against the
  settings. Shares no decision code with the planner.
* **Savings badges** (`updateImpacts` / `filesWith`): re-plan with one setting flipped.

## 4. UI map

Four stat cards act as tabs (`showTab`): **Sizes**, **Unique ratios** (purple), **Files to create**
(green; default view), **Artwork supplied** (pink). Left panel: sizes grid editor (3 columns, column-first;
Grid/Text switch), Scaling rules with risk key lines, savings badges and demo animations, Reset,
Existing artwork, Open a shared plan. The panel collapses to a rail (auto-collapses on Unique ratios).

* **Files to create:** verdict, check pills, export buttons, file cards or list (`ar-filesview`).
* **Sizes:** every input line as thumbnails or list (`ar-sizesview`).
* **Unique ratios:** ratio list beside a sticky to-scale diagram; Spread / Collapse / Bunch;
  Tramlines comparison panels; drill-down filter from Files/Sizes (`drill`).
* **Artwork supplied:** drop PNG/JPG/WebP; matched by exact size → same ratio → within 3%, else a tray.
  Previews per size with scale notes (green 1:1, amber ↓, red ↑). Per-file tramline colour + eyedropper.
  Click a preview for the properties dialog (screen / plan / your artwork tables, download one size).

## 5. Persistence and sharing

`getState`/`applyState` carry sizes, existing artwork, the five rules, both limits, the default
tramline colour and per-file colours. localStorage keys: `ar-state`, `ar-draft` (legacy), `ar-tools`,
`ar-filesview`, `ar-sizesview`, `ar-szview`. Share link: page URL + `#plan=` + deflate + base64url
(`z` prefix; `j` = uncompressed fallback). The "Open a shared plan" box accepts a pasted link or code.

## 6. Exports (all built on click from the current plan; file names carry date and time)

| Button | Output | Notes |
| --- | --- | --- |
| Excel | `.xlsx`: Files to create, Sizes, Settings and checks | SheetJS 0.18.5 |
| Brief | printable `.html` | |
| PSDs | `.zip` of one PSD per file: empty Artwork layer, guides (centre, 5% margin, safe area), safe-area frame, hidden per-size outlines | ag-psd 31.0.2 + JSZip 3.10.1. Read back with psd-tools; not yet confirmed in Photoshop |
| Smart PSDs | `.zip`: one PSD per file, an artboard per size, all instances of one embedded smart-object master | Owner reports "looking really good"; centring fixed to whole pixels |
| After Effects | `.zip`: `Ratios_build_project.jsx` + artwork + README | Run inside After Effects via File › Scripts › Run Script File (not by double-click: macOS may open Audition). Builds one project, a folder per file, master comp + nested size comps, saves `.aep`. Script is ES3 with `#target aftereffects` and an app guard. Owner has run it successfully |
| All sizes (Artwork view) | `.zip` of JPGs rendered from supplied artwork | |
| Share link / Copy CSV (icons) | clipboard | |

## 7. After Effects project file (experimental, not in the page)

Goal: download a ready `.aepx` without running the script. `experimental/aepx/gen.py` clones blocks
from `template.aepx` (saved by the owner from After Effects 2026, Mac) and patches the binary fields
documented in its docstrings (item/layer ids, comp size, nested-layer scale, solids, guides, hidden view
layers). Status: the first generated project failed to open ("No data in aepx file"). Three probes are in
`experimental/aepx/probes/`: (1) template + one cloned comp, (2) small project keeping the text layer,
(3) the same without it. **Next step:** open each in After Effects and record which load; that isolates
the rejected change. Until then the `.jsx` builder is the supported route.

## 8. Testing

`tests/smoke_test.py`: 31 checks, all passing at handoff. Pinned numbers for the 31-size example list:
downscaling off 30 files, defaults 15, Crop to fill 12, Float (with or without crop) 9. Also covers
skipped lines, reset, views, drill-down, the sizes grid, share link round trip, remembered settings,
artwork matching and previews, and every download through a mocked `window.claude`.
Not covered: animations, light theme, mobile widths, keyboard flows, Safari/Firefox.

## 9. Known issues and debt

* Single file, many shared mutable globals; split into modules with a single-file build for publishing.
* Dead code from the removed Exact/Nearest switch (`mode`, `approx` branch, `sameRatio` tolerance path,
  hidden `sort` select), unused `artFit`/`artScale`, leftover `o.tl` overlay code, unused CSS.
* `filesWith` flips real checkboxes to re-plan; make the planner pure.
* Greedy planner: not guaranteed minimal across floats and crops.
* Supplied artwork smaller than its master is still enlarged in previews (flagged red) even with
  Allow upscaling off. Owner was asked whether it should obey that switch; no answer yet.
* Main diagram outlines aren't keyboard reachable. Tested only in Chromium.

## 10. Roadmap (rough priority)

1. Finish the `.aepx` probes (section 7).
2. Confirm PSDs / Smart PSDs in Photoshop.
3. Named rows (frame IDs, screen counts) carried into spec and exports.
4. Minimum downscale limit (e.g. never below 40%).
5. Typo detection (odd ratios, outliers, near-duplicates).
6. Filters/sorting; presets (Strict / Balanced / Maximum); manual overrides (always bespoke, choose master).
7. InDesign via IDML. Persist dropped artwork in IndexedDB.

## 11. Decisions (why it is the way it is)

* Fidelity first, then fewer files. Upscaling and cropping are opt-in, colour-coded by risk.
* Floats limited by empty share of the screen (1000×180 in 1100×180 = 9.1% is fine; 1000×10 in 1000×1000 is not).
* Ties between float and crop go to floating (keeps the whole image).
* An independent re-check reassures users nothing was dropped or wrongly grouped.
* Spec leads; detail is a drill-down away. Cards over long tables; no scroll areas inside the page scroll.
* Downloads are built on click from the live plan; nothing is stored server-side.
* After Effects `.aep` is a closed binary format, so the supported route has AE write it via a script.
