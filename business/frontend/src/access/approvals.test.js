// Tests for the Approvals page words and the rule body.
import { describe, expect, it } from "vitest";
import { emptyInbox, ruleBody, ruleHint, rupees } from "./approvals.js";

describe("approvals page", () => {
  it("says approvals are off when no rule is on", () => {
    expect(emptyInbox({ rulesOn: false, status: "pending" }).title).toBe("Approvals are switched off");
    expect(emptyInbox({ rulesOn: true, status: "pending" }).title).toBe("Nothing is waiting");
    expect(emptyInbox({ rulesOn: false, status: "decided" }).title).toBe("Nothing decided yet");
  });
  it("explains a rule that cannot hold anything yet", () => {
    expect(ruleHint({ enabled: true, approvers: 1 })).toMatch(/second person/);
    expect(ruleHint({ enabled: true, approvers: 2, thresholdRupees: 50000 })).toBe("Held for approval from Rs. 50,000 up.");
    expect(ruleHint({ enabled: false, approvers: 3 })).toMatch(/^Off/);
    expect(ruleHint({ required: true, enabled: true, approvers: 3 })).toMatch(/requires/);
  });
  it("builds the strict rule body", () => {
    const rule = { action: "expenses.expense.confirm", enabled: false, thresholdRupees: null, label: "x", approvers: 2, app: "expenses" };
    expect(ruleBody(rule, { enabled: true })).toEqual({ action: "expenses.expense.confirm", enabled: true, thresholdRupees: null });
    expect(ruleBody(rule, { thresholdRupees: "2500.4" })).toEqual({ action: "expenses.expense.confirm", enabled: false, thresholdRupees: 2500 });
    expect(ruleBody(rule, { thresholdRupees: "" }).thresholdRupees).toBeNull();
    expect(ruleBody(rule, { thresholdRupees: "abc" }).thresholdRupees).toBeNull();
  });
  it("writes rupees", () => { expect(rupees(125000)).toBe("Rs. 1,25,000"); expect(rupees(null)).toBe(""); });
});
