// The Inbox on the business API: every conversation is a lead (website enquiries, chat channels, online forms, the lead finder).
// Where it fits: Business → Inbox when signed in. business/frontend/src/pages/Inbox.jsx renders it for a real business and passes in the lead finder
// (`Finder`, the AI studio, which is a Business page an app may not import). Moved here in P2-W6, on the kit.
// How it works: useApiList loads GET /leads again when the business, the branch picked at the top, or a change happen; the team for "Assign to"
// comes from GET /team (a role that can't read the team just sees "Unassigned"). A stage, assignee or follow-up change sends the version the lead
// was loaded with, so a stale page gets 409 and reloads. Opening an unread lead marks it read. `onChanged` lets the top bar re-count unread leads.
// Rules: nothing is kept in the browser; every change goes to the server and shows its message. Channels are connected in Settings → Channels.

import React, { useEffect, useState } from "react";
import { DataActions } from "@sheetal/shared/components/DataIO";
import { useT } from "@sheetal/shared/core/i18n";
import { useRouter } from "@sheetal/shared/core/router";
import { fdate, fdatetime, inDays, rsShort } from "@sheetal/shared/core/format";
import { Icon } from "@sheetal/shared/core/icons";
import { Badge, Button, Drawer, Empty, Field, PageHead, Seg, Select, useToast } from "@sheetal/ui/primitives";
import { bizApi } from "@sheetal/sdk/client";
import { useApiGet, useApiList } from "@sheetal/sdk/hooks";

export const CHANNELS = {
  whatsapp: { icon: "message-circle", label: "WhatsApp" }, messenger: { icon: "facebook", label: "Messenger" }, instagram: { icon: "instagram", label: "Instagram" },
  website: { icon: "house", label: "Website enquiry" }, web: { icon: "globe", label: "Web chat" }, sms: { icon: "smartphone", label: "SMS" }, email: { icon: "mail", label: "Email" },
};
export const STAGES = ["new", "contacted", "viewing", "negotiating", "won", "lost"];
const QUICK = ["qr_thanks", "qr_visit", "qr_price", "qr_location", "qr_payment"];
const channelOf = (c) => CHANNELS[c.channel] || CHANNELS.web;

/** The fields of a lead change the server takes, with the version the lead was loaded with. */
export const editBody = (lead, patch) => ({ ...patch, version: lead.version });

export function InboxPage({ tenant, Finder, onChanged }) {
  const t = useT();
  const toast = useToast();
  const { navigate } = useRouter();
  // ?extract=1 (old website "lead extractor" links) opens the lead finder straight away.
  const [finder, setFinder] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("extract") === "1");
  const { rows, error, refresh } = useApiList("/leads");
  const team = useApiGet("/team");
  useEffect(() => { if (error) toast(error.message); }, [error, toast]);
  const leads = rows || [];
  const members = team.data?.members || [];
  const [view, setView] = useState("inbox");
  const [ch, setCh] = useState("all");
  const [sel, setSel] = useState(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const list = leads.filter((c) => ch === "all" || (ch === "unread" ? c.unread : c.channel === ch));
  const c = leads.find((x) => x.id === sel) || null;
  useEffect(() => { if (!sel && leads.length) setSel(leads[0].id); }, [leads.length, sel]);

  const done = () => { refresh(); onChanged?.(); };
  /** One call: shows the server's message and reloads; a stale lead (409) reloads too. */
  const run = (p) => p.then((r) => { if (r?.message) toast(r.message); done(); return r; })
    .catch((e) => { toast(e.message); if (e.status === 409) done(); throw e; });
  const upd = (patch) => { if (c) run(bizApi("PATCH", `/leads/${c.id}`, editBody(c, patch))).catch(() => {}); };
  const open = (x) => { setSel(x.id); if (x.unread) bizApi("PATCH", `/leads/${x.id}`, { read: true }).then(done).catch(() => {}); };
  const send = (text) => {
    if (!c || !text.trim() || busy) return;
    setBusy(true);
    run(bizApi("POST", `/leads/${c.id}/reply`, { text })).then(() => setDraft("")).catch(() => {}).finally(() => setBusy(false));
  };
  const who = (x) => members.find((m) => m.id === x.assignee)?.name || x.assigneeName || t("inbox.unassigned");

  return (
    <>
      <PageHead title={t("nav.inbox")} sub={t("inbox.sub")} actions={<><DataActions kind="leads" />{Finder && <Button variant="outline" icon="radar" onClick={() => setFinder(true)}>{t("ai.findLeads")}</Button>}<Seg value={view} onChange={setView} options={[{ id: "inbox", label: t("inbox.inbox"), icon: "inbox" }, { id: "pipeline", label: t("inbox.pipeline"), icon: "kanban" }]} /><Button variant="ghost" icon="plug" onClick={() => navigate("/business/channels")}>{t("inbox.channels")}</Button></>} />
      {Finder && <Drawer open={finder} onClose={() => setFinder(false)} title={t("ai.leadsTitle")} sub={t("ai.leadsSub")}><Finder tenant={tenant} only="leads" /></Drawer>}
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
            {rows === null ? <Empty icon="inbox" title="Loading…" /> : list.length ? list.map((x) => (
              <button key={x.id} className={x.id === sel ? "on" : ""} onClick={() => open(x)}>
                <span className="pf-ch-ico"><Icon name={channelOf(x).icon} size={16} /></span>
                <span className="pf-two" style={{ flex: 1 }}><b>{x.name}</b><small className="pf-ellipsis">{x.last}</small></span>
                <span className="pf-inbox-meta"><small className="tnum">{fdatetime(x.at).split(", ")[1]}</small>{x.unread ? <span className="pf-count solid">{x.unread}</span> : null}</span>
              </button>
            )) : <Empty icon="inbox" title={t("inbox.empty")} />}
          </aside>
          {c ? (
            <section className="pf-thread">
              <header><span className="pf-ch-ico"><Icon name={channelOf(c).icon} size={16} /></span><span className="pf-two"><b>{c.name}</b><small>{channelOf(c).label}{c.phone ? ` · ${c.phone}` : ""}</small></span>
                <Badge tone={c.stage === "won" ? "done" : c.stage === "lost" ? "neutral" : c.stage === "new" ? "action" : "progress"}>{t(`stage.${c.stage}`)}</Badge></header>
              <div className="pf-msgs">
                {(c.msgs || []).map(([dir, text, at], i) => <div key={i} className={`pf-msg ${dir}`}><p>{text}</p><small className="tnum">{String(at).length > 5 ? fdatetime(at) : at}</small></div>)}
              </div>
              <div className="pf-compose">
                <div className="pf-chips">{QUICK.map((k) => <button key={k} className="chip" onClick={() => setDraft(t(`inbox.${k}`))}>{t(`inbox.${k}Label`)}</button>)}</div>
                <div className="pf-compose-row">
                  <textarea className="textarea" rows={1} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(draft); } }} placeholder={t("inbox.reply", { ch: channelOf(c).label })} />
                  <Button icon="send" disabled={busy} onClick={() => send(draft)}>{t("inbox.send")}</Button>
                </div>
              </div>
            </section>
          ) : <Empty icon="messages-square" title={t("inbox.pick")} />}
          {c && (
            <aside className="pf-lead">
              <b className="pf-subhead" style={{ margin: 0 }}>{t("inbox.lead")}</b>
              <Field label={t("inbox.stage")}><Select value={c.stage} onChange={(v) => upd({ stage: v })} options={STAGES.map((s) => ({ id: s, label: t(`stage.${s}`) }))} /></Field>
              <Field label={t("inbox.assign")}><Select value={c.assignee || ""} onChange={(v) => upd({ assignee: v || null })} options={[{ id: "", label: t("inbox.unassigned") }, ...members.map((m) => ({ id: m.id, label: m.name })), ...(c.assignee && !members.some((m) => m.id === c.assignee) ? [{ id: c.assignee, label: c.assigneeName || c.assignee }] : [])]} /></Field>
              <Field label={t("inbox.follow")}><div className="pf-chips">{[["today", inDays(0)], ["tomorrow", inDays(1)], ["week", inDays(7)]].map(([k, d]) => <button key={k} className={`chip ${c.follow === d ? "active" : ""}`} onClick={() => upd({ follow: d })}>{t(`inbox.f_${k}`)}</button>)}</div>
                {c.follow && <span className="pf-hint tnum"><Icon name="bell" size={13} />{t("inbox.remind", { d: fdate(c.follow) })}</span>}</Field>
              <dl className="pf-kv">
                <dt>{t("inbox.value")}</dt><dd className="tnum">{c.value ? rsShort(c.value) : "—"}</dd>
                <dt>{t("inbox.listing")}</dt><dd className="tnum">{c.listing ? <a href="#" onClick={(e) => { e.preventDefault(); navigate("/business/listings"); }}>{c.listing}</a> : "—"}</dd>
                <dt>{t("inbox.tags")}</dt><dd>{c.tags?.length ? c.tags.join(", ") : "—"}</dd>
                {c.kind === "form" && c.details?.formTitle && <><dt>Form</dt><dd><a href="#" onClick={(e) => { e.preventDefault(); navigate("/business/forms/responses"); }}>{c.details.formTitle}</a></dd></>}
                {c.email && <><dt>Email</dt><dd><a href={`mailto:${c.email}`}>{c.email}</a></dd></>}
                {c.phone && <><dt>Phone</dt><dd className="tnum"><a href={`tel:${c.phone}`}>{c.phone}</a></dd></>}
              </dl>
              {Array.isArray(c.details?.matches) && <div className="pf-stack tight">
                <b className="pf-subhead" style={{ margin: 0 }}>Listings that match</b>
                {c.details.matches.length ? c.details.matches.map((m) => <a key={m.id} href="#" className="small" onClick={(e) => { e.preventDefault(); navigate("/business/listings"); }}><span className="tnum">{m.code}</span> · {m.title}{m.price != null ? ` · ${rsShort(m.price)}` : ""}</a>)
                  : <span className="small muted">None of your listings match yet.</span>}
              </div>}
              <div className="pf-stack tight">
                <Button variant="outline" icon="calendar-plus" onClick={() => navigate(tenant.type === "hotel" || tenant.type === "host" ? "/business/bookings" : "/business/agreements")}>{t("inbox.bookVisit")}</Button>
                <Button variant="outline" icon="file-pen-line" onClick={() => navigate(`/business/agreements/new/lead/${c.id}`)}>{t("inbox.makeAgreement")}</Button>
              </div>
            </aside>
          )}
        </div>
      )}
      {view === "pipeline" && (
        <div className="pf-board">
          {STAGES.map((s) => {
            const col = leads.filter((x) => x.stage === s);
            return (
              <section key={s} className="pf-board-col">
                <header><b>{t(`stage.${s}`)}</b><span className="tnum small muted">{col.length} · {rsShort(col.reduce((a, x) => a + (x.value || 0), 0))}</span></header>
                {col.map((x) => (
                  <button key={x.id} className="card pf-board-card" onClick={() => { setSel(x.id); setView("inbox"); }}>
                    <span className="pf-person"><span className="pf-ch-ico"><Icon name={channelOf(x).icon} size={14} /></span><b>{x.name}</b></span>
                    <span className="small pf-ellipsis">{x.last}</span>
                    <span className="pf-board-foot"><span className="tnum small">{x.value ? rsShort(x.value) : "—"}</span><span className="small muted">{who(x)}</span></span>
                  </button>
                ))}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
