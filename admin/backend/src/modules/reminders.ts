// Admin → Messages → Expiry: reminders for plans, listings, boosts and banners that are about to run out.
// Where it fits: the Expiry tab of the Messages page; the daily job (startReminderJob) sends them.
// How it works: GET shows the settings, what will be sent in the next 7 days and the last sends; PUT changes the
// settings; "Send now" runs today's reminders at once. The job runs every hour but only sends after 9 am Nepal time,
// and ReminderLog makes sure nothing goes out twice.
// Rules: settings.platform; every change is audited; this job and the billing cycle never both send the same day's plan reminder.

import type { FastifyInstance } from "fastify";
import { startJobs, type JobSpec } from "@sheetal/platform/jobs/registry";
import { z } from "zod";
import { dbOf } from "@sheetal/platform/db/client";
import { planReminders, recentReminders, reminderSettings, runReminders, saveReminderSettings, type ReminderSettings } from "@sheetal/backend-core/domain/reminders";
import { staffOf } from "./routes.js";

const body = z.strictObject({
  plan: z.strictObject({ on: z.boolean(), days: z.array(z.number().int().min(1).max(60)).min(1, "Pick at least one day.").max(5, "Up to 5 days.") }).partial(),
  listings: z.strictObject({ on: z.boolean(), staleDays: z.number().int().min(14, "At least 14 days.").max(730) }).partial(),
  boosts: z.strictObject({ on: z.boolean() }).partial(), banners: z.strictObject({ on: z.boolean() }).partial(),
}).partial();

const flat = (s: object, p = ""): Record<string, unknown> => Object.entries(s).reduce<Record<string, unknown>>((o, [k, v]) => (v && typeof v === "object" && !Array.isArray(v) ? { ...o, ...flat(v, `${p}${k}.`) } : { ...o, [`${p}${k}`]: v }), {});

export async function adminReminderRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);

  app.get("/admin/reminders", async (request) => {
    staffOf(request, "platform.settings.read+platform.settings.update");
    const [settings, upcoming, recent] = await Promise.all([reminderSettings(db()), planReminders(db()), recentReminders(db())]);
    return { data: { settings, upcoming: upcoming.map(({ kind, business, what, sendOn }) => ({ kind, business, what, sendOn })), recent } };
  });

  app.put("/admin/reminders", async (request) => {
    const s = staffOf(request, "platform.settings.read+platform.settings.update");
    const b = body.parse(request.body);
    const cur = await reminderSettings(db());
    const next: ReminderSettings = { plan: { ...cur.plan, ...b.plan }, listings: { ...cur.listings, ...b.listings }, boosts: { ...cur.boosts, ...b.boosts }, banners: { ...cur.banners, ...b.banners } };
    next.plan.days = [...new Set(next.plan.days)].sort((x, y) => y - x);
    const before = flat(cur), after = flat(next);
    const changed = Object.keys(after).filter((k) => String(before[k]) !== String(after[k]));
    if (!changed.length) return { message: "Nothing changed.", data: next };
    await saveReminderSettings(db(), next);
    for (const k of changed) await db().auditLog.create({ data: { actorId: s.user.id, action: "reminders.settings", target: `${k}: ${String(before[k])} → ${String(after[k])}`, ip: request.ip } });
    return { message: "Saved.", data: next };
  });

  app.post("/admin/reminders/run", async (request) => {
    const s = staffOf(request, "platform.settings.read+platform.settings.update");
    const out = await runReminders(db(), app.mailer, { siteUrl: app.config.SITE_URL });
    await db().auditLog.create({ data: { actorId: s.user.id, action: "reminders.run", target: `plans ${out.plan}, listings ${out.listings}, boosts ${out.boosts}, banners ${out.banners}`, ip: request.ip } });
    const total = out.plan + out.listings + out.boosts + out.banners;
    return { message: total ? `Sent ${total} reminder${total > 1 ? "s" : ""}.` : "Nothing is due today.", data: out };
  });
}

/** Checks every hour and sends today's reminders after 9 am Nepal time (in this process only, like the billing cycle). */
export const reminderJob = (app: FastifyInstance): JobSpec => ({
  id: "reminders.expiry", everyMs: 3600_000, firstRunMs: 120_000, failMessage: "expiry reminders failed",
  run: async () => {
    if (new Date(Date.now() + 5.75 * 3_600_000).getUTCHours() < 9) return;
    const out = await runReminders(dbOf(app), app.mailer, { siteUrl: app.config.SITE_URL });
    if (out.plan + out.listings + out.boosts + out.banners) app.log.info(out, "expiry reminders");
  },
});
/** The old entry point, kept as a shim over the jobs registry (it starts the job on its own, as before). */
export function startReminderJob(app: FastifyInstance) { startJobs(app, [reminderJob(app)], { enabled: true }); }
