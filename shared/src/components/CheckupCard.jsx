import React, { useState } from "react";
import { useStore } from "../core/store";
import { TODAY, fdate, rsShort } from "../core/format";
import { Badge, Button } from "../core/ui";
import { Icon } from "../core/icons";
import { EXTEND_OPTIONS, addMonths, checkupsOf, daysBetween } from "../data/checkups";

// One listing check-up as a compact, phone-style card. Used in Business → Listing check-ups
// and on the public website when a team member opens a listing they manage.

const today = TODAY.slice(0, 10);

export function useCheckups(tid) {
  const { db, update } = useStore();
  const { settings, log } = checkupsOf(db, tid);
  const me = db.session?.userName || "Team member";
  // Record what was done and change the listing to match.
  const act = (listing, action, opts = {}) => update((d) => {
    d.checkups = d.checkups || {};
    const c = d.checkups[tid] = d.checkups[tid] || { log: [] };
    c.log = c.log || [];
    const l = d.listings.find((x) => x.id === listing.id);
    let detail = "";
    if (l && action !== "skip") {
      if (opts.accept?.length) {
        l.values = l.values || {};
        opts.accept.forEach((s) => { if (s.field === "title") l.title = s.to; else l.values[s.field] = s.to; });
        l.suggest = (l.suggest || []).filter((s) => !opts.accept.some((a) => a.field === s.field));
        detail = `Fixed ${opts.accept.map((s) => s.label.toLowerCase()).join(", ")}. `;
      }
      if (action === "ok" || action === "edit") { l.lastChecked = today; l.checkDue = addMonths(today, d.checkups[tid].settings?.extendMonths || 3); l.status = "published"; }
      if (action === "extend") { l.lastChecked = today; l.checkDue = addMonths(today, opts.months); l.status = "published"; detail += `Next check ${fdate(l.checkDue)}.`; }
      if (action === "sold") { l.lastChecked = today; l.status = "sold"; }
      if (action === "expire") { l.lastChecked = today; l.status = "expired"; }
      if (action === "remove") { d.listings = d.listings.filter((x) => x.id !== listing.id); }
      l.updated = today;
    }
    c.log.unshift({ id: `ck${Date.now()}`, at: TODAY, listingId: listing.id, title: listing.title, action, by: me, detail: detail.trim() });
  });
  return { settings, log, act, me };
}

export const dueLabel = (l) => {
  if (!l.checkDue) return ["Never checked", "progress"];
  const d = daysBetween(today, l.checkDue);
  return d < 0 ? [`Overdue ${-d} day${d === -1 ? "" : "s"}`, "problem"] : d === 0 ? ["Due today", "action"] : d <= 3 ? [`Due in ${d} day${d === 1 ? "" : "s"}`, "action"] : [`Next check ${fdate(l.checkDue)}`, "neutral"];
};

export function CheckupCard({ listing, step, total, onDone, onSkip, onEdit, act }) {
  const [accept, setAccept] = useState(() => (listing.suggest || []).map((s) => s.field));
  const [more, setMore] = useState(false);
  const chosen = (listing.suggest || []).filter((s) => accept.includes(s.field));
  const go = (action, opts = {}) => { act(listing, action, { accept: action === "skip" ? [] : chosen, ...opts }); onDone?.(action); };
  const [due, tone] = dueLabel(listing);
  return (
    <article className="cu-card" aria-label={`Check ${listing.title}`}>
      {total > 0 && <div className="cu-top"><span className="small muted tnum">Check {step} of {total}</span><button type="button" className="cu-skip" onClick={() => { go("skip"); onSkip?.(); }}>Skip</button></div>}
      {total > 0 && <div className="cu-bar"><i style={{ width: `${((step - 1) / total) * 100}%` }} /></div>}
      <div className="cu-photo">{listing.values?.photos?.[0]?.url ? <img src={listing.values.photos[0].url} alt="" /> : <Icon name="image" size={28} />}</div>
      <div className="cu-body">
        <Badge tone={tone}>{due}</Badge>
        <b className="cu-title">{listing.title}</b>
        <span className="small muted tnum">{listing.id} · {rsShort(listing.price)}{listing.lastChecked ? ` · checked ${fdate(listing.lastChecked)}` : ""}</span>
        <p className="cu-ask">Is this information still correct?</p>
        {listing.suggest?.length > 0 && <div className="cu-sugg">
          <span className="tiny muted">Found in the title and description:</span>
          {listing.suggest.map((s) => (
            <label key={s.field} className="cu-sugg-row">
              <input type="checkbox" checked={accept.includes(s.field)} onChange={(e) => setAccept(e.target.checked ? [...accept, s.field] : accept.filter((f) => f !== s.field))} />
              <span><b>{s.label}</b><small>{s.from || "empty"} → <em>{s.to}</em></small></span>
            </label>
          ))}
        </div>}
      </div>
      <div className="cu-actions">
        <Button block icon="check" onClick={() => go("ok")}>{chosen.length ? `Correct, apply ${chosen.length} fix${chosen.length > 1 ? "es" : ""}` : "All correct"}</Button>
        <div className="cu-row">
          <Button variant="outline" icon="pencil" onClick={() => { act(listing, "edit", { accept: chosen }); onEdit?.(listing); }}>Edit</Button>
          <Button variant="outline" icon="tag" onClick={() => go("sold")}>Sold / rented</Button>
          <Button variant="outline" icon="chevron-down" onClick={() => setMore(!more)} aria-expanded={more}>More</Button>
        </div>
        {more && <div className="cu-more">
          <span className="tiny muted">Keep it live for</span>
          <div className="cu-row">{EXTEND_OPTIONS.map(([m, l]) => <Button key={m} variant="outline" size="sm" onClick={() => go("extend", { months: m })}>{l}</Button>)}</div>
          <div className="cu-row"><Button variant="outline" size="sm" icon="clock" onClick={() => go("expire")}>Expire now</Button><Button variant="outline" size="sm" className="pf-danger" icon="trash-2" onClick={() => go("remove")}>Remove</Button></div>
        </div>}
      </div>
    </article>
  );
}
