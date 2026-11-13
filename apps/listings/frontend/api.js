// The Listings app's calls to the business API, for its screens: one page of listings, the listing actions, and photo upload.
// Where it fits: moved here from business/frontend/src/live.js in P2-W6 (useListingPage, liveListings, uploadListingPhoto); the backend is
// apps/listings/backend. The panel passes `onChanged` so its own copy (menu counts, search) reloads after a change too.
// How it works: every action shows the server's message and tells the open listing pages to reload (listeners below).
// Rules: nothing is kept in the browser; ids are listing codes (e.g. SP-0006).

import { useEffect, useState } from "react";
import { bizApi, fileToBase64, setActiveTenant } from "@sheetal/sdk/client";

const listeners = new Set();
/** Tells every open listing page to load again. */
export const listingsChanged = () => listeners.forEach((fn) => fn());

/** One page of the open business's listings from the API, with counts per status; reloads after every change. */
export function useListingPage(tenantId, { q, kind, status, per }) {
  const [state, setState] = useState({ rows: null, meta: null, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => { const fn = () => setTick((n) => n + 1); listeners.add(fn); return () => { listeners.delete(fn); }; }, []);
  useEffect(() => {
    if (!tenantId) return undefined;
    let gone = false;
    const params = new URLSearchParams({ page: "1", per: String(per), status });
    if (kind !== "all") params.set("kind", kind);
    if (q.trim()) params.set("q", q.trim());
    // Typing in the search waits a moment before asking the server.
    const wait = setTimeout(() => {
      setActiveTenant(tenantId);
      bizApi("GET", `/listings?${params}`)
        .then((r) => !gone && setState({ rows: r.data, meta: r.meta, error: null }))
        .catch((e) => !gone && setState((x) => ({ ...x, rows: x.rows || [], error: e.message })));
    }, q.trim() ? 300 : 0);
    return () => { gone = true; clearTimeout(wait); };
  }, [tenantId, q, kind, status, per, tick]);
  return state;
}

/** Listing actions (ids are listing codes). `onChanged` is the panel's reload; every action shows the server's message and reloads. */
export const listingActions = (toast, onChanged) => {
  const done = () => { listingsChanged(); onChanged?.(); };
  const run = (p) => p.then((r) => { if (r?.message) toast(r.message); done(); return r; }).catch((e) => { toast(e.message); done(); throw e; });
  return {
    setStatus: (ids, status) => run(bizApi("POST", "/listings/status", { ids, status })).catch(() => {}),
    remove: (ids) => run(bizApi("POST", "/listings/delete", { ids })).catch(() => {}),
    duplicate: (id) => run(bizApi("POST", `/listings/${id}/duplicate`)).catch(() => {}),
    open: (id) => bizApi("GET", `/listings/${id}`).then((r) => r.data),
    moveTargets: (id) => bizApi("GET", `/listings/${id}/move-targets`).then((r) => r.data),
    move: (id, tenantId) => run(bizApi("POST", `/listings/${id}/move`, { tenantId })),
    /** Creates or updates from the wizard. Throws with field errors, so the wizard can show them. */
    save: (editId, body) => run(editId ? bizApi("PATCH", `/listings/${editId}`, body) : bizApi("POST", "/listings", body)),
  };
};

/** Uploads one photo for a listing; returns { file, url }. */
export const uploadListingPhoto = async (file) => (await bizApi("POST", "/listing-photos", { data: await fileToBase64(file) })).data;
