import fs from "node:fs/promises";
import path from "node:path";
import { writePsd } from "ag-psd";

const width = 2400;
const height = 1600;

function imageData(w, h, pixel) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const [r, g, b, a] = pixel(x, y, w, h);
    const offset = (y * w + x) * 4;
    data[offset] = r; data[offset + 1] = g; data[offset + 2] = b; data[offset + 3] = a;
  }
  return { width: w, height: h, data };
}

const background = imageData(width, height, (x, y, w, h) => {
  const nx = x / w; const ny = y / h;
  const glow = Math.max(0, 1 - Math.hypot(nx - .70, ny - .52) * 2.2);
  return [Math.round(8 + 55 * nx + 45 * glow), Math.round(17 + 20 * glow), Math.round(34 + 88 * nx + 50 * glow), 255];
});

const heroW = 820; const heroH = 1280;
const hero = imageData(heroW, heroH, (x, y, w, h) => {
  const nx = (x - w / 2) / (w / 2); const ny = y / h;
  const neck = Math.abs(nx) < .18 && ny > .03 && ny < .24;
  const bodyWidth = .34 + .16 * Math.sin(Math.min(1, Math.max(0, (ny - .18) / .25)) * Math.PI / 2);
  const body = Math.abs(nx) < bodyWidth && ny >= .18 && ny < .94;
  if (!neck && !body) return [0, 0, 0, 0];
  const edge = Math.min(1, Math.abs(nx) / Math.max(.18, bodyWidth));
  return [Math.round(65 + 100 * (1 - edge)), Math.round(175 + 60 * (1 - edge)), Math.round(176 + 70 * ny), Math.round(170 + 70 * (1 - edge))];
});

const text = (name, value, x, y, size, color, font = "ArialMT") => ({ name, text: { text: value, transform: [1, 0, 0, 1, x, y], style: { font: { name: font }, fontSize: size, fillColor: color } } });
const psd = {
  width, height,
  imageData: background,
  children: [
    text("08_LEGAL", "NORTHSTARDRINKS.COM   0.0% ABV", 170, 1505, 24, { r: 150, g: 155, b: 166 }),
    text("07_CTA", "TASTE THE NIGHT  >", 170, 1340, 42, { r: 218, g: 255, b: 87 }, "Arial-BoldMT"),
    text("06_BODY_COPY", "Botanical flavour. Electric finish.\nA new kind of nightcap.", 170, 1120, 38, { r: 210, g: 214, b: 220 }),
    text("05_HEADLINE_EDITABLE", "BRIGHTER\nAFTER DARK", 170, 610, 142, { r: 248, g: 246, b: 238 }, "Arial-BoldMT"),
    text("04_CAMPAIGN_LABEL", "ZERO PROOF / FULL COLOUR", 170, 380, 34, { r: 218, g: 255, b: 87 }),
    text("03_LOGO_LOCKUP", "NORTH\nSTAR", 170, 165, 58, { r: 242, g: 255, b: 236 }, "Arial-BoldMT"),
    { name: "02_HERO_PRODUCT", left: 1420, top: 160, right: 1420 + heroW, bottom: 160 + heroH, imageData: hero },
    { name: "01_BG_EXTEND_MASTER [AI EXTEND / CONVERT TO SMART OBJECT]", left: 0, top: 0, right: width, bottom: height, imageData: background },
  ],
  imageResources: { gridAndGuidesInformation: { guides: [
    { location: 120, direction: "vertical" }, { location: 2280, direction: "vertical" },
    { location: 80, direction: "horizontal" }, { location: 1520, direction: "horizontal" },
    { location: 1200, direction: "vertical" }, { location: 800, direction: "horizontal" },
  ] } },
};

const output = writePsd(psd, { generateThumbnail: false });
const targets = [
  path.resolve("public/demo/brighter-after-dark-prepared.psd"),
  path.resolve("/Users/patrick/Documents/2026-11-24/referenced-chatgpt-conversation-this-is-an/outputs/Brighter_After_Dark_Prepared.psd"),
];
for (const target of targets) { await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, Buffer.from(output)); }
console.log(JSON.stringify({ bytes: output.byteLength, targets }));
