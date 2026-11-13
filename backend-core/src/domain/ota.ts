// Calendar sync with Booking.com, Airbnb, Agoda and Expedia (iCal feeds), for hotel and host businesses.
// Where it fits: the business API syncs a feed when it is added or on request; the admin API syncs every feed every
// 2 hours.
// How it works: each stay in the other site's feed becomes a booking of that room type (no room yet) at the branch
// whose rooms it fills; stays that disappear from the feed are cancelled; the people at that branch are notified.
// Rules: a feed's booking write holds the rooms of that type at that branch for its transaction (SELECT … FOR UPDATE), the same hold as the Hotel
// app's RoomRepository.lockType (apps/hotel/backend/repositories.ts), so a feed booking and a booking made in the panel at the same moment wait for
// each other instead of both taking the last room (P2-W6).

import type { Prisma } from "@prisma/client";
import type { Db } from "@sheetal/platform/db/client";
import type { Fetch } from "../lib/payments.js";
import { parseIcal } from "../lib/ical.js";
import { leadPeople, notify } from "@sheetal/platform/notify/index";
import { dayOf, ymd } from "./money.js";
import { headOffice } from "./branches.js";

type Tx = Prisma.TransactionClient;
/** Holds the rooms of one type at one branch until the transaction ends (the Hotel app's lockType rule). */
export async function holdRoomType(tx: Tx, tenantId: string, branchId: string | null, type: string) {
  await tx.$queryRaw`SELECT id FROM rooms WHERE tenant_id = ${tenantId} AND branch_id = ${branchId} AND type = ${type} FOR UPDATE`;
}

/** Imports a site's stays as bookings of that room type (unassigned); stays removed from the feed are cancelled. */
export async function syncOtaFeed(db: Db, id: string, fetchFn?: Fetch) {
  const f = await db.otaFeed.findUniqueOrThrow({ where: { id } });
  try {
    const res = await (fetchFn ?? fetch)(f.url, { headers: { "User-Agent": "SheetalProperty-CalendarSync/1.0" }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`the site answered ${res.status}`);
    const text = await res.text();
    if (text.length > 2_000_000 || !text.includes("BEGIN:VCALENDAR")) throw new Error("that link isn't a calendar feed");
    const today = ymd(new Date());
    const events = parseIcal(text).filter((e) => e.end > today);
    const room = await db.room.findFirst({ where: { tenantId: f.tenantId, type: f.roomType }, orderBy: { rate: "asc" } });
    const rate = room?.rate ?? 0;
    // Stays go to the branch with rooms of that type (else the head office).
    const branchId = room?.branchId ?? await headOffice(db, f.tenantId);
    let added = 0, updated = 0;
    for (const e of events) {
      const uid = `${f.site}:${e.uid}`;
      const did = await db.$transaction(async (tx: Tx) => {
        await holdRoomType(tx, f.tenantId, branchId, f.roomType);
        const cur = await tx.booking.findUnique({ where: { tenantId_externalUid: { tenantId: f.tenantId, externalUid: uid } } });
        if (!cur) {
          await tx.booking.create({ data: { tenantId: f.tenantId, branchId, roomType: f.roomType, guestName: e.summary && !/not available|closed|blocked/i.test(e.summary) ? e.summary : `${f.site} guest`, checkIn: dayOf(e.start), checkOut: dayOf(e.end), rate, status: "confirmed", source: f.site, externalUid: uid } });
          return "added" as const;
        }
        if (cur.status !== "checked_in" && cur.status !== "completed" && (ymd(cur.checkIn) !== e.start || ymd(cur.checkOut) !== e.end || cur.status === "cancelled")) {
          await tx.booking.update({ where: { id: cur.id }, data: { checkIn: dayOf(e.start), checkOut: dayOf(e.end), status: "confirmed" } });
          return "updated" as const;
        }
        return null;
      });
      if (did === "added") added++;
      if (did === "updated") updated++;
    }
    const gone = await db.booking.updateMany({ where: { tenantId: f.tenantId, source: f.site, roomType: f.roomType, externalUid: { startsWith: `${f.site}:`, notIn: events.map((e) => `${f.site}:${e.uid}`) }, status: { in: ["confirmed", "requested"] }, checkOut: { gt: new Date() } }, data: { status: "cancelled" } });
    await db.otaFeed.update({ where: { id }, data: { lastSync: new Date(), lastError: null } });
    if (added) await notify(db, await leadPeople(db, f.tenantId, branchId), { tenantId: f.tenantId, type: "booking", title: `${added} new ${f.site} booking${added > 1 ? "s" : ""}`, link: "/business/bookings" });
    return { added, updated, cancelled: gone.count };
  } catch (e) {
    await db.otaFeed.update({ where: { id }, data: { lastSync: new Date(), lastError: e instanceof Error ? e.message.slice(0, 200) : "failed" } });
    throw e;
  }
}
