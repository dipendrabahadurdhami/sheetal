// Nepal days and months for billing (MB section 4: "day maths uses Nepal days"; SETTINGS.md section 7.1).
// Where it fits: every billing date rule (periods, proration, grace, reminders) counts days with these helpers, never with a fixed
// 30 or with UTC midnights.
// How it works: Nepal time is UTC+05:45 all year (no summer time). A Nepal day runs 00:00 to 23:59:59.999 Nepal time. A day number is
// the count of Nepal days since 1970-01-01 (Nepal), so the days between two instants are a plain subtraction. A month step keeps the
// day of month, capped at 28, so every month has the date.
// Rules: pure; dates in and out are UTC Date objects (as stored); a period END is the first instant of the Nepal day it ends on, so
// the period [start, end) covers whole Nepal days.

const OFFSET_MS = (5 * 60 + 45) * 60_000;
const DAY_MS = 86_400_000;

/** The Nepal day number of an instant. */
export function nepalDayNo(d: Date): number {
  return Math.floor((d.getTime() + OFFSET_MS) / DAY_MS);
}

/** The first instant (UTC) of a Nepal day number. */
export function fromDayNo(n: number): Date {
  return new Date(n * DAY_MS - OFFSET_MS);
}

/** The first instant of the Nepal day that `d` falls in. */
export function startOfNepalDay(d: Date): Date {
  return fromDayNo(nepalDayNo(d));
}

/** Whole Nepal days from a to b (b later = positive). The day of `a` counts, the day of `b` does not. */
export function nepalDays(a: Date, b: Date): number {
  return nepalDayNo(b) - nepalDayNo(a);
}

/** Adds whole Nepal days and returns the first instant of that day. */
export function addNepalDays(d: Date, n: number): Date {
  return fromDayNo(nepalDayNo(d) + n);
}

/** The Nepal calendar date (Gregorian) of an instant: { y, m (1-12), d }. */
export function nepalDate(d: Date): { y: number; m: number; d: number } {
  const s = new Date(d.getTime() + OFFSET_MS);
  return { y: s.getUTCFullYear(), m: s.getUTCMonth() + 1, d: s.getUTCDate() };
}

/** The first instant of a Nepal calendar date. */
export function nepalMidnight(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d) - OFFSET_MS);
}

/** A day of month usable every month: 1 to 28. */
export function anchorOf(d: Date): number {
  return Math.min(nepalDate(d).d, 28);
}

/** The anchor date `months` months after the Nepal month of `from`, on `anchorDay` (1 to 28). */
export function addMonthsOnAnchor(from: Date, months: number, anchorDay: number): Date {
  const { y, m } = nepalDate(from);
  const idx = y * 12 + (m - 1) + months;
  return nepalMidnight(Math.floor(idx / 12), (idx % 12) + 1, Math.min(Math.max(anchorDay, 1), 28));
}

/** The next anchor date strictly after the Nepal day of `now` (today's anchor counts as "already started"). */
export function nextAnchor(now: Date, anchorDay: number): Date {
  const { y, m, d } = nepalDate(now);
  const day = Math.min(Math.max(anchorDay, 1), 28);
  return d < day ? nepalMidnight(y, m, day) : addMonthsOnAnchor(nepalMidnight(y, m, 1), 1, day);
}

/** The anchor date on or before the Nepal day of `now`. */
export function previousAnchor(now: Date, anchorDay: number): Date {
  return addMonthsOnAnchor(nextAnchor(now, anchorDay), -1, anchorDay);
}
