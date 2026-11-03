import { describe, expect, it } from "vitest";
import { brandTheme, contrast, darkEnough, textOn } from "./palette.js";

describe("brand colours", () => {
  it("keeps text readable on any brand colour", () => {
    expect(textOn("#FFD400")).toBe("#1F1F21");
    expect(textOn("#9D1D21")).toBe("#FFFFFF");
    expect(contrast(darkEnough("#FFD400"), "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    expect(darkEnough("#1F3A93")).toBe("#1F3A93");
  });

  it("makes bars from the first colour and buttons from a different second one", () => {
    const t = brandTheme(["#0A7D3B", "#F2A900", "#0B8A40"]);
    expect(contrast(t.bar, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.accent, "#FFFFFF")).toBeGreaterThanOrEqual(3);
    expect(t.accent).not.toBe(t.bar);
    expect(brandTheme([])).toBeNull();
  });
});
