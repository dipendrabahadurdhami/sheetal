import React, { useState } from "react";
import { useStore } from "@sheetal/shared/core/store";
import { fdate, fdatetime } from "@sheetal/shared/core/format";
import { Badge, Button, Drawer, Field, Input, PageHead, Panel, Stat, Table, Tabs, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { OPEN, OTAS, OTA_STATUS, otaName, otaOf, otaSettings, otaUrl, siteHref, withOta } from "@sheetal/shared/data/ota";
import { audit } from "./AdminOps";

// Channel manager desk. Sheetal holds one partner account per OTA; the channel team lists subscribers under it.
const TEAM = ["Sujata Rai", "Kiran Basnet", "Anjali Thapa"];
export function AdminChannels() {
  const { db, update } = useStore();
  const toast = useToast();
  const ota = otaOf(db);
  const cfg = otaSettings(db);
  const [tab, setTab] = useState("queue");
  const [open, setOpen] = useState(null);
  const [f, setF] = useState({ ask: "", otaId: "" });
  const biz = (tid) => db.tenants.find((x) => x.id === tid);
  const queue = ota.requests.filter((r) => OPEN.includes(r.status));
  const live = ota.requests.filter((r) => r.status === "live");
  const r = ota.requests.find((x) => x.id === open);
  const act = (id, patch, what) => {
    update((d) => { const x = withOta(d).requests.find((y) => y.id === id); Object.assign(x, patch); x.log = [...(x.log || []), { at: new Date().toISOString(), who: d.session.userName, what }]; audit(d, `${what}: ${otaName(x.ch)} for ${d.tenants.find((y) => y.id === x.tid)?.name}`); });
  };
  const setAcc = (ch, v) => update((d) => { withOta(d).accounts[ch] = v; audit(d, `${otaName(ch)} partner account ${v}`); });
  const rows = tab === "queue" ? queue : tab === "live" ? live : ota.requests;
  return (
    <>
      <PageHead title="Channel manager" sub="Sheetal's partner accounts with Booking.com, Airbnb, Agoda and others. Businesses ask from a listing; the channel team posts it under Sheetal's account, so they never sign or verify with the site themselves." actions={<a className="btn btn-outline" href={siteHref("/admin/settings")}><Icon name="percent" size={16} />Fees and rules</a>} />
      <div className="pf-stats">
        <Stat label="Waiting for the team" value={ota.requests.filter((x) => x.status === "requested").length} note="New requests" tone="action" noteIcon="circle-alert" />
        <Stat label="Being set up" value={ota.requests.filter((x) => x.status === "setting_up").length} note={`${ota.requests.filter((x) => x.status === "needs_info").length} waiting on the business`} />
        <Stat label="Live listings" value={live.length} note={`${new Set(live.map((x) => x.tid)).size} businesses`} />
        <Stat label="Partner accounts" value={`${Object.values(ota.accounts).filter((v) => v === "connected").length} / ${OTAS.length}`} note="Connected" />
      </div>
      <Panel title="Sheetal partner accounts" sub="One contract and one verification per site, signed by Sheetal. Every subscriber is listed under these." pad>
        <div className="pf-ch-grid">
          {OTAS.map((o) => { const st = ota.accounts[o.id]; const n = live.filter((x) => x.ch === o.id).length;
            return (
              <section key={o.id} className={`card pf-ch ${st === "connected" ? "" : "off"}`}>
                <div className="pf-plan-top"><b>{o.name}</b><Badge tone={st === "connected" ? "done" : st === "pending" ? "action" : "neutral"}>{st === "connected" ? "Connected" : st === "pending" ? "Contract pending" : "Off"}</Badge></div>
                <span className="small tnum">{n} live · site {cfg.sites[o.id].commission}% · Sheetal {cfg.sites[o.id].fee}%</span>
                <span className="small muted">Setup takes {o.days}</span>
                <Button variant={st === "connected" ? "ghost" : "outline"} size="sm" icon={st === "connected" ? "key-round" : "link"} onClick={() => { setAcc(o.id, st === "connected" ? "off" : "connected"); toast(st === "connected" ? `${o.name} account turned off` : `${o.name} account connected`); }}>{st === "connected" ? "Turn off" : "Connect Sheetal account"}</Button>
              </section>
            ); })}
        </div>
      </Panel>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "queue", label: "Requests", icon: "inbox", count: queue.length }, { id: "live", label: "Live", icon: "globe", count: live.length }, { id: "all", label: "All", icon: "list-checks" }]} />
      <section className="card pf-panel"><Table rows={rows} minWidth={940} onRowClick={(x) => { setOpen(x.id); setF({ ask: x.ask || "", otaId: x.otaId || "", url: x.url || "" }); }} empty={<p className="pf-pad muted">Nothing here.</p>} columns={[
        { key: "b", label: "Business", render: (x) => <span className="pf-two"><b>{biz(x.tid)?.name || x.tid}</b><small>{x.title}{x.lid ? ` · ${x.lid}` : ""}</small></span> },
        { key: "c", label: "Site", render: (x) => <span className="pf-two"><b>{otaName(x.ch)}</b><small className="tnum">{x.id}</small></span> },
        { key: "rm", label: "Price", num: true, render: (x) => (x.price ? `+${x.price}%` : "Same") },
        { key: "d", label: "Sent", num: true, render: (x) => fdate(x.at) },
        { key: "by", label: "Handled by", render: (x) => x.by || <span className="muted">Unassigned</span> },
        { key: "s", label: "Status", render: (x) => <Badge tone={OTA_STATUS[x.status][1]}>{x.status === "needs_info" ? "Waiting on business" : OTA_STATUS[x.status][0]}</Badge> },
        { key: "go", label: "", align: "right", render: (x) => x.status === "requested" ? <Button size="sm" onClick={(e) => { e.stopPropagation(); act(x.id, { status: "setting_up", by: db.session.userName }, "Started setup"); toast("Setup started"); }}>Start setup</Button> : <Icon name="chevron-right" size={18} /> },
      ]} /></section>
      <Drawer open={!!r} onClose={() => setOpen(null)} title={r ? `${otaName(r.ch)} · ${biz(r.tid)?.name}` : ""} sub={r ? `${r.id} · sent ${fdate(r.at)}` : ""}
        footer={r && <>
          {r.status === "requested" && <><Button variant="ghost" onClick={() => { act(r.id, { status: "declined", ask: f.ask || "Not a fit for this site" }, "Declined"); setOpen(null); }}>Decline</Button><Button onClick={() => act(r.id, { status: "setting_up", by: r.by || db.session.userName }, "Started setup")}>Start setup</Button></>}
          {(r.status === "setting_up" || r.status === "needs_info") && <><Button variant="outline" icon="reply" onClick={() => { if (!f.ask.trim()) { toast("Write what you need from the business"); return; } act(r.id, { status: "needs_info", ask: f.ask }, "Asked the business for info"); toast("Sent to the business"); }}>Ask the business</Button>
            <Button icon="check" onClick={() => { if (!f.otaId.trim()) { toast("Add the property ID from the site"); return; } act(r.id, { status: "live", otaId: f.otaId, url: (f.url || "").trim() || undefined, ask: "" }, "Turned live"); toast("Listing is live"); setOpen(null); }}>Mark live</Button></>}
          {r.status === "stop_requested" && <Button icon="check" onClick={() => { act(r.id, { status: "paused" }, "Stopped selling"); toast("Listing paused"); setOpen(null); }}>Confirm stopped</Button>}
          {r.status === "live" && <Button variant="outline" onClick={() => { act(r.id, { status: "paused" }, "Paused"); setOpen(null); }}>Pause listing</Button>}
          {r.status === "paused" && <Button onClick={() => { act(r.id, { status: "live" }, "Turned live again"); setOpen(null); }}>Turn live again</Button>}
        </>}>
        {r && <div className="pf-stack">
          <dl className="pf-kv">
            <dt>Status</dt><dd><Badge tone={OTA_STATUS[r.status][1]}>{OTA_STATUS[r.status][0]}</Badge></dd>
            <dt>Business</dt><dd>{biz(r.tid)?.name} · {biz(r.tid)?.city}</dd>
            <dt>Owner</dt><dd>{biz(r.tid)?.owner || "—"}</dd>
            <dt>Listing</dt><dd>{r.title}{r.lid ? ` · ${r.lid}` : ""}</dd>
            <dt>Price on site</dt><dd className="tnum">{r.price ? `+${r.price}%` : "Same as Sheetal"}</dd>
            <dt>Sheetal account</dt><dd>{ota.accounts[r.ch] === "connected" ? "Connected" : "Not connected yet"}</dd>
            {r.otaId && <><dt>Property ID</dt><dd className="tnum">{r.otaId}</dd></>}
            {r.status === "live" && <><dt>Links</dt><dd><a className="link" href={otaUrl(r)} target="_blank" rel="noreferrer">View on {otaName(r.ch)}</a> · <a className="link" href={siteHref(`/site/${r.tid}`)} target="_blank" rel="noreferrer">View on website</a></dd></>}
          </dl>
          {r.note && <div className="pf-note"><Icon name="message-circle" size={16} /><span>{r.note}</span></div>}
          <Field label="Handled by"><div className="pf-chips">{TEAM.map((n) => <button key={n} type="button" className={`chip ${r.by === n ? "active" : ""}`} onClick={() => act(r.id, { by: n }, `Assigned to ${n}`)}>{n}</button>)}</div></Field>
          {(r.status === "setting_up" || r.status === "needs_info" || r.status === "requested") && <>
            <Field label="Property ID on the site" hint="Fill in once the listing is created under Sheetal's account."><Input className="input tnum" value={f.otaId} onChange={(e) => setF({ ...f, otaId: e.target.value })} placeholder={r.ch === "booking" ? "BDC 8841207" : "ID"} /></Field>
            <Field label="Public link to the listing" optional hint="The business gets a View button with this link."><Input value={f.url || ""} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://…" /></Field>
            <Field label="Message to the business" optional><textarea className="input" rows={3} value={f.ask} onChange={(e) => setF({ ...f, ask: e.target.value })} placeholder="Photos, check-in time, cancellation policy…" /></Field>
          </>}
          <div className="pf-stack tight"><b className="small">History</b>
            {(r.log || []).length ? r.log.slice().reverse().map((l, i) => <span key={i} className="small"><span className="muted tnum">{fdatetime(l.at)}</span> · {l.who}: {l.what}</span>) : <span className="small muted">Request sent {fdate(r.at)}.</span>}
          </div>
        </div>}
      </Drawer>
    </>
  );
}
