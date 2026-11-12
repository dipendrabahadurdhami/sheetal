// Tests for the pure parts of stage 1.4: the revenue-share rule, the Nepal-day ranges of the revenue report, the theme readability check, the field
// builder's rules and visibility, and the list of settings itself. No database (that side is admin/backend/test/settings.test.ts).
import { describe, expect, it } from "vitest";
import { settingProblems, describe as describeSettings, REVENUE_SHARE, PLATFORM_THEME } from "../src/settings/defs.js";
import { FORM_SEEDS, FormDef, checkFormChange, projectFields, readableFields } from "../src/settings/field-defs.js";
import { changePct, nepalDay, nepalDayStart, rangeOf, revenueCsv } from "../src/settings/revenue.js";
import { REVENUE_SHARE_DEFAULT, RevenueShare, commissionFor, partnerShareOf, pctOf, rateFor } from "../src/settings/revenue-share.js";
import { changedFields } from "../src/settings/service.js";
import { THEME_DEFAULT, ThemeTokens, contrast, textOn, themeProblems } from "../src/settings/theme-tokens.js";

describe("revenue share", () => {
  const s: RevenueShare = { ...REVENUE_SHARE_DEFAULT, perApp: { pos: 5 }, perGateway: { card: 2.5 }, technologyPartner: { enabled: true, name: "Partner", sharePct: 30, appliesTo: "all", apps: [] }, effectiveFrom: "2026-11-01" };
  it("rounds to the nearest paisa, half up, with no floating-point drift", () => {
    expect(pctOf(100_000, 10)).toBe(10_000);
    expect(pctOf(333, 10)).toBe(33);          // 33.3 -> 33
    expect(pctOf(335, 10)).toBe(34);          // 33.5 -> 34
    expect(pctOf(1, 12.5)).toBe(0);
    expect(pctOf(4, 12.5)).toBe(1);           // 0.5 -> 1
    expect(pctOf(-335, 10)).toBe(-34);        // a refund mirrors the payment
    expect(pctOf(9_999_999_999, 2.75)).toBe(275_000_000);   // 274,999,999.97 -> 275,000,000
    expect(() => pctOf(10.5, 10)).toThrow();
  });
  it("uses the gateway rate, else the app rate, else the default", () => {
    expect(rateFor(s, { appId: "pos", gatewayId: "card" })).toBe(2.5);
    expect(rateFor(s, { appId: "pos" })).toBe(5);
    expect(rateFor(s, { appId: "hotel" })).toBe(10);
    expect(rateFor(s, { appId: "constructor" })).toBe(10);      // never something inherited from Object
  });
  it("takes commission only on live payments through Sheetal's own gateway", () => {
    expect(commissionFor(s, { amountPaisa: 500_000, appId: "hotel", live: true, viaPlatform: true })).toEqual({ pct: 10, commissionPaisa: 50_000 });
    expect(commissionFor(s, { amountPaisa: 500_000, live: false, viaPlatform: true }).commissionPaisa).toBe(0);
    expect(commissionFor(s, { amountPaisa: 500_000, live: true, viaPlatform: false }).commissionPaisa).toBe(0);
  });
  it("gives the partner a part of the commission, only from the start date, only for listed apps when listed", () => {
    expect(partnerShareOf(s, { commissionPaisa: 50_000, day: "2026-11-12" })).toBe(15_000);
    expect(partnerShareOf(s, { commissionPaisa: 50_000, day: "2026-10-31" })).toBe(0);
    const listed = { ...s, technologyPartner: { ...s.technologyPartner, appliesTo: "listed" as const, apps: ["hotel"] } };
    expect(partnerShareOf(listed, { commissionPaisa: 50_000, appId: "pos", day: "2026-11-12" })).toBe(0);
    expect(partnerShareOf(listed, { commissionPaisa: 50_000, appId: "hotel", day: "2026-11-12" })).toBe(15_000);
    expect(partnerShareOf(REVENUE_SHARE_DEFAULT, { commissionPaisa: 50_000, day: "2026-11-12" })).toBe(0);
  });
  it("refuses bad values and a start date that moves back", () => {
    expect(RevenueShare.safeParse({ ...s, commissionPct: 101 }).success).toBe(false);
    expect(RevenueShare.safeParse({ ...s, commissionPct: 10.123 }).success).toBe(false);
    expect(RevenueShare.safeParse({ ...s, surprise: true }).success).toBe(false);
    expect(REVENUE_SHARE.guard!({ ...s, effectiveFrom: "2026-10-01" }, s)).toMatch(/cannot move back/);
    expect(REVENUE_SHARE.guard!({ ...s, effectiveFrom: "2026-12-01" }, s)).toBeNull();
  });
});

describe("revenue report ranges (Nepal time, UTC+05:45)", () => {
  it("puts a moment in the right Nepal day", () => {
    expect(nepalDay(new Date("2026-11-12T18:14:00Z"))).toBe("2026-11-12");     // 23:59 Nepal time
    expect(nepalDay(new Date("2026-11-12T18:15:00Z"))).toBe("2026-11-13");     // 00:00 Nepal time
    expect(nepalDayStart("2026-11-13").toISOString()).toBe("2026-11-12T18:15:00.000Z");
  });
  it("builds today, 7 days, 30 days and custom, each with a previous period of the same length", () => {
    const now = new Date("2026-11-12T08:00:00Z");
    expect(rangeOf({ range: "today" }, now)).toEqual({ fromDay: "2026-11-12", toDay: "2026-11-12", days: 1, prevFromDay: "2026-11-11", prevToDay: "2026-11-11" });
    expect(rangeOf({ range: "7d" }, now)).toMatchObject({ fromDay: "2026-11-06", toDay: "2026-11-12", days: 7, prevFromDay: "2026-10-30", prevToDay: "2026-11-05" });
    expect(rangeOf({ range: "30d" }, now).days).toBe(30);
    expect(rangeOf({ range: "custom", from: "2026-01-01", to: "2026-01-31" }, now)).toMatchObject({ days: 31, prevFromDay: "2025-12-01", prevToDay: "2025-12-31" });
  });
  it("refuses a backwards, missing or too long custom range", () => {
    expect(() => rangeOf({ range: "custom", from: "2026-02-01", to: "2026-01-01" })).toThrow(/must not be after/);
    expect(() => rangeOf({ range: "custom", from: "2026-02-01" })).toThrow(/Choose a start date/);
    expect(() => rangeOf({ range: "custom", from: "2024-01-01", to: "2026-01-01" })).toThrow(/at most 366 days/);
    expect(() => rangeOf({ range: "custom", from: "2026-13-45", to: "2026-01-01" })).toThrow();
  });
  it("gives no percentage when there was nothing before, and makes CSV cells safe", () => {
    expect(changePct(150, 100)).toBe(50);
    expect(changePct(50, 100)).toBe(-50);
    expect(changePct(10, 0)).toBeNull();
    const t = { grossPaisa: 100_000, subscriptionPaisa: 250_000, commissionPaisa: 10_000, partnerSharePaisa: 3_000, netPaisa: 257_000, refundsPaisa: 0, count: 2 };
    const csv = revenueCsv({ rows: [{ key: "2026-11-12", totals: t }], totals: t } as never);
    expect(csv.split("\n")[1]).toBe("2026-11-12,1000.00,0.00,2500.00,100.00,30.00,2570.00,2");
    expect(csv.split("\n")[2]!.startsWith("Total,")).toBe(true);
  });
});

describe("theme tokens", () => {
  it("accepts Sheetal's own look and measures contrast", () => {
    expect(ThemeTokens.safeParse(THEME_DEFAULT).success).toBe(true);
    expect(themeProblems(THEME_DEFAULT)).toEqual([]);
    expect(Math.round(contrast("#000000", "#FFFFFF"))).toBe(21);
    expect(textOn("#9D1D21")).toBe("#FFFFFF");
    expect(textOn("#FFE066")).toBe("#111111");
  });
  it("refuses a look nobody could read, with a plain sentence", () => {
    const pale = { ...THEME_DEFAULT, colors: { ...THEME_DEFAULT.colors, text: "#EEEEEE", page: "#FFFFFF" } };
    expect(PLATFORM_THEME.guard!(pale, THEME_DEFAULT)).toMatch(/too close to the page colour/);
    expect(themeProblems({ ...THEME_DEFAULT, colors: { ...THEME_DEFAULT.colors, brand: "#FAF6F3" } }).join(" ")).toMatch(/brand colour is too close/);
    expect(ThemeTokens.safeParse({ ...THEME_DEFAULT, colors: { brand: "red", dark: "#000000", light: "#FFFFFF" } }).success).toBe(false);
    expect(ThemeTokens.safeParse({ ...THEME_DEFAULT, radius: 40 }).success).toBe(false);
  });
});

describe("field builder", () => {
  const form = FORM_SEEDS.find((f) => f.id === "business_profile")!;
  const without = (key: string): FormDef => ({ ...form, fields: form.fields.filter((f) => f.key !== key) });
  const change = (key: string, patch: object): FormDef => ({ ...form, fields: form.fields.map((f) => (f.key === key ? { ...f, ...patch } : f)) });
  it("every seeded form passes its own schema", () => {
    for (const f of FORM_SEEDS) expect(FormDef.safeParse(f).success, f.id).toBe(true);
    expect(FORM_SEEDS.map((f) => f.id)).toEqual(["company_profile", "business_profile", "business_verification"]);
  });
  it("archives instead of deleting, and never changes a key's type", () => {
    expect(checkFormChange(form, without("website"))).toMatch(/cannot be deleted/);
    expect(checkFormChange(form, change("website", { archivedAt: "2026-11-12T00:00:00.000Z" }))).toBeNull();
    expect(checkFormChange(form, change("website", { type: "text" }))).toMatch(/type of "Website" cannot change/);
    expect(checkFormChange(form, change("website", { label: { en: "Web address" }, required: true }))).toBeNull();
  });
  it("keeps a locked field required, unarchived and locked; nobody can lock a new one", () => {
    expect(checkFormChange(form, change("name", { required: false }))).toMatch(/must stay required/);
    expect(checkFormChange(form, change("name", { archivedAt: "2026-11-12T00:00:00.000Z" }))).toMatch(/cannot be archived/);
    expect(checkFormChange(form, change("name", { locked: false }))).toMatch(/stays locked/);
    expect(checkFormChange(form, change("name", { label: { en: "Trading name" } }))).toBeNull();
    expect(checkFormChange(form, change("website", { locked: true }))).toMatch(/Only Sheetal's own/);
  });
  it("refuses a duplicate key, a choice field without options and a file field without its rules", () => {
    expect(FormDef.safeParse({ ...form, fields: [...form.fields, form.fields[0]] }).success).toBe(false);
    const base = { key: "kind", label: { en: "Kind" }, required: false, filledBy: "business_owner", visibility: "private", order: 5 };
    expect(FormDef.safeParse({ ...form, fields: [{ ...base, type: "select" }] }).success).toBe(false);
    expect(FormDef.safeParse({ ...form, fields: [{ ...base, type: "file" }] }).success).toBe(false);
    expect(FormDef.safeParse({ ...form, fields: [{ ...base, type: "text", validation: { pattern: "(" } }] }).success).toBe(false);
  });
  it("shows the public only public fields, and never an archived one", () => {
    const pub = readableFields(form, "public").map((f) => f.key);
    expect(pub).toContain("name"); expect(pub).toContain("phone");
    expect(pub).not.toContain("tax_number");
    const answers = { name: "Test Realty", tax_number: "123456789", phone: "9800000000" };
    expect(projectFields(form, answers, "public")).toEqual({ name: "Test Realty", phone: "9800000000" });
    expect(projectFields(form, answers, "business_owner")).toEqual(answers);
    expect(projectFields(form, answers, "platform_staff")).toEqual(answers);
    const archived = change("phone", { archivedAt: "2026-11-12T00:00:00.000Z" });
    expect(projectFields(archived, answers, "public")).toEqual({ name: "Test Realty" });
    expect(Object.keys(projectFields(archived, answers, "platform_staff"))).toContain("phone");     // staff still see old answers
  });
});

describe("the list of settings", () => {
  it("is consistent", () => {
    expect(settingProblems()).toEqual([]);
    const groups = describeSettings("platform").map((g) => g.group);
    expect(groups).toEqual(expect.arrayContaining(["revenue", "theme", "fields"]));
    expect(describeSettings("business").flatMap((g) => g.settings.map((s) => s.key)).sort()).toEqual(["business.profile", "business.theme"]);
  });
  it("names the fields that changed, not their values", () => {
    expect(changedFields({ a: 1, b: { x: 1 } }, { a: 1, b: { x: 2 }, c: 3 })).toEqual(["b", "c"]);
    expect(changedFields({ a: 1 }, { a: 1 })).toEqual([]);
  });
});
