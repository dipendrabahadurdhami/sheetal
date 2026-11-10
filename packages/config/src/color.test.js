// Tests for the colour maths and the theme contrast guard (checkTheme): the 4.5:1 rule for text and buttons, 3:1 for borders and focus.
// The old contrast / palette tests in shared/src/core run unchanged through the shims; these cover what is new.
import { describe, expect, it } from "vitest";
import { checkPair, checkTheme, contrast, nudge, textOn, THEME_MODES } from "./color.js";

const theme = (colors, extra = {}) => ({ v: 1, colors, fonts: { heading: null, body: null, nepali: null }, radius: 8, logo: { light: null, dark: null, favicon: null }, ...extra });
const row = (r, id, mode) => r.report.find((x) => x.id === id && (!mode || x.mode === mode));

describe("checkPair: the ratio rule", () => {
  // [text, background, minimum, passes?]
  const table = [
    ["#000000", "#FFFFFF", 4.5, true],
    ["#FFFFFF", "#9D1D21", 4.5, true],     // Sheetal crimson with white text
    ["#767676", "#FFFFFF", 4.5, true],     // the classic lowest grey that still passes AA
    ["#777777", "#FFFFFF", 4.5, false],    // one step lighter fails
    ["#BBBBBB", "#FFFFFF", 4.5, false],
    ["#949494", "#FFFFFF", 3, true],       // fine for a border (3:1), too light for text
    ["#AAAAAA", "#FFFFFF", 3, false],
    ["#1F1F21", "#D9534F", 4.5, false],    // dark text on a mid red-orange: neither colour reaches 4.5
  ];
  it.each(table)("%s on %s needs %s:1 → %s", (fg, bg, min, pass) => {
    expect(checkPair(fg, bg, min).pass).toBe(pass);
  });
  it("gives the ratio with two decimals", () => {
    expect(checkPair("#000000", "#FFFFFF", 4.5).ratio).toBe(21);
  });
});

describe("nudge", () => {
  it("darkens text on a light page and lightens it on a dark page until it passes", () => {
    expect(contrast(nudge("#BBBBBB", "#FFFFFF", 4.5), "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(nudge("#444444", "#000000", 4.5), "#000000")).toBeGreaterThanOrEqual(4.5);
  });
  it("leaves a passing colour alone", () => { expect(nudge("#000000", "#FFFFFF", 4.5)).toBe("#000000"); });
});

describe("checkTheme: buttons (4.5:1, Lead decision)", () => {
  it("keeps a button whose text already reads", () => {
    const r = checkTheme(theme({ brand: "#9D1D21", dark: "#000000", light: "#FFFFFF" }));
    expect(row(r, "button.text").status).toBe("pass");
    expect(r.tokens.colors.button).toBeUndefined();
  });
  it("darkens a mid-tone button where neither white nor near-black text reaches 4.5", () => {
    const before = "#D9534F";
    expect(contrast(textOn(before), before)).toBeLessThan(4.5);
    const r = checkTheme(theme({ brand: "#9D1D21", dark: "#000000", light: "#FFFFFF", button: before }));
    const b = row(r, "button.text");
    expect(b.status).toBe("adjusted");
    expect(r.tokens.colors.button).not.toBe(before);
    expect(contrast("#FFFFFF", r.tokens.colors.button)).toBeGreaterThanOrEqual(4.5);
    expect(r.ok).toBe(true);
  });
  it("does not change the colours it was given", () => {
    const input = theme({ brand: "#9D1D21", dark: "#000000", light: "#FFFFFF", button: "#D9534F" });
    checkTheme(input);
    expect(input.colors.button).toBe("#D9534F");
  });
});

describe("checkTheme: text, borders, focus", () => {
  it("passes Sheetal's own default theme in every mode", () => {
    const r = checkTheme(theme({ brand: "#9D1D21" }));
    expect(r.ok).toBe(true);
    expect(r.blocked).toEqual([]);
    for (const m of THEME_MODES) expect(row(r, "text.page", m).ratio).toBeGreaterThanOrEqual(4.5);
  });
  it("covers all four modes", () => {
    const r = checkTheme(theme({ brand: "#0A7D3B", dark: "#000000", light: "#F4FBF6" }));
    expect(new Set(r.report.map((x) => x.mode))).toEqual(new Set(["all", ...THEME_MODES]));
  });
  it("blocks grey body text the person chose on a white page, and suggests a colour that passes", () => {
    const r = checkTheme(theme({ brand: "#9D1D21", text: "#BBBBBB", page: "#FFFFFF" }));
    expect(r.ok).toBe(false);
    const t = row(r, "text.page", "light");
    expect(t.status).toBe("blocked");
    expect(t.ratio).toBeLessThan(4.5);
    expect(contrast(t.suggestion, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
  });
  it("blocks body text that fails on the cards and forms colour the person chose", () => {
    const r = checkTheme(theme({ brand: "#9D1D21", text: "#333333", page: "#FFFFFF", surface: "#222222" }));
    expect(row(r, "text.surface", "light").status).toBe("blocked");
    expect(row(r, "text.page", "light").status).toBe("pass");
  });
  it("blocks an input border the person chose when it is under 3:1, and fixes a derived one", () => {
    const r = checkTheme(theme({ brand: "#9D1D21", field: "#FFFFFF", fieldBorder: "#EEEEEE" }));
    expect(row(r, "border.field", "light").status).toBe("blocked");
    const ok = checkTheme(theme({ brand: "#9D1D21" }));
    for (const m of THEME_MODES) expect(row(ok, "border.field", m).ratio).toBeGreaterThanOrEqual(3);
  });
  it("derived colours always end at 4.5 (hints, links) and 3 (focus ring)", () => {
    const r = checkTheme(theme({ brand: "#FFD400", dark: "#111111", light: "#FFFFFF" }));
    for (const m of THEME_MODES) {
      expect(row(r, "muted.page", m).ratio).toBeGreaterThanOrEqual(4.5);
      expect(row(r, "link.page", m).ratio).toBeGreaterThanOrEqual(4.5);
      expect(row(r, "ring.page", m).ratio).toBeGreaterThanOrEqual(3);
    }
    expect(r.ok).toBe(true);
  });
});

describe("checkTheme: nothing unchecked reaches CSS", () => {
  it("blocks anything that is not #rrggbb", () => {
    const r = checkTheme(theme({ brand: "red; background:url(x)" }));
    expect(r.ok).toBe(false);
    expect(r.modes).toBeNull();
    expect(r.blocked[0].id).toBe("format.brand");
  });
  it("blocks a font that is not a library id", () => {
    const r = checkTheme(theme({ brand: "#9D1D21" }, { fonts: { heading: "Comic Sans; }", body: null, nepali: null } }));
    expect(r.ok).toBe(false);
    expect(r.blocked[0].id).toBe("format.font.heading");
  });
  it("accepts a library font id", () => {
    expect(checkTheme(theme({ brand: "#9D1D21" }, { fonts: { heading: "f_ab12", body: null, nepali: null } })).ok).toBe(true);
  });
  it("clamps the corner radius to 0-20", () => {
    expect(checkTheme(theme({ brand: "#9D1D21" }, { radius: 99 })).tokens.radius).toBe(20);
    expect(checkTheme(theme({ brand: "#9D1D21" }, { radius: -3 })).tokens.radius).toBe(0);
  });
});
