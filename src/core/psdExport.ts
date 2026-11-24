import type { PlannedMaster } from "./ratioPlanner";
import type { Psd } from "ag-psd";

function save(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function templatePsd(master: PlannedMaster): Psd {
  const width = master.format.width;
  const height = master.format.height;
  const safeX = width * 0.05;
  const safeY = height * 0.05;
  return {
    width,
    height,
    children: [
      { name: "08_LEGAL [EDITABLE]", text: { text: "LEGAL / URL", transform: [1, 0, 0, 1, safeX, height - safeY], style: { font: { name: "ArialMT" }, fontSize: Math.max(12, width * 0.012), fillColor: { r: 180, g: 180, b: 180 } } } },
      { name: "07_CTA [EDITABLE]", text: { text: "CALL TO ACTION", transform: [1, 0, 0, 1, safeX, height * 0.78], style: { font: { name: "Arial-BoldMT" }, fontSize: Math.max(18, width * 0.025), fillColor: { r: 220, g: 255, b: 87 } } } },
      { name: "06_BODY_COPY [EDITABLE]", text: { text: "Supporting copy", transform: [1, 0, 0, 1, safeX, height * 0.65], style: { font: { name: "ArialMT" }, fontSize: Math.max(16, width * 0.022), fillColor: { r: 230, g: 230, b: 230 } } } },
      { name: "05_HEADLINE [EDITABLE]", text: { text: "HEADLINE", transform: [1, 0, 0, 1, safeX, height * 0.38], style: { font: { name: "Arial-BoldMT" }, fontSize: Math.max(32, width * 0.07), fillColor: { r: 255, g: 255, b: 255 } } } },
      { name: "04_CAMPAIGN_LABEL [EDITABLE]", text: { text: "CAMPAIGN LABEL", transform: [1, 0, 0, 1, safeX, height * 0.22], style: { font: { name: "ArialMT" }, fontSize: Math.max(14, width * 0.016), fillColor: { r: 220, g: 255, b: 87 } } } },
      { name: "03_LOGO_LOCKUP [SMART OBJECT TARGET]", top: Math.round(safeY), left: Math.round(width * 0.76), bottom: Math.round(height * 0.16), right: Math.round(width - safeX) },
      { name: "02_HERO_PRODUCT [SMART OBJECT TARGET]", top: Math.round(height * 0.12), left: Math.round(width * 0.50), bottom: Math.round(height * 0.88), right: Math.round(width * 0.94) },
      { name: "01_BG_EXTEND_MASTER [SMART OBJECT / AI EXTEND]", top: 0, left: 0, bottom: height, right: width },
    ],
    imageResources: {
      gridAndGuidesInformation: {
        guides: [
          { location: safeX, direction: "vertical" },
          { location: width - safeX, direction: "vertical" },
          { location: safeY, direction: "horizontal" },
          { location: height - safeY, direction: "horizontal" },
          { location: width / 2, direction: "vertical" },
          { location: height / 2, direction: "horizontal" },
        ],
      },
    },
  };
}

export async function downloadTemplatePsds(masters: PlannedMaster[]) {
  const [{ writePsd }, { default: JSZip }] = await Promise.all([import("ag-psd"), import("jszip")]);
  const zip = new JSZip();
  for (const master of masters) {
    const fileName = `Adapt_${master.format.width}x${master.format.height}_${master.format.family}.psd`;
    zip.file(fileName, writePsd(templatePsd(master), { generateThumbnail: false }));
  }
  zip.file("README.txt", "Adapt PSD templates\n\nReplace [SMART OBJECT TARGET] layers in Photoshop with linked or embedded smart objects. Keep the background focal point inside the 5% guides. [AI EXTEND] marks backgrounds that may be outpainted for extreme ratios. Generated from the current verified Ratios footprint.");
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  save(blob, `Adapt_PSD_templates_${masters.length}.zip`);
}
