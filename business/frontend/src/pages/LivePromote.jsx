// Promote on the business API (Business → Promote): boost listings on the website, follow how they do, move or stop
// boosts, and pick the listings for the plan's free featured slots.
// Where it fits: /business/promote, /business/promote/:tab (boosts, banner, featured, places) and
// /business/promote/boost/:code (the Boost button on Listings opens it with that listing picked). The website's
// "Advertise here" and "Boost your listing here" links come here too.
// Home banner: book days for the big picture on the website's home page, upload the two pictures (exact sizes, up to
// 1 MB, JPG, PNG, WebP or GIF), pay; Sheetal checks the picture, then it shows on its dates by itself. The sample screen is Promote.jsx. Paying uses billing's checkout.
// How it works: one load; the boost drawer asks the server for the price and the first free start date as choices
// change; "Make invoice and pay" makes the boost and its invoice, then the payment choices open (eSewa, Khalti and
// Fonepay go to the provider and come back; a bank transfer sends a receipt that Sheetal confirms). Once paid, the
// boost runs on its dates by itself.
// Rules: the server checks everything (spots, prices, who can buy). No refunds: a boost can be moved instead.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useBranch } from "@sheetal/shared/core/branch";
import { useRouter } from "@sheetal/shared/core/router";
import { fdate, rs } from "@sheetal/shared/core/format";
import { Badge, Button, Drawer, Empty, Field, Input, PageHead, Panel, Seg, Select, Stat, Table, Tabs, ToggleRow, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { bizApi, fileToBase64 } from "../api";
import { ManualProof, goToGateway } from "./LiveBilling";

const TABS = [
  { id: "boosts", label: "Boosts", icon: "rocket" },
  { id: "banner", label: "Home banner", icon: "image" },
  { id: "featured", label: "Free featured slots", icon: "star" },
  { id: "places", label: "Places and prices", icon: "layout-grid" },
];
const PLACE_ICON = { home: "house", search: "arrow-up-to-line", city: "map-pin" };
const PHASE_TONE = { awaiting: "action", checking: "progress", scheduled: "progress", live: "done", listing_off: "problem", ended: "neutral", stopped: "neutral", cancelled: "neutral" };
const METHOD_ICON = { esewa: "wallet", khalti: "wallet", fonepay: "qr-code", manual: "landmark" };
const Two = ({ a, b }) => <span className="pf-two"><b>{a}</b>{b ? <small>{b}</small> : null}</span>;
const fits = (l, place) => l.onSite && (place === "home" || (l.searchable && (place !== "city" || !!l.city)));

export function LivePromote({ tenant, tab = "boosts", code }) {
  const toast = useToast();
  const br = useBranch();
  const { navigate } = useRouter();
  const [d, setD] = useState(null);
  const [billing, setBilling] = useState(null);
  const [boost, setBoost] = useState(null); // the "boost a listing" form
  const [pay, setPay] = useState(null); // { invoiceId, label, total }
  const [manual, setManual] = useState(null);
  const [move, setMove] = useState(null);
  const [busy, setBusy] = useState(false);
  const T = TABS.some((x) => x.id === tab) ? tab : "boosts";

  const load = useCallback(() => bizApi("GET", "/promote").then((r) => setD(r.data)).catch((e) => { setD(false); toast(e.message); }), []);
  useEffect(() => { load(); }, [load, tenant.id, br?.branch]);
  // The Boost button on Listings: open the form with that listing.
  useEffect(() => {
    if (!d || !code) return;
    const l = d.listings.find((x) => x.code === code);
    if (l && d.canBuy) setBoost(startForm(d, l));
    else if (l && !d.canBuy) toast("Only people who manage billing can buy boosts. Ask the owner.");
    navigate("/business/promote");
  }, [d, code]);

  const act = (method, path, body) => { setBusy(true); return bizApi(method, path, body).then((r) => { toast(r.message); load(); return r; }).catch((e) => { toast(e.message); throw e; }).finally(() => setBusy(false)); };
  const openPay = (invoiceId, label, total) => {
    setPay({ invoiceId, label, total });
    if (!billing) bizApi("GET", "/billing").then((r) => setBilling(r.data)).catch((e) => toast(e.message));
  };
  const startPay = (method) => {
    setBusy(true);
    bizApi("POST", "/billing/checkout", { provider: method, invoiceId: pay.invoiceId }).then((r) => {
      if (r.data.method === "manual") { setManual({ ...r.data, label: pay.label }); setPay(null); setBusy(false); return; }
      goToGateway(r.data);
    }).catch((e) => { toast(e.message); setBusy(false); });
  };

  const totals = useMemo(() => {
    if (!d) return null;
    const live = d.boosts.filter((b) => b.phase === "live");
    const shown = d.boosts.filter((b) => ["live", "ended", "stopped", "listing_off"].includes(b.phase));
    return { live: live.length, views: shown.reduce((s, b) => s + b.views, 0), clicks: shown.reduce((s, b) => s + b.clicks, 0), leads: shown.reduce((s, b) => s + b.leads, 0) };
  }, [d]);

  if (d === null) return <><PageHead title="Promote" /><p className="muted pf-pad">Loading…</p></>;
  if (d === false) return <><PageHead title="Promote" /><Empty icon="circle-alert" title="Promote couldn't load">Try again in a moment.</Empty></>;
  const awaiting = d.boosts.filter((b) => b.phase === "awaiting" && b.invoice?.status === "open");
  const onSite = d.listings.filter((l) => l.onSite);
  const go = (id) => navigate(id === "boosts" ? "/business/promote" : `/business/promote/${id}`);

  return (
    <>
      <PageHead title="Promote" sub="Show your listings first on the Sheetal website: on the home page, at the top of search, or on their city's results. Boosts run by themselves once paid."
        actions={d.canBuy && <Button icon="rocket" disabled={!onSite.length} onClick={() => setBoost(startForm(d, onSite[0]))}>Boost a listing</Button>} />

      {awaiting.map((b) => (
        <div key={b.id} className="pf-alert action"><Icon name="receipt" size={18} />
          <div><b>{b.no} is waiting for payment</b><span>{b.code} · {b.placeLabel} · {fdate(b.startOn)} to {fdate(b.endOn)} · {rs(b.invoice.total)}. Its spot is kept for a short while.</span></div>
          {d.canBuy && <Button size="sm" icon="credit-card" onClick={() => openPay(b.invoice.id, `${b.invoice.number} · ${b.no}`, b.invoice.total)}>Pay</Button>}
        </div>
      ))}

      <div className="pf-stats">
        <Stat label="Live now" value={totals.live} note={`of ${d.boosts.filter((b) => ["live", "scheduled"].includes(b.phase)).length} running or booked`} />
        <Stat label="Views" value={totals.views.toLocaleString("en-IN")} note="Times shown in a boosted place" />
        <Stat label="Clicks" value={totals.clicks.toLocaleString("en-IN")} note={totals.views ? `${Math.round((totals.clicks / totals.views) * 1000) / 10}% of views` : "Opened from a boosted place"} />
        <Stat label="Leads" value={totals.leads} note="Enquiries on boosted listings while boosted" to="/business/inbox" />
      </div>

      <Tabs tabs={TABS.map((x) => ({ ...x, count: x.id === "boosts" ? d.boosts.filter((b) => ["live", "scheduled", "awaiting", "checking", "listing_off"].includes(b.phase)).length || undefined : x.id === "featured" ? `${d.featured.used}/${d.featured.limit === -1 ? "∞" : d.featured.limit}` : undefined }))} value={T} onChange={go} />

      {T === "boosts" && <Panel>
        <Table rows={d.boosts} minWidth={900}
          empty={<div className="pf-pad"><Empty icon="rocket" title="No boosts yet" action={d.canBuy && onSite.length > 0 && <Button icon="rocket" onClick={() => setBoost(startForm(d, onSite[0]))}>Boost a listing</Button>}>A boost puts a listing first in one place on the website, for 3 to 30 days.</Empty></div>}
          columns={[
            { key: "l", label: "Listing", render: (b) => <Two a={b.title || b.code} b={`${b.no} · ${b.code}${b.source === "gift" ? " · free from the old website" : ""}${b.history?.length ? ` · moved from ${b.history.map((h) => h.code).join(", ")}` : ""}`} /> },
            { key: "p", label: "Place", render: (b) => <span className="pf-person"><Icon name={PLACE_ICON[b.place]} size={15} /><span className="small">{b.placeLabel}{b.place === "city" && b.city ? ` · ${b.city}` : ""}</span></span> },
            { key: "d", label: "Dates", num: true, render: (b) => <Two a={`${fdate(b.startOn)} – ${fdate(b.endOn)}`} b={b.daysLeft ? `${b.daysLeft} of ${b.days} days left` : `${b.days} days`} /> },
            { key: "s", label: "Status", render: (b) => <Badge tone={PHASE_TONE[b.phase]}>{b.phaseLabel}</Badge> },
            { key: "r", label: "Views · clicks · leads", num: true, render: (b) => <span className="tnum small">{b.views.toLocaleString("en-IN")} · {b.clicks} · {b.leads}</span> },
            { key: "x", label: "", align: "right", render: (b) => <div className="pf-row-actions" style={{ justifyContent: "flex-end" }}>
              {b.phase === "awaiting" && b.invoice?.status === "open" && d.canBuy && <><Button size="sm" icon="credit-card" onClick={() => openPay(b.invoice.id, `${b.invoice.number} · ${b.no}`, b.invoice.total)}>Pay</Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => window.confirm(`Cancel ${b.no}? Nothing was paid; its spot is freed.`) && act("POST", `/promote/boosts/${b.id}/cancel`)}>Cancel</Button></>}
              {["live", "scheduled", "listing_off"].includes(b.phase) && <><Button size="sm" variant={b.phase === "listing_off" ? undefined : "outline"} icon="arrow-right-left" onClick={() => setMove({ boost: b, listingId: "" })}>Move</Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => window.confirm(`Stop ${b.no} now? The money isn't refunded. To use the days left, move it to another listing instead.`) && act("POST", `/promote/boosts/${b.id}/stop`)}>Stop</Button></>}
              {["ended", "stopped", "cancelled"].includes(b.phase) && d.canBuy && (() => { const l = d.listings.find((x) => x.id === b.listingId); return l && fits(l, b.place) ? <Button size="sm" variant="ghost" icon="rotate-ccw" onClick={() => setBoost(startForm(d, l, b.place, b.days))}>Boost again</Button> : null; })()}
            </div> },
          ]} />
      </Panel>}

      {T === "banner" && <BannerTab onPay={openPay} />}

      {T === "featured" && <Panel title="Free featured slots" sub={d.featured.limit === -1 ? "Your plan has no limit. Picked listings show in the home page's featured row, after the boosted ones." : `Your plan includes ${d.featured.limit} free slots in the home page's featured row, after the boosted listings. They don't end: keep a listing there as long as you like.`}
        actions={<Button variant="outline" size="sm" icon="puzzle" onClick={() => navigate("/business/billing")}>More slots</Button>}>
        {d.featured.limit === 0 ? <div className="pf-pad"><Empty icon="star" title="Your plan has no free featured slots" action={<Button onClick={() => navigate("/business/billing")}>See plans</Button>}>Upgrade for free slots, or boost a listing for a few days.</Empty></div>
          : <div className="pf-pad pf-stack tight">
            <span className="small muted tnum">{d.featured.used} of {d.featured.limit === -1 ? "unlimited" : d.featured.limit} in use</span>
            {onSite.length ? onSite.map((l) => (
              <ToggleRow key={l.id} title={`${l.code} · ${l.title}`} sub={l.featured ? "In the featured row" : l.city || ""}
                checked={l.featured} onChange={(v) => act("PUT", `/promote/featured/${l.id}`, { on: v })} />
            )) : <Empty icon="house" title="No listings on the website yet">Publish a listing first.</Empty>}
          </div>}
      </Panel>}

      {T === "places" && <div className="pf-plan-grid">{d.places.map((p) => (
        <section key={p.id} className="card pf-plan">
          <div className="pf-plan-top"><span className="pf-person"><span className="pf-li-ico"><Icon name={PLACE_ICON[p.id]} size={16} /></span><h3 style={{ fontSize: 16, margin: 0 }}>{p.label}</h3></span>{!p.active && <Badge tone="neutral">Not on sale</Badge>}</div>
          <span className="small muted">{p.sub}</span>
          <b className="tnum" style={{ fontSize: 22 }}>{rs(p.price)} <small className="muted" style={{ fontSize: 13 }}>a day, VAT included</small></b>
          <span className="small muted tnum">{p.id === "city" ? `${p.spots} spots in each city` : `${Math.max(0, p.spots - p.takenToday)} of ${p.spots} spots free today`}</span>
          <div className="pf-plan-foot">{d.canBuy && <Button variant="outline" size="sm" block disabled={!p.active || !onSite.some((l) => fits(l, p.id))} onClick={() => setBoost(startForm(d, onSite.find((l) => fits(l, p.id)), p.id))}>Boost here</Button>}</div>
        </section>
      ))}</div>}

      {boost && <BoostDrawer d={d} f={boost} setF={setBoost} busy={busy} onClose={() => setBoost(null)}
        onMade={(r) => { setBoost(null); load(); openPay(r.data.invoiceId, `${r.data.number} · ${r.data.no}`, r.data.total); }} />}

      <Drawer open={!!pay} onClose={() => !busy && setPay(null)} title="How do you want to pay?" sub={pay ? `${pay.label} · ${rs(pay.total)}` : ""}>
        {pay && <div className="pf-stack">
          {!billing ? <p className="muted">Loading…</p> : billing.methods.map((m) => (
            <button key={m.id} type="button" className="pf-choice" disabled={busy} onClick={() => startPay(m.id)}>
              <Icon name={METHOD_ICON[m.id] || "credit-card"} size={20} /><span className="pf-two" style={{ flex: 1 }}><b>{m.name}{m.test ? " (test mode)" : ""}</b>
                <small>{m.id === "manual" ? "Pay into Sheetal's bank account and upload the receipt. The boost starts once Sheetal confirms it." : `You'll go to ${m.name} to pay, then come back. The boost starts as soon as it's paid.`}</small></span><Icon name="arrow-right" size={16} />
            </button>
          ))}
          {billing && !billing.methods.length && <Empty icon="wallet" title="No way to pay is set up yet">Please contact Sheetal support.</Empty>}
          <p className="small muted" style={{ margin: 0 }}>You can also pay later from here or from Billing. The spot is kept for a short while.</p>
        </div>}
      </Drawer>
      <ManualProof manual={manual} bank={billing?.bank} onClose={() => setManual(null)} onSent={() => { setManual(null); load(); }} />

      {move && (() => {
        const b = move.boost;
        const options = d.listings.filter((l) => l.id !== b.listingId && fits(l, b.place) && (b.place !== "city" || (l.city || "").toLowerCase() === (b.city || "").toLowerCase()));
        return (
          <Drawer open onClose={() => setMove(null)} title={`Move ${b.no}`} sub={`${b.placeLabel} · ${b.daysLeft} days left`}
            footer={<><Button variant="outline" onClick={() => setMove(null)}>Cancel</Button><Button icon="arrow-right-left" disabled={!move.listingId || busy} onClick={() => act("POST", `/promote/boosts/${b.id}/move`, { listingId: Number(move.listingId) }).then(() => setMove(null), () => {})}>Move</Button></>}>
            <div className="pf-stack">
              <p className="small muted" style={{ margin: 0 }}>The days left move to another listing, in the same place{b.place === "city" ? ` (${b.city})` : ""}. Nothing more to pay.</p>
              {options.length ? <Field label="Move to"><Select value={move.listingId} onChange={(v) => setMove({ ...move, listingId: v })} options={[{ id: "", label: "Pick a listing" }, ...options.map((l) => ({ id: String(l.id), label: `${l.code} · ${l.title}` }))]} aria-label="Listing" /></Field>
                : <Empty icon="house" title="No other listing fits">{b.place === "city" ? `Publish another listing in ${b.city} first.` : "Publish another listing first."}</Empty>}
            </div>
          </Drawer>
        );
      })()}
    </>
  );
}

function startForm(d, l, place, days) {
  const p = place || (l && d.places.find((x) => x.active && fits(l, x.id))?.id) || "home";
  return { listingId: l ? String(l.id) : "", place: p, days: days || d.lengths.find((n) => n === 7) || d.lengths[0], startOn: "" };
}

function BoostDrawer({ d, f, setF, busy, onClose, onMade }) {
  const toast = useToast();
  const [q, setQ] = useState(null);
  const [err, setErr] = useState("");
  const [making, setMaking] = useState(false);
  const l = d.listings.find((x) => String(x.id) === f.listingId);
  const set = (p) => setF({ ...f, ...p });
  useEffect(() => {
    setQ(null); setErr("");
    if (!l || !fits(l, f.place)) return undefined;
    const tm = setTimeout(() => {
      bizApi("GET", `/promote/quote?listingId=${l.id}&place=${f.place}&days=${f.days}${f.startOn ? `&startOn=${f.startOn}` : ""}`).then((r) => setQ(r.data)).catch((e) => setErr(e.message));
    }, 250);
    return () => clearTimeout(tm);
  }, [f.listingId, f.place, f.days, f.startOn]);
  const make = () => {
    setMaking(true);
    bizApi("POST", "/promote/boosts", { listingId: l.id, place: f.place, days: f.days, startOn: q.startOn }).then((r) => { toast(r.message); onMade(r); }).catch((e) => toast(e.message)).finally(() => setMaking(false));
  };
  const listings = d.listings.filter((x) => x.onSite);
  return (
    <Drawer open onClose={onClose} title="Boost a listing" sub="Shown first in the place you pick, for the days you pick."
      footer={<><span className="small muted tnum" style={{ marginRight: "auto" }}>{q ? <>Total <b className="pf-strong">{rs(q.total)}</b> (VAT {rs(q.vat)} included)</> : ""}</span>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button icon="credit-card" disabled={!q || making || busy} onClick={make}>{making ? "Making invoice…" : "Make invoice and pay"}</Button></>}>
      <div className="pf-stack">
        <Field label="Listing"><Select value={f.listingId} onChange={(v) => set({ listingId: v })} options={listings.map((x) => ({ id: String(x.id), label: `${x.code} · ${x.title}${x.city ? ` · ${x.city}` : ""}` }))} aria-label="Listing" /></Field>
        <Field label="Where on the website">
          <div className="pf-tiles">{d.places.map((p) => {
            const ok = p.active && l && fits(l, p.id);
            return <button key={p.id} type="button" className={f.place === p.id ? "on" : ""} disabled={!ok} title={!p.active ? "Not on sale" : !ok ? (p.id === "city" && l?.searchable ? "Add the city to the listing first" : "For buy and rent listings") : undefined} onClick={() => set({ place: p.id })}>
              <Icon name={PLACE_ICON[p.id]} size={18} /><span>{p.label}{p.id === "city" && l?.city ? ` (${l.city})` : ""}<small className="pf-sub-line tnum">{rs(p.price)} a day</small></span></button>;
          })}</div>
        </Field>
        <Field label="How long"><Seg value={f.days} onChange={(v) => set({ days: Number(v) })} options={d.lengths.map((n) => ({ id: n, label: `${n} days` }))} /></Field>
        <Field label="Start" hint="Leave empty for the first free day." optional><Input type="date" min={d.today} value={f.startOn} onChange={(e) => set({ startOn: e.target.value })} /></Field>
        {err && <div className="pf-note"><Icon name="info" size={16} /><span>{err}</span></div>}
        {q && <div className="pf-note"><Icon name="calendar-days" size={16} /><span>
          {fdate(q.startOn)} to {fdate(q.endOn)}: {q.days} days × {rs(q.price)} = <b>{rs(q.total)}</b>.
          {q.moved ? ` This place is full until then, so it starts on the first free day.` : ""} It starts by itself once paid.</span></div>}
      </div>
    </Drawer>
  );
}

// ───── Home banner ─────
const BANNER_TONE = { awaiting: "action", checking: "progress", review: "progress", rejected: "problem", scheduled: "progress", live: "done", ended: "neutral", stopped: "neutral", cancelled: "neutral" };
const readSize = (file) => new Promise((ok) => { const u = URL.createObjectURL(file); const img = new Image(); img.onload = () => { ok({ w: img.naturalWidth, h: img.naturalHeight, url: u }); }; img.onerror = () => ok(null); img.src = u; });

function PicturePick({ label, size, value, onChange, max }) {
  const [err, setErr] = useState("");
  const pick = async (f) => {
    setErr("");
    if (!f) return;
    if (!/^image\/(jpeg|png|webp|gif)$/.test(f.type)) { setErr("Use a JPG, PNG, WebP or GIF."); return; }
    if (f.size > max) { setErr(`It is ${(f.size / 1048576).toFixed(1)} MB. Save it under 1 MB.`); return; }
    const s = await readSize(f);
    if (!s) { setErr("This picture can't be opened."); return; }
    if (s.w !== size.width || s.h !== size.height) { setErr(`It is ${s.w} × ${s.h}. It must be exactly ${size.width} × ${size.height} pixels.`); return; }
    onChange({ file: f, url: s.url });
  };
  return (
    <Field label={`${label}: ${size.width} × ${size.height} px`} hint="JPG, PNG, WebP or GIF, up to 1 MB." error={err}>
      <label className="pf-file" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: 12, border: "1px dashed var(--line)", borderRadius: 10, cursor: "pointer" }}>
        {value?.url ? <img src={value.url} alt="" style={{ width: "100%", maxHeight: 160, objectFit: "contain", borderRadius: 6 }} /> : <Icon name="upload" size={22} />}
        <span className="small">{value?.file ? value.file.name : "Choose picture"}</span>
        <input type="file" hidden accept="image/jpeg,image/png,image/webp,image/gif" onChange={(e) => pick(e.target.files[0])} />
      </label>
    </Field>
  );
}

function BannerTab({ onPay }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [f, setF] = useState(null); // booking or changing
  const [q, setQ] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => bizApi("GET", "/promote/banners").then((r) => setD(r.data)).catch((e) => { setD(false); toast(e.message); }), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    setQ(null);
    if (!f || f.id) return undefined;
    const tm = setTimeout(() => bizApi("GET", `/promote/banners/quote?days=${f.days}${f.startOn ? `&startOn=${f.startOn}` : ""}`).then((r) => setQ(r.data)).catch((e) => toast(e.message)), 250);
    return () => clearTimeout(tm);
  }, [f?.days, f?.startOn, f?.id]);
  if (d === null) return <p className="muted pf-pad">Loading…</p>;
  if (d === false) return <Empty icon="circle-alert" title="Banners couldn't load">Try again in a moment.</Empty>;
  const set = (p) => setF((x) => ({ ...x, ...p }));
  const fromListing = !!f && (f.id ? !!f.listing : f.mode === "listing");
  const okText = f && (fromListing ? (f.id || !!f.listingId) : /^https?:\/\/\S+\.\S+$/i.test(f.link || "") && !!f.desktop && !!f.mobile);
  const send = async () => {
    setBusy(true);
    try {
      const body = fromListing ? { title: (f.title || "").trim(), button: (f.button || "").trim(), ...(f.id ? {} : { listingId: f.listingId }) } : { link: f.link.trim(), title: (f.title || "").trim(), button: (f.button || "").trim() };
      if (f.desktop?.file) body.desktop = { data: await fileToBase64(f.desktop.file) };
      if (f.mobile?.file) body.mobile = { data: await fileToBase64(f.mobile.file) };
      if (f.id) { const r = await bizApi("PUT", `/promote/banners/${f.id}`, body); toast(r.message); setF(null); load(); return; }
      const r = await bizApi("POST", "/promote/banners", { ...body, days: f.days, startOn: q.startOn });
      toast(r.message); setF(null); load();
      onPay(r.data.invoiceId, `${r.data.number} · ${r.data.no}`, r.data.total);
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  };
  // A listing banner is the easy way (no pictures to make): it starts there when the business has a listing with photos.
  const book = () => setF({ mode: d.choices?.length ? "listing" : "pictures", listingId: d.choices?.[0]?.id ?? null, days: d.lengths.find((n) => n === 7) || d.lengths[0], startOn: "", link: "", title: "", button: "", desktop: null, mobile: null });
  const canBook = d.canBuy && d.active && d.onPlan;
  const chosen = f && d.choices?.find((c) => c.id === f.listingId);
  return (
    <>
      <Panel title="Home page banner" sub={`The big picture behind the title and search on the Sheetal home page. Up to ${d.spots} banners take turns. ${rs(d.price)} a day, VAT included. Sheetal checks the picture before it shows.`}
        actions={canBook && <Button icon="image-plus" onClick={book}>Book the home banner</Button>}>
        {d.canBuy && d.active && !d.onPlan && <div className="pf-pad"><div className="pf-alert"><Icon name="layers" size={18} /><div><b>Home page banners are for businesses on a plan</b><span>Choose Starter, Business or Pro, then book a banner for your listing, hotel or agency.</span></div><Button size="sm" onClick={() => window.location.assign("/business/plans")}>See plans</Button></div></div>}
        <Table rows={d.rows} minWidth={860}
          empty={<div className="pf-pad"><Empty icon="image" title="No banners yet" action={canBook && <Button icon="image-plus" onClick={book}>Book the home banner</Button>}>Pick one of your listings (its photos show as a grid and the banner opens it) or upload your own pictures, choose the days, then pay.</Empty></div>}
          columns={[
            { key: "p", label: "Banner", render: (b) => <span className="pf-person"><img src={b.desktop || b.listing?.photos?.[0]} alt="" style={{ width: 96, height: 30, objectFit: "cover", borderRadius: 4 }} /><span className="pf-two"><b>{b.title || b.no}</b><small>{b.no} · {b.listing ? `Listing ${b.listing.code}` : b.link.replace(/^https?:\/\//, "").slice(0, 40)}</small></span></span> },
            { key: "d", label: "Dates", num: true, render: (b) => <span className="pf-two"><b>{fdate(b.startOn)} – {fdate(b.endOn)}</b><small>{b.days} days · {rs(b.total)}</small></span> },
            { key: "s", label: "Status", render: (b) => <span className="pf-two"><Badge tone={BANNER_TONE[b.phase]}>{b.phaseLabel}</Badge>{b.reviewNote && <small>{b.reviewNote}</small>}</span> },
            { key: "r", label: "Views · clicks", num: true, render: (b) => <span className="small tnum">{b.views.toLocaleString("en-IN")} · {b.clicks}</span> },
            { key: "x", label: "", align: "right", render: (b) => d.canBuy && <div className="pf-row-actions" style={{ justifyContent: "flex-end" }}>
              {b.phase === "awaiting" && b.invoice?.status === "open" && <><Button size="sm" icon="credit-card" onClick={() => onPay(b.invoice.id, `${b.invoice.number} · ${b.no}`, b.invoice.total)}>Pay</Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => window.confirm(`Cancel ${b.no}? Nothing was paid.`) && bizApi("POST", `/promote/banners/${b.id}/cancel`).then((r) => { toast(r.message); load(); }).catch((e) => toast(e.message))}>Cancel</Button></>}
              {["awaiting", "review", "rejected"].includes(b.phase) && <Button size="sm" variant={b.phase === "rejected" ? undefined : "outline"} icon="image-up" onClick={() => setF({ id: b.id, no: b.no, listing: b.listing, link: b.link, title: b.title, button: b.button, desktop: b.desktop ? { url: b.desktop } : null, mobile: b.mobile ? { url: b.mobile } : null })}>{b.phase === "rejected" ? (b.listing ? "Change words" : "Change picture") : "Edit"}</Button>}
            </div> },
          ]} />
      </Panel>

      {f && <Drawer open onClose={() => !busy && setF(null)} title={f.id ? `Change ${f.no}` : "Book the home banner"} sub={f.id ? "Changes go to Sheetal to check." : "Shown behind the title and search on the home page."}
        footer={<><span className="small muted tnum" style={{ marginRight: "auto" }}>{!f.id && q ? <>Total <b className="pf-strong">{rs(q.total)}</b> (VAT {rs(q.vat)} included)</> : ""}</span>
          <Button variant="outline" onClick={() => setF(null)}>Cancel</Button>
          <Button icon={f.id ? "check" : "credit-card"} disabled={busy || !okText || (!f.id && !q)} onClick={send}>{busy ? "Sending…" : f.id ? "Save" : "Make invoice and pay"}</Button></>}>
        <div className="pf-stack">
          {!f.id && <>
            <Field label="How long"><Seg value={f.days} onChange={(v) => set({ days: Number(v) })} options={d.lengths.map((n) => ({ id: n, label: `${n} days` }))} /></Field>
            <Field label="Start" hint="Leave empty for the first free day." optional><Input type="date" min={d.today} value={f.startOn} onChange={(e) => set({ startOn: e.target.value })} /></Field>
            {q && <div className="pf-note"><Icon name="calendar-days" size={16} /><span>{fdate(q.startOn)} to {fdate(q.endOn)}: {q.days} days × {rs(q.price)} = <b>{rs(q.total)}</b>.{q.moved ? " All spots are booked until then, so it starts on the first free day." : ""}</span></div>}
          </>}
          {!f.id && <Field label="What to show"><Seg value={f.mode} onChange={(v) => set({ mode: v })} options={[{ id: "listing", label: "One of my listings" }, { id: "pictures", label: "My own pictures" }]} /></Field>}
          {fromListing ? <>
            {f.id ? <div className="pf-note"><Icon name="house" size={16} /><span>Listing {f.listing.code}: {f.listing.title}</span></div> : !d.choices?.length
              ? <div className="pf-note"><Icon name="circle-alert" size={16} /><span>You have no published listing with photos yet. Publish one first, or use your own pictures.</span></div>
              : <Field label="Listing" hint="Your property, hotel, apartment or project. The banner opens it.">
                  <select className="input" value={f.listingId ?? ""} onChange={(e) => set({ listingId: Number(e.target.value) })}>
                    {d.choices.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.title}</option>)}
                  </select>
                </Field>}
            {(chosen || f.listing) && <div className="pf-banner-prev" aria-label="How it looks">{(chosen || f.listing).photos.slice(0, 5).map((u) => <img key={u} src={u} alt="" />)}</div>}
            <p className="small muted" style={{ margin: 0 }}>The home page shows these photos as a grid, with your title, the price and the place. Nothing to upload.</p>
          </> : <>
            <PicturePick label="Picture for computers" size={d.sizes.desktop} max={d.maxBytes} value={f.desktop} onChange={(v) => set({ desktop: v })} />
            <PicturePick label="Picture for phones" size={d.sizes.mobile} max={d.maxBytes} value={f.mobile} onChange={(v) => set({ mobile: v })} />
            <p className="small muted" style={{ margin: 0 }}>Keep words and logos away from the middle: the title and search box sit there, over a dark shade.</p>
            <Field label="Link" hint="Where people go when they press the button."><Input type="url" placeholder="https://" value={f.link} onChange={(e) => set({ link: e.target.value })} /></Field>
          </>}
          <div className="pf-grid-2 tight">
            <Field label="Title" hint={fromListing ? "Empty: the listing's title" : undefined} optional><Input maxLength={80} value={f.title} onChange={(e) => set({ title: e.target.value })} /></Field>
            <Field label="Button text" hint={fromListing ? "Empty: View" : "Empty: Learn more"} optional><Input maxLength={24} value={f.button} onChange={(e) => set({ button: e.target.value })} /></Field>
          </div>
        </div>
      </Drawer>}
    </>
  );
}
