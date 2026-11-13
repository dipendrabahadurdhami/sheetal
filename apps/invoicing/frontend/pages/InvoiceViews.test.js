// Tests for the invoice and payout screens moved into the Invoicing app (P2-W6): kit only, the business's settings come in as a prop (never read
// from the panel store here), and the editor's preview sums round VAT like the server.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { addDays, nextNo, totals } from "../invoiceMath.js";

const src = readFileSync(new URL("./InvoiceViews.jsx", import.meta.url), "utf8");

describe("invoice screens in the Invoicing app", () => {
  it("use the kit and take the settings as a prop", () => {
    expect(src).toContain('from "@sheetal/ui/primitives"');
    expect(src).not.toContain("@sheetal/shared/core/store");
    expect(src).not.toContain("@sheetal/shared/demo");
    expect(src).toContain("export function InvoicesView({ tenant, list, actions, branches, settings }) {");
  });
  it("previews totals like the server (VAT rounded to whole rupees; credit notes negative)", () => {
    expect(totals({ lines: [{ qty: 2, rate: 1500 }], vatPct: 13, receipts: [{ amount: 1000 }] })).toEqual({ sub: 3000, vat: 390, total: 3390, paid: 1000, balance: 2390 });
    expect(totals({ kind: "credit", lines: [{ qty: 1, rate: 100 }], vatPct: 13 }).total).toBe(-113);
    expect(nextNo([{ id: "INV-0006" }], "INV-")).toBe("INV-0007");
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
  });
});
