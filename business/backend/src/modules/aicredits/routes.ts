// Business -> AI: the business's Sheetal AI credits and where its AI features stand (MARKETPLACE-AND-BILLING.md section 10; P3-BE-8).
// Where it fits: registered in business/backend/src/app.ts under /v1; the AI screen of P3-FE-6 reads it. The router that spends the credits is
// platform/src/ai/router.ts; the own-key connections live in the Integration Center; business.ai holds the preferred provider and the
// "If my key fails, use Sheetal AI" switch (changed through the business settings route).
//   GET /v1/ai/credits    { state, balance, grants (live, first-expiring first), thisMonth: { sheetal, own, previews, byFeature }, settings }
// How it works: reads only; the state is the one Entitlements.ai() gives on this business's requests (aiStateQuick).
// Rules: workspace.billing.manage (the people who pay Sheetal). Keys are never part of this answer (they are not read here at all).

import type { FastifyInstance } from "fastify";
import { dbOf } from "@sheetal/platform/db/client";
import { forbidden } from "@sheetal/platform/core/errors";
import { SettingsService } from "@sheetal/platform/settings/service";
import { creditBalance } from "@sheetal/platform/billing/ai-credits";
import { aiStateQuick } from "@sheetal/platform/ai/router";
import { BUSINESS_AI } from "@sheetal/platform/ai/settings";
import { workspaceOf } from "../access.js";

export async function aiCreditRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);

  app.get("/ai/credits", async (request) => {
    const ws = workspaceOf(request);
    if (!ws.can("workspace.billing.manage")) throw forbidden("Only people who manage billing can see AI credits.");
    const now = new Date();
    // The month in Nepal time (UTC+05:45), like every other report.
    const nepal = new Date(now.getTime() + 5.75 * 3_600_000);
    const monthStart = new Date(Date.UTC(nepal.getUTCFullYear(), nepal.getUTCMonth(), 1) - 5.75 * 3_600_000);
    const [state, balance, grants, used, settings] = await Promise.all([
      aiStateQuick(db(), ws.tenantId, now), creditBalance(db(), ws.tenantId, now),
      db().aiCreditGrant.findMany({ where: { tenantId: ws.tenantId, remaining: { gt: 0 }, expiresAt: { gt: now } }, orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }], take: 50 }),
      db().aiUsage.groupBy({ by: ["source", "feature"], where: { tenantId: ws.tenantId, createdAt: { gte: monthStart } }, _sum: { credits: true }, _count: true }),
      new SettingsService(db(), request.log).get(BUSINESS_AI, { tenantId: ws.tenantId }),
    ]);
    const sum = (source: string) => used.filter((u) => u.source === source).reduce((a, u) => a + (u._sum.credits ?? 0), 0);
    const count = (source: string) => used.filter((u) => u.source === source).reduce((a, u) => a + u._count, 0);
    return {
      data: {
        state, balance, settings,
        grants: grants.map((g) => ({ id: g.id, source: g.source, credits: g.credits, remaining: g.remaining, expiresAt: g.expiresAt })),
        thisMonth: {
          from: monthStart, sheetalCredits: sum("sheetal"), sheetalUses: count("sheetal"), ownUses: count("own"), previews: count("preview"),
          byFeature: used.map((u) => ({ feature: u.feature, source: u.source, uses: u._count, credits: u._sum.credits ?? 0 })),
        },
      },
    };
  });
}
