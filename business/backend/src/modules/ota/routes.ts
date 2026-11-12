// Selling on other sites (Booking.com, Airbnb…) from the business panel.
// Where it fits: the "Other sites" button on a listing and the Channels page (business/frontend OtaPanel / LiveOtaPanel).
// How it works: the business sees which sites are open, asks for a listing on a site (mark-up and a note), answers the
// team's questions (text and up to 3 files), and can stop selling. Sheetal's channel team does the work in Admin → Channels
// (backend-core/src/domain/ota-requests.ts); every step lands in the request's log and in the business's notifications.
// Rules: only stays can be sold on other sites; photos needed come from the platform settings; a site must be connected and
// switched on; people see requests of the branches they work in; files are kept private and are PDF or photos.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { dbOf } from "@sheetal/backend-core/lib/db";
import { badRequest, forbidden } from "@sheetal/backend-core/lib/errors";
import { savePrivateFile } from "@sheetal/backend-core/lib/files";
import { OTA_CHANNELS, askForChannel, otaAccounts, otaSettings, pauseRequest, presentRequest, replyToRequest } from "@sheetal/backend-core/domain/ota-requests";
import { branchView, inView, workspaceOf, type Workspace } from "../access.js";

const need = (ws: Workspace, ...perms: string[]) => { if (!perms.some((p) => ws.can(p))) throw forbidden("You don't have access to this."); };

export async function otaRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);

  app.get("/ota/requests", async (request) => {
    const ws = workspaceOf(request);
    need(ws, "hotel.calendar.read", "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete");
    const q = z.object({ listingId: z.coerce.number().int().positive().optional() }).parse(request.query);
    const v = await branchView(db(), request, ws);
    const [rows, set, acc] = await Promise.all([db().otaRequest.findMany({ where: { tenantId: ws.tenantId, ...inView(v), ...(q.listingId ? { listingId: q.listingId } : {}) }, orderBy: { createdAt: "desc" }, take: 300 }), otaSettings(db()), otaAccounts(db())]);
    const listings = await db().listing.findMany({ where: { id: { in: rows.map((r) => r.listingId).filter((x): x is number => x !== null) } }, select: { id: true, title: true, code: true } });
    const allowed = set.types[ws.member.tenant.type] === true;
    return {
      data: rows.map((r) => ({ ...presentRequest(r), listing: listings.find((l) => l.id === r.listingId)?.title ?? "", code: listings.find((l) => l.id === r.listingId)?.code ?? "" })),
      meta: {
        allowed, minPhotos: set.minPhotos, payoutDays: set.payoutDays,
        channels: OTA_CHANNELS.map((c) => ({ id: c.id, name: c.name, days: c.days, available: allowed && set.sites[c.id]!.on && acc[c.id]!.status === "connected", commission: set.sites[c.id]!.commission, fee: set.sites[c.id]!.fee, markup: set.sites[c.id]!.markup })),
      },
    };
  });

  app.post("/ota/requests", async (request, reply) => {
    const ws = workspaceOf(request);
    need(ws, "hotel.calendar.update", "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete");
    const b = z.object({ listingId: z.number().int().positive(), channel: z.string().max(20), price: z.number().int().min(0, "Mark-up can't be below 0.").max(100, "Mark-up can't be above 100."), note: z.string().trim().max(500).optional() }).strict().parse(request.body); // strict: unknown fields are refused, not ignored
    const r = await askForChannel(db(), { tenant: { id: ws.tenantId, name: ws.member.tenant.name, type: ws.member.tenant.type }, ...b, who: ws.user.userName });
    return reply.code(201).send({ message: "Sent. Sheetal's team will set it up and tell you here.", data: presentRequest(r) });
  });

  app.post<{ Params: { id: string } }>("/ota/requests/:id/reply", { bodyLimit: 40_000_000 }, async (request) => {
    const ws = workspaceOf(request);
    need(ws, "hotel.calendar.update", "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete");
    const b = z.object({ text: z.string().trim().max(1000).default(""), files: z.array(z.object({ data: z.string().max(14_000_000) })).max(3, "Up to 3 files.").default([]) }).parse(request.body);
    if (!b.text && !b.files.length) throw badRequest("Write an answer or add a file.");
    const names: string[] = [];
    for (const f of b.files) names.push(await savePrivateFile(app.config.MEDIA_DIR, "ota", Buffer.from(f.data, "base64")));
    const r = await replyToRequest(db(), { tenantId: ws.tenantId, id: request.params.id, who: ws.user.userName, text: b.text, files: names });
    return { message: "Sent to Sheetal's team.", data: presentRequest(r) };
  });

  app.post<{ Params: { id: string } }>("/ota/requests/:id/pause", async (request) => {
    const ws = workspaceOf(request);
    need(ws, "hotel.calendar.update", "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete");
    const r = await pauseRequest(db(), { tenantId: ws.tenantId, id: request.params.id, who: ws.user.userName });
    return { message: "Done. Sheetal's team will take it down.", data: presentRequest(r) };
  });
}
