import React, { useState } from "react";
import { useT } from "@sheetal/shared/core/i18n";
import { useStore } from "@sheetal/shared/core/store";
import { Link, Routes, useRouter } from "@sheetal/shared/core/router";
import { TODAY, fdate, rs, rsShort } from "@sheetal/shared/core/format";
import { Badge, Button, Field, Input, StatusBadge, useToast } from "@sheetal/shared/core/ui";
import PayScreen from "./PayScreen";
import { Icon } from "@sheetal/shared/core/icons";
import { Counter } from "./publicBits";
import { defaultTenantSettings } from "./publicBits";
import { config } from "@sheetal/shared/core/config";
import { inDays, Home as MarketHome, Stays, StayDetail, Projects as MarketProjects, ProjectDetail, Investments, InvestDetail, Partners, Tools, MapPage, RequestPage, OffersPage, HelpPage, LegalPage, SystemPage, MarketHeader, MarketFooter, STAYS, PROJECTS, INVESTS , Crumbs, photoFor } from "./Market";
import { Account as CustomerAccount } from "./Orders";
import { formLink, formsOf } from "@sheetal/shared/core/forms";

// Public side: each business's own site (sheetalproperty.com/site/:id, or book.theirdomain.com),
// listing detail, checkout with the platform's gateways, confirmation and the customer account.
const useL = () => { const t = useT(); return (k, en, v) => { const s = t(k, v); if (s !== k) return s; let o = en; if (v) for (const x in v) o = o.split(`{${x}}`).join(v[x]); return o; }; };
const GW = { fonepay: ["Fonepay QR", "qr-code"], esewa: ["eSewa", "wallet"], khalti: ["Khalti", "wallet"], imepay: ["IME Pay", "wallet"], connectips: ["connectIPS", "landmark"], nps_card: ["Nepali bank card", "credit-card"], visa_mc: ["Visa / Mastercard", "credit-card"], unionpay: ["UnionPay", "credit-card"], paypal: ["PayPal", "globe"], bank: ["Bank transfer", "landmark"], cash: ["Pay on arrival", "banknote"] };
const isStay = (k) => k === "stay_hotel" || k === "stay_unit";
const nights = (a, b) => Math.max(1, Math.round((new Date(b) - new Date(a)) / 864e5));

export default function PublicApp() {
  return <Routes fallback={<SystemPage kind="notfound" />} routes={[
    { path: "/home", render: () => <MarketHome /> },
    { path: "/stays", render: () => <Stays /> }, { path: "/stays/:id", render: ({ id }) => <StayDetail id={id} /> },
    { path: "/project", render: () => <MarketProjects /> }, { path: "/project/:id", render: ({ id }) => <ProjectDetail id={id} /> },
    { path: "/investment", render: () => <Investments /> }, { path: "/investment/:id", render: ({ id }) => <InvestDetail id={id} /> },
    { path: "/partners", render: () => <Partners /> }, { path: "/partners/:id", render: ({ id }) => <Site tid={id} /> },
    { path: "/book/:id", render: ({ id }) => <FlowCheckout kind="stay" id={id} /> },
    { path: "/reserve/:id", render: ({ id }) => <FlowCheckout kind="reserve" id={id} /> },
    { path: "/invest/:id", render: ({ id }) => <FlowCheckout kind="invest" id={id} /> },
    { path: "/offers", render: () => <OffersPage /> }, { path: "/offers/:slug", render: ({ slug }) => <OffersPage slug={slug} /> },
    { path: "/map", render: () => <MapPage /> }, { path: "/explore-map", render: () => <MapPage /> }, { path: "/request", render: () => <RequestPage /> },
    { path: "/saved", render: () => <CustomerAccount start="saved" /> }, { path: "/tools", render: () => <Tools /> },
    { path: "/help/:topic", render: ({ topic }) => <HelpPage topic={topic} /> }, { path: "/legal/:page", render: ({ page }) => <LegalPage page={page} /> },
    { path: "/maintenance", render: () => <SystemPage kind="maintenance" /> }, { path: "/verify-status", render: () => <SystemPage kind="verify" /> },
    { path: "/site", render: () => <SiteIndex /> },
    { path: "/pay/:code", render: ({ code }) => <PayLink code={code} /> },
    { path: "/site/:tid", render: ({ tid }) => <Site tid={tid} /> },
    { path: "/site/:tid/listing/:lid", render: ({ tid, lid }) => <Site tid={tid} lid={lid} /> },
    { path: "/site/:tid/checkout/:lid", render: ({ tid, lid }) => <Site tid={tid} lid={lid} checkout /> },
    { path: "/site/:tid/done/:code", render: ({ tid, code }) => <Site tid={tid} done={code} /> },
    { path: "/account", render: () => <CustomerAccount /> },
  ]} />;
}

function SiteIndex() {
  const { db } = useStore();
  const L = useL();
  return (
    <div className="pb-wrap"><div className="pb-inner pf-stack">
      <h1 className="pb-h1">{L("pub.allSites", "Business sites on Sheetal")}</h1>
      <div className="pb-grid">{db.tenants.filter((x) => x.status === "active").map((x) => <Link key={x.id} to={`/site/${x.id}`} className="card pb-card"><div className="pb-ph"><Icon name="image" size={22} /></div><div className="pb-cbody"><b>{x.name}</b><span className="small muted">{x.city}</span></div></Link>)}</div>
    </div></div>
  );
}

function Header({ tenant, brand }) {
  const L = useL();
  const ts = brand;
  return (<><MarketHeader />
    <div className="pb-head pb-subhead" role="navigation" aria-label="Business">
      <div className="pb-inner pb-head-in">
        <Link to={`/site/${tenant.id}`} className="pb-logo"><span className="pf-ws-logo" style={{ background: ts.branding.color }}>{ts.branding.logoText}</span><b>{tenant.name}</b></Link>
        <nav className="pb-nav"><a href="#contact">{L("pub.contact", "Contact")}</a></nav>
      </div>
    </div></>
  );
}

function Site({ tid, lid, checkout, done }) {
  const { db } = useStore();
  const L = useL();
  const tenant = db.tenants.find((x) => x.id === tid);
  if (!tenant) return <SiteIndex />;
  const ts = db.tenantSettings[tenant.id] || defaultTenantSettings(tenant);
  const listings = db.listings.filter((l) => l.tenantId === tenant.id && l.status === "published");
  const listing = listings.find((l) => l.id === lid);
  return (
    <div className={`pb-wrap${config.embedPublic ? " pb-photos" : ""}`} style={{ "--brand": ts.branding.color }}>
      {done || checkout || listing ? <Header tenant={tenant} brand={ts} /> : <MarketHeader />}
      {done ? <Done tenant={tenant} code={done} /> : checkout && listing ? <Checkout tenant={tenant} listing={listing} ts={ts} /> : listing ? <Detail tenant={tenant} listing={listing} /> : <Home ts={ts} tenant={tenant} listings={listings} />}
      <section className="pb-foot pb-foot-biz" id="contact" aria-label="Contact this business"><div className="pb-inner pb-foot-in">
        <div><b>{tenant.name}</b><span className="small">{ts.profile.address}</span></div>
        <div><span className="small"><Icon name="phone" size={14} /> {ts.profile.phone}</span><span className="small"><Icon name="mail" size={14} /> {ts.profile.email}</span></div>
        {ts.branding.showPoweredBy && <span className="tiny">{L("brand.poweredByText", "Powered by Sheetal")}</span>}
      </div></section>
      <MarketFooter />
    </div>
  );
}

const TYPE_LABEL = { hotel: "Hotel or resort", host: "Host", developer: "Developer", agency: "Agency", sponsor: "Investment sponsor" };
function BizProfile({ tenant, ts }) {
  const L = useL();
  const p = ts.profile; const wa = String(p.phone || "").replace(/\D/g, "");
  return (
    <section className="pb-biz-profile"><div className="pb-inner">
      <Crumbs items={[["/", "Home"], ["/partners", "Partners"], [null, tenant.name]]} />
      <div className="pb-biz-row">
        <span className="pb-biz-logo" style={{ background: ts.branding.color }} aria-hidden="true">{ts.branding.logoText}</span>
        <div className="pf-stack tight" style={{ minWidth: 0 }}>
          <span className="tier">{TYPE_LABEL[tenant.type] || tenant.type}</span>
          <h1 className="pb-biz-name">{p.displayName || tenant.name}</h1>
          <div className="pb-biz-meta"><span><Icon name="star" size={15} /> <b className="tnum">4.7</b> <span className="muted tnum">(212)</span></span><span className="muted"><Icon name="map-pin" size={14} /> {p.address}</span></div>
        </div>
        <div className="pb-biz-contact">
          {p.phone && <a className="btn btn-primary" href={`tel:${p.phone}`}><Icon name="phone" size={15} /> {p.phone}</a>}
          <div className="pb-biz-contact-row">
            {wa && <a className="btn btn-outline" href={`https://wa.me/977${wa.slice(-10)}`} target="_blank" rel="noreferrer"><Icon name="message-circle" size={15} /> WhatsApp</a>}
            {p.email && <a className="btn btn-outline" href={`mailto:${p.email}`}><Icon name="mail" size={15} /> Email</a>}
          </div>
        </div>
      </div>
    </div></section>
  );
}

// Same layout as the agency profile: header row, then About + listings on the left, message form + reviews on the right.
// Reviews come from real customers (reviews module); none yet.
const BIZ_REVIEWS = [];
function Home({ tenant, listings, ts }) {
  const L = useL();
  const toast = useToast();
  const stay = tenant.type === "hotel" || tenant.type === "host";
  const name = ts?.profile?.displayName || tenant.name;
  const about = ts?.profile?.about || (stay ? L("pub.heroStaySub", "Book direct for the best price, free cancellation on most rooms and a reply within the hour.") : L("pub.heroPropSub", "Homes and land with clear papers. Book a visit or reserve online."));
  const [m, setM] = useState({ name: "", phone: "", text: "" });
  const { db } = useStore();
  const forms = formsOf(db, tenant).filter((f) => f.status === "live" && f.places?.profile);
  const send = (e) => { e.preventDefault(); if (!m.name.trim() || m.phone.replace(/\D/g, "").length < 10) { toast("Add your name and a 10-digit phone number"); return; } setM({ name: "", phone: "", text: "" }); toast(`Message sent to ${name}`); };
  return (
    <>
      {ts && <BizProfile tenant={tenant} ts={ts} />}
      <div className="container detail-layout biz-layout">
        <div className="stack" style={{ gap: 48 }}>
          <section><h3 style={{ marginBottom: 12 }}>About {name}</h3><p className="prose">{about}</p></section>
          <section>
            <div className="row between" style={{ marginBottom: 20, alignItems: "baseline" }}>
              <h3>{stay ? L("pub.rooms", "Rooms and stays") : `Listings by ${name}`}</h3>
              {listings.length > 0 && <span className="small muted tnum">{listings.length} {listings.length === 1 ? "listing" : "listings"}</span>}
            </div>
            {listings.length ? <div className="biz-grid">{listings.map((l) => (
              <Link key={l.id} to={fullLink(tenant, l)} className="card pb-card">
                <div className="pb-ph pb-photo"><img src={photoFor(`${l.id}-0`)} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = "none"; }} /></div>
                <div className="pb-cbody"><b>{l.title}</b><span className="small muted">{tenant.city}</span>
                  <span className="pb-price tnum">{isStay(l.kind) ? <>{rs(l.price)}<small> / {L("pub.night", "night")}</small></> : l.kind === "rentout" ? <>{rs(l.price)}<small> / {L("pub.month", "month")}</small></> : rsShort(l.price)}</span></div>
              </Link>
            ))}</div> : <p className="muted">{L("pub.none", "Nothing listed right now.")}</p>}
          </section>
          {forms.length > 0 && <section>
            <h3 style={{ marginBottom: 12 }}>{L("pub.forms", "Forms")}</h3>
            <div className="pb-forms">{forms.map((f) => (
              <a key={f.id} href={formLink(db, tenant, f).local} className="card pb-form">
                <span className="pb-form-ico" style={{ background: f.style?.accent || ts?.branding?.color }}><Icon name="file-text" size={18} /></span>
                <span className="pf-two"><b>{f.title}</b>{f.desc && <small>{f.desc}</small>}</span><Icon name="arrow-right" size={16} />
              </a>
            ))}</div>
          </section>}
        </div>
        <aside className="stack agent-side" style={{ gap: 16 }}>
          <form className="card card-pad stack" onSubmit={send}><h3>Send a message</h3>
            <div className="field"><label>Name</label><input className="input" value={m.name} onChange={(e) => setM({ ...m, name: e.target.value })} /></div>
            <div className="field"><label>Phone</label><input className="input tnum" inputMode="tel" placeholder="98XXXXXXXX" value={m.phone} onChange={(e) => setM({ ...m, phone: e.target.value.replace(/[^\d+ -]/g, "") })} /></div>
            <div className="field"><label>Message</label><textarea className="input" rows={3} value={m.text} onChange={(e) => setM({ ...m, text: e.target.value })} placeholder={stay ? "Dates, guests, questions…" : "Which listing, when you can visit…"} /></div>
            <button className="btn btn-primary btn-block"><Icon name="send" size={16} />Send message</button>
          </form>
          <div className="card card-pad stack agent-reviews"><h3>Client reviews</h3>
            {BIZ_REVIEWS.map(([n, s, r]) => <div key={n} className="stack" style={{ gap: 4 }}><span className="row" style={{ gap: 8 }}><b style={{ color: "var(--text-strong)", fontWeight: 500 }}>{n}</b><span className="small tnum" style={{ color: "var(--c-red)" }}>{"★".repeat(s)}</span></span><span className="small">{r}</span></div>)}
          </div>
        </aside>
      </div>
    </>
  );
}

function Detail({ tenant, listing }) {
  const L = useL();
  const { navigate } = useRouter();
  const stay = isStay(listing.kind);
  const { db } = useStore();
  const lforms = formsOf(db, tenant).filter((f) => f.status === "live" && f.places?.listing);
  const facts = stay ? [["bed-double", "Queen bed"], ["users", "2 guests"], ["wifi", "Wi-Fi"], ["coffee", "Breakfast"], ["mountain", "Mountain view"], ["car", "Parking"]]
    : [["ruler", "8 aana"], ["bed-double", "4 bedrooms"], ["bath", "3 bathrooms"], ["compass", "East facing"], ["route", "13 ft road"], ["file-badge", "Clear lalpurja"]];
  return (
    <section className="pb-inner pb-detail">
      <div className="pb-gallery">{[0, 1, 2, 3, 4].map((i) => <div key={i} className={`pb-ph ${i === 0 ? "big" : ""}`}><Icon name="image" size={i === 0 ? 30 : 18} /></div>)}</div>
      <div className="pb-detail-grid">
        <div className="pf-stack">
          <div><Crumbs items={[["/", "Home"], ["/partners", "Partners"], [`/site/${tenant.id}`, tenant.name], [null, listing.title]]} /><span className="pb-kicker tnum">{listing.id}</span><h1 className="pb-h1" style={{ fontSize: 30 }}>{listing.title}</h1><span className="muted"><Icon name="map-pin" size={14} /> {tenant.city}, Nepal</span></div>
          <div className="pb-facts">{facts.map(([ic, tx]) => <span key={tx}><Icon name={ic} size={18} />{tx}</span>)}</div>
          <p>{stay ? L("pub.aboutStay", "A calm room a short walk from the lake, with a balcony, fast Wi-Fi and breakfast on the terrace. Free airport pickup for stays of three nights or more.") : L("pub.aboutProp", "A well-kept family home on a quiet, blacktopped road with car access to the door. Papers are ready and the owner can arrange a bank loan.")}</p>
          <div className="pf-note"><Icon name="sparkles" size={16} />{L("pub.askAi", "Ask AI about this listing: “Is it good for a family of four?”")}</div>
        </div>
        <aside className="card pb-book">
          <span className="pb-price tnum">{stay ? <>{rs(listing.price)}<small> / {L("pub.night", "night")}</small></> : rsShort(listing.price)}</span>
          <Button block icon={stay ? "calendar-check" : "bookmark"} onClick={() => navigate(`/site/${tenant.id}/checkout/${listing.id}`)}>{stay ? L("pub.book", "Book now") : listing.kind === "rentout" ? L("pub.reserveRent", "Reserve with deposit") : L("pub.reserve", "Reserve with token")}</Button>
          <Button block variant="outline" icon="calendar-days">{L("pub.visit", "Book a visit")}</Button>
          <Button block variant="ghost" icon="message-circle">{L("pub.chat", "Chat on WhatsApp")}</Button>
          {lforms.map((f) => <a key={f.id} className="btn btn-outline btn-block" href={formLink(db, tenant, f).local}><Icon name="file-text" size={16} />{f.title}</a>)}
          <span className="tiny muted" style={{ textAlign: "center" }}>{L("pub.noCharge", "You won't be charged until the next step.")}</span>
        </aside>
      </div>
    </section>
  );
}

function Checkout({ tenant, listing, ts }) {
  const L = useL();
  const { db, update } = useStore();
  const { navigate } = useRouter();
  const stay = isStay(listing.kind);
  const invest = listing.kind === "invest";
  const qs = new URLSearchParams(typeof window !== "undefined" ? (window.location.hash.split("?")[1] || window.location.search || "") : "");
  const gateways = ts.payments.mode === "own" ? Object.entries(ts.payments.own).filter(([, v]) => v.on).map(([k]) => (k === "bankQr" ? "bank" : k)) : Object.keys(GW).filter((k) => db.platformSettings.gateways[k]);
  const rooms = listing.rooms || [];
  const fit = (g, cur) => (rooms.find((x) => x[0] === cur && x[2] >= g) || rooms.find((x) => x[2] >= g) || rooms.find((x) => x[0] === cur) || rooms[0])?.[0] || "";
  const [f, setF] = useState({ from: qs.get("from") || inDays(1), to: qs.get("to") || inDays(3), guests: Number(qs.get("guests")) || 2, room: fit(Number(qs.get("guests")) || 2, qs.get("room")),
    amt: Number(qs.get("amt")) || listing.price, name: "", phone: "", email: "", note: "", idno: "", risk: false, part: stay ? "full" : "token" });
  const [step, setStep] = useState(0);
  const [tried, setTried] = useState(false);
  const room = rooms.find((r) => r[0] === f.room);
  const price = room ? room[1] : listing.price;
  const n = nights(f.from, f.to);
  const base = stay ? price * n : listing.kind === "rentout" ? listing.price * 2 : invest ? f.amt : 200000;
  const tax = stay ? Math.round(base * 0.243) : 0;
  const total = base + tax;
  const due = f.part === "advance" ? Math.round(total * 0.3) : total;
  const steps = stay ? [L("ck.trip", "Your trip"), L("pub.you", "Your details"), L("ck.pay", "Payment")] : invest ? [L("ck.amount", "Amount"), L("ck.kyc", "Details and KYC"), L("ck.pay", "Payment")] : [L("pub.you", "Your details"), L("ck.pay", "Payment")];
  const sDetails = stay || invest ? 1 : 0, sPay = steps.length - 1;
  const nameErr = tried && !f.name.trim() ? L("pub.errName", "Enter the name on your ID") : null;
  const phoneErr = tried && f.phone.replace(/\D/g, "").length < 10 ? L("pub.errPhone", "Enter a 10-digit mobile number") : null;
  const idErr = tried && invest && !f.idno.trim() ? L("ck.errId", "Enter your citizenship or passport number") : null;
  const riskErr = tried && invest && !f.risk ? L("ck.errTick", "Tick this box to continue") : null;
  const amtErr = invest && f.amt < (listing.min || 10000) ? L("ck.minIs", "Minimum is {v}", { v: rs(listing.min || 10000) }) : null;
  const go = (s) => { setStep(s); setTried(false); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const next = () => {
    if (step === sDetails && (!f.name.trim() || f.phone.replace(/\D/g, "").length < 10 || (invest && (!f.idno.trim() || !f.risk)))) { setTried(true); return; }
    if (invest && step === 0 && amtErr) return;
    go(step + 1);
  };
  const pay = (m, off = 0) => {
    const code = `${stay ? "BK" : invest ? "INV" : "RS"}-2027-${String(Math.floor(500 + Math.random() * 400)).padStart(4, "0")}`;
    update((d) => {
      d.customer = d.customer || { orders: [] };
      d.customer.orders.unshift({ code, tid: tenant.id, lid: listing.id, title: listing.title, kind: stay ? "stay" : invest ? "invest" : "reserve", policy: listing.policy, from: stay ? f.from : undefined, to: stay ? f.to : undefined, guests: stay ? f.guests : undefined, room: f.room || undefined, total: total - off, paid: due - off, method: m, status: stay ? "confirmed" : invest ? "invested" : "reserved", at: TODAY.slice(0, 10) });
      if (invest) { d.sector = d.sector || {}; d.sector[tenant.id] = d.sector[tenant.id] || {}; (d.sector[tenant.id].investors = d.sector[tenant.id].investors || []).unshift({ id: code, name: f.name, city: "Online", amount: total, since: TODAY.slice(0, 10), kyc: true }); }
      const o = d.ops?.[tenant.id]; if (stay && o) o.bookings.unshift({ id: code, guest: f.name || "Website guest", phone: f.phone, room: o.rooms[0]?.no, type: f.room || o.rooms[0]?.type, from: f.from, to: f.to, amount: total, paid: due, status: "confirmed", source: "direct" });
    });
    navigate(`/site/${tenant.id}/done/${code}`);
  };
  const dateIn = (k) => <label className="ck-date"><small>{k === "from" ? L("ck.checkIn", "Check in") : L("ck.checkOut", "Check out")}</small><input type="date" className="tnum" min={k === "to" ? f.from : TODAY.slice(0, 10)} value={f[k]}
    onChange={(e) => { const v = e.target.value; if (!v) return; if (k === "from") setF({ ...f, from: v, to: v >= f.to ? new Date(new Date(v).getTime() + 864e5).toISOString().slice(0, 10) : f.to }); else if (v > f.from) setF({ ...f, to: v }); }} /></label>;
  const choice = (on, onClick, title, sub, right) => <button type="button" role="radio" aria-checked={on} className={`ck-choice ${on ? "on" : ""}`} onClick={onClick}><i className="pay-dot" aria-hidden="true" /><span className="pf-two"><b>{title}</b>{sub && <small>{sub}</small>}</span>{right != null && <b className="tnum">{right}</b>}</button>;
  return (
    <section className="pb-inner ck">
      <div className="ck-head">
        <Link to={listing.back || `/site/${tenant.id}`} className="ck-back"><Icon name="arrow-left" size={16} />{listing.title}</Link>
        <h1 className="pb-h1">{stay ? L("pub.confirmStay", "Confirm your stay") : invest ? L("pub.investIn", "Invest in {name}", { name: listing.title }) : L("pub.confirmRes", "Reserve this property")}</h1>
        <ol className="ck-steps">{steps.map((s, i) => <li key={s} className={i < step ? "done" : i === step ? "on" : ""}><button type="button" disabled={i >= step} onClick={() => go(i)}><span className="tnum">{i < step ? <Icon name="check" size={13} /> : i + 1}</span>{s}</button></li>)}</ol>
      </div>
      <div className="ck-grid">
        <div className="ck-main">
          {stay && step === 0 && <div className="card ck-card">
            <h2 className="ck-h">{L("pub.when", "When")}</h2>
            <div className="ck-dates">{dateIn("from")}{dateIn("to")}</div>
            <span className="small muted tnum">{n} {L("pub.nights", "nights")} · {L("ck.times", "check-in after 14:00, check-out by 11:00")}</span>
            <h2 className="ck-h">{L("room.guests", "Guests")}</h2>
            <div className="ck-row"><span className="pf-two"><b>{f.guests} {L("pub.guests", "guests")}</b><small>{room ? L("ck.fits", "This room fits up to {n}", { n: room[2] }) : L("ck.kids", "Children count as guests")}</small></span><Counter value={f.guests} min={1} max={12} onChange={(v) => setF({ ...f, guests: v, room: fit(v, f.room) })} label="guests" /></div>
            {room && f.guests > room[2] && <span className="pf-error"><Icon name="circle-alert" size={13} />{L("ck.tooMany", "Too many guests for this room. Pick a bigger room below.")}</span>}
            {rooms.length > 0 && <><h2 className="ck-h">{L("ck.room", "Room")}</h2><div className="ck-choices" role="radiogroup">{rooms.map(([rn, rp, rg]) => choice(f.room === rn, () => setF({ ...f, room: rn }), rn, L("ck.upTo", "Up to {n} guests", { n: rg }), <>{rs(rp)}<small className="muted"> / {L("pub.night", "night")}</small></>))}</div></>}
            <h2 className="ck-h">{L("ck.howMuch", "How much to pay now")}</h2>
            <div className="ck-choices" role="radiogroup">
              {choice(f.part === "full", () => setF({ ...f, part: "full" }), L("pub.payFull", "Pay in full"), L("ck.nothingLater", "Nothing to pay at the property"), rs(total))}
              {choice(f.part === "advance", () => setF({ ...f, part: "advance" }), L("ck.pay30", "Pay 30% now"), L("ck.atCheckin", "{v} at check-in", { v: rs(total - Math.round(total * 0.3)) }), rs(Math.round(total * 0.3)))}
            </div>
          </div>}
          {invest && step === 0 && <div className="card ck-card">
            <h2 className="ck-h">{L("ck.howMuchInvest", "How much do you want to invest?")}</h2>
            <div className="ck-amt"><span>Rs.</span><input className="tnum" inputMode="numeric" value={f.amt ? f.amt.toLocaleString("en-IN") : ""} onChange={(e) => setF({ ...f, amt: Number(e.target.value.replace(/\D/g, "")) || 0 })} aria-label="Amount" /></div>
            <div className="pf-chips">{[10000, 50000, 100000, 500000].map((v) => <button key={v} type="button" className={`chip ${f.amt === v ? "active" : ""}`} onClick={() => setF({ ...f, amt: v })}>{rs(v)}</button>)}</div>
            {amtErr ? <span className="pf-error"><Icon name="circle-alert" size={13} />{amtErr}</span> : <span className="small muted">{L("ck.investNote", "Returns are estimates and never guaranteed. You have 7 days to change your mind.")}</span>}
          </div>}
          {step === sDetails && <div className="card ck-card">
            <h2 className="ck-h">{L("pub.you", "Your details")}</h2>
            <div className="pf-grid-2 tight"><Field label={L("iv.name", "Full name")} error={nameErr}><Input id="pb-name" autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={L("ck.asOnId", "As on your ID")} /></Field>
              <Field label={L("common.phone", "Phone")} error={phoneErr}><Input className="input tnum" inputMode="tel" autoComplete="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value.replace(/[०-९]/g, (c) => "०१२३४५६७८९".indexOf(c)).replace(/[^\d+ -]/g, "") })} placeholder="98XXXXXXXX" /></Field></div>
            <Field label={L("common.email", "Email")} optional><Input type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder={L("ck.forReceipt", "For your receipt")} /></Field>
            {stay && <Field label={L("ck.msgHost", "Message to the host")} optional><textarea className="input" rows={3} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder={L("ck.msgPh", "Arrival time, airport pickup, extra bed…")} /></Field>}
            {invest && <><h2 className="ck-h">{L("pub.kyc", "Investor check (KYC)")}</h2>
              <Field label={L("pub.citizenship", "Citizenship or passport no.")} error={idErr}><Input className="input tnum" value={f.idno} onChange={(e) => setF({ ...f, idno: e.target.value })} /></Field>
              <label className="check small"><input type="checkbox" checked={f.risk} onChange={(e) => setF({ ...f, risk: e.target.checked })} />{L("pub.riskOk", "I have read the risks. Returns are not guaranteed and I may lose money.")}</label>
              {riskErr && <span className="pf-error"><Icon name="circle-alert" size={13} />{riskErr}</span>}</>}
          </div>}
          {step === sPay && <div className="card ck-card">
            <h2 className="ck-h">{L("pub.payHow", "How would you like to pay?")}</h2>
            <PayScreen embedded purpose={stay ? `Stay booking, ${fdate(f.from)} to ${fdate(f.to)}` : invest ? `Investment in ${listing.title}` : `Reservation token, ${listing.title}`} total={due}
              onPaid={({ method, off }) => setTimeout(() => pay(method, off), 900)} onBack={() => go(step - 1)} />
          </div>}
          {step < sPay && <div className="ck-actions">
            {step > 0 ? <Button variant="ghost" icon="arrow-left" onClick={() => go(step - 1)}>{L("common.back", "Back")}</Button> : <span />}
            <Button onClick={next} disabled={stay && room && f.guests > room[2]}>{step === sPay - 1 ? L("ck.toPay", "Continue to payment · {v}", { v: rs(due) }) : L("common.continue", "Continue")}<Icon name="arrow-right" size={16} /></Button>
          </div>}
        </div>
        <aside className="card ck-sum">
          <div className="ck-sum-top">
            <div className="ck-photo"><img src={photoFor(`${listing.photo || listing.id}-0`)} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} /></div>
            <span className="pf-two"><small>{listing.sub || tenant.name}</small><b>{listing.title}</b></span>
          </div>
          {stay && <dl className="ck-kv">
            <dt>{L("room.stay", "Dates")}</dt><dd className="tnum">{fdate(f.from)} – {fdate(f.to)}{step > 0 && <button type="button" className="link" onClick={() => go(0)}>{L("ck.change", "Change")}</button>}</dd>
            <dt>{L("room.guests", "Guests")}</dt><dd className="tnum">{f.guests}{room ? ` · ${room[0]}` : ""}</dd>
          </dl>}
          {f.name && step > sDetails - 0 && <dl className="ck-kv"><dt>{L("iv.name", "Full name")}</dt><dd>{f.name}</dd><dt>{L("common.phone", "Phone")}</dt><dd className="tnum">{f.phone}</dd></dl>}
          <div className="pf-totals">
            <div><span className="tnum">{stay ? `${rs(price)} × ${n} ${n === 1 ? "night" : "nights"}` : listing.kind === "rentout" ? L("pub.deposit2", "Deposit (2 months)") : invest ? L("pub.investAmt", "Investment amount") : L("pub.token", "Token amount")}</span><span className="tnum">{rs(base)}</span></div>
            {stay && <div><span>{L("pub.taxes", "Service charge and VAT")}</span><span className="tnum">{rs(tax)}</span></div>}
            <div className="total"><span>{L("pos.total", "Total")}</span><span className="tnum">{rs(total)}</span></div>
            {due !== total && <><div><span>{L("pub.payNow", "Pay now")}</span><b className="tnum">{rs(due)}</b></div><div><span className="muted">{L("ck.atCheckinShort", "At check-in")}</span><span className="tnum muted">{rs(total - due)}</span></div></>}
          </div>
          <div className="ck-policy"><Icon name={invest ? "info" : "calendar-check"} size={16} /><span className="small">{stay ? L("pub.cancel", "Free cancellation until 48 hours before check-in.") : invest ? L("pub.cooling", "You can cancel within 7 days for a full refund.") : L("pub.tokenNote", "Token is refundable for 7 days if the papers don't check out.")}</span></div>
          <span className="tiny muted ck-trust"><Icon name="shield-check" size={13} />{L("ck.trust", "Paid through Nepal-licensed providers.")}</span>
        </aside>
      </div>
    </section>
  );
}

function Done({ tenant, code }) {
  const L = useL();
  const { db } = useStore();
  const o = db.customer?.orders.find((x) => x.code === code);
  const next = o?.kind === "stay" ? [L("ck.n1", "Show this code at check-in"), L("ck.n2", "{name} may call to confirm your arrival time", { name: tenant.name }), L("ck.n3", "Free cancellation until 48 hours before check-in, from My account")]
    : o?.kind === "invest" ? [L("ck.i1", "We check your KYC within one working day"), L("ck.i2", "Your investment agreement arrives by email to sign"), L("ck.i3", "You can cancel within 7 days for a full refund")]
    : [L("ck.r1", "The seller confirms your reservation within 24 hours"), L("ck.r2", "Visit and check the papers"), L("ck.r3", "Token is refundable for 7 days if the papers don't check out")];
  return (
    <section className="pb-inner pb-done ck-done">
      <span className="ck-done-ico"><Icon name="circle-check" size={34} /></span>
      <h1 className="pb-h1">{L("pub.doneTitle", "You're all set")}</h1>
      <p className="pb-lead">{L("pub.doneText", "We've sent the details to your phone. {name} will be in touch if anything is needed.", { name: tenant.name })}</p>
      {o && <div className="card ck-receipt">
        <div className="ck-receipt-code"><small>{L("ck.code", "Booking code")}</small><b className="tnum">{o.code}</b></div>
        <dl className="ck-kv">
          <dt>{L("listings.listing", "Listing")}</dt><dd>{o.title}</dd>
          {o.from && <><dt>{L("room.stay", "Dates")}</dt><dd className="tnum">{fdate(o.from)} – {fdate(o.to)}</dd></>}
          {o.guests && <><dt>{L("room.guests", "Guests")}</dt><dd className="tnum">{o.guests}{o.room ? ` · ${o.room}` : ""}</dd></>}
          <dt>{L("pub.paid", "Paid")}</dt><dd className="tnum">{rs(o.paid)} · {GW[o.method]?.[0] || o.method}</dd>
          {o.paid < o.total && <><dt>{L("pub.balance", "Balance")}</dt><dd className="tnum">{rs(o.total - o.paid)}</dd></>}
        </dl>
        <div className="ck-next"><b className="small">{L("ck.next", "What happens next")}</b><ol>{next.map((x) => <li key={x} className="small">{x}</li>)}</ol></div>
      </div>}
      <div className="pf-row-actions" style={{ justifyContent: "center" }}><Button variant="outline" icon="download">{L("pub.receipt", "Receipt")}</Button><Link to="/account" className="btn btn-primary"><Icon name="user" size={16} />{L("pub.account", "My account")}</Link></div>
    </section>
  );
}

export { StatusBadge };

// /book/:stayId, /reserve/:projectId-unit, /invest/:id all use the same checkout
function FlowCheckout({ kind, id }) {
  const { db } = useStore();
  let tid, listing;
  if (kind === "stay") { const s = STAYS.find((x) => x.id === id) || STAYS[0]; tid = s.tid; listing = { id: s.id, title: s.name, price: s.price, kind: "stay_hotel", policy: s.policy, rooms: s.rooms, back: `/stays/${s.id}`, sub: `${s.area}, ${s.city} · ★ ${s.rating}` }; }
  else if (kind === "invest") { const v = INVESTS.find((x) => x.id === id) || INVESTS[0]; tid = v.tid; listing = { id: v.id, title: v.name, price: 100000, kind: "invest", min: v.min, back: `/investment/${v.id}`, sub: `${v.type} · ${v.city} · ${v.ret} a year expected` }; }
  else { const p = PROJECTS.find((x) => id.startsWith(x.id)) || PROJECTS[0]; tid = p.tid; listing = { id, photo: p.id, title: `${p.name} · unit ${id.replace(p.id + "-", "")}`, price: p.from, kind: "project", back: `/project/${p.id}`, sub: `${p.area}, ${p.city}` }; }
  const tenant = db.tenants.find((x) => x.id === tid);
  const ts = db.tenantSettings[tid] || defaultTenantSettings(tenant);
  return <div className={`pb-wrap${config.embedPublic ? " pb-photos" : ""}`}><MarketHeader /><Checkout key={`${kind}-${id}`} tenant={tenant} listing={listing} ts={ts} /><MarketFooter /></div>;
}

// Stays and projects open their full marketplace page; other listings use the site's detail page.
function fullLink(tenant, l) {
  const s = isStay(l.kind) && STAYS.find((x) => x.tid === tenant.id);
  if (s) return `/stays/${s.id}`;
  const pr = l.kind === "project" && PROJECTS.find((x) => x.tid === tenant.id);
  if (pr) return `/project/${pr.id}`;
  return `/site/${tenant.id}/listing/${l.id}`;
}

// Pay link (/pay/:code): opened from an SMS, email or QR sent by staff or a business — instalments, service fees, balances.
function PayLink({ code }) {
  const { db, update } = useStore();
  // Pay links are created by staff or a business (payments module); the code must match one of them.
  const inv = db.payLinks?.[code.toUpperCase()];
  const total = (inv?.lines || []).reduce((s, [, v]) => s + v, 0);
  const [done, setDone] = useState(null);
  if (!inv) return (
    <div className={`pb-wrap${config.embedPublic ? " pb-photos" : ""}`}><MarketHeader />
      <section className="pb-inner" style={{ padding: "56px 24px", maxWidth: 640, textAlign: "center" }}>
        <h1 className="pb-h1" style={{ fontSize: 26 }}>This payment link isn't valid</h1>
        <p className="muted">It may have expired or already been paid. Please ask the business for a new link.</p>
      </section><MarketFooter /></div>
  );
  return (
    <div className={`pb-wrap${config.embedPublic ? " pb-photos" : ""}`}><MarketHeader />
      <section className="pb-inner" style={{ padding: "32px 24px 56px", maxWidth: 640 }}>
        <div className="card pf-pad pf-stack">
          <div className="pf-plan-top"><span className="pf-two"><b>{inv.from}</b><small className="tnum">Invoice {inv.code} · due {fdate(inv.due)}</small></span>{done ? <Badge tone={done === "paid" ? "done" : "progress"}>{done === "paid" ? "Paid" : "Pending verification"}</Badge> : <Badge tone="action">Unpaid</Badge>}</div>
          <PayScreen purpose={inv.purpose} lines={inv.lines} total={total} allowCoupon={false}
            onPaid={({ method, status, due }) => { setDone(status); update((d) => { d.customer = d.customer || { orders: [] }; d.customer.orders.unshift({ code: inv.code, tid: inv.tid, title: inv.purpose, kind: "invoice", total, paid: due, method, status: status === "paid" ? "paid" : "pending_verification", at: TODAY.slice(0, 10) }); }); }} />
        </div>
      </section><MarketFooter /></div>
  );
}
