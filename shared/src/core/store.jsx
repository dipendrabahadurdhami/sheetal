import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { seed, VERSION } from "../demo/demo";
import { config } from "./config";

// Demo store: the whole platform database lives in one object, persisted to localStorage.
// Every page reads `db` and writes through `update(draft => { ... })`.
// When the API is ready, replace update() calls with API requests one module at a time.
const Ctx = createContext(null);

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(config.storageKey));
    if (s && s.version === VERSION) return s;
  } catch (e) { /* ignore */ }
  return seed();
}

export function StoreProvider({ children }) {
  const [db, setDb] = useState(load);
  useEffect(() => { try { localStorage.setItem(config.storageKey, JSON.stringify(db)); } catch (e) { /* ignore */ } }, [db]);
  const update = useCallback((fn) => setDb((d) => { const n = structuredClone(d); fn(n); return n; }), []);
  const reset = useCallback(() => setDb(seed()), []);
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
