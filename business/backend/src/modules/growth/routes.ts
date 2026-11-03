import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { dbOf } from "@sheetal/backend-core/lib/db";
import { AppError, badRequest, forbidden, notFound } from "@sheetal/backend-core/lib/errors";
import { Vault } from "@sheetal/backend-core/lib/vault";
import { aiClient, creditsUsed, extractLeads, type AiClient } from "@sheetal/backend-core/lib/ai";
import { buildIcal } from "@sheetal/backend-core/lib/ical";
import { metaSignatureOk, readMetaWebhook } from "@sheetal/backend-core/lib/meta";
import { leadPeople, notify } from "@sheetal/backend-core/lib/notify";
import { dayOf, ymd } from "@sheetal/backend-core/domain/money";
import { syncOtaFeed } from "@sheetal/backend-core/domain/ota";
import type { Fetch } from "@sheetal/backend-core/lib/payments";
import { workspaceOf, type Workspace } from "../access.js";

// Growth tools of a business: finding leads in pasted text with AI, its analytics, keeping rooms in sync with
// Booking.com / Airbnb / Agoda through their calendar (iCal) feeds, and its WhatsApp / Messenger / Instagram
// connected to the Inbox (Meta's webhook comes here; replies go out from the leads module).

type Ai = { client: AiClient; model: string; credits: Record<string, number> };
const SITES = ["booking", "airbnb", "agoda", "expedia", "other"] as const;

export async function growthRoutes(app: FastifyInstance, opts: { ai?: Ai; fetch?: Fetch }) {
  const db = () => dbOf(app);
  const vault = new Vault(app.config.SECRETS_KEY, app.config.NODE_ENV === "production");
  const need = (ws: Workspace, ...perms: string[]) => { if (!perms.some(ws.can)) throw forbidden("Your role can't do this."); };
  const ai = async () => opts.ai ?? (await aiClient(db(), vault));

  // ───── AI: leads from pasted text ─────
  app.post("/ai/extract-leads", { bodyLimit: 300_000, config: { rateLimit: { max: 30, timeWindow: "1 hour" } } }, async (request) => {
    const ws = workspaceOf(request);
    need(ws, "leads.view", "messages.reply");
    const b = z.object({ text: z.string().trim().min(20, "Paste a bit more text.").max(60_000, "That's too long; paste up to about 10 pages at a time."), save: z.boolean().default(false) }).parse(request.body);
    const a = await ai();
    if (!a) throw new AppError(503, "ai_off", "AI isn't switched on yet. Sheetal is setting it up.");
    const r = await extractLeads(db(), a, { text: b.text, tenantId: ws.tenantId, planName: ws.member.tenant.plan.name, userId: ws.user.id });
    let saved = 0;
    if (b.save) {
      for (const l of r.leads) {
        await db().lead.create({ data: { tenantId: ws.tenantId, kind: "chat", name: l.name || l.phone || l.email, phone: l.phone || null, email: l.email || null, message: [l.need, l.budget && `Budget: ${l.budget}`, l.location && `Area: ${l.location}`, l.note].filter(Boolean).join(" · "), details: { channel: "web", source: "ai_found", budget: l.budget, location: l.location } } });
        saved++;
      }
    }
    return { message: b.save ? `${saved} lead${saved === 1 ? "" : "s"} added to the Inbox.` : `Found ${r.leads.length} lead${r.leads.length === 1 ? "" : "s"}.`, data: r };
  });

  app.get("/ai/usage", async (request) => {
    const ws = workspaceOf(request);
    const a = await ai();
    const limit = a?.credits[ws.member.tenant.plan.name] ?? 0;
    return { data: { enabled: !!a, used: await creditsUsed(db(), ws.tenantId), limit } };
  });

  // ───── Analytics ─────
  app.get("/analytics", async (request) => {
    const ws = workspaceOf(request);
    need(ws, "overview.view", "listings.manage", "leads.view");
    const { days } = z.object({ days: z.coerce.number().int().min(7).max(365).default(30) }).parse(request.query);
    const since = new Date(Date.now() - days * 864e5);
    const [views, visitors, byListing, leads, byDay] = await Promise.all([
      db().pageView.count({ where: { tenantId: ws.tenantId, createdAt: { gte: since } } }),
      db().pageView.groupBy({ by: ["session"], where: { tenantId: ws.tenantId, createdAt: { gte: since } } }).then((r) => r.length),
      db().pageView.groupBy({ by: ["listingId"], where: { tenantId: ws.tenantId, createdAt: { gte: since }, listingId: { not: null } }, _count: true, orderBy: { _count: { listingId: "desc" } }, take: 20 }),
      db().lead.groupBy({ by: ["listingId"], where: { tenantId: ws.tenantId, createdAt: { gte: since } }, _count: true }),
      db().$queryRaw<{ day: string; views: number; visitors: number }[]>`SELECT to_char(created_at AT TIME ZONE 'Asia/Kathmandu', 'YYYY-MM-DD') AS day, count(*)::int AS views, count(DISTINCT session)::int AS visitors FROM page_views WHERE tenant_id = ${ws.tenantId} AND created_at >= ${since} GROUP BY 1 ORDER BY 1`,
    ]);
    const titles = new Map((await db().listing.findMany({ where: { id: { in: byListing.map((b) => b.listingId!).filter(Boolean) } }, select: { id: true, code: true, title: true } })).map((l) => [l.id, l]));
    const leadsBy = new Map(leads.map((l) => [l.listingId, l._count]));
    return {
      data: {
        days, views, visitors, leads: leads.reduce((s, l) => s + l._count, 0), byDay,
        topListings: byListing.map((b) => ({ ...titles.get(b.listingId!), views: b._count, leads: leadsBy.get(b.listingId) ?? 0 })),
      },
    };
  });

  // ───── Other sites: calendar sync ─────
  const sign = (tenantId: string, type: string) => createHmac("sha256", app.config.SECRETS_KEY ?? "sheetal-local-development-only-key").update(`ical:${tenantId}:${type}`).digest("base64url").slice(0, 24);
  const slug = (s: string) => encodeURIComponent(s);

  app.get("/ota/feeds", async (request) => {
    const ws = workspaceOf(request);
    need(ws, "calendar.view", "settings.business");
    const [feeds, types] = await Promise.all([db().otaFeed.findMany({ where: { tenantId: ws.tenantId }, orderBy: { createdAt: "asc" } }), db().room.groupBy({ by: ["type"], where: { tenantId: ws.tenantId, active: true } })]);
    const api = app.config.API_URL.replace(/\/$/, "");
    return { data: {
      feeds,
      // Give these links to Booking.com / Airbnb ("import calendar") so stays booked here close those dates there.
      exports: types.map((t) => ({ type: t.type, url: `${api}/v1/ical/${ws.tenantId}/${slug(t.type)}/${sign(ws.tenantId, t.type)}.ics` })),
    } };
  });

  app.post("/ota/feeds", async (request) => {
    const ws = workspaceOf(request);
    need(ws, "calendar.edit", "settings.business");
    const b = z.object({ type: z.string().trim().min(1).max(60), site: z.enum(SITES), url: z.url().refine((u) => u.startsWith("https://"), "Use the https calendar link from the site.") }).parse(request.body);
    if (!(await db().room.count({ where: { tenantId: ws.tenantId, type: b.type, active: true } }))) throw badRequest("Add rooms of this type first.");
    const f = await db().otaFeed.create({ data: { tenantId: ws.tenantId, roomType: b.type, site: b.site, url: b.url } });
    const r = await syncFeed(f.id).catch((e) => ({ error: e instanceof Error ? e.message : "failed" }));
    return { message: "error" in r ? `Saved, but the first sync failed: ${r.error}` : `Connected. ${r.added} stay${r.added === 1 ? "" : "s"} imported.` };
  });

  app.post<{ Params: { id: string } }>("/ota/feeds/:id/sync", async (request) => {
    const ws = workspaceOf(request);
    need(ws, "calendar.edit", "settings.business");
    const f = await db().otaFeed.findFirst({ where: { id: request.params.id, tenantId: ws.tenantId } });
    if (!f) throw notFound("Feed not found.");
    const r = await syncFeed(f.id);
    return { message: `Synced: ${r.added} new, ${r.updated} changed, ${r.cancelled} cancelled.`, data: r };
  });

  /** Imports a site's stays (see backend-core/src/domain/ota.ts); errors become a message for the person. */
  async function syncFeed(id: string) {
    try { return await syncOtaFeed(db(), id, opts.fetch); }
    catch (e) { throw badRequest(`Couldn't read the calendar: ${e instanceof Error ? e.message : "failed"}.`); }
  }

  /** Our busy dates for one room type: a day is closed when every room of the type is taken. Public link, signed. */
  app.get<{ Params: { tenant: string; type: string; sig: string } }>("/ical/:tenant/:type/:sig", async (request, reply) => {
    const { tenant, type } = request.params;
    const sig = request.params.sig.replace(/\.ics$/, "");
    const want = sign(tenant, type);
    if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) throw notFound("Calendar not found.");
    const rooms = await db().room.count({ where: { tenantId: tenant, type, active: true } });
    const stays = await db().booking.findMany({ where: { tenantId: tenant, roomType: type, status: { in: ["requested", "confirmed", "checked_in"] }, checkOut: { gt: new Date() } }, select: { checkIn: true, checkOut: true } });
    const full: string[] = [];
    for (let d = dayOf(ymd(new Date())).getTime(); d < Date.now() + 365 * 864e5; d += 864e5) {
      const taken = stays.filter((s) => s.checkIn.getTime() <= d && s.checkOut.getTime() > d).length;
      if (rooms > 0 && taken >= rooms) full.push(ymd(new Date(d)));
    }
    // Consecutive full days become one event.
    const events: { uid: string; start: string; end: string }[] = [];
    for (const day of full) {
      const last = events[events.length - 1];
      const next = ymd(new Date(dayOf(day).getTime() + 864e5));
      if (last && last.end === day) last.end = next; else events.push({ uid: `${tenant}-${slug(type)}-${day}`, start: day, end: next });
    }
    return reply.header("content-type", "text/calendar; charset=utf-8").header("cache-control", "no-cache").send(buildIcal({ name: type, events }));
  });

  // ───── Channels: WhatsApp, Messenger, Instagram ─────
  app.get("/channels", async (request) => {
    const ws = workspaceOf(request);
    need(ws, "settings.business", "messages.reply");
    const rows = await db().channelAccount.findMany({ where: { tenantId: ws.tenantId }, orderBy: { createdAt: "asc" } });
    return { data: rows.map(({ accessToken: _t, ...r }) => r) };
  });

  app.post("/channels", async (request) => {
    const ws = workspaceOf(request);
    need(ws, "settings.business");
    const b = z.object({ kind: z.enum(["whatsapp", "messenger", "instagram"]), externalId: z.string().trim().regex(/^\d{5,30}$/, "Use the numeric id from Meta."), name: z.string().trim().min(2).max(80), accessToken: z.string().trim().min(20).max(1000) }).parse(request.body);
    if (await db().channelAccount.findUnique({ where: { externalId: b.externalId } })) throw badRequest("That account is already connected.");
    await db().channelAccount.create({ data: { tenantId: ws.tenantId, kind: b.kind, externalId: b.externalId, name: b.name, accessToken: vault.seal(b.accessToken) } });
    await db().auditLog.create({ data: { actorId: ws.user.id, tenantId: ws.tenantId, action: "channel.connected", target: `${b.kind} ${b.name}`, ip: request.ip } });
    return { message: `${b.name} connected. New messages arrive in the Inbox.` };
  });

  app.post<{ Params: { id: string } }>("/channels/:id/disconnect", async (request) => {
    const ws = workspaceOf(request);
    need(ws, "settings.business");
    const r = await db().channelAccount.deleteMany({ where: { id: request.params.id, tenantId: ws.tenantId } });
    if (!r.count) throw notFound("Channel not found.");
    return { message: "Disconnected." };
  });

  // Meta's webhook, scoped so it can read the exact bytes Meta signed.
  await app.register(async (hook) => {
    hook.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
      (req as FastifyRequest & { rawBody?: Buffer }).rawBody = body as Buffer;
      try { done(null, JSON.parse((body as Buffer).toString("utf8") || "{}")); } catch (e) { done(e as Error, undefined); }
    });
    const meta = async () => {
      const v = ((await db().appSetting.findUnique({ where: { key: "meta" } }))?.value ?? {}) as { appSecret?: string; verifyToken?: string };
      const open = (s?: string) => { try { return s ? vault.open(s) : null; } catch { return null; } };
      return { appSecret: open(v.appSecret), verifyToken: open(v.verifyToken) };
    };
    hook.get("/webhooks/meta", async (request, reply) => {
      const q = request.query as Record<string, string>;
      const m = await meta();
      if (q["hub.mode"] === "subscribe" && m.verifyToken && q["hub.verify_token"] === m.verifyToken) return reply.type("text/plain").send(q["hub.challenge"] ?? "");
      return reply.code(403).send();
    });
    hook.post("/webhooks/meta", { config: { rateLimit: { max: 600, timeWindow: "1 minute" } } }, async (request, reply) => {
      const m = await meta();
      const raw = (request as FastifyRequest & { rawBody?: Buffer }).rawBody ?? Buffer.from("");
      if (!m.appSecret || !metaSignatureOk(m.appSecret, raw, request.headers["x-hub-signature-256"] as string | undefined)) return reply.code(401).send();
      for (const msg of readMetaWebhook(request.body)) {
        const acct = await db().channelAccount.findUnique({ where: { externalId: msg.accountId } });
        if (!acct?.active) continue;
        const key = `${msg.channel}:${msg.from}`;
        const lead = await db().lead.findFirst({ where: { tenantId: acct.tenantId, contactKey: key, status: { notIn: ["won", "lost"] } }, orderBy: { lastAt: "desc" } });
        if (lead) {
          // Meta can send the same message twice; skip what's already there.
          const first = lead.message === msg.text && lead.createdAt.getTime() === msg.at.getTime();
          if (!first && !(await db().leadMessage.findFirst({ where: { leadId: lead.id, body: msg.text, createdAt: msg.at } }))) {
            await db().$transaction([
              db().leadMessage.create({ data: { leadId: lead.id, direction: "in", body: msg.text, createdAt: msg.at } }),
              db().lead.update({ where: { id: lead.id }, data: { lastAt: msg.at } }),
            ]);
          }
        } else {
          await db().lead.create({ data: { tenantId: acct.tenantId, kind: "chat", name: msg.name || "New contact", phone: msg.channel === "whatsapp" ? `+${msg.from}` : null, message: msg.text, contactKey: key, details: { channel: msg.channel, account: acct.externalId, contact: msg.from }, createdAt: msg.at, lastAt: msg.at } });
          await notify(db(), await leadPeople(db(), acct.tenantId), { type: "lead", title: `New ${msg.channel} message from ${msg.name || "someone"}`, message: msg.text.slice(0, 140), link: "/business/inbox" });
        }
      }
      // Meta wants a quick 200, or it retries.
      return reply.code(200).send({ ok: true });
    });
  }, { prefix: "" });
}
