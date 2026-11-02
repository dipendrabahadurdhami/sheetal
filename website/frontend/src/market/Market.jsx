import React, { useEffect, useState } from "react";
import { api } from "../api/endpoints";
import { isLivePath, toList } from "../api/client";
import { useT } from "@sheetal/shared/core/i18n";
import { useStore } from "@sheetal/shared/core/store";
import { Link, useRouter } from "@sheetal/shared/core/router";
import { TODAY, fdate, inDays, rs, rsShort } from "@sheetal/shared/core/format";
export { inDays };
import { Badge, Button, Drawer, Field, Input, Seg, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { Counter } from "./publicBits";
import { BUSINESS_TYPES } from "@sheetal/shared/core/rbac";
import { config } from "@sheetal/shared/core/config";
import { ExactMap } from "../components/LocationMap";

export function Crumbs({ items }) {
  return <nav className="pb-crumbs" aria-label="Breadcrumb"><ol>{items.map(([to, l], i) => <li key={l}>{i < items.length - 1 && to ? <Link to={to}>{l}</Link> : <span aria-current="page">{l}</span>}</li>)}</ol></nav>;
}

// Marketplace pages from the master prompt §5–7, §18, §19, §29: home with search tabs, stays, projects,
// investments, partners, saved, compare and tools. Shared demo catalogue below.
export const useL = () => { const t = useT(); return (k, en, v) => { const s = t(k, v); if (s !== k) return s; let o = en; if (v) for (const x in v) o = o.split(`{${x}}`).join(v[x]); return o; }; };
export const STAYS = [];
export const PROJECTS = [];
export const INVESTS = [];
// Live catalogue: every published stay, project and investment from business workspaces.
// Stays, projects and investments from the website API: loaded once per visit, shared by every page that asks.
// They are listings (often a sale or rent), so their cards open the full property page and show the real price.
let fromApi = null;
const apiListeners = new Set();
function loadFromApi() {
  if (fromApi || !isLivePath("stays")) return;
  fromApi = { stays: [], projects: [], invests: [] };
  const base = (p) => ({ id: `L${p.id}`, href: p.link, tid: p.agent_id, name: p.name, city: p.district, area: p.property_location, img: p.thumbnail || p.feature_image, deal: p.purpose === "Rent" ? "rent" : "sale", price: p.total_price, lat: p.lat, lng: p.lng, live: true });
  Promise.all(["stays", "projects", "investments"].map((k) => api.kindList(k).then(toList).then((r) => r.items).catch(() => [])))
    .then(([stays, projects, invests]) => {
      fromApi = {
        // A stay is priced by the night.
        stays: stays.map((p) => ({ ...base(p), deal: "night", kind: "hotel", stars: 0, rating: 0, reviews: 0, perks: [], rooms: [], policy: "moderate" })),
        projects: projects.map((p) => ({ ...base(p), type: p.category, status: p.purpose === "Rent" ? "For rent" : "For sale", from: p.total_price, banks: [] })),
        invests: invests.map((p) => ({ ...base(p), type: p.category, target: p.total_price || 0, raised: 0, investors: 0 })),
      };
      apiListeners.forEach((fn) => fn(fromApi));
    });
}
function useFromApi() {
  const [v, setV] = useState(fromApi);
  useEffect(() => { apiListeners.add(setV); loadFromApi(); if (fromApi !== v) setV(fromApi); return () => apiListeners.delete(setV); }, []);
  return v || { stays: [], projects: [], invests: [] };
}
const dealPrice = (x) => <span className="pb-price tnum">{rsShort(x.price)}<small>{{ night: " / night", rent: " / month" }[x.deal] ?? " · for sale"}</small></span>;

export function useCatalog() {
  const { db } = useStore();
  const live = useFromApi();
  const ten = (id) => db.tenants.find((x) => x.id === id) || {};
  const extra = db.listings.filter((l) => l.status === "published");
  const stays = [...STAYS, ...extra.filter((l) => l.kind === "stay_hotel" || l.kind === "stay_unit").map((l) => ({ id: l.id, tid: l.tenantId, kind: l.kind === "stay_hotel" ? "hotel" : "villa", name: l.title, city: ten(l.tenantId).city, area: ten(l.tenantId).city, stars: 0, rating: 5, reviews: 0, price: l.price, perks: ["New on Sheetal", "Free Wi-Fi"], rooms: [["Standard", l.price, 2]], policy: "moderate", lat: l.values?.pin?.lat, lng: l.values?.pin?.lng }))];
  const projects = [...PROJECTS, ...extra.filter((l) => l.kind === "project").map((l) => ({ id: l.id, tid: l.tenantId, name: l.title, type: "Project", city: ten(l.tenantId).city, area: ten(l.tenantId).city, status: "Under construction", possession: "2028", units: 40, left: 40, towers: 1, floors: 8, from: l.price, progress: 10, banks: [] }))];
  const invests = [...INVESTS, ...extra.filter((l) => l.kind === "invest").map((l) => ({ id: l.id, tid: l.tenantId, name: l.title, type: "Project", city: ten(l.tenantId).city, target: l.price || 10000000, raised: 0, investors: 0, min: 10000, ret: "10–12%", term: "3 years", payout: "Every year", closes: l.values?.closes || null, risk: "medium" }))];
  return { stays: [...stays, ...live.stays], projects: [...projects, ...live.projects], invests: [...invests, ...live.invests] };
}
const PHOTOS = [1, 2, 3, 4, 5, 6, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
const photoFor = (seed) => { const s = String(seed); let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return `/demo/${PHOTOS[h % PHOTOS.length]}.jpg`; };
const IMG = ({ big, label, seed, src }) => src || seed != null
  ? <div className={`pb-ph pb-photo ${big ? "big" : ""}`}><img src={src || photoFor(seed)} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = "none"; }} />{label && <span>{label}</span>}</div>
  : <div className={`pb-ph ${big ? "big" : ""}`}><Icon name="image" size={big ? 30 : 18} />{label && <span>{label}</span>}</div>;
const useSaved = () => {
  const { db, update } = useStore();
  const saved = db.customer?.saved || [];
  const toggle = (type, id) => update((d) => { d.customer = d.customer || { orders: [] }; const s = d.customer.saved || []; const k = `${type}:${id}`; d.customer.saved = s.includes(k) ? s.filter((x) => x !== k) : [...s, k]; });
  return [saved, toggle];
};
const Heart = ({ type, id }) => { const [s, toggle] = useSaved(); const on = s.includes(`${type}:${id}`); return <button className={`pb-heart ${on ? "on" : ""}`} aria-pressed={on} aria-label="Save" onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(type, id); }}><Icon name="heart" size={18} /></button>; };
const TypeTag = ({ children }) => <span className="tag tag-white pb-typetag">{children}</span>;

export function MarketHeader() {
  const L = useL();
  if (config.embedPublic) return null;
  return (
    <header className="pb-head"><div className="pb-inner pb-head-in">
      <Link to="/home" className="pb-logo"><b>SHEETAL</b></Link>
      <nav className="pb-nav">
        <Link to="/stays"><Icon name="bed-double" size={16} />{L("mk.stay", "Stay")}</Link><Link to="/project"><Icon name="building-2" size={16} />{L("mk.projects", "Projects")}</Link>
        <Link to="/investment"><Icon name="chart-pie" size={16} />{L("mk.invest", "Invest")}</Link><Link to="/partners"><Icon name="briefcase" size={16} />{L("mk.partners", "Partners")}</Link><Link to="/map"><Icon name="map" size={16} />{L("mk.map", "Map")}</Link><Link to="/request"><Icon name="clipboard-list" size={16} />{L("mk.request", "Post a request")}</Link>
        <Link to="/saved"><Icon name="heart" size={16} />{L("mk.saved", "Saved")}</Link><Link to="/account"><Icon name="user" size={16} />{L("pub.account", "My account")}</Link>
      </nav>
    </div></header>
  );
}
export function MarketFooter() {
  const L = useL();
  if (config.embedPublic) return null;
  const cols = [["mk.stay", "Stay", [["/stays", "Hotels and resorts"], ["/stays?t=villa", "Villas and apartments"]]], ["mk.projects", "Projects", [["/project", "All projects"], ["/tools", "EMI calculator"]]], ["mk.invest", "Invest", [["/investment", "Open investments"], ["/help/investing", "How investing works"]]], ["mk.help", "Help", [["/help/booking", "How booking works"], ["/help/cancellation", "Cancellation and refunds"], ["/help/house-rules", "House rules"], ["/help/contact", "Contact"]]], ["mk.legal", "Legal", [["/legal/terms", "Terms"], ["/legal/privacy", "Privacy"], ["/legal/cookies", "Cookies"]]]];
  return <footer className="pb-foot"><div className="pb-inner pb-foot-grid">{cols.map(([k, en, links]) => <div key={k}><b>{L(k, en)}</b>{links.map(([to, l]) => <Link key={to} to={to} className="small">{l}</Link>)}</div>)}</div></footer>;
}
export const Page = ({ children, title }) => {
  const photos = config.embedPublic ? " pb-photos" : "";
  React.useEffect(() => { document.title = title ? `${title} · Sheetal` : "Sheetal Property · Buy, rent, stay, invest in Nepal"; }, [title]);
  return <div className={`pb-wrap${photos}`}><MarketHeader />{children}<MarketFooter /></div>;
};

const Missing = ({ what, to, label }) => <Page title={`${what} not found`}><section className="pb-inner pf-stack" style={{ padding: "56px 24px", alignItems: "center", textAlign: "center" }}><h1 className="pb-h1" style={{ fontSize: 28 }}>{what} not found</h1><p className="muted">It may have been removed, or it isn't published yet.</p><Link to={to} className="btn btn-outline">{label}</Link></section></Page>;

/* Home with search tabs (§6) */
export function Home() {
  const L = useL();
  const { navigate } = useRouter();
  const [tab, setTab] = useState("stay");
  const [q, setQ] = useState({ where: "", from: inDays(7), to: inDays(10), guests: 2, budget: "1cr" });
  const go = () => navigate(tab === "stay" ? "/stays" : tab === "project" ? "/project" : tab === "invest" ? "/investment" : "/partners");
  return (
    <Page>
      <section className="pb-hero"><div className="pb-inner pf-stack">
        <h1 className="pb-h1">{L("mk.heroTitle", "Buy, rent, stay or invest in Nepal")}</h1>
        <div className="card pb-search">
          <div className="seg pb-search-tabs" role="tablist">{[["buy", "Buy"], ["rent", "Rent"], ["stay", "Stay"], ["project", "Projects"], ["invest", "Invest"]].map(([id, l]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>{L(`mk.t_${id}`, l)}</button>)}</div>
          <div className="pb-search-row">
            <Field label={L("mk.where", "Where")}><Input value={q.where} onChange={(e) => setQ({ ...q, where: e.target.value })} /></Field>
            {tab === "stay" ? <><Field label={L("mk.dates", "Dates")}><div className="input pf-static tnum">{fdate(q.from)} – {fdate(q.to)}</div></Field><Field label={L("pub.guests", "Guests")}><Counter value={q.guests} min={1} max={12} onChange={(v) => setQ({ ...q, guests: v })} label="guests" /></Field></>
              : <Field label={L("gl.budget", "Budget")}><Seg value={q.budget} onChange={(v) => setQ({ ...q, budget: v })} options={[["50l", "50 Lakh"], ["1cr", "1 Cr"], ["3cr", "3 Cr+"]].map(([id, l]) => ({ id, label: l }))} /></Field>}
            <Button icon="search" onClick={go}>{L("mk.search", "Search")}</Button>
          </div>
        </div>
      </div></section>
      <Row title={L("mk.popularStays", "Popular stays")} to="/stays">{useCatalog().stays.slice(0, 4).map((s) => <StayCard key={s.id} s={s} />)}</Row>
      <Row title={L("mk.featuredProjects", "Featured projects")} to="/project">{useCatalog().projects.map((p) => <ProjectCard key={p.id} p={p} />)}</Row>
      <Row title={L("mk.openInvest", "Open investments")} to="/investment">{useCatalog().invests.map((v) => <InvestCard key={v.id} v={v} />)}</Row>
    </Page>
  );
}
const Row = ({ title, to, children }) => <section className="pb-inner pf-stack" style={{ padding: "32px 24px 0" }}><div className="pf-plan-top"><h2 className="pb-h2">{title}</h2><Link to={to} className="link small">See all</Link></div><div className="pb-grid">{children}</div></section>;
export const StayCard = ({ s }) => <Link to={s.href || `/stays/${s.id}`} className="card pb-card"><div className="pb-cimg"><IMG seed={s.id} src={s.img} /><TypeTag>{s.kind === "hotel" || s.kind === "resort" ? "Hotel" : "Villa"}</TypeTag><Heart type="stay" id={s.id} /></div><div className="pb-cbody"><b>{s.name}</b><span className="small muted">{s.area}, {s.city}{s.rating ? ` · ★ ${s.rating}` : ""}</span>{s.deal ? dealPrice(s) : <span className="pb-price tnum">{rs(s.price)}<small> / night</small></span>}</div></Link>;
export const ProjectCard = ({ p }) => <Link to={p.href || `/project/${p.id}`} className="card pb-card"><div className="pb-cimg"><IMG seed={p.id} src={p.img} /><TypeTag>Project</TypeTag><Heart type="project" id={p.id} /></div><div className="pb-cbody"><b>{p.name}</b><span className="small muted">{p.area}, {p.city} · {p.status}</span>{p.deal ? dealPrice(p) : <span className="pb-price tnum"><small>Starting from </small>{rsShort(p.from)}</span>}</div></Link>;
export const InvestCard = ({ v }) => <Link to={v.href || `/investment/${v.id}`} className="card pb-card"><div className="pb-cimg"><IMG seed={v.id} src={v.img} /><TypeTag>Invest</TypeTag><Heart type="invest" id={v.id} /></div><div className="pb-cbody"><b>{v.name}</b><span className="small muted">{v.type} · {v.city}</span>{v.deal ? dealPrice(v) : <><div className="bar" style={{ height: 6, marginTop: 6 }}><i style={{ width: `${(v.raised / v.target) * 100}%` }} /></div><span className="small tnum">{rsShort(v.raised)} of {rsShort(v.target)} · {v.ret} expected, not guaranteed</span></>}</div></Link>;

/* Stays list + detail (§7.3, §7.4, §23.1) */
export function Stays() {
  const L = useL();
  const q = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const { stays } = useCatalog();
  const [f, setF] = useState({ where: q.get("where") || "", type: q.get("type") || "", max: 0, rating: 0, perks: [], sort: "best", view: "grid" });
  const from = q.get("from"), to = q.get("to"), guests = q.get("guests");
  const nightsN = from && to ? Math.max(1, Math.round((new Date(to) - new Date(from)) / 864e5)) : 0;
  const TYPES = ["Hotel", "Resort", "Villa", "Apartment", "Homestay"];
  const PERKS = ["Free breakfast", "Lake view", "Mountain view", "Pool", "Wi-Fi", "Kitchen", "Airport pickup"];
  const list = stays.filter((s) => (!f.where || `${s.city} ${s.area}`.toLowerCase().includes(f.where.toLowerCase()))
    && (!f.type || s.kind === f.type.toLowerCase() || (f.type === "Homestay" && s.kind === "villa"))
    && (!f.max || s.price <= f.max) && s.rating >= f.rating && f.perks.every((p) => s.perks.some((x) => x.toLowerCase().includes(p.toLowerCase().split(" ")[0]))))
    .sort((a, b) => (f.sort === "price" ? a.price - b.price : f.sort === "rating" ? b.rating - a.rating : b.reviews - a.reviews));
  const set = (k, v) => setF({ ...f, [k]: v });
  return (
    <Page title="Stays"><section className="pb-inner pf-stack" style={{ padding: "28px 24px" }}>
      <div className="pf-plan-top"><h1 className="pb-h1" style={{ fontSize: 30 }}>{list.length} {list.length === 1 ? "stay" : "stays"}{f.where ? ` in ${f.where}` : " in Nepal"}</h1>
        <div className="pf-row-actions"><Seg value={f.view} onChange={(v) => set("view", v)} options={[{ id: "grid", label: "Grid" }, { id: "list", label: "List" }]} /><Link to="/explore-map" className="btn btn-outline btn-sm"><Icon name="map" size={15} />Map</Link></div></div>
      {nightsN > 0 && <div className="pf-note"><Icon name="calendar-days" size={16} />{fdate(from)} – {fdate(to)} · {nightsN} nights{guests ? ` · ${guests} guests` : ""}. Prices below are per night.</div>}
      <div className="pb-stays">
        <aside className="card pf-pad pf-stack pb-filters">
          <Field label={L("mk.where", "Where")}><Input value={f.where} onChange={(e) => set("where", e.target.value)} placeholder="City or area" /></Field>
          <Field label="Type"><div className="pf-chips">{["", ...TYPES].map((t) => <button key={t || "all"} className={`chip ${f.type === t ? "active" : ""}`} onClick={() => set("type", t)}>{t || "All"}</button>)}</div></Field>
          <Field label={L("mk.pricePerNight", "Price per night")}><div className="pf-chips">{[[0, "Any"], [5000, "Up to Rs. 5,000"], [8000, "Up to Rs. 8,000"], [12000, "Up to Rs. 12,000"]].map(([v, l]) => <button key={v} className={`chip ${f.max === v ? "active" : ""}`} onClick={() => set("max", v)}>{l}</button>)}</div></Field>
          <Field label={L("mk.rating", "Guest rating")}><div className="pf-chips">{[[0, "Any"], [4.5, "4.5+"], [4.7, "4.7+"]].map(([v, l]) => <button key={v} className={`chip ${f.rating === v ? "active" : ""}`} onClick={() => set("rating", v)}>{l}</button>)}</div></Field>
          <Field label={L("mk.amenities", "Amenities")}><div className="pf-chips">{PERKS.map((p) => { const on = f.perks.includes(p); return <button key={p} className={`chip ${on ? "active" : ""}`} onClick={() => set("perks", on ? f.perks.filter((x) => x !== p) : [...f.perks, p])}>{p}</button>; })}</div></Field>
          <Field label="Sort"><Seg value={f.sort} onChange={(v) => set("sort", v)} options={[{ id: "best", label: "Popular" }, { id: "price", label: "Price" }, { id: "rating", label: "Rating" }]} /></Field>
          <Button variant="ghost" size="sm" onClick={() => setF({ ...f, where: "", type: "", max: 0, rating: 0, perks: [] })}>{L("mk.clear", "Clear filters")}</Button>
        </aside>
        <div>{list.length ? (f.view === "grid" ? <div className="pb-grid pb-grid-3">{list.map((s) => <StayCard key={s.id} s={s} />)}</div>
          : <div className="pf-stack">{list.map((s) => <Link key={s.id} to={`/stays/${s.id}`} className="card pf-pad pb-order"><IMG seed={s.id} /><div className="pf-two" style={{ flex: 1 }}><b>{s.name}</b><small>{s.area}, {s.city} · ★ {s.rating} · {s.perks.slice(0, 3).join(" · ")}</small></div><span className="pb-price tnum">{rs(s.price)}<small> / night</small></span></Link>)}</div>)
          : <div className="pf-empty"><Icon name="search" size={36} /><h3>No stays match</h3><p>Try fewer filters or another place.</p></div>}</div>
      </div>
    </section></Page>
  );
}
export function StayDetail({ id }) {
  const s = useCatalog().stays.find((x) => x.id === id);
  return s ? <StayView s={s} /> : <Missing what="Stay" to="/stays" label="See all stays" />;
}

function StayView({ s }) {
  const L = useL();
  const { navigate } = useRouter();
  const hotel = s.kind === "hotel" || s.kind === "resort";
  const [tab, setTab] = useState("photos");
  const qs = new URLSearchParams(typeof window !== "undefined" ? (window.location.hash.split("?")[1] || window.location.search || "") : "");
  const [bk, setBk] = useState({ from: qs.get("from") || inDays(1), to: qs.get("to") || inDays(3), guests: Number(qs.get("guests")) || 2 });
  const [picking, setPicking] = useState(false);
  const month = TODAY.slice(0, 7); // calendar shows this month
  const day = (v) => (String(v).startsWith(`${month}-`) ? Number(v.slice(8)) : 0);
  const ds = (d) => `${month}-${String(d).padStart(2, "0")}`;
  const from = day(bk.from), to = day(bk.to);
  const pick = (d) => { if (!picking || d <= from) { setBk({ ...bk, from: ds(d), to: ds(Math.min(31, d + 1)) }); setPicking(true); } else { setBk({ ...bk, to: ds(d) }); setPicking(false); } };
  const blocked = s.blocked || []; // sold-out days come from the business's calendar
  const n = Math.max(1, Math.round((new Date(bk.to) - new Date(bk.from)) / 864e5));
  const trip = (extra = "") => `?from=${bk.from}&to=${bk.to}&guests=${bk.guests}${extra}`;
  const maxG = Math.max(2, ...(s.rooms || []).map((r) => r[2] || 2)) * 2;
  return (
    <Page title={s.name}><section className="pb-inner pb-detail">
      {hotel && <div className="seg">{["photos", "rooms", "facilities"].map((x) => <button key={x} className={tab === x ? "on" : ""} onClick={() => setTab(x)}>{x[0].toUpperCase() + x.slice(1)}</button>)}</div>}
      <div className="pb-gallery">{[0, 1, 2, 3, 4].map((i) => <IMG key={i} big={i === 0} seed={tab === "photos" ? `${s.id}-${i}` : undefined} label={i === 0 && tab !== "photos" ? tab : null} />)}</div>
      <div className="pb-detail-grid">
        <div className="pf-stack">
          <div><Crumbs items={[["/", "Home"], ["/stays", "Stays"], [null, s.name]]} /><span className="pb-kicker">{hotel ? `${s.stars}-star ${s.kind}` : `Whole ${s.kind}`}</span><h1 className="pb-h1" style={{ fontSize: 30 }}>{s.name}</h1><span className="muted"><Icon name="map-pin" size={14} /> {s.area}, {s.city} · ★ {s.rating} ({s.reviews} reviews)</span></div>
          <div className="pb-facts">{s.perks.map((p) => <span key={p}><Icon name="check" size={18} />{p}</span>)}</div>
          {hotel ? <div className="pf-stack tight"><h2 className="pb-h2">Rooms</h2>{s.rooms.map(([n, p, g]) => <div key={n} className="card pf-pad pb-order"><IMG /><div className="pf-two" style={{ flex: 1 }}><b>{n}</b><small>Up to {g} guests · free cancellation until 48 hours before</small></div><b className="tnum">{rs(p)}</b><Button size="sm" onClick={() => navigate(`/book/${s.id}${trip(`&room=${encodeURIComponent(n)}`)}`)}>Choose</Button></div>)}</div>
            : <div className="pf-stack tight"><h2 className="pb-h2">House rules</h2><p className="small">Check-in after 14:00 · Check-out by 11:00 · No parties · Quiet after 22:00 · Refundable deposit Rs. 5,000</p></div>}
          <div className="pf-stack tight"><h2 className="pb-h2">Availability</h2>
            <div className="pf-cal">{Array.from({ length: 31 }, (_, i) => { const d = i + 1; const b = blocked.includes(d); const on = d >= from && d <= to; return <button key={d} disabled={b} className={`pf-cal-day ${on ? "on" : ""} ${b ? "blocked" : ""}`} onClick={() => pick(d)}><b className="tnum">{d}</b>{!b && <span className="tnum">{((s.price * (d % 7 === 5 || d % 7 === 6 ? 1.1 : 1)) / 1000).toFixed(1)}k</span>}</button>; })}</div>
            <span className="small muted">{fdate(`${month}-01`).slice(2)} · {n} {n === 1 ? "night" : "nights"} selected · tap check-in, then check-out · blocked days are sold out</span></div>
          <div className="pf-stack tight"><h2 className="pb-h2">Location</h2><ExactMap lat={s.lat} lng={s.lng} name={s.name} address={`${s.area}, ${s.city}`} /></div>
          <QA id={s.id} />
          <div className="pf-stack tight"><h2 className="pb-h2">Reviews</h2>{s.reviews ? <span className="small muted">★ {s.rating} · {s.reviews} reviews</span> : <span className="small muted">No reviews yet.</span>}</div>
        </div>
        <aside className="card pb-book">
          <span className="pb-price tnum">{rs(s.price)}<small> / night</small></span>
          <div className="bk-box">
            <div className="bk-dates">
              <label><small>{L("ck.checkIn", "Check in")}</small><input type="date" className="tnum" value={bk.from} onChange={(e) => { const v = e.target.value; if (!v) return; setBk({ ...bk, from: v, to: v >= bk.to ? new Date(new Date(v).getTime() + 864e5).toISOString().slice(0, 10) : bk.to }); }} /></label>
              <label><small>{L("ck.checkOut", "Check out")}</small><input type="date" className="tnum" min={bk.from} value={bk.to} onChange={(e) => e.target.value > bk.from && setBk({ ...bk, to: e.target.value })} /></label>
            </div>
            <div className="bk-guests"><span><small>{L("room.guests", "Guests")}</small><b className="tnum">{bk.guests} {L("pub.guests", "guests")}</b></span><Counter value={bk.guests} min={1} max={maxG} onChange={(v) => setBk({ ...bk, guests: v })} label="guests" /></div>
          </div>
          <div className="pf-totals">
            <div><span className="tnum">{rs(s.price)} × {n} {L("pub.nights", "nights")}</span><span className="tnum">{rs(s.price * n)}</span></div>
            <div><span>{L("pub.taxes", "Service charge and VAT")}</span><span className="tnum">{rs(Math.round(s.price * n * 0.243))}</span></div>
            <div className="total"><span>{L("pos.total", "Total")}</span><span className="tnum">{rs(s.price * n + Math.round(s.price * n * 0.243))}</span></div>
          </div>
          <Button block icon="calendar-check" onClick={() => navigate(`/book/${s.id}${trip()}`)}>{L("pub.book", "Book now")}</Button>
          <Link to={`/site/${s.tid}`} className="btn btn-ghost btn-block"><Icon name="building-2" size={16} />View host profile</Link>
          <span className="tiny muted" style={{ textAlign: "center" }}>Cancellation: {s.policy}. You won't be charged yet.</span>
        </aside>
      </div>
    </section></Page>
  );
}

/* Projects list + detail + unit drawer (§7.5) */
export function Projects() {
  return <Page><section className="pb-inner pf-stack" style={{ padding: "28px 24px" }}><h1 className="pb-h1" style={{ fontSize: 30 }}>Projects</h1><div className="pb-grid">{useCatalog().projects.map((p) => <ProjectCard key={p.id} p={p} />)}</div></section></Page>;
}
export function ProjectDetail({ id }) {
  const p = useCatalog().projects.find((x) => x.id === id);
  return p ? <ProjectView p={p} /> : <Missing what="Project" to="/project" label="See all projects" />;
}

function ProjectView({ p }) {
  const L = useL();
  const { navigate } = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState("photos");
  const [unit, setUnit] = useState(null);
  const [visit, setVisit] = useState(false);
  const units = Array.from({ length: 16 }, (_, i) => ({ id: `A-${12 - Math.floor(i / 4)}0${(i % 4) + 1}`, type: i % 2 ? "3 BHK" : "2 BHK", size: i % 2 ? 1450 : 1100, price: (i % 2 ? 14200000 : 8500000) + (12 - Math.floor(i / 4)) * 60000, status: [1, 4, 6, 9, 12].includes(i) ? "available" : i === 2 ? "reserved" : "sold" }));
  const emi = (amt) => Math.round((amt * 0.7 * (0.11 / 12)) / (1 - Math.pow(1 + 0.11 / 12, -240)));
  return (
    <Page title={p.name}><section className="pb-inner pb-detail">
      <div className="seg">{["photos", "site plan", "progress", "video"].map((x) => <button key={x} className={tab === x ? "on" : ""} onClick={() => setTab(x)}>{x[0].toUpperCase() + x.slice(1)}</button>)}</div>
      <div className="pb-gallery">{[0, 1, 2, 3, 4].map((i) => <IMG key={i} big={i === 0} seed={tab === "photos" || tab === "progress" ? `${p.id}-${tab}-${i}` : undefined} label={i === 0 && tab !== "photos" ? tab : null} />)}</div>
      <div className="pb-detail-grid">
        <div className="pf-stack">
          <div><Crumbs items={[["/", "Home"], ["/project", "Projects"], [null, p.name]]} /><span className="pb-kicker">{p.type} · {p.status}</span><h1 className="pb-h1" style={{ fontSize: 30 }}>{p.name}</h1><span className="muted"><Icon name="map-pin" size={14} /> {p.area}, {p.city} · Possession {p.possession}</span></div>
          <div className="pb-facts">{[["layout-grid", `${p.units} units`], ["building", `${p.towers || "—"} towers`], ["layers", `${p.floors} floors`], ["tag", `From ${rsShort(p.from)}`], ["construction", `${p.progress}% built`], ["file-check", "Approved plans"]].map(([ic, tx]) => <span key={tx}><Icon name={ic} size={18} />{tx}</span>)}</div>
          <div className="pf-stack tight"><h2 className="pb-h2">Units · {p.left} left</h2><div className="pf-units">{[0, 1, 2, 3].map((r) => <div key={r} className="pf-units-row"><span className="tnum small muted">Floor {12 - r}</span>{units.slice(r * 4, r * 4 + 4).map((u) => <button key={u.id} className={`pf-unit pf-u-${u.status}`} onClick={() => setUnit(u)}><b className="tnum">{u.id}</b><small>{u.type}</small></button>)}</div>)}</div></div>
          <div className="pf-stack tight"><h2 className="pb-h2">Payment plan</h2><div className="pf-totals">{[["Booking", 10], ["Structure", 30], ["Plaster", 30], ["Handover", 30]].map(([n, pc]) => <div key={n}><span>{n}</span><span className="tnum">{pc}%</span></div>)}</div><span className="small muted">Loan partners: {p.banks.join(", ")}</span></div>
          <div className="pf-stack tight"><h2 className="pb-h2">Construction progress · {p.progress}%</h2><div className="bar" style={{ height: 8 }}><i style={{ width: `${p.progress}%` }} /></div>{!!p.updates?.length && <ul className="pf-list">{p.updates.map((u, i) => <li key={i}><Icon name="construction" size={16} /><div><span>{u.text}</span><span className="small muted">{fdate(u.at)}</span></div></li>)}</ul>}</div>
          <div className="pf-stack tight"><h2 className="pb-h2">Documents</h2><div className="pf-chips">{["Brochure", "Approvals", "Layout plan", "Sample agreement"].map((d) => <span key={d} className="chip"><Icon name="file-text" size={14} />{d}</span>)}</div></div>
          <QA id={p.id} />
        </div>
        <aside className="card pb-book">
          <span className="pb-price tnum"><small>From </small>{rsShort(p.from)}</span><span className="small tnum">EMI about {rs(emi(p.from))} / month</span>
          <Button block icon="calendar-days" onClick={() => setVisit(true)}>{L("pub.visit", "Book a site visit")}</Button>
          <Link to={`/site/${p.tid}`} className="btn btn-ghost btn-block"><Icon name="building-2" size={16} />Developer profile</Link>
        </aside>
      </div>
      <Drawer open={!!unit} onClose={() => setUnit(null)} title={unit?.id} sub={unit && `${unit.type} · ${unit.size} sq ft`} footer={unit && unit.status !== "available" ? <span className="small muted">This unit is not available. Pick a green unit or book a site visit.</span> : unit?.status === "available" && <Button icon="bookmark" onClick={() => navigate(`/reserve/${p.id}-${unit.id}`)}>Reserve with token Rs. 2,00,000</Button>}>
        {unit && <dl className="pf-kv"><dt>Price</dt><dd className="tnum">{rs(unit.price)}</dd><dt>Status</dt><dd><Badge tone={unit.status === "available" ? "done" : "neutral"}>{({ available: "Available", reserved: "Reserved", sold: "Sold", blocked: "Not for sale" })[unit.status] || unit.status}</Badge></dd><dt>EMI (20 yrs, 11%)</dt><dd className="tnum">{rs(emi(unit.price))} / month</dd><dt>Booking 10%</dt><dd className="tnum">{rs(unit.price * 0.1)}</dd></dl>}
      </Drawer>
      <Drawer open={visit} onClose={() => setVisit(false)} title="Book a site visit" footer={<Button icon="check" onClick={() => { setVisit(false); toast("Visit booked. The developer will call to confirm."); }}>Confirm visit</Button>}>
        <div className="pf-stack"><Field label="When"><div className="pf-chips">{["Sat 6 Mar, 11:00", "Sat 6 Mar, 14:00", "Sun 7 Mar, 11:00"].map((x) => <button key={x} className="chip">{x}</button>)}</div></Field><Field label="Name"><Input /></Field><Field label="Phone"><Input className="input tnum" /></Field></div>
      </Drawer>
    </section></Page>
  );
}

/* Investments list + detail (§7.6) */
export function Investments() {
  return <Page><section className="pb-inner pf-stack" style={{ padding: "28px 24px" }}><h1 className="pb-h1" style={{ fontSize: 30 }}>Open investments</h1><p className="small muted">Returns are estimates and never guaranteed. Read the risks on each page.</p><div className="pb-grid">{useCatalog().invests.map((v) => <InvestCard key={v.id} v={v} />)}</div></section></Page>;
}
export function InvestDetail({ id }) {
  const v = useCatalog().invests.find((x) => x.id === id);
  return v ? <InvestView v={v} /> : <Missing what="Investment" to="/investment" label="See all investments" />;
}

function InvestView({ v }) {
  const L = useL();
  const { navigate } = useRouter();
  const [amt, setAmt] = useState(100000);
  const lo = parseInt(v.ret); const yrs = parseInt(v.term);
  return (
    <Page title={v.name}><section className="pb-inner pb-detail">
      <div className="pb-gallery">{[0, 1, 2, 3, 4].map((i) => <IMG key={i} big={i === 0} seed={`${v.id}-${i}`} label={i === 0 ? "Project video" : null} />)}</div>
      <div className="pb-detail-grid">
        <div className="pf-stack">
          <div><Crumbs items={[["/", "Home"], ["/investment/explore", "Invest"], [null, v.name]]} /><span className="pb-kicker">{v.type} · {v.city}</span><h1 className="pb-h1" style={{ fontSize: 30 }}>{v.name}</h1></div>
          <div className="bar" style={{ height: 8 }}><i style={{ width: `${(v.raised / v.target) * 100}%` }} /></div>
          <div className="pb-facts">{[["wallet", `${rsShort(v.raised)} raised of ${rsShort(v.target)}`], ["users", `${v.investors} investors`], ["trending-up", `${v.ret} a year expected`], ["calendar-days", v.term], ["hand-coins", `Paid ${v.payout.toLowerCase()}`], ["clock", `Closes ${fdate(v.closes)}`]].map(([ic, tx]) => <span key={tx}><Icon name={ic} size={18} />{tx}</span>)}</div>
          <div className="pf-stack tight"><h2 className="pb-h2">The project</h2><p className="small">A 24-room eco lodge on the edge of Chitwan National Park, run by an operator with three lodges already open. Money raised pays for building and furnishing; the land is already owned.</p></div>
          <div className="card pf-pad pb-risk"><h2 className="pb-h2" style={{ fontSize: 18 }}><Icon name="triangle-alert" size={18} /> Risks</h2><p className="small">Returns depend on how the business performs and are not guaranteed. You may get back less than you put in, or nothing. Money is locked for {v.term}. Read the investment agreement before you invest. [Final wording from Sheetal's legal team.]</p></div>
          <div className="pf-stack tight"><h2 className="pb-h2">Documents</h2><div className="pf-chips">{["Investment agreement", "Approvals", "Financial plan", "Company registration"].map((d) => <span key={d} className="chip"><Icon name="file-text" size={14} />{d}</span>)}</div></div>
          {!!v.updates?.length && <div className="pf-stack tight"><h2 className="pb-h2">Updates</h2>{v.updates.map((u, i) => <div key={i} className="card pf-pad"><b className="small tnum">{fdate(u.at)}</b><p className="small">{u.text}</p></div>)}</div>}
        </div>
        <aside className="card pb-book">
          <Field label="I want to invest"><div className="pf-unit"><span>Rs.</span><input className="input tnum" value={amt.toLocaleString("en-IN")} onChange={(e) => setAmt(Number(e.target.value.replace(/\D/g, "")) || 0)} /></div></Field>
          <span className="small tnum">Could become {rs(amt * Math.pow(1 + lo / 100, yrs))} in {v.term} at {lo}% (not guaranteed)</span>
          <Button block icon="chart-pie" disabled={amt < v.min} onClick={() => navigate(`/invest/${v.id}?amt=${amt}`)}>{L("mk.invest", "Invest")}</Button>
          <span className="tiny muted" style={{ textAlign: "center" }}>Minimum {rs(v.min)} · 7-day cooling-off period</span>
        </aside>
      </div>
    </section></Page>
  );
}

/* Partners directory + shared business profile (§18) */
export function Partners() {
  const { db } = useStore();
  const [type, setType] = useState("all");
  const list = db.tenants.filter((x) => x.status === "active" && (type === "all" || x.type === type));
  return (
    <Page><section className="pb-inner pf-stack" style={{ padding: "28px 24px" }}>
      <h1 className="pb-h1" style={{ fontSize: 30 }}>Partners</h1>
      <Seg value={type} onChange={setType} options={[{ id: "all", label: "All" }, { id: "hotel", label: "Hotels" }, { id: "host", label: "Hosts" }, { id: "developer", label: "Developers" }, { id: "agency", label: "Agencies" }, { id: "sponsor", label: "Sponsors" }]} />
      <div className="pb-grid">{list.map((x) => <Link key={x.id} to={`/site/${x.id}`} className="card pb-card pf-pad" style={{ display: "flex", gap: 14, alignItems: "center" }}><span className="pf-kind-ico"><Icon name={BUSINESS_TYPES[x.type].icon} size={22} /></span><span className="pf-two"><b>{x.name}</b><small>{x.city}</small></span></Link>)}</div>
    </section></Page>
  );
}
/* Saved (per-type tabs), saved searches, compare (§29) */
export function SavedBody() {
  const [saved, toggle] = useSaved();
  const toast = useToast();
  const [tab, setTab] = useState("stay");
  const [cmp, setCmp] = useState([]);
  const cat = useCatalog();
  const items = { stay: cat.stays, project: cat.projects, invest: cat.invests }[tab] || [];
  const mine = items.filter((x) => saved.includes(`${tab}:${x.id}`));
  return (
    <div className="pf-stack">
      <Seg value={tab} onChange={(v) => { setTab(v); setCmp([]); }} options={[{ id: "stay", label: "Stays" }, { id: "project", label: "Projects" }, { id: "invest", label: "Investments" }, { id: "searches", label: "Saved searches" }]} />
      {tab === "searches" ? <div className="pf-stack">{["Stays in Pokhara, 2 guests, under Rs. 7,000", "2 BHK in Lalitpur under 1 Cr"].map((s) => <div key={s} className="card pf-pad pb-order"><Icon name="bell" size={18} /><span style={{ flex: 1 }}>{s}</span><Button variant="ghost" size="sm" onClick={() => toast("Alert turned off")}>Alerts on</Button></div>)}</div>
        : mine.length ? <>
          <div className="pb-grid">{mine.map((x) => <div key={x.id} className="card pf-pad pf-stack tight"><b>{x.name}</b><label className="check small"><input type="checkbox" checked={cmp.includes(x.id)} onChange={(e) => setCmp(e.target.checked ? [...cmp, x.id].slice(0, 4) : cmp.filter((y) => y !== x.id))} />Compare</label><button className="link small" style={{ background: "none", border: 0, padding: 0, textAlign: "left", cursor: "pointer" }} onClick={() => toggle(tab, x.id)}>Remove</button></div>)}</div>
          {cmp.length > 1 && <div className="card pf-panel"><table className="table pf-table"><thead><tr><th></th>{cmp.map((c) => <th key={c}>{items.find((x) => x.id === c).name}</th>)}</tr></thead><tbody>
            {(tab === "stay" ? [["Price", (x) => rs(x.price)], ["Rating", (x) => `★ ${x.rating}`], ["Area", (x) => x.area], ["Cancellation", (x) => x.policy]] : tab === "project" ? [["From", (x) => rsShort(x.from)], ["Status", (x) => x.status], ["Units left", (x) => x.left]] : [["Expected", (x) => x.ret], ["Term", (x) => x.term], ["Minimum", (x) => rs(x.min)]]).map(([l, f]) => <tr key={l}><td><b>{l}</b></td>{cmp.map((c) => <td key={c} className="tnum">{f(items.find((x) => x.id === c))}</td>)}</tr>)}
          </tbody></table></div>}
        </> : <div className="pf-empty"><Icon name="heart" size={36} /><h3>Nothing saved yet</h3><p>Tap the heart on any listing to keep it here.</p></div>}
    </div>
  );
}

/* Tools (§19) */
export function Tools() {
  const [emi, setEmi] = useState({ amt: 10000000, rate: 11, yrs: 20 });
  const [inv, setInv] = useState({ amt: 100000, rate: 12, yrs: 3 });
  const [host, setHost] = useState({ nightly: 6000, occ: 60 });
  const r = emi.rate / 1200; const n = emi.yrs * 12;
  const m = Math.round((emi.amt * r) / (1 - Math.pow(1 + r, -n)));
  const Num = ({ v, on, label, unit }) => <Field label={label}><div className="pf-unit"><input className="input tnum" value={v.toLocaleString("en-IN")} onChange={(e) => on(Number(e.target.value.replace(/\D/g, "")) || 0)} /><span>{unit}</span></div></Field>;
  return (
    <Page><section className="pb-inner pf-stack" style={{ padding: "28px 24px" }}>
      <h1 className="pb-h1" style={{ fontSize: 30 }}>Tools</h1>
      <div className="pb-grid">
        <div className="card pf-pad pf-stack"><b>EMI calculator</b><Num v={emi.amt} on={(x) => setEmi({ ...emi, amt: x })} label="Loan" unit="Rs." /><Num v={emi.rate} on={(x) => setEmi({ ...emi, rate: x })} label="Interest" unit="%" /><Num v={emi.yrs} on={(x) => setEmi({ ...emi, yrs: x })} label="Years" unit="yrs" /><span className="pb-price tnum">{rs(m)}<small> / month</small></span></div>
        <div className="card pf-pad pf-stack"><b>Investment return</b><Num v={inv.amt} on={(x) => setInv({ ...inv, amt: x })} label="Amount" unit="Rs." /><Num v={inv.rate} on={(x) => setInv({ ...inv, rate: x })} label="Expected a year" unit="%" /><Num v={inv.yrs} on={(x) => setInv({ ...inv, yrs: x })} label="Years" unit="yrs" /><span className="pb-price tnum">{rs(inv.amt * Math.pow(1 + inv.rate / 100, inv.yrs))}</span><span className="tiny muted">Not guaranteed.</span></div>
        <div className="card pf-pad pf-stack"><b>Average nightly rate by city</b>{[["Pokhara", 5400, "+8%"], ["Kathmandu", 4900, "+5%"], ["Nagarkot", 8200, "+12%"], ["Chitwan", 6100, "+3%"]].map(([c, r, ch]) => <div key={c} className="pf-meter-top"><span>{c}</span><b className="tnum">{rs(r)} · {ch}</b></div>)}<span className="tiny muted">Last 30 days, Sheetal bookings</span></div>
        <div className="card pf-pad pf-stack"><b>Host income estimate</b><Num v={host.nightly} on={(x) => setHost({ ...host, nightly: x })} label="Price per night" unit="Rs." /><Num v={host.occ} on={(x) => setHost({ ...host, occ: x })} label="Nights booked" unit="%" /><span className="pb-price tnum">{rs(host.nightly * 30 * (host.occ / 100) * 0.9)}<small> / month after fees</small></span></div>
      </div>
    </section></Page>
  );
}

/* Help, legal and system pages (§19, §21) */
const HELP = {
  booking: ["How booking works", ["Pick dates and guests; prices include service charge and VAT.", "Pay in full or 30% now with Fonepay, eSewa, Khalti, connectIPS or a card.", "You get a booking code by SMS. Add check-in details from My account.", "Most stays confirm instantly; a few hosts approve within 2 hours."]],
  investing: ["How investing works", ["Investing needs your ID (KYC) once.", "Returns are estimates and never guaranteed.", "You have 7 days to change your mind after investing.", "Updates and statements appear under My account."]],
  cancellation: ["Cancellation and refunds", ["Flexible: full refund up to 24 hours before check-in.", "Moderate: full refund up to 5 days before, 50% after.", "Strict: 50% refund up to 7 days before, none after.", "Refunds go back to the same method in 3–5 working days."]],
  "house-rules": ["House rules", ["Check-in after 14:00, check-out by 11:00 unless the listing says otherwise.", "Carry a valid ID for every guest.", "No smoking indoors. Quiet hours after 22:00.", "Damage is covered by the security deposit where one is taken."]],
  contact: ["Contact", ["WhatsApp or call +977 980-1136817, 08:00–20:00 every day.", "Email support@sheetalproperty.com.", "Office: Lalitpur, Nepal."]],
};
const LEGAL = { "booking-terms": "Booking terms (stays)", "cancellation-refund": "Cancellation and refund policy", "house-rules": "House rules guidelines", "project-terms": "Project reservation terms", "investment-terms": "Investment terms and risk notice", "payment-terms": "Payment and refund terms", "partner-agreement": "Partner agreement", "developer-terms": "Developer and sponsor terms", "review-rules": "Review and community rules", cookies: "Cookie notice" };
const LEGAL_SECTIONS = ["Who this applies to", "What you agree to", "Payments and fees", "Cancellations and changes", "Your responsibilities", "Our responsibilities", "Disputes", "Contact"];
export function HelpPage({ topic }) {
  const h = HELP[topic] || HELP.booking;
  return <Page><section className="pb-inner pf-stack" style={{ padding: "28px 24px", maxWidth: 760 }}>
    <div className="pf-chips">{Object.entries(HELP).map(([k, [n]]) => <Link key={k} to={`/help/${k}`} className={`chip ${k === topic ? "active" : ""}`}>{n}</Link>)}</div>
    <h1 className="pb-h1" style={{ fontSize: 30 }}>{h[0]}</h1>
    <ol className="pb-steps">{h[1].map((s) => <li key={s}>{s}</li>)}</ol>
  </section></Page>;
}
export function LegalPage({ page }) {
  const key = LEGAL[page] ? page : "booking-terms";
  return <Page title={LEGAL[key]}><section className="pb-inner pb-legal" style={{ padding: "28px 24px" }}>
    <article className="pf-stack">
      <h1 className="pb-h1" style={{ fontSize: 32 }}>{LEGAL[key]}</h1>
      <div className="pf-row-actions" style={{ justifyContent: "flex-start" }}><span className="small muted">Draft · final wording coming from Sheetal's legal team</span><Button variant="ghost" size="sm" icon="printer" onClick={() => window.print()}>Print</Button><Button variant="ghost" size="sm" icon="download">PDF</Button></div>
      {LEGAL_SECTIONS.map((s, i) => <section key={s} id={`s${i}`} className="pf-stack tight"><h2 className="pb-h2" style={{ fontSize: 20 }}>{i + 1}. {s}</h2><div className="pf-legal-slot">Legal note from company: the text for this section is written by Sheetal's legal team and edited in Super admin → Site content.</div></section>)}
      <div className="card pf-pad"><b>Questions?</b> <span className="small">Call +977 980-1136817 or email legal@sheetalproperty.com.</span></div>
    </article>
    <aside className="pb-legal-toc card pf-pad pf-stack tight"><b className="small">On this page</b>{LEGAL_SECTIONS.map((s, i) => <a key={s} href={`#s${i}`} className="small">{s}</a>)}
      <b className="small" style={{ marginTop: 12 }}>Related</b>{Object.entries(LEGAL).filter(([k]) => k !== key).slice(0, 5).map(([k, n]) => <Link key={k} to={`/legal/${k}`} className="small">{n}</Link>)}</aside>
  </section></Page>;
}

/* Offers (§30) */
export const OFFERS = [];
const daysLeft = (d) => Math.max(0, Math.ceil((new Date(d) - new Date()) / 864e5));
export function OffersPage({ slug }) {
  const cat = useCatalog();
  const o = OFFERS.find((x) => x.slug === slug);
  if (!o) return <Page title="Offers"><section className="pb-inner pf-stack" style={{ padding: "28px 24px" }}><h1 className="pb-h1" style={{ fontSize: 30 }}>Offers</h1>
    <div className="pb-grid">{OFFERS.map((x) => <Link key={x.slug} to={`/offers/${x.slug}`} className="card pf-pad pf-stack tight pb-offer"><span className="tag tag-white">{daysLeft(x.ends)} days left</span><b>{x.title}</b>{x.code && <span className="small tnum">Code: <b>{x.code}</b></span>}<span className="small muted">Ends {fdate(x.ends)}</span></Link>)}</div></section></Page>;
  const items = o.kind === "project" ? cat.projects.slice(0, 4).map((p) => <ProjectCard key={p.id} p={p} />) : cat.stays.slice(0, 4).map((s) => <StayCard key={s.id} s={s} />);
  return <Page title={o.title}><section className="pb-inner pf-stack" style={{ padding: "28px 24px" }}>
    <div className="card pf-pad pb-offer-hero"><div className="pf-two"><b className="pb-h1" style={{ fontSize: 30 }}>{o.title}</b><small>Ends {fdate(o.ends)} · {daysLeft(o.ends)} days left</small></div>{o.code && <div className="pb-code"><span className="small muted">Use code</span><b className="tnum">{o.code}</b></div>}</div>
    <ul className="pb-steps">{o.rules.map((r) => <li key={r}>{r}</li>)}</ul>
    <div className="pf-legal-slot">Offer terms from company.</div>
    <h2 className="pb-h2">Eligible listings</h2><div className="pb-grid pb-home-row">{items}</div>
  </section></Page>;
}
export function SystemPage({ kind }) {
  const m = { notfound: ["search", "Page not found", "The link may be old. Try search or go home."], error: ["triangle-alert", "Something went wrong", "Please try again in a minute."], maintenance: ["wrench", "We'll be right back", "Sheetal is being updated. Bookings and payments are safe."], verify: ["badge-check", "Verification in progress", "We're checking your documents. This usually takes under 24 hours; we'll SMS you."] }[kind] || ["search", "Page not found", ""];
  return <Page><div className="pb-done pb-inner"><span className="pf-kind-ico" style={{ width: 64, height: 64 }}><Icon name={m[0]} size={30} /></span><h1 className="pb-h1">{m[1]}</h1><p className="pb-lead">{m[2]}</p><Link to="/home" className="btn btn-primary">Go home</Link></div></Page>;
}

/* Questions and answers on any listing (§7.5) */
export function QA({ id }) {
  const { db, update } = useStore();
  const [q, setQ] = useState("");
  const list = db.customer?.qa?.[id] || [];
  return (
    <div className="pf-stack tight"><h2 className="pb-h2">Questions and answers</h2>
      {list.map((x, i) => <div key={i} className="card pf-pad"><b>{x.q}</b><p className="small">{x.a ? <>{x.a} <span className="muted">— {x.by}</span></> : <span className="muted">Waiting for an answer. Usually within a day.</span>}</p></div>)}
      <div className="pf-row-actions" style={{ justifyContent: "flex-start" }}><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask a question" style={{ flex: 1, maxWidth: 420 }} /><Button variant="outline" disabled={!q.trim()} onClick={() => { update((d) => { d.customer = d.customer || { orders: [] }; d.customer.qa = d.customer.qa || {}; (d.customer.qa[id] = d.customer.qa[id] || []).unshift({ q }); }); setQ(""); }}>Ask</Button></div>
    </div>
  );
}

/* Map with pins per type (§19) */
export function MapPage() {
  const cat = useCatalog();
  const [f, setF] = useState("all");
  const pos = { Pokhara: [16, 30], Kathmandu: [58, 18], Lalitpur: [56, 52], Bhaktapur: [82, 34], Chitwan: [40, 78], Tanahun: [30, 56], Rupandehi: [10, 84] };
  const seen = {};
  const pins = [...cat.stays.map((x) => ({ ...x, t: "stay", ic: "bed-double", to: `/stays/${x.id}` })), ...cat.projects.map((x) => ({ ...x, t: "project", ic: "building-2", to: `/project/${x.id}` })), ...cat.invests.map((x) => ({ ...x, t: "invest", ic: "chart-pie", to: `/investment/${x.id}` }))].filter((x) => f === "all" || x.t === f);
  return (
    <Page title="Map"><section className="pb-inner pf-stack" style={{ padding: "28px 24px" }}>
      <div className="pf-plan-top"><h1 className="pb-h1" style={{ fontSize: 30 }}>Map</h1><Seg value={f} onChange={setF} options={[{ id: "all", label: "All" }, { id: "stay", label: "Stays" }, { id: "project", label: "Projects" }, { id: "invest", label: "Invest" }]} /></div>
      <div className="pb-map">{pins.map((x, i) => { const [l, tp] = pos[x.city] || [50, 50]; const k = (seen[x.city] = (seen[x.city] ?? -1) + 1); return <Link key={x.t + x.id} to={x.to} className={`pb-pin ${x.t}`} style={{ left: `${l + (k % 2) * 14}%`, top: `${tp + Math.floor(k / 2) * 9}%` }} title={x.name}><Icon name={x.ic} size={14} /><span>{x.name}</span></Link>; })}</div>
      <div className="pf-cal-legend"><span><i className="pb-lg stay" />Stay</span><span><i className="pb-lg project" />Project</span><span><i className="pb-lg invest" />Investment</span></div>
    </section></Page>
  );
}

/* Post a request: buy, rent, stay or invest (demand board, §19) */
export function RequestPage() {
  const { update } = useStore();
  const toast = useToast();
  const [f, setF] = useState({ kind: "stay", want: "Villa for 5 nights", where: "Pokhara", budget: "", name: "", phone: "" });
  const fee = { buy: 2000, rent: 500, stay: 0, invest: 0 }[f.kind];
  return (
    <Page title="Post a request"><section className="pb-inner pf-stack" style={{ padding: "28px 24px", maxWidth: 720 }}>
      <h1 className="pb-h1" style={{ fontSize: 30 }}>Tell us what you need</h1>
      <p className="small muted">Matching hotels, hosts, developers and agencies send you offers. You choose.</p>
      <div className="card pf-pad pf-stack">
        <Field label="I want to"><div className="pf-tiles">{[["buy", "Buy", "house"], ["rent", "Rent", "key-round"], ["stay", "Stay", "bed-double"], ["invest", "Invest", "chart-pie"]].map(([k, l, ic]) => <button key={k} className={f.kind === k ? "on" : ""} onClick={() => setF({ ...f, kind: k })}><Icon name={ic} size={18} /><span>{l}</span></button>)}</div></Field>
        <div className="pf-grid-2 tight"><Field label="What"><Input value={f.want} onChange={(e) => setF({ ...f, want: e.target.value })} /></Field><Field label="Where"><Input value={f.where} onChange={(e) => setF({ ...f, where: e.target.value })} /></Field></div>
        <div className="pf-grid-2 tight"><Field label="Budget (Rs.)"><Input className="input tnum" value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value.replace(/\D/g, "") })} /></Field><Field label="Phone"><Input className="input tnum" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field></div>
        <div className="pf-note"><Icon name="wallet" size={16} />{fee ? `Posting fee ${rs(fee)}, refunded if nobody matches in 30 days.` : "Free to post."}</div>
        <Button icon="send" disabled={!f.phone} onClick={() => { update((d) => { d.growth = d.growth || {}; d.growth.demands = d.growth.demands || []; d.growth.demands.unshift({ id: `DM-${600 + d.growth.demands.length}`, who: f.name || "Website visitor", want: f.want, where: f.where, budget: Number(f.budget) || 0, kind: f.kind, fee, paid: !fee, matches: 0, status: fee ? "pending" : "open", at: TODAY.slice(0, 10) }); }); toast("Posted. You'll get offers by SMS."); }}>{fee ? `Pay ${rs(fee)} and post` : "Post request"}</Button>
      </div>
    </section></Page>
  );
}

export { photoFor };
