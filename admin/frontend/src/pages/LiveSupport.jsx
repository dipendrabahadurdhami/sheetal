// Admin → Inbox → Support on the admin API: messages from businesses, replies, staff-only notes, who handles each.
// Where it fits: the "Support" tab of the admin Inbox hub when isStaffLive(); the server is admin/backend/src/modules/support.ts.

import React, { useEffect, useState } from "react";
import { fdatetime } from "@sheetal/shared/core/format";
import { Badge, Button, Drawer, Empty, Seg, Select, Stat, Table, Textarea, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { Link } from "@sheetal/shared/core/router";
import { adminApi } from "../api";

const ST = { open: ["Waiting for us", "action"], waiting: ["Answered", "progress"], closed: ["Closed", "neutral"] };

export function LiveSupport() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [status, setStatus] = useState("open");
  const [mine, setMine] = useState(false);
  const [open, setOpen] = useState(null);
  const load = () => adminApi("GET", `/admin/support?status=${status}${mine ? "&mine=1" : ""}`).then((r) => setD(r.data)).catch((e) => { setD(false); toast(e.message); });
  useEffect(() => { load(); }, [status, mine]);
  if (d === null) return <p className="muted pf-pad">Loading…</p>;
  if (d === false) return <Empty icon="circle-alert" title="Support messages couldn't load">Try again in a moment.</Empty>;
  return (
    <>
      <div className="pf-stats">
        <Stat label="Waiting for us" value={d.counts.open || 0} note="Businesses waiting for an answer" tone={d.counts.open ? "action" : undefined} />
        <Stat label="Answered" value={d.counts.waiting || 0} note="Waiting for the business" />
        <Stat label="Closed" value={d.counts.closed || 0} note="All time" />
      </div>
      <div className="pf-row-actions" style={{ justifyContent: "flex-start", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <Seg value={status} onChange={setStatus} options={[{ id: "open", label: "Waiting for us" }, { id: "waiting", label: "Answered" }, { id: "closed", label: "Closed" }, { id: "all", label: "All" }]} />
        <Seg value={mine ? "mine" : "all"} onChange={(v) => setMine(v === "mine")} options={[{ id: "all", label: "Everyone's" }, { id: "mine", label: "Mine" }]} />
      </div>
      <section className="card pf-panel">
        <Table rows={d.tickets} minWidth={860} onRowClick={(r) => setOpen(r.id)}
          empty={<div className="pf-pad"><Empty icon="inbox" title="Nothing here">Messages from businesses (Business → Help) come here.</Empty></div>}
          columns={[
            { key: "s", label: "Message", render: (r) => <span className="pf-two"><b>{r.unread && <span aria-label="Unread" style={{ display: "inline-block", width: 7, height: 7, borderRadius: 4, background: "currentColor", marginRight: 6 }} />}{r.subject}</b><small className="pf-ellipsis" style={{ maxWidth: 320 }}>{r.last}</small></span> },
            { key: "b", label: "Business", render: (r) => <span className="pf-two"><b>{r.tenant}</b><small>{r.no} · {r.by}</small></span> },
            { key: "w", label: "With", render: (r) => <span className="small">{r.assigneeName || <span className="muted">Nobody</span>}</span> },
            { key: "t", label: "Last", num: true, render: (r) => <span className="small tnum">{fdatetime(r.lastAt)}</span> },
            { key: "st", label: "Status", render: (r) => <Badge tone={ST[r.status][1]}>{ST[r.status][0]}</Badge> },
          ]} />
      </section>
      {open && <TicketDrawer id={open} team={d.team} me={d.me} onClose={() => setOpen(null)} onChange={load} />}
    </>
  );
}

function TicketDrawer({ id, team, me, onClose, onChange }) {
  const toast = useToast();
  const [t, setT] = useState(null);
  const [text, setText] = useState("");
  const [mode, setMode] = useState("reply");
  const [busy, setBusy] = useState(false);
  const load = () => adminApi("GET", `/admin/support/${id}`).then((r) => setT(r.data)).catch((e) => toast(e.message));
  useEffect(() => { load(); }, [id]);
  const act = (p) => { setBusy(true); return p.then((r) => { if (r.message) toast(r.message); load(); onChange(); }).catch((e) => toast(e.message)).finally(() => setBusy(false)); };
  const send = () => act(adminApi("POST", `/admin/support/${id}/${mode}`, { body: text })).then(() => setText(""));
  return (
    <Drawer open onClose={onClose} title={t ? t.subject : "Loading…"} sub={t ? `${t.no} · ${t.tenant?.name || ""} · ${t.person?.userName || ""}` : ""}
      footer={t && <>{t.status !== "closed" ? <Button variant="outline" disabled={busy} onClick={() => act(adminApi("PATCH", `/admin/support/${id}`, { status: "closed" }))}>Close</Button> : <Button variant="outline" disabled={busy} onClick={() => act(adminApi("PATCH", `/admin/support/${id}`, { status: "open" }))}>Open again</Button>}
        <Link to={`/admin/tenants/${t.tenantId}`} className="btn btn-outline"><Icon name="building-2" size={16} />Business</Link></>}>
      {t && <div className="pf-stack">
        <div className="pf-grid-2 tight">
          <span className="small"><b>{t.person?.userName}</b><br /><span className="muted">{t.person?.email}{t.person?.phone ? ` · ${t.person.phone}` : ""}</span></span>
          <Select value={t.assignee || ""} onChange={(v) => act(adminApi("PATCH", `/admin/support/${id}`, { assignee: v || null }))} options={[{ id: "", label: "Nobody" }, ...team.map((u) => ({ id: u.id, label: u.id === me ? `${u.name} (me)` : u.name }))]} aria-label="Handled by" />
        </div>
        {t.messages.map((m) => (
          <div key={m.id} className="pf-note" style={m.from === "note" ? { borderStyle: "dashed" } : undefined}>
            <Icon name={m.from === "note" ? "sticky-note" : m.from === "staff" ? "reply" : "inbox"} size={16} />
            <span className="pf-two" style={{ flex: 1 }}><span style={{ whiteSpace: "pre-wrap" }}>{m.body}</span><small>{m.from === "note" ? "Note, staff only" : m.from === "staff" ? "Sheetal" : "Business"}{m.by ? ` · ${m.by}` : ""} · {fdatetime(m.at)}</small></span>
          </div>
        ))}
        <Seg value={mode} onChange={setMode} options={[{ id: "reply", label: "Reply" }, { id: "note", label: "Note (staff only)" }]} />
        <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={mode === "reply" ? "They get a bell and an email." : "Only Sheetal staff see this."} />
        <div><Button icon={mode === "reply" ? "send" : "check"} disabled={!text.trim() || busy} onClick={send}>{mode === "reply" ? "Send reply" : "Save note"}</Button></div>
      </div>}
    </Drawer>
  );
}
