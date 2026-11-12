// Home page banners for businesses (Business → Promote → Home banner): book days, upload the pictures, pay, and
// replace a picture Sheetal asked to change.
// Where it fits: LivePromote.jsx (the "Home banner" tab, /business/promote/banner). Rules are in
// backend-core/src/domain/banners.ts. Paying uses the normal billing checkout with the invoice.
// How it works: a quote gives the price and the first start date with a free spot; booking saves both pictures (exact
// sizes, up to 1 MB each) and makes the banner and its "banner" invoice together. Paid, it goes to Sheetal's picture
// check; approved, it shows on its dates by itself.
// Rules: billing.manage books, cancels unpaid banners and replaces pictures; everyone who can open Promote sees them.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { dbOf } from "@sheetal/platform/db/client";
import { badRequest, forbidden, notFound } from "@sheetal/platform/core/errors";
import { STAFF_FOR, notifyStaff } from "@sheetal/platform/notify/index";
import { dayOf, ymd } from "@sheetal/backend-core/domain/money";
import { billingSettings, createAddonInvoice, invoiceNumber } from "@sheetal/backend-core/domain/billing";
import { addDays, promoteSettings, today } from "@sheetal/backend-core/domain/promote";
import { BANNER_PHASE, BANNER_SIZES, BannerText, Picture, bannerFreeStart, bannerLine, bannerNo, bannerPhase, saveBannerPicture } from "@sheetal/backend-core/domain/banners";
import { mediaBase } from "@sheetal/backend-core/lib/photos";
import { workspaceOf, type Workspace } from "../access.js";

const VIEW_PERMS = ["listings.listing.read+listings.listing.create+listings.listing.update+listings.listing.delete+listings.listing.publish", "projects.project.read+projects.project.create+projects.project.update+projects.project.delete", "investments.offering.read+investments.offering.create+investments.offering.update+investments.offering.delete", "hotel.calendar.update", "workspace.billing.manage"];
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-04.").refine((s) => { const d = dayOf(s); return !Number.isNaN(d.getTime()) && ymd(d) === s; }, "That date doesn't exist.");
const Ask = z.object({ days: z.coerce.number().int().min(1).max(90), startOn: Day.optional() });
const big = { bodyLimit: 4 * 1024 * 1024 };

export async function bannerRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const media = mediaBase(app.config);
  const viewer = (request: FastifyRequest) => {
    const ws = workspaceOf(request);
    if (!VIEW_PERMS.some((p) => ws.can(p))) throw forbidden("Your role can't promote.");
    return ws;
  };
  const payer = (ws: Workspace) => { if (!ws.can("workspace.billing.manage")) throw forbidden("Only people who manage billing can book banners. Ask the owner."); };
  const pic = (f: string) => `${media}/banner/main/${encodeURIComponent(f)}`;
  const audit = (ws: Workspace, ip: string, action: string, target: string) => db().auditLog.create({ data: { tenantId: ws.tenantId, actorId: ws.user.id, action, target, ip } });

  const quote = async (q: z.infer<typeof Ask>, exceptId?: string) => {
    const s = await promoteSettings(db());
    if (!s.hero.active) throw badRequest("Home page banners aren't on sale right now.");
    if (!s.lengths.includes(q.days)) throw badRequest(`Choose ${s.lengths.join(", ")} days.`);
    const from = q.startOn && q.startOn > today() ? q.startOn : today();
    const start = await bannerFreeStart(db(), { days: q.days, from, spots: s.hero.spots, exceptId });
    if (!start) throw badRequest("Banners are booked for the next year.");
    const vat = (await billingSettings(db())).vatRate;
    const total = s.hero.price * q.days;
    return { days: q.days, price: s.hero.price, total, vat: Math.round((total * vat) / (100 + vat)), startOn: start, endOn: addDays(start, q.days - 1), moved: start !== from };
  };

  app.get("/promote/banners", async (request) => {
    const ws = viewer(request);
    const [s, rows] = await Promise.all([promoteSettings(db()), db().banner.findMany({ where: { tenantId: ws.tenantId }, orderBy: { createdAt: "desc" }, take: 200 })]);
    const inv = rows.map((b) => b.invoiceId).filter((x): x is string => !!x);
    const [invoices, checking] = await Promise.all([
      db().invoice.findMany({ where: { id: { in: inv } }, select: { id: true, seq: true, createdAt: true, status: true, total: true } }),
      db().payment.findMany({ where: { invoiceId: { in: inv }, status: "pending_review" }, select: { invoiceId: true } }),
    ]);
    const I = new Map(invoices.map((i) => [i.id, i]));
    const pending = new Set(checking.map((c) => c.invoiceId));
    return {
      data: {
        canBuy: ws.can("workspace.billing.manage"), price: s.hero.price, spots: s.hero.spots, active: s.hero.active, lengths: s.lengths, sizes: BANNER_SIZES, maxBytes: 1024 * 1024, today: today(),
        rows: rows.map((b) => {
          const i = b.invoiceId ? I.get(b.invoiceId) : undefined;
          const phase = bannerPhase(b, { checking: !!b.invoiceId && pending.has(b.invoiceId), invoiceOpen: i ? i.status === "open" : undefined });
          return { id: b.id, no: bannerNo(b.seq), desktop: pic(b.desktop), mobile: pic(b.mobile), link: b.link, title: b.title, button: b.button, days: b.days, startOn: ymd(b.startOn), endOn: ymd(b.endOn), total: b.total,
            phase, phaseLabel: BANNER_PHASE[phase], reviewNote: b.status === "rejected" ? b.reviewNote : null, views: b.views, clicks: b.clicks,
            invoice: i ? { id: i.id, number: invoiceNumber(i), status: i.status, total: i.total } : null };
        }),
      },
    };
  });

  app.get("/promote/banners/quote", async (request) => {
    viewer(request);
    return { data: await quote(Ask.parse(request.query)) };
  });

  app.post("/promote/banners", big, async (request) => {
    const ws = viewer(request); payer(ws);
    const b = Ask.extend({ ...BannerText.shape, desktop: Picture, mobile: Picture }).parse(request.body);
    const tenant = await db().tenant.findUniqueOrThrow({ where: { id: ws.tenantId } });
    if (tenant.status === "suspended" || tenant.status === "cancelled") throw badRequest("This business isn't active. Please contact Sheetal.");
    const q = await quote(b);
    const [desktop, mobile] = [await saveBannerPicture(app.config.MEDIA_DIR, b.desktop.data, "desktop"), await saveBannerPicture(app.config.MEDIA_DIR, b.mobile.data, "mobile")];
    const vatRate = (await billingSettings(db())).vatRate;
    const { banner, invoice } = await db().$transaction(async (tx) => {
      const banner = await tx.banner.create({ data: { tenantId: ws.tenantId, desktop, mobile, link: b.link, title: b.title, button: b.button, days: q.days, startOn: dayOf(q.startOn), endOn: dayOf(q.endOn), price: q.price, total: q.total, createdBy: ws.user.id } });
      const invoice = await createAddonInvoice(tx, { tenant, lines: [bannerLine({ days: q.days, price: q.price, no: bannerNo(banner.seq) })], by: ws.user.id, vatRate });
      await tx.invoice.update({ where: { id: invoice.id }, data: { kind: "banner", months: 1, periodStart: dayOf(q.startOn), periodEnd: dayOf(q.endOn), dueAt: new Date(Date.now() + 864e5) } });
      await tx.banner.update({ where: { id: banner.id }, data: { invoiceId: invoice.id } });
      return { banner, invoice };
    });
    await audit(ws, request.ip, "promote.banner_booked", `${bannerNo(banner.seq)} ${q.days}d ${invoiceNumber(invoice)}`);
    return {
      message: `Home page banner ${q.startOn} to ${q.endOn}. Pay ${invoiceNumber(invoice)} (Rs. ${invoice.total.toLocaleString("en-IN")}); Sheetal then checks the picture.`,
      data: { id: banner.id, no: bannerNo(banner.seq), invoiceId: invoice.id, number: invoiceNumber(invoice), total: invoice.total },
    };
  });

  // New pictures, link or text before it shows (or after Sheetal asked for a change): it goes back to the check.
  app.put<{ Params: { id: string } }>("/promote/banners/:id", big, async (request) => {
    const ws = viewer(request); payer(ws);
    const b = BannerText.extend({ desktop: Picture.optional(), mobile: Picture.optional() }).parse(request.body);
    const row = await db().banner.findFirst({ where: { id: request.params.id.slice(0, 40), tenantId: ws.tenantId } });
    if (!row) throw notFound("Banner not found.");
    if (!["awaiting", "review", "rejected"].includes(row.status)) throw badRequest("A banner that is approved or closed can't change. Book a new one.");
    const desktop = b.desktop ? await saveBannerPicture(app.config.MEDIA_DIR, b.desktop.data, "desktop") : row.desktop;
    const mobile = b.mobile ? await saveBannerPicture(app.config.MEDIA_DIR, b.mobile.data, "mobile") : row.mobile;
    const back = row.status === "rejected" ? "review" : row.status;
    await db().banner.update({ where: { id: row.id }, data: { desktop, mobile, link: b.link, title: b.title, button: b.button, status: back, reviewNote: back === "review" ? null : row.reviewNote } });
    if (row.status === "rejected") await notifyStaff(db(), STAFF_FOR.plans, { type: "promote", title: `Banner picture to check again: ${bannerNo(row.seq)}`, message: ws.member.tenant.name, link: "/admin/promote" });
    await audit(ws, request.ip, "promote.banner_changed", bannerNo(row.seq));
    return { message: row.status === "rejected" ? "Sent to Sheetal to check again." : "Saved." };
  });

  app.post<{ Params: { id: string } }>("/promote/banners/:id/cancel", async (request) => {
    const ws = viewer(request); payer(ws);
    const row = await db().banner.findFirst({ where: { id: request.params.id.slice(0, 40), tenantId: ws.tenantId } });
    if (!row) throw notFound("Banner not found.");
    if (row.status !== "awaiting") throw badRequest("Only unpaid banners can be cancelled.");
    if (row.invoiceId && await db().payment.findFirst({ where: { invoiceId: row.invoiceId, status: "pending_review" } })) throw badRequest("A bank transfer for it is being checked. Wait for Sheetal's answer.");
    await db().$transaction([
      db().banner.update({ where: { id: row.id }, data: { status: "void" } }),
      ...(row.invoiceId ? [db().invoice.updateMany({ where: { id: row.invoiceId, status: "open" }, data: { status: "void" } })] : []),
    ]);
    await audit(ws, request.ip, "promote.banner_cancelled", bannerNo(row.seq));
    return { message: `${bannerNo(row.seq)} cancelled. Nothing was paid.` };
  });
}
