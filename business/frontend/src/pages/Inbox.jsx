// The Inbox: one place for every conversation, each also a lead in the pipeline.
// How it works: signed in, conversations are the business's leads (website enquiries, chat channels, the lead finder)
// for the branches in view; stage, assignee and follow-up changes and replies go to the business API.

import React, { useState } from "react";
import { DataActions } from "@sheetal/shared/components/DataIO";
import { useT } from "@sheetal/shared/core/i18n";
import { useStore } from "@sheetal/shared/core/store";
import { useRouter } from "@sheetal/shared/core/router";
import { AIStudio } from "./AI";
import { fdate, fdatetime, inDays, rsShort } from "@sheetal/shared/core/format";
import { Badge, Button, Empty, Field, PageHead, Seg, Select, ToggleRow, useToast , Drawer } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { useOps } from "./POS";
import { isLive, liveLeads } from "../live";

export const CHANNELS = {
  whatsapp: { icon: "message-circle", label: "WhatsApp" }, messenger: { icon: "facebook", label: "Messenger" }, instagram: { icon: "instagram", label: "Instagram" },
  website: { icon: "house", label: "Website enquiry" }, web: { icon: "globe", label: "Web chat" }, sms: { icon: "smartphone", label: "SMS" }, email: { icon: "mail", label: "Email" },
};
const STAGES = ["new", "contacted", "viewing", "negotiating", "won", "lost"];
const QUICK = ["qr_thanks", "qr_visit", "qr_price", "qr_location", "qr_payment"];

export function Inbox({ tenant }) {
  const t = useT();
  // ?extract=1 (old website "lead extractor" links) opens the lead finder straight away
  const [aiLeads, setAiLeads] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("extract") === "1");
  const toast = useToast();
  const { db } = useStore();
  const [ops, set] = useOps(tenant);
  const { navigate } = useRouter();
  const [view, setView] = useState("inbox");
  const [ch, setCh] = useState("all");
  const [sel, setSel] = useState(ops.conversations[0]?.id);
  const [draft, setDraft] = useState("");
  const team = db.members[tenant.id] || [];
  const live = isLive(tenant.id) ? liveLeads(toast) : null;
  const list = ops.conversations.filter((c) => ch === "all" || (ch === "unread" ? c.unread : c.channel === ch));
  const c = ops.conversations.find((x) => x.id === sel);
  const upd = (patch) => { set((o) => { Object.assign(o.conversations.find((x) => x.id === sel), patch); }); if (live) live.update(sel, patch); };
  const open = (x) => { setSel(x.id); if (x.unread && live) live.read(x.id); set((o) => { o.conversations.find((y) => y.id === x.id).unread = 0; }); };
  const send = (text) => {
    if (!text.trim()) return;
    if (live) { live.reply(sel, text).then(() => setDraft("")).catch(() => {}); return; }
    set((o) => { const x = o.conversations.find((y) => y.id === sel); x.msgs.push(["out", text, new Date().toTimeString().slice(0, 5)]); x.last = text; x.unread = 0; if (x.stage === "new") x.stage = "contacted"; });
    setDraft("");
  };

  return (
    <>
      <PageHead title={t("nav.inbox")} sub={t("inbox.sub")} actions={<><DataActions kind="leads" /><Button variant="outline" icon="radar" onClick={() => setAiLeads(true)}>{t("ai.findLeads")}</Button><Seg value={view} onChange={setView} options={[{ id: "inbox", label: t("inbox.inbox"), icon: "inbox" }, { id: "pipeline", label: t("inbox.pipeline"), icon: "kanban" }, { id: "channels", label: t("inbox.channels"), icon: "plug" }]} /></>} />
      <Drawer open={aiLeads} onClose={() => setAiLeads(false)} title={t("ai.leadsTitle")} sub={t("ai.leadsSub")}><AIStudio tenant={tenant} only="leads" /></Drawer>
      {view === "inbox" && (
        <div className="card pf-inbox">
          <aside className="pf-inbox-list">
            <div className="pf-chips pf-pad" style={{ paddingBottom: 10 }}>
              {["all", "unread", ...Object.keys(CHANNELS)].map((k) => (
                <button key={k} className={`chip ${ch === k ? "active" : ""}`} onClick={() => setCh(k)} title={CHANNELS[k]?.label}>
                  {CHANNELS[k] ? <Icon name={CHANNELS[k].icon} size={14} /> : null}{k === "all" ? t("common.all") : k === "unread" ? t("inbox.unread") : null}
                </button>
              ))}
            </div>
            {list.length ? list.map((x) => (
              <button key={x.id} className={x.id === sel ? "on" : ""} onClick={() => open(x)}>
                <span className="pf-ch-ico"><Icon name={CHANNELS[x.channel].icon} size={16} /></span>
                <span className="pf-two" style={{ flex: 1 }}><b>{x.name}</b><small className="pf-ellipsis">{x.last}</small></span>
                <span className="pf-inbox-meta"><small className="tnum">{fdatetime(x.at).split(", ")[1]}</small>{x.unread ? <span className="pf-count solid">{x.unread}</span> : null}</span>
              </button>
            )) : <Empty icon="inbox" title={t("inbox.empty")} />}
          </aside>
          {c ? (
            <section className="pf-thread">
              <header><span className="pf-ch-ico"><Icon name={CHANNELS[c.channel].icon} size={16} /></span><span className="pf-two"><b>{c.name}</b><small>{CHANNELS[c.channel].label}{c.phone ? ` · ${c.phone}` : ""}</small></span>
                <Badge tone={c.stage === "won" ? "done" : c.stage === "lost" ? "neutral" : c.stage === "new" ? "action" : "progress"}>{t(`stage.${c.stage}`)}</Badge></header>
              <div className="pf-msgs">
                {c.msgs.map(([dir, text, at], i) => <div key={i} className={`pf-msg ${dir}`}><p>{text}</p><small className="tnum">{String(at).length > 5 ? fdatetime(at) : at}</small></div>)}
              </div>
              <div className="pf-compose">
                <div className="pf-chips">{QUICK.map((k) => <button key={k} className="chip" onClick={() => setDraft(t(`inbox.${k}`))}>{t(`inbox.${k}Label`)}</button>)}</div>
                <div className="pf-compose-row">
                  <button className="btn btn-ghost btn-icon" aria-label={t("inbox.attach")}><Icon name="paperclip" size={18} /></button>
                  <textarea className="textarea" rows={1} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(draft); } }} placeholder={t("inbox.reply", { ch: CHANNELS[c.channel].label })} />
                  <Button icon="send" onClick={() => send(draft)}>{t("inbox.send")}</Button>
                </div>
              </div>
            </section>
          ) : <Empty icon="messages-square" title={t("inbox.pick")} />}
          {c && (
            <aside className="pf-lead">
              <b className="pf-subhead" style={{ margin: 0 }}>{t("inbox.lead")}</b>
              <Field label={t("inbox.stage")}><Select value={c.stage} onChange={(v) => upd({ stage: v })} options={STAGES.map((s) => ({ id: s, label: t(`stage.${s}`) }))} /></Field>
              <Field label={t("inbox.assign")}><Select value={c.assignee || ""} onChange={(v) => upd({ assignee: v || null })} options={[{ id: "", label: t("inbox.unassigned") }, ...team.map((m) => ({ id: live ? m.id : m.name, label: m.name }))]} /></Field>
              <Field label={t("inbox.follow")}><div className="pf-chips">{[["today", inDays(0)], ["tomorrow", inDays(1)], ["week", inDays(7)]].map(([k, d]) => <button key={k} className={`chip ${c.follow === d ? "active" : ""}`} onClick={() => upd({ follow: d })}>{t(`inbox.f_${k}`)}</button>)}</div>
                {c.follow && <span className="pf-hint tnum"><Icon name="bell" size={13} />{t("inbox.remind", { d: fdate(c.follow) })}</span>}</Field>
              <dl className="pf-kv">
                <dt>{t("inbox.value")}</dt><dd className="tnum">{c.value ? rsShort(c.value) : "—"}</dd>
                <dt>{t("inbox.listing")}</dt><dd className="tnum">{c.listing ? <a href="#" onClick={(e) => { e.preventDefault(); navigate("/business/listings"); }}>{c.listing}</a> : "—"}</dd>
                <dt>{t("inbox.tags")}</dt><dd>{c.tags?.length ? c.tags.join(", ") : "—"}</dd>
                {c.email && <><dt>Email</dt><dd><a href={`mailto:${c.email}`}>{c.email}</a></dd></>}
                {c.phone && <><dt>Phone</dt><dd className="tnum"><a href={`tel:${c.phone}`}>{c.phone}</a></dd></>}
              </dl>
              <div className="pf-stack tight">
                <Button variant="outline" icon="calendar-plus" onClick={() => { toast(t("inbox.toastVisit")); navigate(tenant.type === "hotel" || tenant.type === "host" ? "/business/bookings" : "/business/agreements"); }}>{t("inbox.bookVisit")}</Button>
                <Button variant="outline" icon="file-pen-line" onClick={() => navigate("/business/agreements")}>{t("inbox.makeAgreement")}</Button>
                <Button variant="outline" icon="link" onClick={() => toast(t("inbox.toastPayLink"))}>{t("inbox.payLink")}</Button>
              </div>
            </aside>
          )}
        </div>
      )}
      {view === "pipeline" && (
        <div className="pf-board">
          {STAGES.map((s) => {
            const col = ops.conversations.filter((x) => x.stage === s);
            return (
              <section key={s} className="pf-board-col">
                <header><b>{t(`stage.${s}`)}</b><span className="tnum small muted">{col.length} · {rsShort(col.reduce((a, x) => a + (x.value || 0), 0))}</span></header>
                {col.map((x) => (
                  <button key={x.id} className="card pf-board-card" onClick={() => { setSel(x.id); setView("inbox"); }}>
                    <span className="pf-person"><span className="pf-ch-ico"><Icon name={CHANNELS[x.channel].icon} size={14} /></span><b>{x.name}</b></span>
                    <span className="small pf-ellipsis">{x.last}</span>
                    <span className="pf-board-foot"><span className="tnum small">{x.value ? rsShort(x.value) : "—"}</span><span className="small muted">{(live ? team.find((m) => m.id === x.assignee)?.name || x.assigneeName : x.assignee) || t("inbox.unassigned")}</span></span>
                  </button>
                ))}
              </section>
            );
          })}
        </div>
      )}
      {view === "channels" && <Channels />}
    </>
  );
}

function Channels() {
  const t = useT();
  const { db, update } = useStore();
  const toast = useToast();
  return (
    <div className="pf-split">
      <section className="card pf-panel grow">
        <div className="pf-panel-head"><div className="pf-panel-title"><h2>{t("inbox.channels")}</h2><span>{t("inbox.channelsSub")}</span></div></div>
        <div className="pf-pad">
          {Object.entries(CHANNELS).filter(([k]) => k !== "website").map(([k, c]) => (
            <div key={k} className="pf-gateway"><div className="pf-toggle-row">
              <span className="pf-person"><span className="pf-ch-ico"><Icon name={c.icon} size={16} /></span><span className="pf-two"><b>{c.label}</b><small>{t(`inbox.ch_${k}`)}</small></span></span>
              <div className="pf-row-actions">{db.channels[k] ? <Badge tone="done">{t("pay.connected")}</Badge> : <Badge tone="neutral">{t("pay.notConnected")}</Badge>}
                <Button variant="outline" size="sm" onClick={() => { update((d) => { d.channels[k] = !d.channels[k]; }); toast(db.channels[k] ? t("inbox.toastOff", { ch: c.label }) : t("inbox.toastOn", { ch: c.label })); }}>{db.channels[k] ? t("inbox.disconnect") : t("inbox.connect")}</Button></div>
            </div></div>
          ))}
        </div>
      </section>
      <section className="card pf-panel side">
        <div className="pf-panel-head"><div className="pf-panel-title"><h2>{t("inbox.capture")}</h2><span>{t("inbox.captureSub")}</span></div></div>
        <div className="pf-pad pf-stack">
          <ToggleRow title={t("inbox.autoLead")} sub={t("inbox.autoLeadSub")} checked onChange={() => {}} />
          <ToggleRow title={t("inbox.autoReply")} sub={t("inbox.autoReplySub")} checked onChange={() => {}} />
          <ToggleRow title={t("inbox.roundRobin")} sub={t("inbox.roundRobinSub")} checked={false} onChange={() => {}} />
          <Field label={t("inbox.widget")} hint={t("inbox.widgetHint")}><code style={{ display: "block", padding: 10, whiteSpace: "normal", wordBreak: "break-all" }}>{'<script src="https://sheetalproperty.com/chat.js" data-business="t1"></script>'}</code></Field>
        </div>
      </section>
    </div>
  );
}
