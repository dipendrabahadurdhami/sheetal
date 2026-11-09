// Platform leads on the admin API (Admin → Inbox → Leads): enquiries sent to Sheetal itself, with no business behind
// them. Work them like a business Inbox (stage, who has it, follow-up date, notes only staff see, email reply, call
// and WhatsApp links), or pass one to a business: it moves to that business's Inbox and they are told.
// Where it fits: the "Leads" tab of the admin Inbox hub (AdminApp.jsx); the server side is admin/backend/src/modules/leads.ts.

import React, { useEffect, useMemo, useState } from "react";
import { fdate, fdatetime, rs } from "@sheetal/shared/core/format";
import { Badge, Button, Drawer, Empty, Field, Input, Seg, Select, Stat, Table, Textarea, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { adminApi } from "../api";

const STAGES = [["new", "New", "action"], ["contacted", "Contacted", "progress"], ["viewing", "Viewing", "progress"], ["negotiating", "Negotiating", "progress"], ["won", "Won", "done"], ["lost", "Lost", "neutral"]];
const ST = Object.fromEntries(STAGES.map(([id, label, tone]) => [id, { label, tone }]));
const today = () => new Date(Date.now() + 5.75 * 3600_000).toISOString().slice(0, 10);
const wa = (p) => `https://wa.me/${String(p).replace(/\D/g, "").replace(/^(9[78]\d{8})$/, "977$1")}`;
const csvCell = (v) => { let x = v == null ? "" : String(v); if (/^[=+@-]/.test(x) && Number.isNaN(Number(x))) x = `'${x}`; return /[",\r\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };

export function LiveLeads() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [stage, setStage] = useState("open");
  const [mine, setMine] = useState(false);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null);
  const load = () => adminApi("GET", `/admin/leads${mine ? "?mine=1" : ""}`).then((r) => setD(r.data)).catch((e) => { setD(false); toast(e.message); });
  useEffect(() => { load(); }, [mine]);

  const rows = useMemo(() => {
    if (!d) return [];
    const s = q.trim().toLowerCase();
    return d.leads.filter((l) => (stage === "open" ? !["won", "lost"].includes(l.stage) : stage === "follow" ? l.follow && l.follow <= today() && !["won", "lost"].includes(l.stage) : stage === "all" || l.stage === stage)
      && (!s || [l.name, l.phone, l.email, l.message, l.ref].some((x) => (x || "").toLowerCase().includes(s))));
  }, [d, stage, q]);
  if (d === null) return <p className="muted pf-pad">Loading…</p>;
  if (d === false) return <Empty icon="circle-alert" title="Leads couldn't load">Try again in a moment.</Empty>;
  const cur = d.leads.find((l) => l.id === open);
  const due = d.leads.filter((l) => l.follow && l.follow <= today() && !["won", "lost"].includes(l.stage)).length;
  const save = (l, body, quiet) => adminApi("PATCH", `/admin/leads/${l.id}`, body).then((r) => { if (!quiet && r.message) toast(r.message); load(); }).catch((e) => toast(e.message));
  const openLead = (l) => { setOpen(l.id); if (l.unread) save(l, { read: true }, true); };
  const csv = () => {
    const head = ["Ref", "Date", "Kind", "Name", "Phone", "Email", "Stage", "With", "Follow up", "Message"];
    const body = rows.map((l) => [l.ref, l.at.slice(0, 10), l.kindLabel, l.name, l.phone, l.email, ST[l.stage]?.label, l.assigneeName, l.follow, l.message]);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\uFEFF" + [head, ...body].map((r) => r.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    a.download = `sheetal-leads-${today()}.csv`; document.body.appendChild(a); a.click(); a.remove();
  };

  return (
    <>
      <div className="pf-stats">
        <Stat label="New" value={d.counts.new || 0} note="Not contacted yet" tone={d.counts.new ? "action" : undefined} />
        <Stat label="In progress" value={(d.counts.contacted || 0) + (d.counts.viewing || 0) + (d.counts.negotiating || 0)} note="Contacted, viewing or negotiating" />
        <Stat label="Follow up today" value={due} note={due ? "Due or overdue" : "Nothing due"} tone={due ? "action" : undefined} />
        <Stat label="Won" value={d.counts.won || 0} note={`${d.counts.lost || 0} lost`} />
      </div>
      <div className="pf-row-actions" style={{ justifyContent: "flex-start", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        <Seg value={stage} onChange={setStage} options={[{ id: "open", label: "Open" }, { id: "follow", label: `Follow up${due ? ` (${due})` : ""}` }, ...STAGES.map(([id, label]) => ({ id, label })), { id: "all", label: "All" }]} />
        <Seg value={mine ? "mine" : "all"} onChange={(v) => setMine(v === "mine")} options={[{ id: "all", label: "Everyone's" }, { id: "mine", label: "Mine" }]} />
        <Input placeholder="Name, phone, email…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search leads" style={{ maxWidth: 240 }} />
        <span style={{ flex: 1 }} />
        <Button variant="outline" size="sm" icon="download" disabled={!rows.length} onClick={csv}>CSV</Button>
      </div>
      <section className="card pf-panel">
        <Table rows={rows} minWidth={900} onRowClick={openLead}
          empty={<div className="pf-pad"><Empty icon="users" title="No leads here">Enquiries sent to Sheetal itself (with no business behind them) come here.</Empty></div>}
          columns={[
            { key: "n", label: "Lead", render: (l) => <span className="pf-two"><b>{l.unread && <span aria-label="Unread" style={{ display: "inline-block", width: 7, height: 7, borderRadius: 4, background: "var(--accent, currentColor)", marginRight: 6 }} />}{l.name}</b><small className="tnum">{[l.phone, l.email].filter(Boolean).join(" · ") || "No contact"}</small></span> },
            { key: "k", label: "What", render: (l) => <span className="pf-two"><b>{l.kindLabel}</b><small className="pf-ellipsis" style={{ maxWidth: 260 }}>{l.listing || l.message || "—"}</small></span> },
            { key: "a", label: "Came in", num: true, render: (l) => <span className="small tnum">{fdatetime(l.at)}</span> },
            { key: "w", label: "With", render: (l) => <span className="small">{l.assigneeName || <span className="muted">Nobody</span>}</span> },
            { key: "f", label: "Follow up", num: true, render: (l) => l.follow ? <span className={`small tnum ${l.follow <= today() && !["won", "lost"].includes(l.stage) ? "fb-accent" : ""}`}>{fdate(l.follow)}</span> : <span className="small muted">—</span> },
            { key: "s", label: "Stage", render: (l) => <Badge tone={ST[l.stage]?.tone}>{ST[l.stage]?.label || l.stage}</Badge> },
          ]} />
      </section>
      {cur && <LeadDrawer key={cur.id} l={cur} d={d} save={save} reload={load} onClose={() => setOpen(null)} />}
    </>
  );
}

function LeadDrawer({ l, d, save, reload, onClose }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [mode, setMode] = useState(l.email ? "reply" : "note");
  const [busy, setBusy] = useState(false);
  const [pass, setPass] = useState(null);
  const send = () => {
    setBusy(true);
    adminApi("POST", `/admin/leads/${l.id}/${mode}`, { text }).then((r) => { toast(r.message); setText(""); reload(); }).catch((e) => toast(e.message)).finally(() => setBusy(false));
  };
  const details = Object.entries(l.details || {}).filter(([k, v]) => v != null && v !== "" && typeof v !== "object" && !["channel", "account", "contact"].includes(k));
  return (
    <>
      <Drawer open onClose={onClose} title={l.name} sub={`${l.ref} · ${l.kindLabel} · ${fdatetime(l.at)}`}
        footer={<>{l.phone && <a className="btn btn-outline" href={`tel:${l.phone}`}><Icon name="phone" size={16} />Call</a>}
          {l.phone && <a className="btn btn-outline" href={wa(l.phone)} target="_blank" rel="noreferrer"><Icon name="message-circle" size={16} />WhatsApp</a>}
          <Button icon="send" onClick={() => setPass({ q: "", list: null, pick: null, note: "" })}>Pass to a business</Button></>}>
        <div className="pf-stack">
          <div className="pf-grid-2 tight">
            <Field label="Stage"><Select value={l.stage} onChange={(v) => save(l, { stage: v })} options={STAGES.map(([id, label]) => ({ id, label }))} aria-label="Stage" /></Field>
            <Field label="With"><Select value={l.assignee || ""} onChange={(v) => save(l, { assignee: v || null })} options={[{ id: "", label: "Nobody" }, ...d.team.map((u) => ({ id: u.id, label: u.id === d.me ? `${u.name} (me)` : u.name }))]} aria-label="Given to" /></Field>
            <Field label="Follow up on" optional><Input type="date" value={l.follow || ""} onChange={(e) => save(l, { follow: e.target.value || null })} /></Field>
            <Field label="Value (Rs.)" optional><Input className="input tnum" inputMode="numeric" defaultValue={l.value ?? ""} onBlur={(e) => { const v = e.target.value.replace(/\D/g, ""); if ((v || null) !== (l.value != null ? String(l.value) : null)) save(l, { value: v ? Number(v) : null }); }} /></Field>
          </div>
          <dl className="pf-kv">
            {l.phone && <><dt>Phone</dt><dd className="tnum">{l.phone}</dd></>}
            {l.email && <><dt>Email</dt><dd>{l.email}</dd></>}
            {l.listing && <><dt>Property</dt><dd>{l.listing}</dd></>}
            {l.value != null && <><dt>Value</dt><dd className="tnum">{rs(l.value)}</dd></>}
            {details.map(([k, v]) => <React.Fragment key={k}><dt>{k.replace(/_/g, " ")}</dt><dd>{String(v)}</dd></React.Fragment>)}
            {l.onBoard && <><dt>Board</dt><dd>On the requirement board (comes off when passed to a business)</dd></>}
          </dl>
          <div className="pf-stack tight">
            <b className="small">Conversation</b>
            <div className="pf-note"><Icon name="inbox" size={16} /><span style={{ whiteSpace: "pre-wrap" }}>{l.message || "(no message)"}</span></div>
            {l.msgs.map((m, i) => (
              <div key={i} className="pf-note" style={m.dir === "note" ? { borderStyle: "dashed" } : undefined}>
                <Icon name={m.dir === "note" ? "sticky-note" : m.dir === "out" ? "reply" : "inbox"} size={16} />
                <span className="pf-two" style={{ flex: 1 }}><span style={{ whiteSpace: "pre-wrap" }}>{m.body}</span><small>{m.dir === "note" ? "Note, staff only" : m.dir === "out" ? "Email sent" : "Their message"}{m.by ? ` · ${m.by}` : ""} · {fdatetime(m.at)}</small></span>
              </div>
            ))}
          </div>
          <div className="pf-stack tight">
            <Seg value={mode} onChange={setMode} options={[...(l.email ? [{ id: "reply", label: "Email reply" }] : []), { id: "note", label: "Note (staff only)" }]} />
            <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={mode === "reply" ? `Write to ${l.email}. It goes from Sheetal's address.` : "Only Sheetal staff see this. Removed if the lead goes to a business."} />
            <div><Button size="sm" icon={mode === "reply" ? "send" : "check"} disabled={!text.trim() || busy} onClick={send}>{mode === "reply" ? "Send email" : "Save note"}</Button></div>
            {!l.email && <span className="small muted">No email given. Call or WhatsApp them.</span>}
          </div>
        </div>
      </Drawer>
      {pass && <PassDrawer l={l} p={pass} setP={setPass} onDone={() => { setPass(null); onClose(); reload(); }} />}
    </>
  );
}

function PassDrawer({ l, p, setP, onDone }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const tm = setTimeout(() => adminApi("GET", `/admin/tenants?per=30${p.q.trim() ? `&q=${encodeURIComponent(p.q.trim())}` : ""}`).then((r) => setP((x) => ({ ...x, list: (r.data || []).filter((b) => ["active", "trial", "past_due"].includes(b.status)) }))).catch((e) => toast(e.message)), 250);
    return () => clearTimeout(tm);
  }, [p.q]);
  const go = () => {
    setBusy(true);
    adminApi("POST", `/admin/leads/${l.id}/pass`, { tenantId: p.pick.id, note: p.note.trim() || undefined }).then((r) => { toast(r.message); onDone(); }).catch((e) => { toast(e.message); setBusy(false); });
  };
  return (
    <Drawer open onClose={() => !busy && setP(null)} title={`Pass ${l.name} to a business`} sub="It moves to their Inbox as a new lead; they get a notification and an email."
      footer={<><Button variant="outline" onClick={() => setP(null)}>Cancel</Button><Button icon="send" disabled={!p.pick || busy} onClick={go}>{busy ? "Passing…" : p.pick ? `Pass to ${p.pick.name}` : "Pick a business"}</Button></>}>
      <div className="pf-stack">
        <Field label="Find a business"><Input autoFocus placeholder="Name, email or city" value={p.q} onChange={(e) => setP({ ...p, q: e.target.value })} /></Field>
        <div className="pf-tiles">
          {p.list === null ? <span className="muted small">Loading…</span> : p.list.length ? p.list.map((t) => (
            <button key={t.id} type="button" className={p.pick?.id === t.id ? "on" : ""} onClick={() => setP({ ...p, pick: t })}>
              <Icon name="building-2" size={18} /><span>{t.name}<small className="pf-sub-line">{[t.type, t.city].filter(Boolean).join(" · ")}</small></span>
            </button>
          )) : <span className="muted small">No active business matches.</span>}
        </div>
        <Field label="Note for the business" optional hint="Shown with the lead. Staff notes are not passed on."><Textarea rows={2} value={p.note} onChange={(e) => setP({ ...p, note: e.target.value })} /></Field>
      </div>
    </Drawer>
  );
}
