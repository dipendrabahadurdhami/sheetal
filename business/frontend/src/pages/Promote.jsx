import React, { useState } from "react";
import { useT } from "@sheetal/shared/core/i18n";
import { useStore } from "@sheetal/shared/core/store";
import { fdate, inDays, rs } from "@sheetal/shared/core/format";
import { Badge, Button, Drawer, Field, Input, PageHead, Panel, Seg, Stat, Table, Tabs, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";

// Ads, boosts and search ranking on sheetalproperty.com. Super admin sets slots, prices and ranking weights;
// every business can promote its listings and see what it got for the money.
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

export function Promote({ tenant }) {
  const t = useT();
  const { db, update } = useStore();
  const toast = useToast();
  const slots = db.adSlots || SLOTS;
  const all = db.campaigns || CAMPAIGNS;
  const mine = all.filter((c) => c.tenantId === tenant.id);
  const listings = db.listings.filter((l) => l.tenantId === tenant.id && l.status === "published");
  const [tab, setTab] = useState("campaigns");
  const [f, setF] = useState(null);
  const sum = (k) => mine.reduce((s, c) => s + c[k], 0);
  const start = () => setF({ listing: listings[0]?.id, slot: "home_featured", days: 7 });
  const slot = f && slots.find((s) => s.id === f.slot);
  const score = (l, i) => Math.min(98, 52 + ((l.views + i * 37) % 40));

  return (
    <>
      <PageHead title={t("ads.title")} sub={t("ads.sub")} actions={<Button icon="rocket" onClick={start} disabled={!listings.length}>{t("ads.boost")}</Button>} />
      <div className="pf-stats">
        <Stat label={t("ads.spend")} value={rs(sum("spend"))} note={t("ads.allTime")} />
        <Stat label={t("ads.seen")} value={sum("imp").toLocaleString("en-IN")} note={t("ads.clicks", { n: sum("clicks").toLocaleString("en-IN") })} />
        <Stat label={t("ads.leads")} value={sum("leads")} note={t("ads.fromAds")} to="/business/inbox" />
        <Stat label={t("ads.cpl")} value={sum("leads") ? rs(Math.round(sum("spend") / sum("leads"))) : "—"} note={t("ads.cplNote")} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "campaigns", label: t("ads.campaigns"), icon: "rocket", count: mine.length }, { id: "ranking", label: t("ads.ranking"), icon: "trending-up" }, { id: "slots", label: t("ads.where"), icon: "layout-grid" }]} />
      {tab === "campaigns" && <section className="card pf-panel"><Table rows={mine} minWidth={860} columns={[
        { key: "t", label: t("listings.listing"), render: (c) => <span className="pf-two"><b>{c.title}</b><small className="tnum">{c.id} · {t(`slot.${c.slot}`)}</small></span> },
        { key: "d", label: t("hr.dates"), num: true, render: (c) => `${fdate(c.from)} – ${fdate(c.to)}` },
        { key: "i", label: t("ads.seenShort"), num: true, align: "right", render: (c) => c.imp.toLocaleString("en-IN") },
        { key: "c", label: t("ads.clicksShort"), num: true, align: "right", render: (c) => c.clicks.toLocaleString("en-IN") },
        { key: "l", label: t("ads.leads"), num: true, align: "right", render: (c) => c.leads },
        { key: "s", label: t("ads.spend"), num: true, align: "right", render: (c) => rs(c.spend) },
        { key: "st", label: t("common.status"), render: (c) => <Badge tone={tone[c.status]}>{t(`ads.s_${c.status}`)}</Badge> },
      ]} /></section>}
      {tab === "ranking" && <div className="pf-split">
        <Panel title={t("ads.yourScores")} sub={t("ads.yourScoresSub")} className="grow"><Table rows={listings.map((l, i) => ({ ...l, sc: score(l, i) }))} minWidth={560} columns={[
          { key: "t", label: t("listings.listing"), render: (l) => <span className="pf-two"><b>{l.title}</b><small className="tnum">{l.id}</small></span> },
          { key: "s", label: t("ads.score"), render: (l) => <div className="pf-meter" style={{ minWidth: 160 }}><div className="pf-meter-top"><b className="tnum">{l.sc} / 100</b></div><div className="bar"><i style={{ width: `${l.sc}%` }} /></div></div> },
          { key: "p", label: t("ads.position"), num: true, align: "right", render: (l) => `#${Math.max(1, Math.round((100 - l.sc) / 6))}` },
        ]} /></Panel>
        <Panel title={t("ads.improve")} className="side"><ul className="pf-list">
          {[["image", "tip_photos"], ["clock", "tip_reply"], ["star", "tip_reviews"], ["badge-check", "tip_verify"], ["refresh-cw", "tip_fresh"]].map(([ic, k]) => <li key={k}><span className="pf-li-ico"><Icon name={ic} size={16} /></span><div><b>{t(`ads.${k}`)}</b><span className="small muted">{t(`ads.${k}Sub`)}</span></div></li>)}
        </ul></Panel>
      </div>}
      {tab === "slots" && <div className="pf-plan-grid">{slots.map((s) => (
        <section key={s.id} className="card pf-plan">
          <div className="pf-plan-top"><span className="pf-person"><span className="pf-li-ico"><Icon name={s.icon} size={16} /></span><h3 style={{ fontSize: 16 }}>{t(`slot.${s.id}`)}</h3></span></div>
          <span className="small muted">{t(`slot.${s.id}Sub`)}</span>
          <div className="pf-price-line"><b className="tnum">{rs(s.price)}</b><span>/ {t(`ads.u_${s.unit}`)}</span></div>
          <span className="small muted tnum">{t("ads.free", { n: Math.max(0, s.stock - all.filter((c) => c.slot === s.id && c.status === "live").length), of: s.stock })}</span>
          <div className="pf-plan-foot"><Button variant="outline" size="sm" block onClick={() => setF({ listing: listings[0]?.id, slot: s.id, days: 7 })} disabled={!listings.length}>{t("ads.useSlot")}</Button></div>
        </section>
      ))}</div>}
      <Drawer open={!!f} onClose={() => setF(null)} title={t("ads.boost")} sub={t("ads.boostSub")}
        footer={f && <><span className="small muted tnum" style={{ marginRight: "auto" }}>{t("pos.total")}: <b className="pf-strong">{rs(slot.price * (slot.unit === "day" ? f.days : 1))}</b></span><Button variant="outline" onClick={() => setF(null)}>{t("common.cancel")}</Button>
          <Button icon="credit-card" onClick={() => { const l = listings.find((x) => x.id === f.listing); update((d) => { d.campaigns = d.campaigns || structuredClone(CAMPAIGNS); d.campaigns.unshift({ id: `AD-${130 + d.campaigns.length}`, tenantId: tenant.id, listing: l.id, title: l.title, slot: f.slot, from: inDays(1), to: inDays(f.days), spend: slot.price * (slot.unit === "day" ? f.days : 1), imp: 0, clicks: 0, leads: 0, status: "review" }); }); setF(null); setTab("campaigns"); toast(t("ads.toastPaid")); }}>{t("ads.payStart")}</Button></>}>
        {f && <div className="pf-stack">
          <Field label={t("listings.listing")}><div className="pf-chips">{listings.map((l) => <button key={l.id} className={`chip ${f.listing === l.id ? "active" : ""}`} onClick={() => setF({ ...f, listing: l.id })}>{l.title}</button>)}</div></Field>
          <Field label={t("ads.where")}><div className="pf-tiles">{slots.map((s) => <button key={s.id} className={f.slot === s.id ? "on" : ""} onClick={() => setF({ ...f, slot: s.id })}><Icon name={s.icon} size={18} /><span>{t(`slot.${s.id}`)}<small className="pf-sub-line tnum">{rs(s.price)} / {t(`ads.u_${s.unit}`)}</small></span></button>)}</div></Field>
          {slot.unit === "day" && <Field label={t("ads.howLong")}><Seg value={String(f.days)} onChange={(v) => setF({ ...f, days: Number(v) })} options={["3", "7", "14", "30"].map((x) => ({ id: x, label: t("ag.days", { n: x }) }))} /></Field>}
          <div className="pf-note"><Icon name="chart-column" size={16} />{t("ads.estimate", { imp: (slot.price * f.days * 4).toLocaleString("en-IN"), leads: Math.max(2, Math.round((slot.price * f.days) / 320)) })}</div>
          <p className="pf-hint"><Icon name="shield-check" size={13} />{t("ads.reviewNote")}</p>
        </div>}
      </Drawer>
    </>
  );
}

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

export { Input };
