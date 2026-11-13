// The v1 entitlement rules written out by hand (P3-QA-1), the reference both builders are checked against, like permissions-oracle.ts.
// v1 = today's buildEntitlements() (platform/src/tenancy/context.ts) from the Starter / Business / Pro plan.
// Rules: hand-written lists, NOT computed from the manifests, so a wrong manifest or builder change is caught.

/** Apps each business type has on Starter and Business (the manifests' businessTypes). Pro (all_kinds) has every app. */
export const APPS_BY_TYPE: Record<string, string[]> = {
  hotel: ["agreements", "crm", "expenses", "hotel", "invoicing", "people", "pos", "reviews", "workspace"],
  host: ["agreements", "crm", "expenses", "hotel", "invoicing", "people", "pos", "reviews", "workspace"],
  developer: ["agreements", "collections", "crm", "expenses", "invoicing", "people", "projects", "reviews", "workspace"],
  agency: ["agreements", "collections", "crm", "expenses", "invoicing", "listings", "people", "rentals", "reviews", "workspace"],
  sponsor: ["agreements", "crm", "expenses", "investments", "invoicing", "people", "reviews", "workspace"],
};
export const ALL_APPS = ["agreements", "collections", "crm", "expenses", "hotel", "investments", "invoicing", "listings", "people", "pos", "projects", "rentals", "reviews", "workspace"];

/** v1: has the app. */
export const oracleHasApp = (type: string, features: Record<string, boolean>, appId: string) =>
  (features.all_kinds ? ALL_APPS : APPS_BY_TYPE[type] ?? []).includes(appId);

/** v1: a limit by its old key (-1 and missing = unlimited). */
export const oracleLimit = (limits: Record<string, number>, key: string): number | null => {
  const v = limits[key];
  return v === undefined || v === -1 ? null : v;
};

/** v1: seats (Starter 1 unless an add-on raised it). */
export const oracleSeats = (limits: Record<string, number>): number | null => (limits.seats === -1 ? null : limits.seats ?? 1);
