// AI tools screen in the sample workspace (listing from text, lead finder, blog writer, voice agent, Ask AI).
// Where it fits: opened from the listing wizard and the AI pages; signed-in businesses use the server's AI instead
// (business API /ai/*, see LiveGrowth.jsx).
// How it works: returns ready-made sample results after a short pause, so the screens can be shown without an AI account.

import React, { useState } from "react";
import { useT } from "@sheetal/shared/core/i18n";
import { useStore } from "@sheetal/shared/core/store";
import { useRouter } from "@sheetal/shared/core/router";
import { TODAY, rs } from "@sheetal/shared/core/format";
import { Badge, Button, Field, Input, PageHead, Panel, Seg, Stat, Table, Tabs, Textarea, ToggleRow, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { isAllAccess, kindsFor } from "@sheetal/shared/core/plans";
import { emptyOps } from "@sheetal/shared/demo/ops";

async function ask(_prompt, fallback) {
  await new Promise((r) => setTimeout(r, 700));
  return typeof fallback === "function" ? fallback() : fallback;
}
const json = (s, fb) => { try { const m = String(s).match(/[[{][\s\S]*[\]}]/); return m ? JSON.parse(m[0]) : fb; } catch { return fb; } };

const SAMPLE_DESC = "Ghar bikrima: Budhanilkantha-3, Chandol marg. 8 aana jagga ma 2.5 tale ghar, 4 bedroom, 3 bathroom, modular kitchen, 2 car parking, east facing, 13 feet black topped road. Lalpurja clear, bank loan milchha. Price 3 crore 20 lakh, thorai negotiable. Contact 9841234500.";
const SAMPLE_FIELDS = { kind: "sell", category: "house", propertyType: "residential_house", district: "kathmandu", area: "Budhanilkantha", ward: 3, tole: "Chandol marg", land: "0-8-0-0 (8 aana)", floors: 2.5, bedrooms: 4, bathrooms: 3, parking: 2, facing: "east", roadWidth: "13_20", roadType: "blacktop", facilities: ["modular_kitchen", "parking"], price: 32000000, negotiable: true, banks: true, phone: "9841234500" };
const SAMPLE_CHAT = "[10:02] Rajesh: Hi, looking for 5-8 aana land in Budhanilkantha, budget around 2.5 crore. 9841223344\n[10:15] Sarita Gurung: 4BHK house kinna khojeko, Lalitpur side, 3 crore samma. 9856012345\n[11:40] Anil: 1 ropani bechna chha Tokha ma, call 9812233441";
const SAMPLE_LEADS = [];

export function AIStudio({ tenant, only, onFill }) {
  const t = useT();
  const toast = useToast();
  const { db, update } = useStore();
  const { navigate } = useRouter();
  const [tab, setTab] = useState(only || "listing");
  const [busy, setBusy] = useState(false);
  const plan = db.plans.find((p) => p.id === tenant.planId);
  const credits = db.aiCredits?.[tenant.id] ?? { used: 214, limit: isAllAccess(plan) ? 2000 : 500 };
  const spend = (n) => update((d) => { d.aiCredits = d.aiCredits || {}; const c = d.aiCredits[tenant.id] || { ...credits }; c.used += n; d.aiCredits[tenant.id] = c; });

  // 1. listing from text
  const [desc, setDesc] = useState(SAMPLE_DESC);
  const [fields, setFields] = useState(null);
  const extract = async () => {
    setBusy(true);
    const out = await ask(`Extract Nepal property listing fields as JSON (kind, category, district, area, ward, land, bedrooms, bathrooms, floors, parking, facing, roadWidth, roadType, facilities[], price in NPR number, negotiable, phone) from:\n${desc}\nReply with JSON only.`, () => JSON.stringify(SAMPLE_FIELDS));
    setFields(json(out, SAMPLE_FIELDS)); spend(3); setBusy(false);
  };
  const openWizard = () => {
    const C = db.catalog;
    const low = (x) => String(x || "").toLowerCase().trim();
    const pick = (val, list) => { const v = low(val); if (!v || !list) return undefined; const hit = list.find((o) => o.id === v || low(o.en) === v || low(o.en).includes(v) || v.includes(low(o.id))); return hit?.id; };
    const allowed = kindsFor(C, tenant, plan);
    const k0 = low(fields.kind);
    let kind = /rent|lease|bhada/.test(k0) ? "rentout" : /stay|hotel|night/.test(k0) ? (allowed.includes("stay_hotel") ? "stay_hotel" : "stay_unit") : /project|colony/.test(k0) ? "project" : /invest/.test(k0) ? "invest" : "sell";
    if (!allowed.includes(kind)) kind = allowed[0];
    const category = pick(fields.category, C.categories);
    const district = pick(fields.district, C.districts);
    const f = { ...fields, kind, category, district,
      propertyType: category ? pick(fields.propertyType, C.propertyTypes[category]) : undefined,
      facing: pick(fields.facing, C.facing), roadWidth: pick(fields.roadWidth, C.roadWidth), roadType: pick(fields.roadType, C.roadType),
      facilities: Array.isArray(fields.facilities) ? fields.facilities.map((x) => pick(x, C.facilities)).filter(Boolean) : undefined,
      price: Number(String(fields.price || "").replace(/[^\d.]/g, "")) || undefined,
      ward: Number(fields.ward) || undefined, bedrooms: Number(fields.bedrooms) || undefined, bathrooms: Number(fields.bathrooms) || undefined, parking: Number(fields.parking) || undefined, floors: Number(fields.floors) || undefined };
    update((d) => { d.drafts[tenant.id] = { kind: f.kind || "sell", step: 0, values: { category: f.category, propertyType: f.propertyType, location: { district: f.district, area: f.area }, ward: f.ward, tole: f.tole, bedrooms: f.bedrooms, bathrooms: f.bathrooms, floors: Math.round(f.floors || 0) || undefined, parking: f.parking, facing: f.facing, roadWidth: f.roadWidth, roadType: f.roadType, facilities: f.facilities, price: f.price, negotiable: f.negotiable } }; });
    toast(t("ai.toastPrefilled"));
    if (onFill) onFill(); else navigate("/business/listings/new");
  };

  // 2. leads from chats
  const [chat, setChat] = useState(SAMPLE_CHAT);
  const [leads, setLeads] = useState(null);
  const extractLeads = async () => {
    setBusy(true);
    const out = await ask(`From these Nepali/English chat messages, extract real-estate leads as a JSON array of {name, phone, intent (buy/sell/rent/stay), type, location, budget (NPR number), lang, note}:\n${chat}\nJSON only.`, () => JSON.stringify(SAMPLE_LEADS));
    setLeads(json(out, SAMPLE_LEADS).map((l, i) => ({ ...l, id: i, saved: false }))); spend(2); setBusy(false);
  };
  const saveLead = (l) => {
    update((d) => { const o = d.ops[tenant.id] = d.ops[tenant.id] || emptyOps(); o.convs = o.convs || []; o.convs.unshift({ id: `cv${Date.now()}${l.id}`, name: l.name || l.phone, phone: l.phone, ch: "web", stage: "new", unread: 0, last: `${l.intent} · ${l.type} · ${l.location}`, at: TODAY, msgs: [{ from: "them", text: `${l.type} in ${l.location}${l.budget ? `, budget ${rs(l.budget)}` : ""}. ${l.note || ""}`, at: "10:00" }], budget: l.budget, tags: ["AI extracted"] }); });
    setLeads((x) => x.map((y) => (y.id === l.id ? { ...y, saved: true } : y))); toast(t("ai.toastLead"));
  };

  // 3. blog
  const [blog, setBlog] = useState({ topic: `Why ${tenant.city} is a great place to ${tenant.type === "hotel" || tenant.type === "host" ? "stay this spring" : "buy property in 2027"}`, lang: "en", out: "" });
  const writeBlog = async () => {
    setBusy(true);
    const out = await ask(`Write a ${blog.lang === "ne" ? "Nepali" : "English"} blog post (about 400 words, plain, helpful, no hype) for ${tenant.name}, a ${tenant.type} in ${tenant.city}, Nepal. Topic: ${blog.topic}`, `${blog.topic}\n\n${tenant.city} has quietly become one of the easiest places in Nepal to ${tenant.type === "hotel" || tenant.type === "host" ? "slow down for a few days" : "put money into land and homes"}. Here is what we tell every guest and buyer who asks us.\n\nGetting here\n…\n\nWhat it costs\n…\n\nWhat to check before you book or pay\n…`);
    setBlog({ ...blog, out }); spend(5); setBusy(false);
  };

  // 4. voice agent
  const va = db.voiceAgents?.[tenant.id] || { name: `${tenant.name} assistant`, slug: tenant.id + "x7k2q", on: true, greeting: `Namaste! ${tenant.name} ma swagat chha. Ma kasari sahayog garna sakchhu?`, knowledge: "Check-in 14:00, check-out 11:00. Free airport pickup for 3+ nights. Breakfast included. Pets not allowed.", instructions: "Answer in the caller's language. Take name, phone, dates and guests for any booking. Hand over to front desk if the caller asks for a person.", calls: 142 };
  const setVa = (patch) => update((d) => { d.voiceAgents = d.voiceAgents || {}; d.voiceAgents[tenant.id] = { ...va, ...patch }; });
  const link = `sheetalproperty.com/call/${va.slug}`;

  // 5. ask AI
  const mine = db.listings.filter((l) => l.tenantId === tenant.id).slice(0, 4);
  const [q, setQ] = useState("Which is better for a family of four?");
  const [answer, setAnswer] = useState("");
  const askAi = async () => { setBusy(true); const out = await ask(`Compare these listings for a buyer in plain language and answer: ${q}\n${JSON.stringify(mine)}`, `For a family of four, ${mine[0]?.title || "the first listing"} is the stronger pick: more space, a quieter road and room for two cars. ${mine[1]?.title || "The second"} costs less each month but suits a couple better.`); setAnswer(out); spend(1); setBusy(false); };

  return (
    <>
      {only ? <div className="pf-row-actions" style={{ justifyContent: "flex-start" }}><Badge tone="neutral" icon="sparkles">{t("ai.credits", { used: credits.used, limit: credits.limit })}</Badge></div> : <PageHead title={t("ai.title")} sub={t("ai.sub")} actions={<Badge tone={credits.used / credits.limit > 0.9 ? "action" : "neutral"} icon="sparkles">{t("ai.credits", { used: credits.used, limit: credits.limit })}</Badge>} />}
      {!only && <Tabs value={tab} onChange={setTab} tabs={[
        { id: "listing", label: t("ai.t_listing"), icon: "wand-sparkles" }, { id: "leads", label: t("ai.t_leads"), icon: "radar" },
        { id: "blog", label: t("ai.t_blog"), icon: "pen-line" }, { id: "voice", label: t("ai.t_voice"), icon: "phone-call" }, { id: "ask", label: t("ai.t_ask"), icon: "message-circle-question" },
      ]} />}

      {tab === "listing" && <div className="pf-split">
        <Panel title={t("ai.listingTitle")} sub={t("ai.listingSub")} className="grow" pad><div className="pf-stack">
          <Textarea rows={7} value={desc} onChange={(e) => setDesc(e.target.value)} style={{ minHeight: 170 }} aria-label={t("ai.listingTitle")} />
          <div className="pf-row-actions" style={{ justifyContent: "flex-start" }}><Button icon="wand-sparkles" onClick={extract} disabled={busy || !desc.trim()}>{busy ? t("ai.working") : t("ai.extract")}</Button><span className="pf-hint">{t("ai.cost", { n: 3 })}</span></div>
        </div></Panel>
        <Panel title={t("ai.found")} className="side" pad>{fields ? <div className="pf-stack">
          <dl className="pf-kv">{Object.entries(fields).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd className="tnum">{Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? "✓" : "—") : k === "price" ? rs(v) : String(v)}</dd></React.Fragment>)}</dl>
          <Button icon="arrow-right" onClick={openWizard}>{t("ai.openWizard")}</Button>
          <p className="pf-hint"><Icon name="info" size={13} />{t("ai.check")}</p>
        </div> : <p className="small muted">{t("ai.foundEmpty")}</p>}</Panel>
      </div>}

      {tab === "leads" && <div className="pf-stack">
        <Panel title={t("ai.leadsTitle")} sub={t("ai.leadsSub")} pad><div className="pf-stack">
          <Textarea rows={6} value={chat} onChange={(e) => setChat(e.target.value)} style={{ minHeight: 140 }} aria-label={t("ai.leadsTitle")} />
          <div className="pf-row-actions" style={{ justifyContent: "flex-start" }}><Button icon="radar" onClick={extractLeads} disabled={busy}>{busy ? t("ai.working") : t("ai.findLeads")}</Button><span className="pf-hint">{t("ai.cost", { n: 2 })}</span></div>
        </div></Panel>
        {leads && <section className="card pf-panel"><Table rows={leads} minWidth={860} columns={[
          { key: "n", label: t("gl.lead"), render: (l) => <span className="pf-two"><b>{l.name || "—"}</b><small className="tnum">{l.phone}</small></span> },
          { key: "i", label: t("ai.intent"), render: (l) => <Badge tone="neutral">{l.intent}</Badge> },
          { key: "w", label: t("gl.wants"), render: (l) => `${l.type} · ${l.location}` },
          { key: "b", label: t("gl.budget"), num: true, align: "right", render: (l) => (l.budget ? rs(l.budget) : "—") },
          { key: "x", label: "", align: "right", render: (l) => (l.saved ? <Badge tone="done">{t("ai.inInbox")}</Badge> : <Button size="sm" icon="inbox" onClick={() => saveLead(l)}>{t("ai.saveLead")}</Button>) },
        ]} /></section>}
      </div>}

      {tab === "blog" && <div className="pf-split">
        <Panel title={t("ai.t_blog")} sub={t("ai.blogSub")} className="side" pad><div className="pf-stack">
          <Field label={t("gso.topic")}><Input value={blog.topic} onChange={(e) => setBlog({ ...blog, topic: e.target.value })} /></Field>
          <Field label={t("ag.langField")}><Seg value={blog.lang} onChange={(v) => setBlog({ ...blog, lang: v })} options={[{ id: "en", label: "English" }, { id: "ne", label: "नेपाली" }]} /></Field>
          <Button icon="pen-line" onClick={writeBlog} disabled={busy}>{busy ? t("ai.working") : t("gso.write")}</Button>
          <span className="pf-hint">{t("ai.cost", { n: 5 })}</span>
        </div></Panel>
        <Panel title={t("gso.draft")} className="grow" pad>{blog.out ? <div className="pf-stack"><Textarea rows={14} value={blog.out} onChange={(e) => setBlog({ ...blog, out: e.target.value })} style={{ minHeight: 300 }} />
          <div className="pf-row-actions"><Button variant="outline" icon="calendar-clock" onClick={() => toast(t("gso.toastScheduled"))}>{t("gso.schedule")}</Button><Button icon="send" onClick={() => toast(t("ai.toastBlog"))}>{t("ai.publishSite")}</Button></div></div>
          : <p className="small muted">{t("gso.draftEmpty")}</p>}</Panel>
      </div>}

      {tab === "voice" && <div className="pf-split">
        <Panel title={t("ai.voiceTitle")} sub={t("ai.voiceSub")} className="grow" pad><div className="pf-stack">
          <ToggleRow title={t("gv.on")} sub={va.on ? t("ai.voiceLive") : t("ai.voiceOff")} checked={va.on} onChange={(v) => setVa({ on: v })} />
          <Field label={t("dev.name")}><Input value={va.name} onChange={(e) => setVa({ name: e.target.value })} /></Field>
          <Field label={t("gv.greeting")}><Textarea rows={2} value={va.greeting} onChange={(e) => setVa({ greeting: e.target.value })} style={{ minHeight: 64 }} /></Field>
          <Field label={t("ai.knowledge")} hint={t("ai.knowledgeHint")}><Textarea rows={4} value={va.knowledge} onChange={(e) => setVa({ knowledge: e.target.value })} style={{ minHeight: 100 }} /></Field>
          <Field label={t("ai.instructions")}><Textarea rows={3} value={va.instructions} onChange={(e) => setVa({ instructions: e.target.value })} style={{ minHeight: 80 }} /></Field>
        </div></Panel>
        <Panel title={t("ai.callLink")} className="side" pad><div className="pf-stack">
          <div className="pf-qr" aria-hidden="true">{Array.from({ length: 81 }, (_, i) => <i key={i} className={(i * 7 + va.slug.length * 3) % 5 < 2 || [0, 1, 2, 9, 18, 6, 7, 8, 17, 26, 54, 63, 72, 73, 74].includes(i) ? "on" : ""} />)}</div>
          <code className="tnum" style={{ textAlign: "center" }}>{link}</code>
          <div className="pf-row-actions" style={{ justifyContent: "center" }}><Button variant="outline" size="sm" icon="copy" onClick={() => { navigator.clipboard?.writeText(`https://${link}`); toast(t("dom.copied")); }}>{t("dom.copy")}</Button><Button variant="outline" size="sm" icon="download">QR</Button></div>
          <Button variant="ghost" size="sm" icon="refresh-cw" onClick={() => { setVa({ slug: Math.random().toString(36).slice(2, 12) }); toast(t("ai.toastNewLink")); }}>{t("ai.newLink")}</Button>
          <p className="pf-hint"><Icon name="info" size={13} />{t("ai.linkNote")}</p>
          <div className="pf-note"><Icon name="phone" size={16} />{t("ai.calls", { n: va.calls })}</div>
        </div></Panel>
      </div>}

      {tab === "ask" && <div className="pf-split">
        <Panel title={t("ai.askTitle")} sub={t("ai.askSub")} className="grow" pad><div className="pf-stack">
          <div className="pf-chips">{mine.map((l) => <span key={l.id} className="chip active"><Icon name="house" size={14} />{l.title}</span>)}</div>
          <Field label={t("ai.question")}><Input value={q} onChange={(e) => setQ(e.target.value)} /></Field>
          <Button icon="sparkles" onClick={askAi} disabled={busy || !mine.length}>{busy ? t("ai.working") : t("ai.ask")}</Button>
          {answer && <div className="pf-note"><Icon name="sparkles" size={16} /><span>{answer}</span></div>}
        </div></Panel>
        <Panel title={t("ai.askWhere")} className="side" pad><p className="small">{t("ai.askWhereText")}</p></Panel>
      </div>}
    </>
  );
}

const FEATURES = ["listing", "leads", "blog", "voice", "ask", "reply"];
export function AdminAI({ embedded }) {
  const t = useT();
  const { db, update } = useStore();
  const toast = useToast();
  const cfg = db.aiConfig || { provider: "claude", features: Object.fromEntries(FEATURES.map((f) => [f, true])), credits: { Starter: 500, Business: 2000, Pro: 6000 }, topup: 1000, topupPrice: 900, voiceRate: 4 };
  const set = (patch) => update((d) => { d.aiConfig = { ...cfg, ...patch }; });
  const usage = db.tenants.slice(0, 8).map((x, i) => ({ id: x.id, name: x.name, plan: db.plans.find((p) => p.id === x.planId)?.name, used: [214, 1820, 96, 40, 0, 2410, 12, 0][i], limit: cfg.credits[db.plans.find((p) => p.id === x.planId)?.name] || 500 }));
  return (
    <>
      {!embedded && <PageHead title={t("ai.adminTitle")} sub={t("ai.adminSub")} />}
      <div className="pf-stats">
        <Stat label={t("ai.usedMonth")} value={usage.reduce((s, u) => s + u.used, 0).toLocaleString("en-IN")} note={t("ai.creditsWord")} />
        <Stat label={t("ai.voiceMin")} value="3,410" note={rs(3410 * cfg.voiceRate)} to="/admin/voice" />
        <Stat label={t("ai.topups")} value={rs(18 * cfg.topupPrice)} note={t("ai.topupsNote", { n: 18 })} to="/admin/billing" />
      </div>
      <div className="pf-split">
        <Panel title={t("ai.featuresTitle")} className="grow" pad><div className="pf-stack">
          {FEATURES.map((f) => <ToggleRow key={f} title={t(`ai.f_${f}`)} sub={t(`ai.f_${f}Sub`)} checked={cfg.features[f]} onChange={(v) => { set({ features: { ...cfg.features, [f]: v } }); toast(t("settings.toastSaved")); }} />)}
        </div></Panel>
        <Panel title={t("ai.creditsTitle")} className="side" pad><div className="pf-stack">
          {Object.keys(cfg.credits).map((p) => <div key={p} className="pf-limit-row"><span>{p}</span><Input className="input tnum" style={{ width: 100 }} value={cfg.credits[p]} onChange={(e) => set({ credits: { ...cfg.credits, [p]: Number(e.target.value.replace(/\D/g, "")) } })} aria-label={p} /><span className="small muted">{t("ai.perMonth")}</span></div>)}
          <div className="pf-limit-row"><span>{t("ai.topup", { n: cfg.topup })}</span><Input className="input tnum" style={{ width: 100 }} value={cfg.topupPrice} onChange={(e) => set({ topupPrice: Number(e.target.value.replace(/\D/g, "")) })} aria-label="top-up price" /><span className="small muted">Rs.</span></div>
          <div className="pf-limit-row"><span>{t("ai.voiceRate")}</span><Input className="input tnum" style={{ width: 100 }} value={cfg.voiceRate} onChange={(e) => set({ voiceRate: Number(e.target.value.replace(/\D/g, "")) })} aria-label="voice rate" /><span className="small muted">{t("ai.perMin")}</span></div>
        </div></Panel>
      </div>
      <Panel title={t("ai.byBusiness")}><Table rows={usage} minWidth={640} columns={[
        { key: "n", label: t("tenants.business"), render: (u) => <b className="pf-strong">{u.name}</b> },
        { key: "p", label: t("tenants.plan"), render: (u) => u.plan },
        { key: "u", label: t("ai.creditsWord"), render: (u) => <div className="pf-meter" style={{ minWidth: 180 }}><div className="pf-meter-top"><span className="tnum small">{u.used} / {u.limit}</span></div><div className="bar"><i style={{ width: `${Math.min(100, (u.used / u.limit) * 100)}%` }} /></div></div> },
      ]} /></Panel>
    </>
  );
}
