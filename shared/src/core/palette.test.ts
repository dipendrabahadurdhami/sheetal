import { describe, expect, it } from "vitest";
import { brandTheme, contrast, darkEnough, luminance, textOn } from "./palette.js";

describe("brand colours", () => {
  it("keeps text readable on any brand colour", () => {
    expect(textOn("#FFD400")).toBe("#1F1F21");
    expect(textOn("#9D1D21")).toBe("#FFFFFF");
    expect(contrast(darkEnough("#FFD400"), "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    expect(darkEnough("#1F3A93")).toBe("#1F3A93");
  });

  it("finds the brand, light and dark colours and builds each theme from them", () => {
    const t = brandTheme(["#000000", "#0A7D3B", "#F4FBF6"]);
    expect(t.brand).toBe("#0A7D3B");
    expect(t.lightBar).toBe("#F4FBF6");
    expect(t.darkBar).toBe("#000000");
    expect(contrast(t.deep, "#FFFFFF")).toBeGreaterThanOrEqual(7);
    expect(contrast(t.accentInk, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    // Only a bright colour: light and dark bars are made from it.
    const y = brandTheme(["#FFD400"]);
    expect(contrast(y.darkBar, "#FFFFFF")).toBeGreaterThanOrEqual(12);
    expect(luminance(y.lightBar)).toBeGreaterThan(0.85);
    expect(brandTheme([])).toBeNull();
  });
});
