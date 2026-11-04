// Growth tools on the business API: connected chat channels, calendar sync with other sites, the AI lead finder and
// analytics.

import React, { useEffect, useState } from "react";
import { fdatetime } from "@sheetal/shared/core/format";
import { Badge, Button, Empty, Field, Input, PageHead, Panel, Select, Stat, Table, Textarea, useToast } from "@sheetal/shared/core/ui";
import { bizApi } from "../api";

function useApi(path, deps = []) {
  const [data, setData] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { bizApi("GET", path).then((r) => setData(r.data)).catch(() => setData(null)); }, [path, tick, ...deps]);
  return [data, () => setTick((n) => n + 1)];
}

export function LiveChannels({ tenant }) {
  const toast = useToast();
  const [channels, reload] = useApi("/channels", [tenant.id]);
  const [feeds, reloadFeeds] = useApi("/ota/feeds", [tenant.id]);
  const [c, setC] = useState({ kind: "whatsapp", externalId: "", name: "", accessToken: "" });
  const [f, setF] = useState({ type: "", site: "booking", url: "" });
  const act = (p, after) => p.then((r) => { toast(r.message); after?.(); }).catch((e) => toast(e.message));
  const types = feeds?.exports.map((x) => x.type) ?? [];
  return (
    <>
      <PageHead title="Channels and other sites" sub="Messages from WhatsApp, Messenger and Instagram in your Inbox; rooms kept in step with Booking.com, Airbnb and others." />
      <Panel title="Messaging" sub="Connect your own WhatsApp Business number or Facebook page. Messages land in the Inbox and replies go back there.">
        {!channels ? <p className="muted pf-pad">Loading…</p> : <Table rows={channels} minWidth={520} empty={<Empty icon="message-circle" title="Nothing connected yet" />} columns={[
          { key: "n", label: "Account", render: (r) => <span className="pf-two"><b>{r.name}</b><small>{r.kind} · {r.externalId}</small></span> },
          { key: "s", label: "Status", render: (r) => <Badge tone={r.active ? "done" : "neutral"}>{r.active ? "Connected" : "Off"}</Badge> },
          { key: "x", label: "", align: "right", render: (r) => <Button size="sm" variant="ghost" onClick={() => window.confirm(`Disconnect ${r.name}?`) && act(bizApi("POST", `/channels/${r.id}/disconnect`), reload)}>Disconnect</Button> },
        ]} />}
        <div className="pf-pad pf-stack">
          <div className="pf-grid-2 tight"><Field label="Channel"><Select value={c.kind} onChange={(v) => setC({ ...c, kind: v })} options={[["whatsapp", "WhatsApp"], ["messenger", "Messenger (Facebook page)"], ["instagram", "Instagram"]].map(([id, label]) => ({ id, label }))} /></Field>
            <Field label="Name"><Input value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} placeholder="e.g. Front desk WhatsApp" /></Field></div>
          <Field label={c.kind === "whatsapp" ? "Phone number ID" : "Page ID"} hint="From Meta Business Suite → WhatsApp or page settings."><Input value={c.externalId} onChange={(e) => setC({ ...c, externalId: e.target.value.replace(/\D/g, "") })} /></Field>
          <Field label="Access token" hint="A permanent token from Meta. Stored encrypted and never shown again."><Input type="password" autoComplete="new-password" value={c.accessToken} onChange={(e) => setC({ ...c, accessToken: e.target.value })} /></Field>
          <Button disabled={!c.externalId || !c.name || c.accessToken.length < 20} onClick={() => act(bizApi("POST", "/channels", c), () => { setC({ kind: "whatsapp", externalId: "", name: "", accessToken: "" }); reload(); })}>Connect</Button>
        </div>
      </Panel>
      <Panel title="Calendar sync with other sites" sub="Stays booked on other sites block your rooms here (checked every 2 hours), and your bookings close the dates there.">
        {!feeds ? <p className="muted pf-pad">Loading…</p> : <>
          {!feeds.exports.length ? <p className="muted pf-pad">Add rooms first; then each room type gets a calendar link.</p> : <div className="pf-pad pf-stack">
            <b>Give these links to the other sites ("import calendar"):</b>
            {feeds.exports.map((x) => <Field key={x.type} label={x.type}><Input readOnly value={x.url} onFocus={(e) => e.target.select()} /></Field>)}
          </div>}
          <Table rows={feeds.feeds} minWidth={620} empty={<Empty icon="calendar-days" title="No other sites connected yet" />} columns={[
            { key: "s", label: "Site", render: (r) => <span className="pf-two"><b>{r.site}</b><small>{r.roomType}</small></span> },
            { key: "l", label: "Last sync", render: (r) => r.lastError ? <span className="pf-tone-action small">{r.lastError}</span> : r.lastSync ? fdatetime(r.lastSync) : "—" },
            { key: "x", label: "", align: "right", render: (r) => <Button size="sm" variant="outline" onClick={() => act(bizApi("POST", `/ota/feeds/${r.id}/sync`), reloadFeeds)}>Sync now</Button> },
          ]} />
          {types.length > 0 && <div className="pf-pad pf-stack">
            <div className="pf-grid-2 tight"><Field label="Room type"><Select value={f.type || types[0]} onChange={(v) => setF({ ...f, type: v })} options={types.map((t) => ({ id: t, label: t }))} /></Field>
              <Field label="Site"><Select value={f.site} onChange={(v) => setF({ ...f, site: v })} options={[["booking", "Booking.com"], ["airbnb", "Airbnb"], ["agoda", "Agoda"], ["expedia", "Expedia"], ["other", "Other"]].map(([id, label]) => ({ id, label }))} /></Field></div>
            <Field label="Their calendar link (export / iCal)" hint="On the other site: calendar → export calendar → copy the link."><Input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /></Field>
            <Button disabled={!f.url.startsWith("https://")} onClick={() => act(bizApi("POST", "/ota/feeds", { ...f, type: f.type || types[0] }), () => { setF({ ...f, url: "" }); reloadFeeds(); })}>Connect calendar</Button>
          </div>}
        </>}
      </Panel>
    </>
  );
}

export function LiveLeadFinder({ tenant }) {
  const toast = useToast();
  const [usage, reload] = useApi("/ai/usage", [tenant.id]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState(null);
  const run = (save) => { setBusy(true); bizApi("POST", "/ai/extract-leads", { text, save }).then((r) => { toast(r.message); setFound(r.data.leads); reload(); if (save) setText(""); }).catch((e) => toast(e.message)).finally(() => setBusy(false)); };
  return (
    <Panel title="Find leads with AI" sub={usage ? (usage.enabled ? `${usage.used} of ${usage.limit === -1 ? "unlimited" : usage.limit} credits used this month` : "AI isn't switched on yet.") : ""} pad>
      <div className="pf-stack">
        <Field label="Paste comments, group posts or notes" hint="Only people looking to buy, rent, invest or stay are picked out. Numbers and emails are kept only if they're in the text."><Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} /></Field>
        <div className="pf-row-actions"><Button variant="outline" disabled={busy || text.trim().length < 20} onClick={() => run(false)}>{busy ? "Reading…" : "Find leads"}</Button><Button disabled={busy || !found?.length} onClick={() => run(true)}>Add to Inbox</Button></div>
        {found && (found.length ? <Table rows={found} minWidth={640} columns={[
          { key: "n", label: "Person", render: (l) => <span className="pf-two"><b>{l.name || "—"}</b><small className="tnum">{[l.phone, l.email].filter(Boolean).join(" · ")}</small></span> },
          { key: "w", label: "Looking for", render: (l) => <span className="pf-two"><b>{l.need}</b><small>{[l.location, l.budget].filter(Boolean).join(" · ")}</small></span> },
        ]} /> : <Empty icon="search" title="No leads in this text" />)}
      </div>
    </Panel>
  );
}

export function LiveAnalytics({ tenant }) {
  const [days, setDays] = useState(30);
  const [d] = useApi(`/analytics?days=${days}`, [tenant.id]);
  if (!d) return <p className="muted pf-pad">Loading…</p>;
  const max = Math.max(1, ...d.byDay.map((x) => x.visitors));
  return (
    <>
      <PageHead title="Analytics" sub="People who saw your listings on Sheetal (bots left out)." actions={<Select value={days} onChange={(v) => setDays(Number(v))} options={[7, 30, 90, 365].map((n) => ({ id: n, label: `Last ${n} days` }))} style={{ width: 160 }} />} />
      <div className="pf-stats"><Stat label="Visitors" value={d.visitors.toLocaleString("en-IN")} /><Stat label="Listing views" value={d.views.toLocaleString("en-IN")} /><Stat label="Enquiries" value={d.leads} /></div>
      <Panel title="Visitors per day" pad>{!d.byDay.length ? <p className="muted">No visits yet in this period.</p> : <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 140 }}>{d.byDay.map((x) => <div key={x.day} title={`${x.day}: ${x.visitors}`} style={{ flex: 1, height: `${(x.visitors / max) * 100}%`, minHeight: 2, background: "var(--accent)", borderRadius: 3 }} />)}</div>}</Panel>
      <Panel title="Your most viewed listings"><Table rows={d.topListings} minWidth={520} empty={<Empty icon="chart-column" title="No views yet" />} columns={[
        { key: "t", label: "Listing", render: (l) => <span className="pf-two"><b>{l.title}</b><small className="tnum">{l.code}</small></span> },
        { key: "v", label: "Views", num: true, align: "right", render: (l) => l.views },
        { key: "e", label: "Enquiries", num: true, align: "right", render: (l) => l.leads },
      ]} /></Panel>
      <LiveLeadFinder tenant={tenant} />
    </>
  );
}
