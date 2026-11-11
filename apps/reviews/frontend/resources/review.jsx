// The Reviews page described as data for CrudPage: the list, the filter chips, the stat cards, the star breakdown, the empty states and the reply request.
// Where it fits: ReviewsPage (the only screen). Read-only: no create, change or delete; the only write is a public reply.
// How it works: `GET /reviews?show=all|unanswered|low` answers { data: [reviews], meta: { count, unanswered, average, stars[], canReply } }. `versioned: true` plus
// saveFlow.js put the review's `version` into every reply (post, edit, remove): a stale one gets 409 and the page says "Someone changed this. Reload to see the latest."
// and reloads. An empty text removes the reply. Nothing is retried by itself.
// Rules: texts are the ones the old LiveReviews page had; the reply box shows only when meta.canReply is true (the server decides again); the page offers no
// "all branches across the business" choice (the server caps reviews at the branch).

import React from "react";
import { Panel } from "@sheetal/ui/primitives";
import { Stars } from "@sheetal/ui/stars";
import { reactToFailure, runRowAction } from "@sheetal/ui/crud";
import { ApiError } from "@sheetal/sdk/client";

export const SHOW_OPTIONS = [{ id: "all", label: "All" }, { id: "unanswered", label: "Waiting for a reply" }, { id: "low", label: "1 or 2 stars" }];

/** The three stat cards. */
export function reviewStats(m) {
  return [
    { label: "Average", value: m.average ?? "–", note: m.average ? <Stars value={m.average} size={13} /> : "No reviews yet" },
    { label: "Reviews", value: m.count },
    { label: "Waiting for a reply", value: m.unanswered, tone: m.unanswered ? "action" : undefined },
  ];
}

/** Width of one bar of the star breakdown, in percent. */
export const barPercent = (count, total) => (total ? (count / total) * 100 : 0);

/** The "Stars" panel with the breakdown; nothing when there are no reviews. */
export function starsPanel(m) {
  if (!(m?.count > 0)) return null;
  return (
    <Panel title="Stars" pad>
      {m.stars.map((s) => (
        <div key={s.stars} className="pf-star-row"><span className="tnum">{s.stars} ★</span><div className="bar"><i style={{ width: `${barPercent(s.count, m.count)}%` }} /></div><span className="tnum small muted">{s.count}</span></div>
      ))}
    </Panel>
  );
}

export const reviewResource = {
  path: "/reviews",
  label: { one: "review", many: "reviews" },
  versioned: true,
  perms: {},
  loadingText: "Loading reviews…",
  list: {
    filters: [{ id: "show", type: "chips", default: "all", options: SHOW_OPTIONS }],
    params: ({ show }) => ({ show: show || "all" }),
    sortable: false,
    gridClass: "pf-review-list",
  },
  empty: (filters) => (filters?.show === "all" || !filters?.show
    ? { icon: "star", title: "No reviews yet", sub: "Reviews people leave on your listings and agency page on the website appear here." }
    : { icon: "star", title: "Nothing here", sub: "Try another filter." }),
};

/** The reply as a row action: POST /reviews/:id/reply with { text, version }. */
export const replyAction = (text) => ({ id: "reply", run: (row, api, v) => api("POST", `${reviewResource.path}/${row.id}/reply`, { text, ...v }) });

/** Send a reply (or, with empty text, take it down). The review's version goes along. */
export const postReply = (row, text, api) => runRowAction(reviewResource, replyAction(text), row, api);

/**
 * Send a reply and deal with the answer. ui: { api, toast(text), t, reload() }. Returns true when it worked, false when it failed
 * (a stale version says "Someone changed this. Reload to see the latest." and reloads, once; a review that was hidden or removed meanwhile (404) shows
 * the server's words and reloads, so its card goes away; any other failure shows the server's words).
 */
export async function sendReply(row, text, ui) {
  try {
    const res = await postReply(row, text, ui.api);
    if (res?.message) ui.toast(res.message);
    ui.reload();
    return true;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) { ui.toast(e.message); ui.reload(); return false; }
    reactToFailure(e, { conflict: () => ui.toast(ui.t("kit.conflict")), reload: ui.reload, fields: (_errs, message) => ui.toast(message), message: ui.toast });
    return false;
  }
}
