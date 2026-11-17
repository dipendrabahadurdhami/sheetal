// Plain words for Super Admin → Email (admin/frontend/src/pages/AdminEmail.jsx).
// How it works: turns the numbers from GET /admin/email/overview into one headline for the top of the page, a badge for each DNS check, and "5 minutes ago".
// Rules: short sentences, no jargon; the headline says what to do when something is wrong.

/** The big message at the top: is email working, and if not, why. */
export function headline(d) {
  if (!d.domainAdded) return { tone: "action", title: "Your email domain isn't added yet", text: `Add ${d.platformDomain} in the business panel: Settings → Domain and email. Then come back here.` };
  const reasons = [];
  if (d.server.listening === false) reasons.push("the mail server does not answer");
  if (d.server.failedLast24h) reasons.push(`${d.server.failedLast24h} email${d.server.failedLast24h > 1 ? "s" : ""} failed in the last 24 hours`);
  if (d.connected && d.problems) reasons.push(`${d.problems} DNS setting${d.problems > 1 ? "s need" : " needs"} a fix`);
  if (!d.connected) return { tone: "action", title: `${d.platformDomain} is not connected yet`, text: "Some DNS records are missing or different. Fix the red rows below, then press Check again." };
  if (d.healthy) return { tone: "done", title: "Email is working", text: `${d.platformDomain} is connected. Mail goes in and out through your own server.` };
  return { tone: "progress", title: "Email works, but needs a look", text: `${reasons.join("; ")}.`.replace(/^./, (c) => c.toUpperCase()) };
}

/** The badge for one DNS check. */
export function checkBadge(c) {
  if (c.status === "ok") return { tone: "done", label: "Found" };
  if (c.status === "wrong") return { tone: "problem", label: "Different value" };
  return c.optional ? { tone: "neutral", label: "Optional, not set" } : { tone: "action", label: "Not set up" };
}

/** "never", "just now", "5 minutes ago", "3 hours ago", "2 days ago". */
export function since(date, now = Date.now()) {
  if (!date) return "never";
  const s = Math.max(0, Math.round((now - new Date(date).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} minutes ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hours ago`;
  return `${Math.round(s / 86400)} days ago`;
}

/** What a saved business-domain check says in one word. */
export function domainState(d) {
  if (d.verified) return { tone: "done", label: "Ready" };
  const c = d.checks && typeof d.checks === "object" ? Object.values(d.checks) : [];
  return c.length ? { tone: "action", label: "Needs DNS" } : { tone: "neutral", label: "Not checked" };
}
