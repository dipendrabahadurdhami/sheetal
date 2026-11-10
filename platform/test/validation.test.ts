// Tests for the shared zod pieces in platform/src/core/validation.ts.
// Run with: npm run test -w @sheetal/platform
import { describe, expect, it } from "vitest";
import { BasicListQuery, Day, Id, Month, Sort } from "../src/core/validation.js";

describe("validation", () => {
  it("Id trims and limits length", () => {
    expect(Id.parse("  abc ")).toBe("abc");
    expect(Id.safeParse("").success).toBe(false);
    expect(Id.safeParse("x".repeat(41)).success).toBe(false);
  });
  it("Day accepts only real dates", () => {
    expect(Day.parse("2026-02-28")).toBe("2026-02-28");
    expect(Day.safeParse("2026-02-30").success).toBe(false);
    expect(Day.safeParse("26-02-01").success).toBe(false);
  });
  it("Month is YYYY-MM", () => {
    expect(Month.parse("2026-11")).toBe("2026-11");
    expect(Month.safeParse("2026-13").success).toBe(false);
  });
  it("Sort turns text into specs", () => {
    expect(Sort.parse("spentOn:desc,seq")).toEqual([{ field: "spentOn", dir: "desc" }, { field: "seq", dir: "asc" }]);
    expect(Sort.safeParse("a;drop").success).toBe(false);
  });
  it("BasicListQuery coerces page and per from a query string", () => {
    expect(BasicListQuery.parse({ page: "2", per: "25", sort: "seq:desc", q: " rent " })).toEqual({ page: 2, per: 25, sort: [{ field: "seq", dir: "desc" }], q: "rent" });
    expect(BasicListQuery.safeParse({ page: "0" }).success).toBe(false);
    expect(BasicListQuery.parse({}).q).toBeUndefined();
  });
});
