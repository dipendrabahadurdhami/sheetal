// Channel manager on the admin API (Admin → Channels): requests to sell on other sites, partner accounts, site settings.
// Where it fits: AdminApp shows it instead of the sample AdminChannels when isStaffLive().
// How it works: loads GET /admin/ota/requests and /admin/ota/settings. Staff move a request on (set up, ask the business,
// mark live with the property id and link, reject, pause) and the business is told by the server. Super admins connect
// partner accounts and change the site settings. Every change is audited by the server.
// Rules: moving requests needs tenants.manage; accounts and settings need settings.platform (buttons are hidden without it).

import React, { useEffect, useState } from "react";
import { fdate } from "@sheetal/shared/core/format";
import { Badge, Button, Drawer, Field, Input, PageHead, Panel, Stat, Table, Tabs, Textarea, ToggleRow, useToast } from "@sheetal/shared/core/ui";
import { adminApi } from "../api";

const STATUS = { requested: ["Requested", "action"], setting_up: ["Being set up", "progress"], needs_info: ["Waiting on business", "action"], live: ["Live", "done"], paused: ["Paused", "neutral"], rejected: ["Rejected", "problem"] };
const firstError = (e) => Object.values(e.errors || {}).flat()[0] || e.message;

/** How many requests are waiting for the team (for the menu count). */
export function useOtaWaiting(enabled) {
  const [n, setN] = useState(undefined);
  useEffect(() => { if (enabled) adminApi("GET", "/admin/ota/requests?status=requested").then((r) => setN(r.counts?.requested || undefined)).catch(() => {}); }, [enabled]);
  return n;
}

function Accounts({ data, canEdit, reload }) {
  const toast = useToast();
  const set = (id, status) => adminApi("PUT", `/admin/ota/accounts/${id}`, { status }).then((r) => { toast(r.message); reload(); }).catch((e) => toast(firstError(e)));
  return (
    <Panel title="Sheetal partner accounts" sub="One contract and one verification per site, signed by Sheetal. A business can only ask for a site once it is connected here and switched on in the settings below." pad>
      <div className="pf-ch-grid">
        {data.channels.map((c) => { const a = data.accounts[c.id]; const on = a.status === "connected";
          return (
            <section key={c.id} className={`card pf-ch ${on ? "" : "off"}`}>
              <div className="pf-plan-top"><b>{c.name}</b><Badge tone={on ? "done" : "neutral"}>{on ? "Connected" : "Not connected"}</Badge></div>
              <span className="small muted">Setup takes {c.days}{data.settings.sites[c.id].on ? "" : " · switched off"}</span>
              {a.note && <span className="small">{a.note}</span>}
              {canEdit && <Button variant={on ? "ghost" : "outline"} size="sm" onClick={() => set(c.id, on ? "not_connected" : "connected")}>{on ? "Disconnect" : "Connect"}</Button>}
            </section>
          ); })}
      </div>
    </Panel>
  );
}

function SiteSettings({ data, reload }) {
  const toast = useToast();
  const [s, setS] = useState(() => JSON.parse(JSON.stringify(data.settings)));
  const num = (v) => (v === "" ? NaN : Number(v));
  const site = (id, k, v) => setS((x) => ({ ...x, sites: { ...x.sites, [id]: { ...x.sites[id], [k]: v } } }));
  const dirty = JSON.stringify(s) !== JSON.stringify(data.settings);
  const save = () => {
    const body = { payoutDays: num(s.payoutDays), minPhotos: num(s.minPhotos), types: s.types, sites: Object.fromEntries(Object.entries(s.sites).map(([id, v]) => [id, { on: v.on, commission: num(v.commission), fee: num(v.fee), markup: num(v.markup) }])) };
    adminApi("PUT", "/admin/ota/settings", body).then((r) => { toast(r.message); reload(); }).catch((e) => toast(firstError(e)));
  };
  return (
    <Panel title="Site settings" sub="What businesses see when they ask, and what Sheetal charges. Changes apply to new requests." pad>
      <div className="pf-stack">
        <Table rows={data.channels} minWidth={640} columns={[
          { key: "n", label: "Site", render: (c) => <b>{c.name}</b> },
          { key: "on", label: "On", render: (c) => <ToggleRow title="" checked={s.sites[c.id].on} onChange={(v) => site(c.id, "on", v)} /> },
          ...[["commission", "Site keeps (%)"], ["fee", "Sheetal fee (%)"], ["markup", "Usual mark-up (%)"]].map(([k, label]) => ({ key: k, label, num: true, render: (c) => <Input className="input tnum" style={{ width: 80 }} inputMode="decimal" value={s.sites[c.id][k]} onChange={(e) => site(c.id, k, e.target.value.replace(/[^\d.]/g, ""))} /> })),
        ]} />
        <div className="pf-grid-2 tight">
          <Field label="Photos needed per listing"><Input className="input tnum" inputMode="numeric" value={s.minPhotos} onChange={(e) => setS({ ...s, minPhotos: e.target.value.replace(/\D/g, "") })} /></Field>
          <Field label="Payout days after checkout"><Input className="input tnum" inputMode="numeric" value={s.payoutDays} onChange={(e) => setS({ ...s, payoutDays: e.target.value.replace(/\D/g, "") })} /></Field>
        </div>
        <div><b className="small">Business types that can sell on other sites</b>
          {Object.keys(s.types).map((t) => <ToggleRow key={t} title={t[0].toUpperCase() + t.slice(1)} checked={s.types[t]} onChange={(v) => setS({ ...s, types: { ...s.types, [t]: v } })} />)}
        </div>
        <div><Button disabled={!dirty} onClick={save}>Save settings</Button></div>
      </div>
    </Panel>
  );
}

function RequestDrawer({ r, canWork, onClose, reload }) {
  const toast = useToast();
  const [f, setF] = useState({ ask: "", otaPropertyId: "", url: "", note: "" });
  useEffect(() => { if (r) setF({ ask: r.status === "needs_info" ? r.ask : "", otaPropertyId: r.otaPropertyId || "", url: r.url || "", note: "" }); }, [r?.id]);
  if (!r) return <Drawer open={false} onClose={onClose} title="" />;
  const go = (status, extra = {}) => adminApi("PUT", `/admin/ota/requests/${r.id}`, { status, ...extra }).then((x) => { toast(x.message); reload(); onClose(); }).catch((e) => toast(firstError(e)));
  const open = (name) => adminApi("GET", `/admin/ota/requests/${r.id}/files/${name}`).then(({ data }) => { const w = window.open(); if (w) w.location.href = `data:${data.type};base64,${data.data}`; }).catch((e) => toast(firstError(e)));
  const working = r.status === "setting_up" || r.status === "needs_info";
  return (
    <Drawer open onClose={onClose} title={`${r.channelName} · ${r.business}`} sub={`${r.ref} · sent ${fdate(r.createdAt)}`}
      footer={canWork && <>
        {r.status === "requested" && <><Button variant="ghost" onClick={() => go("rejected", { note: f.note })}>Reject</Button><Button onClick={() => go("setting_up")}>Start setup</Button></>}
        {working && <><Button variant="outline" icon="reply" onClick={() => go("needs_info", { ask: f.ask })}>Ask the business</Button><Button icon="check" onClick={() => go("live", { otaPropertyId: f.otaPropertyId, url: f.url, note: f.note })}>Mark live</Button></>}
        {r.status === "live" && <Button variant="outline" onClick={() => go("paused", { note: f.note })}>Pause listing</Button>}
      </>}>
      <div className="pf-stack">
        <dl className="pf-kv">
          <dt>Status</dt><dd><Badge tone={STATUS[r.status][1]}>{STATUS[r.status][0]}</Badge></dd>
          <dt>Listing</dt><dd>{r.listing || "—"}{r.code ? ` · ${r.code}` : ""}</dd>
          <dt>Price on the site</dt><dd>{r.price ? `+${r.price}%` : "Same as on Sheetal"}</dd>
          {r.note && <><dt>Business note</dt><dd>{r.note}</dd></>}
          {r.otaPropertyId && <><dt>Property id</dt><dd>{r.otaPropertyId}</dd></>}
          {r.url && <><dt>Live page</dt><dd><a href={r.url} target="_blank" rel="noreferrer">{r.url}</a></dd></>}
        </dl>
        {canWork && r.status !== "live" && r.status !== "rejected" && (
          <div className="pf-stack">
            {r.status !== "requested" && <Field label="Question for the business" hint="Sent when you press Ask the business."><Textarea rows={2} value={f.ask} onChange={(e) => setF({ ...f, ask: e.target.value })} /></Field>}
            {working && <div className="pf-grid-2 tight"><Field label="Property id on the site"><Input value={f.otaPropertyId} onChange={(e) => setF({ ...f, otaPropertyId: e.target.value })} /></Field><Field label="Link to the live page"><Input placeholder="https://" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /></Field></div>}
            <Field label="Note" hint={r.status === "requested" ? "Required to reject; the business sees it." : "Added to the log."}><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
          </div>
        )}
        <div><b className="small">Log</b>
          <ul className="small" style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {r.log.map((l, i) => <li key={i}>{fdate(l.at)} · <b>{l.who}</b>: {l.what}{l.files?.map((n) => <Button key={n} variant="ghost" size="sm" onClick={() => open(n)}>{n.split(".").pop().toUpperCase()} file</Button>)}</li>)}
          </ul>
        </div>
      </div>
    </Drawer>
  );
}

export function LiveChannels({ canWork, canSettings }) {
  const toast = useToast();
  const [tab, setTab] = useState("queue");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState(null);
  const [counts, setCounts] = useState({});
  const [cfg, setCfg] = useState(null);
  const [open, setOpen] = useState(null);
  const load = () => {
    adminApi("GET", "/admin/ota/requests").then((r) => { setRows(r.data); setCounts(r.counts); }).catch((e) => toast(firstError(e)));
    adminApi("GET", "/admin/ota/settings").then((r) => setCfg(r.data)).catch(() => {});
  };
  useEffect(load, []);
  const name = (id) => cfg?.channels.find((c) => c.id === id)?.name || id;
  const all = (rows || []).map((r) => ({ ...r, channelName: name(r.channel) }));
  const list = all.filter((r) => (tab === "queue" ? ["requested", "setting_up", "needs_info"].includes(r.status) : tab === "live" ? r.status === "live" : true) && (!q || [r.business, r.listing, r.ref, r.code].some((x) => x.toLowerCase().includes(q.toLowerCase()))));
  const connected = cfg ? Object.values(cfg.accounts).filter((a) => a.status === "connected").length : 0;
  return (
    <>
      <PageHead title="Channel manager" sub="Businesses ask from a listing; the channel team posts it under Sheetal's partner account on Booking.com, Airbnb and others, so they never sign or verify with the site themselves." />
      <div className="pf-stats">
        <Stat label="Waiting for the team" value={counts.requested || 0} note="New requests" tone="action" noteIcon="circle-alert" />
        <Stat label="Being set up" value={counts.setting_up || 0} note={`${counts.needs_info || 0} waiting on the business`} />
        <Stat label="Live listings" value={counts.live || 0} note="On other sites" />
        <Stat label="Partner accounts" value={`${connected} / ${cfg?.channels.length || 6}`} note="Connected" />
      </div>
      {cfg && <Accounts data={cfg} canEdit={canSettings} reload={load} />}
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "queue", label: "Requests", icon: "inbox", count: (counts.requested || 0) + (counts.setting_up || 0) + (counts.needs_info || 0) }, { id: "live", label: "Live", icon: "globe", count: counts.live || 0 }, { id: "all", label: "All", icon: "list-checks" }]} />
      <Input placeholder="Search business, listing or OTA-0001" value={q} onChange={(e) => setQ(e.target.value)} />
      <section className="card pf-panel"><Table rows={list} minWidth={900} onRowClick={(x) => setOpen(x.id)} empty={<p className="pf-pad muted">{rows ? "Nothing here." : "Loading…"}</p>} columns={[
        { key: "b", label: "Business", render: (x) => <span className="pf-two"><b>{x.business}</b><small>{x.listing}{x.code ? ` · ${x.code}` : ""}</small></span> },
        { key: "c", label: "Site", render: (x) => <span className="pf-two"><b>{x.channelName}</b><small className="tnum">{x.ref}</small></span> },
        { key: "p", label: "Price", num: true, render: (x) => (x.price ? `+${x.price}%` : "Same") },
        { key: "d", label: "Sent", num: true, render: (x) => fdate(x.createdAt) },
        { key: "s", label: "Status", render: (x) => <Badge tone={STATUS[x.status][1]}>{STATUS[x.status][0]}</Badge> },
      ]} /></section>
      {canSettings && cfg && <SiteSettings key={JSON.stringify(cfg.settings)} data={cfg} reload={load} />}
      <RequestDrawer r={all.find((x) => x.id === open)} canWork={canWork} onClose={() => setOpen(null)} reload={load} />
    </>
  );
}
