import type { SemanticLayer } from "../core/schema";

export interface ImportedCreative {
  adapterId: string;
  fileName: string;
  width: number;
  height: number;
  layers: SemanticLayer[];
  warnings: string[];
  previewUrl?: string;
}

export interface ImportAdapter {
  id: "psd" | "after-effects" | "indesign" | "figma";
  label: string;
  extensions: string[];
  status: "available" | "planned";
  import(file: File): Promise<ImportedCreative>;
}
