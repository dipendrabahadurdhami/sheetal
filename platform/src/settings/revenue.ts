// The revenue report: what Sheetal earned in a range of Nepal days, with the same-length period before it (SETTINGS.md section 7).
// Where it fits: routes.ts serves it at GET /admin/reports/revenue for staff with platform.revenue.read; the admin Revenue screen draws it.
// How it works: rangeOf() turns "today / 7d / 30d / custom" into Nepal-day boundaries (Nepal is UTC+05:45, no summer time). Two sources are summed in the
// database: paid subscription invoices (by the moment they were paid) and the payments Sheetal collected for businesses with the commission that was
// RECORDED on each (payout items, by their collection day). A change of the commission setting never changes these recorded amounts.
// Rules: amounts in the tables are whole rupees; the report gives paisa (x100) so every screen formats money the same way. The technology partner's part is
// not recorded per payment yet, so it is worked out from the recorded commission with the current rule, from its start date on, and the answer says so
// ("partnerBasis"). Totals always equal the sum of the rows.

import type { Db } from "../db/client.js";
import { badRequest } from "../core/errors.js";
import { partnerShareOf, type RevenueShare } from "./revenue-share.js";

const NEPAL_MS = (5 * 60 + 45) * 60_000;
const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");
/** The Nepal calendar day ("2026-11-12") of a moment. */
export function nepalDay(at: Date): string { const d = new Date(at.getTime() + NEPAL_MS); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
/** The moment a Nepal day starts, in UTC. */
export function nepalDayStart(day: string): Date { return new Date(Date.parse(`${day}T00:00:00.000Z`) - NEPAL_MS); }
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00.000Z`) + n * DAY_MS).toISOString().slice(0, 10);

export interface RevenueQuery { range: "today" | "7d" | "30d" | "custom"; from?: string; to?: string }
export interface Range { fromDay: string; toDay: string; days: number; prevFromDay: string; prevToDay: string }

/** The Nepal days of a range (both ends included) and of the same-length period just before it. */
export function rangeOf(q: RevenueQuery, now: Date = new Date()): Range {
  const today = nepalDay(now);
  let fromDay = today; let toDay = today;
  if (q.range === "7d") fromDay = addDays(today, -6);
  else if (q.range === "30d") fromDay = addDays(today, -29);
  else if (q.range === "custom") {
    const ok = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
    if (!ok(q.from) || !ok(q.to)) throw badRequest("Choose a start date and an end date.");
    if (q.from! > q.to!) throw badRequest("The start date must not be after the end date.");
    fromDay = q.from!; toDay = q.to!;
  }
  const days = Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / DAY_MS) + 1;
  if (days > 366) throw badRequest("Choose a range of at most 366 days.");
  return { fromDay, toDay, days, prevFromDay: addDays(fromDay, -days), prevToDay: addDays(fromDay, -1) };
}

export interface Totals { grossPaisa: number; subscriptionPaisa: number; commissionPaisa: number; partnerSharePaisa: number; netPaisa: number; refundsPaisa: number; count: number }
const ZERO: Totals = { grossPaisa: 0, subscriptionPaisa: 0, commissionPaisa: 0, partnerSharePaisa: 0, netPaisa: 0, refundsPaisa: 0, count: 0 };
const add = (a: Totals, b: Totals): Totals => ({
  grossPaisa: a.grossPaisa + b.grossPaisa, subscriptionPaisa: a.subscriptionPaisa + b.subscriptionPaisa, commissionPaisa: a.commissionPaisa + b.commissionPaisa,
  partnerSharePaisa: a.partnerSharePaisa + b.partnerSharePaisa, netPaisa: a.netPaisa + b.netPaisa, refundsPaisa: a.refundsPaisa + b.refundsPaisa, count: a.count + b.count,
});
/** % change against the previous period; null when there was nothing before (no "infinite growth"). */
export const changePct = (now: number, before: number): number | null => (before === 0 ? null : Math.round(((now - before) / Math.abs(before)) * 1000) / 10);

async function byDay(db: Db, fromDay: string, toDay: string, share: RevenueShare): Promise<Map<string, Totals>> {
  const from = nepalDayStart(fromDay); const to = nepalDayStart(addDays(toDay, 1));
  const out = new Map<string, Totals>();
  const at = (day: string) => { let t = out.get(day); if (!t) { t = { ...ZERO }; out.set(day, t); } return t; };
  // Paid subscription invoices, grouped by the Nepal day they were paid on. Summed in the database.
  const invoices = await db.$queryRawUnsafe<{ day: string; total: number; n: number }[]>(
    `SELECT to_char((paid_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kathmandu', 'YYYY-MM-DD') AS day, COALESCE(SUM(total), 0)::int AS total, COUNT(*)::int AS n
     FROM invoices WHERE status = 'paid' AND paid_at >= $1 AND paid_at < $2 GROUP BY 1`, from, to);
  for (const r of invoices) { const t = at(r.day); t.subscriptionPaisa += r.total * 100; t.count += r.n; }
  // Payments Sheetal collected for businesses, with the commission recorded on each. collected_on is already a Nepal calendar day.
  const items = await db.$queryRawUnsafe<{ day: string; gross: number; refunds: number; fee: number; n: number }[]>(
    `SELECT to_char(collected_on, 'YYYY-MM-DD') AS day, COALESCE(SUM(gross) FILTER (WHERE gross > 0), 0)::int AS gross, COALESCE(-SUM(gross) FILTER (WHERE gross < 0), 0)::int AS refunds,
            COALESCE(SUM(fee), 0)::int AS fee, (COUNT(*) FILTER (WHERE gross > 0))::int AS n
     FROM payout_items WHERE collected_on >= $1::date AND collected_on <= $2::date GROUP BY 1`, fromDay, toDay);
  for (const r of items) {
    const t = at(r.day);
    t.grossPaisa += r.gross * 100; t.refundsPaisa += r.refunds * 100; t.commissionPaisa += r.fee * 100; t.count += r.n;
    t.partnerSharePaisa += partnerShareOf({ ...share, technologyPartner: { ...share.technologyPartner, appliesTo: "all" } }, { commissionPaisa: r.fee * 100, day: r.day });
  }
  for (const t of out.values()) t.netPaisa = t.subscriptionPaisa + t.commissionPaisa - t.partnerSharePaisa;
  return out;
}

export async function revenueReport(db: Db, q: RevenueQuery, share: RevenueShare, now: Date = new Date()) {
  const r = rangeOf(q, now);
  const [cur, prev] = await Promise.all([byDay(db, r.fromDay, r.toDay, share), byDay(db, r.prevFromDay, r.prevToDay, share)]);
  const rows: { key: string; totals: Totals }[] = [];
  for (let i = 0; i < r.days; i++) { const day = addDays(r.fromDay, i); rows.push({ key: day, totals: cur.get(day) ?? { ...ZERO } }); }
  const totals = rows.reduce((a, x) => add(a, x.totals), { ...ZERO });
  const previous = [...prev.values()].reduce((a, x) => add(a, x), { ...ZERO });
  const change = Object.fromEntries((Object.keys(ZERO) as (keyof Totals)[]).map((k) => [k, changePct(totals[k], previous[k])])) as Record<keyof Totals, number | null>;
  return {
    from: r.fromDay, to: r.toDay, days: r.days, previousFrom: r.prevFromDay, previousTo: r.prevToDay, totals, previous, changePct: change, rows,
    partnerBasis: share.technologyPartner.enabled ? `Worked out from the recorded commission at ${share.technologyPartner.sharePct}% from ${share.effectiveFrom}.` : "The technology partner split is switched off.",
  };
}

const csvCell = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"` : s; };
/** The report as CSV (rupees with two decimals). Cells are made safe for spreadsheet programs. */
export function revenueCsv(report: Awaited<ReturnType<typeof revenueReport>>): string {
  const rs = (p: number) => (p / 100).toFixed(2);
  const head = ["Day (Nepal)", "Collected for businesses", "Refunds", "Subscriptions", "Commission", "Partner share", "Net to Sheetal", "Payments"];
  const line = (key: string, t: Totals) => [key, rs(t.grossPaisa), rs(t.refundsPaisa), rs(t.subscriptionPaisa), rs(t.commissionPaisa), rs(t.partnerSharePaisa), rs(t.netPaisa), t.count].map(csvCell).join(",");
  return [head.join(","), ...report.rows.map((r) => line(r.key, r.totals)), line("Total", report.totals)].join("\n") + "\n";
}
