// List pages for stays, projects and investments, with the same layout as Buy and Rent.

import { useMemo, useState } from "react";
import { useSEO } from "../utils/seo";
import { FilterRail, PRICE_RANGES } from "../components/SearchFilters";
import { SearchTabs } from "../components/SearchTabs";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { LayoutGrid, List, SlidersHorizontal, X, MapPin, Star, BedDouble, Building2, TrendingUp } from "lucide-react";
import { InviteCards } from "../components/InviteCards";
import { useMedia } from "../hooks/useAsync";
import { PageHead, Empty } from "../components/ui";
import { Dropdown } from "../components/Dropdown";
import { PlatformWrap } from "../market/SiteRows";
import { useCatalog, photoFor } from "../market/Market";

const fmt = (n) => (n >= 1e7 ? `Rs. ${+(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `Rs. ${+(n / 1e5).toFixed(2)} Lakh` : `Rs. ${Math.round(n).toLocaleString("en-IN")}`);
const META = {
  stay: { kicker: "Stay", title: "Places to stay", text: "Hotels, resorts, villas and homestays across Nepal, booked and paid on Sheetal.", base: "/stays",
    types: ["Hotel", "Resort", "Villa", "Apartment"], sorts: [["", "Top rated"], ["low", "Price: low to high"], ["high", "Price: high to low"]] },
  project: { kicker: "Projects", title: "Building and colony projects", text: "Apartments, colonies and villa projects with price lists, progress and bank finance.", base: "/project",
    types: ["Apartment building", "Colony", "Villa project", "Commercial complex"], statuses: ["Upcoming", "Under construction", "Ready to move"], sorts: [["", "Newest first"], ["low", "Price: low to high"], ["high", "Price: high to low"]] },
  invest: { kicker: "Invest", title: "Project investments", text: "Fund hotels, villa projects and colonies from Rs. 10,000. Returns are not guaranteed.", base: "/investment",
    types: ["Hotel", "Villa project", "Colony", "Commercial"], statuses: ["Open", "Funded"], sorts: [["", "Closing soon"], ["raised", "Most funded"], ["min", "Lowest minimum"]] },
};
const retLow = (r) => parseFloat(String(r).split(/[–-]/)[0]) || 0;
const years = (t) => parseFloat(t) || 0;
const EXTRA = {
  stay: [
    { k: "guests", label: "Guests", seg: [["", "Any"], ["2", "2+"], ["4", "4+"], ["6", "6+"]], test: (x, v) => Math.max(...x.rooms.map((r) => r[2])) >= Number(v) },
    { k: "perk", label: "Must have", multi: ["Free breakfast", "Wi-Fi", "Mountain view", "Lake view", "Pool", "Spa", "Kitchen", "Airport pickup", "Self check-in", "Garden"], test: (x, v) => v.split("|").every((p) => x.perks.some((q) => q.toLowerCase().includes(p.toLowerCase()))) },
    { k: "cancel", label: "Cancellation", seg: [["", "Any"], ["flexible", "Free cancel"], ["moderate", "Moderate"], ["strict", "Strict"]], test: (x, v) => x.policy === v },
  ],
  project: [
    { k: "handover", label: "Handover", seg: [["", "Any"], ["now", "Ready now"], ["2028", "By 2028"], ["2029", "By 2029"]], test: (x, v) => (v === "now" ? x.possession === "Now" : x.possession === "Now" || Number(String(x.possession).slice(-4)) <= Number(v)) },
    { k: "units", label: "Units left", seg: [["", "Any"], ["10", "10+"], ["50", "50+"]], test: (x, v) => x.left >= Number(v) },
    { k: "bank", label: "Bank loan with", multi: ["Nabil Bank", "NIC Asia", "Global IME", "Laxmi Sunrise"], test: (x, v) => v.split("|").some((b) => x.banks.includes(b)) },
  ],
  invest: [
    { k: "ret", label: "Expected return a year", seg: [["", "Any"], ["9", "9%+"], ["11", "11%+"], ["12", "12%+"]], test: (x, v) => retLow(x.ret) >= Number(v) },
    { k: "term", label: "How long", seg: [["", "Any"], ["3", "Up to 3 yrs"], ["4", "Up to 4 yrs"], ["5", "Up to 5 yrs"]], test: (x, v) => years(x.term) <= Number(v) },
    { k: "risk", label: "Risk", seg: [["", "Any"], ["low", "Low"], ["medium", "Medium"], ["high", "High"]], test: (x, v) => x.risk === v },
    { k: "payout", label: "Returns paid", multi: ["Every year", "Every 6 months", "At exit"], test: (x, v) => v.split("|").includes(x.payout) },
  ],
};
const norm = (kind, x) => ({ raw: x, ...(x.live ? normListing(kind, x) : normInner(kind, x)) });
// A listing from the website API filed under this kind (for example a hotel for sale): its own photo,
// its real sale or rent price, and the full property page.
const normListing = (kind, x) => {
  const deal = { night: "Stay", rent: "For rent" }[x.deal] ?? "For sale";
  return { id: x.id, to: x.href, img: x.img, name: x.name, type: x.type || (kind === "stay" ? "Hotel" : kind === "project" ? "Colony" : "Land"), city: x.city, area: x.area,
    price: x.price || 0, tag: deal, status: deal, facts: [], sub: { night: "/ night", rent: "/ month" }[x.deal] ?? "" };
};
const normInner = (kind, x) => kind === "stay"
  ? { id: x.id, to: `/stays/${x.id}`, name: x.name, type: x.kind[0].toUpperCase() + x.kind.slice(1), city: x.city, area: x.area, price: x.price, tag: "Stay", rating: x.rating, reviews: x.reviews, facts: x.perks.slice(0, 2), sub: "/ night" }
  : kind === "project"
  ? { id: x.id, to: `/project/${x.id}`, name: x.name, type: x.type, city: x.city, area: x.area, price: x.from, tag: x.status, status: x.status, facts: [`${x.left} of ${x.units} units left`, `Handover ${x.possession}`], pre: "From " }
  : { id: x.id, to: `/investment/${x.id}`, name: x.name, type: x.type, city: x.city, area: x.city, price: x.min, tag: x.raised >= x.target ? "Funded" : "Open", status: x.raised >= x.target ? "Funded" : "Open", pct: Math.min(100, Math.round((x.raised / x.target) * 100)), facts: [`${x.ret} a year, not guaranteed`, `${x.investors} investors`], pre: "Min ", raised: x.raised, closes: x.closes };

function Card({ it: it0, layout, trip = "" }) {
  const nav = useNavigate();
  const it = trip ? { ...it0, to: it0.to + trip } : it0;
  const [broken, setBroken] = useState(false);
  return (
    <article className={`pcard fade-in ${layout === "list" ? "list" : ""}`} onClick={() => nav(it.to)}>
      <div className="pcard-media">
        {!broken ? <img src={it.img || photoFor(it.id)} alt={it.name} loading="lazy" onError={() => setBroken(true)} /> : <div className="sk" style={{ width: "100%", height: "100%", animation: "none" }} />}
        <div className="pcard-top"><span className={it.tag === "Funded" || it.tag === "Ready to move" ? "tag tag-white" : "tag tag-red"}>{it.tag}</span></div>
        <span className="tag tag-white pcard-code">{it.type}</span>
      </div>
      <div className="pcard-body">
        <Link to={it.to} className="pcard-title" onClick={(e) => e.stopPropagation()}>{it.name}</Link>
        <span className="pcard-loc"><MapPin size={13} />{[...new Set([it.area, it.city].filter(Boolean).join(", ").split(/,\s*/).filter(Boolean))].join(", ")}</span>
        {it.pct != null && <div className="bar" style={{ height: 6, margin: "4px 0" }}><i style={{ width: `${it.pct}%` }} /></div>}
        <div className="pcard-specs">{it.rating ? <span><Star size={14} />{it.rating} ({it.reviews})</span> : null}{it.facts.map((f) => <span key={f}>{f}</span>)}</div>
        <div className="row between" style={{ alignItems: "baseline", marginTop: 4 }}>
          <span className="pcard-price tnum">{it.pre && <small>{it.pre}</small>}{fmt(it.price)}{it.sub && <small> {it.sub}</small>}</span>
          {it.pct != null && <span className="tiny muted tnum">{it.pct}% funded</span>}
        </div>
      </div>
    </article>
  );
}

function Inner({ kind }) {
  const meta = META[kind];
  useSEO(meta.title, meta.text);
  const [params, setParams] = useSearchParams();
  const [layout, setLayout] = useState("grid");
  const [showFilters, setShowFilters] = useState(false);
  const wide = useMedia("(min-width: 1081px)");
  const cat = useCatalog();
  const q = Object.fromEntries(params);
  const set = (k, v) => { const n = new URLSearchParams(params); v ? n.set(k, v) : n.delete(k); setParams(n); };
  const all = useMemo(() => ({ stay: cat.stays, project: cat.projects, invest: cat.invests }[kind]).map((x) => norm(kind, x)), [cat, kind]);
  const cities = [...new Set(all.map((x) => x.city).filter(Boolean))];
  const kw = (q.keyword || q.where || q.city || "").toLowerCase();
  let list = all.filter((x) => (!kw || `${x.name} ${x.city} ${x.area}`.toLowerCase().includes(kw)) && (!q.type || x.type.toLowerCase() === q.type.toLowerCase()) && (!q.status || x.status === q.status)
    && (!q.min_price || x.price >= Number(q.min_price)) && (!q.max_price || x.price <= Number(q.max_price)));
  EXTRA[kind].forEach((f) => { if (q[f.k]) list = list.filter((x) => f.test(x.raw, q[f.k])); });
  const s = q.sort || "";
  list = [...list].sort((a, b) => s === "low" || s === "min" ? a.price - b.price : s === "high" ? b.price - a.price : s === "raised" ? b.pct - a.pct : kind === "stay" ? (b.rating || 0) - (a.rating || 0) : kind === "invest" ? String(a.closes).localeCompare(String(b.closes)) : 0);
  const active = ["keyword", "type", "status", "min_price", "max_price", ...EXTRA[kind].map((f) => f.k)].filter((k) => q[k]);
  const trip = kind === "stay" && q.from ? `?${new URLSearchParams(Object.fromEntries(["from", "to", "guests"].filter((k) => q[k]).map((k) => [k, q[k]])))}` : "";
  const flip = (k, v) => { const cur = (q[k] || "").split("|").filter(Boolean); set(k, (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]).join("|")); };
  // The same filter panel as Buy and Rent (components/SearchFilters.jsx). Counts beside every choice: each list
  // counts what matches all the other filters, so picking one choice never empties the rest of its list.
  const match = (x, except) => (except === "keyword" || !kw || `${x.name} ${x.city} ${x.area}`.toLowerCase().includes(kw))
    && (except === "type" || !q.type || String(x.type).toLowerCase() === q.type.toLowerCase())
    && (except === "status" || !q.status || x.status === q.status)
    && (except === "price" || ((!q.min_price || x.price >= Number(q.min_price)) && (!q.max_price || x.price <= Number(q.max_price))))
    && EXTRA[kind].every((f) => except === f.k || !q[f.k] || f.test(x.raw, q[f.k]));
  const countBy = (except, test) => all.filter((x) => match(x, except) && test(x)).length;
  const same = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();
  const types = [...new Set([...meta.types, ...all.map((x) => x.type).filter(Boolean)])];
  const goTo = useNavigate();
  const PURPOSE_PAGES = { sale: "/sale", rent: "/rent", stay: "/stays", project: "/project", invest: "/investment/explore" };
  const setMany = (o) => { const n = new URLSearchParams(params); for (const [k, v] of Object.entries(o)) v ? n.set(k, v) : n.delete(k); setParams(n); };
  const filters = (
    <FilterRail placeholder={kind === "stay" ? "Where are you going?" : "Name, area or city"} keyword={q.keyword || ""} onKeyword={(v) => set("keyword", v)}
      active={active.length} onClear={() => setParams({})} groups={[
        { title: "Purpose", options: [["sale", "Buy"], ["rent", "Rent"], ["stay", "Stay"], ["project", "Projects"], ["invest", "Invest"]].map(([v, l]) => [v, l, null]), value: kind, onPick: (v) => goTo(v ? PURPOSE_PAGES[v] : "/search") },
        { title: "Type", options: types.map((t) => [t, t, countBy("type", (x) => same(x.type, t))]), value: q.type || "", onPick: (v) => set("type", v) },
        meta.statuses && { title: "Status", options: meta.statuses.map((s) => [s, s, countBy("status", (x) => x.status === s)]), value: q.status || "", onPick: (v) => set("status", v) },
        cities.length > 0 && { title: "City", limit: 8, options: cities.map((c) => [c, c, countBy("keyword", (x) => same(x.city, c))]), value: cities.includes(q.keyword) ? q.keyword : "", onPick: (v) => set("keyword", v) },
        { title: kind === "stay" ? "Price per night (Rs.)" : kind === "invest" ? "Minimum amount (Rs.)" : "Price (Rs.)", price: { min: q.min_price || "", max: q.max_price || "", ranges: PRICE_RANGES[kind], onRange: (a, b) => setMany({ min_price: a, max_price: b }) } },
        ...EXTRA[kind].map((f) => (f.seg
          ? { title: f.label, options: f.seg.filter(([v]) => v).map(([v, l]) => [v, l, countBy(f.k, (x) => f.test(x.raw, v))]), value: q[f.k] || "", onPick: (v) => set(f.k, v) }
          : { title: f.label, multi: true, options: f.multi.map((v) => [v, v, countBy(f.k, (x) => f.test(x.raw, v))]), value: (q[f.k] || "").split("|").filter(Boolean), onPick: (v) => flip(f.k, v) })),
      ]} />
  );
  return (
    <>
      <div className="tools-hero listings-hero"><PageHead crumbs={[{ label: meta.kicker }]} kicker={meta.kicker} title={meta.title}>{meta.text}</PageHead></div>
      <div className="container listing-layout">
        {(wide || showFilters) && filters}
        <section>
          <div className="toolbar">
            <SearchTabs />
            <div className="row" style={{ gap: 8 }}>
              {!wide && <button className="btn btn-outline btn-sm" onClick={() => setShowFilters((v) => !v)}><SlidersHorizontal size={15} /> Filters{active.length ? ` (${active.length})` : ""}</button>}
              <Link to={`/map?kind=${kind}`} className="btn btn-outline btn-sm"><MapPin size={15} /> Map</Link>
              <div style={{ width: 200 }}><Dropdown value={s} onChange={(v) => set("sort", v)} align="right" options={meta.sorts} /></div>
              <div className="seg hide-sm">
                <button className={layout === "grid" ? "on" : ""} onClick={() => setLayout("grid")} aria-label="Grid"><LayoutGrid size={15} /></button>
                <button className={layout === "list" ? "on" : ""} onClick={() => setLayout("list")} aria-label="List"><List size={15} /></button>
              </div>
            </div>
          </div>
          {active.length > 0 && <div className="row-wrap" style={{ gap: 8, marginBottom: 20 }}>{active.map((k) => <button key={k} className="chip active" style={{ height: 32 }} onClick={() => set(k, "")}>{(EXTRA[kind].find((f) => f.k === k)?.label ? `${EXTRA[kind].find((f) => f.k === k).label}: ` : "") + q[k].split("|").join(", ")}<X size={13} /></button>)}</div>}
          {!all.length ? <InviteCards kind={kind} />
            : !list.length ? <Empty icon={kind === "stay" ? BedDouble : kind === "project" ? Building2 : TrendingUp} title="Nothing matches">Try another city or remove a filter.</Empty>
            : <div className={layout === "list" ? "stack" : "grid-cards"} style={layout === "list" ? { gap: 24 } : undefined}>{list.map((it) => <Card key={it.id} it={it} layout={layout} trip={trip} />)}</div>}
        </section>
      </div>
    </>
  );
}

export default function Catalog({ kind }) { return <PlatformWrap><Inner kind={kind} /></PlatformWrap>; }
