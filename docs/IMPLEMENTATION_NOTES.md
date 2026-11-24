# Adapt client demo implementation notes

## Source review

The project was selected after reviewing the supplied Ratios handoff, Plume repository and handoff, plus Rush Studio and UGC Studio. The source material was treated as design and architecture reference rather than a merge source.

## Current demo boundary

The Northstar sample proves the responsive layout and inheritance model without claiming to be a PSD. A real `.psd` import uses `ag-psd` locally and replaces the sample with parsed layer names, text and geometry. No PSD was included in the supplied files, so full Photoshop acceptance remains a named follow-up rather than a simulated success.

The OOH sizes CSV was supplied after the initial implementation. It contains 1,503 validated specifications from 121 media owners, covering 549 unique dimensions and 320 exact ratios. The original CSV is preserved unchanged in Imports and the repository's public data folder. The eight representative campaign formats remain the default opening set; the searchable catalogue can add any production specification without loading all 1,503 artboards at once.

## Next production steps

1. Add an approved prepared PSD fixture and pixel-perfect acceptance snapshots.
2. Persist projects and binaries outside browser memory with authentication and private object storage.
3. Attach media-owner validation and export profiles to the imported format catalogue.
4. Add raster/vector layer previews, fonts and linked smart-object handling.
5. Implement After Effects, InDesign and Figma adapters against the existing `ImportAdapter` boundary.
