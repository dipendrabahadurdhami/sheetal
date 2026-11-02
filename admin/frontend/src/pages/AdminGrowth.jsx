import React, { useState } from "react";
import { useT } from "@sheetal/shared/core/i18n";
import { useStore } from "@sheetal/shared/core/store";
import { fdate, fdatetime, rs } from "@sheetal/shared/core/format";
import { EmbedCtx, Badge, Button, Drawer, Field, Input, PageHead as UIPageHead, Panel, Seg, Stat, Table, Tabs, Textarea, ToggleRow, useToast } from "@sheetal/shared/core/ui";

const PageHead = UIPageHead;

// One page, several related tools as tabs.
export function Hub({ title, sub, tabs, start }) {
  const [tab, setTab] = useState(start && tabs.some((x) => x.id === start) ? start : tabs[0].id);
  const cur = tabs.find((x) => x.id === tab) || tabs[0];
  return (
    <>
      <UIPageHead title={title} sub={sub} />
      <Tabs value={tab} onChange={setTab} tabs={tabs.map(({ id, label, icon, count }) => ({ id, label, icon, count }))} />
      <EmbedCtx.Provider value={true}><React.Fragment key={cur.id}>{cur.el}</React.Fragment></EmbedCtx.Provider>
    </>
  );
}
import { Icon } from "@sheetal/shared/core/icons";
import { DataActions } from "@sheetal/shared/components/DataIO";
import { Line } from "@sheetal/shared/core/charts";

// Growth tools: leads, voice agent, social, AI blog, demands, careers, requests, deals and earnings.
const tone = (s) => ({ new: "action", open: "action", pending: "action", scheduled: "progress", running: "progress", live: "done", done: "done", paid: "done", matched: "done", hired: "done", published: "done", closed: "neutral", rejected: "neutral", failed: "problem" }[s] || "neutral");
const B = ({ s }) => { const t = useT(); return <Badge tone={tone(s)}>{t(`gs.${s}`)}</Badge>; };
const useList = (key, seed) => {
  const { db, update } = useStore();
  const list = db.growth?.[key] || seed;
  const set = (fn) => update((d) => { d.growth = d.growth || {}; d.growth[key] = d.growth[key] || structuredClone(seed); fn(d.growth[key]); });
  return [list, set];
};

/* Leads: extractor + master leads */
const LEADS = [
  { id: "ML-2041", name: "Rajesh Shrestha", phone: "9841223344", source: "extractor", from: "Facebook group: Kathmandu Ghar Jagga", want: "Land in Budhanilkantha, 5–8 aana", budget: 25000000, owner: "Himalayan Homes Realty", status: "new", at: "2027-03-02T08:10" },
  { id: "ML-2040", name: "Sarita Gurung", phone: "9856012345", source: "website", from: "Contact owner · L-1042", want: "4 BHK house", budget: 32000000, owner: "Himalayan Homes Realty", status: "open", at: "2027-03-01T17:40" },
  { id: "ML-2039", name: "Thomas Keller", phone: "+49 151 2233", source: "voice", from: "Voice agent call", want: "Lake view stay, 5 nights", budget: 60000, owner: "Lakeside Retreat Hotel", status: "matched", at: "2027-03-01T11:02" },
  { id: "ML-2038", name: "Bimala Thapa", phone: "9803344556", source: "demand", from: "Demand board", want: "2 BHK flat for rent, Lalitpur", budget: 35000, owner: "—", status: "open", at: "2027-02-28T15:20" },
  { id: "ML-2037", name: "Anil KC", phone: "9812233441", source: "extractor", from: "Hamrobazar listing", want: "Selling 1 ropani in Tokha", budget: 0, owner: "—", status: "new", at: "2027-02-28T09:00" },
];
const JOBS = [
  { id: "EX-14", src: "Facebook groups", q: "ghar jagga bikri kathmandu", every: "6h", found: 412, last: "2027-03-02T06:00", status: "running" },
  { id: "EX-13", src: "Hamrobazar", q: "land sale lalitpur", every: "12h", found: 188, last: "2027-03-02T00:00", status: "running" },
  { id: "EX-12", src: "Google Maps", q: "hotels in pokhara lakeside", every: "1d", found: 96, last: "2027-03-01T05:00", status: "done" },
];
export function AdminLeads() {
  const t = useT();
  const toast = useToast();
  const { db } = useStore();
  const [leads, setLeads] = useList("leads", LEADS);
  const [jobs, setJobs] = useList("jobs", JOBS);
  const [tab, setTab] = useState("master");
  const [assign, setAssign] = useState(null);
  return (
    <>
      <PageHead title={t("gl.title")} sub={t("gl.sub")} actions={<Button icon="radar" onClick={() => { setJobs((j) => j.unshift({ id: `EX-${15 + j.length}`, src: "Facebook groups", q: "flat rent baneshwor", every: "6h", found: 0, last: null, status: "scheduled" })); setTab("extract"); toast(t("gl.toastJob")); }}>{t("gl.newJob")}</Button>} />
      <div className="pf-stats">
        <Stat label={t("gl.total")} value={leads.length * 412} note={t("gl.week", { n: 1284 })} />
        <Stat label={t("gl.new")} value={leads.filter((l) => l.status === "new").length} note={t("gl.toAssign")} tone="action" noteIcon="circle-alert" />
        <Stat label={t("gl.matched")} value="38%" note={t("gl.matchedNote")} />
        <Stat label={t("gl.sold")} value={rs(184000)} note={t("gl.soldNote")} to="/admin/billing" />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "master", label: t("gl.master"), icon: "users", count: leads.length }, { id: "extract", label: t("gl.extractor"), icon: "radar", count: jobs.length }, { id: "rules", label: t("gl.rules"), icon: "sliders-horizontal" }]} />
      {tab === "master" && <section className="card pf-panel"><Table rows={leads} minWidth={980} columns={[
        { key: "n", label: t("gl.lead"), render: (l) => <span className="pf-two"><b>{l.name}</b><small className="tnum">{l.phone}</small></span> },
        { key: "w", label: t("gl.wants"), render: (l) => <span className="pf-two"><b>{l.want}</b><small>{l.from}</small></span> },
        { key: "s", label: t("gl.source"), render: (l) => <Badge tone="neutral" icon={{ extractor: "radar", website: "globe", voice: "phone", demand: "clipboard-list" }[l.source]}>{t(`gl.src_${l.source}`)}</Badge> },
        { key: "b", label: t("gl.budget"), num: true, align: "right", render: (l) => (l.budget ? rs(l.budget) : "—") },
        { key: "o", label: t("gl.sentTo"), render: (l) => <span className="small">{l.owner}</span> },
        { key: "st", label: t("common.status"), render: (l) => <B s={l.status} /> },
        { key: "x", label: "", align: "right", render: (l) => <Button variant="outline" size="sm" icon="send" onClick={() => setAssign(l)}>{t("gl.assign")}</Button> },
      ]} /></section>}
      {tab === "extract" && <section className="card pf-panel"><Table rows={jobs} minWidth={760} columns={[
        { key: "s", label: t("gl.where"), render: (j) => <span className="pf-two"><b>{j.src}</b><small>“{j.q}”</small></span> },
        { key: "e", label: t("gl.every"), num: true, render: (j) => j.every },
        { key: "f", label: t("gl.found"), num: true, align: "right", render: (j) => j.found },
        { key: "l", label: t("gl.lastRun"), num: true, render: (j) => (j.last ? fdatetime(j.last) : "—") },
        { key: "st", label: t("common.status"), render: (j) => <B s={j.status} /> },
        { key: "x", label: "", align: "right", render: (j) => <Button variant="ghost" size="sm" icon="play" onClick={() => { setJobs((a) => { const x = a.find((y) => y.id === j.id); x.status = "running"; x.last = new Date().toISOString(); x.found += 17; }); toast(t("gl.toastRun")); }}>{t("gl.runNow")}</Button> },
      ]} /></section>}
      {tab === "rules" && <Panel title={t("gl.rules")} pad><div className="pf-stack">
        <ToggleRow title={t("gl.autoMatch")} sub={t("gl.autoMatchSub")} checked onChange={() => {}} />
        <ToggleRow title={t("gl.dedupe")} sub={t("gl.dedupeSub")} checked onChange={() => {}} />
        <ToggleRow title={t("gl.sell")} sub={t("gl.sellSub", { v: rs(150) })} checked onChange={() => {}} />
        <ToggleRow title={t("gl.consent")} sub={t("gl.consentSub")} checked onChange={() => {}} />
      </div></Panel>}
      <Drawer open={!!assign} onClose={() => setAssign(null)} title={t("gl.assign")} sub={assign?.want}
        footer={<><Button variant="outline" onClick={() => setAssign(null)}>{t("common.cancel")}</Button><Button icon="send" onClick={() => { setLeads((a) => { const x = a.find((y) => y.id === assign.id); x.status = "matched"; x.owner = assign.to || x.owner; }); setAssign(null); toast(t("gl.toastSent")); }}>{t("gl.send")}</Button></>}>
        {assign && <div className="pf-stack">
          <div className="pf-note"><Icon name="sparkles" size={16} />{t("gl.suggest")}</div>
          <div className="pf-tiles">{db.tenants.filter((x) => x.status === "active").slice(0, 6).map((x) => <button key={x.id} className={assign.to === x.name ? "on" : ""} onClick={() => setAssign({ ...assign, to: x.name })}><Icon name="building-2" size={18} /><span>{x.name}<small className="pf-sub-line">{x.city}</small></span></button>)}</div>
        </div>}
      </Drawer>
    </>
  );
}

/* Voice agent */
const CALLS = [
  { id: "C-881", who: "Thomas Keller", phone: "+49 151 2233", dir: "in", lang: "en", mins: 4.2, topic: "Lake view room 12–17 Mar", outcome: "lead", at: "2027-03-01T11:02" },
  { id: "C-880", who: "Gopal Sharma", phone: "9841556677", dir: "in", lang: "ne", mins: 2.8, topic: "Shetal Heights 2 BHK price", outcome: "visit", at: "2027-03-01T09:40" },
  { id: "C-879", who: "Rita Maharjan", phone: "9815550011", dir: "out", lang: "ne", mins: 1.5, topic: "Instalment reminder", outcome: "paid", at: "2027-02-28T16:00" },
];
export function AdminVoice() {
  const t = useT();
  const [calls] = useList("calls", CALLS);
  const [cfg, setCfg] = useState({ on: true, langs: ["ne", "en"], voice: "female", hours: "24", handoff: true, greeting: "Namaste! Sheetal ma swagat chha. Ma tapailai kasari sahayog garna sakchhu?" });
  return (
    <>
      <PageHead title={t("gv.title")} sub={t("gv.sub")} />
      <div className="pf-stats">
        <Stat label={t("gv.calls")} value="1,204" note={t("gv.month")} />
        <Stat label={t("gv.answered")} value="96%" note={t("gv.answeredNote")} />
        <Stat label={t("gv.leads")} value="312" note={t("gv.leadsNote")} to="/admin/leads" />
        <Stat label={t("gv.minutes")} value="3,410" note={rs(3410 * 4)} />
      </div>
      <div className="pf-split">
        <Panel title={t("gv.recent")} className="grow"><Table rows={calls} minWidth={720} columns={[
          { key: "w", label: t("gv.caller"), render: (c) => <span className="pf-two"><b>{c.who}</b><small className="tnum">{c.phone}</small></span> },
          { key: "d", label: "", render: (c) => <Icon name={c.dir === "in" ? "phone-incoming" : "phone-outgoing"} size={16} /> },
          { key: "tp", label: t("gv.topic"), render: (c) => c.topic },
          { key: "m", label: t("gv.length"), num: true, align: "right", render: (c) => `${c.mins} min` },
          { key: "o", label: t("gv.result"), render: (c) => <Badge tone="done">{t(`gv.o_${c.outcome}`)}</Badge> },
          { key: "x", label: "", align: "right", render: () => <Button variant="ghost" size="sm" icon="play">{t("gv.listen")}</Button> },
        ]} /></Panel>
        <Panel title={t("gv.setup")} className="side" pad><div className="pf-stack">
          <ToggleRow title={t("gv.on")} sub={t("gv.onSub")} checked={cfg.on} onChange={(v) => setCfg({ ...cfg, on: v })} />
          <Field label={t("gv.voice")}><Seg value={cfg.voice} onChange={(v) => setCfg({ ...cfg, voice: v })} options={[{ id: "female", label: t("gv.female") }, { id: "male", label: t("gv.male") }]} /></Field>
          <Field label={t("gv.hours")}><Seg value={cfg.hours} onChange={(v) => setCfg({ ...cfg, hours: v })} options={[{ id: "24", label: t("gv.always") }, { id: "after", label: t("gv.after") }]} /></Field>
          <Field label={t("gv.greeting")}><Textarea rows={3} value={cfg.greeting} onChange={(e) => setCfg({ ...cfg, greeting: e.target.value })} style={{ minHeight: 80 }} /></Field>
          <ToggleRow title={t("gv.handoff")} sub={t("gv.handoffSub")} checked={cfg.handoff} onChange={(v) => setCfg({ ...cfg, handoff: v })} />
        </div></Panel>
      </div>
    </>
  );
}

/* Social + WhatsApp scheduler, AI blog */
const POSTS = [
  { id: "SP-301", text: "Sunrise from Lakeside Retreat. Book 3 nights, get the 4th free this March.", ch: ["fb", "ig"], at: "2027-03-03T09:00", status: "scheduled", reach: 0 },
  { id: "SP-300", text: "Shetal Heights: 2 BHK from Rs. 85 Lakh, bank loan ready.", ch: ["fb", "ig", "tt"], at: "2027-03-02T18:00", status: "scheduled", reach: 0 },
  { id: "SP-299", text: "Holi offer for WhatsApp subscribers: 20% off stays in Pokhara.", ch: ["wa"], at: "2027-03-01T10:00", status: "published", reach: 8420 },
  { id: "SP-298", text: "How to read a lalpurja before you buy land.", ch: ["fb", "li"], at: "2027-02-27T12:00", status: "published", reach: 12880 },
];
const CH = { fb: ["Facebook", "facebook"], ig: ["Instagram", "instagram"], tt: ["TikTok", "music-2"], wa: ["WhatsApp", "message-circle"], li: ["LinkedIn", "linkedin"], yt: ["YouTube", "youtube"] };
export function AdminSocial() {
  const t = useT();
  const toast = useToast();
  const [posts, setPosts] = useList("posts", POSTS);
  const [tab, setTab] = useState("queue");
  const [f, setF] = useState(null);
  const [blog, setBlog] = useState({ topic: "Best areas to buy land in Lalitpur in 2027", tone: "helpful", length: "800", out: "" });
  return (
    <>
      <PageHead title={t("gso.title")} sub={t("gso.sub")} actions={<Button icon="plus" onClick={() => setF({ text: "", ch: ["fb", "ig"], when: "2027-03-04T09:00" })}>{t("gso.new")}</Button>} />
      <div className="pf-stats">
        <Stat label={t("gso.scheduled")} value={posts.filter((p) => p.status === "scheduled").length} note={t("gso.next", { at: fdatetime(posts.find((p) => p.status === "scheduled")?.at) })} />
        <Stat label={t("gso.reach")} value={posts.reduce((s, p) => s + p.reach, 0).toLocaleString("en-IN")} note={t("gso.last30")} />
        <Stat label={t("gso.waSubs")} value="6,214" note={t("gso.waNote")} />
        <Stat label={t("gso.blogs")} value="42" note={t("gso.blogsNote")} to="/admin/content" />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "queue", label: t("gso.queue"), icon: "calendar-clock" }, { id: "blog", label: t("gso.aiBlog"), icon: "sparkles" }, { id: "accounts", label: t("gso.accounts"), icon: "link" }]} />
      {tab === "queue" && <section className="card pf-panel"><Table rows={posts} minWidth={820} columns={[
        { key: "x", label: t("gso.post"), render: (p) => <span className="pf-two" style={{ maxWidth: 420 }}><b style={{ whiteSpace: "normal" }}>{p.text}</b><small className="tnum">{p.id}</small></span> },
        { key: "c", label: t("gso.where"), render: (p) => <span className="pf-chips">{p.ch.map((c) => <span key={c} className="pf-type-dot" title={CH[c][0]}><Icon name={CH[c][1]} size={14} /></span>)}</span> },
        { key: "a", label: t("gso.when"), num: true, render: (p) => fdatetime(p.at) },
        { key: "r", label: t("gso.reach"), num: true, align: "right", render: (p) => (p.reach ? p.reach.toLocaleString("en-IN") : "—") },
        { key: "s", label: t("common.status"), render: (p) => <B s={p.status} /> },
      ]} /></section>}
      {tab === "blog" && <div className="pf-split">
        <Panel title={t("gso.aiBlog")} sub={t("gso.aiBlogSub")} className="side" pad><div className="pf-stack">
          <Field label={t("gso.topic")}><Input value={blog.topic} onChange={(e) => setBlog({ ...blog, topic: e.target.value })} /></Field>
          <Field label={t("gso.tone")}><Seg value={blog.tone} onChange={(v) => setBlog({ ...blog, tone: v })} options={["helpful", "news", "story"].map((x) => ({ id: x, label: t(`gso.t_${x}`) }))} /></Field>
          <Field label={t("gso.length")}><Seg value={blog.length} onChange={(v) => setBlog({ ...blog, length: v })} options={["500", "800", "1500"].map((x) => ({ id: x, label: `${x} words` }))} /></Field>
          <Button icon="sparkles" onClick={() => setBlog({ ...blog, out: `${blog.topic}\n\nLalitpur keeps pulling buyers who want space without leaving the valley. Here are five areas to look at, what land costs per aana today, and what to check before you pay bainā.\n\n1. Bhaisepati — quiet, planned roads, Rs. 35–45 Lakh per aana.\n2. Imadol — fast growing, close to Koteshwor, Rs. 28–38 Lakh.\n3. Godawari — green and cooler, larger plots, Rs. 12–20 Lakh.\n…` })}>{t("gso.write")}</Button>
          <ToggleRow title={t("gso.autoPost")} sub={t("gso.autoPostSub")} checked onChange={() => {}} />
        </div></Panel>
        <Panel title={t("gso.draft")} className="grow" pad>{blog.out ? <div className="pf-stack"><Textarea rows={14} value={blog.out} onChange={(e) => setBlog({ ...blog, out: e.target.value })} style={{ minHeight: 300 }} />
          <div className="pf-row-actions"><Button variant="outline" icon="calendar-clock" onClick={() => toast(t("gso.toastScheduled"))}>{t("gso.schedule")}</Button><Button icon="send" onClick={() => toast(t("gso.toastPublished"))}>{t("content.publish")}</Button></div></div>
          : <p className="small muted">{t("gso.draftEmpty")}</p>}</Panel>
      </div>}
      {tab === "accounts" && <div className="pf-ch-grid">{Object.entries(CH).map(([k, [n, ic]]) => <section key={k} className="card pf-ch"><div className="pf-plan-top"><span className="pf-person"><Icon name={ic} size={18} /><b>{n}</b></span>{k !== "yt" ? <Badge tone="done">{t("pay.connected")}</Badge> : <Badge tone="neutral">{t("pay.notConnected")}</Badge>}</div><span className="small muted">{k === "wa" ? "+977 980-1136817" : "@shetal.realestate"}</span><Button variant={k !== "yt" ? "ghost" : "outline"} size="sm">{k !== "yt" ? t("inbox.disconnect") : t("inbox.connect")}</Button></section>)}</div>}
      <Drawer open={!!f} onClose={() => setF(null)} title={t("gso.new")}
        footer={<><Button variant="outline" onClick={() => setF(null)}>{t("common.cancel")}</Button><Button icon="calendar-clock" disabled={!f?.text} onClick={() => { setPosts((a) => a.unshift({ id: `SP-${302 + a.length}`, text: f.text, ch: f.ch, at: f.when, status: "scheduled", reach: 0 })); setF(null); toast(t("gso.toastScheduled")); }}>{t("gso.schedule")}</Button></>}>
        {f && <div className="pf-stack">
          <Field label={t("gso.post")}><Textarea rows={4} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} style={{ minHeight: 110 }} /></Field>
          <Button variant="outline" size="sm" icon="sparkles" onClick={() => setF({ ...f, text: "Wake up to the Annapurnas. 20% off lake view rooms this week, free airport pickup. Book on sheetalproperty.com" })}>{t("gso.aiCaption")}</Button>
          <Field label={t("gso.where")}><div className="pf-chips">{Object.entries(CH).map(([k, [n, ic]]) => { const on = f.ch.includes(k); return <button key={k} className={`chip ${on ? "active" : ""}`} onClick={() => setF({ ...f, ch: on ? f.ch.filter((x) => x !== k) : [...f.ch, k] })}><Icon name={on ? "check" : ic} size={14} />{n}</button>; })}</div></Field>
          <Field label={t("gso.when")}><div className="pf-chips">{[["2027-03-02T18:00", "Today 18:00"], ["2027-03-03T09:00", "Tomorrow 09:00"], ["2027-03-04T09:00", "Thu 09:00"], ["2027-03-06T12:00", "Sat 12:00"]].map(([v, l]) => <button key={v} className={`chip ${f.when === v ? "active" : ""}`} onClick={() => setF({ ...f, when: v })}>{l}</button>)}</div></Field>
          <label className="drop pf-drop"><input type="file" hidden accept="image/*,video/*" /><Icon name="image" size={22} /><b>{t("gso.media")}</b></label>
        </div>}
      </Drawer>
    </>
  );
}

/* Demand board + requirement fees */
const DEMANDS = [
  { id: "DM-512", who: "Bimala Thapa", want: "2 BHK flat for rent", where: "Lalitpur, Jhamsikhel or Sanepa", budget: 35000, kind: "rent", fee: 500, paid: true, matches: 6, status: "open", at: "2027-02-28" },
  { id: "DM-511", who: "Prakash Joshi (NRN, Australia)", want: "Land 8–12 aana for a house", where: "Budhanilkantha or Tokha", budget: 30000000, kind: "buy", fee: 2000, paid: true, matches: 3, status: "matched", at: "2027-02-26" },
  { id: "DM-510", who: "Everest Trekking Pvt. Ltd.", want: "Office space 2,000 sq ft", where: "Thamel or Lazimpat", budget: 180000, kind: "rent", fee: 1000, paid: false, matches: 0, status: "pending", at: "2027-02-25" },
];
const FEES = [{ id: "rent", fee: 500 }, { id: "buy", fee: 2000 }, { id: "commercial", fee: 1000 }, { id: "stay", fee: 0 }];
export function AdminDemand() {
  const t = useT();
  const toast = useToast();
  const [list, setList] = useList("demands", DEMANDS);
  const [fees, setFees] = useList("fees", FEES);
  const [tab, setTab] = useState("board");
  return (
    <>
      <PageHead title={t("gd.title")} sub={t("gd.sub")} />
      <div className="pf-stats">
        <Stat label={t("gd.open")} value={list.filter((d) => d.status === "open").length} note={t("gd.openNote")} />
        <Stat label={t("gd.matched")} value={list.filter((d) => d.status === "matched").length} note={t("gd.matchedNote")} />
        <Stat label={t("gd.fees")} value={rs(list.filter((d) => d.paid).reduce((s, d) => s + d.fee, 0))} note={t("gd.feesNote")} to="/admin/billing" />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "board", label: t("gd.board"), icon: "clipboard-list" }, { id: "fees", label: t("gd.feeRules"), icon: "wallet" }]} />
      {tab === "board" && <section className="card pf-panel"><Table rows={list} minWidth={900} columns={[
        { key: "w", label: t("gd.need"), render: (d) => <span className="pf-two"><b>{d.want}</b><small>{d.who} · {d.where}</small></span> },
        { key: "b", label: t("gl.budget"), num: true, align: "right", render: (d) => rs(d.budget) },
        { key: "f", label: t("gd.fee"), render: (d) => (d.fee ? <Badge tone={d.paid ? "done" : "action"}>{rs(d.fee)} · {d.paid ? t("gs.paid") : t("gs.pending")}</Badge> : <Badge tone="neutral">{t("gd.free")}</Badge>) },
        { key: "m", label: t("gd.matches"), num: true, align: "right", render: (d) => d.matches },
        { key: "s", label: t("common.status"), render: (d) => <B s={d.status} /> },
        { key: "x", label: "", align: "right", render: (d) => d.paid && d.status === "open" && <Button size="sm" icon="sparkles" onClick={() => { setList((a) => { const x = a.find((y) => y.id === d.id); x.status = "matched"; x.matches += 4; }); toast(t("gd.toastMatched")); }}>{t("gd.match")}</Button> },
      ]} /></section>}
      {tab === "fees" && <Panel title={t("gd.feeRules")} sub={t("gd.feeRulesSub")} pad><div className="pf-stack">{fees.map((f) => (
        <div key={f.id} className="pf-limit-row"><span>{t(`gd.k_${f.id}`)}</span>
          <Input className="input tnum" style={{ width: 120 }} value={f.fee} onChange={(e) => setFees((a) => { a.find((x) => x.id === f.id).fee = Number(e.target.value.replace(/\D/g, "")); })} aria-label={t(`gd.k_${f.id}`)} />
          <span className="small muted">{f.fee ? t("gd.refund") : t("gd.free")}</span></div>
      ))}</div></Panel>}
    </>
  );
}

/* Careers */
const JOBSP = [
  { id: "JB-21", title: "Sales executive, Lalitpur", type: "Full time", apps: 34, status: "published", closes: "2027-03-20" },
  { id: "JB-20", title: "Customer support (Nepali, English)", type: "Full time", apps: 58, status: "published", closes: "2027-03-15" },
  { id: "JB-19", title: "Field photographer", type: "Contract", apps: 12, status: "closed", closes: "2027-02-20" },
];
const APPS = [
  { id: "A1", name: "Sushma Rai", job: "JB-20", stage: "interview", at: "2027-03-01" }, { id: "A2", name: "Kiran Bista", job: "JB-21", stage: "new", at: "2027-03-02" },
  { id: "A3", name: "Prabin Lama", job: "JB-21", stage: "shortlist", at: "2027-02-27" }, { id: "A4", name: "Nisha Shah", job: "JB-20", stage: "offer", at: "2027-02-24" },
];
export function AdminCareers() {
  const t = useT();
  const [jobs, setJobs] = useList("careers", JOBSP);
  const [apps, setApps] = useList("apps", APPS);
  const stages = ["new", "shortlist", "interview", "offer"];
  const jobRows = jobs.map((j) => ({ ...j, status: j.status === "closed" ? "Closed" : "Open" }));
  const importJobs = (rows) => setJobs((x) => { rows.forEach((r) => x.unshift({ id: `JB-${Math.max(0, ...x.map((j) => Number(String(j.id).replace(/\D/g, "")) || 0)) + 1}`, title: r.title, type: r.type, apps: 0, status: r.status === "Closed" ? "closed" : "open", closes: r.closes || "" })); });
  return (
    <>
      <PageHead title={t("gc.title")} sub={t("gc.sub")} actions={<><DataActions kind="careers" rows={jobRows} onImport={importJobs} /><Button icon="plus">{t("gc.newJob")}</Button></>} />
      <Panel title={t("gc.jobs")}><Table rows={jobs} minWidth={640} columns={[
        { key: "t", label: t("gc.job"), render: (j) => <span className="pf-two"><b>{j.title}</b><small>{j.type}</small></span> },
        { key: "a", label: t("gc.apps"), num: true, align: "right", render: (j) => j.apps },
        { key: "c", label: t("gc.closes"), num: true, render: (j) => fdate(j.closes) },
        { key: "s", label: t("common.status"), render: (j) => <B s={j.status} /> },
      ]} /></Panel>
      <div className="pf-kanban">{stages.map((s) => (
        <section key={s} className="pf-kcol"><header><b>{t(`gc.s_${s}`)}</b><span className="tnum">{apps.filter((a) => a.stage === s).length}</span></header>
          {apps.filter((a) => a.stage === s).map((a) => (
            <div key={a.id} className="card pf-kcard"><b>{a.name}</b><span className="small muted">{jobs.find((j) => j.id === a.job)?.title}</span>
              {s !== "offer" && <button className="link small" onClick={() => setApps((x) => { const y = x.find((z) => z.id === a.id); y.stage = stages[stages.indexOf(s) + 1]; })}>{t("gc.moveOn")} <Icon name="arrow-right" size={13} /></button>}</div>
          ))}
        </section>
      ))}</div>
    </>
  );
}

/* Contact-owner, contact-agent and tour requests (platform-wide view) */
const REQ = [
  { id: "RQ-901", kind: "tour", who: "Rita Maharjan", phone: "9815550011", what: "L-1042 · 4 BHK, Budhanilkantha", to: "Himalayan Homes Realty", when: "2027-03-05T11:00", status: "scheduled" },
  { id: "RQ-900", kind: "owner", who: "Gopal Sharma", phone: "9841556677", what: "P-31 · Shetal Heights", to: "Shetal Heights Developers", when: null, status: "new" },
  { id: "RQ-899", kind: "agent", who: "Mina Tamang", phone: "9806677889", what: "L-1043 · Jhamsikhel flat", to: "Himalayan Homes Realty", when: null, status: "done" },
  { id: "RQ-898", kind: "tour", who: "Arun Poudel", phone: "9849001122", what: "Video tour · Fewa View Villa", to: "Fewa View Villa", when: "2027-03-03T17:00", status: "scheduled" },
];
export function AdminRequests() {
  const t = useT();
  const [list] = useList("requests", REQ);
  const [k, setK] = useState("all");
  const rows = list.filter((r) => k === "all" || r.kind === k);
  return (
    <>
      <PageHead title={t("gr.title")} sub={t("gr.sub")} actions={<Seg value={k} onChange={setK} options={["all", "owner", "agent", "tour"].map((x) => ({ id: x, label: t(`gr.k_${x}`) }))} />} />
      <section className="card pf-panel"><Table rows={rows} minWidth={860} columns={[
        { key: "w", label: t("gr.from"), render: (r) => <span className="pf-two"><b>{r.who}</b><small className="tnum">{r.phone}</small></span> },
        { key: "k", label: t("gr.kind"), render: (r) => <Badge tone="neutral" icon={{ tour: "calendar-check", owner: "user", agent: "briefcase" }[r.kind]}>{t(`gr.k_${r.kind}`)}</Badge> },
        { key: "x", label: t("gr.about"), render: (r) => <span className="small">{r.what}</span> },
        { key: "t", label: t("gl.sentTo"), render: (r) => <span className="small">{r.to}</span> },
        { key: "d", label: t("gso.when"), num: true, render: (r) => (r.when ? fdatetime(r.when) : "—") },
        { key: "s", label: t("common.status"), render: (r) => <B s={r.status} /> },
      ]} /></section>
      <p className="pf-hint"><Icon name="info" size={13} />{t("gr.note")}</p>
    </>
  );
}

/* Deals and agent earnings */
const DEALS = [
  { id: "DL-77", what: "4 BHK house, Budhanilkantha", tenant: "Himalayan Homes Realty", agent: "Hari Bhandari", value: 32000000, pct: 2, stage: "baina", at: "2027-02-20" },
  { id: "DL-76", what: "2 BHK, Shetal Heights", tenant: "Shetal Heights Developers", agent: "Pooja Shrestha", value: 8500000, pct: 1, stage: "registered", at: "2027-02-14" },
  { id: "DL-75", what: "Jhamsikhel flat (rent)", tenant: "Himalayan Homes Realty", agent: "Gita Rai", value: 45000, pct: 50, stage: "registered", at: "2027-02-10" },
];
export function AdminEarnings() {
  const t = useT();
  const [deals] = useList("deals", DEALS);
  const comm = (d) => (d.value * d.pct) / 100;
  const shetal = (d) => comm(d) * 0.1;
  return (
    <>
      <PageHead title={t("ge.title")} sub={t("ge.sub")} />
      <div className="pf-stats">
        <Stat label={t("ge.value")} value={rs(deals.reduce((s, d) => s + d.value, 0))} note={t("ge.deals", { n: deals.length })} />
        <Stat label={t("ge.commission")} value={rs(deals.reduce((s, d) => s + comm(d), 0))} note={t("ge.commissionNote")} />
        <Stat label={t("ge.shetal")} value={rs(deals.reduce((s, d) => s + shetal(d), 0))} note={t("ge.shetalNote")} to="/admin/billing" />
      </div>
      <section className="card pf-panel"><Table rows={deals} minWidth={880} columns={[
        { key: "w", label: t("ge.deal"), render: (d) => <span className="pf-two"><b>{d.what}</b><small>{d.tenant}</small></span> },
        { key: "a", label: t("role.agent"), render: (d) => d.agent },
        { key: "v", label: t("ge.valueCol"), num: true, align: "right", render: (d) => rs(d.value) },
        { key: "c", label: t("ge.commission"), num: true, align: "right", render: (d) => `${rs(comm(d))} (${d.pct}%)` },
        { key: "s", label: t("ge.shetal"), num: true, align: "right", render: (d) => rs(shetal(d)) },
        { key: "st", label: t("ge.stage"), render: (d) => <Badge tone={d.stage === "registered" ? "done" : "progress"}>{t(`ge.st_${d.stage}`)}</Badge> },
      ]} /></section>
    </>
  );
}

/* Live sessions + expiry emails + notification templates */
const TEMPLATES = [
  { id: "booking_confirmed", ch: ["sms", "email", "wa"], text: "Namaste {name}, your stay at {business} on {date} is confirmed. Booking {code}." },
  { id: "payment_received", ch: ["sms", "email"], text: "We received {amount} for {code}. Receipt: {link}" },
  { id: "listing_expiring", ch: ["email", "wa"], text: "Your listing “{title}” expires on {date}. Renew in one tap: {link}" },
  { id: "instalment_due", ch: ["sms", "wa"], text: "Instalment of {amount} for unit {unit} is due on {date}. Pay: {link}" },
  { id: "birthday", ch: ["sms", "wa"], text: "Happy birthday, {name}! Best wishes from {business}." },
  { id: "invite", ch: ["email"], text: "{inviter} invited you to {business} on Sheetal. Accept: {link}" },
];
export function AdminMessages({ only }) {
  const t = useT();
  const toast = useToast();
  const [tpl, setTpl] = useList("templates", TEMPLATES);
  const [sel, setSel] = useState(TEMPLATES[0].id);
  const [tab, setTab] = useState(only || "templates");
  const cur = tpl.find((x) => x.id === sel);
  const live = [[38, "Kathmandu", "/stays?city=pokhara"], [21, "Pokhara", "/project/shetal-heights"], [9, "Sydney", "/buy?area=budhanilkantha"], [6, "Lalitpur", "/rent?city=lalitpur"]];
  return (
    <>
      <PageHead title={t("gm.title")} sub={t("gm.sub")} />
      {!only && <Tabs value={tab} onChange={setTab} tabs={[{ id: "templates", label: t("gm.templates"), icon: "file-text" }, { id: "expiry", label: t("gm.expiry"), icon: "calendar-x" }, { id: "live", label: t("gm.live"), icon: "radio" }]} />}
      {tab === "templates" && <div className="pf-settings">
        <nav className="pf-settings-nav">{tpl.map((x) => <button key={x.id} className={sel === x.id ? "on" : ""} onClick={() => setSel(x.id)}>{t(`gm.t_${x.id}`)}</button>)}</nav>
        <Panel title={t(`gm.t_${cur.id}`)} sub={t("gm.vars")} pad className="grow"><div className="pf-stack">
          <div className="pf-chips">{["sms", "email", "wa"].map((c) => { const on = cur.ch.includes(c); return <button key={c} className={`chip ${on ? "active" : ""}`} onClick={() => setTpl((a) => { const x = a.find((y) => y.id === sel); x.ch = on ? x.ch.filter((z) => z !== c) : [...x.ch, c]; })}>{on && <Icon name="check" size={14} />}{t(`notif.${c}`)}</button>; })}</div>
          <Field label={t("hr.message")} hint={t("gm.len", { n: cur.text.length })}><Textarea rows={4} value={cur.text} onChange={(e) => setTpl((a) => { a.find((y) => y.id === sel).text = e.target.value; })} style={{ minHeight: 100 }} /></Field>
          <div className="pf-note"><Icon name="smartphone" size={16} />{cur.text.replace("{name}", "Sita").replace("{business}", "Lakeside Retreat Hotel").replace("{date}", "12 Mar").replace("{code}", "BK-2027-0418").replace("{amount}", "Rs. 14,916").replace("{link}", "sheetalproperty.com/r/8f2k").replace("{title}", "4 BHK house").replace("{unit}", "B-1204").replace("{inviter}", "Dipesh")}</div>
          <TplPreview text={cur.text.replace("{name}", "Sita").replace("{business}", "Lakeside Retreat Hotel").replace("{date}", "12 Mar").replace("{code}", "BK-2027-0418").replace("{amount}", "Rs. 14,916").replace("{link}", "sheetalproperty.com/r/8f2k").replace("{title}", "4 BHK house").replace("{unit}", "B-1204").replace("{inviter}", "Dipesh")} ch={cur.ch} title={t(`gm.t_${cur.id}`)} />
          <div className="pf-row-actions"><Button variant="outline" icon="send" onClick={() => toast(t("dev.toastTest"))}>{t("dev.test")}</Button><Button onClick={() => toast(t("settings.toastSaved"))}>{t("common.save")}</Button></div>
        </div></Panel>
      </div>}
      {tab === "expiry" && <Panel title={t("gm.expiry")} sub={t("gm.expirySub")} pad><div className="pf-stack">
        <ToggleRow title={t("gm.e7")} sub={t("gm.e7Sub")} checked onChange={() => {}} />
        <ToggleRow title={t("gm.e1")} sub={t("gm.e1Sub")} checked onChange={() => {}} />
        <ToggleRow title={t("gm.eAfter")} sub={t("gm.eAfterSub")} checked onChange={() => {}} />
        <Field label={t("gm.lifetime")}><Seg value="90" onChange={() => {}} options={["30", "60", "90", "180"].map((x) => ({ id: x, label: t("ag.days", { n: x }) }))} /></Field>
        <div className="pf-note"><Icon name="mail" size={16} />{t("gm.expiryCount", { n: 46 })}</div>
      </div></Panel>}
      {tab === "live" && <div className="pf-split">
        <Panel title={t("an.liveNow", { n: 74 })} className="grow"><Table rows={live.map(([n, c, p]) => ({ id: p, n, c, p }))} minWidth={520} columns={[
          { key: "p", label: t("an.page"), render: (r) => <code>{r.p}</code> }, { key: "c", label: t("gm.city"), render: (r) => r.c }, { key: "n", label: t("gm.people"), num: true, align: "right", render: (r) => r.n },
        ]} /></Panel>
        <Panel title={t("gm.lastHour")} className="side" pad><Line labels={["-60", "-45", "-30", "-15", "now"]} series={[{ name: t("an.visitors"), data: [52, 61, 58, 70, 74] }]} /></Panel>
      </div>}
    </>
  );
}

function TplPreview({ text, ch, title }) {
  return (
    <div className="pf-tpl-prev">
      {ch.includes("email") && <div className="pf-tpl-email"><div className="pf-tpl-email-head"><b>Sheetal</b><span className="tiny muted">no-reply@sheetalproperty.com</span></div><h4>{title}</h4><p className="small">{text}</p><span className="pf-tpl-btn">View details</span><span className="tiny muted">You get this because you booked on Sheetal.</span></div>}
      {(ch.includes("sms") || ch.includes("wa")) && <div className="pf-tpl-phone"><span className="tiny muted">{ch.includes("wa") ? "WhatsApp" : "SMS"} · SHEETAL</span><div className="pf-tpl-bubble small">{text}</div></div>}
      <div className="pf-tpl-app"><Icon name="bell" size={16} /><span className="pf-two"><b>{title}</b><small>{text.slice(0, 70)}{text.length > 70 ? "…" : ""}</small></span></div>
    </div>
  );
}
