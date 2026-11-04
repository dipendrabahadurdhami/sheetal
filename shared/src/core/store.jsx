// The front-end store: one object with everything a screen shows, kept in the browser (localStorage).
// Where it fits: every screen reads `db` and writes with update(draft => { ... }).
// How it works: in the sample workspace this is all the data; when signed in, the live loaders (live.js in each panel)
// fill it from the APIs, and pages that are on the server send their changes there.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { seed, VERSION } from "../demo/demo";
import { config } from "./config";
import { storedTheme } from "./theme";

const Ctx = createContext(null);

function load() {
  let s = null;
  try {
    s = JSON.parse(localStorage.getItem(config.storageKey));
  } catch (e) { /* ignore */ }
  if (!s || s.version !== VERSION) s = seed();
  // The store is shared by the website, /business and /admin, but the theme is not:
  // each app starts with its own saved choice.
  s.session.theme = storedTheme();
  return s;
}

export function StoreProvider({ children }) {
  const [db, setDb] = useState(load);
  useEffect(() => { try { localStorage.setItem(config.storageKey, JSON.stringify(db)); } catch (e) { /* ignore */ } }, [db]);
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
