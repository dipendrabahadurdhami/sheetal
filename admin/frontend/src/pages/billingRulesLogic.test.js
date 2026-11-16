// Tests for billingRulesLogic.js: the platform.billing setting as a form and back (Admin → Pricing → Billing rules).
// Rules checked: nothing the form doesn't show is changed; money has no floating point; a bad field is named in plain words and blocks the body.
import { describe, expect, it } from "vitest";
import { bodyOf, formOf, parseDays, problemsOf, rulesDirty } from "./billingRulesLogic";

// The server's defaults (platform/src/billing/types.ts BILLING_DEFAULTS).
const SAVED = {
  vatRatePct: 13, pricesIncludeVat: true, graceDays: 7, readOnlyDays: 60, reminderDays: [7, 1], pastDueReminderDays: [3, 6], refundWindowDays: 7,
  minChargePaisa: 1000, priceChangeNoticeDays: 30, quoteHours: 24, trialDays: 14, seatAutoPauseDays: 14, migrationLockMonths: 12,
  migrationFreeLimitDays: 90, minFirstPeriodDays: 5, salesEnabled: false, requireTaxInfo: true,
};

describe("billing rules form", () => {
  it("the saved value becomes form text, and an untouched form sends the very same value back", () => {
    const f = formOf(SAVED);
    expect(f).toMatchObject({ salesEnabled: false, vatRatePct: "13", graceDays: "7", minCharge: "10", reminderDays: "7, 1", pastDueReminderDays: "3, 6" });
    expect(problemsOf(f)).toEqual({});
    expect(rulesDirty(SAVED, f)).toBe(false);
    expect(bodyOf(SAVED, f, "  first check  ")).toEqual({ value: SAVED, reason: "first check" });
  });

  it("switching sales on changes only that field; the fields the form does not show stay as saved", () => {
    const f = { ...formOf(SAVED), salesEnabled: true };
    expect(rulesDirty(SAVED, f)).toBe(true);
    const body = bodyOf({ ...SAVED, migrationLockMonths: 18, quoteHours: 48 }, f, "pilot starts");
    expect(body.value).toEqual({ ...SAVED, migrationLockMonths: 18, quoteHours: 48, salesEnabled: true });
  });

  it("numbers: a decimal VAT rate is kept, the minimum charge goes to paisa without floating point", () => {
    const body = bodyOf(SAVED, { ...formOf(SAVED), vatRatePct: "13.5", minCharge: "19.99", graceDays: "10" }, "new rules");
    expect(body.value).toMatchObject({ vatRatePct: 13.5, minChargePaisa: 1999, graceDays: 10 });
  });

  it("a bad field is named and blocks the body", () => {
    const bad = (over) => problemsOf({ ...formOf(SAVED), ...over });
    expect(Object.keys(bad({ vatRatePct: "51" }))).toEqual(["vatRatePct"]);
    expect(Object.keys(bad({ graceDays: "7.5" }))).toEqual(["graceDays"]);
    expect(Object.keys(bad({ trialDays: "" }))).toEqual(["trialDays"]);
    expect(Object.keys(bad({ minCharge: "1000.01" }))).toEqual(["minCharge"]); // the server's limit is Rs 1,000
    expect(Object.keys(bad({ reminderDays: "7, x" }))).toEqual(["reminderDays"]);
    expect(Object.keys(bad({ pastDueReminderDays: "0, 3" }))).toEqual(["pastDueReminderDays"]);
    expect(bodyOf(SAVED, { ...formOf(SAVED), graceDays: "-1" }, "reason")).toBeNull();
  });

  it("day lists: spaces and repeats are tidied, biggest first; an empty list is allowed", () => {
    expect(parseDays(" 1,7 ,7, 3", 0, 60)).toEqual([7, 3, 1]);
    expect(parseDays("", 0, 60)).toEqual([]);
    expect(parseDays("61", 0, 60)).toBeNull();
    expect(parseDays("1,2,3,4,5,6,7,8,9,10,11", 0, 60)).toBeNull();
    // Reminders after a missed renewal are sent smallest first, as the server keeps them.
    expect(bodyOf(SAVED, { ...formOf(SAVED), pastDueReminderDays: "6, 3, 10" }, "reason").value.pastDueReminderDays).toEqual([3, 6, 10]);
  });
});
