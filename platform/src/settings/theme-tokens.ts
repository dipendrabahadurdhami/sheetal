// Theme tokens: the small document that describes a look (FRONTEND-KIT.md section 9.2), and the check that it stays readable.
// Where it fits: defs.ts stores "platform.theme" (Sheetal's own look) and "business.theme" (a paying business's); the admin Theme screen edits it;
// the panels apply it as CSS variables (packages/ui/src/theme/tokens.js).
// Rules: every colour is #RRGGBB. Text must stay readable: body text on the page and on cards needs a contrast of 4.5 or more, or the save is refused
// with a plain sentence. Missing optional colours are derived by the panels from the three main ones, as today.

import { z } from "zod";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #9D1D21.");
const ref = z.string().max(300).nullable().default(null);

export const ThemeTokens = z.object({
  v: z.literal(1).default(1),
  colors: z.object({
    brand: hex, dark: hex, light: hex,
    button: hex.optional(), text: hex.optional(), page: hex.optional(), surface: hex.optional(), field: hex.optional(), fieldBorder: hex.optional(),
  }).strict(),
  fonts: z.object({ heading: ref, body: ref, nepali: ref }).strict().default({ heading: null, body: null, nepali: null }),
  radius: z.number().int().min(0).max(20).default(8),
  logo: z.object({ light: ref, dark: ref, favicon: ref }).strict().default({ light: null, dark: null, favicon: null }),
}).strict();
export type ThemeTokens = z.infer<typeof ThemeTokens>;

/** Sheetal's own crimson look: what every screen shows today. */
export const THEME_DEFAULT: ThemeTokens = {
  v: 1, colors: { brand: "#9D1D21", dark: "#1F1410", light: "#FBF7F4" },
  fonts: { heading: null, body: null, nepali: null }, radius: 8, logo: { light: null, dark: null, favicon: null },
};

const channel = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
export const luminance = (h: string) => 0.2126 * channel(parseInt(h.slice(1, 3), 16)) + 0.7152 * channel(parseInt(h.slice(3, 5), 16)) + 0.0722 * channel(parseInt(h.slice(5, 7), 16));
/** WCAG contrast ratio of two colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
/** White or near-black, whichever reads better on this colour (for button text). */
export const textOn = (bg: string): string => (contrast(bg, "#FFFFFF") >= contrast(bg, "#111111") ? "#FFFFFF" : "#111111");

/** The readability problems of a theme, as plain sentences. Empty = fine. */
export function themeProblems(t: ThemeTokens): string[] {
  const out: string[] = [];
  const c = t.colors;
  const text = c.text ?? c.dark;
  const page = c.page ?? c.light;
  if (contrast(text, page) < 4.5) out.push("The text colour is too close to the page colour to read. Pick a darker text or a lighter page.");
  if (c.surface && contrast(text, c.surface) < 4.5) out.push("The text colour is too close to the card colour to read.");
  if (c.field && contrast(text, c.field) < 4.5) out.push("The text colour is too close to the input colour to read.");
  const button = c.button ?? c.brand;
  if (contrast(button, textOn(button)) < 4.5) out.push("The button colour does not let its text be read. Pick a darker or a lighter button colour.");
  if (contrast(c.brand, page) < 3) out.push("The brand colour is too close to the page colour: links and selected items would not be seen.");
  return out;
}
