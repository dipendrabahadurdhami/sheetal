// GET /v1/entitlements: what this business may use now, app by app (MARKETPLACE-AND-BILLING.md section 6, P3-BE-3).
// Where it fits: the screens' useEntitlements() hook (P3-FE-2) draws the menu, the limit banners and the read-only banner from it. It answers
// for every billing mode: "plans" (today's plan, v1), "shadow" (v1 too) and "apps" (the app subscriptions, v3).
// How it works: the business context already holds the entitlements of the request; this route only lays them out per app of the catalog.
// Rules: any active member may read it (it says what the business has, not who did what); nothing about prices or other businesses.

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { BusinessContext } from "@sheetal/platform/core/context";
import { APPS } from "@sheetal/platform/tenancy/apps.generated";

export async function entitlementRoutes(app: FastifyInstance, opts: { contextOf: (request: FastifyRequest) => Promise<BusinessContext> }) {
  app.get("/entitlements", async (request) => {
    const ctx = await opts.contextOf(request);
    const e = ctx.entitlements;
    const apps = APPS.filter((m) => m.kind !== "platform").map((m) => {
      const access = e.access ? e.access(m.id) : e.hasApp(m.id) ? "full" : "none";
      return {
        appId: m.id, access, edition: e.edition(m.id),
        limits: Object.fromEntries(m.limits.map((l) => [l.key, e.limit(m.id, l.key)])),
      };
    });
    return { data: { mode: e.mode ?? "plans", apps, seats: e.seats() } };
  });
}
