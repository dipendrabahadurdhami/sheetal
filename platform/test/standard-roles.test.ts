import { describe, expect, it } from "vitest";
import { BUSINESS_TYPE_IDS, ROLE_TEMPLATES_V2 } from "../src/tenancy/permissions.generated.js";
import { hasPerm } from "../src/tenancy/perms.js";

const grants = (type: (typeof BUSINESS_TYPE_IDS)[number], key: string) => ROLE_TEMPLATES_V2[type].find((r) => r.key === key)?.grants;
const WRITE = /\.(create|update|delete|publish|invite|remove|assign|manage|confirm|stop|reply|use|moderate|review)$/;

describe("standard roles for every kind of business", () => {
  it("gives every kind of business an owner, a manager and a viewer", () => {
    for (const t of BUSINESS_TYPE_IDS) {
      for (const key of ["owner", "manager", "viewer"]) expect(grants(t, key), `${t}/${key}`).toBeTruthy();
    }
  });

  it("lets the owner do everything and the manager everything except roles and the Sheetal plan", () => {
    for (const t of BUSINESS_TYPE_IDS) {
      expect(grants(t, "owner")).toEqual(["*"]);
      const m = grants(t, "manager")!;
      expect(m, t).not.toContain("*");
      expect(hasPerm(m, "workspace.team.invite")).toBe(true);
      expect(hasPerm(m, "workspace.overview.read")).toBe(true);
      expect(m.some((g) => g.startsWith("workspace.role."))).toBe(false);
      expect(m.some((g) => g.startsWith("workspace.billing."))).toBe(false);
    }
  });

  it("keeps the viewer read-only, without profit, payouts, investors or roles", () => {
    for (const t of BUSINESS_TYPE_IDS) {
      const v = grants(t, "viewer")!;
      expect(v.length, t).toBeGreaterThan(5);
      for (const g of v) expect(g.split(":")[0], `${t}: ${g}`).toMatch(/\.read$/);
      for (const g of v) expect(g.split(":")[0]).not.toMatch(WRITE);
      for (const no of ["expenses.profit.read", "invoicing.payout.read", "investments.investor.read", "workspace.role.read"]) expect(hasPerm(v, no), `${t}: ${no}`).toBe(false);
      expect(hasPerm(v, "workspace.overview.read")).toBe(true);
    }
  });

  it("limits customer care to messages, enquiries and reviews", () => {
    for (const t of ["host", "developer", "agency", "sponsor"] as const) {
      const c = grants(t, "customer_care")!;
      expect(hasPerm(c, "crm.message.reply"), t).toBe(true);
      expect(hasPerm(c, "reviews.review.reply"), t).toBe(true);
      for (const no of ["workspace.team.invite", "invoicing.invoice.create", "expenses.expense.create", "workspace.billing.manage"]) expect(hasPerm(c, no), `${t}: ${no}`).toBe(false);
    }
  });

  it("keeps the roles each kind of business already had", () => {
    expect(ROLE_TEMPLATES_V2.agency.map((r) => r.key)).toEqual(expect.arrayContaining(["branch_manager", "agent", "accountant"]));
    expect(ROLE_TEMPLATES_V2.hotel.map((r) => r.key)).toEqual(expect.arrayContaining(["frontdesk", "cashier", "housekeeping", "accountant"]));
    expect(ROLE_TEMPLATES_V2.developer.map((r) => r.key)).toEqual(expect.arrayContaining(["sales_manager", "sales_exec", "site_engineer", "accountant"]));
  });
});
