import { describe, expect, it } from "vitest";
import { brandTheme, contrast, darkEnough, fillRoles, luminance, rolesFrom, savedRoles, textOn } from "./palette.js";

describe("brand colours", () => {
  it("keeps text readable on any brand colour", () => {
    expect(textOn("#FFD400")).toBe("#1F1F21");
    expect(textOn("#9D1D21")).toBe("#FFFFFF");
    expect(contrast(darkEnough("#FFD400"), "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    expect(darkEnough("#1F3A93")).toBe("#1F3A93");
  });

  it("sorts a logo's colours into brand, dark and light, in any order", () => {
    expect(rolesFrom(["#F4FBF6", "#000000", "#0A7D3B"])).toEqual({ brand: "#0A7D3B", dark: "#000000", light: "#F4FBF6" });
    // Navy and red: red is the brand colour, navy the dark one; no light colour in the logo.
    expect(rolesFrom(["#000D20", "#F2243D"])).toEqual({ brand: "#F2243D", dark: "#000D20", light: null });
    // Four colours: the most colourful is the brand, the darkest dark, the lightest light.
    expect(rolesFrom(["#1E5AA8", "#FFFFFF", "#111111", "#E8262B"])).toEqual({ brand: "#E8262B", dark: "#111111", light: "#FFFFFF" });
  });

  it("makes a missing role from the brand colour and says so", () => {
    const r = fillRoles({ brand: "#FFD400", dark: null, light: null });
    expect(r.made).toEqual({ dark: true, light: true });
    expect(contrast(r.dark, "#FFFFFF")).toBeGreaterThanOrEqual(14);
    expect(luminance(r.light)).toBeGreaterThan(0.85);
  });

  it("reads saved colours as brand, dark, light, and sorts older saves", () => {
    expect(savedRoles(["#0A7D3B", "#000000", "#F4FBF6"])).toEqual({ brand: "#0A7D3B", dark: "#000000", light: "#F4FBF6" });
    expect(savedRoles(["#000D20", "#F2243D"])?.brand).toBe("#F2243D");
    expect(savedRoles([])).toBeNull();
  });

  it("builds each theme only from the three colours", () => {
    const t = brandTheme(["#0A7D3B", "#000000", "#F4FBF6"]);
    expect(t.colors).toEqual(["#0A7D3B", "#000000", "#F4FBF6"]);
    expect(t.lightBar).toBe("#F4FBF6");
    expect(t.darkBar).toBe("#000000");
    expect(contrast(t.lightText, "#FFFFFF")).toBeGreaterThanOrEqual(7);
    expect(contrast(t.deep, "#FFFFFF")).toBeGreaterThanOrEqual(7);
    expect(contrast(t.accentInk, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    expect(brandTheme([])).toBeNull();
  });
});
