import { describe, expect, it } from "vitest";
import { writePsd } from "ag-psd";
import { psdAdapter } from "./psd";

describe("PSD adapter", () => {
  it("imports a real layered PSD binary and maps editable structure", async () => {
    const bytes = writePsd({
      width: 1200,
      height: 800,
      children: [
        { name: "01_BG_EXTEND", top: 0, left: 0, bottom: 800, right: 1200 },
        { name: "05_HEADLINE_EDITABLE", top: 120, left: 84, bottom: 350, right: 620, text: { text: "HELLO OOH" } },
        { name: "03_LOGO_LOCKUP", top: 50, left: 930, bottom: 140, right: 1120 },
      ],
    }, { generateThumbnail: false });
    const file = new File([bytes], "prepared-campaign.psd", { type: "image/vnd.adobe.photoshop" });
    const imported = await psdAdapter.import(file);

    expect(imported.fileName).toBe("prepared-campaign.psd");
    expect(imported.width).toBe(1200);
    expect(imported.height).toBe(800);
    expect(imported.layers).toHaveLength(3);
    expect(imported.layers.find((layer) => layer.role === "headline")?.style.content).toBe("HELLO OOH");
    expect(imported.layers.find((layer) => layer.role === "logo")?.style.x).toBe(77.5);
  });
});
