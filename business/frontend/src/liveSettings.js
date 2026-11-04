// Business settings, listing check-ups, listing options and import/export on the server, for signed-in businesses.
// Where it fits: useLiveSettings() runs once in BusinessApp, next to useLiveWorkspace(); BusinessSettings and
// ListingCheckups save through saveSettings() in live.js.
// How it works: loads the open business's saved settings into db.tenantSettings (over the defaults), the check-up
// settings and history into db.checkups, and the options staff set in Admin → Listing setup into db.catalog. It also
// connects the shared check-up card and Import / Export buttons to the business API, for businesses on the server.
// Rules: sample workspaces (not on the server) keep working in the browser as before.

import { useEffect } from "react";
import { useStore } from "@sheetal/shared/core/store";
import { CATALOG, mergeCatalog } from "@sheetal/shared/data/catalog";
import { registerCheckupSync } from "@sheetal/shared/components/CheckupCard";
import { registerDataServer } from "@sheetal/shared/components/DataIO";
import { bizApi, setActiveTenant } from "./api";
import { isLive, workRefresh } from "./live";
import { defaultTenantSettings, mergeSettings } from "./pages/BusinessSettings";

let settingsReload = null;
/** Loads the open business's settings and check-up history again (after a check-up or a save). */
export const settingsRefresh = () => settingsReload?.();

export function useLiveSettings() {
  const { db, update } = useStore();
  const current = db.session.tenantId;
  const live = isLive(current);

  useEffect(() => {
    if (!live) return undefined;
    let gone = false;
    const load = () => {
      setActiveTenant(current);
      bizApi("GET", "/workspace/settings").then(({ data }) => !gone && update((d) => {
        const { checkups, ...sections } = data || {};
        const tenant = d.tenants.find((x) => x.id === current);
        if (tenant) d.tenantSettings[current] = mergeSettings(mergeSettings(defaultTenantSettings(tenant), d.tenantSettings[current]), sections);
        d.checkups = d.checkups || {};
        d.checkups[current] = { ...(d.checkups[current] || { log: [] }), settings: checkups || {} };
      })).catch(() => {});
      bizApi("GET", "/checkups/log").then(({ data }) => !gone && update((d) => {
        d.checkups = d.checkups || {};
        d.checkups[current] = { ...(d.checkups[current] || {}), log: data };
      })).catch(() => {});
    };
    settingsReload = load;
    load();
    return () => { gone = true; if (settingsReload === load) settingsReload = null; };
  }, [current, live]);

  useEffect(() => {
    if (!live) return;
    bizApi("GET", "/catalog").then(({ data }) => update((d) => { d.catalog = structuredClone(mergeCatalog(CATALOG, data)); })).catch(() => {});
  }, [live]);
}

// Check-ups done on the shared card are saved on the server too (the card updates the screen straight away).
registerCheckupSync((tid, listing, action, opts) => {
  if (!isLive(tid)) return;
  setActiveTenant(tid);
  bizApi("POST", `/listings/${encodeURIComponent(listing.id)}/checkup`, { action, ...(opts?.months ? { months: opts.months } : {}) })
    .then(() => { workRefresh(); settingsRefresh(); })
    .catch(() => { workRefresh(); settingsRefresh(); });
});

// Import / Export buttons: these kinds come from and go to the business API.
const EXPORTS = ["listings", "leads", "rooms", "units", "bookings", "team", "staff", "invoices"];
const IMPORTS = ["listings", "leads", "invoices"];
// Customer invoices have their own routes (business/backend/src/modules/invoicing); the rest are under /data.
const exportPath = (kind) => (kind === "invoices" ? "/invoices/rows" : `/data/${kind}`);
const importPath = (kind) => (kind === "invoices" ? "/invoices/import" : `/data/${kind}`);
registerDataServer({
  canExport: (kind, tid) => isLive(tid) && EXPORTS.includes(kind),
  canImport: (kind, tid) => isLive(tid) && IMPORTS.includes(kind),
  fetchRows: (kind, tid) => { setActiveTenant(tid); return bizApi("GET", exportPath(kind)).then((r) => r.data); },
  importRows: (kind, tid, rows) => { setActiveTenant(tid); return bizApi("POST", importPath(kind), { rows }).then((r) => { workRefresh(); return r.message; }); },
});
