// Tests for Admin → Sales, Revenue, App billing and Legal info (P3-FE-4): Nepal-time range pickers (today in Nepal near midnight, custom
// ranges), totals equal the rows (and a mismatch is shown), every CSV goes through the audited export, the company-details body passes the
// setting's rules, and the menu and routes.
// Where it fits: the root front-end test run (npx vitest run admin/frontend).
import { describe, expect, it } from "vitest";
import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { COMPANY_SETTING } from "../../../../platform/src/billing/company.ts";
import { changeLabel, companyBody, customOk, nepalToday, panOk, rangeQuery, sumOf, totalsMatch } from "./reportsLogic.js";
import { RangePicker } from "./SalesRevenue.jsx";

const src = (f) => readFileSync(new URL(f, import.meta.url), "utf8");

describe("Nepal-time ranges", () => {
  it("today is the Nepal date, also when it is still yesterday in UTC", () => {
    expect(nepalToday(new Date("2026-11-15T18:20:00Z"))).toBe("2026-11-16"); // 00:05 in Kathmandu
    expect(nepalToday(new Date("2026-11-15T18:10:00Z"))).toBe("2026-11-15"); // 23:55 in Kathmandu
  });
  it("custom ranges: two dates, start on or before the end, at most a year", () => {
    expect(customOk("2026-11-01", "2026-11-15")).toBe(true);
    expect(customOk("2026-11-15", "2026-11-15")).toBe(true);
    expect(customOk("2026-11-16", "2026-11-15")).toBe(false);
    expect(customOk("2025-01-01", "2026-11-15")).toBe(false);
    expect(customOk("", "2026-11-15")).toBe(false);
  });
  it("the query sends only the picked range; the server works out the Nepal days", () => {
    expect(rangeQuery({ range: "7d" })).toBe("?range=7d");
    expect(rangeQuery({ range: "custom", from: "2026-11-01", to: "2026-11-15" }, { appId: "hotel", page: 2, method: "" }, "csv")).toBe("?range=custom&from=2026-11-01&to=2026-11-15&appId=hotel&page=2&format=csv");
  });
  it("the picker shows the four choices, and Nepal date boxes for Custom", () => {
    const html = renderToStaticMarkup(<RangePicker value={{ range: "custom", from: "2026-11-01", to: "2026-11-15" }} onChange={() => {}} />);
    for (const w of ["Today", "7 days", "30 days", "Custom"]) expect(html).toContain(w);
    expect(html).toContain('aria-label="From (Nepal date)"'); expect(html).toContain('aria-label="Range (Nepal time)"');
  });
});

describe("totals equal the rows", () => {
  const rows = [{ grossPaisa: 70_000, vatPaisa: 8_053 }, { grossPaisa: -11_299, vatPaisa: -1_300 }];
  it("sums and the check", () => {
    expect(sumOf(rows, "grossPaisa")).toBe(58_701);
    expect(totalsMatch(rows, { grossPaisa: 58_701, vatPaisa: 6_753 }, ["grossPaisa", "vatPaisa"])).toBe(true);
    expect(totalsMatch(rows, { grossPaisa: 58_702, vatPaisa: 6_753 }, ["grossPaisa", "vatPaisa"])).toBe(false);
  });
  it("pages that show every row check it and show a mismatch", () => {
    const p = src("./SalesRevenue.jsx");
    expect(p).toContain("allShown && res?.totals && !totalsMatch(rows, res.totals, MONEY_KEYS)");
    expect(p).toContain("!totalsMatch(rows.map((x) => x.totals), d.totals");
    expect(p).toContain("The totals don't equal the rows.");
  });
  it("% change words", () => {
    expect([changeLabel(12.46), changeLabel(-3), changeLabel(0), changeLabel(null)]).toEqual(["+12.5%", "−3%", "0%", "new"]);
  });
});

describe("exports are audited", () => {
  it("every CSV goes through adminDownload with format=csv (the server needs platform.billing.export and writes the audit row)", () => {
    const p = src("./SalesRevenue.jsx");
    expect([...p.matchAll(/<CsvButton path=\{`[^`]*format|rangeQuery\(r, \{\}, "csv"\)/g)].length).toBeGreaterThanOrEqual(3);
    expect(p).toContain("adminDownload(path, name)");
    expect(p).not.toMatch(/window\.open\(|href=\{`\$\{/);
  });
});

describe("Legal info: company details", () => {
  it("the body passes the platform.company setting's own schema; a PAN has 9 digits", () => {
    const b = companyBody({ tradeName: " Sheetal Property ", legalName: "Sheetal Pvt Ltd", pan: "123 456 789", vatRegistered: true, address: "Kathmandu", phone: "01-4000000", email: "billing@sheetal.test" }, " First fill ");
    expect(b.reason).toBe("First fill");
    expect(COMPANY_SETTING.schema.parse(b.value)).toMatchObject({ pan: "123456789", tradeName: "Sheetal Property" });
    expect(() => COMPANY_SETTING.schema.parse(companyBody({ pan: "12345" }, "x").value)).toThrow();
    expect([panOk(""), panOk("123456789"), panOk("12345")]).toEqual([true, true, false]);
  });
});

describe("admin menu and routes", () => {
  const app = src("./AdminApp.jsx");
  it("sales and revenue need platform.revenue.read; app billing platform.billing.read; legal platform.settings.read", () => {
    expect(app).toMatch(/path: "\/admin\/sales", render: \(\) => guard\("platform\.revenue\.read"/);
    expect(app).toMatch(/path: "\/admin\/revenue", render: \(\) => guard\("platform\.revenue\.read"/);
    expect(app).toMatch(/path: "\/admin\/billing-apps", render: \(\) => guard\("platform\.billing\.read"/);
    expect(app).toMatch(/path: "\/admin\/legal", render: \(\) => guard\("platform\.settings\.read"/);
  });
  it("never names the technology partner; raw buttons say type=button", () => {
    for (const f of ["./SalesRevenue.jsx", "./LegalInfo.jsx"]) {
      expect(src(f)).not.toMatch(/DhamiPlus|partner share/i);
      expect([...src(f).matchAll(/<button(?![^>]*type="button")/g)], f).toHaveLength(0);
    }
  });
});
