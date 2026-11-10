// Business → Help → Message Sheetal: questions to Sheetal's team and their answers, on the business API.
// Where it fits: shown on the Help page (Help.jsx) when signed in; Sheetal answers in Admin → Inbox → Support.

import React, { useEffect, useState } from "react";
import { fdatetime } from "@sheetal/shared/core/format";
import { Badge, Button, Drawer, Empty, Field, Input, Panel, Table, Textarea, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { bizApi } from "../api";

const ST = { open: ["With Sheetal", "progress"], waiting: ["Sheetal answered", "action"], closed: ["Closed", "neutral"] };

export function LiveSupport({ tenant }) {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => bizApi("GET", "/support").then((r) => setRows(r.data)).catch((e) => { setRows([]); toast(e.message); });
  useEffect(() => { load(); }, [tenant.id]);
  const send = () => {
    setBusy(true);
    bizApi("POST", "/support", form).then((r) => { toast(r.message); setForm(null); load(); }).catch((e) => toast(e.message)).finally(() => setBusy(false));
  };
  return (
    <>
      <Panel title="Message Sheetal" sub="Ask anything about your plan, payments, listings or the panel. Answers come here, to your bell and by email."
        actions={<Button size="sm" icon="message-square-plus" onClick={() => setForm({ subject: "", body: "" })}>New message</Button>}>
        <Table rows={rows || []} minWidth={640} onRowClick={(r) => setOpen(r.id)}
          empty={<div className="pf-pad"><Empty icon="life-buoy" title={rows === null ? "Loading…" : "No messages yet"}>{rows === null ? null : "Write to Sheetal's team when you need help."}</Empty></div>}
          columns={[
            { key: "s", label: "About", render: (r) => <span className="pf-two"><b>{r.unread && <span aria-label="New answer" style={{ display: "inline-block", width: 7, height: 7, borderRadius: 4, background: "currentColor", marginRight: 6 }} />}{r.subject}</b><small className="pf-ellipsis" style={{ maxWidth: 320 }}>{r.last}</small></span> },
            { key: "n", label: "", render: (r) => <span className="small muted tnum">{r.no} · {r.by}</span> },
            { key: "t", label: "Last", num: true, render: (r) => <span className="small tnum">{fdatetime(r.lastAt)}</span> },
            { key: "st", label: "Status", render: (r) => <Badge tone={ST[r.status][1]}>{ST[r.status][0]}</Badge> },
          ]} />
      </Panel>
      <Drawer open={!!form} onClose={() => !busy && setForm(null)} title="Message Sheetal" sub="We usually answer within a working day."
        footer={form && <><Button variant="outline" onClick={() => setForm(null)}>Cancel</Button><Button icon="send" disabled={busy || form.subject.trim().length < 3 || form.body.trim().length < 2} onClick={send}>{busy ? "Sending…" : "Send"}</Button></>}>
        {form && <div className="pf-stack">
          <Field label="About"><Input maxLength={120} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="For example: My eSewa payment didn't show" /></Field>
          <Field label="Message"><Textarea rows={6} maxLength={5000} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="What happened, and what you expected. Add the invoice or listing code if there is one." /></Field>
        </div>}
      </Drawer>
      {open && <Thread id={open} onClose={() => setOpen(null)} onChange={load} />}
    </>
  );
}

function Thread({ id, onClose, onChange }) {
  const toast = useToast();
  const [t, setT] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => bizApi("GET", `/support/${id}`).then((r) => { setT(r.data); onChange(); }).catch((e) => toast(e.message));
  useEffect(() => { load(); }, [id]);
  const act = (p) => { setBusy(true); return p.then((r) => { toast(r.message); load(); }).catch((e) => toast(e.message)).finally(() => setBusy(false)); };
  return (
    <Drawer open onClose={onClose} title={t?.subject || "Loading…"} sub={t ? `${t.no} · ${ST[t.status][0]}` : ""}
      footer={t && t.status !== "closed" && <Button variant="outline" disabled={busy} onClick={() => act(bizApi("POST", `/support/${id}/close`))}>Close, it's sorted</Button>}>
      {t && <div className="pf-stack">
        {t.messages.map((m) => (
          <div key={m.id} className="pf-note"><Icon name={m.from === "staff" ? "life-buoy" : "user-round"} size={16} />
            <span className="pf-two" style={{ flex: 1 }}><span style={{ whiteSpace: "pre-wrap" }}>{m.body}</span><small>{m.by || (m.from === "staff" ? "Sheetal" : "You")} · {fdatetime(m.at)}</small></span></div>
        ))}
        <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={t.status === "closed" ? "Writing again opens it." : "Your answer"} />
        <div><Button icon="send" disabled={!text.trim() || busy} onClick={() => act(bizApi("POST", `/support/${id}/reply`, { body: text })).then(() => setText(""))}>Send</Button></div>
      </div>}
    </Drawer>
  );
}
