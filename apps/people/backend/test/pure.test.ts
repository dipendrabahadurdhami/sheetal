// Tests of the pure day rules of People (time.ts): no database. Run: npx vitest run --config apps/people/vitest.config.js (or npm run test -w @sheetal/app-people).
import { describe, expect, it } from "vitest";
import { addDays, at, days, hhmm, isOff, monthEnd, nameOf, nepalDayOf, toMinutes, valid, workDays } from "../time.js";

describe("People days and times (Nepal time)", () => {
  it("turns a Nepal day and time into a moment and back", () => {
    const m = at("2026-11-07", "09:30");
    expect(m.toISOString()).toBe("2026-11-07T03:45:00.000Z");
    expect(hhmm(m)).toBe("09:30");
    expect(nepalDayOf(new Date("2026-11-06T18:20:00Z"))).toBe("2026-11-07");   // 00:05 in Nepal is already the next day
    expect(hhmm(null)).toBeNull();
    expect(toMinutes("10:00")).toBe(600);
  });
  it("knows Saturday is the weekly off day and counts working days without it", () => {
    expect(isOff("2026-11-07")).toBe(true);    // a Saturday
    expect(isOff("2026-11-08")).toBe(false);
    expect(workDays("2026-11-06", "2026-11-09")).toBe(3);   // Fri, Sat (off), Sun, Mon
    expect(workDays("2026-11-07", "2026-11-07")).toBe(0);
  });
  it("checks dates and walks days and months", () => {
    expect(valid("2026-02-30")).toBe(false);
    expect(valid("2026-02-28")).toBe(true);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(days("2026-11-01", "2026-11-03")).toEqual(["2026-11-01", "2026-11-02", "2026-11-03"]);
    expect(days("2026-01-01", "2027-12-31")).toHaveLength(400);   // capped
    expect(monthEnd("2028-02")).toBe("2028-02-29");
  });
  it("names a person by first and last name, else the user name", () => {
    expect(nameOf({ userName: "sita", firstName: "Sita", lastName: "Sharma" })).toBe("Sita Sharma");
    expect(nameOf({ userName: "sita", firstName: null, lastName: null })).toBe("sita");
  });
});
