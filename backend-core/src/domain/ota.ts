import type { Db } from "../lib/db.js";
import type { Fetch } from "../lib/payments.js";
import { parseIcal } from "../lib/ical.js";
import { leadPeople, notify } from "../lib/notify.js";
import { dayOf, ymd } from "./money.js";
import { headOffice } from "./branches.js";

// Keeping rooms in step with Booking.com, Airbnb, Agoda and Expedia through their calendar (iCal) feeds.
// The business API syncs a feed when it is added or on request; the admin API syncs every feed every 2 hours.

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
      const cur = await db.booking.findUnique({ where: { tenantId_externalUid: { tenantId: f.tenantId, externalUid: uid } } });
      if (!cur) {
        await db.booking.create({ data: { tenantId: f.tenantId, branchId, roomType: f.roomType, guestName: e.summary && !/not available|closed|blocked/i.test(e.summary) ? e.summary : `${f.site} guest`, checkIn: dayOf(e.start), checkOut: dayOf(e.end), rate, status: "confirmed", source: f.site, externalUid: uid } });
        added++;
      } else if (cur.status !== "checked_in" && cur.status !== "completed" && (ymd(cur.checkIn) !== e.start || ymd(cur.checkOut) !== e.end || cur.status === "cancelled")) {
        await db.booking.update({ where: { id: cur.id }, data: { checkIn: dayOf(e.start), checkOut: dayOf(e.end), status: "confirmed" } });
        updated++;
      }
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
