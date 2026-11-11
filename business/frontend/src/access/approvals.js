// Words and small rules for the Approvals page (maker-checker, ACCESS.md section 9).
// Where it fits: pages/Approvals.jsx. The server decides everything (platform/src/approvals/service.ts); this only chooses words and what to show.
// Rules: pure functions. In Phase 1 every rule starts OFF, so the empty inbox must say that, not look broken.

export const STATUS_WORDS = {
  pending: "Waiting", approved: "Approved", executed: "Done", failed: "Could not be done", rejected: "Rejected", cancelled: "Cancelled", expired: "Ran out of time",
};
export const STATUS_TONE = { pending: "warn", approved: "info", executed: "ok", failed: "danger", rejected: "danger", cancelled: "neutral", expired: "neutral" };

/** The empty state of the inbox: different words when no rule is on, when nothing waits, and for the decided list. */
export function emptyInbox({ rulesOn, status }) {
  if (status === "decided") return { title: "Nothing decided yet", text: "Requests that were approved, rejected or cancelled show here." };
  if (!rulesOn) return { title: "Approvals are switched off", text: "No approval rule is on, so nothing is held back and actions run straight away. An owner can switch a rule on under Rules." };
  return { title: "Nothing is waiting", text: "When someone asks for an action that needs a second person, it shows here." };
}

/** The hint under a rule: a rule holds nothing back until two people could decide it (one-person businesses are never locked). */
export function ruleHint(rule) {
  if (rule.required) return "Sheetal requires this approval. It can't be switched off.";
  if (rule.enabled && rule.approvers < 2) return "Add a second person who can approve this. Until then the action runs straight away.";
  if (rule.enabled) return rule.thresholdRupees ? `Held for approval from Rs. ${Number(rule.thresholdRupees).toLocaleString("en-IN")} up.` : "Held for approval every time.";
  return "Off: the action runs straight away.";
}

/** The body PUT /approvals/rules expects (it is strict): whole rupees or null, nothing else. */
export function ruleBody(rule, patch) {
  const next = { ...rule, ...patch };
  const amount = next.thresholdRupees === "" || next.thresholdRupees === null || next.thresholdRupees === undefined ? null : Math.max(0, Math.round(Number(next.thresholdRupees)));
  return { action: next.action, enabled: !!next.enabled, thresholdRupees: Number.isFinite(amount) ? amount : null };
}

export const rupees = (n) => (n === null || n === undefined ? "" : `Rs. ${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);
