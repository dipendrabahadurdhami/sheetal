// ReviewCard: one review as a card: who, when, what it is about, the stars, the comment and the reply box.
// Where it fits: ReviewsPage's renderCard. A review about a listing shows the listing's code, its title and a link to its public page; one about the business says so.
// How it works: all text comes from the review the server sent. The link opens the public page in a new tab.
// Rules: nothing is worked out here; the reply box decides what to show from `canReply`.

import React from "react";
import { fdate } from "@sheetal/shared/core/format";
import { Stars } from "@sheetal/ui/stars";
import { ReplyBox } from "./ReplyBox.jsx";

export function aboutText(r) {
  if (r.about === "business") return "About your business";
  const l = r.listing;
  return (
    <>
      {l?.code && <><span className="pf-review-code">{l.code}</span> · </>}
      <a href={l?.link} target="_blank" rel="noreferrer">{l?.title || "A listing"}</a>
    </>
  );
}

export function ReviewCard({ review: r, canReply, onReply }) {
  return (
    <section className="pf-review" aria-label={`Review by ${r.by}`}>
      <div className="pf-review-head">
        <div className="pf-two"><b>{r.by}</b><small className="muted">{fdate(r.at)} · {aboutText(r)}</small></div>
        <Stars value={r.rating} />
      </div>
      {r.comment && <p className="pf-review-text">{r.comment}</p>}
      <ReplyBox review={r} canReply={canReply} onReply={onReply} />
    </section>
  );
}
