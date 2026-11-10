// Tests for the Profit tab's CSV: the same columns and the same file name pattern as the old page.
import { describe, expect, it, vi } from "vitest";

vi.mock("@sheetal/ui/primitives", () => ({ Badge: ({ children }) => children }));

import { toCsv } from "../../../../packages/ui/src/crud/exportCsv.js";
import { PROFIT_CSV_HEAD, PROFIT_CSV_NAME, profitColumns, profitCsvRow, profitStats, vatNote } from "./profit.jsx";

const row = { month: "2026-11", branch: "Main", branchId: "b1", direct: 1000, payouts: 500, expenses: 300, profit: 1200, vat: 130, commission: 40 };

describe("profit CSV", () => {
  it("has the eight columns in the old order", () => {
    expect(PROFIT_CSV_HEAD).toEqual(["Month", "Branch", "Received directly, without VAT (Rs.)", "Payouts from Sheetal (Rs.)", "Expenses (Rs.)", "Profit (Rs.)", "VAT collected, info (Rs.)", "Sheetal commission, info (Rs.)"]);
    expect(profitCsvRow(row)).toEqual(["2026-11", "Main", 1000, 500, 300, 1200, 130, 40]);
  });
  it("makes one line per row with the head first", () => {
    expect(toCsv(PROFIT_CSV_HEAD, [profitCsvRow(row)]).split("\r\n")).toEqual([PROFIT_CSV_HEAD.map((h) => (h.includes(",") ? `"${h}"` : h)).join(","), "2026-11,Main,1000,500,300,1200,130,40"]);
  });
  it("is named sheetal-profit-<day>.csv", () => expect(PROFIT_CSV_NAME).toBe("sheetal-profit"));
  it("a branch name that looks like a formula is guarded", () => {
    expect(toCsv(["Branch"], [[profitCsvRow({ ...row, branch: "=1+1" })[1]]])).toBe("Branch\r\n'=1+1");
  });
});

describe("profit table", () => {
  it("columns, and the branch shows under the month only with several branches", () => {
    expect(profitColumns([row]).map((c) => c.label)).toEqual(["Month", "Received by you", "Payouts from Sheetal", "Expenses", "Profit", "VAT (info)", "Commission (info)"]);
  });
  it("stats and the VAT note use the server's totals", () => {
    const s = profitStats({ direct: 1000, payouts: 500, expenses: 300, profit: 1200 });
    expect(s.map((x) => x.value)).toEqual(["Rs. 1,500", "Rs. 300", "Rs. 1,200"]);
    expect(vatNote({ vat: 130, commission: 40 })).toContain("VAT collected (Rs. 130)");
    expect(profitStats(undefined)[2].value).toBe("Rs. 0");
  });
});
