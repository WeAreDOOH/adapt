import type { ImportAdapter, ImportedCreative } from "./types";
import { semanticLayerFromSource } from "./semantic";

type PsdNode = {
  name?: string;
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
  text?: { text?: string };
  children?: PsdNode[];
};

function flatten(nodes: PsdNode[], parents: string[] = []): Array<PsdNode & { path: string }> {
  return nodes.flatMap((node) => {
    const name = node.name || "Untitled layer";
    const path = [...parents, name].join(" / ");
    return [{ ...node, path }, ...flatten(node.children || [], [...parents, name])];
  });
}

export const psdAdapter: ImportAdapter = {
  id: "psd",
  label: "Photoshop PSD",
  extensions: [".psd"],
  status: "available",
  async import(file: File): Promise<ImportedCreative> {
    const { readPsd } = await import("ag-psd");
    const buffer = await file.arrayBuffer();
    const psd = readPsd(buffer, { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true });
    const width = psd.width || 1;
    const height = psd.height || 1;
    const sourceLayers = flatten((psd.children || []) as PsdNode[]).filter((layer) => !layer.children?.length);
    const layers = sourceLayers.map((layer, index) => semanticLayerFromSource({
      id: `psd-${index}-${(layer.name || "layer").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      name: layer.path,
      kind: layer.text?.text ? "text" : "image",
      text: layer.text?.text,
      x: ((layer.left || 0) / width) * 100,
      y: ((layer.top || 0) / height) * 100,
      width: (((layer.right || width) - (layer.left || 0)) / width) * 100,
      height: (((layer.bottom || height) - (layer.top || 0)) / height) * 100,
    }));
    return {
      adapterId: "psd",
      fileName: file.name,
      width,
      height,
      layers,
      warnings: layers.length ? [] : ["The PSD opened but did not expose editable child layers."],
    };
  },
};
