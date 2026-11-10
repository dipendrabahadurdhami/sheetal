// Admin screens for AI settings (sample, signed out), analytics and website orders (sample data, marked Preview where not live).
// Rules: the old sample Ads screen is gone; boosts and banners are in Admin → Promote (LivePromote.jsx).

import React, { useState } from "react";
import { useT } from "@sheetal/shared/core/i18n";
import { useStore } from "@sheetal/shared/core/store";
import { fdate, rs } from "@sheetal/shared/core/format";
import { Badge, Button, Input, PageHead, Panel, Seg, Stat, Table, Tabs, ToggleRow, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { Donut, Line } from "@sheetal/shared/core/charts";

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
