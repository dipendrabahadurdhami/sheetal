// Payouts (read only for a business): what Sheetal collected for it, the commission kept, and what was paid to its bank. Moved from
// business/backend/src/modules/payouts/routes.ts (P2-W3); every answer and message unchanged.
// Where it fits: Business → Payouts (PayoutsView in Money.jsx, LivePayouts in LiveMoney.jsx). invoicingRoutes() registers payoutRoutes() too.
// How it works: Sheetal staff make and release payouts on the admin API (they write these tables, not this app). Here a business sees its payouts (one per
// branch and run), what is waiting for the next run, the lines inside a payout, and a statement of every line. The bank shows as bank, holder, last 4 digits.
// The reader below is not a BaseRepository on purpose: it never writes, and the rows are written by staff code, so it carries no kernel columns. Every read
// still carries this business and the branches in view, the same rule as invoices.
// Rules: invoicing.payout.read for everything; a business that collects its own payments sees an empty page.

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import type { BusinessContext } from "@sheetal/platform/core/context";
import { forbidden, notFound } from "@sheetal/platform/core/errors";
import { dayOf, ymd } from "@sheetal/backend-core/domain/money";
import { holdCutoff, maskBank, nepalDay, nextPayoutOn, payoutNo, payoutSettings } from "@sheetal/backend-core/domain/payouts";

type Tx = Prisma.TransactionClient;
const db = (ctx: BusinessContext): Tx => ctx.db as unknown as Tx;
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-04.").refine((s) => { const d = dayOf(s); return !Number.isNaN(d.getTime()) && ymd(d) === s; }, "That date doesn't exist.");
const Statement = z.object({ from: Day.optional(), to: Day.optional() });

/** The branch filter of the old inView(): the branches in view, or nothing for the whole business. */
const inView = (ctx: BusinessContext) => { const ids = ctx.branches.idsFor("branch"); return ids ? { branchId: { in: [...ids] } } : {}; };
const namesOf = (ctx: BusinessContext) => new Map(ctx.branches.mine.map((b) => [b.id, b.name]));
function canView(ctx: BusinessContext) { if (!ctx.permissions.can("invoicing.payout.read")) throw forbidden("Your role can't see payouts."); }

const present = (p: Prisma.PayoutGetPayload<object>, names: Map<string, string>) => ({
  id: p.id, no: payoutNo(p.seq), kind: p.kind, status: p.status, branchId: p.branchId, branch: names.get(p.branchId) ?? "",
  gross: p.gross, fee: p.fee, net: p.net, scheduledOn: day(p.scheduledOn)!, paidOn: day(p.paidOn), periodFrom: day(p.periodFrom), periodTo: day(p.periodTo),
  bankRef: p.bankRef ?? "", note: p.note ?? "", failReason: p.failReason ?? "", bank: maskBank(p.bank),
});
const line = (i: Prisma.PayoutItemGetPayload<object>, names: Map<string, string>) => ({
  id: i.id, source: i.source, ref: i.ref, what: i.what, branch: names.get(i.branchId) ?? "", on: day(i.collectedOn)!, gross: i.gross, feePct: i.feeBp / 100, fee: i.fee, net: i.net,
});

export class PayoutService {
  async page(ctx: BusinessContext) {
    canView(ctx);
    const where = { tenantId: ctx.business.id, ...inView(ctx) };
    const [tenant, cfg, rows, waiting] = await Promise.all([
      db(ctx).tenant.findUniqueOrThrow({ where: { id: ctx.business.id }, select: { settings: true } }),
      payoutSettings(db(ctx) as never),
      db(ctx).payout.findMany({ where, orderBy: [{ scheduledOn: "desc" }, { seq: "desc" }], take: 500 }),
      db(ctx).payoutItem.aggregate({ where: { ...where, payoutId: null }, _sum: { gross: true, fee: true, net: true }, _count: true }),
    ]);
    const pay = (tenant.settings as { payments?: { mode?: string; payoutBank?: unknown } } | null)?.payments;
    const names = namesOf(ctx);
    const today = nepalDay();
    const since = holdCutoff(today, 30);
    const recent = rows.filter((p) => p.status === "paid" && day(p.paidOn)! >= since);
    const onTheWay = rows.filter((p) => p.status === "pending");
    return {
      mode: pay?.mode === "own" ? "own" : "sheetal",
      bank: maskBank(pay?.payoutBank),
      schedule: { day: cfg.day, holdDays: cfg.holdDays, nextOn: nextPayoutOn(today, cfg.day) },
      payouts: rows.map((p) => present(p, names)),
      waiting: { count: waiting._count, gross: waiting._sum.gross ?? 0, fee: waiting._sum.fee ?? 0, net: waiting._sum.net ?? 0 },
      onTheWay: { count: onTheWay.length, net: onTheWay.reduce((s, p) => s + p.net, 0) },
      last30: { net: recent.reduce((s, p) => s + p.net, 0), fee: recent.reduce((s, p) => s + p.fee, 0) },
    };
  }

  async statement(ctx: BusinessContext, rawQuery: unknown) {
    canView(ctx);
    const q = Statement.parse(rawQuery);
    const items = await db(ctx).payoutItem.findMany({
      where: { tenantId: ctx.business.id, ...inView(ctx), ...(q.from || q.to ? { collectedOn: { ...(q.from ? { gte: dayOf(q.from) } : {}), ...(q.to ? { lte: dayOf(q.to) } : {}) } } : {}) },
      orderBy: [{ collectedOn: "desc" }, { createdAt: "desc" }], take: 10_000,
    });
    const ids = [...new Set(items.map((i) => i.payoutId).filter((x): x is string => !!x))];
    const nos = new Map((await db(ctx).payout.findMany({ where: { id: { in: ids }, tenantId: ctx.business.id }, select: { id: true, seq: true, status: true } })).map((p) => [p.id, `${payoutNo(p.seq)}${p.status === "paid" ? "" : ` (${p.status})`}`]));
    const names = namesOf(ctx);
    return items.map((i) => ({ date: day(i.collectedOn), branch: names.get(i.branchId) ?? "", source: i.source, reference: i.ref, description: i.what, collected: i.gross, commission: i.fee, net: i.net, payout: i.payoutId ? nos.get(i.payoutId) ?? "" : "Waiting" }));
  }

  async one(ctx: BusinessContext, id: string) {
    canView(ctx);
    const p = await db(ctx).payout.findFirst({ where: { id: id.slice(0, 40), tenantId: ctx.business.id, ...inView(ctx) }, include: { items: { orderBy: [{ collectedOn: "asc" }, { createdAt: "asc" }] } } });
    if (!p) throw notFound("Payout not found.");
    const names = namesOf(ctx);
    return { ...present(p, names), lines: p.items.map((i) => line(i, names)) };
  }
}

/** GET /payouts, /payouts/statement, /payouts/:id (HTTP only: one service call each). */
export function payoutRoutes(app: FastifyInstance, contextOf: (req: FastifyRequest) => Promise<BusinessContext>) {
  const s = new PayoutService();
  app.get("/payouts", async (req) => ({ data: await s.page(await contextOf(req)) }));
  app.get("/payouts/statement", async (req) => ({ data: await s.statement(await contextOf(req), req.query) }));
  app.get<{ Params: { id: string } }>("/payouts/:id", async (req) => ({ data: await s.one(await contextOf(req), req.params.id) }));
}
