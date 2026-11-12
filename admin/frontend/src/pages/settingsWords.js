// Small rules for the stage 1.4 settings screens (field builder, theme, revenue): pure, so they are tested without a browser.
// Where it fits: SettingsStore.jsx. The server is the judge of every save (platform/src/settings); these only shape what the screen shows and sends.

export const FIELD_TYPES = [
  ["text", "Short text"], ["textarea", "Long text"], ["number", "Number"], ["money", "Money"], ["date", "Date"], ["select", "One choice"], ["multiselect", "Several choices"],
  ["checkbox", "Tick box"], ["phone", "Phone"], ["email", "Email"], ["url", "Web address"], ["pan", "Tax number"], ["address", "Address"], ["file", "Document"], ["image", "Picture"],
].map(([id, label]) => ({ id, label }));
export const FILLED_BY = [["business_owner", "The business owner"], ["business_staff", "The business's staff"], ["platform_staff", "Sheetal staff"], ["system", "The system"], ["anyone_with_link", "Anyone with the link"]].map(([id, label]) => ({ id, label }));

/** A key made from a label: "Opening hours" -> "opening_hours". Empty when nothing usable is left. */
export function keyFromLabel(label) {
  const k = String(label || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^([0-9])/, "f_$1").slice(0, 40);
  return k.length >= 2 ? k : "";
}

/** A new field with safe defaults, placed last. Returns null when the key is empty or already used. */
export function newField(fields, label, type = "text") {
  const key = keyFromLabel(label);
  if (!key || fields.some((f) => f.key === key)) return null;
  const order = fields.reduce((m, f) => Math.max(m, f.order), 0) + 10;
  const base = { key, type, label: { en: String(label).trim() }, required: false, filledBy: "business_owner", visibility: "private", editableAfter: "always", order };
  if (type === "select" || type === "multiselect") base.options = [{ value: "option_1", label: { en: "Option 1" } }];
  if (type === "file") base.file = { types: ["pdf", "jpg", "png"], maxMB: 5 };
  if (type === "image") base.file = { types: ["jpg", "png"], maxMB: 5 };
  return base;
}

/** Moves a field one place up (-1) or down (+1) among the fields, and renumbers `order` in tens. */
export function moveField(fields, key, dir) {
  const list = [...fields].sort((a, b) => a.order - b.order);
  const i = list.findIndex((f) => f.key === key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return list;
  [list[i], list[j]] = [list[j], list[i]];
  return list.map((f, n) => ({ ...f, order: (n + 1) * 10 }));
}

export const patchField = (fields, key, patch) => fields.map((f) => (f.key === key ? { ...f, ...patch } : f));
/** Archive or bring back a field (a field is never deleted: old answers are kept). */
export const setArchived = (fields, key, on, now = new Date()) => fields.map((f) => {
  if (f.key !== key) return f;
  const { archivedAt: _was, ...rest } = f;
  return on ? { ...rest, archivedAt: now.toISOString() } : rest;
});

/** Paisa -> "Rs. 1,25,000.50" (Nepali grouping). */
export function rupees(paisa) {
  const n = Number(paisa || 0) / 100;
  return `${n < 0 ? "-" : ""}Rs. ${Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}
export const changeWords = (pct) => (pct === null || pct === undefined ? "no earlier figure" : `${pct > 0 ? "+" : ""}${pct}% against the period before`);

/** The CSS variables a theme preview box needs, from the tokens (missing optional colours fall back to the three main ones). */
export function previewVars(tokens) {
  const c = tokens.colors;
  return { "--pv-brand": c.brand, "--pv-button": c.button || c.brand, "--pv-text": c.text || c.dark, "--pv-page": c.page || c.light, "--pv-surface": c.surface || "#FFFFFF", "--pv-radius": `${tokens.radius}px` };
}
export const isHex = (v) => /^#[0-9a-fA-F]{6}$/.test(String(v || ""));
