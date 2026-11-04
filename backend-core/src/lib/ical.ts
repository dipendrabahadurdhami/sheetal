// iCal (RFC 5545) for availability calendars, as Booking.com, Airbnb, Agoda and Expedia use them.
// Where it fits: reading their feeds (calendar sync) and publishing ours (business API /ical/...).
// How it works: each event is a stay or a blocked range with all-day start and end dates.

export interface IcalEvent { uid: string; start: string; end: string; summary: string }

/** All-day events from a feed. Lines can be folded (continued with a leading space); dates as YYYYMMDD or YYYYMMDDTHHMMSSZ. */
export function parseIcal(text: string): IcalEvent[] {
  const lines = text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const out: IcalEvent[] = [];
  let cur: Record<string, string> | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT") {
      const d = (v?: string) => (v && /^\d{8}/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : null);
      const start = d(cur?.DTSTART), end = d(cur?.DTEND) ?? (start ? null : null);
      if (cur && start && end && end > start) out.push({ uid: (cur.UID ?? `${start}-${end}`).slice(0, 200), start, end, summary: unescape(cur.SUMMARY ?? "").slice(0, 120) });
      cur = null; continue;
    }
    if (!cur) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    const key = line.slice(0, i).split(";")[0]!.toUpperCase();
    cur[key] = line.slice(i + 1).trim();
  }
  return out;
}
const unescape = (s: string) => s.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1");
const escape = (s: string) => s.replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");

/** A feed of busy dates (no guest names: other sites only need to know the room is taken). */
export function buildIcal(o: { name: string; events: { uid: string; start: string; end: string }[]; now?: Date }) {
  const stamp = (o.now ?? new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const ymd = (s: string) => s.replace(/-/g, "");
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Sheetal Property//Availability//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${escape(o.name)}`,
    ...o.events.flatMap((e) => ["BEGIN:VEVENT", `UID:${e.uid}@sheetalproperty.com`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${ymd(e.start)}`, `DTEND;VALUE=DATE:${ymd(e.end)}`, "SUMMARY:Not available", "END:VEVENT"]),
    "END:VCALENDAR", "",
  ].join("\r\n");
}
