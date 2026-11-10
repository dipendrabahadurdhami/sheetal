// Colour maths for brand themes: contrast, shades, the three brand roles, and the theme contrast guard (checkTheme).
// Where it fits: the panels' brand themes (business logo colours), the theme editor's live preview, and the server's real
// check of a saved theme. Moved here from shared/src/core/palette.js and contrast.js (task P1-FE-1); those two files are now shims.
// How it works: pure functions on "#rrggbb" strings. No DOM, no React, so the browser and the server run the same code.
// Rules: no colour outside the logo's own (only lighter or darker shades for readable text); only "#rrggbb" is ever accepted;
// the picture-reading parts (extractPalette, cleanLogo) stay in shared/src/core/palette.js because they need a canvas.

const hex = (r, g, b) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
export const toRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

/** WCAG relative luminance (0 black – 1 white). */
export function luminance(h) {
  const [r, g, b] = toRgb(h).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
/** White or near-black, whichever reads better on this colour. */
export const textOn = (bg) => (contrast(bg, "#FFFFFF") >= contrast(bg, "#1F1F21") ? "#FFFFFF" : "#1F1F21");

/** Mixes colour a with colour b: share 0 is all a, 1 is all b. */
export function mix(a, b, share) {
  const [x, y] = [toRgb(a), toRgb(b)];
  return hex(x[0] + (y[0] - x[0]) * share, x[1] + (y[1] - x[1]) * share, x[2] + (y[2] - x[2]) * share);
}

/** Mixes a colour toward black (amount < 0) or white (amount > 0), -1…1. */
export function shade(h, amount) {
  const [r, g, b] = toRgb(h);
  const t = amount < 0 ? 0 : 255, p = Math.abs(amount);
  return hex(r + (t - r) * p, g + (t - g) * p, b + (t - b) * p);
}
/** The same hue, darkened just enough for white text on it (contrast 4.5:1). */
export function darkEnough(h, ratio = 4.5) {
  let c = h;
  for (let i = 0; i < 20 && contrast(c, "#FFFFFF") < ratio; i++) c = shade(c, -0.08);
  return c;
}

export const toHex = hex;
const sat = ([r, g, b]) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx === 0 ? 0 : (mx - mn) / mx; };

/**
 * The three roles from a logo's colours:
 *  - brand: the most colourful one (buttons, highlights, the colour themes);
 *  - dark: the darkest, if it is really dark (dark themes);
 *  - light: the lightest, if it is really light (the light theme).
 * A role the logo doesn't have is null; fillRoles makes it from the brand colour.
 */
export function rolesFrom(colors) {
  if (!colors?.length) return { brand: null, dark: null, light: null };
  const mid = colors.filter((c) => luminance(c) > 0.03 && luminance(c) < 0.8);
  const brand = (mid.length ? mid : colors).reduce((best, c) => (sat(toRgb(c)) > sat(toRgb(best)) ? c : best));
  const others = colors.filter((c) => c !== brand);
  const darkest = others.length ? others.reduce((a, c) => (luminance(c) < luminance(a) ? c : a)) : null;
  const lightest = others.length ? others.reduce((a, c) => (luminance(c) > luminance(a) ? c : a)) : null;
  return {
    brand,
    dark: darkest && luminance(darkest) < 0.12 ? darkest : null,
    light: lightest && luminance(lightest) > 0.7 ? lightest : null,
  };
}

/** The three roles always filled: a missing dark colour is made from the brand colour, a missing light one is white. */
export function fillRoles({ brand, dark, light }) {
  const b = brand || "#9D1D21";
  return {
    brand: b,
    dark: dark || darkEnough(shade(b, -0.8), 14),
    // No light colour in the logo: plain white (the light theme stays neutral, no made-up tint).
    light: light || "#FFFFFF",
    made: { dark: !dark, light: !light },
  };
}

/** Saved colours to roles: new saves are [brand, dark, light]; older saves (any order) are sorted into roles. */
export function savedRoles(colors) {
  if (!colors?.length) return null;
  if (colors.length === 3) return { brand: colors[0], dark: colors[1], light: colors[2] };
  return fillRoles(rolesFrom(colors));
}

/**
 * The workspace theme from a business's three colours (brand, dark, light; see savedRoles). Only those colours
 * are used, plus lighter or darker versions of them where text must stay readable:
 *  - light theme: bars in the light colour, text in the dark colour, buttons in the brand colour;
 *  - dark theme: bars and page in the dark colour;
 *  - colour theme: the page in the brand colour, bars in the dark colour;
 *  - colour bars: bars in the brand colour, the page dark.
 */
export function brandTheme(colors) {
  const r = savedRoles(colors);
  if (!r) return null;
  const { brand, dark, light } = r;
  const accent = darkEnough(brand, 3);
  const darkBar = darkEnough(dark, 12);
  return {
    brand, dark, light,
    accent, accentText: textOn(accent),
    // Text in the brand colour on white (links, the selected tab).
    accentInk: darkEnough(brand, 4.5),
    // Selected items: a light grey between the logo's light and dark colours (no tint of the brand colour).
    accentSoft: mix(light, dark, 0.07),
    lightBar: light,
    // Light theme text and lines from the dark colour (no Sheetal grey).
    lightText: darkEnough(dark, 7),
    lightLine: mix("#FFFFFF", dark, 0.22),
    darkBar,
    // The dark page is the logo's dark colour itself.
    darkPage: darkBar,
    // Muted text and lines in the dark themes: between the logo's light and dark colours.
    mist: mix(light, dark, 0.28),
    // The colour theme: the brand colour as the page (deep) and highlights (base).
    deep: darkEnough(brand, 4.5), base: darkEnough(brand, 3.2),
    colors: [brand, dark, light],
  };
}


// ───── From contrast.js (text on a business's own button or link colour) ─────
const HEX = /^#[0-9a-f]{6}$/i;
/** True for "#rrggbb" (the only colour format ever written into CSS). */
export const isHex = (v) => typeof v === "string" && HEX.test(v);
export const contrastWithWhite = (h) => (HEX.test(h) ? 1.05 / (luminance(h) + 0.05) : 21);
/** Text colour on white: the brand colour if it is readable, otherwise a darker mix of it. */
export const inkFor = (h) => { const r = contrastWithWhite(h); return r >= 4.5 ? h : "color-mix(in srgb, " + h + " " + (r >= 3 ? 70 : 45) + "%, black)"; };
/** Text colour on a brand-coloured button. */
export const btnInkFor = (h) => (contrastWithWhite(h) >= 4.5 ? "#FFFFFF" : "#1F1F21");

// ───── checkTheme: the contrast guard (docs/architecture/FRONTEND-KIT.md section 9.4) ─────
export const THEME_MODES = ["light", "dark", "red", "bars"];
const SHEETAL_CRIMSON = "#9D1D21";
const FONT_ID = /^f_[a-z0-9]{2,16}$/;

/** One pair: the ratio (2 decimals) and whether it reaches `min`. */
export function checkPair(fg, bg, min) {
  const ratio = Math.round(contrast(fg, bg) * 100) / 100;
  return { ratio, pass: contrast(fg, bg) >= min };
}

/** Moves `fg` away from `bg` (toward black on a light background, white on a dark one) until the pair reaches `min`. */
export function nudge(fg, bg, min) {
  // Toward whichever extreme (white or black) contrasts more with the background.
  const dir = contrast(bg, "#FFFFFF") >= contrast(bg, "#000000") ? 0.08 : -0.08;
  let c = fg, n = 0;
  while (contrast(c, bg) < min && n++ < 20) c = shade(c, dir);
  return c;
}

/** The colours each mode really uses, from the tokens. Colours the person chose win in the light mode; other modes derive. */
function resolveModes(c) {
  const t = brandTheme([c.brand, c.dark, c.light]);
  const set = { text: !!c.text, page: !!c.page, surface: !!c.surface, field: !!c.field, fieldBorder: !!c.fieldBorder, button: !!c.button };
  const lightPage = c.page || "#FFFFFF";
  const lightSurface = c.surface || lightPage;
  const lightField = c.field || lightSurface;
  const lightText = c.text || t.lightText;
  const pageOf = { light: lightPage, dark: t.darkPage, red: t.deep, bars: t.darkPage };
  const modes = {};
  for (const m of THEME_MODES) {
    const page = pageOf[m];
    const isLight = m === "light";
    const text = isLight ? lightText : textOn(page);
    // Cards sit a touch off the page in the dark modes, unless that would cost the text its 4.5:1 (then they match the page).
    const lift = mix(page, textOn(page), 0.06);
    const surface = isLight ? lightSurface : contrast(text, lift) >= 4.5 ? lift : page;
    const field = isLight ? lightField : surface;
    modes[m] = {
      page, surface, field, text,
      fieldBorder: isLight && c.fieldBorder ? c.fieldBorder : mix(text, field, 0.5),
      link: isLight ? t.accentInk : textOn(page),
      ring: c.button || t.accent,
      muted: mix(text, page, 0.35),
      chosen: isLight ? set : { text: false, page: false, surface: false, field: false, fieldBorder: false, button: set.button },
    };
  }
  return { modes, button: c.button || t.accent };
}

/**
 * Checks a theme's colours the way the server will, for each mode a person can pick (light, dark, red, bars).
 * Returns { ok, tokens, report, blocked, adjusted, modes }:
 *  - report: one row per pair { mode, id, label, fg, bg, ratio, min, status: "pass"|"adjusted"|"blocked", to?, suggestion? };
 *  - tokens: a copy of the input with the button colour (and radius) corrected where that was needed;
 *  - modes: the final colours each mode will use (what the panel writes into CSS variables);
 *  - ok: false when anything is blocked (the save must be refused).
 * What is automatic and what is blocked follows the table in FRONTEND-KIT.md section 9.4:
 *  - button text 4.5:1, links 4.5:1, muted text 4.5:1, focus ring 3:1: made right automatically ("adjusted");
 *  - body text 4.5:1 on page and on cards/forms, and input border 3:1: adjusted when derived, blocked when the person chose the
 *    colour that fails (nothing derived can fix a chosen text colour on a chosen or white page);
 *  - headings 3:1 (large text).
 */
export function checkTheme(input) {
  const tokens = { ...input, colors: { ...(input?.colors || {}) }, fonts: { ...(input?.fonts || {}) } };
  const c = tokens.colors;
  const report = [];
  const blocked = [];
  const adjusted = [];
  const add = (row) => { report.push(row); if (row.status === "blocked") blocked.push(row); else if (row.status === "adjusted") adjusted.push(row); return row; };

  // Format first: nothing unchecked ever reaches CSS.
  c.brand = c.brand || SHEETAL_CRIMSON;
  for (const key of ["brand", "dark", "light", "button", "text", "page", "surface", "field", "fieldBorder"]) {
    if (c[key] == null || c[key] === "") { if (key === "dark" || key === "light") c[key] = key === "dark" ? fillRoles({ brand: c.brand }).dark : "#FFFFFF"; else delete c[key]; continue; }
    if (!isHex(c[key])) add({ mode: "all", id: `format.${key}`, label: `Colour "${key}" must look like #1A2B3C`, fg: String(c[key]), bg: "", ratio: 0, min: 0, status: "blocked" });
  }
  for (const key of ["heading", "body", "nepali"]) {
    const f = tokens.fonts[key];
    if (f != null && !FONT_ID.test(f)) add({ mode: "all", id: `format.font.${key}`, label: `Font "${key}" must be a library font id`, fg: String(f), bg: "", ratio: 0, min: 0, status: "blocked" });
  }
  const r = Number(tokens.radius);
  if (tokens.radius != null) {
    const clamped = Number.isFinite(r) ? Math.min(20, Math.max(0, Math.round(r))) : 8;
    if (clamped !== tokens.radius) add({ mode: "all", id: "format.radius", label: "Corner radius is kept between 0 and 20", fg: String(tokens.radius), bg: "", ratio: 0, min: 0, status: "adjusted", to: String(clamped) });
    tokens.radius = clamped;
  }
  if (blocked.length) return { ok: false, tokens, report, blocked, adjusted, modes: null };

  const { modes, button } = resolveModes(c);

  // Button text on the button colour: 4.5:1. The text is chosen (textOn); if neither white nor near-black reaches it, the button is darkened.
  const btnText = textOn(button);
  const b0 = checkPair(btnText, button, 4.5);
  if (b0.pass) add({ mode: "all", id: "button.text", label: "Button text on button colour", fg: btnText, bg: button, ratio: b0.ratio, min: 4.5, status: "pass" });
  else {
    const fixed = darkEnough(button, 4.5);
    const b1 = checkPair("#FFFFFF", fixed, 4.5);
    c.button = fixed;
    add({ mode: "all", id: "button.text", label: "Button text on button colour", fg: "#FFFFFF", bg: fixed, ratio: b1.ratio, min: 4.5, status: "adjusted", to: fixed });
  }

  for (const m of THEME_MODES) {
    const x = modes[m];
    const row = (id, label, fg, bg, min, status, extra = {}) => add({ mode: m, id, label, fg, bg, ratio: checkPair(fg, bg, min).ratio, min, status, ...extra });

    // Body text on the page and on cards/forms: blocked when the person chose the text; otherwise corrected.
    for (const [id, label, bg] of [["text.page", "Body text on the page", x.page], ["text.surface", "Body text on cards and forms", x.surface]]) {
      if (checkPair(x.text, bg, 4.5).pass) { row(id, label, x.text, bg, 4.5, "pass"); continue; }
      const better = nudge(x.text, bg, 4.5);
      if (x.chosen.text) row(id, label, x.text, bg, 4.5, "blocked", { suggestion: better });
      else { x.text = better; row(id, label, better, bg, 4.5, "adjusted", { to: better }); }
    }
    // Muted text (hints) on the page: derived, nudged if needed.
    { const ok = checkPair(x.muted, x.page, 4.5).pass; const to = ok ? x.muted : nudge(x.muted, x.page, 4.5); x.muted = to; row("muted.page", "Hint text on the page", to, x.page, 4.5, ok ? "pass" : "adjusted", ok ? {} : { to }); }
    // Links and selected-tab text on the page.
    { const ok = checkPair(x.link, x.page, 4.5).pass; const to = ok ? x.link : nudge(x.link, x.page, 4.5); x.link = to; row("link.page", "Links on the page", to, x.page, 4.5, ok ? "pass" : "adjusted", ok ? {} : { to }); }
    // Input border on the input background: 3:1.
    { const ok = checkPair(x.fieldBorder, x.field, 3).pass;
      if (ok) row("border.field", "Input border on input background", x.fieldBorder, x.field, 3, "pass");
      else { const better = nudge(x.fieldBorder, x.field, 3); if (x.chosen.fieldBorder) row("border.field", "Input border on input background", x.fieldBorder, x.field, 3, "blocked", { suggestion: better }); else { x.fieldBorder = better; row("border.field", "Input border on input background", better, x.field, 3, "adjusted", { to: better }); } } }
    // Focus ring on the page: 3:1, automatic.
    { const ok = checkPair(x.ring, x.page, 3).pass; const to = ok ? x.ring : nudge(x.ring, x.page, 3); x.ring = to; row("ring.page", "Focus ring on the page", to, x.page, 3, ok ? "pass" : "adjusted", ok ? {} : { to }); }
    // Headings are large text: 3:1.
    row("heading.page", "Headings on the page", x.text, x.page, 3, checkPair(x.text, x.page, 3).pass ? "pass" : "blocked");
  }
  // x.chosen is bookkeeping for the checks above, not something to hand back.
  for (const m of THEME_MODES) delete modes[m].chosen;
  return { ok: blocked.length === 0, tokens, report, blocked, adjusted, modes };
}
