# Adapt client demo implementation notes

## Source review

The project was selected after reviewing the supplied Ratios handoff, Plume repository and handoff, plus Rush Studio and UGC Studio. The source material was treated as design and architecture reference rather than a merge source.

## Current demo boundary

The Northstar sample proves the responsive layout and inheritance model without claiming to be a PSD. A real `.psd` import uses `ag-psd` locally and replaces the sample with parsed layer names, text and geometry. No PSD was included in the supplied files, so full Photoshop acceptance remains a named follow-up rather than a simulated success.

The OOH sizes CSV was not present in the referenced chat attachments or found under Documents during implementation. Eight representative formats are therefore marked as a curated client-demo set in `src/core/sample.ts`; the schema accepts a larger manifest without changing the artboard or cascade model.

## Next production steps

1. Add an approved prepared PSD fixture and pixel-perfect acceptance snapshots.
2. Persist projects and binaries outside browser memory with authentication and private object storage.
3. Import the full OOH size catalogue and attach media-owner validation/export profiles.
4. Add raster/vector layer previews, fonts and linked smart-object handling.
5. Implement After Effects, InDesign and Figma adapters against the existing `ImportAdapter` boundary.
