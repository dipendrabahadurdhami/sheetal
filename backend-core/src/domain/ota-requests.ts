// Selling rooms on other sites (Booking.com, Airbnb, Agoda…) through Sheetal's partner accounts: the requests.
// Where it fits: the business API (business/backend/src/modules/ota) creates and answers requests; the admin API
// (admin/backend/src/modules/channels.ts) works the queue. Calendar sync with the sites is separate (domain/ota.ts).
// How it works: a business asks for one channel for one listing; Sheetal's channel team sets it up and marks it live
// with the property id and link. Every step is written to the request's log and the business is told (bell + email).
// Settings (sites on/off, site fee, Sheetal fee, mark-up, payout days, photos needed, types allowed) are AppSetting "ota".
// Rules: a site needs its partner account connected and switched on; one open or live request per listing and site.

import type { Prisma } from "@prisma/client";
import type { Db } from "../lib/db.js";
import type { Mailer } from "../lib/mailer.js";
import { AppError, badRequest, notFound } from "../lib/errors.js";
import { notify, notifyStaff, teamWith } from "../lib/notify.js";
import { ownerOf } from "./billing.js";

export const OTA_CHANNELS = [
  { id: "booking", name: "Booking.com", days: "3–5 days" }, { id: "airbnb", name: "Airbnb", days: "2–4 days" },
  { id: "agoda", name: "Agoda", days: "5–7 days" }, { id: "expedia", name: "Expedia", days: "7–10 days" },
  { id: "trip", name: "Trip.com", days: "5–7 days" }, { id: "google", name: "Google Hotels", days: "1–2 days" },
] as const;
export type OtaChannel = (typeof OTA_CHANNELS)[number]["id"];
export const channelName = (id: string) => OTA_CHANNELS.find((c) => c.id === id)?.name ?? id;
export const isChannel = (id: string): id is OtaChannel => OTA_CHANNELS.some((c) => c.id === id);

export const OTA_STATUSES = ["requested", "setting_up", "needs_info", "live", "paused", "rejected"] as const;
export type OtaStatus = (typeof OTA_STATUSES)[number];
/** Still being worked on by the team (or waiting for the business). */
export const OPEN_STATUSES: OtaStatus[] = ["requested", "setting_up", "needs_info"];
/** A business may ask again for a channel in these states (or with no request). */
export const CAN_ASK: OtaStatus[] = ["paused", "rejected"];

export interface SiteSettings { on: boolean; commission: number; fee: number; markup: number }
export interface OtaSettings { payoutDays: number; minPhotos: number; types: Record<string, boolean>; sites: Record<string, SiteSettings> }
export const OTA_DEFAULTS: OtaSettings = {
  payoutDays: 7, minPhotos: 8, types: { hotel: true, host: true },
  sites: {
    booking: { on: true, commission: 15, fee: 2, markup: 15 }, airbnb: { on: true, commission: 3, fee: 2, markup: 10 },
    agoda: { on: true, commission: 15, fee: 2, markup: 15 }, expedia: { on: false, commission: 18, fee: 2, markup: 18 },
    trip: { on: true, commission: 15, fee: 2, markup: 15 }, google: { on: true, commission: 0, fee: 1, markup: 0 },
  },
};

type Stored = Partial<Omit<OtaSettings, "sites" | "types">> & { types?: Record<string, boolean>; sites?: Record<string, Partial<SiteSettings>> };
/** What staff saved, merged over the defaults. */
export async function otaSettings(db: Db): Promise<OtaSettings> {
  const s = ((await db.appSetting.findUnique({ where: { key: "ota" } }))?.value ?? {}) as Stored;
  return {
    ...OTA_DEFAULTS, ...s, types: { ...OTA_DEFAULTS.types, ...(s.types ?? {}) },
    sites: Object.fromEntries(OTA_CHANNELS.map((c) => [c.id, { ...OTA_DEFAULTS.sites[c.id]!, ...(s.sites?.[c.id] ?? {}) }])),
  };
}
export async function saveOtaSettings(db: Db, v: OtaSettings) {
  const value = v as unknown as Prisma.InputJsonValue;
  await db.appSetting.upsert({ where: { key: "ota" }, create: { key: "ota", value }, update: { value } });
}

/** Partner accounts: channel → connected? (no row = not connected). */
export async function otaAccounts(db: Db): Promise<Record<string, { status: string; note: string }>> {
  const rows = await db.otaAccount.findMany();
  return Object.fromEntries(OTA_CHANNELS.map((c) => { const r = rows.find((x) => x.channel === c.id); return [c.id, { status: r?.status ?? "not_connected", note: r?.note ?? "" }]; }));
}

export const otaRef = (seq: number) => `OTA-${String(seq).padStart(4, "0")}`;
export interface LogLine { at: string; who: string; what: string; files?: string[] }
const line = (who: string, what: string, files?: string[]): LogLine => ({ at: new Date().toISOString(), who, what, ...(files?.length ? { files } : {}) });
export const logOf = (r: { log: Prisma.JsonValue }) => (Array.isArray(r.log) ? (r.log as unknown as LogLine[]) : []);

/** What the business sees: no internal fields. */
export const presentRequest = (r: { id: string; seq: number; tenantId: string; branchId: string | null; listingId: number | null; channel: string; status: string; price: number; note: string | null; ask: string | null; otaPropertyId: string | null; url: string | null; log: Prisma.JsonValue; createdAt: Date; updatedAt: Date }) => ({
  id: r.id, ref: otaRef(r.seq), tenantId: r.tenantId, branchId: r.branchId, listingId: r.listingId, channel: r.channel, status: r.status, price: r.price,
  note: r.note ?? "", ask: r.ask ?? "", otaPropertyId: r.otaPropertyId ?? "", url: r.url ?? "", log: logOf(r), createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
});

/** A business asks Sheetal to post a listing on one site. */
export async function askForChannel(db: Db, o: { tenant: { id: string; name: string; type: string }; listingId: number; channel: string; price: number; note?: string; who: string }) {
  if (!isChannel(o.channel)) throw badRequest("Pick one of the listed sites.");
  const [set, acc] = await Promise.all([otaSettings(db), otaAccounts(db)]);
  if (set.types[o.tenant.type] !== true) throw badRequest("Selling on other sites isn't available for this business type yet.");
  if (!set.sites[o.channel]!.on || acc[o.channel]!.status !== "connected") throw badRequest(`${channelName(o.channel)} isn't available yet. Sheetal will tell you when it is.`);
  const listing = await db.listing.findFirst({ where: { id: o.listingId, tenantId: o.tenant.id }, select: { id: true, title: true, kind: true, branchId: true, _count: { select: { photos: true } } } });
  if (!listing) throw notFound("That listing isn't in this business.");
  if (!listing.kind.startsWith("stay")) throw badRequest("Only stays (hotel rooms and units) can be sold on other sites.");
  if (listing._count.photos < set.minPhotos) throw badRequest(`Add at least ${set.minPhotos} photos first. This listing has ${listing._count.photos}.`);
  const busy = await db.otaRequest.findFirst({ where: { tenantId: o.tenant.id, listingId: listing.id, channel: o.channel, status: { in: [...OPEN_STATUSES, "live"] } } });
  if (busy) throw new AppError(409, "ota_exists", `${channelName(o.channel)} already has a request for this listing.`);
  const r = await db.otaRequest.create({ data: { tenantId: o.tenant.id, branchId: listing.branchId, listingId: listing.id, channel: o.channel, price: o.price, note: o.note || null, log: [line(o.who, `Asked Sheetal to post on ${channelName(o.channel)}${o.note ? `: ${o.note}` : ""}`)] as unknown as Prisma.InputJsonValue } });
  await notifyStaff(db, "platform.business.read+platform.business.create+platform.business.update", { type: "ota", title: `${channelName(o.channel)} request: ${o.tenant.name}`, message: `${otaRef(r.seq)} · ${listing.title}`, link: "/admin/channels" });
  return r;
}

/** The business answers a "needs info" question; the team carries on. */
export async function replyToRequest(db: Db, o: { tenantId: string; id: string; who: string; text: string; files: string[] }) {
  const r = await db.otaRequest.findFirst({ where: { id: o.id, tenantId: o.tenantId } });
  if (!r) throw notFound("That request isn't in this business.");
  if (r.status !== "needs_info") throw badRequest("Sheetal isn't waiting for a reply on this one.");
  const upd = await db.otaRequest.update({ where: { id: r.id }, data: { status: "setting_up", log: [...logOf(r), line(o.who, `Replied${o.text ? `: ${o.text}` : ""}${o.files.length ? ` (${o.files.length} file${o.files.length > 1 ? "s" : ""} added)` : ""}`, o.files)] as unknown as Prisma.InputJsonValue } });
  await notifyStaff(db, "platform.business.read+platform.business.create+platform.business.update", { type: "ota", title: `Reply on ${otaRef(r.seq)}`, message: channelName(r.channel), link: "/admin/channels" });
  return upd;
}

/** The business stops (or cancels) selling on a site. */
export async function pauseRequest(db: Db, o: { tenantId: string; id: string; who: string }) {
  const r = await db.otaRequest.findFirst({ where: { id: o.id, tenantId: o.tenantId } });
  if (!r) throw notFound("That request isn't in this business.");
  if (r.status === "paused" || r.status === "rejected") throw badRequest("This one is already stopped.");
  const upd = await db.otaRequest.update({ where: { id: r.id }, data: { status: "paused", log: [...logOf(r), line(o.who, r.status === "live" ? "Asked to stop selling" : "Cancelled")] as unknown as Prisma.InputJsonValue } });
  await notifyStaff(db, "platform.business.read+platform.business.create+platform.business.update", { type: "ota", title: `${r.status === "live" ? "Take down" : "Cancelled"}: ${otaRef(r.seq)}`, message: channelName(r.channel), link: "/admin/channels" });
  return upd;
}

export interface StatusChange { id: string; status: OtaStatus; note?: string; ask?: string; otaPropertyId?: string; url?: string; who: string; siteUrl: string }

/** Staff move a request on. Tells the business with a bell and an email. */
export async function setRequestStatus(db: Db, mailer: Mailer, o: StatusChange) {
  const r = await db.otaRequest.findUnique({ where: { id: o.id } });
  if (!r) throw notFound("That request doesn't exist.");
  if (o.status === "requested") throw badRequest("A request can't go back to requested.");
  if (o.status === "needs_info" && !o.ask?.trim()) throw badRequest("Write the question for the business.");
  if (o.status === "rejected" && !o.note?.trim()) throw badRequest("Write the reason for the business.");
  if (o.status === "live") {
    if (!o.otaPropertyId?.trim()) throw badRequest("Enter the property id on that site.");
    if (!/^https?:\/\/\S+$/i.test(o.url ?? "")) throw badRequest("Enter the link to the live page (starting with https://).");
  }
  const ch = channelName(r.channel);
  const what = { setting_up: "Being set up", needs_info: `Asked the business: ${o.ask?.trim()}`, live: `Marked live (${o.otaPropertyId?.trim()})`, paused: "Paused", rejected: `Rejected: ${o.note?.trim()}` }[o.status as Exclude<OtaStatus, "requested">];
  const data: Prisma.OtaRequestUpdateInput = { status: o.status, log: [...logOf(r), line(o.who, `${what}${o.note?.trim() && o.status !== "rejected" ? ` · ${o.note.trim()}` : ""}`)] as unknown as Prisma.InputJsonValue };
  if (o.status === "needs_info") data.ask = o.ask!.trim();
  if (o.status === "rejected") data.ask = o.note!.trim();
  if (o.status === "live") { data.otaPropertyId = o.otaPropertyId!.trim(); data.url = o.url!.trim(); data.ask = null; }
  const upd = await db.otaRequest.update({ where: { id: r.id }, data });

  const message = {
    setting_up: `The team is setting up your listing on ${ch}.`, needs_info: `The team needs an answer to carry on: ${o.ask?.trim()}`,
    live: `Your listing is live on ${ch}. Bookings from there appear in Bookings.`, paused: `Your listing on ${ch} has been paused.`,
    rejected: `Sheetal can't post this listing on ${ch}: ${o.note?.trim()}`,
  }[o.status as Exclude<OtaStatus, "requested">];
  const tenant = await db.tenant.findUnique({ where: { id: r.tenantId }, select: { id: true, name: true, email: true } });
  if (tenant) {
    await notify(db, await teamWith(db, tenant.id, ["hotel.calendar.update", "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete"], r.branchId), { tenantId: tenant.id, type: "ota", title: `${ch}: ${STATUS_WORDS[o.status]}`, message, link: "/business/listings" });
    const owner = await ownerOf(db, tenant.id);
    const to = owner?.email ?? tenant.email;
    const link = `${o.siteUrl.replace(/\/$/, "")}/business/listings`;
    if (to) await mailer.send({ to, subject: `Your listing on ${ch}: ${STATUS_WORDS[o.status]}`, text: `Namaste ${owner?.userName ?? tenant.name},\n\n${message}\n\n${link}\n\nSheetal Property`, template: { key: "ota_update", vars: { name: owner?.userName ?? tenant.name, channel: ch, status: STATUS_WORDS[o.status], message, link } } });
  }
  return upd;
}
const STATUS_WORDS: Record<OtaStatus, string> = { requested: "Requested", setting_up: "Being set up", needs_info: "Needs your reply", live: "Live", paused: "Paused", rejected: "Rejected" };
export const statusWord = (s: string) => STATUS_WORDS[s as OtaStatus] ?? s;
