// Payouts: what Sheetal collected for the business, the commission kept, and what was paid to its bank.
// Where it fits: Business → Payouts (Money.jsx PayoutsView, LivePayouts in LiveMoney.jsx).
// How it works: read-only for the business. Staff make and release payouts on the admin API; here the business
// sees its payouts (one per branch and run), what is still waiting for the next run, the lines inside each payout,
// and a statement of every line to download. The bank account is shown as the bank, the holder and the last four digits.
// Rules: payouts.view for everything; every payout and line belongs to one branch, and people only see their
// branches' money (the same rule as invoices); a business that collects its own payments sees an empty page.

import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { dbOf } from "@sheetal/backend-core/lib/db";
import { forbidden, notFound } from "@sheetal/backend-core/lib/errors";
import { dayOf, ymd } from "@sheetal/backend-core/domain/money";
import { holdCutoff, maskBank, nepalDay, nextPayoutOn, payoutNo, payoutSettings } from "@sheetal/backend-core/domain/payouts";
import { branchView, inView, workspaceOf, type BranchView, type Workspace } from "../access.js";

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-04.").refine((s) => { const d = dayOf(s); return !Number.isNaN(d.getTime()) && ymd(d) === s; }, "That date doesn't exist.");

export async function payoutRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const canView = (ws: Workspace) => { if (!ws.can("invoicing.payout.read")) throw forbidden("Your role can't see payouts."); };
  const branchNames = (v: BranchView) => new Map(v.mine.map((b) => [b.id, b.name]));

  const present = (p: Prisma.PayoutGetPayload<object>, names: Map<string, string>) => ({
    id: p.id, no: payoutNo(p.seq), kind: p.kind, status: p.status, branchId: p.branchId, branch: names.get(p.branchId) ?? "",
    gross: p.gross, fee: p.fee, net: p.net, scheduledOn: day(p.scheduledOn)!, paidOn: day(p.paidOn), periodFrom: day(p.periodFrom), periodTo: day(p.periodTo),
    bankRef: p.bankRef ?? "", note: p.note ?? "", failReason: p.failReason ?? "", bank: maskBank(p.bank),
  });
  const line = (i: Prisma.PayoutItemGetPayload<object>, names: Map<string, string>) => ({
    id: i.id, source: i.source, ref: i.ref, what: i.what, branch: names.get(i.branchId) ?? "", on: day(i.collectedOn)!,
    gross: i.gross, feePct: i.feeBp / 100, fee: i.fee, net: i.net,
  });

  // ───── The page: payouts, what is waiting, and the schedule ─────
  app.get("/payouts", async (request) => {
    const ws = workspaceOf(request); canView(ws);
    const v = await branchView(db(), request, ws);
    const [tenant, cfg, rows, waiting] = await Promise.all([
      db().tenant.findUniqueOrThrow({ where: { id: ws.tenantId }, select: { settings: true } }),
      payoutSettings(db()),
      db().payout.findMany({ where: { tenantId: ws.tenantId, ...inView(v) }, orderBy: [{ scheduledOn: "desc" }, { seq: "desc" }], take: 500 }),
      db().payoutItem.aggregate({ where: { tenantId: ws.tenantId, payoutId: null, ...inView(v) }, _sum: { gross: true, fee: true, net: true }, _count: true }),
    ]);
    const pay = (tenant.settings as { payments?: { mode?: string; payoutBank?: unknown } } | null)?.payments;
    const names = branchNames(v);
    const today = nepalDay();
    const since = holdCutoff(today, 30);
    const recent = rows.filter((p) => p.status === "paid" && day(p.paidOn)! >= since);
    const onTheWay = rows.filter((p) => p.status === "pending");
    return {
      data: {
        mode: pay?.mode === "own" ? "own" : "sheetal",
        bank: maskBank(pay?.payoutBank),
        schedule: { day: cfg.day, holdDays: cfg.holdDays, nextOn: nextPayoutOn(today, cfg.day) },
        payouts: rows.map((p) => present(p, names)),
        waiting: { count: waiting._count, gross: waiting._sum.gross ?? 0, fee: waiting._sum.fee ?? 0, net: waiting._sum.net ?? 0 },
        onTheWay: { count: onTheWay.length, net: onTheWay.reduce((s, p) => s + p.net, 0) },
        last30: { net: recent.reduce((s, p) => s + p.net, 0), fee: recent.reduce((s, p) => s + p.fee, 0) },
      },
    };
  });

  // ───── Statement: every line of money collected, for the Download button ─────
  app.get("/payouts/statement", async (request) => {
    const ws = workspaceOf(request); canView(ws);
    const q = z.object({ from: Day.optional(), to: Day.optional() }).parse(request.query);
    const v = await branchView(db(), request, ws);
    const items = await db().payoutItem.findMany({
      where: { tenantId: ws.tenantId, ...inView(v), ...(q.from || q.to ? { collectedOn: { ...(q.from ? { gte: dayOf(q.from) } : {}), ...(q.to ? { lte: dayOf(q.to) } : {}) } } : {}) },
      orderBy: [{ collectedOn: "desc" }, { createdAt: "desc" }], take: 10_000,
    });
    const ids = [...new Set(items.map((i) => i.payoutId).filter((x): x is string => !!x))];
    const nos = new Map((await db().payout.findMany({ where: { id: { in: ids } }, select: { id: true, seq: true, status: true } })).map((p) => [p.id, `${payoutNo(p.seq)}${p.status === "paid" ? "" : ` (${p.status})`}`]));
    const names = branchNames(v);
    return { data: items.map((i) => ({ date: day(i.collectedOn), branch: names.get(i.branchId) ?? "", source: i.source, reference: i.ref, description: i.what, collected: i.gross, commission: i.fee, net: i.net, payout: i.payoutId ? nos.get(i.payoutId) ?? "" : "Waiting" })) };
  });

  // ───── One payout with its lines ─────
  app.get<{ Params: { id: string } }>("/payouts/:id", async (request) => {
    const ws = workspaceOf(request); canView(ws);
    const v = await branchView(db(), request, ws);
    const p = await db().payout.findFirst({ where: { id: request.params.id.slice(0, 40), tenantId: ws.tenantId, ...inView(v) }, include: { items: { orderBy: [{ collectedOn: "asc" }, { createdAt: "asc" }] } } });
    if (!p) throw notFound("Payout not found.");
    const names = branchNames(v);
    return { data: { ...present(p, names), lines: p.items.map((i) => line(i, names)) } };
  });
}
