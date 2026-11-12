// Words and small rules for the Integration Center screens (INTEGRATIONS.md sections 4 and 7).
// Where it fits: IntegrationCenter.jsx. The server decides everything (platform/src/integrations/service.ts); this only picks words, colours and which
// buttons to show for a state.
// Rules: pure functions, so they are tested without a browser. No state is ever changed here.

export const GROUPS = [
  ["payments", "Payments"], ["messaging", "Messaging"], ["email", "Email"], ["web", "Website and domains"], ["ai", "AI"], ["social", "Social"],
  ["delivery", "Delivery"], ["channels", "Booking channels"], ["tax", "Tax"],
];

const STATE = {
  none: ["Not set up", "neutral"], draft: ["Details missing", "neutral"], in_review: ["In review", "info"], rejected: ["Sent back", "danger"],
  details_entered: ["Ready to test", "info"], test_failed: ["Test failed", "danger"], test_passed: ["Test passed", "ok"], live: ["Live", "ok"], paused: ["Paused", "warn"],
};
/** The badge of a card: the state, or the health when a live connection is not healthy. */
export function badgeOf(connection) {
  if (connection.state === "live" && connection.health?.status === "down") return { label: "Live, not answering", tone: "danger" };
  if (connection.state === "live" && connection.health?.status === "degraded") return { label: "Live, check it", tone: "warn" };
  const [label, tone] = STATE[connection.state] || STATE.none;
  return { label, tone };
}

/** Which actions the screen offers for this connection (the server still checks each one). */
export function actionsOf(row, canManage) {
  const c = row.connection;
  if (!canManage) return { save: false, test: false, goLive: false, pause: false, resume: false, apply: false, testStaged: false, disconnect: false };
  const live = c.state === "live" || c.state === "paused";
  const waiting = live && !!c.stagedConfig || (live && c.has.staged.length > 0);
  return {
    save: c.state !== "in_review",
    test: ["details_entered", "test_failed", "test_passed", "live"].includes(c.state),
    goLive: c.state === "test_passed" && row.spec.built,
    pause: c.state === "live",
    resume: c.state === "paused",
    testStaged: waiting,
    apply: waiting && !!row.stagedTested,
    disconnect: c.state !== "none" && c.state !== "in_review",
  };
}

/** Which details tabs to show: a provider with test and live keys gets both; the live tab opens after a passing test. */
export function tabsOf(row) {
  const c = row.connection;
  if (!row.spec.modes.includes("test")) return [{ id: "live", label: "Details", open: true }];
  const liveOpen = ["test_passed", "live", "paused"].includes(c.state);
  return [{ id: "test", label: "Test details", open: c.state !== "live" && c.state !== "paused" }, { id: "live", label: "Live details", open: liveOpen }];
}

/** The body of a save: only the fields that were typed; a secret left empty is not sent (it is kept as it is). */
export function saveBody(spec, typed, mode, version) {
  const values = {};
  for (const f of spec.fields) {
    const v = typed[f.key];
    if (v === undefined) continue;
    if (f.secret && v.trim() === "") continue;
    values[f.key] = f.secret ? v : v.trim();
  }
  return { values, mode, ...(version ? { version } : {}) };
}

/** Is this secret field already saved for the tab being shown? */
export function hasSecret(connection, key, tab) {
  const live = connection.state === "live" || connection.state === "paused";
  if (live && connection.has.staged.includes(key)) return true;
  return (connection.has[tab] || []).includes(key);
}

export const countLive = (rows) => rows.filter((r) => r.connection.state === "live").length;
