// Property types the website's filters offer (home, search, listings): the built-in listing options
// (shared/src/data/catalog.js), what Sheetal staff changed in Admin → Listing setup (website API GET /catalog), and the
// types listings were actually saved with (GET /property-attributes), so every filter matches real listings,
// imported ones included.
// How it works: PROPERTY_TYPE_NAMES is filled at once from the built-in list, then updated in place (the same
// array) when the server answers, so lists built from it see the update on their next render.

import { CATALOG, mergeCatalog } from "@sheetal/shared/data/catalog";

const API = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
// Names imported listings from the old site use.
const OLD_NAMES = ["Flat", "Commercial Space", "Office Space"];
const listeners = new Set();
let catalog = CATALOG;

/** Category and property type names, most used first, without repeats. */
export const PROPERTY_TYPE_NAMES = [];
/** The listing options as staff set them (labels for districts, facilities…). */
export const listingCatalog = () => catalog;
/** Runs `fn` whenever the options arrive from the server; returns a function that stops it. */
export const onListingOptions = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

function fill(extra = []) {
  const seen = new Set();
  const out = [];
  const names = [...catalog.categories.map((c) => c.en), ...Object.values(catalog.propertyTypes || {}).flat().map((x) => x.en), ...OLD_NAMES, ...extra];
  for (const n of names) {
    const k = String(n || "").trim().toLowerCase();
    if (k && !seen.has(k)) { seen.add(k); out.push(String(n).trim()); }
  }
  PROPERTY_TYPE_NAMES.splice(0, PROPERTY_TYPE_NAMES.length, ...out);
  listeners.forEach((fn) => fn());
}
fill();

if (API && typeof fetch === "function") {
  const get = (path) => fetch(`${API}/${path}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  Promise.all([get("catalog"), get("property-attributes")]).then(([c, a]) => {
    if (c?.data) catalog = mergeCatalog(CATALOG, c.data);
    fill([...(a?.data?.property_types || []), ...(a?.data?.categories || [])].map((x) => x?.name));
  });
}
