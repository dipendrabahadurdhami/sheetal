// The front-end store: one object with everything a screen shows, kept in the browser (localStorage).
// Where it fits: every screen reads `db` and writes with update(draft => { ... }).
// How it works: the live loaders (live.js in each panel) fill it from the APIs, and pages that are on the server send their changes there.
// A panel may pass `storageKey` and `keep` (top-level keys) so that only those are saved in the browser: the business panel keeps only its UI
// state (session, drafts) and never business data (FRONTEND-KIT.md section 8.2, rule 4; P2-W6). Without them the whole object is saved, as before.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { seed, VERSION } from "../demo/demo";
import { config } from "./config";
import { storedTheme } from "./theme";

const Ctx = createContext(null);

function load(storageKey = config.storageKey, keep = null) {
  let s = null;
  try {
    s = JSON.parse(localStorage.getItem(storageKey));
  } catch (e) { /* ignore */ }
  if (!s || s.version !== VERSION) s = seed();
  else if (keep) { const fresh = seed(); for (const k of keep) if (s[k] !== undefined) fresh[k] = s[k]; s = fresh; }
  // The store is shared by the website, /business and /admin, but the theme is not:
  // each app starts with its own saved choice.
  s.session.theme = storedTheme();
  return s;
}

/** keep: the top-level keys saved in the browser (null = everything); storageKey: where (default: the shared key). */
export function StoreProvider({ children, storageKey = config.storageKey, keep = null }) {
  const [db, setDb] = useState(() => load(storageKey, keep));
  const keepKey = keep ? keep.join(",") : "";
  useEffect(() => {
    const saved = keep ? Object.fromEntries([["version", db.version], ...keep.map((k) => [k, db[k]])]) : db;
    try { localStorage.setItem(storageKey, JSON.stringify(saved)); } catch (e) { /* ignore */ }
  }, [db, storageKey, keepKey]);
  const update = useCallback((fn) => setDb((d) => { const n = structuredClone(d); fn(n); return n; }), []);
  const reset = useCallback(() => setDb(() => { const n = seed(); n.session.theme = storedTheme(); return n; }), []);
  const value = useMemo(() => ({ db, update, reset }), [db, update, reset]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useStore = () => useContext(Ctx);
export const uid = (p = "id") => `${p}-${Math.random().toString(36).slice(2, 8)}`;

// For pages outside the platform (e.g. your Pay rent page): add a payment so it shows in My payments.
export function recordPayment(order) {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(config.storageKey)); } catch (e) { /* ignore */ }
  if (!s || s.version !== VERSION) s = seed();
  s.customer = s.customer || { orders: [] };
  s.customer.orders.unshift({ at: new Date().toISOString().slice(0, 10), ...order });
  try { localStorage.setItem(config.storageKey, JSON.stringify(s)); } catch (e) { /* ignore */ }
}
