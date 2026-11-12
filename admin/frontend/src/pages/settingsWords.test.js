// Tests for the settings screen rules (field builder, money words, theme preview).
import { describe, expect, it } from "vitest";
import { changeWords, isHex, keyFromLabel, moveField, newField, previewVars, rupees, setArchived } from "./settingsWords.js";

const fields = [{ key: "name", order: 10 }, { key: "phone", order: 20 }, { key: "about", order: 30 }];

describe("field builder screen", () => {
  it("makes a safe key from a label", () => {
    expect(keyFromLabel("Opening hours")).toBe("opening_hours");
    expect(keyFromLabel("  2nd phone! ")).toBe("f_2nd_phone");
    expect(keyFromLabel("?")).toBe("");
    expect(keyFromLabel("खुल्ने समय")).toBe("");            // a Nepali-only label needs an English one for the key
  });
  it("adds a field last with safe defaults, and refuses a used or empty key", () => {
    expect(newField(fields, "Opening hours")).toMatchObject({ key: "opening_hours", order: 40, required: false, visibility: "private", filledBy: "business_owner" });
    expect(newField(fields, "Name")).toBeNull();
    expect(newField(fields, "!!")).toBeNull();
    expect(newField(fields, "Kind", "select").options).toHaveLength(1);
    expect(newField(fields, "Licence", "file").file).toEqual({ types: ["pdf", "jpg", "png"], maxMB: 5 });
  });
  it("moves a field and renumbers", () => {
    expect(moveField(fields, "about", -1).map((f) => [f.key, f.order])).toEqual([["name", 10], ["about", 20], ["phone", 30]]);
    expect(moveField(fields, "name", -1).map((f) => f.key)).toEqual(["name", "phone", "about"]);
  });
  it("archives and brings back, never deletes", () => {
    const a = setArchived(fields, "phone", true, new Date("2026-11-12T00:00:00Z"));
    expect(a).toHaveLength(3);
    expect(a[1].archivedAt).toBe("2026-11-12T00:00:00.000Z");
    expect("archivedAt" in setArchived(a, "phone", false)[1]).toBe(false);
  });
});

describe("money and theme words", () => {
  it("writes paisa as rupees with Nepali grouping", () => {
    expect(rupees(12_500_000)).toBe("Rs. 1,25,000");
    expect(rupees(12_500_050)).toBe("Rs. 1,25,000.50");
    expect(rupees(-40_000)).toBe("-Rs. 400");
    expect(rupees(0)).toBe("Rs. 0");
  });
  it("words the change against the period before", () => {
    expect(changeWords(12.5)).toBe("+12.5% against the period before");
    expect(changeWords(-3)).toBe("-3% against the period before");
    expect(changeWords(null)).toBe("no earlier figure");
  });
  it("fills the preview from the three main colours when the optional ones are missing", () => {
    expect(previewVars({ colors: { brand: "#9D1D21", dark: "#1F1410", light: "#FBF7F4" }, radius: 8 })).toEqual({ "--pv-brand": "#9D1D21", "--pv-button": "#9D1D21", "--pv-text": "#1F1410", "--pv-page": "#FBF7F4", "--pv-surface": "#FFFFFF", "--pv-radius": "8px" });
    expect(isHex("#9D1D21")).toBe(true); expect(isHex("9D1D21")).toBe(false); expect(isHex("#FFF")).toBe(false);
  });
});
