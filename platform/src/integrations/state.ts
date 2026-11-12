// The life-cycle of a connection: which action is allowed from which state, and what it leads to (INTEGRATIONS.md section 4).
// Where it fits: service.ts asks next() before every change and usable() when an app wants to use a connection. Pure: no database, no network.
// How it works: details entered -> test -> test passed -> live -> paused. A change of a field on a tested connection sends it back to "details entered";
// a change on a live or paused one is STAGED instead (it waits until it passes a test, then "Apply" swaps it in), so a typo never breaks what is live.
// Rules: health is not a state. Nothing here pauses or un-pauses by itself. A passing test is only good for going live for 7 days.

import type { ConnectionState, HealthStatus, Mode } from "./types.js";

export type Action = "save" | "submit" | "approve" | "reject" | "test" | "go_live" | "pause" | "resume" | "disconnect";
export const TEST_GOOD_FOR_DAYS = 7;
export const STATE_WORDS: Record<ConnectionState | "none", string> = {
  none: "Not set up", draft: "Details missing", in_review: "In review", rejected: "Sent back", details_entered: "Ready to test",
  test_failed: "Test failed", test_passed: "Test passed", live: "Live", paused: "Paused",
};

export class TransitionError extends Error {}

/** Is the connection being changed in place (false) or through a staged copy (true)? */
export const stagesChanges = (state: ConnectionState | "none"): boolean => state === "live" || state === "paused";

export interface NextInput {
  state: ConnectionState | "none";
  action: Action;
  /** save: every required field (and document) is present and valid. */
  complete?: boolean;
  /** save / submit: the spec asks for a human check before credentials, and it has not been accepted yet. */
  needsReview?: boolean;
  /** test: did it pass. */
  ok?: boolean;
  /** go_live: when the last passing test on the current details ran, and now. */
  lastTestAt?: Date | null;
  lastTestOk?: boolean | null;
  now?: Date;
}

/** The state after the action, or a TransitionError with a plain sentence saying why not. */
export function next(i: NextInput): ConnectionState {
  const s = i.state;
  const no = (why: string): never => { throw new TransitionError(why); };
  switch (i.action) {
    case "save":
      if (s === "in_review") return no("This connection is being reviewed. Wait for the answer before changing it.");
      if (stagesChanges(s)) return s as ConnectionState;                       // staged: the live details do not move
      if (!i.complete) return "draft";
      return i.needsReview ? "draft" : "details_entered";                       // a changed field always resets a passed or failed test
    case "submit":
      if (s !== "draft" && s !== "rejected") return no("Only a connection that is being filled in can be sent for review.");
      if (!i.needsReview) return no("This connection does not need a review.");
      return "in_review";
    case "approve":
      if (s !== "in_review") return no("This connection is not waiting for a review.");
      return "draft";
    case "reject":
      if (s !== "in_review") return no("This connection is not waiting for a review.");
      return "rejected";
    case "test":
      if (stagesChanges(s)) return s as ConnectionState;                       // a test of the staged copy, or a re-check of the live one
      if (s !== "details_entered" && s !== "test_failed" && s !== "test_passed") return no("Enter the details first, then test.");
      return i.ok ? "test_passed" : "test_failed";
    case "go_live": {
      if (s !== "test_passed") return no("Run a test that passes first, then go live.");
      const at = i.lastTestAt?.getTime();
      const now = (i.now ?? new Date()).getTime();
      if (!i.lastTestOk || !at || now - at > TEST_GOOD_FOR_DAYS * 864e5) return no(`The last passing test is older than ${TEST_GOOD_FOR_DAYS} days. Test again, then go live.`);
      return "live";
    }
    case "pause":
      if (s !== "live") return no("Only a live connection can be paused.");
      return "paused";
    case "resume":
      if (s !== "paused") return no("Only a paused connection can be resumed.");
      return "live";
    case "disconnect":
      if (s === "none") return no("There is nothing to disconnect.");
      if (s === "in_review") return no("This connection is being reviewed. Wait for the answer first.");
      return "draft";
  }
}

/**
 * May the platform or a business's apps use this connection now? Live and not down; or, outside production, a test-mode connection whose details are in
 * (this keeps today's "try it locally" behaviour).
 */
export function usable(c: { state: ConnectionState | "none"; mode: Mode; health: HealthStatus }, env: "development" | "test" | "production"): boolean {
  if (c.state === "live") return c.health !== "down";
  return env !== "production" && c.mode === "test" && (c.state === "details_entered" || c.state === "test_passed");
}

export const HEALTH_FAILS_FOR_DOWN = 3;

/** The health after one more probe: three failures in a row = down; the first success clears it. `alert` says whether to tell people now. */
export function healthAfter(prev: { status: HealthStatus; failures: number }, probe: HealthStatus): { status: HealthStatus; failures: number; alert: "down" | "back" | null } {
  if (probe === "healthy" || probe === "degraded") {
    return { status: probe, failures: 0, alert: prev.status === "down" ? "back" : null };
  }
  if (probe === "unknown") return { status: prev.status, failures: prev.failures, alert: null };
  const failures = prev.failures + 1;
  if (failures >= HEALTH_FAILS_FOR_DOWN) return { status: "down", failures, alert: prev.status === "down" ? null : "down" };
  return { status: prev.status === "down" ? "down" : "degraded", failures, alert: null };
}
