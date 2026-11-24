import { describe, expect, it } from "vitest";
import { inferRole, semanticLayerFromSource } from "./semantic";

describe("semantic PSD layer mapping", () => {
  it.each([
    ["01_BG_EXTEND", "background"],
    ["logo-lockup-final", "logo"],
    ["HERO_HEADLINE_EDITABLE", "headline"],
    ["product bottle", "hero"],
    ["legal footer", "legal"],
  ])("maps %s to %s", (name, role) => {
    expect(inferRole(name).role).toBe(role);
  });

  it("normalises source geometry into a semantic layer", () => {
    const layer = semanticLayerFromSource({ id: "1", name: "05_HEADLINE", text: "Hello", x: 7, y: 12, width: 40, height: 20 });
    expect(layer.role).toBe("headline");
    expect(layer.style.content).toBe("Hello");
    expect(layer.style.x).toBe(7);
  });
});
