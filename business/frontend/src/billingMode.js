// How the open business is billed: "plans" (today's Starter / Business / Pro), "shadow" (plans, with the new rules only compared) or "apps"
// (per-app subscriptions, Phase 3). The shell shows the Marketplace and the Subscriptions page only for "apps" (P3-FE-1 "go back").
// Where it fits: BusinessApp.jsx asks useBillingMode(tenantId); the answer comes from GET /entitlements (any active member may read it).
// How it works: one request per business, kept for the page's life; reloadBillingMode() asks again (after Sheetal moves a business).
// Rules: until the answer arrives the mode is null and the shell keeps today's pages, so nothing changes for a business on plans.
// P3-FE-2 brings the full useEntitlements() hook (limits, banners); this file only needs the mode.

import { useEffect, useState } from "react";
import { bizApi } from "./api";

const known = new Map();
const listeners = new Set();

/** Asks the server again for this business's billing mode. */
export function reloadBillingMode(tenantId) {
  return bizApi("GET", "/entitlements").then((r) => { known.set(tenantId, r.data?.mode || "plans"); listeners.forEach((fn) => fn()); })
    .catch(() => { /* keep today's pages when the answer can't be read */ });
}

/** "plans" | "shadow" | "apps", or null while it loads. */
export function useBillingMode(tenantId) {
  const [, bump] = useState(0);
  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    listeners.add(fn);
    if (tenantId && !known.has(tenantId)) reloadBillingMode(tenantId);
    return () => { listeners.delete(fn); };
  }, [tenantId]);
  return tenantId ? known.get(tenantId) ?? null : null;
}
