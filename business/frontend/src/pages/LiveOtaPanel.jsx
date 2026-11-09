// A listing on other sites (Booking.com, Airbnb…) on the business API: the table cell and the drawer.
// Where it fits: OtaPanel.jsx shows these instead of its sample versions when the business is signed in (live).
// How it works: loads GET /ota/requests once per business (kept for 30 seconds, refreshed after every action); the drawer
// lists the six sites with their state, lets the business ask (mark-up and a note), answer the team's question (text and
// up to 3 files) and stop selling. Sheetal's channel team does the work; the server tells the business when it moves.
// Rules: a site shows "Not available yet" until Sheetal has connected its partner account; a listing needs the photos the
// platform asks for (the server says how many); only stays can be sold on other sites.

import React, { useEffect, useState } from "react";
import { Badge, Button, Drawer, Field, Input, Textarea, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { bizApi, fileToBase64 } from "../api";

const STATUS = { requested: ["Requested", "action"], setting_up: ["Being set up", "progress"], needs_info: ["Needs your reply", "action"], live: ["Live", "done"], paused: ["Paused", "neutral"], rejected: ["Rejected", "problem"] };
const can_ask = (st) => !st || st === "paused" || st === "rejected";
const firstError = (e) => Object.values(e.errors || {}).flat()[0] || e.message;

let cache = null, loadedAt = 0, inflight = null;
const listeners = new Set();
export function otaReload() {
  inflight = bizApi("GET", "/ota/requests").then((r) => { cache = r; loadedAt = Date.now(); listeners.forEach((f) => f(r)); }).catch(() => {}).finally(() => { inflight = null; });
  return inflight;
}
function useOta() {
  const [r, setR] = useState(cache);
  useEffect(() => {
    listeners.add(setR);
    if (!inflight && (!cache || Date.now() - loadedAt > 30_000)) otaReload();
    return () => listeners.delete(setR);
  }, []);
  return r;
}
const latest = (rows, listingId, ch) => rows.filter((x) => x.listingId === listingId && x.channel === ch).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

/** Live listings have whole-number ids from the server; the sample ones don't. */
export const isLiveListing = (l) => Number.isInteger(l?.id);

export function LiveOtaCell({ listing, onOpen }) {
  const ota = useOta();
  const rows = ota?.data || [];
  const mine = (ota?.meta.channels || []).map((c) => ({ c, r: latest(rows, listing.id, c.id) }));
  const live = mine.filter((x) => x.r?.status === "live");
  const busy = mine.filter((x) => x.r && ["requested", "setting_up", "needs_info"].includes(x.r.status));
  const wait = mine.some((x) => x.r?.status === "needs_info");
  return (
    <button type="button" className="pf-ota-cell" onClick={onOpen} aria-label={`Other sites for ${listing.title}`}>
      {live.length ? <span className="pf-ota-dots">{live.map((x) => <i key={x.c.id} title={`Live on ${x.c.name}`}>{x.c.name[0]}</i>)}</span> : null}
      <span className="small">{live.length ? `Live on ${live.length}` : "Not on other sites"}{busy.length ? ` · ${busy.length} in progress` : ""}</span>
      {wait && <Badge tone="action">Reply needed</Badge>}
    </button>
  );
}

export function LiveOtaDrawer({ tenant, listing, onClose }) {
  const toast = useToast();
  const ota = useOta();
  const [ask, setAsk] = useState(null);
  const [reply, setReply] = useState(null);
  const [busy, setBusy] = useState(false);
  const rows = ota?.data || [];
  const meta = ota?.meta;
  const close = () => { setAsk(null); setReply(null); onClose(); };
  const done = (r) => { toast(r.message); setAsk(null); setReply(null); return otaReload(); };
  const run = (p) => { setBusy(true); return p.then(done).catch((e) => toast(firstError(e))).finally(() => setBusy(false)); };
  const send = () => run(bizApi("POST", "/ota/requests", { listingId: listing.id, channel: ask.ch.id, price: Number(ask.price) || 0, note: ask.note.trim() || undefined }));
  const answer = async () => {
    const files = await Promise.all(reply.files.map(async (f) => ({ data: await fileToBase64(f) })));
    return run(bizApi("POST", `/ota/requests/${reply.id}/reply`, { text: reply.text, files }));
  };
  const stop = (r) => run(bizApi("POST", `/ota/requests/${r.id}/pause`));
  return (
    <Drawer open={!!listing} onClose={close} title="Sell on other sites" sub={listing?.title}
      footer={ask ? <><Button variant="ghost" onClick={() => setAsk(null)}>Back</Button><Button icon="send" disabled={busy} onClick={send}>Send to Sheetal</Button></>
        : reply ? <><Button variant="ghost" onClick={() => setReply(null)}>Back</Button><Button icon="send" disabled={busy || (!reply.text.trim() && !reply.files.length)} onClick={answer}>Send answer</Button></> : null}>
      {listing && !meta && <p className="muted">Loading…</p>}
      {listing && meta && !ask && !reply && (
        <div className="pf-stack">
          <div className="pf-note"><Icon name="shield-check" size={16} /><span>Sheetal posts this listing on each site under <b>Sheetal's partner account</b>. You don't sign up, sign contracts or verify with the sites. You need at least {meta.minPhotos} photos on the listing, and money reaches you {meta.payoutDays} days after checkout.</span></div>
          {!meta.allowed && <div className="pf-note"><Icon name="info" size={16} />Selling on other sites isn't available for this business type yet.</div>}
          <div className="pf-ota-list">
            {meta.channels.map((c) => { const r = latest(rows, listing.id, c.id); const st = r?.status;
              return (
                <div key={c.id} className={`pf-ota-row ${st === "live" ? "live" : ""}`}>
                  <span className="pf-two" style={{ flex: 1, minWidth: 0 }}>
                    <b>{c.name}</b>
                    <small>{st === "live" ? `${r.price ? `+${r.price}% price` : "Same price"} · ${r.otaPropertyId}`
                      : st === "needs_info" ? r.ask
                      : st === "rejected" ? r.ask || "Sheetal couldn't post this one."
                      : st === "requested" || st === "setting_up" ? `Usually live in ${c.days}`
                      : c.available ? `Usually live in ${c.days}` : "Not available yet"}</small>
                  </span>
                  {st && <Badge tone={STATUS[st][1]}>{STATUS[st][0]}</Badge>}
                  {st === "live" && r.url && <a className="btn btn-ghost btn-sm" href={r.url} target="_blank" rel="noreferrer">View</a>}
                  {st === "needs_info" && <Button size="sm" onClick={() => setReply({ id: r.id, text: "", files: [] })}>Reply</Button>}
                  {st && !can_ask(st) && <Button size="sm" variant="ghost" disabled={busy} onClick={() => stop(r)}>{st === "live" ? "Stop selling" : "Cancel"}</Button>}
                  {can_ask(st) && c.available && <Button size="sm" variant="outline" onClick={() => setAsk({ ch: c, price: String(c.markup), note: "" })}>{st ? "Ask again" : "Sell here"}</Button>}
                </div>
              ); })}
          </div>
        </div>
      )}
      {listing && meta && ask && (
        <div className="pf-stack">
          <p style={{ margin: 0 }}>Sell <b>{listing.title}</b> on <b>{ask.ch.name}</b>.</p>
          <Field label="Add to the price on the site (%)" hint={`${ask.ch.name} keeps ${ask.ch.commission}% and Sheetal's fee is ${ask.ch.fee}%. A mark-up of about ${ask.ch.markup}% usually covers both; your price on Sheetal does not change.`}>
            <Input className="input tnum" inputMode="numeric" value={ask.price} onChange={(e) => setAsk({ ...ask, price: e.target.value.replace(/\D/g, "").slice(0, 3) })} />
          </Field>
          <Field label="Anything the team should know (optional)"><Textarea rows={3} value={ask.note} onChange={(e) => setAsk({ ...ask, note: e.target.value })} /></Field>
        </div>
      )}
      {listing && reply && (
        <div className="pf-stack">
          <p style={{ margin: 0 }}>{rows.find((x) => x.id === reply.id)?.ask}</p>
          <Field label="Your answer"><Textarea rows={4} value={reply.text} onChange={(e) => setReply({ ...reply, text: e.target.value })} /></Field>
          <Field label="Files (PDF or photos, up to 3)"><input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setReply({ ...reply, files: [...e.target.files].slice(0, 3) })} /></Field>
        </div>
      )}
    </Drawer>
  );
}
