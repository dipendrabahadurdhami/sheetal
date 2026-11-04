// Admin screens for ads, AI settings, analytics and website orders (sample data, marked Preview where not live).
// Rules: the business panel keeps its own copy of the ad slots and ranking (SLOTS, RANK); change both together.

import React, { useState } from "react";
import { useT } from "@sheetal/shared/core/i18n";
import { useStore } from "@sheetal/shared/core/store";
import { fdate, rs } from "@sheetal/shared/core/format";
import { Badge, Button, Input, PageHead, Panel, Seg, Stat, Table, Tabs, ToggleRow, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { Donut, Line } from "@sheetal/shared/core/charts";

/* ───────── Ads, boosts and search ranking ───────── */
export const SLOTS = [
  { id: "home_hero", icon: "image", price: 2500, unit: "day", stock: 3 },
  { id: "home_featured", icon: "star", price: 900, unit: "day", stock: 8 },
  { id: "search_top", icon: "arrow-up-to-line", price: 600, unit: "day", stock: 6 },
  { id: "area_page", icon: "map-pin", price: 400, unit: "day", stock: 10 },
  { id: "listing_side", icon: "panel-right", price: 300, unit: "day", stock: 12 },
  { id: "newsletter", icon: "mail", price: 5000, unit: "issue", stock: 2 },
  { id: "social", icon: "megaphone", price: 3500, unit: "post", stock: 6 },
];
export const RANK = [
  { id: "verified", w: 20 }, { id: "photos", w: 15 }, { id: "response", w: 15 }, { id: "reviews", w: 15 },
  { id: "fresh", w: 10 }, { id: "complete", w: 10 }, { id: "plan", w: 5 }, { id: "boost", w: 10 },
];
const CAMPAIGNS = [];
const tone = { live: "done", review: "action", ended: "neutral", paused: "progress" };

export function AdminAds() {
  const t = useT();
  const { db, update } = useStore();
  const toast = useToast();
  const [tab, setTab] = useState("queue");
  const slots = db.adSlots || SLOTS;
  const rank = db.rankWeights || RANK;
  const all = db.campaigns || CAMPAIGNS;
  const set = (fn) => update((d) => { d.campaigns = d.campaigns || structuredClone(CAMPAIGNS); d.adSlots = d.adSlots || structuredClone(SLOTS); d.rankWeights = d.rankWeights || structuredClone(RANK); fn(d); });
  const totalW = rank.reduce((s, r) => s + r.w, 0);
  return (
    <>
      <PageHead title={t("ads.adminTitle")} sub={t("ads.adminSub")} />
      <div className="pf-stats">
        <Stat label={t("ads.revenue")} value={rs(all.reduce((s, c) => s + c.spend, 0))} note={t("ads.thisMonth")} to="/admin/billing" />
        <Stat label={t("ads.live")} value={all.filter((c) => c.status === "live").length} note={t("ads.campaigns")} />
        <Stat label={t("ads.toReview")} value={all.filter((c) => c.status === "review").length} note={t("hr.waiting")} tone="action" noteIcon="circle-alert" />
        <Stat label={t("ads.leads")} value={all.reduce((s, c) => s + c.leads, 0)} note={t("ads.fromAds")} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "queue", label: t("ads.campaigns"), icon: "rocket" }, { id: "slots", label: t("ads.slots"), icon: "layout-grid" }, { id: "rank", label: t("ads.rankRules"), icon: "trending-up" }]} />
      {tab === "queue" && <section className="card pf-panel"><Table rows={all} minWidth={880} columns={[
        { key: "t", label: t("listings.listing"), render: (c) => <span className="pf-two"><b>{c.title}</b><small>{db.tenants.find((x) => x.id === c.tenantId)?.name} · {t(`slot.${c.slot}`)}</small></span> },
        { key: "d", label: t("hr.dates"), num: true, render: (c) => `${fdate(c.from)} – ${fdate(c.to)}` },
        { key: "s", label: t("ads.spend"), num: true, align: "right", render: (c) => rs(c.spend) },
        { key: "l", label: t("ads.leads"), num: true, align: "right", render: (c) => c.leads },
        { key: "st", label: t("common.status"), render: (c) => <Badge tone={tone[c.status]}>{t(`ads.s_${c.status}`)}</Badge> },
        { key: "x", label: "", align: "right", render: (c) => <div className="pf-row-actions">
          {c.status === "review" && <><Button variant="outline" size="sm" onClick={() => set((d) => { d.campaigns.find((x) => x.id === c.id).status = "ended"; })}>{t("common.reject")}</Button><Button size="sm" onClick={() => { set((d) => { d.campaigns.find((x) => x.id === c.id).status = "live"; }); toast(t("ads.toastLive")); }}>{t("common.approve")}</Button></>}
          {c.status === "live" && <Button variant="ghost" size="sm" onClick={() => set((d) => { d.campaigns.find((x) => x.id === c.id).status = "paused"; })}>{t("ads.pause")}</Button>}
          {c.status === "paused" && <Button variant="ghost" size="sm" onClick={() => set((d) => { d.campaigns.find((x) => x.id === c.id).status = "live"; })}>{t("ads.resume")}</Button>}
        </div> },
      ]} /></section>}
      {tab === "slots" && <section className="card pf-panel"><Table rows={slots} minWidth={720} columns={[
        { key: "n", label: t("ads.slot"), render: (s) => <span className="pf-person"><span className="pf-li-ico"><Icon name={s.icon} size={16} /></span><span className="pf-two"><b>{t(`slot.${s.id}`)}</b><small>{t(`slot.${s.id}Sub`)}</small></span></span> },
        { key: "p", label: t("addon.price"), render: (s) => <div className="pf-unit" style={{ maxWidth: 200 }}><span>Rs.</span><input className="input tnum" value={s.price} onChange={(e) => set((d) => { d.adSlots.find((x) => x.id === s.id).price = Number(e.target.value.replace(/\D/g, "")); })} aria-label={t("addon.price")} /><span>/ {t(`ads.u_${s.unit}`)}</span></div> },
        { key: "k", label: t("ads.stock"), render: (s) => <div className="pf-counter"><button onClick={() => set((d) => { const x = d.adSlots.find((y) => y.id === s.id); x.stock = Math.max(1, x.stock - 1); })} aria-label="−"><Icon name="minus" size={15} /></button><b className="tnum">{s.stock}</b><button onClick={() => set((d) => { d.adSlots.find((y) => y.id === s.id).stock += 1; })} aria-label="+"><Icon name="plus" size={15} /></button></div> },
      ]} /></section>}
      {tab === "rank" && <div className="pf-split">
        <Panel title={t("ads.rankRules")} sub={t("ads.rankSub", { n: totalW })} className="grow" pad><div className="pf-stack">
          {rank.map((r) => (
            <div key={r.id} className="pf-rank-row">
              <span className="pf-two"><b>{t(`rank.${r.id}`)}</b><small>{t(`rank.${r.id}Sub`)}</small></span>
              <input type="range" min="0" max="40" value={r.w} className="range" aria-label={t(`rank.${r.id}`)} onChange={(e) => set((d) => { d.rankWeights.find((x) => x.id === r.id).w = Number(e.target.value); })} />
              <b className="tnum">{Math.round((r.w / totalW) * 100)}%</b>
            </div>
          ))}
        </div></Panel>
        <Panel title={t("ads.rankHow")} className="side" pad><div className="pf-stack">
          <p className="small">{t("ads.rankHowText")}</p>
          <div className="pf-note"><Icon name="info" size={16} />{t("ads.rankFair")}</div>
        </div></Panel>
      </div>}
    </>
  );
}

/* ───────── Website traffic ───────── */
export function AdminAnalytics() {
  const t = useT();
  const days = ["24", "25", "26", "27", "28", "1", "2"];
  return (
    <>
      <PageHead title={t("an.traffic")} sub={t("an.trafficSub")} actions={<Badge tone="done" icon="radio">{t("an.liveNow", { n: 38 })}</Badge>} />
      <div className="pf-stats">
        <Stat label={t("an.visitors")} value="—" note="Starts once visits are tracked" />
        <Stat label={t("an.signups")} value="—" note="Starts once visits are tracked" />
        <Stat label={t("an.enquiries")} value="—" note="Starts once visits are tracked" />
        <Stat label={t("an.bounce")} value="—" note="Starts once visits are tracked" />
      </div>
      <div className="pf-split">
        <Panel title={t("an.visitsByDay")} className="grow" pad><Line labels={days} series={[{ name: t("an.visitors"), data: [3120, 3340, 2980, 3610, 4020, 3870, 3870] }, { name: t("an.enquiries"), data: [240, 262, 230, 301, 344, 298, 271] }]} /></Panel>
        <Panel title={t("an.devices")} className="side" pad><Donut center="24.8k" data={[{ label: t("an.mobile"), v: 71 }, { label: t("an.desktop"), v: 24 }, { label: t("an.tablet"), v: 5 }]} /></Panel>
      </div>
      <div className="pf-split">
        <Panel title={t("an.topPages")} className="grow"><Table minWidth={520} rows={[["/stays?city=pokhara", 4820], ["/project/shetal-heights", 3110], ["/buy?area=budhanilkantha", 2640], ["/rent?city=lalitpur", 2210], ["/investment/chitwan-jungle-lodge", 1480]].map(([p, v]) => ({ id: p, p, v }))} columns={[{ key: "p", label: t("an.page"), render: (r) => <code>{r.p}</code> }, { key: "v", label: t("an.visits"), num: true, align: "right", render: (r) => r.v.toLocaleString("en-IN") }]} /></Panel>
        <Panel title={t("an.cities")} className="side"><ul className="pf-bars">{[["Kathmandu", 42], ["Pokhara", 18], ["Lalitpur", 12], ["Abroad (NRN)", 16], ["Other", 12]].map(([c, v]) => <li key={c}><span>{c}</span><div className="bar"><i style={{ width: `${v * 2}%` }} /></div><b className="tnum">{v}%</b></li>)}</ul></Panel>
      </div>
    </>
  );
}

/* ───────── AI features and credits ───────── */
const FEATURES = ["listing", "leads", "blog", "voice", "ask", "reply"];
export function AdminAI({ embedded }) {
  const t = useT();
  const { db, update } = useStore();
  const toast = useToast();
  const cfg = db.aiConfig || { provider: "claude", features: Object.fromEntries(FEATURES.map((f) => [f, true])), credits: { Starter: 500, Business: 2000, Pro: 6000 }, topup: 1000, topupPrice: 900, voiceRate: 4 };
  const set = (patch) => update((d) => { d.aiConfig = { ...cfg, ...patch }; });
  const usage = db.tenants.map((x) => ({ id: x.id, name: x.name, plan: db.plans.find((p) => p.id === x.planId)?.name, used: x.aiUsed || 0, limit: cfg.credits[db.plans.find((p) => p.id === x.planId)?.name] || 500 }));
  return (
    <>
      {!embedded && <PageHead title={t("ai.adminTitle")} sub={t("ai.adminSub")} />}
      <div className="pf-stats">
        <Stat label={t("ai.usedMonth")} value={usage.reduce((s, u) => s + u.used, 0).toLocaleString("en-IN")} note={t("ai.creditsWord")} />
        <Stat label={t("ai.voiceMin")} value="—" note="Voice isn't connected yet" to="/admin/voice" />
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

/* ───────── Customer orders, refunds and claims ───────── */
const LABEL = { paid: "Paid", pending_verification: "Pending verification", confirmed: "Confirmed", reserved: "Reserved", invested: "Invested", completed: "Completed", cancelled: "Cancelled", refund_pending: "Refund pending" };
export const demoOrders = (db) => db.customer?.orders || [];

export function AdminOrders() {
  const { db, update } = useStore();
  const toast = useToast();
  const orders = demoOrders(db);
  const [f, setF] = useState("all");
  const rows = orders.filter((o) => f === "all" || (f === "refunds" ? o.status === "refund_pending" : f === "problems" ? o.problem : o.status === f)).map((o) => ({ ...o, id: o.code }));
  return (
    <section className="card pf-panel">
      <div className="pf-toolbar"><Seg value={f} onChange={setF} options={[{ id: "all", label: "All orders" }, { id: "refunds", label: "Refunds" }, { id: "problems", label: "Problems and claims" }]} /></div>
      <Table rows={rows} minWidth={860} columns={[
        { key: "c", label: "Order", render: (o) => <span className="pf-two"><b className="tnum">{o.code}</b><small>{o.title}</small></span> },
        { key: "b", label: "Business", render: (o) => <span className="small">{db.tenants.find((t) => t.id === o.tid)?.name}</span> },
        { key: "p", label: "Paid", num: true, align: "right", render: (o) => rs(o.paid) },
        { key: "s", label: "Status", render: (o) => <Badge tone={o.status === "refund_pending" ? "action" : o.problem ? "problem" : "done"}>{o.problem ? `Problem: ${o.problem}` : LABEL[o.status] || o.status}</Badge> },
        { key: "x", label: "", align: "right", render: (o) => o.status === "refund_pending" && <Button size="sm" onClick={() => { update((d) => { const x = d.customer?.orders.find((y) => y.code === o.code); if (x) x.status = "cancelled"; }); toast(`Refund of ${rs(o.refund || 0)} sent`); }}>Approve refund</Button> },
      ]} />
    </section>
  );
}
