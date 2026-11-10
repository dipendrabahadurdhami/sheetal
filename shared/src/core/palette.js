// Brand colours from a business's logo: reading the picture (needs a canvas) and cleaning it up.
// Where it fits: Settings → Branding (reading the logo) and the panel's brand themes.
// How it works: the colour maths (contrast, shades, the three roles, brandTheme) moved to packages/config/src/color.js
// (task P1-FE-1) and is re-exported here, so every old import keeps working. Only the two parts that draw on a canvas stay.
// Rules: no colour outside the logo's own (only lighter or darker shades for readable text). New code imports "@sheetal/config/color".

import { luminance, toHex as hex } from "@sheetal/config/color";

export {
  toRgb, luminance, contrast, textOn, mix, shade, darkEnough, rolesFrom, fillRoles, savedRoles, brandTheme,
} from "@sheetal/config/color";

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

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
