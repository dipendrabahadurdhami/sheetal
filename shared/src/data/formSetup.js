// The listing forms as Sheetal staff arrange them in Admin → Listing setup → Listing forms: step names and order,
// field labels and help in English and Nepali, required or optional, which categories see a field, hidden fields and
// fields staff added. Built on the built-in forms in listingForms.js, which work with no setup at all.
// Where it fits: the business listing wizard (formFor) and the admin form editor (formLayout).
// How it works: staff changes are stored per listing kind in the "catalog" setting as
//   { steps: { [stepId]: { order, label, hidden } }, fields: { [name]: { order, step, label, help, req, hidden, cats } },
//     custom: [{ name: "x_…", type, label, help, step, order, req, cats, listKey | options, unit }] }
// Rules: LOCKED fields (what every listing needs) can be renamed and explained but never hidden or made optional.

import { FORMS } from "./listingForms";

export const LOCKED = new Set(["category", "propertyType", "location", "photos", "title", "price", "rent", "nightly", "target", "stayType", "name", "rooms", "units", "projectType", "investType", "returnType", "amenities", "cancellation"]);
export const CUSTOM_TYPES = [["text", "Short text"], ["number", "Number"], ["choice", "Pick one"], ["multi", "Pick several"], ["toggle", "Yes or no"], ["counter", "Count"]];

const optionsOf = (c) => (c.listKey
  ? (v, C) => C[c.listKey] || []
  : () => (c.options || []).map((o, i) => ({ id: o.id || `o${i}`, en: o.en, ne: o.ne || o.en, icon: "circle-check" })));
const pair = (x, fallback) => (Array.isArray(x) && x[0] ? [x[0], x[1] || x[0]] : fallback);

/** Every step and field of a kind's form with staff changes applied; hidden ones kept and marked (for the editor). */
export function formLayout(kind, setup = {}) {
  const base = FORMS[kind];
  if (!base) return [];
  const so = setup.steps || {}, fo = setup.fields || {};
  const fields = [];
  base.forEach((st) => st.fields.forEach((f, i) => fields.push({ ...f, step: st.id, order: i })));
  for (const c of setup.custom || []) {
    fields.push({ ...c, custom: true, label: pair(c.label, [c.name, c.name]), note: pair(c.help), optional: !c.req,
      src: c.type === "choice" || c.type === "multi" ? optionsOf(c) : undefined, ...(c.type === "counter" ? { min: 0, max: 50 } : {}) });
  }
  const done = fields.map((f) => {
    const o = fo[f.name] || {};
    const g = { ...f, step: o.step || f.step, order: o.order ?? f.order, locked: LOCKED.has(f.name) };
    if (o.label) g.label = pair(o.label, f.label);
    if (o.help) g.note = pair(o.help, f.note);
    if (!g.locked && o.req !== undefined) { g.req = o.req; g.optional = !o.req; }
    if (!g.locked && o.hidden) g.hidden = true;
    const cats = f.custom ? f.cats : o.cats;
    if (Array.isArray(cats) && cats.length) { g.cats = cats; g.when = (v) => !v.category || cats.includes(v.category); }
    return g;
  });
  return base
    .map((st, i) => ({ ...st, order: so[st.id]?.order ?? i, label: pair(so[st.id]?.label, st.label), hidden: !!so[st.id]?.hidden }))
    .sort((a, b) => a.order - b.order)
    .map((st) => ({ ...st, fields: done.filter((f) => f.step === st.id).sort((a, b) => a.order - b.order) }));
}

/** The form the wizard shows for a kind: hidden steps and fields left out (a step with a locked field always shows). */
export function formFor(kind, C) {
  return formLayout(kind, C?.forms?.[kind])
    .map((st) => ({ ...st, fields: st.fields.filter((f) => !f.hidden) }))
    .filter((st) => st.fields.length && (!st.hidden || st.fields.some((f) => f.locked)));
}
