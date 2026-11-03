import React, { useEffect, useState } from "react";
import { fdate } from "@sheetal/shared/core/format";
import { Button, Empty, PageHead, Panel, Stat, Textarea, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { bizApi } from "../api";

// Reviews people left on the website about the business and its listings, answered here in public: the reply shows
// under the review on the website, and the reviewer is told.

const Stars = ({ n, size = 14 }) => (
  <span className="pf-stars" aria-label={`${n} out of 5 stars`}>{[1, 2, 3, 4, 5].map((i) => <Icon key={i} name="star" size={size} className={i <= Math.round(n) ? "on" : ""} />)}</span>
);

export function LiveReviews({ tenant }) {
  const toast = useToast();
  const [show, setShow] = useState("all");
  const [data, setData] = useState(null);
  const [tick, setTick] = useState(0);
  const [drafts, setDrafts] = useState({});
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(null);
  useEffect(() => { bizApi("GET", `/reviews?show=${show}`).then(setData).catch((e) => { toast(e.message); setData({ data: [], meta: null }); }); }, [show, tick, tenant.id]);
  const reply = (r, text) => {
    setBusy(r.id);
    bizApi("POST", `/reviews/${r.id}/reply`, { text }).then((x) => { toast(x.message); setEditing(null); setDrafts((d) => ({ ...d, [r.id]: "" })); setTick((n) => n + 1); })
      .catch((e) => toast(e.message)).finally(() => setBusy(null));
  };
  if (!data) return <p className="muted pf-pad">Loading reviews…</p>;
  const m = data.meta;
  return (
    <>
      <PageHead title="Reviews" sub="What people say about your business and listings on the website. Your reply shows under their review, and they are told." />
      {m && <div className="pf-stats">
        <Stat label="Average" value={m.average ?? "–"} note={m.average ? <Stars n={m.average} size={13} /> : "No reviews yet"} />
        <Stat label="Reviews" value={m.count} />
        <Stat label="Waiting for a reply" value={m.unanswered} tone={m.unanswered ? "action" : undefined} />
      </div>}
      {m?.count > 0 && <Panel title="Stars" pad>
        {m.stars.map((s) => (
          <div key={s.stars} className="pf-star-row"><span className="tnum">{s.stars} ★</span><div className="bar"><i style={{ width: `${m.count ? (s.count / m.count) * 100 : 0}%` }} /></div><span className="tnum small muted">{s.count}</span></div>
        ))}
      </Panel>}
      <div className="pf-chip-row" style={{ margin: "12px 0" }}>
        {[["all", "All"], ["unanswered", "Waiting for a reply"], ["low", "1 or 2 stars"]].map(([id, label]) => (
          <button key={id} type="button" className={`chip ${show === id ? "active" : ""}`} aria-pressed={show === id} onClick={() => setShow(id)}>{label}</button>
        ))}
      </div>
      {!data.data.length ? <Empty icon="star" title={show === "all" ? "No reviews yet" : "Nothing here"} sub={show === "all" ? "Reviews people leave on your listings and agency page on the website appear here." : "Try another filter."} /> : (
        <div className="pf-stack">
          {data.data.map((r) => (
            <section key={r.id} className="card pf-pad pf-review">
              <div className="pf-row-actions" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <div className="pf-two"><b>{r.by}</b><small className="muted">{fdate(r.at)} · {r.about === "business" ? "About your business" : <a href={r.listing?.link} target="_blank" rel="noreferrer">{r.listing?.title || "A listing"}</a>}</small></div>
                <Stars n={r.rating} />
              </div>
              {r.comment && <p style={{ margin: "8px 0 0" }}>{r.comment}</p>}
              {r.reply && editing !== r.id ? (
                <div className="pf-review-reply">
                  <small className="muted">Your reply{r.repliedBy ? ` by ${r.repliedBy}` : ""} · {fdate(r.repliedAt)}</small>
                  <p>{r.reply}</p>
                  {m?.canReply && <div className="pf-row-actions" style={{ justifyContent: "flex-start" }}>
                    <Button size="sm" variant="ghost" icon="pencil" onClick={() => { setEditing(r.id); setDrafts((d) => ({ ...d, [r.id]: r.reply })); }}>Edit</Button>
                    <Button size="sm" variant="ghost" disabled={busy === r.id} onClick={() => reply(r, "")}>Remove</Button>
                  </div>}
                </div>
              ) : m?.canReply && (
                <div className="pf-stack" style={{ marginTop: 10 }}>
                  <Textarea rows={2} value={drafts[r.id] || ""} onChange={(e) => setDrafts({ ...drafts, [r.id]: e.target.value })} placeholder="Write a public reply: thank them, or say how you'll put it right." aria-label={`Reply to ${r.by}`} />
                  <div className="pf-row-actions" style={{ justifyContent: "flex-start" }}>
                    <Button size="sm" disabled={busy === r.id || !(drafts[r.id] || "").trim()} onClick={() => reply(r, drafts[r.id].trim())}>{r.reply ? "Save reply" : "Post reply"}</Button>
                    {editing === r.id && <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>}
                  </div>
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </>
  );
}
