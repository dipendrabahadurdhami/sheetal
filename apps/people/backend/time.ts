// Days and times of People in Nepal time: the pure helpers the attendance and leave rules use.
// Where it fits: people.service.ts (rules) and presenter.ts (answers). Moved here unchanged from business/backend/src/modules/people/routes.ts (P2-W1 stage 2).
// How it works: a day is "YYYY-MM-DD" (a Nepal calendar day); a time is "HH:MM" in Nepal time; the database keeps days as DATE and moments as UTC.
// Saturday is the weekly off day. Nothing here reads the database or the clock, except today() which is nepalDay().
// Rules: no I/O. Change a rule here only together with test/pure.test.ts.

import { dayOf, ymd } from "@sheetal/backend-core/domain/money";
import { nepalDay } from "@sheetal/backend-core/domain/payouts";

export const NEPAL_MS = 5.75 * 3_600_000;
export const SATURDAY = 6;
export const DEFAULT_START = "10:00";
/** The leave types a business gets on first use: name, days a year (0 = no limit), paid. */
export const DEFAULT_TYPES = [["Casual", 6, true], ["Sick", 12, true], ["Home", 18, true], ["Festival", 4, true], ["Unpaid", 0, false]] as const;

export { dayOf, ymd };
export const today = (): string => nepalDay();
export const nepalDayOf = (d: Date) => ymd(new Date(d.getTime() + NEPAL_MS));
export const minutesOf = (d: Date) => { const n = new Date(d.getTime() + NEPAL_MS); return n.getUTCHours() * 60 + n.getUTCMinutes(); };
export const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
/** The moment of a Nepal day and time. */
export const at = (day: string, hhmm: string) => new Date(dayOf(day).getTime() + toMinutes(hhmm) * 60_000 - NEPAL_MS);
/** "HH:MM" in Nepal time, or null. */
export const hhmm = (d: Date | null) => {
  if (!d) return null;
  const n = new Date(d.getTime() + NEPAL_MS);
  return `${String(n.getUTCHours()).padStart(2, "0")}:${String(n.getUTCMinutes()).padStart(2, "0")}`;
};
export const isOff = (day: string) => dayOf(day).getUTCDay() === SATURDAY;
export const valid = (day: string) => !Number.isNaN(dayOf(day).getTime()) && ymd(dayOf(day)) === day;
/** A day (YYYY-MM-DD) some days later or earlier. */
export const addDays = (day: string, n: number) => ymd(new Date(dayOf(day).getTime() + n * 86_400_000));
/** Every day from `from` to `to` (at most 400). */
export const days = (from: string, to: string) => { const out: string[] = []; for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d); return out; };
/** Working days (not Saturday) from `from` to `to`. */
export const workDays = (from: string, to: string) => days(from, to).filter((d) => !isOff(d)).length;
export const monthEnd = (m: string) => { const [y, mo] = m.split("-").map(Number) as [number, number]; return ymd(new Date(Date.UTC(y, mo, 0))); };
export const nameOf = (u: { userName: string; firstName: string | null; lastName: string | null }) => [u.firstName, u.lastName].filter(Boolean).join(" ") || u.userName;
