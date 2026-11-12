// Home page banners: the big picture behind the title and search on the website's home page. Businesses book and pay
// for days there (Business → Promote → Home banner); Sheetal staff check the picture before it shows, and can add
// Sheetal's own banners (Admin → Promote → Banners).
// Where it fits: business/backend/src/modules/promote/banners.ts (booking), admin/backend/src/modules/promote.ts
// (review, own banners), website/backend/src/modules/banners (what shows, views and clicks).
// How it works: the "hero" place has a price a day and a number of spots (banners that slide in turn, 3 by default).
// A booking makes a "banner" invoice; once paid (gateway, or a bank transfer staff confirm) the banner waits for the
// picture check; approved, it shows on its dates by itself (approved after its start, it starts that day and keeps its
// days). A rejected picture can be replaced and goes back to the check. Sheetal's own banners show only when paid
// ones leave a spot free.
// Rules: pictures are JPG, PNG, WebP or GIF (GIFs may move), at most 1 MB, at the exact sizes below, kept as sent.
// The link must be a web address (https). No refunds when a banner is stopped.

import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import type { Db } from "@sheetal/platform/db/client";
import { AppError, badRequest } from "@sheetal/platform/core/errors";
import { writeAtomic } from "../lib/photos.js";
import { putObject } from "@sheetal/platform/files/storage";
import { dayOf, ymd } from "./money.js";
import { addDays, promoteSettings, today } from "./promote.js";

type Tx = Db | Prisma.TransactionClient;
export const BANNER_SIZES = { desktop: { width: 1920, height: 600 }, mobile: { width: 1080, height: 1080 } } as const;
export const BANNER_MAX_BYTES = 1024 * 1024;
export const bannerNo = (seq: number) => `BN-${String(seq).padStart(4, "0")}`;
const HOLD_MS = 2 * 3_600_000;

export const BannerText = z.object({
  link: z.string().trim().max(500).regex(/^https?:\/\/[^\s]+\.[^\s]+$/i, "Use a web address like https://example.com."),
  title: z.string().trim().max(80).default(""),
  button: z.string().trim().max(24).default(""),
});
export const Picture = z.object({ data: z.string().min(16).max(1_500_000) });

const KIND: [string, string, (b: Buffer) => boolean][] = [
  ["jpg", "image/jpeg", (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ["png", "image/png", (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ["webp", "image/webp", (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP"],
  ["gif", "image/gif", (b) => b.subarray(0, 4).toString("latin1") === "GIF8"],
];

/** Checks a banner picture (type, size on disk, exact pixel size) and saves it untouched. Returns the file name. */
export async function saveBannerPicture(mediaDir: string | undefined, base64: string, which: keyof typeof BANNER_SIZES) {
  if (!mediaDir) throw new AppError(503, "storage_off", "Picture uploads aren't set up on this server yet.");
  const data = Buffer.from(base64, "base64");
  const label = which === "desktop" ? "The computer picture" : "The phone picture";
  if (data.length > BANNER_MAX_BYTES) throw badRequest(`${label} is over 1 MB. Save it smaller and try again.`);
  const k = KIND.find(([, , test]) => data.length > 12 && test(data));
  if (!k) throw badRequest(`${label} must be a JPG, PNG, WebP or GIF.`);
  const meta = await sharp(data, { failOn: "none", animated: true }).metadata().catch(() => null);
  const want = BANNER_SIZES[which];
  const height = meta?.pageHeight ?? meta?.height;
  if (!meta?.width || !height) throw badRequest(`${label} can't be opened. Save it again and try once more.`);
  if (meta.width !== want.width || height !== want.height) throw badRequest(`${label} must be exactly ${want.width} × ${want.height} pixels (it is ${meta.width} × ${height}).`);
  const name = `${randomBytes(12).toString("base64url")}.${k[0]}`;
  const dir = join(mediaDir, "banner", "main");
  await mkdir(dir, { recursive: true });
  await writeAtomic(join(dir, name), data);
  await putObject(`banner/main/${name}`, data, k[1]);
  return name;
}

/** Paid banners that hold a spot on these days: unpaid ones for a short while (or while a bank transfer is checked),
 *  paid ones waiting for the picture check, and approved ones. */
async function held(db: Tx, from: string, to: string, exceptId?: string) {
  const rows = await db.banner.findMany({
    where: { source: "paid", id: exceptId ? { not: exceptId } : undefined, startOn: { lte: dayOf(to) }, endOn: { gte: dayOf(from) }, status: { in: ["awaiting", "review", "rejected", "approved"] } },
    select: { id: true, status: true, startOn: true, endOn: true, createdAt: true, invoiceId: true },
  });
  const waiting = rows.filter((r) => r.status === "awaiting" && r.invoiceId).map((r) => r.invoiceId!);
  const [checking, open] = waiting.length ? await Promise.all([
    db.payment.findMany({ where: { invoiceId: { in: waiting }, status: "pending_review" }, select: { invoiceId: true } }).then((x) => new Set(x.map((p) => p.invoiceId))),
    db.invoice.findMany({ where: { id: { in: waiting }, status: "open" }, select: { id: true } }).then((x) => new Set(x.map((i) => i.id))),
  ]) : [new Set<string>(), new Set<string>()];
  const now = Date.now();
  return rows.filter((r) => r.status !== "awaiting" || (open.has(r.invoiceId!) && (checking.has(r.invoiceId!) || now - r.createdAt.getTime() < HOLD_MS)));
}

/** The first start day (from `from`) with a free spot on all `days` days, up to a year ahead. */
export async function bannerFreeStart(db: Tx, o: { days: number; from?: string; spots: number; exceptId?: string }) {
  const from = o.from ?? today();
  const rows = await held(db, from, addDays(from, 365 + o.days), o.exceptId);
  const used = new Map<string, number>();
  for (const b of rows) for (let d = ymd(b.startOn); d <= ymd(b.endOn); d = addDays(d, 1)) used.set(d, (used.get(d) ?? 0) + 1);
  for (let s = from; s <= addDays(from, 365); s = addDays(s, 1)) {
    let ok = true;
    for (let i = 0; i < o.days && ok; i++) if ((used.get(addDays(s, i)) ?? 0) >= o.spots) ok = false;
    if (ok) return s;
  }
  return null;
}

/** What shows on the home page today: approved paid banners (in the order they were paid), then Sheetal's own. */
export async function liveBanners(db: Tx) {
  const s = await promoteSettings(db);
  const d = dayOf(today());
  const rows = await db.banner.findMany({ where: { status: "approved", startOn: { lte: d }, endOn: { gte: d } }, orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }] });
  const paid = rows.filter((r) => r.source === "paid");
  const own = rows.filter((r) => r.source === "staff");
  return [...paid, ...own].slice(0, Math.max(1, s.hero.spots));
}

/** A paid banner invoice: its banner goes to the picture check (staff are told by the caller). */
export async function payBanners(tx: Tx, invoiceId: string, now = new Date()) {
  const rows = await tx.banner.findMany({ where: { invoiceId, status: "awaiting" } });
  for (const b of rows) await tx.banner.update({ where: { id: b.id }, data: { status: "review", paidAt: now } });
  return rows.length;
}

/** Approving after the planned start: the banner starts today and keeps its days. */
export const approvedDates = (b: { startOn: Date; days: number }) => {
  const day = today();
  return ymd(b.startOn) < day ? { startOn: dayOf(day), endOn: dayOf(addDays(day, b.days - 1)) } : {};
};

export type BannerPhase = "awaiting" | "checking" | "review" | "rejected" | "scheduled" | "live" | "ended" | "stopped" | "cancelled";
export const BANNER_PHASE: Record<BannerPhase, string> = {
  awaiting: "Waiting for payment", checking: "Bank transfer being checked", review: "Picture being checked", rejected: "Picture needs a change",
  scheduled: "Starts soon", live: "Live", ended: "Ended", stopped: "Stopped", cancelled: "Cancelled",
};
export function bannerPhase(b: { status: string; startOn: Date; endOn: Date }, o: { checking?: boolean; invoiceOpen?: boolean } = {}): BannerPhase {
  const day = today();
  if (b.status === "void") return "cancelled";
  if (b.status === "stopped") return "stopped";
  if (b.status === "awaiting") return o.invoiceOpen === false ? "cancelled" : o.checking ? "checking" : "awaiting";
  if (b.status === "review") return "review";
  if (b.status === "rejected") return "rejected";
  if (ymd(b.endOn) < day) return "ended";
  return ymd(b.startOn) > day ? "scheduled" : "live";
}

export const bannerLine = (o: { days: number; price: number; no: string }) => ({ id: "banner", name: `Home page banner ${o.no}, ${o.days} days`, qty: o.days, price: o.price, months: 1 });
