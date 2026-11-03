// Brand colours from a logo, and keeping text readable on them.
// extractPalette reads the picture in the browser (a small canvas), groups similar colours, leaves out the
// background (transparent or near-white pixels) and returns up to 4 distinct main colours, most used first.

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

/** Up to `max` main colours of an <img> (already loaded). */
export function extractPalette(img, max = 4) {
  const size = 72;
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
    if (a < 128) continue; // transparent background
    if (r > 238 && g > 238 && b > 238) continue; // white background
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const x = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    x.n++; x.r += r; x.g += g; x.b += b;
    buckets.set(key, x);
  }
  // Colourful pixels count a little more than greys, so a red mark beats a grey outline of the same size.
  const total = [...buckets.values()].reduce((t, x) => t + x.n, 0) || 1;
  const groups = [...buckets.values()]
    .map((x) => { const c = [x.r / x.n, x.g / x.n, x.b / x.n]; return { c, n: x.n, w: x.n * (0.6 + sat(c)) }; })
    // Leave out specks (anti-aliased edges, tiny details) and pale tints that are really background.
    .filter((g) => g.n / total >= 0.02 && luminance(hex(...g.c)) < 0.85)
    .sort((p, q) => q.w - p.w);
  const picked = [];
  for (const g of groups) {
    if (picked.length >= max) break;
    if (picked.every((p) => dist(p.c, g.c) > 60)) picked.push(g);
    else { const near = picked.find((p) => dist(p.c, g.c) <= 60); near.w += g.w; }
  }
  return picked.sort((p, q) => q.w - p.w).map((p) => hex(...p.c));
}

/**
 * The workspace theme from a business's colours. It works out which colour is the brand colour (the most
 * colourful one), which is light and which is dark, and makes the three themes from them:
 *  - light: light bars with a light tint of the brand colour; buttons in the brand colour;
 *  - dark: dark bars (the business's darkest colour, or a very dark shade of the brand colour);
 *  - the third theme: the page in the brand colour (as it is red for Sheetal), with dark bars.
 * Every colour is adjusted so text on it stays readable.
 */
export function brandTheme(colors) {
  if (!colors?.length) return null;
  const t = makeTheme(colors);
  // Dark theme page from the logo's own colours only: its dark colour with a touch of the brand colour (no grey).
  t.darkPage = mix(t.darkBar, t.brand, 0.1);
  // Replaces Sheetal's silver (cards, lines, muted text) in the dark themes: a pale tint of the brand colour.
  t.mist = mix("#FFFFFF", t.brand, 0.22);
  return t;
}

function makeTheme(colors) {
  // The brand colour: the most colourful, ignoring near-white and near-black.
  const usable = colors.filter((c) => luminance(c) > 0.02 && luminance(c) < 0.85);
  const brand = (usable.length ? usable : colors).reduce((best, c) => (sat(toRgb(c)) > sat(toRgb(best)) ? c : best));
  const darkest = colors.reduce((a, c) => (luminance(c) < luminance(a) ? c : a));
  const lightest = colors.reduce((a, c) => (luminance(c) > luminance(a) ? c : a));
  const accent = darkEnough(brand, 3);
  return {
    brand,
    accent, accentText: textOn(accent),
    // Text in the brand colour on white (links, the selected tab).
    accentInk: darkEnough(brand, 4.5),
    accentSoft: shade(brand, 0.88),
    // Light theme bars: the business's own light colour if it has one, else a light tint of the brand colour.
    lightBar: luminance(lightest) > 0.85 && lightest !== brand ? lightest : shade(brand, 0.93),
    // Dark theme bars: its own dark colour if dark enough, else a very dark shade of the brand colour.
    darkBar: luminance(darkest) < 0.04 ? darkest : darkEnough(shade(brand, -0.72), 12),
    // The third theme: the brand colour as the page (deep) and highlights (base), like Sheetal's crimson and red.
    deep: darkEnough(brand, 7), base: darkEnough(brand, 3.2),
    colors,
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
