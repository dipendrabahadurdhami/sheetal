// The paisa amount check (P3-BE-9, MB section 4): a gateway's amount must equal the invoice's paisa exactly; one paisa off is refused.
// Run with: npm run test -w @sheetal/backend-core (pure)
import { describe, expect, it } from "vitest";
import { amountMatches, gatewayPaisa, rupeesText } from "../src/lib/payments.js";

describe("gateway amounts in paisa", () => {
  it("reads rupees with up to two decimals and paisa as whole numbers, without floating point", () => {
    expect([gatewayPaisa("140.53", "rupees"), gatewayPaisa("140.5", "rupees"), gatewayPaisa("700", "rupees"), gatewayPaisa(700, "rupees"), gatewayPaisa("1,500.00", "rupees")]).toEqual([14_053n, 14_050n, 70_000n, 70_000n, 150_000n]);
    expect([gatewayPaisa(14_053, "paisa"), gatewayPaisa("14053", "paisa")]).toEqual([14_053n, 14_053n]);
    expect([gatewayPaisa("12.345", "rupees"), gatewayPaisa("abc", "rupees"), gatewayPaisa(-1, "rupees"), gatewayPaisa("140.53", "paisa"), gatewayPaisa(null, "rupees")]).toEqual([null, null, null, null, null]);
    expect(rupeesText(14_053n)).toBe("140.53");
    expect(rupeesText(70_000)).toBe("700.00");
  });
  it("matches exactly and refuses one paisa off, per gateway unit", () => {
    expect(amountMatches("esewa", "140.53", 14_053n)).toBe(true);
    expect(amountMatches("esewa", "140.52", 14_053n)).toBe(false);
    expect(amountMatches("esewa", "140.54", 14_053)).toBe(false);
    expect(amountMatches("khalti", 14_053, 14_053n)).toBe(true);
    expect(amountMatches("khalti", 14_052, 14_053n)).toBe(false);
    expect(amountMatches("khalti", "140.53", 14_053n)).toBe(false); // Khalti answers in paisa: a rupee text is not a clean amount
    expect(amountMatches("fonepay", "700.00", 70_000n)).toBe(true);
  });
});
