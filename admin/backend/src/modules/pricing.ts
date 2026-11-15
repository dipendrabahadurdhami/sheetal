// Admin -> Pricing (MARKETPLACE-AND-BILLING.md sections 3.2, 3.3 and 5.6; P3-BE-7): the app catalog (editions, prices, free limits, trials,
// add-ons) with a reason on every change, the "who is affected" count, and a second staff member's approval for a price rise or a cut of a paid
// limit that paying businesses have.
// Where it fits: registered in admin/backend/src/app.ts under /v1. The catalog is the typed setting platform.catalog (platform/src/billing/
// catalog.ts); the generic settings route refuses to save it (platform/src/settings/routes.ts), so every change passes through here.
//   GET  /admin/pricing            the catalog in use, the billing rules, subscriber counts per edition, waiting requests, the last changes
//   POST /admin/pricing/preview    { catalog }            what saving would do (changes, refusals, whether approval is needed)
//   PUT  /admin/pricing            { catalog, reason }    saves (version + 1), or 202 "Sent for approval" with the request id
// How it works: the body's catalog.version must be the version in use (someone else saving first answers 409 version_conflict). The guards of
// the setting (catalogProblems) run first, then pricingImpact(). A request waiting for approval stores the whole new catalog; when approved it
// is saved only if the version is still the one it was made from (otherwise it fails and nothing changes). After a price rise the owners of the
// paying businesses get a notice with the date the new price reaches their renewals (priceChangeNoticeDays later).
// Rules: prices are paisa, VAT included. A cut never needs approval. Turning off something businesses use is refused (hide it instead).

import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { dbOf, type Db } from "@sheetal/platform/db/client";
import { AppError, badRequest, versionConflict } from "@sheetal/platform/core/errors";
import { SettingsService } from "@sheetal/platform/settings/service";
import { BILLING_SETTING, CATALOG_SETTING, CatalogSchema, catalogProblems, withNewApps } from "@sheetal/platform/billing/catalog";
import { pricingImpact, type Impact, type ImpactCounts } from "@sheetal/platform/billing/pricing-impact";
import type { Catalog } from "@sheetal/platform/billing/types";
import { notify } from "@sheetal/platform/notify/index";
import { staffOf, type Staff } from "./routes.js";
import { approvalJson, approversFor, claimApproval, markExecuted, markFailed, registerExecutor, requestApproval } from "./platform-approvals.js";

const QUIET = { warn: () => undefined };
const ACTION = "platform.pricing.change";
const Reason = z.string().trim().min(5, "Give a reason of 5 to 300 characters.").max(300);
const Preview = z.object({ catalog: z.unknown() }).strict();
const Save = z.object({ catalog: z.unknown(), reason: Reason }).strict();

/** Subscriber counts per edition and add-on, for the impact check. */
export async function impactCounts(db: Db, now: Date = new Date()): Promise<ImpactCounts> {
  const eds = await db.$queryRaw<{ app_id: string; edition_id: string; paying: number; trialing: number; free: number }[]>`
    SELECT app_id, edition_id,
      COUNT(*) FILTER (WHERE status IN ('active', 'past_due', 'read_only') AND period_months IS NOT NULL AND price_gross_paisa > 0)::int AS paying,
      COUNT(*) FILTER (WHERE status = 'trialing')::int AS trialing,
      COUNT(*) FILTER (WHERE period_months IS NULL AND status <> 'trialing')::int AS free
    FROM subscriptions WHERE uninstalled_at IS NULL GROUP BY app_id, edition_id`;
  const adds = await db.$queryRaw<{ app_id: string; addon_key: string; n: number }[]>`
    SELECT app_id, addon_key, COUNT(DISTINCT tenant_id)::int AS n FROM addon_subscriptions WHERE qty > 0 AND current_period_end > ${now} GROUP BY app_id, addon_key`;
  return {
    editions: Object.fromEntries(eds.map((r) => [`${r.app_id}:${r.edition_id}`, { paying: r.paying, trialing: r.trialing, free: r.free }])),
    addons: Object.fromEntries(adds.filter((r) => r.app_id !== "").map((r) => [r.addon_key, r.n])),
    businessAddons: adds.filter((r) => r.app_id === "").reduce((a, r) => a + r.n, 0),
  };
}

/** Validates a catalog from a request: the schema (422 with fields), then the setting's guards (400). */
function checked(value: unknown, prev: Catalog): Catalog {
  const p = CatalogSchema.safeParse(value);
  if (!p.success) {
    const errors: Record<string, string[]> = {};
    for (const i of p.error.issues) (errors[i.path.join(".") || "_"] ??= []).push(i.message);
    throw new AppError(422, "validation", "Please check the highlighted fields.", errors);
  }
  const problems = catalogProblems(p.data, prev);
  if (problems.length) throw badRequest(problems[0]!, { catalog: problems });
  return p.data;
}

export async function adminPricingRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const store = () => new SettingsService(db(), QUIET);
  const current = async () => withNewApps(await store().get(CATALOG_SETTING));

  /** Saves the catalog, tells the platform (event) and the owners of paying businesses (notice of a rise). */
  async function save(next: Catalog, impact: Impact, o: { actorId: string; ip: string; reason: string; note?: string }) {
    const saved = await store().set(CATALOG_SETTING, next, { actorId: o.actorId, ip: o.ip, reason: o.note ? `${o.reason} (${o.note})` : o.reason });
    const rises = impact.changes.filter((c) => c.kind === "price_rise" && c.paying > 0);
    await db().eventOutbox.create({ data: {
      id: randomUUID(), name: "platform.catalog.changed", v: 1, payload: { version: saved.version, priceRises: rises.length } as Prisma.InputJsonValue,
      tenantId: null, branchId: null, actor: { kind: "staff", staffId: o.actorId } as Prisma.InputJsonValue, requestId: `pricing-${randomUUID()}`,
    } });
    if (rises.length) {
      const days = (await store().get(BILLING_SETTING)).priceChangeNoticeDays;
      const from = new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
      for (const r of rises) {
        const subs = await db().subscription.findMany({
          where: { appId: r.appId ?? undefined, ...(r.editionId ? { editionId: r.editionId } : {}), status: { in: ["active", "past_due", "read_only"] }, periodMonths: { not: null }, priceGrossPaisa: { gt: 0 }, uninstalledAt: null },
          select: { tenantId: true },
        });
        if (!subs.length) continue;
        const owners = await db().membership.findMany({ where: { tenantId: { in: [...new Set(subs.map((s) => s.tenantId))] }, status: "active", role: { key: "owner" } }, select: { userId: true, tenantId: true } });
        for (const ow of owners) {
          await notify(db(), [ow.userId], { tenantId: ow.tenantId, type: "billing", link: "/business/billing", title: "A price is changing",
            message: `${r.what}. Your renewals keep today's price until ${from}; after that the new price applies.` });
        }
      }
    }
    return saved;
  }

  if (app.db) registerExecutor(db(), {
    action: ACTION, permission: "platform.pricing.manage", label: "Price change with paying customers",
    run: async (row, checker, request, note) => {
      const p = row.payload as unknown as { catalog: Catalog; baseVersion: number; reason: string };
      const now = new Date();
      await claimApproval(db(), row.id, { checkerId: checker.user.id, note, now });
      try {
        const cur = await current();
        if (cur.version !== p.baseVersion) throw versionConflict("The prices");
        const impact = pricingImpact(cur, p.catalog, await impactCounts(db()));
        if (impact.refused.length) throw badRequest(impact.refused[0]!);
        const saved = await save(p.catalog, impact, { actorId: row.makerId, ip: request.ip, reason: p.reason, note: `approved by ${checker.user.userName}` });
        await markExecuted(db(), row.id, new Date(), { version: saved.version });
        return { version: saved.version };
      } catch (e) {
        await markFailed(db(), row.id, e instanceof Error ? e.message : "failed");
        throw e;
      }
    },
  });

  app.get("/admin/pricing", async (request) => {
    const s = staffOf(request, "platform.billing.read");
    const [catalog, billing, counts, waiting, history] = await Promise.all([
      current(), store().get(BILLING_SETTING), impactCounts(db()),
      db().platformApproval.findMany({ where: { action: ACTION, status: "pending", expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" }, take: 20 }),
      store().history(CATALOG_SETTING, undefined, 20),
    ]);
    return { data: { catalog, billing, counts, waiting: waiting.map((r) => approvalJson(r, "Price change with paying customers")), history, canChange: s.can("platform.pricing.manage") } };
  });

  const preview = async (request: FastifyRequest, s: Staff, value: unknown) => {
    const prev = await current();
    // Someone saved first: answered before any other check, so the screen offers "Reload".
    if ((value as { version?: unknown } | null)?.version !== prev.version) throw versionConflict("The prices");
    const next = checked(value, prev);
    const toSave = { ...next, version: prev.version + 1 };
    const impact = pricingImpact(prev, toSave, await impactCounts(db()));
    const otherApprovers = impact.needsApproval ? (await approversFor(db(), "platform.pricing.manage", s.user.id)).length : 0;
    return { prev, toSave, impact, otherApprovers, ip: request.ip };
  };

  app.post("/admin/pricing/preview", async (request) => {
    const s = staffOf(request, "platform.pricing.manage");
    const b = Preview.parse(request.body);
    const { impact, otherApprovers } = await preview(request, s, b.catalog);
    return { data: { ...impact, approvalSkipped: impact.needsApproval && otherApprovers === 0 } };
  });

  app.put("/admin/pricing", async (request, reply) => {
    const s = staffOf(request, "platform.pricing.manage");
    const b = Save.parse(request.body);
    const { prev, toSave, impact, otherApprovers } = await preview(request, s, b.catalog);
    if (impact.refused.length) throw badRequest(impact.refused[0]!, { catalog: impact.refused });
    if (!impact.changes.length && JSON.stringify(prev) === JSON.stringify({ ...toSave, version: prev.version })) return { message: "Nothing changed.", data: { version: prev.version, impact } };
    if (impact.needsApproval && otherApprovers > 0) {
      const row = await requestApproval(db(), {
        action: ACTION, resource: "catalog", resourceId: String(prev.version), payload: { catalog: toSave, baseVersion: prev.version, reason: b.reason },
        maker: s, note: b.reason, now: new Date(), ip: request.ip, target: `${impact.payingAffected} paying subscriptions affected`,
      });
      reply.status(202);
      return { message: "Sent for approval. Another staff member with pricing rights must approve it.", code: "approval_needed", data: { approvalId: row.id, impact } };
    }
    // Nobody else could approve: the one-person team rule (the audit row says so).
    const saved = await save(toSave, impact, { actorId: s.user.id, ip: request.ip, reason: b.reason, note: impact.needsApproval ? "no second approver on the team: approval skipped" : undefined });
    return { message: "Prices saved. New sales use them now.", data: { version: saved.version, impact } };
  });
}
