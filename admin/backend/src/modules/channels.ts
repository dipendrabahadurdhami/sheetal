// Admin → Channels: requests to sell on other sites, the partner accounts, and the site settings.
// Where it fits: the admin panel's Channels page. The business side is business/backend/src/modules/ota.
// How it works: staff see every request (filter by status, site, business), move it on (being set up, needs info, live
// with property id and link, paused, rejected), and the business is told. Settings: which sites are on, the site's
// commission, Sheetal's fee, the usual mark-up, payout days, photos needed and the business types allowed. Partner
// accounts say whether Sheetal's account on a site is connected; a business can only ask once it is.
// Rules: moving requests needs tenants.manage; settings and accounts need settings.platform; every change is audited.

import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { dbOf } from "@sheetal/platform/db/client";
import { notFound } from "@sheetal/platform/core/errors";
import { readPrivateFile } from "@sheetal/backend-core/lib/files";
import {
  OTA_CHANNELS, OTA_STATUSES, isChannel, logOf, otaAccounts, otaRef, otaSettings, presentRequest, saveOtaSettings, setRequestStatus, type OtaSettings,
} from "@sheetal/backend-core/domain/ota-requests";
import { staffOf } from "./routes.js";

const site = z.strictObject({ on: z.boolean(), commission: z.number().min(0).max(50), fee: z.number().min(0).max(30), markup: z.number().min(0).max(100) }).partial();
const settingsBody = z.strictObject({
  payoutDays: z.number().int().min(0).max(60), minPhotos: z.number().int().min(0).max(30),
  types: z.record(z.string().max(30), z.boolean()), sites: z.strictObject(Object.fromEntries(OTA_CHANNELS.map((c) => [c.id, site]))).partial(),
}).partial();

const flat = (s: object, p = ""): Record<string, unknown> => Object.entries(s).reduce<Record<string, unknown>>((o, [k, v]) => (v && typeof v === "object" ? { ...o, ...flat(v, `${p}${k}.`) } : { ...o, [`${p}${k}`]: v }), {});

export async function adminChannelRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const audit = (actorId: string, ip: string, action: string, target: string, tenantId?: string) => db().auditLog.create({ data: { actorId, action, target, ip, tenantId } });

  app.get("/admin/ota/requests", async (request) => {
    staffOf(request, "platform.business.read");
    const q = z.object({ status: z.enum(OTA_STATUSES).optional(), channel: z.string().optional(), q: z.string().trim().max(80).optional() }).parse(request.query);
    const where: Prisma.OtaRequestWhereInput = { ...(q.status ? { status: q.status } : {}), ...(q.channel && isChannel(q.channel) ? { channel: q.channel } : {}) };
    const [rows, groups] = await Promise.all([db().otaRequest.findMany({ where, orderBy: { createdAt: "desc" }, take: 400 }), db().otaRequest.groupBy({ by: ["status"], _count: { _all: true } })]);
    const [tenants, listings] = await Promise.all([
      db().tenant.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.tenantId))] } }, select: { id: true, name: true } }),
      db().listing.findMany({ where: { id: { in: rows.map((r) => r.listingId).filter((x): x is number => x !== null) } }, select: { id: true, title: true, code: true } }),
    ]);
    let data = rows.map((r) => ({ ...presentRequest(r), business: tenants.find((t) => t.id === r.tenantId)?.name ?? "", listing: listings.find((l) => l.id === r.listingId)?.title ?? "", code: listings.find((l) => l.id === r.listingId)?.code ?? "" }));
    if (q.q) { const n = q.q.toLowerCase(); data = data.filter((r) => [r.business, r.listing, r.ref, r.code].some((x) => x.toLowerCase().includes(n))); }
    return { data, counts: Object.fromEntries(groups.map((g) => [g.status, g._count._all])) };
  });

  app.put<{ Params: { id: string } }>("/admin/ota/requests/:id", async (request) => {
    const s = staffOf(request, "platform.business.read+platform.business.create+platform.business.update");
    const b = z.object({
      status: z.enum(OTA_STATUSES).refine((x) => x !== "requested", "A request can't go back to requested."),
      note: z.string().trim().max(1000).optional(), ask: z.string().trim().max(1000).optional(), otaPropertyId: z.string().trim().max(80).optional(), url: z.string().trim().max(400).optional(),
    }).parse(request.body);
    const before = await db().otaRequest.findUnique({ where: { id: request.params.id } });
    if (!before) throw notFound("That request doesn't exist.");
    const r = await setRequestStatus(db(), app.mailer, { id: before.id, ...b, who: s.user.userName ?? "Sheetal team", siteUrl: app.config.SITE_URL });
    await audit(s.user.id, request.ip, "ota.status", `${otaRef(r.seq)}: ${before.status} → ${r.status}`, r.tenantId);
    return { message: "Saved. The business has been told.", data: presentRequest(r) };
  });

  /** A file a business sent with a reply (only files named in the request's log). */
  app.get<{ Params: { id: string; name: string } }>("/admin/ota/requests/:id/files/:name", async (request) => {
    staffOf(request, "platform.business.read");
    const r = await db().otaRequest.findUnique({ where: { id: request.params.id } });
    if (!r || !logOf(r).some((l) => l.files?.includes(request.params.name))) throw notFound("No such file on this request.");
    const f = await readPrivateFile(app.config.MEDIA_DIR, "ota", request.params.name);
    if (!f) throw notFound("The file is gone.");
    return { data: { type: f.type, data: f.data.toString("base64") } };
  });

  app.get("/admin/ota/settings", async (request) => {
    staffOf(request, "platform.business.read");
    return { data: { settings: await otaSettings(db()), accounts: await otaAccounts(db()), channels: OTA_CHANNELS } };
  });

  app.put("/admin/ota/settings", async (request) => {
    const s = staffOf(request, "platform.settings.read+platform.settings.update");
    const b = settingsBody.parse(request.body);
    const cur = await otaSettings(db());
    const next: OtaSettings = { ...cur, ...b, types: { ...cur.types, ...(b.types ?? {}) }, sites: Object.fromEntries(OTA_CHANNELS.map((c) => [c.id, { ...cur.sites[c.id]!, ...(b.sites?.[c.id] ?? {}) }])) } as OtaSettings;
    const before = flat(cur), after = flat(next);
    const changed = Object.keys(after).filter((k) => String(before[k]) !== String(after[k]));
    if (!changed.length) return { message: "Nothing changed.", data: next };
    await saveOtaSettings(db(), next);
    for (const k of changed) await audit(s.user.id, request.ip, "ota.settings", `${k}: ${String(before[k])} → ${String(after[k])}`);
    return { message: "Saved.", data: next };
  });

  app.put<{ Params: { channel: string } }>("/admin/ota/accounts/:channel", async (request) => {
    const s = staffOf(request, "platform.settings.read+platform.settings.update");
    if (!isChannel(request.params.channel)) throw notFound("There is no such site.");
    const b = z.object({ status: z.enum(["connected", "not_connected"]), note: z.string().trim().max(300).optional() }).parse(request.body);
    const channel = request.params.channel;
    const cur = await db().otaAccount.findUnique({ where: { channel } });
    if (cur?.status === b.status && (cur.note ?? "") === (b.note ?? cur.note ?? "")) return { message: "Nothing changed.", data: await otaAccounts(db()) };
    await db().otaAccount.upsert({ where: { channel }, create: { channel, status: b.status, note: b.note }, update: { status: b.status, ...(b.note !== undefined ? { note: b.note } : {}) } });
    await audit(s.user.id, request.ip, "ota.account", `${channel}: ${cur?.status ?? "not_connected"} → ${b.status}`);
    return { message: "Saved.", data: await otaAccounts(db()) };
  });
}
