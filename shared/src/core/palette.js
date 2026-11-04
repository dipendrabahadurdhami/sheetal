// Brand colours from a business's logo, and keeping text readable on them.
// Where it fits: Settings → Branding (reading the logo) and the panel's brand themes.
// How it works: the logo is read in the browser, its colours are grouped, and three roles are chosen: brand (most
// colourful), dark and light. brandTheme() builds every theme from only those three colours.
// Rules: no colour outside the logo's own (only lighter or darker shades for readable text).

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

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const sat = ([r, g, b]) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx === 0 ? 0 : (mx - mn) / mx; };

/**
 * The main colours of an <img> (already loaded), most used first, up to `max`. `keepLight`: count white and pale
 * colours too (use it on a logo whose background was already removed by cleanLogo, so white is the logo's own).
 */
export function extractPalette(img, max = 6, { keepLight = false } = {}) {
  const size = 96;
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, size / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
  canvas.width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
  canvas.height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false; // no blended edge colours when shrinking
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

  // Group into buckets of similar colour (5 bits a channel), summing the real values for an average.
  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    if (a < 200) continue; // transparent, or a soft edge
    if (!keepLight && r > 238 && g > 238 && b > 238) continue; // white background
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const x = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    x.n++; x.r += r; x.g += g; x.b += b;
    buckets.set(key, x);
  }
  const total = [...buckets.values()].reduce((t, x) => t + x.n, 0) || 1;
  const groups = [...buckets.values()]
    .map((x) => ({ c: [x.r / x.n, x.g / x.n, x.b / x.n], n: x.n }))
    // Leave out specks (anti-aliased edges, tiny details).
    .filter((g) => g.n / total >= 0.015 && (keepLight || luminance(hex(...g.c)) < 0.85))
    .sort((p, q) => q.n - p.n);
  // Merge near-identical colours into the bigger one.
  const picked = [];
  for (const g of groups) {
    const near = picked.find((p) => dist(p.c, g.c) <= 48);
    if (near) near.n += g.n; else picked.push({ ...g });
  }
  return picked.sort((p, q) => q.n - p.n).slice(0, max).map((p) => hex(...p.c));
}

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

/**
 * A clean logo from any upload: the plain background around it (white, or any one colour that fills the corners)
 * becomes transparent, the empty margin is trimmed, and the result is a PNG (as a Blob). Logos that already have
 * a transparent background are only trimmed. Inner areas of the background colour that don't touch the edge stay.
 */
export async function cleanLogo(img, maxSize = 512) {
  const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
  const scale = Math.min(1, maxSize / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale)), h = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const im = ctx.getImageData(0, 0, w, h);
  const d = im.data;
  const at = (x, y) => (y * w + x) * 4;

  // The background: the colour most corners share (if at least three agree and they're opaque).
  const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]].map(([x, y]) => { const i = at(x, y); return [d[i], d[i + 1], d[i + 2], d[i + 3]]; });
  const near = (a, b, tol) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= tol;
  const bg = corners.find((c) => c[3] > 200 && corners.filter((o) => o[3] > 200 && near(o, c, 30)).length >= 3);

  if (bg) {
    // Flood from every edge pixel through pixels close to the background colour, making them transparent.
    const tol = 48, seen = new Uint8Array(w * h), stack = [];
    for (let x = 0; x < w; x++) stack.push(x, 0, x, h - 1);
    for (let y = 0; y < h; y++) stack.push(0, y, w - 1, y);
    while (stack.length) {
      const y = stack.pop(), x = stack.pop();
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const k = y * w + x;
      if (seen[k]) continue;
      seen[k] = 1;
      const i = k * 4;
      const dist = Math.hypot(d[i] - bg[0], d[i + 1] - bg[1], d[i + 2] - bg[2]);
      if (d[i + 3] < 10 || dist > tol) continue;
      // Soft edge: pixels part-way to the logo keep some opacity.
      d[i + 3] = dist < tol * 0.6 ? 0 : Math.round(d[i + 3] * ((dist - tol * 0.6) / (tol * 0.4)));
      stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
    }
    ctx.putImageData(im, 0, 0);
  }

  // Trim the transparent margin (keeping a small border).
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[at(x, y) + 3] > 16) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return { blob: await new Promise((r) => canvas.toBlob(r, "image/png")), removed: !!bg }; // nothing left: keep as is
  const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.04);
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  const out = document.createElement("canvas");
  out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
  out.getContext("2d").drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return { blob: await new Promise((r) => out.toBlob(r, "image/png")), removed: !!bg };
}
