import React, { useState } from "react";
import { useStore } from "@sheetal/shared/core/store";
import { fdate, rs } from "@sheetal/shared/core/format";
import { Badge, Button, Drawer, Field, Seg, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { OTAS, OTA_STATUS, canAsk, forListing, latestFor, otaName, otaSettings, otaSplit, otaUrl, siteHref, withOta } from "@sheetal/shared/data/ota";

export const isStayListing = (l) => String(l.kind).startsWith("stay");

// Compact status of one listing on the other sites, for the listings table
export function OtaCell({ listing, onOpen }) {
  const { db } = useStore();
  const reqs = forListing(db, listing.id);
  const live = OTAS.filter((o) => latestFor(reqs, o.id)?.status === "live");
  const busy = OTAS.filter((o) => { const s = latestFor(reqs, o.id)?.status; return s && s !== "live" && !canAsk(s); });
  const wait = OTAS.some((o) => latestFor(reqs, o.id)?.status === "needs_info");
  return (
    <button type="button" className="pf-ota-cell" onClick={onOpen} aria-label={`Other sites for ${listing.title}`}>
      {live.length ? <span className="pf-ota-dots">{live.map((o) => <i key={o.id} title={`Live on ${o.name}`}>{o.name[0]}</i>)}</span> : null}
      <span className="small">{live.length ? `Live on ${live.length}` : "Not on other sites"}{busy.length ? ` · ${busy.length} in progress` : ""}</span>
      {wait && <Badge tone="action">Reply needed</Badge>}
    </button>
  );
}

// Everything about posting one listing on the other sites
export function OtaDrawer({ tenant, listing, onClose }) {
  const { db, update } = useStore();
  const toast = useToast();
  const set = otaSettings(db);
  const [ask, setAsk] = useState(null);
  const [reply, setReply] = useState(null);
  const reqs = listing ? forListing(db, listing.id) : [];
  const allowed = set.types[tenant.type] !== false;
  const log = (r, what) => { r.log = [...(r.log || []), { at: new Date().toISOString(), who: tenant.name, what }]; };
  const change = (id, patch, what) => update((d) => { const r = withOta(d).requests.find((x) => x.id === id); Object.assign(r, patch); log(r, what); });
  const send = () => {
    update((d) => { const o = withOta(d); const r = { id: `OTA-${200 + o.requests.length}`, tid: tenant.id, lid: listing.id, title: listing.title, ch: ask.ch, status: "requested", at: new Date().toISOString().slice(0, 10), price: ask.price, note: ask.note, ask: "", otaId: "", url: "", by: "", log: [] }; log(r, "Asked Sheetal to post the listing"); o.requests.unshift(r); });
    toast(`Sent. Sheetal will post it on ${otaName(ask.ch)}.`); setAsk(null);
  };
  const ex = otaSplit(db, ask?.ch || "booking", 10000);
  return (
    <Drawer open={!!listing} onClose={() => { setAsk(null); setReply(null); onClose(); }} title="Sell on other sites" sub={listing?.title}
      footer={ask ? <><Button variant="ghost" onClick={() => setAsk(null)}>Back</Button><Button icon="send" onClick={send}>Send to Sheetal</Button></>
        : reply ? <><Button variant="ghost" onClick={() => setReply(null)}>Back</Button><Button icon="send" onClick={() => { change(reply.id, { status: "setting_up", note: reply.text }, `Replied: ${reply.text || "files added"}`); setReply(null); toast("Sent. The team will carry on."); }}>Send reply</Button></>
        : <a className="btn btn-outline" href={siteHref(`/site/${tenant.id}`)} target="_blank" rel="noreferrer"><Icon name="external-link" size={16} />View on Sheetal</a>}>
      {listing && !ask && !reply && <div className="pf-stack">
        <div className="pf-note"><Icon name="shield-check" size={16} /><span>Sheetal posts this listing on each site under <b>Sheetal's partner account</b>. You don't sign up, sign contracts or verify with the sites. Prices and free rooms come from your calendar, and bookings land in <b>Bookings</b>.</span></div>
        {!allowed && <div className="pf-note"><Icon name="info" size={16} />Selling on other sites isn't available for this business type yet.</div>}
        <div className="pf-ota-list">
          {OTAS.map((o) => { const r = latestFor(reqs, o.id); const st = r?.status; const cfg = set.sites[o.id]; const off = !cfg.on || otaOfAcc(db, o.id) !== "connected";
            return (
              <div key={o.id} className={`pf-ota-row ${st === "live" ? "live" : ""}`}>
                <span className="pf-two" style={{ flex: 1, minWidth: 0 }}>
                  <b>{o.name}</b>
                  <small>{st === "live" ? `${r.price ? `+${r.price}% price` : "Same price"} · ${r.otaId}`
                    : st === "needs_info" ? r.ask
                    : st === "requested" || st === "setting_up" ? `Usually live in ${o.days}${r.by ? ` · ${r.by} is on it` : ""}`
                    : st === "stop_requested" ? "Sheetal will take it down within a day"
                    : off ? "Coming soon on Sheetal" : `Site fee ${cfg.commission}% · Sheetal ${cfg.fee}% per booking`}</small>
                </span>
                {st && st !== "declined" ? <Badge tone={OTA_STATUS[st][1]}>{OTA_STATUS[st][0]}</Badge> : null}
                <span className="pf-ota-acts">
                  {canAsk(st) && !off && allowed && <Button size="sm" variant="outline" icon="send" onClick={() => setAsk({ ch: o.id, price: cfg.markup, note: "" })}>{st === "paused" ? "Post again" : "Post here"}</Button>}
                  {st === "requested" && <Button size="sm" variant="ghost" onClick={() => { change(r.id, { status: "declined", ask: "Cancelled by you" }, "Cancelled"); toast("Request cancelled"); }}>Cancel</Button>}
                  {st === "needs_info" && <Button size="sm" icon="reply" onClick={() => setReply({ id: r.id, text: "" })}>Reply</Button>}
                  {st === "live" && <><a className="btn btn-outline btn-sm" href={otaUrl(r)} target="_blank" rel="noreferrer"><Icon name="external-link" size={14} />View on {o.name}</a>
                    <Button size="sm" variant="ghost" onClick={() => { change(r.id, { status: "stop_requested" }, "Asked to stop selling"); toast(`Sheetal will stop selling on ${o.name}`); }}>Stop</Button></>}
                </span>
              </div>
            ); })}
        </div>
        <details className="pf-ota-know">
          <summary><Icon name="info" size={15} />What you should know</summary>
          <ul>
            <li>Each site takes its fee from the booking. Sheetal adds a small service fee. You get the rest with your normal payout, {set.payoutDays} days after the guest checks out.</li>
            <li>Most businesses add the site fee to the price there, so they earn the same as on Sheetal.</li>
            <li>Rooms, prices and closed dates sync from your calendar every few minutes. Don't change them on the site.</li>
            <li>Bookings from the sites show in Bookings with the site's name. Confirm new ones within 24 hours.</li>
            <li>Your cancellation policy is used on every site. Guests' reviews there stay on that site.</li>
            <li>The team needs at least {set.minPhotos} good photos, your check-in and check-out times and house rules.</li>
          </ul>
        </details>
        {reqs.length > 0 && <div className="pf-stack tight"><b className="small">History</b>{reqs.slice().sort((a, b) => b.at.localeCompare(a.at)).map((r) => <span key={r.id} className="small"><span className="muted tnum">{fdate(r.at)}</span> · {otaName(r.ch)} · {OTA_STATUS[r.status][0]}</span>)}</div>}
      </div>}
      {ask && <div className="pf-stack">
        <h3 className="pf-subhead" style={{ margin: 0 }}>Post on {otaName(ask.ch)}</h3>
        <Field label="Price on this site" hint={`${otaName(ask.ch)} takes ${set.sites[ask.ch].commission}% of each booking.`}><Seg value={String(ask.price)} onChange={(v) => setAsk({ ...ask, price: Number(v) })} options={[0, 10, 15, 20].map((p) => ({ id: String(p), label: p ? `+${p}%` : "Same as Sheetal" }))} /></Field>
        <div className="pf-totals">
          <div><span>Guest pays on {otaName(ask.ch)}</span><span className="tnum">{rs(10000)}</span></div>
          <div><span>Site fee ({ex.commission}%)</span><span className="tnum">− {rs(ex.site)}</span></div>
          <div><span>Sheetal service ({ex.feePct}%)</span><span className="tnum">− {rs(ex.fee)}</span></div>
          <div className="total"><span>You get</span><span className="tnum">{rs(ex.net)}</span></div>
        </div>
        <Field label="Anything the team should know" optional><textarea className="input" rows={3} value={ask.note} onChange={(e) => setAsk({ ...ask, note: e.target.value })} placeholder="Best time to call, season start, photos to use…" /></Field>
        <span className="small muted">Usually live in {OTAS.find((o) => o.id === ask.ch).days}. You'll get a message when it's live.</span>
      </div>}
      {reply && <div className="pf-stack">
        <div className="pf-note"><Icon name="message-circle" size={16} /><span>{reqs.find((r) => r.id === reply.id)?.ask}</span></div>
        <Field label="Your reply"><textarea className="input" rows={4} value={reply.text} onChange={(e) => setReply({ ...reply, text: e.target.value })} /></Field>
        <label className="btn btn-outline btn-sm" style={{ alignSelf: "flex-start" }}><input type="file" hidden multiple accept="image/*,.pdf" /><Icon name="upload" size={14} />Add photos or files</label>
      </div>}
    </Drawer>
  );
}
const otaOfAcc = (db, ch) => (db.otaDesk?.accounts || { expedia: "pending" })[ch] || "connected";
