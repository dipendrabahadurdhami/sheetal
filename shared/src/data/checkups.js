// Listing check-ups: team members confirm a few listings every day so the information stays correct.
// Where it fits: Business → Listing check-ups and the dashboard's to-do count.
// How it works: works out today's list from each listing's due date and the business's check-up settings.

export const CHECKUP_DEFAULTS = {
  reviewers: "all",      // "all" = everyone who manages listings, or a list of member ids
  perDay: 5,             // listings per person per day (3–5)
  askBeforeDays: 3,      // ask about a listing this many days before its check date
  extendMonths: 3,       // "All correct" pushes the next check this far
  overdue: "keep",       // "keep" = stays live and keeps being asked; "hide" = hidden until checked
};

export const EXTEND_OPTIONS = [[3, "3 months"], [6, "6 months"], [12, "1 year"]];

export const addMonths = (iso, n) => { const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
export const daysBetween = (a, b) => Math.round((new Date(`${b.slice(0, 10)}T00:00:00Z`) - new Date(`${a.slice(0, 10)}T00:00:00Z`)) / 864e5);

export const checkupsOf = (db, tid) => {
  const c = db.checkups?.[tid] || {};
  return { settings: { ...CHECKUP_DEFAULTS, ...(c.settings || {}) }, log: c.log || [] };
};

// Who checks listings: the manager's choice, or everyone who can manage listings.
export const isReviewer = (settings, memberId) => settings.reviewers === "all" || settings.reviewers.includes(memberId);

// Live listings that need a check, most urgent first:
// overdue → due within `askBeforeDays` → never checked → longest since last check; more AI suggestions first on ties.
export function checkupQueue(listings, settings, today) {
  const live = listings.filter((l) => l.status === "published" || l.status === "hidden_check");
  const urgency = (l) => {
    if (!l.checkDue) return 2;
    const d = daysBetween(today, l.checkDue);
    return d < 0 ? 0 : d <= settings.askBeforeDays ? 1 : 3;
  };
  return [...live].sort((a, b) => urgency(a) - urgency(b)
    || String(a.lastChecked || "").localeCompare(String(b.lastChecked || ""))
    || (b.suggest?.length || 0) - (a.suggest?.length || 0));
}

// Today's list for one person: the queue minus what anyone already handled today, `perDay` at a time (more on request).
export function todaysList(listings, settings, log, today, extra = 0) {
  const handled = new Set(log.filter((e) => e.at.slice(0, 10) === today).map((e) => e.listingId));
  const queue = checkupQueue(listings, settings, today).filter((l) => !handled.has(l.id));
  return queue.slice(0, settings.perDay + extra);
}

export const ACTIONS = {
  ok: ["All correct", "done"], edit: ["Details updated", "done"], sold: ["Marked sold or rented", "neutral"],
  extend: ["Extended", "done"], expire: ["Expired", "neutral"], remove: ["Removed", "problem"], skip: ["Skipped", "neutral"],
};
