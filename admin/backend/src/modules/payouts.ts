// Payouts for Sheetal staff: run the payouts, mark them paid, enter a manual settlement, set commission and schedule.
// Where it fits: the admin panel's Billing → Payouts tab (LiveBilling.jsx).
// How it works: "Run payouts" takes the waiting money that is older than the hold days and makes one pending payout
// per business and branch, with the bank account as it is now. Staff send the transfer from the bank, then mark it paid
// with the bank's reference (the business is told); a failed one gives its money back to the waiting pile. A manual
// payout records a settlement paid outside the run (already paid): either it pays out the business's waiting money
// (all of it, hold days or not, one payout per branch, so the next run can't pay it again), or it is money that was
// never recorded here (an amount typed in). Commission rates, the payout weekday and the hold
// days are platform settings.
// Rules: billing.view reads; billing.refund runs, pays, fails and enters; settings.platform (super admin) changes the
// settings. A business that is suspended, collects its own money or has no bank account is skipped, and its money waits.

import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { dbOf } from "@sheetal/backend-core/lib/db";
import { badRequest, notFound } from "@sheetal/backend-core/lib/errors";
import { notify, teamWith } from "@sheetal/backend-core/lib/notify";
import { dayOf, ymd } from "@sheetal/backend-core/domain/money";
import { PAYOUT_DEFAULTS, WEEKDAYS, bankOf, holdCutoff, nepalDay, nextPayoutOn, payoutNo, payoutSettings } from "@sheetal/backend-core/domain/payouts";
import { staffOf } from "./routes.js";

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-04.").refine((s) => { const d = dayOf(s); return !Number.isNaN(d.getTime()) && ymd(d) === s; }, "That date doesn't exist.");
const rupees = (n: number) => `Rs. ${n.toLocaleString("en-IN")}`;
const MAX = 2_000_000_000;

export async function adminPayoutRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const audit = (actorId: string, ip: string, action: string, target: string, tenantId?: string, meta?: object) =>
    db().auditLog.create({ data: { actorId, tenantId, action, target, ip, meta: meta as object | undefined } });

  /** Tells the people at the business who can see payouts. */
  async function tell(tenantId: string, title: string, message: string) {
    await notify(db(), await teamWith(db(), tenantId, ["payouts.view"]), { type: "payout", title, message, link: "/business/payouts", tenantId });
  }

  // ───── The list, with what is waiting ─────
  app.get("/admin/payouts", async (request) => {
    staffOf(request, "billing.view");
    const q = z.object({ status: z.enum(["pending", "paid", "failed", "all"]).default("pending") }).parse(request.query);
    const cfg = await payoutSettings(db());
    const today = nepalDay();
    const [rows, waiting, waitingBusinesses, pending, month] = await Promise.all([
      db().payout.findMany({ where: q.status === "all" ? {} : { status: q.status }, orderBy: [{ scheduledOn: "desc" }, { seq: "desc" }], take: 300 }),
      db().payoutItem.aggregate({ where: { payoutId: null }, _sum: { gross: true, fee: true, net: true }, _count: true }),
      db().payoutItem.groupBy({ by: ["tenantId"], where: { payoutId: null } }),
      db().payout.aggregate({ where: { status: "pending" }, _sum: { net: true }, _count: true }),
      db().payout.aggregate({ where: { status: "paid", paidOn: { gte: dayOf(`${today.slice(0, 8)}01`) } }, _sum: { net: true, fee: true } }),
    ]);
    const tenants = new Map((await db().tenant.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.tenantId))] } }, select: { id: true, name: true } })).map((t) => [t.id, t.name]));
    const branches = new Map((await db().branch.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.branchId))] } }, select: { id: true, name: true } })).map((b) => [b.id, b.name]));
    return {
      data: {
        summary: {
          waiting: { count: waiting._count, businesses: waitingBusinesses.length, gross: waiting._sum.gross ?? 0, fee: waiting._sum.fee ?? 0, net: waiting._sum.net ?? 0 },
          pending: { count: pending._count, net: pending._sum.net ?? 0 },
          paidThisMonth: { net: month._sum.net ?? 0, fee: month._sum.fee ?? 0 },
          schedule: { day: cfg.day, holdDays: cfg.holdDays, nextOn: nextPayoutOn(today, cfg.day) },
        },
        rows: rows.map((p) => ({
          id: p.id, no: payoutNo(p.seq), kind: p.kind, status: p.status, tenantId: p.tenantId, tenant: tenants.get(p.tenantId) ?? "—", branch: branches.get(p.branchId) ?? "",
          gross: p.gross, fee: p.fee, net: p.net, scheduledOn: day(p.scheduledOn)!, paidOn: day(p.paidOn), bankRef: p.bankRef ?? "", note: p.note ?? "", failReason: p.failReason ?? "",
          bank: p.bank as { bank?: string; holder?: string; account?: string },
        })),
      },
    };
  });

  // ───── What one business has waiting, for the manual payout form ─────
  app.get<{ Params: { tenantId: string } }>("/admin/payouts/waiting/:tenantId", async (request) => {
    staffOf(request, "billing.view");
    const w = await db().payoutItem.aggregate({ where: { tenantId: request.params.tenantId.slice(0, 40), payoutId: null }, _sum: { gross: true, fee: true, net: true }, _count: true });
    return { data: { count: w._count, gross: w._sum.gross ?? 0, fee: w._sum.fee ?? 0, net: w._sum.net ?? 0 } };
  });

  // ───── Run: waiting money older than the hold days becomes pending payouts ─────
  app.post("/admin/payouts/run", async (request) => {
    const s = staffOf(request, "billing.refund");
    const cfg = await payoutSettings(db());
    const today = nepalDay();
    const upTo = dayOf(holdCutoff(today, cfg.holdDays));
    const groups = await db().payoutItem.groupBy({ by: ["tenantId", "branchId"], where: { payoutId: null, collectedOn: { lte: upTo } } });
    const made: string[] = [];
    const skipped: { tenant: string; reason: string }[] = [];
    for (const g of groups) {
      const tenant = await db().tenant.findUnique({ where: { id: g.tenantId }, select: { id: true, name: true, status: true, settings: true } });
      const why = !tenant ? "Business not found." : tenant.status === "suspended" || tenant.status === "cancelled" ? "The business is suspended." : (tenant.settings as { payments?: { mode?: string } } | null)?.payments?.mode === "own" ? "The business collects its own payments." : !bankOf(tenant.settings) ? "No bank account set up." : null;
      if (why) { skipped.push({ tenant: tenant?.name ?? g.tenantId, reason: why }); continue; }
      try {
        const payout = await db().$transaction(async (tx) => {
          const items = await tx.payoutItem.findMany({ where: { tenantId: g.tenantId, branchId: g.branchId, payoutId: null, collectedOn: { lte: upTo } }, select: { id: true, gross: true, fee: true, net: true, collectedOn: true } });
          const net = items.reduce((x, i) => x + i.net, 0);
          if (!items.length || net <= 0) throw badRequest("Nothing to pay yet: refunds are more than the money collected.");
          const from = items.reduce((m, i) => (i.collectedOn < m ? i.collectedOn : m), items[0]!.collectedOn);
          const to = items.reduce((m, i) => (i.collectedOn > m ? i.collectedOn : m), items[0]!.collectedOn);
          const p = await tx.payout.create({ data: { tenantId: g.tenantId, branchId: g.branchId, kind: "batch", status: "pending", gross: items.reduce((x, i) => x + i.gross, 0), fee: items.reduce((x, i) => x + i.fee, 0), net, periodFrom: from, periodTo: to, scheduledOn: dayOf(today), bank: bankOf(tenant!.settings) as Prisma.InputJsonValue, createdBy: s.user.id } });
          const took = await tx.payoutItem.updateMany({ where: { id: { in: items.map((i) => i.id) }, payoutId: null }, data: { payoutId: p.id } });
          if (took.count !== items.length) throw badRequest("The money changed while the payout was made. Run again.");
          return p;
        });
        made.push(payoutNo(payout.seq));
        await audit(s.user.id, request.ip, "payout.created", payoutNo(payout.seq), g.tenantId, { net: payout.net });
      } catch (e) { skipped.push({ tenant: tenant!.name, reason: e instanceof Error ? e.message : "Could not make the payout." }); }
    }
    return { message: made.length ? `${made.length} payout${made.length > 1 ? "s" : ""} made${skipped.length ? `, ${skipped.length} skipped` : ""}.` : skipped.length ? `Nothing paid out: ${skipped.length} skipped.` : "Nothing is waiting that is old enough.", data: { made, skipped } };
  });

  // ───── Mark paid (the transfer was sent from the bank) ─────
  app.post<{ Params: { id: string } }>("/admin/payouts/:id/paid", async (request) => {
    const s = staffOf(request, "billing.refund");
    const b = z.object({ bankRef: z.string().trim().max(60).optional(), paidOn: Day.optional() }).parse(request.body ?? {});
    const p = await db().payout.findUnique({ where: { id: request.params.id.slice(0, 40) } });
    if (!p) throw notFound("Payout not found.");
    const done = await db().payout.updateMany({ where: { id: p.id, status: "pending" }, data: { status: "paid", paidOn: dayOf(b.paidOn ?? nepalDay()), bankRef: b.bankRef || null } });
    if (!done.count) throw badRequest("Only a pending payout can be marked paid.");
    await audit(s.user.id, request.ip, "payout.paid", payoutNo(p.seq), p.tenantId, { net: p.net, bankRef: b.bankRef });
    await tell(p.tenantId, `Payout ${payoutNo(p.seq)} sent`, `${rupees(p.net)} was sent to your bank${b.bankRef ? ` (ref ${b.bankRef})` : ""}.`);
    return { message: `${payoutNo(p.seq)} marked paid.` };
  });

  // ───── Failed (the bank sent it back): the money goes back to waiting ─────
  app.post<{ Params: { id: string } }>("/admin/payouts/:id/fail", async (request) => {
    const s = staffOf(request, "billing.refund");
    const b = z.object({ reason: z.string().trim().min(1, "Say why it failed.").max(200) }).parse(request.body);
    const p = await db().payout.findUnique({ where: { id: request.params.id.slice(0, 40) } });
    if (!p) throw notFound("Payout not found.");
    await db().$transaction(async (tx) => {
      const done = await tx.payout.updateMany({ where: { id: p.id, status: "pending" }, data: { status: "failed", failReason: b.reason } });
      if (!done.count) throw badRequest("Only a pending payout can fail.");
      await tx.payoutItem.updateMany({ where: { payoutId: p.id }, data: { payoutId: null } });
    });
    await audit(s.user.id, request.ip, "payout.failed", payoutNo(p.seq), p.tenantId, { reason: b.reason });
    await tell(p.tenantId, `Payout ${payoutNo(p.seq)} could not be sent`, `${b.reason} Check your bank details in Settings → Payments. The money is kept for the next payout.`);
    return { message: `${payoutNo(p.seq)} marked failed. Its money is waiting for the next run.` };
  });

  // ───── Manual payout: a settlement paid outside the run ─────
  app.post("/admin/payouts/manual", async (request) => {
    const s = staffOf(request, "billing.refund");
    const b = z.object({
      tenantId: z.string().min(1).max(40), branchId: z.string().max(40).nullish(),
      /** Pay out the money waiting for the business instead of a typed amount. */
      settleWaiting: z.boolean().default(false),
      gross: z.number().int().min(1).max(MAX).optional(), fee: z.number().int().min(0).max(MAX).default(0),
      paidOn: Day, bankRef: z.string().trim().max(60).nullish(), note: z.string().trim().min(1, "Say what this settlement is for.").max(200),
    }).refine((x) => x.settleWaiting || x.gross !== undefined, { message: "Enter the amount, or pay out the waiting money.", path: ["gross"] })
      .refine((x) => x.settleWaiting || x.fee <= (x.gross ?? 0), { message: "The commission can't be more than the amount.", path: ["fee"] }).parse(request.body);
    const tenant = await db().tenant.findUnique({ where: { id: b.tenantId }, select: { id: true, name: true, settings: true } });
    if (!tenant) throw notFound("Business not found.");
    const bank = (bankOf(tenant.settings) ?? {}) as Prisma.InputJsonValue;
    const base = { tenantId: tenant.id, kind: "manual", status: "paid", scheduledOn: dayOf(b.paidOn), paidOn: dayOf(b.paidOn), bankRef: b.bankRef || null, bank, note: b.note, createdBy: s.user.id };
    if (b.branchId && !(await db().branch.count({ where: { id: b.branchId, tenantId: tenant.id } }))) throw badRequest("That branch isn't in this business.");

    let made: { seq: number; net: number }[];
    if (b.settleWaiting) {
      made = await db().$transaction(async (tx) => {
        const items = await tx.payoutItem.findMany({ where: { tenantId: tenant.id, payoutId: null, ...(b.branchId ? { branchId: b.branchId } : {}) }, select: { id: true, branchId: true, gross: true, fee: true, net: true, collectedOn: true } });
        if (!items.length) throw badRequest("Nothing is waiting for this business.");
        const byBranch = new Map<string, typeof items>();
        for (const i of items) byBranch.set(i.branchId, [...(byBranch.get(i.branchId) ?? []), i]);
        const out: { seq: number; net: number }[] = [];
        for (const [branchId, its] of byBranch) {
          const net = its.reduce((x, i) => x + i.net, 0);
          if (net <= 0) continue; // refunds are more than the money: it keeps waiting
          const from = its.reduce((m, i) => (i.collectedOn < m ? i.collectedOn : m), its[0]!.collectedOn);
          const to = its.reduce((m, i) => (i.collectedOn > m ? i.collectedOn : m), its[0]!.collectedOn);
          const p = await tx.payout.create({ data: { ...base, branchId, gross: its.reduce((x, i) => x + i.gross, 0), fee: its.reduce((x, i) => x + i.fee, 0), net, periodFrom: from, periodTo: to } });
          const took = await tx.payoutItem.updateMany({ where: { id: { in: its.map((i) => i.id) }, payoutId: null }, data: { payoutId: p.id } });
          if (took.count !== its.length) throw badRequest("The money changed while the payout was made. Try again.");
          out.push({ seq: p.seq, net: p.net });
        }
        if (!out.length) throw badRequest("Nothing to pay: refunds are more than the money collected.");
        return out;
      });
    } else {
      const branchId = b.branchId
        ?? (await db().branch.findFirst({ where: { tenantId: tenant.id, status: "open" }, orderBy: [{ sort: "asc" }, { createdAt: "asc" }], select: { id: true } }))?.id
        ?? (await db().branch.findFirst({ where: { tenantId: tenant.id }, orderBy: [{ sort: "asc" }, { createdAt: "asc" }], select: { id: true } }))?.id;
      if (!branchId) throw badRequest("This business has no branch yet.");
      const p = await db().payout.create({ data: { ...base, branchId, gross: b.gross!, fee: b.fee, net: b.gross! - b.fee } });
      made = [{ seq: p.seq, net: p.net }];
    }
    for (const p of made) {
      await audit(s.user.id, request.ip, "payout.manual", payoutNo(p.seq), tenant.id, { net: p.net, settleWaiting: b.settleWaiting });
      await tell(tenant.id, `Payout ${payoutNo(p.seq)} sent`, `${rupees(p.net)} was sent to your bank. ${b.note}`);
    }
    const nos = made.map((p) => payoutNo(p.seq)).join(", ");
    return { message: `${nos} recorded for ${tenant.name}.`, data: { made: made.map((p) => payoutNo(p.seq)) } };
  });

  // ───── Commission, weekday and hold days ─────
  app.get("/admin/settings/payouts", async (request) => {
    staffOf(request, "billing.view");
    let canEdit = true;
    try { staffOf(request, "settings.platform"); } catch { canEdit = false; }
    return { data: { ...(await payoutSettings(db())), canEdit } };
  });

  app.put("/admin/settings/payouts", async (request) => {
    const s = staffOf(request, "settings.platform");
    const pct = z.number().min(0).max(50);
    const b = z.object({ commission: z.object({ stays: pct, projects: pct, agency: pct, investments: pct }), day: z.enum(WEEKDAYS), holdDays: z.number().int().min(0).max(30) }).parse(request.body);
    const value = { commission: Object.fromEntries(Object.entries(b.commission).map(([k, v]) => [k, Math.round(v * 100) / 100])), day: b.day, holdDays: b.holdDays };
    await db().appSetting.upsert({ where: { key: "payouts" }, create: { key: "payouts", value }, update: { value } });
    await audit(s.user.id, request.ip, "payout.settings", "payouts");
    return { message: "Payout settings saved. New collections use the new commission; money already collected keeps its old one.", data: { ...PAYOUT_DEFAULTS, ...value } };
  });
}
