import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { dbOf } from "@sheetal/backend-core/lib/db";
import { badRequest } from "@sheetal/backend-core/lib/errors";
import { Vault } from "@sheetal/backend-core/lib/vault";
import { AI_CREDITS, DEFAULT_MODEL, type AiSettings } from "@sheetal/backend-core/lib/ai";
import { syncOtaFeed } from "@sheetal/backend-core/domain/ota";
import { staffOf } from "./routes.js";

// For Sheetal staff: site analytics (people, not bots), the system status page, and the settings for AI
// (Claude key, model, monthly credits per plan) and Meta (the app secret and webhook verify token). Keys are
// write-only. Also the job that syncs every business's calendar feeds with other sites.

export async function adminInsightRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const vault = new Vault(app.config.SECRETS_KEY, app.config.NODE_ENV === "production");
  const audit = (actorId: string, ip: string, action: string, target: string) => db().auditLog.create({ data: { actorId, action, target, ip } });

  app.get("/admin/analytics", async (request) => {
    staffOf(request, "dashboard.view");
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }).parse(request.query);
    const since = new Date(Date.now() - days * 864e5);
    const prev = new Date(since.getTime() - days * 864e5);
    // The current period has no upper limit: visits are stamped by the database clock, which may run a little ahead.
    const visitors = (from: Date, to?: Date) => db().pageView.groupBy({ by: ["session"], where: { createdAt: { gte: from, ...(to ? { lt: to } : {}) } } }).then((r) => r.length);
    const [now, before, views, signups, enquiries, byDay, topListings, topPages, referrers, bots] = await Promise.all([
      visitors(since), visitors(prev, since), db().pageView.count({ where: { createdAt: { gte: since } } }),
      db().user.count({ where: { createdAt: { gte: since } } }), db().lead.count({ where: { createdAt: { gte: since } } }),
      db().$queryRaw<{ day: string; views: number; visitors: number }[]>`SELECT to_char(created_at AT TIME ZONE 'Asia/Kathmandu', 'YYYY-MM-DD') AS day, count(*)::int AS views, count(DISTINCT session)::int AS visitors FROM page_views WHERE created_at >= ${since} GROUP BY 1 ORDER BY 1`,
      db().pageView.groupBy({ by: ["listingId"], where: { createdAt: { gte: since }, listingId: { not: null } }, _count: true, orderBy: { _count: { listingId: "desc" } }, take: 10 }),
      db().pageView.groupBy({ by: ["path"], where: { createdAt: { gte: since } }, _count: true, orderBy: { _count: { path: "desc" } }, take: 10 }),
      db().pageView.groupBy({ by: ["referrer"], where: { createdAt: { gte: since }, referrer: { not: null } }, _count: true, orderBy: { _count: { referrer: "desc" } }, take: 10 }),
      db().botDay.groupBy({ by: ["kind"], where: { day: { gte: since.toISOString().slice(0, 10) } }, _sum: { count: true } }),
    ]);
    const titles = new Map((await db().listing.findMany({ where: { id: { in: topListings.map((t) => t.listingId!) } }, select: { id: true, code: true, title: true } })).map((l) => [l.id, l]));
    return {
      data: {
        days, visitors: now, visitorsBefore: before, views, signups, enquiries, byDay,
        topListings: topListings.map((t) => ({ ...titles.get(t.listingId!), views: t._count })), topPages: topPages.map((p) => ({ path: p.path, views: p._count })),
        referrers: referrers.map((r) => ({ site: r.referrer, views: r._count })), bots: Object.fromEntries(bots.map((b) => [b.kind, b._sum.count ?? 0])),
      },
    };
  });

  /** Health of each part, for the super admin. Nothing here reveals a secret. */
  app.get("/admin/system/status", async (request) => {
    staffOf(request, "settings.platform");
    const t0 = Date.now();
    const dbOk = await db().$queryRaw`SELECT 1`.then(() => true).catch(() => false);
    const dbMs = Date.now() - t0;
    const day = new Date(Date.now() - 864e5);
    const [queued, failedMail, deliveries, ai, aiSet, meta, feeds, feedErrors, bots, lastCycle] = await Promise.all([
      db().outboundEmail.count({ where: { status: "queued" } }), db().outboundEmail.count({ where: { status: "failed", createdAt: { gte: day } } }),
      db().mailDelivery.count({ where: { status: { in: ["queued", "retry"] } } }).catch(() => 0),
      db().aiUsage.aggregate({ where: { createdAt: { gte: day } }, _count: true, _sum: { inputTok: true, outputTok: true } }),
      db().appSetting.findUnique({ where: { key: "ai" } }), db().appSetting.findUnique({ where: { key: "meta" } }),
      db().otaFeed.count(), db().otaFeed.count({ where: { lastError: { not: null } } }),
      db().botDay.findMany({ where: { day: new Date().toISOString().slice(0, 10) } }),
      db().auditLog.findFirst({ where: { action: { in: ["billing.past_due", "billing.moved_to_starter", "billing.cycle_run"] } }, orderBy: { createdAt: "desc" } }),
    ]);
    const aiKey = !!(aiSet?.value as AiSettings | undefined)?.apiKey || !!process.env.ANTHROPIC_API_KEY;
    return {
      data: {
        api: { ok: true, uptimeSeconds: Math.round(process.uptime()), memoryMb: Math.round(process.memoryUsage().rss / 1048576), node: process.version },
        database: { ok: dbOk, ms: dbMs },
        cache: { kind: app.config.REDIS_URL ? "redis" : "memory" },
        email: { queued, failedToday: failedMail, mailServerQueue: deliveries },
        ai: { configured: aiKey, requestsToday: ai._count, tokensToday: (ai._sum.inputTok ?? 0) + (ai._sum.outputTok ?? 0) },
        meta: { configured: !!(meta?.value as { appSecret?: string } | undefined)?.appSecret },
        calendars: { feeds, withErrors: feedErrors },
        bots: Object.fromEntries(bots.map((b) => [b.kind, b.count])),
        storage: { media: !!app.config.MEDIA_DIR },
        billingCycle: { lastActivity: lastCycle?.createdAt ?? null },
      },
    };
  });

  app.get("/admin/settings/ai", async (request) => {
    staffOf(request, "settings.platform");
    const s = ((await db().appSetting.findUnique({ where: { key: "ai" } }))?.value ?? {}) as AiSettings;
    return { data: { enabled: s.enabled !== false, model: s.model || DEFAULT_MODEL, credits: { ...AI_CREDITS, ...(s.credits ?? {}) }, hasKey: !!s.apiKey, envKey: !!process.env.ANTHROPIC_API_KEY } };
  });
  app.put("/admin/settings/ai", async (request) => {
    const s = staffOf(request, "settings.platform");
    if (s.role !== "super_admin") throw badRequest("Only the super admin can change AI keys.");
    const b = z.object({
      enabled: z.boolean(), model: z.string().trim().regex(/^claude-[a-z0-9-]+$/, "Use a Claude model id, like claude-opus-5-5.").max(60),
      apiKey: z.string().trim().min(20).max(300).optional(), credits: z.record(z.string(), z.number().int().min(-1).max(10_000_000)).optional(),
    }).parse(request.body);
    const cur = ((await db().appSetting.findUnique({ where: { key: "ai" } }))?.value ?? {}) as AiSettings;
    const next: AiSettings = { enabled: b.enabled, model: b.model, apiKey: b.apiKey ? vault.seal(b.apiKey) : cur.apiKey, credits: b.credits ?? cur.credits };
    await db().appSetting.upsert({ where: { key: "ai" }, create: { key: "ai", value: next as Prisma.InputJsonValue }, update: { value: next as Prisma.InputJsonValue } });
    await audit(s.user.id, request.ip, "settings.ai", `${b.model}${b.enabled ? "" : " (off)"}`);
    return { message: "AI settings saved." };
  });

  app.get("/admin/settings/meta", async (request) => {
    staffOf(request, "settings.platform");
    const v = ((await db().appSetting.findUnique({ where: { key: "meta" } }))?.value ?? {}) as { appSecret?: string; verifyToken?: string };
    return { data: { hasAppSecret: !!v.appSecret, hasVerifyToken: !!v.verifyToken, webhookUrl: `${app.config.API_URL.replace(/\/$/, "")}/v1/webhooks/meta` } };
  });
  app.put("/admin/settings/meta", async (request) => {
    const s = staffOf(request, "settings.platform");
    if (s.role !== "super_admin") throw badRequest("Only the super admin can change Meta keys.");
    const b = z.object({ appSecret: z.string().trim().min(16).max(200).optional(), verifyToken: z.string().trim().min(12).max(200).optional() }).parse(request.body);
    const cur = ((await db().appSetting.findUnique({ where: { key: "meta" } }))?.value ?? {}) as { appSecret?: string; verifyToken?: string };
    const next = { appSecret: b.appSecret ? vault.seal(b.appSecret) : cur.appSecret, verifyToken: b.verifyToken ? vault.seal(b.verifyToken) : cur.verifyToken };
    await db().appSetting.upsert({ where: { key: "meta" }, create: { key: "meta", value: next }, update: { value: next } });
    await audit(s.user.id, request.ip, "settings.meta", "Meta app");
    return { message: "Meta settings saved." };
  });
}

/** Syncs every calendar feed every 2 hours (in this process only, like the billing cycle). */
export function startOtaJob(app: FastifyInstance) {
  const run = async () => {
    const feeds = await dbOf(app).otaFeed.findMany({ select: { id: true } });
    let ok = 0, failed = 0;
    for (const f of feeds) await syncOtaFeed(dbOf(app), f.id).then(() => ok++).catch(() => failed++);
    if (feeds.length) app.log.info({ ok, failed }, "calendar sync");
  };
  const first = setTimeout(() => run().catch((e) => app.log.error({ err: e }, "calendar sync failed")), 60_000);
  const every = setInterval(() => run().catch((e) => app.log.error({ err: e }, "calendar sync failed")), 2 * 3600_000);
  app.addHook("onClose", async () => { clearTimeout(first); clearInterval(every); });
}
