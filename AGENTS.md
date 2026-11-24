# Brief for the next system

**What this is.** A single-file browser app, `src/aspect-ratios.html` (~2,100 lines, 180 KB). No framework,
no bundler, no server. All logic is inside one IIFE in the `<script>` at the end of the file.

**Before changing anything:** run `python3 tests/smoke_test.py` (see README). It must print
`All checks passed`. Re-run after every change. A changed "files to create" number almost always
means a planner regression: the example list must give 30 / 15 / 12 / 9 files (see HANDOFF.md, Testing).

**Invariants. Do not break these:**
1. Fidelity first. Artwork is never upscaled unless "Allow upscaling" is on; never cropped unless
   "Crop to fill" is on and within its limit. Supplied artwork obeys the same rules (`artPlace`).
2. One placement rule. `placeIn(row, size)` decides where a master sits in every size, in whole pixels
   with even margins. Previews, rendered sizes, Smart PSDs and the After Effects builder all use it.
   Add new outputs on top of `placeIn` / `artPlace`, never with their own geometry.
3. `verifyFormat` re-derives every result independently of the planner. Keep it independent.
4. The hidden textarea `#input` is the source of truth for sizes; the grid editor writes into it.
5. Plan state (`getState`/`applyState`) is what localStorage, share links and exports carry.
   New settings must be added there, to `DEFAULTS`, and to Reset.
6. Downloads go through `save()` (platform `downloads` capability). Libraries load on demand from
   pinned URLs only: SheetJS 0.18.5 (cdnjs), JSZip 3.10.1 (cdnjs), ag-psd 31.0.2 (jsDelivr).

**Generated text that leaves the browser** (the After Effects `.jsx`) must stay ES3: no `let`,
`const`, arrow functions or template literals inside the generated script.

**Open items that need a human with Adobe apps:** confirm Smart PSDs in Photoshop; run the After Effects
builder end to end; open the three `.aepx` probes (experimental/aepx/probes) and record which load.

**Style.** Dark Material look; colours only via CSS custom properties (`--accent`, `--ok`, `--warn`,
`--clip`, `--group`, `--pink`). UK English in UI copy. Sentence case labels except export buttons,
which keep mixed case so "PSDs" reads correctly.
