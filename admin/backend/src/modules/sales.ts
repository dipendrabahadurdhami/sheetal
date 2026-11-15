// Admin -> Sales, Revenue and Billing (MARKETPLACE-AND-BILLING.md sections 9.4, 13 and 14.3; SETTINGS.md section 7; P3-BE-7): every app sale,
// what Sheetal earned, the VAT summary, the tax invoices, the "not sent to IRD" list and the shadow-mode differences.
// Where it fits: registered in admin/backend/src/app.ts under /v1. Reads only what the payment moment recorded: RevenueEntry rows (one per
// invoice line, with the percentages used then) and issued invoices; nothing here is recalculated from today's settings.
//   GET /admin/sales                ?range=today|7d|30d|custom&from&to&appId&tenantId&kind&saleType&method&page   (&format=csv: audited)
//   GET /admin/revenue              ?range…   totals, the previous period of the same length with % change, by day / app / edition / method,
//                                             plus MRR, trials started and converted, and businesses that lapsed
//   GET /admin/billing/vat          ?range…   per Nepal month: taxable amount, VAT and totals of tax invoices and of credit notes (&format=csv)
//   GET /admin/billing/tax-invoices ?range&kind=all|subscription|credit&page
//   GET /admin/billing/ird          the tax invoices not sent to IRD (the IRD link is not built yet: every issued one is listed)
//   GET /admin/billing/shadow       ?days=7   businesses in shadow mode whose new (app) answer differed from today's, "less" first
// How it works: ranges are Nepal days (UTC+05:45; rangeOf in platform/src/settings/revenue.ts); sums run in PostgreSQL after AT TIME ZONE
// 'Asia/Kathmandu', grouped, and every total here is the sum of the rows it shows. Only live money: RevenueEntry rows are live by design (test
// payments never make one).
// Rules: amounts are paisa (numbers). Sales and revenue need platform.revenue.read; the billing lists need platform.billing.read; every CSV also
// needs platform.billing.export and writes an audit row. The technology partner is never named here (only on the revenue-share screen).

import type { FastifyInstance, FastifyReply } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { dbOf } from "@sheetal/platform/db/client";
import { forbidden } from "@sheetal/platform/core/errors";
import { SettingsService } from "@sheetal/platform/settings/service";
import { BILLING_SETTING } from "@sheetal/platform/billing/catalog";
import { taxNumber } from "@sheetal/platform/billing/invoice";
import { changePct, nepalDayStart, rangeOf, type Range } from "@sheetal/platform/settings/revenue";
import { staffOf, type Staff } from "./routes.js";

const QUIET = { warn: () => undefined };
const Id = z.string().regex(/^[a-z][a-z0-9_]{0,40}$/);
const RangeQ = { range: z.enum(["today", "7d", "30d", "custom"]).default("30d"), from: z.string().max(10).optional(), to: z.string().max(10).optional(), format: z.enum(["json", "csv"]).default("json") };
const addDay = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00.000Z`) + n * 864e5).toISOString().slice(0, 10);
const bounds = (r: Pick<Range, "fromDay" | "toDay">) => ({ from: nepalDayStart(r.fromDay), to: nepalDayStart(addDay(r.toDay, 1)) });
const NEPAL_DAY = `to_char((paid_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kathmandu', 'YYYY-MM-DD')`;

/** A cell safe for spreadsheet programs (no formulas). */
const cell = (v: unknown) => { const s = String(v ?? ""); return /[",\r\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"` : s; };
const rs = (p: number) => (p / 100).toFixed(2);
const nepalTime = (d: Date) => new Date(d.getTime() + 5.75 * 3_600_000).toISOString().slice(0, 16).replace("T", " ");

export interface Totals {
  grossPaisa: number; refundsPaisa: number; vatPaisa: number; netPaisa: number; commissionPaisa: number; partnerPaisa: number; sheetalNetPaisa: number; publisherPaisa: number;
  count: number; refundCount: number; newSalesPaisa: number; renewalsPaisa: number; upgradesPaisa: number; addonsPaisa: number;
}
const zero = (): Totals => ({ grossPaisa: 0, refundsPaisa: 0, vatPaisa: 0, netPaisa: 0, commissionPaisa: 0, partnerPaisa: 0, sheetalNetPaisa: 0, publisherPaisa: 0, count: 0, refundCount: 0, newSalesPaisa: 0, renewalsPaisa: 0, upgradesPaisa: 0, addonsPaisa: 0 });
interface Group { day: string; app_id: string | null; edition_id: string | null; method: string; kind: string; sale_type: string; gross: string; vat: string; net: string; commission: string; partner: string; sheetal: string; publisher: string; n: number }

/** Adds one grouped row. Money after refunds (VAT, net, commission, partner, Sheetal's net, publisher) sums both kinds; gross and the sale
 *  types count sales only; refunds are shown as a positive amount. */
function addRow(t: Totals, g: Group) {
  const gross = Number(g.gross);
  if (g.kind === "refund") { t.refundsPaisa += -gross; t.refundCount += g.n; } else {
    t.grossPaisa += gross; t.count += g.n;
    if (g.sale_type === "new") t.newSalesPaisa += gross; else if (g.sale_type === "renewal") t.renewalsPaisa += gross; else if (g.sale_type === "upgrade") t.upgradesPaisa += gross; else t.addonsPaisa += gross;
  }
  t.vatPaisa += Number(g.vat); t.netPaisa += Number(g.net); t.commissionPaisa += Number(g.commission); t.partnerPaisa += Number(g.partner);
  t.sheetalNetPaisa += Number(g.sheetal); t.publisherPaisa += Number(g.publisher);
}

export async function adminSalesRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const exportable = async (s: Staff, reply: FastifyReply, ip: string, what: string, name: string, lines: string[]) => {
    if (!s.can("platform.billing.export")) throw forbidden("Your staff role can't download these records.");
    await db().auditLog.create({ data: { actorId: s.user.id, action: "billing.export", target: what, ip } });
    reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="${name}"`);
    return "﻿" + lines.join("\r\n") + "\r\n";
  };

  async function grouped(r: Pick<Range, "fromDay" | "toDay">): Promise<Group[]> {
    const { from, to } = bounds(r);
    return db().$queryRawUnsafe<Group[]>(
      `SELECT ${NEPAL_DAY} AS day, app_id, edition_id, method, kind, sale_type,
              SUM(gross_paisa)::text AS gross, SUM(vat_paisa)::text AS vat, SUM(net_paisa)::text AS net, SUM(commission_paisa)::text AS commission,
              SUM(partner_paisa)::text AS partner, SUM(sheetal_net_paisa)::text AS sheetal, SUM(publisher_paisa)::text AS publisher, COUNT(*)::int AS n
       FROM revenue_entries WHERE mode = 'live' AND paid_at >= $1 AND paid_at < $2 GROUP BY 1, 2, 3, 4, 5, 6`, from, to);
  }

  // ───── Sales list ─────
  const SalesQ = z.object({ ...RangeQ, appId: Id.optional(), tenantId: z.string().max(40).optional(), kind: z.enum(["sale", "refund"]).optional(), saleType: z.enum(["new", "renewal", "upgrade", "addon", "ai"]).optional(), method: z.string().max(20).optional(), page: z.coerce.number().int().min(1).default(1) }).strict();
  app.get("/admin/sales", async (request, reply) => {
    const s = staffOf(request, "platform.revenue.read");
    const q = SalesQ.parse(request.query);
    const r = rangeOf(q);
    const { from, to } = bounds(r);
    const where: Prisma.RevenueEntryWhereInput = {
      mode: "live", paidAt: { gte: from, lt: to }, ...(q.appId ? { appId: q.appId } : {}), ...(q.tenantId ? { tenantId: q.tenantId } : {}),
      ...(q.kind ? { kind: q.kind } : {}), ...(q.saleType ? { saleType: q.saleType } : {}), ...(q.method ? { method: q.method } : {}),
    };
    const csv = q.format === "csv";
    const per = 100;
    const [total, sums, rows] = await Promise.all([
      db().revenueEntry.count({ where }),
      db().revenueEntry.aggregate({ where, _sum: { grossPaisa: true, vatPaisa: true, netPaisa: true, commissionPaisa: true, sheetalNetPaisa: true } }),
      db().revenueEntry.findMany({ where, orderBy: [{ paidAt: "desc" }, { id: "asc" }], skip: csv ? 0 : (q.page - 1) * per, take: csv ? 20_000 : per }),
    ]);
    const [tenants, invoices] = await Promise.all([
      db().tenant.findMany({ where: { id: { in: [...new Set(rows.map((x) => x.tenantId))] } }, select: { id: true, name: true } }),
      db().invoice.findMany({ where: { id: { in: [...new Set(rows.map((x) => x.invoiceId))] } }, select: { id: true, no: true, fy: true, kind: true } }),
    ]);
    const T = new Map(tenants.map((t) => [t.id, t.name])), I = new Map(invoices.map((i) => [i.id, i.no && i.fy ? taxNumber(i.fy, i.no, i.kind) : null]));
    const data = rows.map((x) => ({
      id: x.id, paidAt: x.paidAt, tenantId: x.tenantId, business: T.get(x.tenantId) ?? null, invoiceId: x.invoiceId, number: I.get(x.invoiceId) ?? null,
      appId: x.appId, editionId: x.editionId, kind: x.kind, saleType: x.saleType, method: x.method,
      grossPaisa: Number(x.grossPaisa), vatPaisa: Number(x.vatPaisa), netPaisa: Number(x.netPaisa), commissionPaisa: Number(x.commissionPaisa), commissionPct: x.commissionBp / 100,
      sheetalNetPaisa: Number(x.sheetalNetPaisa), publisherPaisa: Number(x.publisherPaisa),
    }));
    if (csv) {
      const lines = [["Paid (Nepal)", "Business", "Invoice", "App", "Edition", "Kind", "Sale", "Method", "Gross", "VAT", "Net", "Commission %", "Commission", "Sheetal net"].join(",")];
      for (const d of data) lines.push([nepalTime(d.paidAt), d.business, d.number, d.appId, d.editionId, d.kind, d.saleType, d.method, rs(d.grossPaisa), rs(d.vatPaisa), rs(d.netPaisa), d.commissionPct, rs(d.commissionPaisa), rs(d.sheetalNetPaisa)].map(cell).join(","));
      return exportable(s, reply, request.ip, `sales ${r.fromDay} to ${r.toDay}`, `sheetal-sales-${r.fromDay}-to-${r.toDay}.csv`, lines);
    }
    const sum = (v: bigint | null) => (v == null ? 0 : Number(v));
    return {
      data, from: r.fromDay, to: r.toDay,
      totals: { grossPaisa: sum(sums._sum.grossPaisa), vatPaisa: sum(sums._sum.vatPaisa), netPaisa: sum(sums._sum.netPaisa), commissionPaisa: sum(sums._sum.commissionPaisa), sheetalNetPaisa: sum(sums._sum.sheetalNetPaisa), rows: total },
      meta: { total, current_page: q.page, last_page: Math.max(1, Math.ceil(total / per)), per_page: per },
    };
  });

  // ───── Revenue report ─────
  app.get("/admin/revenue", async (request, reply) => {
    const s = staffOf(request, "platform.revenue.read");
    const q = z.object(RangeQ).strict().parse(request.query);
    const r = rangeOf(q);
    const [cur, prev] = await Promise.all([grouped(r), grouped({ fromDay: r.prevFromDay, toDay: r.prevToDay })]);
    const totals = zero(), previous = zero();
    const by = { day: new Map<string, Totals>(), app: new Map<string, Totals>(), edition: new Map<string, Totals>(), method: new Map<string, Totals>() };
    const into = (m: Map<string, Totals>, k: string) => { let t = m.get(k); if (!t) { t = zero(); m.set(k, t); } return t; };
    for (let i = 0; i < r.days; i++) into(by.day, addDay(r.fromDay, i));
    for (const g of cur) {
      addRow(totals, g); addRow(into(by.day, g.day), g); addRow(into(by.app, g.app_id ?? "business"), g);
      addRow(into(by.edition, `${g.app_id ?? "business"}:${g.edition_id ?? "-"}`), g); addRow(into(by.method, g.method), g);
    }
    for (const g of prev) addRow(previous, g);
    const { from, to } = bounds(r);
    const vat = (await new SettingsService(db(), QUIET).get(BILLING_SETTING)).vatRatePct;
    const [mrr, ev] = await Promise.all([
      db().$queryRaw<{ gross: string | null }[]>`SELECT SUM(price_gross_paisa::numeric / period_months)::text AS gross FROM subscriptions
        WHERE status IN ('active', 'past_due') AND period_months IS NOT NULL AND price_gross_paisa > 0 AND uninstalled_at IS NULL`,
      db().$queryRaw<{ started: number; converted: number; lapsed: number }[]>`SELECT
          COUNT(*) FILTER (WHERE e.type = 'trial_started')::int AS started,
          COUNT(*) FILTER (WHERE e.type = 'purchased' AND s.trial_used_at IS NOT NULL AND s.trial_used_at <= e.at)::int AS converted,
          COUNT(*) FILTER (WHERE e.type = 'expired')::int AS lapsed
        FROM subscription_events e JOIN subscriptions s ON s.id = e.subscription_id WHERE e.at >= ${from} AND e.at < ${to}`,
    ]);
    const mrrGross = Number(mrr[0]?.gross ?? 0);
    const keys = Object.keys(totals) as (keyof Totals)[];
    const list = (m: Map<string, Totals>) => [...m.entries()].map(([key, t]) => ({ key, totals: t }));
    const report = {
      from: r.fromDay, to: r.toDay, days: r.days, previousFrom: r.prevFromDay, previousTo: r.prevToDay, totals, previous,
      changePct: Object.fromEntries(keys.map((k) => [k, changePct(totals[k], previous[k])])),
      byDay: list(by.day).sort((a, b) => a.key.localeCompare(b.key)), byApp: list(by.app), byEdition: list(by.edition), byMethod: list(by.method),
      // Active paid subscriptions as a month, without VAT (prices include VAT).
      mrrPaisa: Math.round((mrrGross * 100) / (100 + vat)),
      trialsStarted: ev[0]?.started ?? 0, trialsConverted: ev[0]?.converted ?? 0, lapsed: ev[0]?.lapsed ?? 0,
    };
    if (q.format === "csv") {
      const head = ["Day (Nepal)", "Sales", "Refunds", "VAT", "Net", "Commission", "Partner share", "Sheetal net", "Publisher", "New", "Renewals", "Upgrades", "Sales count"];
      const line = (k: string, t: Totals) => [k, rs(t.grossPaisa), rs(t.refundsPaisa), rs(t.vatPaisa), rs(t.netPaisa), rs(t.commissionPaisa), rs(t.partnerPaisa), rs(t.sheetalNetPaisa), rs(t.publisherPaisa), rs(t.newSalesPaisa), rs(t.renewalsPaisa), rs(t.upgradesPaisa), t.count].map(cell).join(",");
      return exportable(s, reply, request.ip, `revenue ${r.fromDay} to ${r.toDay}`, `sheetal-app-revenue-${r.fromDay}-to-${r.toDay}.csv`, [head.join(","), ...report.byDay.map((d) => line(d.key, d.totals)), line("Total", totals)]);
    }
    return { data: report };
  });

  // ───── VAT summary, tax invoices, IRD, shadow ─────
  app.get("/admin/billing/vat", async (request, reply) => {
    const s = staffOf(request, "platform.billing.read");
    const q = z.object(RangeQ).strict().parse(request.query);
    const r = rangeOf({ ...q, range: q.range });
    const { from, to } = bounds(r);
    const rows = await db().$queryRawUnsafe<{ month: string; kind: string; n: number; taxable: string; vat: string; total: string }[]>(
      `SELECT to_char((issued_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kathmandu', 'YYYY-MM') AS month, kind, COUNT(*)::int AS n,
              SUM(subtotal_paisa)::text AS taxable, SUM(vat_paisa)::text AS vat, SUM(total_paisa)::text AS total
       FROM invoices WHERE no IS NOT NULL AND kind IN ('subscription', 'credit') AND issued_at >= $1 AND issued_at < $2 GROUP BY 1, 2 ORDER BY 1, 2`, from, to);
    const months = new Map<string, { month: string; invoices: number; taxablePaisa: number; vatPaisa: number; totalPaisa: number; creditNotes: number; creditTaxablePaisa: number; creditVatPaisa: number; creditTotalPaisa: number }>();
    for (const x of rows) {
      let m = months.get(x.month);
      if (!m) { m = { month: x.month, invoices: 0, taxablePaisa: 0, vatPaisa: 0, totalPaisa: 0, creditNotes: 0, creditTaxablePaisa: 0, creditVatPaisa: 0, creditTotalPaisa: 0 }; months.set(x.month, m); }
      if (x.kind === "credit") { m.creditNotes += x.n; m.creditTaxablePaisa += Number(x.taxable); m.creditVatPaisa += Number(x.vat); m.creditTotalPaisa += Number(x.total); }
      else { m.invoices += x.n; m.taxablePaisa += Number(x.taxable); m.vatPaisa += Number(x.vat); m.totalPaisa += Number(x.total); }
    }
    const data = [...months.values()].map((m) => ({ ...m, netVatPaisa: m.vatPaisa + m.creditVatPaisa }));
    if (q.format === "csv") {
      const lines = [["Month (Nepal)", "Tax invoices", "Taxable", "VAT", "Total", "Credit notes", "Credit taxable", "Credit VAT", "Credit total", "VAT after credits"].join(",")];
      for (const m of data) lines.push([m.month, m.invoices, rs(m.taxablePaisa), rs(m.vatPaisa), rs(m.totalPaisa), m.creditNotes, rs(m.creditTaxablePaisa), rs(m.creditVatPaisa), rs(m.creditTotalPaisa), rs(m.netVatPaisa)].map(cell).join(","));
      return exportable(s, reply, request.ip, `VAT ${r.fromDay} to ${r.toDay}`, `sheetal-vat-${r.fromDay}-to-${r.toDay}.csv`, lines);
    }
    return { data, from: r.fromDay, to: r.toDay };
  });

  app.get("/admin/billing/tax-invoices", async (request) => {
    staffOf(request, "platform.billing.read");
    const q = z.object({ ...RangeQ, kind: z.enum(["all", "subscription", "credit"]).default("all"), page: z.coerce.number().int().min(1).default(1) }).strict().parse(request.query);
    const r = rangeOf(q);
    const { from, to } = bounds(r);
    const where: Prisma.InvoiceWhereInput = { no: { not: null }, kind: q.kind === "all" ? { in: ["subscription", "credit"] } : q.kind, issuedAt: { gte: from, lt: to } };
    const per = 100;
    const [total, rows] = await Promise.all([db().invoice.count({ where }), db().invoice.findMany({ where, orderBy: [{ issuedAt: "desc" }, { no: "desc" }], skip: (q.page - 1) * per, take: per })]);
    const T = new Map((await db().tenant.findMany({ where: { id: { in: [...new Set(rows.map((i) => i.tenantId))] } }, select: { id: true, name: true } })).map((t) => [t.id, t.name]));
    const originals = new Map((await db().invoice.findMany({ where: { id: { in: rows.map((i) => i.creditForId).filter((x): x is string => !!x) } }, select: { id: true, no: true, fy: true, kind: true } })).map((i) => [i.id, i.no && i.fy ? taxNumber(i.fy, i.no, i.kind) : null]));
    return {
      data: rows.map((i) => ({
        id: i.id, number: taxNumber(i.fy!, i.no!, i.kind), kind: i.kind, tenantId: i.tenantId, business: T.get(i.tenantId) ?? null, issuedAt: i.issuedAt,
        creditFor: i.creditForId ? originals.get(i.creditForId) ?? null : null, subtotalPaisa: Number(i.subtotalPaisa ?? 0), vatPaisa: Number(i.vatPaisa ?? 0), totalPaisa: Number(i.totalPaisa ?? 0),
      })),
      from: r.fromDay, to: r.toDay, meta: { total, current_page: q.page, last_page: Math.max(1, Math.ceil(total / per)), per_page: per },
    };
  });

  app.get("/admin/billing/ird", async (request) => {
    staffOf(request, "platform.billing.read");
    const where: Prisma.InvoiceWhereInput = { no: { not: null }, kind: { in: ["subscription", "credit"] } };
    const [count, rows] = await Promise.all([db().invoice.count({ where }), db().invoice.findMany({ where, orderBy: { issuedAt: "desc" }, take: 200, select: { id: true, no: true, fy: true, kind: true, issuedAt: true, totalPaisa: true, tenantId: true } })]);
    return {
      // The IRD (CBMS) link is not built yet (MB 9.4, Owner to confirm): every issued tax invoice is "not sent". Nothing is ever blocked by it.
      linked: false, count,
      data: rows.map((i) => ({ id: i.id, number: taxNumber(i.fy!, i.no!, i.kind), kind: i.kind, issuedAt: i.issuedAt, totalPaisa: Number(i.totalPaisa ?? 0), tenantId: i.tenantId })),
    };
  });

  app.get("/admin/billing/shadow", async (request) => {
    staffOf(request, "platform.billing.read");
    const q = z.object({ days: z.coerce.number().int().min(1).max(90).default(7) }).strict().parse(request.query);
    const since = new Date(Date.now() - q.days * 864e5);
    const rows = await db().auditLog.findMany({ where: { action: "billing.shadow_diff", createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 5000, select: { tenantId: true, target: true, createdAt: true } });
    const latest = new Map<string, { tenantId: string; at: Date; less: number; more: number; reports: number }>();
    let lessReports = 0;
    for (const x of rows) {
      const m = /^(\d+) less, (\d+) more$/.exec(x.target ?? "");
      const less = m ? Number(m[1]) : 0, more = m ? Number(m[2]) : 0;
      if (less > 0) lessReports++;
      if (!x.tenantId) continue;
      const have = latest.get(x.tenantId);
      if (have) { have.reports++; continue; }
      latest.set(x.tenantId, { tenantId: x.tenantId, at: x.createdAt, less, more, reports: 1 });
    }
    const T = new Map((await db().tenant.findMany({ where: { id: { in: [...latest.keys()] } }, select: { id: true, name: true, billingMode: true } })).map((t) => [t.id, t]));
    const list = [...latest.values()].map((x) => ({ ...x, business: T.get(x.tenantId)?.name ?? null, mode: T.get(x.tenantId)?.billingMode ?? null })).sort((a, b) => b.less - a.less || +b.at - +a.at);
    return { data: { days: q.days, reports: rows.length, lessReports, businesses: list.length, businessesWithLess: list.filter((x) => x.less > 0).length, latest: list } };
  });
}
