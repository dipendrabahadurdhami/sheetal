// Promote (Business → Promote): boost a listing on the website, follow how boosts do, move or stop them, and pick the
// listings that use the plan's free featured slots.
// Where it fits: LivePromote.jsx; the Boost buttons on Listings open it with the listing picked. Rules and the
// spot-counting are in backend-core/src/domain/promote.ts. Paying uses the normal billing checkout with the invoice.
// How it works: GET returns the places with their price and spots, the business's listings on the website, its boosts
// (with views, clicks and the leads that came in on the listing while boosted) and its featured slots. A quote gives the
// first start date with a free spot. Buying makes the boost and its invoice together; the boost holds its spot while
// the business pays, and starts by itself once paid. Moving puts the days left on another listing; stopping ends it.
// Rules: billing.manage buys and cancels unpaid boosts; everyone who can open Promote moves and stops boosts and picks
// featured listings; people limited to some branches only see and use their branches' listings. No refunds.

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { dbOf } from "@sheetal/backend-core/lib/db";
import { badRequest, forbidden, notFound } from "@sheetal/backend-core/lib/errors";
import { dayOf, ymd } from "@sheetal/backend-core/domain/money";
import { effectiveLimits } from "@sheetal/backend-core/domain/addons";
import { billingSettings, createAddonInvoice, invoiceNumber } from "@sheetal/backend-core/domain/billing";
import { PHASE_LABEL, PLACES, PLACE_LABEL, PLACE_SUB, SEARCH_KINDS, addDays, boostLine, boostNo, nextFreeStart, phaseOf, promoteSettings, takenToday, today, type Place } from "@sheetal/backend-core/domain/promote";
import { branchView, inView, workspaceOf, type Workspace } from "../access.js";

const VIEW_PERMS = ["listings.listing.read+listings.listing.create+listings.listing.update+listings.listing.delete+listings.listing.publish", "projects.project.read+projects.project.create+projects.project.update+projects.project.delete", "investments.offering.read+investments.offering.create+investments.offering.update+investments.offering.delete", "hotel.calendar.update", "workspace.billing.manage"];
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-04.").refine((s) => { const d = dayOf(s); return !Number.isNaN(d.getTime()) && ymd(d) === s; }, "That date doesn't exist.");
const Ask = z.object({ listingId: z.coerce.number().int().positive(), place: z.enum(PLACES), days: z.coerce.number().int().min(1).max(90), startOn: Day.optional() });
const ON_SITE = ["published"];

export async function promoteRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const viewer = (request: FastifyRequest) => {
    const ws = workspaceOf(request);
    if (!VIEW_PERMS.some((p) => ws.can(p))) throw forbidden("Your role can't promote listings.");
    return ws;
  };
  const payer = (ws: Workspace) => { if (!ws.can("workspace.billing.manage")) throw forbidden("Only people who manage billing can buy boosts. Ask the owner."); };
  const scope = async (ws: Workspace, request: FastifyRequest) => ({ tenantId: ws.tenantId, ...inView(await branchView(db(), request, ws)) });
  const listingOf = async (ws: Workspace, request: FastifyRequest, id: number) => {
    const l = await db().listing.findFirst({ where: { ...(await scope(ws, request)), id }, select: { id: true, code: true, title: true, kind: true, city: true, status: true, reviewHold: true, featured: true } });
    if (!l) throw notFound("Listing not found.");
    return l;
  };
  const onSite = (l: { status: string; reviewHold: boolean }) => ON_SITE.includes(l.status) && !l.reviewHold;
  const fitPlace = (l: { kind: string; city: string | null; code: string }, place: Place) => {
    if (place !== "home" && !SEARCH_KINDS.includes(l.kind)) throw badRequest("Search and city boosts are for listings on the buy and rent pages. Use the home page for this one.");
    if (place === "city" && !l.city?.trim()) throw badRequest(`${l.code} has no city. Add the city to the listing first.`);
  };
  const audit = (ws: Workspace, ip: string, action: string, target: string) => db().auditLog.create({ data: { tenantId: ws.tenantId, actorId: ws.user.id, action, target, ip } });

  /** Price and the first free start for a boost. */
  const quote = async (q: z.infer<typeof Ask>, l: { city: string | null }, exceptId?: string) => {
    const s = await promoteSettings(db());
    const p = s[q.place];
    if (!p.active) throw badRequest(`${PLACE_LABEL[q.place]} isn't on sale right now.`);
    if (!s.lengths.includes(q.days)) throw badRequest(`Choose ${s.lengths.join(", ")} days.`);
    const from = q.startOn && q.startOn > today() ? q.startOn : today();
    const start = await nextFreeStart(db(), { place: q.place, city: l.city, days: q.days, from, spots: p.spots, exceptId });
    if (!start) throw badRequest("This place is booked for the next year. Try another place.");
    const vat = (await billingSettings(db())).vatRate;
    const total = p.price * q.days;
    return { place: q.place, days: q.days, price: p.price, total, vat: Math.round((total * vat) / (100 + vat)), startOn: start, endOn: addDays(start, q.days - 1), asked: from, moved: start !== from };
  };

  app.get("/promote", async (request) => {
    const ws = viewer(request);
    const where = await scope(ws, request);
    const [s, tenant, listings, boosts, taken] = await Promise.all([
      promoteSettings(db()),
      db().tenant.findUniqueOrThrow({ where: { id: ws.tenantId }, include: { plan: true } }),
      db().listing.findMany({ where: { ...where, status: { in: ["published", "sold", "rented"] } }, orderBy: { publishedAt: "desc" }, take: 2000, select: { id: true, code: true, title: true, kind: true, city: true, status: true, reviewHold: true, featured: true, publishedAt: true } }),
      db().boost.findMany({ where: { tenantId: ws.tenantId }, orderBy: { createdAt: "desc" }, take: 500 }),
      takenToday(db()),
    ]);
    const lim = await effectiveLimits(db(), ws.tenantId, tenant.plan);
    const featuredLimit = Number((lim.limits as Record<string, number>).featured ?? 0);
    const byId = new Map(listings.map((l) => [l.id, l]));
    // Boosts on listings that left the website (or other branches' listings, which stay hidden from branch people).
    const extra = await db().listing.findMany({ where: { ...where, id: { in: boosts.filter((b) => !byId.has(b.listingId)).map((b) => b.listingId) } }, select: { id: true, code: true, title: true, kind: true, city: true, status: true, reviewHold: true, featured: true, publishedAt: true } });
    for (const l of extra) byId.set(l.id, l);
    const mine = boosts.filter((b) => byId.has(b.listingId));
    const invIds = mine.map((b) => b.invoiceId).filter((x): x is string => !!x);
    const [invoices, checking, leads] = await Promise.all([
      db().invoice.findMany({ where: { id: { in: invIds } }, select: { id: true, seq: true, createdAt: true, status: true, total: true } }),
      db().payment.findMany({ where: { invoiceId: { in: invIds }, status: "pending_review" }, select: { invoiceId: true } }),
      db().lead.findMany({ where: { tenantId: ws.tenantId, listingId: { in: [...new Set(mine.map((b) => b.listingId))] }, createdAt: { gte: mine.length ? new Date(Math.min(...mine.map((b) => b.startOn.getTime()))) : new Date() } }, select: { listingId: true, createdAt: true } }),
    ]);
    const inv = new Map(invoices.map((i) => [i.id, i]));
    const pending = new Set(checking.map((c) => c.invoiceId));
    const day = today();
    return {
      data: {
        today: day, canBuy: ws.can("workspace.billing.manage"), vatRate: (await billingSettings(db())).vatRate,
        lengths: s.lengths,
        places: PLACES.map((p) => ({ id: p, label: PLACE_LABEL[p], sub: PLACE_SUB[p], price: s[p].price, spots: s[p].spots, active: s[p].active, takenToday: p === "city" ? null : taken[p] })),
        cityTaken: taken.city,
        featured: { limit: featuredLimit, used: listings.filter((l) => l.featured && onSite(l)).length },
        listings: listings.map((l) => ({ id: l.id, code: l.code, title: l.title, kind: l.kind, city: l.city, onSite: onSite(l), status: l.status, featured: l.featured, searchable: SEARCH_KINDS.includes(l.kind) })),
        boosts: mine.map((b) => {
          const l = byId.get(b.listingId);
          const i = b.invoiceId ? inv.get(b.invoiceId) : undefined;
          const phase = phaseOf(b, { day, listingLive: !!l && onSite(l), checking: !!b.invoiceId && pending.has(b.invoiceId), invoiceOpen: i ? i.status === "open" : undefined });
          const start = ymd(b.startOn), end = ymd(b.endOn);
          const leadsIn = leads.filter((x) => x.listingId === b.listingId && ymd(x.createdAt) >= start && ymd(x.createdAt) <= end).length;
          return {
            id: b.id, no: boostNo(b.seq), listingId: b.listingId, code: l?.code ?? "", title: l?.title ?? "", place: b.place, placeLabel: PLACE_LABEL[b.place as Place], city: l?.city ?? b.city,
            days: b.days, startOn: start, endOn: end, daysLeft: phase === "live" || phase === "listing_off" ? Math.max(0, Math.round((b.endOn.getTime() - dayOf(day).getTime()) / 864e5) + 1) : phase === "scheduled" ? b.days : 0,
            price: b.price, total: b.total, source: b.source, phase, phaseLabel: PHASE_LABEL[phase], views: b.views, clicks: b.clicks, leads: leadsIn, history: b.history,
            invoice: i ? { id: i.id, number: invoiceNumber(i), status: i.status, total: i.total } : null,
          };
        }),
      },
    };
  });

  app.get("/promote/quote", async (request) => {
    const ws = viewer(request);
    const q = Ask.parse(request.query);
    const l = await listingOf(ws, request, q.listingId);
    fitPlace(l, q.place);
    return { data: await quote(q, l) };
  });

  // Makes the boost and its invoice; the boost keeps its spot while the business pays.
  app.post("/promote/boosts", async (request) => {
    const ws = viewer(request); payer(ws);
    const q = Ask.parse(request.body);
    const l = await listingOf(ws, request, q.listingId);
    if (!onSite(l)) throw badRequest(`${l.code} isn't on the website now. Only listings people can see can be boosted.`);
    fitPlace(l, q.place);
    const clash = await db().boost.findFirst({ where: { listingId: l.id, place: q.place, status: { in: ["paid", "awaiting"] }, endOn: { gte: dayOf(today()) } }, select: { seq: true, status: true } });
    if (clash) throw badRequest(`${l.code} already has a ${clash.status === "paid" ? "" : "waiting "}boost here (${boostNo(clash.seq)}). Pick another place, or another listing.`);
    const tenant = await db().tenant.findUniqueOrThrow({ where: { id: ws.tenantId } });
    if (tenant.status === "suspended" || tenant.status === "cancelled") throw badRequest("This business isn't active. Please contact Sheetal.");
    const qt = await quote(q, l);
    const city = q.place === "city" ? (l.city ?? "").trim() : "";
    const vatRate = (await billingSettings(db())).vatRate;
    const { invoice, boost } = await db().$transaction(async (tx) => {
      const invoice = await createAddonInvoice(tx, { tenant, lines: [boostLine({ place: q.place, days: q.days, price: qt.price, code: l.code, city })], by: ws.user.id, vatRate });
      await tx.invoice.update({ where: { id: invoice.id }, data: { kind: "boost", months: 1, periodStart: dayOf(qt.startOn), periodEnd: dayOf(qt.endOn), dueAt: new Date(Date.now() + 864e5) } });
      const boost = await tx.boost.create({ data: { tenantId: ws.tenantId, listingId: l.id, place: q.place, city: city.toLowerCase(), days: q.days, startOn: dayOf(qt.startOn), endOn: dayOf(qt.endOn), price: qt.price, total: qt.total, invoiceId: invoice.id, createdBy: ws.user.id } });
      return { invoice, boost };
    });
    await audit(ws, request.ip, "promote.boost_created", `${boostNo(boost.seq)} ${l.code} ${q.place} ${q.days}d ${invoiceNumber(invoice)}`);
    return {
      message: `${PLACE_LABEL[q.place]} for ${l.code}, ${qt.startOn} to ${qt.endOn}. Pay ${invoiceNumber(invoice)} (Rs. ${invoice.total.toLocaleString("en-IN")}) to start it.`,
      data: { id: boost.id, no: boostNo(boost.seq), invoiceId: invoice.id, number: invoiceNumber(invoice), total: invoice.total, startOn: qt.startOn, endOn: qt.endOn },
    };
  });

  // An unpaid boost: cancelling frees its spot (and cancels the invoice).
  app.post<{ Params: { id: string } }>("/promote/boosts/:id/cancel", async (request) => {
    const ws = viewer(request); payer(ws);
    const b = await db().boost.findFirst({ where: { id: request.params.id.slice(0, 40), tenantId: ws.tenantId } });
    if (!b) throw notFound("Boost not found.");
    if (b.status !== "awaiting") throw badRequest(b.status === "paid" ? "This boost is paid. You can stop it or move it to another listing." : "This boost is already closed.");
    if (b.invoiceId && await db().payment.findFirst({ where: { invoiceId: b.invoiceId, status: "pending_review" } })) throw badRequest("A bank transfer for it is being checked. Wait for Sheetal's answer.");
    await db().$transaction([
      db().boost.update({ where: { id: b.id }, data: { status: "void" } }),
      ...(b.invoiceId ? [db().invoice.updateMany({ where: { id: b.invoiceId, status: "open" }, data: { status: "void" } })] : []),
    ]);
    await audit(ws, request.ip, "promote.boost_cancelled", boostNo(b.seq));
    return { message: `${boostNo(b.seq)} cancelled. Nothing was paid.` };
  });

  // A paid boost ends now. No refund.
  app.post<{ Params: { id: string } }>("/promote/boosts/:id/stop", async (request) => {
    const ws = viewer(request);
    const b = await db().boost.findFirst({ where: { id: request.params.id.slice(0, 40), tenantId: ws.tenantId } });
    if (!b) throw notFound("Boost not found.");
    if (b.status !== "paid" || ymd(b.endOn) < today()) throw badRequest("Only running or upcoming boosts can be stopped.");
    await db().boost.update({ where: { id: b.id }, data: { status: "stopped", stoppedAt: new Date() } });
    await audit(ws, request.ip, "promote.boost_stopped", boostNo(b.seq));
    return { message: `${boostNo(b.seq)} stopped. The money isn't refunded.` };
  });

  // The days left go to another listing of the business (same place; a city boost stays in its city).
  app.post<{ Params: { id: string } }>("/promote/boosts/:id/move", async (request) => {
    const ws = viewer(request);
    const { listingId } = z.object({ listingId: z.number().int().positive() }).parse(request.body);
    const b = await db().boost.findFirst({ where: { id: request.params.id.slice(0, 40), tenantId: ws.tenantId } });
    if (!b) throw notFound("Boost not found.");
    if (b.status !== "paid" || ymd(b.endOn) < today()) throw badRequest("Only running or upcoming boosts can be moved.");
    if (b.listingId === listingId) throw badRequest("It's already on that listing.");
    const l = await listingOf(ws, request, listingId);
    if (!onSite(l)) throw badRequest(`${l.code} isn't on the website now. Pick a listing people can see.`);
    fitPlace(l, b.place as Place);
    if (b.place === "city" && (l.city ?? "").trim().toLowerCase() !== b.city) throw badRequest(`This boost is for the ${b.city} city page. Pick a listing in ${b.city}.`);
    const clash = await db().boost.findFirst({ where: { id: { not: b.id }, listingId: l.id, place: b.place, status: "paid", endOn: { gte: dayOf(today()) } }, select: { seq: true } });
    if (clash) throw badRequest(`${l.code} already has a boost here (${boostNo(clash.seq)}).`);
    const old = await db().listing.findUnique({ where: { id: b.listingId }, select: { code: true } });
    const history = [...((b.history ?? []) as Prisma.JsonArray), { listingId: b.listingId, code: old?.code ?? "", at: new Date().toISOString() }];
    await db().boost.update({ where: { id: b.id }, data: { listingId: l.id, history: history as Prisma.InputJsonValue } });
    await audit(ws, request.ip, "promote.boost_moved", `${boostNo(b.seq)} ${old?.code ?? b.listingId} → ${l.code}`);
    return { message: `${boostNo(b.seq)} moved to ${l.code} for the days left.` };
  });

  // The plan's free featured slots: listings in the home row after the paid boosts.
  app.put<{ Params: { id: string } }>("/promote/featured/:id", async (request) => {
    const ws = viewer(request);
    const { on } = z.object({ on: z.boolean() }).parse(request.body);
    const l = await listingOf(ws, request, Number(request.params.id) || 0);
    if (on && !l.featured) {
      if (!onSite(l)) throw badRequest(`${l.code} isn't on the website now.`);
      const t = await db().tenant.findUniqueOrThrow({ where: { id: ws.tenantId }, include: { plan: true } });
      const lim = Number(((await effectiveLimits(db(), ws.tenantId, t.plan)).limits as Record<string, number>).featured ?? 0);
      const used = await db().listing.count({ where: { tenantId: ws.tenantId, featured: true, status: "published", reviewHold: false } });
      if (lim !== -1 && used >= lim) throw badRequest(lim ? `Your plan has ${lim} free featured slots, all in use. Take one off, buy more slots in Billing → Add-ons, or boost the listing.` : "Your plan has no free featured slots. Upgrade, or boost the listing.");
    }
    await db().listing.update({ where: { id: l.id }, data: { featured: on } });
    await audit(ws, request.ip, on ? "promote.featured_on" : "promote.featured_off", l.code);
    return { message: on ? `${l.code} is in the featured row on the home page.` : `${l.code} is out of the featured row.` };
  });
}
