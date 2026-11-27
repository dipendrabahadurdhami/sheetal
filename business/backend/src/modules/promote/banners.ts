// Home page banners for businesses (Business → Promote → Home banner): book days, upload the pictures, pay, and
// replace a picture Sheetal asked to change.
// Where it fits: LivePromote.jsx (the "Home banner" tab, /business/promote/banner). Rules are in
// backend-core/src/domain/banners.ts. Paying uses the normal billing checkout with the invoice.
// How it works: a quote gives the price and the first start date with a free spot; booking saves both pictures (exact
// sizes, up to 1 MB each) and makes the banner and its "banner" invoice together. Paid, it goes to Sheetal's picture
// check; approved, it shows on its dates by itself.
// Rules: billing.manage books, cancels unpaid banners and replaces pictures; everyone who can open Promote sees them.
// Only businesses on a paid plan (Starter, Business or Pro, or a gift of paid software) may book; each day is still paid (the owner's rule,
// 27 Nov 2026). A banner is either the business's own pictures, or one of its published listings: then no pictures are uploaded, the
// home page shows the listing's photos as a grid and the banner opens the listing. A third kind is the business's own page (an agency,
// hotel group or developer): no pictures and no listing; the home page shows the covers of its newest listings with its name and opens
// its page (/site/<id>). Such a banner is stored with empty pictures and no listing.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { dbOf } from "@sheetal/platform/db/client";
import { badRequest, forbidden, notFound } from "@sheetal/platform/core/errors";
import { STAFF_FOR, notifyStaff } from "@sheetal/platform/notify/index";
import { dayOf, ymd } from "@sheetal/backend-core/domain/money";
import { billingSettings, createAddonInvoice, invoiceNumber } from "@sheetal/backend-core/domain/billing";
import { addDays, promoteSettings, today } from "@sheetal/backend-core/domain/promote";
import { BANNER_PHASE, BANNER_SIZES, BannerText, Picture, bannerFreeStart, bannerLine, bannerNo, bannerPhase, saveBannerPicture } from "@sheetal/backend-core/domain/banners";
import { mediaBase, photoUrl } from "@sheetal/backend-core/lib/photos";
import { SOFTWARE } from "@sheetal/platform/billing/packs";
import { workspaceOf, type Workspace } from "../access.js";

const VIEW_PERMS = ["listings.listing.read+listings.listing.create+listings.listing.update+listings.listing.delete+listings.listing.publish", "projects.project.read+projects.project.create+projects.project.update+projects.project.delete", "investments.offering.read+investments.offering.create+investments.offering.update+investments.offering.delete", "hotel.calendar.update", "workspace.billing.manage"];
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-04.").refine((s) => { const d = dayOf(s); return !Number.isNaN(d.getTime()) && ymd(d) === s; }, "That date doesn't exist.");
const Ask = z.object({ days: z.coerce.number().int().min(1).max(90), startOn: Day.optional() });
const big = { bodyLimit: 4 * 1024 * 1024 };
const FREE_APPS = SOFTWARE.filter((x) => x.free).flatMap((x) => x.apps);
const LIVE_LISTING = { status: "published" as const, reviewHold: false };

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
  /** On a paid plan: a paid subscription or a gift of software that isn't free, still running (the old plan system: a paid plan). */
  const onPaidPlan = async (tenantId: string) => {
    const now = new Date();
    const [subs, gift, t] = await Promise.all([
      db().subscription.findMany({ where: { tenantId, appId: { notIn: FREE_APPS }, uninstalledAt: null, currentPeriodEnd: { gt: now } }, select: { priceGrossPaisa: true } }),
      db().entitlementGrant.findFirst({ where: { tenantId, revokedAt: null, appId: { notIn: FREE_APPS }, startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] }, select: { id: true } }),
      db().tenant.findUnique({ where: { id: tenantId }, select: { billingMode: true, plan: { select: { price: true } } } }),
    ]);
    return subs.some((x) => Number(x.priceGrossPaisa ?? 0) > 0) || !!gift || (t?.billingMode !== "apps" && Number(t?.plan?.price ?? 0) > 0);
  };
  const NEED_PLAN = "Home page banners are for businesses on a plan (Starter, Business or Pro). Choose a plan first, then book.";
  const listingPhotos = (photos: { file: string }[]) => photos.slice(0, 5).map((p) => photoUrl(media, "main", p.file));
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
    const [s, rows, onPlan, choices] = await Promise.all([
      promoteSettings(db()), db().banner.findMany({ where: { tenantId: ws.tenantId }, orderBy: { createdAt: "desc" }, take: 200 }), onPaidPlan(ws.tenantId),
      // Published listings with photos, for "use one of my listings".
      db().listing.findMany({ where: { tenantId: ws.tenantId, ...LIVE_LISTING, photos: { some: {} } }, orderBy: { updatedAt: "desc" }, take: 300, select: { id: true, title: true, code: true, kind: true, photos: { orderBy: { sort: "asc" }, take: 5, select: { file: true } } } }),
    ]);
    const used = await db().listing.findMany({ where: { id: { in: rows.map((r) => r.listingId).filter((x): x is number => !!x) } }, select: { id: true, title: true, code: true, photos: { orderBy: { sort: "asc" }, take: 5, select: { file: true } } } });
    const L = new Map(used.map((l) => [l.id, l]));
    const inv = rows.map((b) => b.invoiceId).filter((x): x is string => !!x);
    const [invoices, checking] = await Promise.all([
      db().invoice.findMany({ where: { id: { in: inv } }, select: { id: true, seq: true, createdAt: true, status: true, total: true } }),
      db().payment.findMany({ where: { invoiceId: { in: inv }, status: "pending_review" }, select: { invoiceId: true } }),
    ]);
    const I = new Map(invoices.map((i) => [i.id, i]));
    const pending = new Set(checking.map((c) => c.invoiceId));
    return {
      data: {
        onPlan, choices: choices.map((l) => ({ id: l.id, title: l.title, code: l.code, kind: l.kind, photos: listingPhotos(l.photos) })),
        // The business page banner: the cover of each of the newest listings.
        page: { name: ws.member.tenant.name, photos: choices.slice(0, 5).map((l) => listingPhotos(l.photos)[0]!) },
        canBuy: ws.can("workspace.billing.manage"), price: s.hero.price, spots: s.hero.spots, active: s.hero.active, lengths: s.lengths, sizes: BANNER_SIZES, maxBytes: 1024 * 1024, today: today(),
        rows: rows.map((b) => {
          const i = b.invoiceId ? I.get(b.invoiceId) : undefined;
          const phase = bannerPhase(b, { checking: !!b.invoiceId && pending.has(b.invoiceId), invoiceOpen: i ? i.status === "open" : undefined });
          const l = b.listingId ? L.get(b.listingId) : undefined;
          return { id: b.id, no: bannerNo(b.seq), desktop: b.desktop ? pic(b.desktop) : null, mobile: b.mobile ? pic(b.mobile) : null,
            listing: l ? { id: l.id, title: l.title, code: l.code, photos: listingPhotos(l.photos) } : null,
            page: !b.desktop && !b.listingId ? { photos: choices.slice(0, 5).map((x) => listingPhotos(x.photos)[0]!) } : null, link: b.link, title: b.title, button: b.button, days: b.days, startOn: ymd(b.startOn), endOn: ymd(b.endOn), total: b.total,
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
    const raw = (request.body ?? {}) as { listingId?: unknown; page?: unknown };
    const fromListing = raw.listingId != null && raw.listingId !== "";
    const words = { title: BannerText.shape.title, button: BannerText.shape.button };
    const b = raw.page === true
      ? Ask.extend({ page: z.literal(true), ...words }).parse(request.body)
      : fromListing
        ? Ask.extend({ listingId: z.coerce.number().int().positive(), ...words }).parse(request.body)
        : Ask.extend({ ...BannerText.shape, desktop: Picture, mobile: Picture }).parse(request.body);
    const tenant = await db().tenant.findUniqueOrThrow({ where: { id: ws.tenantId } });
    if (tenant.status === "suspended" || tenant.status === "cancelled") throw badRequest("This business isn't active. Please contact Sheetal.");
    if (!(await onPaidPlan(ws.tenantId))) throw forbidden(NEED_PLAN);
    const q = await quote(b);
    let desktop = "", mobile = "", link = "", title = b.title, listingId: number | null = null;
    if ("page" in b) {
      // The business's own page: it needs at least one published listing with photos to show.
      const has = await db().listing.count({ where: { tenantId: ws.tenantId, ...LIVE_LISTING, photos: { some: {} } } });
      if (!has) throw badRequest("Publish at least one listing with photos first: the banner shows their photos.");
      link = `${app.config.SITE_URL.replace(/\/$/, "")}/site/${ws.tenantId}`; title = (b.title || tenant.name).slice(0, 80);
    } else if ("listingId" in b) {
      const l = await db().listing.findFirst({ where: { id: b.listingId, tenantId: ws.tenantId, ...LIVE_LISTING }, select: { id: true, slug: true, title: true, _count: { select: { photos: true } } } });
      if (!l) throw badRequest("Choose one of your published listings.");
      if (!l._count.photos) throw badRequest("This listing has no photos yet. Add photos first: the banner shows them.");
      listingId = l.id; link = `${app.config.SITE_URL.replace(/\/$/, "")}/property/${l.slug}`; title = (b.title || l.title).slice(0, 80);
    } else {
      [desktop, mobile] = [await saveBannerPicture(app.config.MEDIA_DIR, b.desktop.data, "desktop"), await saveBannerPicture(app.config.MEDIA_DIR, b.mobile.data, "mobile")];
      link = b.link;
    }
    const vatRate = (await billingSettings(db())).vatRate;
    const { banner, invoice } = await db().$transaction(async (tx) => {
      const banner = await tx.banner.create({ data: { tenantId: ws.tenantId, desktop, mobile, listingId, link, title, button: b.button, days: q.days, startOn: dayOf(q.startOn), endOn: dayOf(q.endOn), price: q.price, total: q.total, createdBy: ws.user.id } });
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
    const row = await db().banner.findFirst({ where: { id: request.params.id.slice(0, 40), tenantId: ws.tenantId } });
    if (!row) throw notFound("Banner not found.");
    // A listing or business page banner keeps its link; only its words can change.
    const fixed = !!row.listingId || !row.desktop;
    const b = (fixed ? BannerText.extend({ link: z.string().optional() }) : BannerText).extend({ desktop: Picture.optional(), mobile: Picture.optional() }).parse(request.body);
    if (!["awaiting", "review", "rejected"].includes(row.status)) throw badRequest("A banner that is approved or closed can't change. Book a new one.");
    const desktop = b.desktop ? await saveBannerPicture(app.config.MEDIA_DIR, b.desktop.data, "desktop") : row.desktop;
    const mobile = b.mobile ? await saveBannerPicture(app.config.MEDIA_DIR, b.mobile.data, "mobile") : row.mobile;
    const back = row.status === "rejected" ? "review" : row.status;
    await db().banner.update({ where: { id: row.id }, data: { desktop, mobile, link: fixed ? row.link : b.link!, title: b.title, button: b.button, status: back, reviewNote: back === "review" ? null : row.reviewNote } });
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
