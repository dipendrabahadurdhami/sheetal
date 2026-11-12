// Expiry reminders: plans that renew soon, listings nobody has updated, boosts and banners that end tomorrow.
// Where it fits: a daily job in the admin API (startReminderJob) calls runReminders(); Admin → Messages → Expiry shows
// upcomingReminders() and the last sends. Settings are AppSetting "reminders".
// How it works: each reminder goes to the business owner (bell + email, wording from domain/templates.ts) and is logged in
// ReminderLog (kind + refId), so a second run the same day, or a restart, sends nothing twice.
// Rules: dates are Nepal days. Listings never expire here, so "stale" means not updated for staleDays. Billing already
// sends its own renewal reminders on its reminder days; this job skips those days so nobody gets two emails.

import type { Prisma } from "@prisma/client";
import type { Db } from "@sheetal/platform/db/client";
import type { Mailer } from "../lib/mailer.js";
import { notify } from "@sheetal/platform/notify/index";
import { billingSettings, ownerOf } from "./billing.js";
import { dayOf, ymd } from "./money.js";
import { nepalDay } from "./payouts.js";
import { builtIn } from "./templates.js";

export interface ReminderSettings {
  plan: { on: boolean; days: number[] }; listings: { on: boolean; staleDays: number }; boosts: { on: boolean }; banners: { on: boolean };
}
export const REMINDER_DEFAULTS: ReminderSettings = { plan: { on: true, days: [7, 3, 1] }, listings: { on: true, staleDays: 90 }, boosts: { on: true }, banners: { on: true } };

export async function reminderSettings(db: Db): Promise<ReminderSettings> {
  const s = ((await db.appSetting.findUnique({ where: { key: "reminders" } }))?.value ?? {}) as Partial<{ [K in keyof ReminderSettings]: Partial<ReminderSettings[K]> }>;
  return { plan: { ...REMINDER_DEFAULTS.plan, ...s.plan }, listings: { ...REMINDER_DEFAULTS.listings, ...s.listings }, boosts: { ...REMINDER_DEFAULTS.boosts, ...s.boosts }, banners: { ...REMINDER_DEFAULTS.banners, ...s.banners } };
}
export async function saveReminderSettings(db: Db, v: ReminderSettings) {
  const value = v as unknown as Prisma.InputJsonValue;
  await db.appSetting.upsert({ where: { key: "reminders" }, create: { key: "reminders", value }, update: { value } });
}

const plusDays = (day: string, n: number) => { const d = new Date(dayOf(day).getTime() + n * 864e5); return Number.isNaN(d.getTime()) ? null : ymd(d); };
const between = (a: string, b: string) => Math.round((dayOf(b).getTime() - dayOf(a).getTime()) / 864e5);
const dayText = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export interface Planned { kind: string; refId: string; tenantId: string; business: string; what: string; sendOn: string; detail: Record<string, unknown> }

/** Every reminder that is due today or in the next `ahead` days, and not sent yet. */
export async function planReminders(db: Db, now = new Date(), ahead = 7): Promise<Planned[]> {
  const today = nepalDay(now);
  if (!today || Number.isNaN(dayOf(today).getTime())) return [];
  const last = plusDays(today, ahead)!;
  const [set, bill] = await Promise.all([reminderSettings(db), billingSettings(db)]);
  const out: Planned[] = [];
  const sent = async (kind: string, refId: string) => !!(await db.reminderLog.findUnique({ where: { kind_refId: { kind, refId } } }));

  if (set.plan.on) {
    const days = [...new Set(set.plan.days)].filter((d) => d > 0).sort((a, b) => a - b);
    const tenants = await db.tenant.findMany({ where: { renewsAt: { not: null }, autoRenew: false, status: { in: ["active", "trial"] }, plan: { price: { gt: 0 } } }, select: { id: true, name: true, renewsAt: true, plan: { select: { name: true } } } });
    for (const t of tenants) {
      const renewDay = ymd(t.renewsAt!);
      const left = between(today, renewDay);
      if (left < 0) continue;
      // The same pick billing makes: the smallest reminder day that is still ahead of us.
      const due = days.find((d) => left <= d);
      for (const d of days) {
        if (bill.reminderDays.includes(d)) continue; // billing sends this one itself
        const sendOn = plusDays(renewDay, -d)!;
        const now_ = d === due; // still ahead of us and the closest one: send today
        const soon = d < left && sendOn <= last; // later days inside the window: only listed
        if (!now_ && !soon) continue;
        const refId = `${t.id}:${renewDay}`, kind = `plan_renewal_${d}`;
        if (await sent(kind, refId)) continue;
        out.push({ kind, refId, tenantId: t.id, business: t.name, what: `${t.plan.name} renews on ${dayText(renewDay)} (reminder ${d} day${d > 1 ? "s" : ""} before)`, sendOn: now_ ? today : sendOn, detail: { plan: t.plan.name, renewDay, left: now_ ? left : d } });
      }
    }
  }

  if (set.listings.on) {
    const cutoff = new Date(now.getTime() - (set.listings.staleDays - ahead) * 864e5);
    const rows = await db.listing.findMany({ where: { tenantId: { not: null }, status: "published", updatedAt: { lte: cutoff } }, select: { id: true, title: true, tenantId: true, updatedAt: true }, orderBy: { updatedAt: "asc" }, take: 2000 });
    const names = new Map((await db.tenant.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.tenantId!))] } }, select: { id: true, name: true } })).map((t) => [t.id, t.name]));
    for (const l of rows) {
      const stale = plusDays(ymd(l.updatedAt), set.listings.staleDays);
      if (!stale || stale > last) continue;
      const refId = `${l.id}:${ymd(l.updatedAt)}`;
      if (await sent("listing_stale", refId)) continue;
      out.push({ kind: "listing_stale", refId, tenantId: l.tenantId!, business: names.get(l.tenantId!) ?? "", what: `“${l.title}” not updated for ${set.listings.staleDays} days`, sendOn: stale < today ? today : stale, detail: { listingId: l.id, title: l.title } });
    }
  }

  for (const [kind, on, rows] of [
    ["boost_ending", set.boosts.on, set.boosts.on ? await db.boost.findMany({ where: { status: "paid", endOn: { gte: dayOf(today) } }, select: { id: true, tenantId: true, endOn: true, place: true, listingId: true } }) : []],
    ["banner_ending", set.banners.on, set.banners.on ? await db.banner.findMany({ where: { status: "approved", tenantId: { not: null }, endOn: { gte: dayOf(today) } }, select: { id: true, tenantId: true, endOn: true, title: true } }) : []],
  ] as const) {
    if (!on) continue;
    const names = new Map((await db.tenant.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.tenantId!))] } }, select: { id: true, name: true } })).map((t) => [t.id, t.name]));
    for (const r of rows) {
      const sendOn = plusDays(ymd(r.endOn), -1);
      if (!sendOn || sendOn > last || (await sent(kind, r.id))) continue;
      const label = "title" in r ? r.title || "Home page banner" : `Boost on ${r.place}`;
      out.push({ kind, refId: r.id, tenantId: r.tenantId!, business: names.get(r.tenantId!) ?? "", what: `${label} ends on ${dayText(ymd(r.endOn))}`, sendOn: sendOn < today ? today : sendOn, detail: { endOn: ymd(r.endOn), label, listingId: "listingId" in r ? r.listingId : undefined } });
    }
  }
  return out.sort((a, b) => a.sendOn.localeCompare(b.sendOn) || a.business.localeCompare(b.business));
}

/** Sends everything due today (not later days) and logs it. Safe to run twice. */
export async function runReminders(db: Db, mailer: Mailer, o: { siteUrl: string; now?: Date }) {
  const now = o.now ?? new Date();
  const today = nepalDay(now);
  const site = o.siteUrl.replace(/\/$/, "");
  const due = (await planReminders(db, now, 0)).filter((p) => p.sendOn <= today);
  const out = { plan: 0, listings: 0, boosts: 0, banners: 0 };

  const tell = async (tenantId: string, key: string, vars: Record<string, string>, title: string, link: string) => {
    const owner = await ownerOf(db, tenantId);
    const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { name: true, email: true } });
    const to = owner?.email ?? tenant?.email;
    const v = { name: owner?.userName ?? tenant?.name ?? "", business: tenant?.name ?? "", link: `${site}${link}`, site, ...vars };
    if (to) { const m = builtIn(key, v); await mailer.send({ to, subject: m.subject, text: m.text, template: { key, vars: v } }); }
    await notify(db, [owner?.id], { tenantId, type: "reminder", title, link });
  };
  const log = (p: Planned) => db.reminderLog.create({ data: { kind: p.kind, refId: p.refId, tenantId: p.tenantId, day: today } });

  for (const p of due.filter((x) => x.kind.startsWith("plan_renewal_"))) {
    const d = Number(p.kind.split("_").pop()); const left = Number(p.detail.left);
    await tell(p.tenantId, "reminder_plan", { plan: String(p.detail.plan), in: `${left} day${left === 1 ? "" : "s"}`, until: dayText(String(p.detail.renewDay)) }, `${p.detail.plan} renews in ${left} day${left === 1 ? "" : "s"}`, "/business/billing");
    await log(p); out.plan++; void d;
  }
  // One message per business for stale listings, but every listing is logged.
  const byTenant = new Map<string, Planned[]>();
  for (const p of due.filter((x) => x.kind === "listing_stale")) byTenant.set(p.tenantId, [...(byTenant.get(p.tenantId) ?? []), p]);
  const set = await reminderSettings(db);
  for (const [tenantId, list] of byTenant) {
    const shown = list.slice(0, 10).map((p) => `• ${String(p.detail.title)}`).join("\n") + (list.length > 10 ? `\n…and ${list.length - 10} more` : "");
    await tell(tenantId, "reminder_listings", { count: String(list.length), days: String(set.listings.staleDays), list: shown }, `${list.length} listing${list.length > 1 ? "s" : ""} need a look`, "/business/listings");
    for (const p of list) await log(p);
    out.listings += list.length;
  }
  for (const p of due.filter((x) => x.kind === "boost_ending")) {
    await tell(p.tenantId, "reminder_boost", { list: String(p.detail.label), date: dayText(String(p.detail.endOn)) }, "Your boost ends tomorrow", "/business/promote");
    await log(p); out.boosts++;
  }
  for (const p of due.filter((x) => x.kind === "banner_ending")) {
    await tell(p.tenantId, "reminder_banner", { list: String(p.detail.label), date: dayText(String(p.detail.endOn)) }, "Your banner ends tomorrow", "/business/promote/banner");
    await log(p); out.banners++;
  }
  return out;
}

/** The last reminders that went out. */
export async function recentReminders(db: Db, limit = 30) {
  const rows = await db.reminderLog.findMany({ orderBy: { createdAt: "desc" }, take: limit });
  const names = new Map((await db.tenant.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.tenantId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } })).map((t) => [t.id, t.name]));
  return rows.map((r) => ({ id: r.id, kind: r.kind, business: r.tenantId ? names.get(r.tenantId) ?? "" : "", day: r.day, at: r.createdAt.toISOString() }));
}
