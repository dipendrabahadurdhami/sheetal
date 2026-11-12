// Admin → Promote: prices and spots of each boost place and of the home page banner, the lengths on sale, every
// business's boosts, and home page banners: checking businesses' pictures (approve or ask for a change), and
// Sheetal's own banners.
// Where it fits: LivePromote.jsx in the admin panel. Businesses buy boosts in Business → Promote; bank transfers for
// them are confirmed in Billing → Payments like any invoice (the boost then starts by itself).
// Rules: billing.view reads; plans.manage changes prices and stops boosts. A new price counts for boosts bought after.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { dbOf } from "@sheetal/platform/db/client";
import { badRequest, notFound } from "@sheetal/platform/core/errors";
import { ymd } from "@sheetal/backend-core/domain/money";
import { invoiceNumber } from "@sheetal/backend-core/domain/billing";
import { PHASE_LABEL, PLACES, PLACE_LABEL, boostNo, phaseOf, promoteSettings, takenToday, today, type Place } from "@sheetal/backend-core/domain/promote";
import { staffOf } from "./routes.js";
import { notify } from "@sheetal/platform/notify/index";
import { mediaBase } from "@sheetal/backend-core/lib/photos";
import { BANNER_PHASE, BannerText, Picture, approvedDates, bannerNo, bannerPhase, saveBannerPicture } from "@sheetal/backend-core/domain/banners";
import { dayOf } from "@sheetal/backend-core/domain/money";

const PlaceBody = z.object({ price: z.number().int().min(0).max(1_000_000), spots: z.number().int().min(1).max(100), active: z.boolean() });

export async function adminPromoteRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const audit = (actorId: string, ip: string, action: string, target: string, tenantId?: string) => db().auditLog.create({ data: { actorId, ip, action, target, tenantId } });

  app.get("/admin/promote", async (request) => {
    staffOf(request, "platform.billing.read");
    const q = z.object({ show: z.enum(["now", "all"]).default("now") }).parse(request.query);
    const day = today();
    const [s, taken, rows] = await Promise.all([
      promoteSettings(db()), takenToday(db()),
      db().boost.findMany({ where: q.show === "now" ? { status: { in: ["paid", "awaiting"] }, endOn: { gte: new Date(`${day}T00:00:00.000Z`) } } : {}, orderBy: { createdAt: "desc" }, take: 1000 }),
    ]);
    const [listings, tenants, invoices, checking] = await Promise.all([
      db().listing.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.listingId))] } }, select: { id: true, code: true, title: true, city: true, status: true, reviewHold: true } }),
      db().tenant.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.tenantId))] } }, select: { id: true, name: true } }),
      db().invoice.findMany({ where: { id: { in: rows.map((r) => r.invoiceId).filter((x): x is string => !!x) } }, select: { id: true, seq: true, createdAt: true, status: true } }),
      db().payment.findMany({ where: { invoiceId: { in: rows.map((r) => r.invoiceId).filter((x): x is string => !!x) }, status: "pending_review" }, select: { invoiceId: true } }),
    ]);
    const L = new Map(listings.map((l) => [l.id, l])), T = new Map(tenants.map((t) => [t.id, t.name])), I = new Map(invoices.map((i) => [i.id, i]));
    const pending = new Set(checking.map((c) => c.invoiceId));
    return {
      data: {
        today: day, lengths: s.lengths, hero: s.hero,
        places: PLACES.map((p) => ({ id: p, label: PLACE_LABEL[p], ...s[p], takenToday: p === "city" ? Object.values(taken.city).reduce((a, b) => a + b, 0) : taken[p] })),
        boosts: rows.map((b) => {
          const l = L.get(b.listingId), i = b.invoiceId ? I.get(b.invoiceId) : undefined;
          const phase = phaseOf(b, { day, listingLive: !!l && l.status === "published" && !l.reviewHold, checking: !!b.invoiceId && pending.has(b.invoiceId), invoiceOpen: i ? i.status === "open" : undefined });
          return { id: b.id, no: boostNo(b.seq), tenant: T.get(b.tenantId) ?? "", tenantId: b.tenantId, code: l?.code ?? "", title: l?.title ?? "", place: b.place, placeLabel: PLACE_LABEL[b.place as Place], city: l?.city ?? b.city,
            startOn: ymd(b.startOn), endOn: ymd(b.endOn), days: b.days, total: b.total, source: b.source, phase, phaseLabel: PHASE_LABEL[phase], views: b.views, clicks: b.clicks, invoice: i ? invoiceNumber(i) : null };
        }),
      },
    };
  });

  app.put("/admin/promote/settings", async (request) => {
    const s = staffOf(request, "platform.plan.read+platform.plan.create+platform.plan.update+platform.plan.delete");
    const b = z.object({ home: PlaceBody, search: PlaceBody, city: PlaceBody, hero: PlaceBody, lengths: z.array(z.number().int().min(1).max(90)).min(1, "Keep at least one length.").max(8) }).parse(request.body);
    const value = { ...b, lengths: [...new Set(b.lengths)].sort((x, y) => x - y) };
    await db().appSetting.upsert({ where: { key: "promote" }, create: { key: "promote", value }, update: { value } });
    await audit(s.user.id, request.ip, "settings.promote", [...PLACES, "hero" as const].map((p) => `${p} Rs.${b[p].price}×${b[p].spots}`).join(", "));
    return { message: "Boost prices and spots saved. New prices count for boosts bought from now." };
  });

  app.post<{ Params: { id: string } }>("/admin/promote/boosts/:id/stop", async (request) => {
    const s = staffOf(request, "platform.plan.read+platform.plan.create+platform.plan.update+platform.plan.delete");
    const { note } = z.object({ note: z.string().trim().min(3, "Say why.").max(300) }).parse(request.body);
    const b = await db().boost.findUnique({ where: { id: request.params.id.slice(0, 40) } });
    if (!b) throw notFound("Boost not found.");
    if (b.status !== "paid") throw badRequest("Only paid boosts can be stopped.");
    await db().boost.update({ where: { id: b.id }, data: { status: "stopped", stoppedAt: new Date() } });
    await audit(s.user.id, request.ip, "promote.stopped_by_staff", `${boostNo(b.seq)}: ${note}`, b.tenantId);
    return { message: `${boostNo(b.seq)} stopped. Record any refund in Billing → Payments.` };
  });
  // ───── Home page banners ─────
  const media = mediaBase(app.config);
  const pic = (f: string) => `${media}/banner/main/${encodeURIComponent(f)}`;
  const ownerOf = (tenantId: string) => db().membership.findFirst({ where: { tenantId, status: "active", role: { key: "owner" } }, select: { user: { select: { id: true, email: true } } } });

  app.get("/admin/promote/banners", async (request) => {
    staffOf(request, "platform.billing.read");
    const rows = await db().banner.findMany({ orderBy: [{ status: "asc" }, { startOn: "desc" }], take: 500 });
    const tenants = new Map((await db().tenant.findMany({ where: { id: { in: rows.map((r) => r.tenantId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((x) => [x.id, x.name]));
    const inv = rows.map((r) => r.invoiceId).filter((x): x is string => !!x);
    const [invoices, checking] = await Promise.all([
      db().invoice.findMany({ where: { id: { in: inv } }, select: { id: true, seq: true, createdAt: true, status: true } }),
      db().payment.findMany({ where: { invoiceId: { in: inv }, status: "pending_review" }, select: { invoiceId: true } }),
    ]);
    const I = new Map(invoices.map((i) => [i.id, i])), pending = new Set(checking.map((c) => c.invoiceId));
    return {
      data: rows.map((b) => {
        const i = b.invoiceId ? I.get(b.invoiceId) : undefined;
        const phase = bannerPhase(b, { checking: !!b.invoiceId && pending.has(b.invoiceId), invoiceOpen: i ? i.status === "open" : undefined });
        return { id: b.id, no: bannerNo(b.seq), source: b.source, tenant: b.tenantId ? tenants.get(b.tenantId) ?? "" : "Sheetal", desktop: pic(b.desktop), mobile: pic(b.mobile), link: b.link, title: b.title, button: b.button,
          days: b.days, startOn: ymd(b.startOn), endOn: ymd(b.endOn), total: b.total, phase, phaseLabel: BANNER_PHASE[phase], reviewNote: b.reviewNote, views: b.views, clicks: b.clicks, invoice: i ? invoiceNumber(i) : null };
      }),
    };
  });

  // Sheetal's own banner (a bank, a builder, our own offer): free, shown when paid banners leave a spot.
  app.post("/admin/promote/banners", { bodyLimit: 4 * 1024 * 1024 }, async (request) => {
    const s = staffOf(request, "platform.plan.read+platform.plan.create+platform.plan.update+platform.plan.delete");
    const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
    const b = BannerText.extend({ desktop: Picture, mobile: Picture, startOn: Day, endOn: Day }).parse(request.body);
    if (b.endOn < b.startOn) throw badRequest("The end date is before the start.");
    const days = Math.round((dayOf(b.endOn).getTime() - dayOf(b.startOn).getTime()) / 864e5) + 1;
    if (days > 366) throw badRequest("Choose up to a year.");
    const [desktop, mobile] = [await saveBannerPicture(app.config.MEDIA_DIR, b.desktop.data, "desktop"), await saveBannerPicture(app.config.MEDIA_DIR, b.mobile.data, "mobile")];
    const row = await db().banner.create({ data: { source: "staff", desktop, mobile, link: b.link, title: b.title, button: b.button, days, startOn: dayOf(b.startOn), endOn: dayOf(b.endOn), status: "approved", approvedAt: new Date(), reviewedBy: s.user.id, createdBy: s.user.id } });
    await audit(s.user.id, request.ip, "promote.banner_added", `${bannerNo(row.seq)} ${b.startOn}–${b.endOn}`);
    return { message: `${bannerNo(row.seq)} added. It shows from ${b.startOn} when a spot is free.` };
  });

  app.post<{ Params: { id: string } }>("/admin/promote/banners/:id/review", async (request) => {
    const s = staffOf(request, "platform.plan.read+platform.plan.create+platform.plan.update+platform.plan.delete");
    const b = z.object({ decision: z.enum(["approve", "reject"]), note: z.string().trim().max(300).optional() }).parse(request.body);
    const row = await db().banner.findUnique({ where: { id: request.params.id.slice(0, 40) } });
    if (!row) throw notFound("Banner not found.");
    if (row.status !== "review") throw badRequest(row.status === "awaiting" ? "It isn't paid yet." : "This banner isn't waiting for a check.");
    if (b.decision === "reject" && !b.note) throw badRequest("Say what to change, so the business can fix it.");
    const data = b.decision === "approve"
      ? { status: "approved", approvedAt: new Date(), reviewedBy: s.user.id, reviewNote: null, ...approvedDates(row) }
      : { status: "rejected", reviewedBy: s.user.id, reviewNote: b.note };
    await db().banner.update({ where: { id: row.id }, data });
    await audit(s.user.id, request.ip, `promote.banner_${b.decision === "approve" ? "approved" : "rejected"}`, `${bannerNo(row.seq)}${b.note ? `: ${b.note}` : ""}`, row.tenantId ?? undefined);
    const owner = row.tenantId ? await ownerOf(row.tenantId) : null;
    const site = app.config.SITE_URL.replace(/\/$/, "");
    if (owner) {
      const text = b.decision === "approve" ? `Your home page banner ${bannerNo(row.seq)} is approved. It shows on its dates by itself.` : `Please change your home page banner ${bannerNo(row.seq)}: ${b.note}\n\nUpload the new picture in Business → Promote → Home banner. Your paid days are kept.`;
      await app.mailer.send({ to: owner.user.email, subject: b.decision === "approve" ? `Banner approved: ${bannerNo(row.seq)}` : `Banner needs a change: ${bannerNo(row.seq)}`, text: `${text}\n${site}/business/promote/banner\n\nSheetal Property` });
      await notify(db(), [owner.user.id], { tenantId: row.tenantId, type: "promote", title: b.decision === "approve" ? "Home banner approved" : "Home banner needs a change", message: b.note ?? "", link: "/business/promote/banner" });
    }
    return { message: b.decision === "approve" ? "Approved. It shows on its dates." : "Sent back; the business has been told." };
  });

  app.post<{ Params: { id: string } }>("/admin/promote/banners/:id/stop", async (request) => {
    const s = staffOf(request, "platform.plan.read+platform.plan.create+platform.plan.update+platform.plan.delete");
    const { note } = z.object({ note: z.string().trim().min(3, "Say why.").max(300) }).parse(request.body);
    const row = await db().banner.findUnique({ where: { id: request.params.id.slice(0, 40) } });
    if (!row) throw notFound("Banner not found.");
    if (!["approved", "review", "rejected"].includes(row.status)) throw badRequest("Only running or paid banners can be stopped.");
    await db().banner.update({ where: { id: row.id }, data: { status: "stopped", stoppedAt: new Date() } });
    await audit(s.user.id, request.ip, "promote.banner_stopped", `${bannerNo(row.seq)}: ${note}`, row.tenantId ?? undefined);
    return { message: `${bannerNo(row.seq)} stopped.${row.source === "paid" ? " Record any refund in Billing → Payments." : ""}` };
  });
}
