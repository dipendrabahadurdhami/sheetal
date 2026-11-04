// Colour contrast helpers (WCAG) for colours businesses pick themselves.
// Where it fits: buttons and links in a business's own colour.
// How it works: picks text that stays readable on the colour, darkening the colour when needed.

const HEX = /^#[0-9a-f]{6}$/i;
export function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export const contrastWithWhite = (hex) => (HEX.test(hex) ? 1.05 / (luminance(hex) + 0.05) : 21);
// Text colour on white: the brand colour if it is readable, otherwise a darker mix of it.
export const inkFor = (hex) => { const r = contrastWithWhite(hex); return r >= 4.5 ? hex : "color-mix(in srgb, " + hex + " " + (r >= 3 ? 70 : 45) + "%, black)"; };
// Text colour on a brand-coloured button.
export const btnInkFor = (hex) => (contrastWithWhite(hex) >= 4.5 ? "#FFFFFF" : "#1F1F21");
