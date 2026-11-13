// Tests for the live Customer invoices page in the Invoicing app: kit and SDK only, a draft save sends its version, a 409 reloads, and LiveMoney.jsx passes
// the shared invoice screen in (the app never imports a Business page).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { draftBody, toInv } from "./InvoicesPage.jsx";

const src = readFileSync(new URL("./InvoicesPage.jsx", import.meta.url), "utf8");
const money = readFileSync(new URL("../../../../business/frontend/src/pages/LiveMoney.jsx", import.meta.url), "utf8");

describe("Customer invoices page in the Invoicing app", () => {
  it("uses the kit and the SDK, never a Business page", () => {
    expect(src).toContain('from "@sheetal/sdk/hooks"');
    expect(src.split("\n").filter((l) => l.startsWith("import ")).join("\n")).not.toMatch(/from "\.\.\/|business\/frontend/);
  });
  it("sends the version with a draft save and reloads on 409", () => {
    expect(src).toMatch(/bizApi\("PUT", `\/invoices\/\$\{f\.uid\}`, \{ \.\.\.draftBody\(f\), send, version: f\.version \}\)/);
    expect(src).toContain("e.status === 409");
  });
  it("keeps the shapes the screen uses", () => {
    const inv = toInv({ id: "x1", label: "INV-2083-84-0001", receipts: [{ id: "r1", no: "RC-1", at: "2026-11-01", amount: 100, method: "bank" }] });
    expect(inv).toMatchObject({ uid: "x1", id: "INV-2083-84-0001", receipts: [{ id: "RC-1", uid: "r1", method: "Bank transfer" }] });
    expect(draftBody({ to: " Ram ", lines: [{ what: " Room ", qty: "2", rate: "1500" }], date: "2026-11-01", due: "2026-11-11", vatPct: 13 }))
      .toMatchObject({ to: "Ram", phone: null, lines: [{ what: "Room", qty: 2, rate: 1500 }] });
  });
  it("is rendered by LiveMoney.jsx with the shared screen passed in", () => {
    expect(money).toContain("<InvoicesPage {...props} View={InvoicesView} />");
  });
});
