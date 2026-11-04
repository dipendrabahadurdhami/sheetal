// Buy and Rent search pages: filters, sorting, results and pagination from the website API.

import { useEffect, useMemo, useState } from "react";
import { useSEO } from "../utils/seo";
import { SearchTabs } from "../components/SearchTabs";
import { useSearchParams } from "react-router-dom";
import { LayoutGrid, List, SlidersHorizontal, X , Search, MapPin } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api/endpoints";
import { toList } from "../api/client";
import { useAsync, useMedia } from "../hooks/useAsync";
import { PropertyGrid } from "../components/PropertyCard";
import { PageHead, Pagination, Empty } from "../components/ui";
import { Dropdown } from "../components/Dropdown";
import { FGroup, FScroll, Opts, PriceRange, useGroups } from "../components/FilterPanel";
import { platformListings, matches } from "../utils/platformDb";

const PER = 12;
const META = {
  sale: { kicker: "Buy", title: "Property for sale", text: "Houses, land and apartments for sale across Nepal.", api: "sale" },
  rent: { kicker: "Rent", title: "Property for rent", text: "Flats, houses and commercial spaces ready to move in.", api: "rent" },
  search: { kicker: "Explore", title: "All listings", text: "Search every listing on Sheetal Property." },
};
const TYPES = ["House", "Land", "Apartment", "Flat", "Commercial Space", "Office Space", "Bungalow"];
const CATS = ["Residential", "Commercial", "Semi-Commercial", "Agricultural"];
const FILTER_KEYS = ["keyword", "property_type", "category", "min_price", "max_price", "bedrooms", "property_status", "price_order"];

export default function Listings({ purpose }) {
  useSEO(purpose === "rent" ? "Property for rent in Nepal" : purpose === "sale" ? "Property for sale in Nepal" : "Search properties", purpose === "rent" ? "Houses, flats, rooms, offices and shops for rent across Nepal." : purpose === "sale" ? "Houses, land, flats and commercial property for sale across Nepal." : "Search houses, land, flats and commercial property across Nepal.");
  const [params, setParams] = useSearchParams();
  const [layout, setLayout] = useState("grid");

  // when the sticky filters start sliding up (end of list), slide the sticky toolbar up by the same amount
  useEffect(() => {
    const onScroll = () => {
      const f = document.querySelector(".listing-layout .filters");
      const tb = document.querySelector(".listing-layout .toolbar");
      if (!f || !tb) return;
      const stickTop = parseFloat(getComputedStyle(f).top) || 0;
      const lift = Math.min(0, f.getBoundingClientRect().top - stickTop);
      tb.style.transform = lift < -0.5 && getComputedStyle(f).position === "sticky" ? `translateY(${lift}px)` : "";
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); };
  }, []);
  const [showFilters, setShowFilters] = useState(false);
  const g = useGroups(["type", "price", "beds"]);
  const wide = useMedia("(min-width: 1081px)");
  const meta = META[purpose];
  const page = Number(params.get("page") || 1);
  const q = Object.fromEntries(params);
  const hasFilters = FILTER_KEYS.some((k) => q[k]) || purpose === "search";
  const key = params.toString() + purpose;

  // business listings published from Sheetal workspaces go first on page 1
  const own = page > 1 || q.property_status ? [] : platformListings().filter((p) => {
    const want = purpose === "search" ? q.advertisement_purpose : purpose;
    return (!want || p.purpose.toLowerCase() === want) && matches(p, q);
  });
  const { data, loading } = useAsync(() => {
    const add = (r) => ({ ...r, items: [...own, ...(r?.items || []).filter((x) => !own.some((o) => o.id === x.id))] });
    if (!hasFilters) return api.byPurpose(purpose, page, PER).then(toList).then(add, () => ({ items: own }));
    const p = { ...q, page, per_page: PER };
    if (purpose !== "search") p.advertisement_purpose = meta.api;
    return api.search(p).then(toList).then(add, () => ({ items: own }));
  }, [key]);

  const set = (k, v) => {
    const n = new URLSearchParams(params);
    v ? n.set(k, v) : n.delete(k);
    n.delete("page");
    setParams(n);
  };
  const clear = () => setParams({});
  const active = useMemo(() => FILTER_KEYS.filter((k) => q[k] && k !== "price_order"), [key]);  

  const filters = (
    <aside className="filters" key={key}>
      <div className="field filter-kw">
        <Search size={16} className="filter-kw-ico" />
        <input className="input" aria-label="Keyword" placeholder="Locality, city or #code" defaultValue={q.keyword || ""}
          onKeyDown={(e) => e.key === "Enter" && set("keyword", e.currentTarget.value)} onBlur={(e) => e.currentTarget.value !== (q.keyword || "") && set("keyword", e.currentTarget.value)} />
      </div>
      <FScroll><div className="fx-list">
        {purpose === "search" && <FGroup label="Purpose" count={q.advertisement_purpose ? 1 : 0} open={g.isOpen("purpose") || !!q.advertisement_purpose} onToggle={() => g.toggle("purpose")}>
          <Opts options={[["", "Any"], ["sale", "Buy"], ["rent", "Rent"]]} value={q.advertisement_purpose} onPick={(v) => set("advertisement_purpose", v)} /></FGroup>}
        <FGroup label="Property type" count={q.property_type ? 1 : 0} open={g.isOpen("type") || !!q.property_type} onToggle={() => g.toggle("type")}>
          <Opts options={[["", "Any type"], ...TYPES.map((t) => [t, t])]} value={q.property_type} onPick={(v) => set("property_type", v)} /></FGroup>
        <FGroup label="Price (Rs.)" count={(q.min_price ? 1 : 0) + (q.max_price ? 1 : 0)} open={g.isOpen("price") || !!(q.min_price || q.max_price)} onToggle={() => g.toggle("price")}>
          <PriceRange min={q.min_price} max={q.max_price} onMin={(v) => set("min_price", v)} onMax={(v) => set("max_price", v)} /></FGroup>
        <FGroup label="Bedrooms" count={q.bedrooms ? 1 : 0} open={g.isOpen("beds") || !!q.bedrooms} onToggle={() => g.toggle("beds")}>
          <Opts options={[["", "Any"], ...["1", "2", "3", "4", "5"].map((b) => [b, `${b}+ bedrooms`])]} value={q.bedrooms} onPick={(v) => set("bedrooms", v)} /></FGroup>
        <FGroup label="Category" count={q.category ? 1 : 0} open={g.isOpen("cat") || !!q.category} onToggle={() => g.toggle("cat")}>
          <Opts options={[["", "All categories"], ...CATS.map((c) => [c, c])]} value={q.category} onPick={(v) => set("category", v)} /></FGroup>
        <FGroup label="Availability" count={q.property_status ? 1 : 0} open={g.isOpen("avail") || !!q.property_status} onToggle={() => g.toggle("avail")}>
          <Opts options={[["", "Any"], ["AVAILABLE", "Available"], ["SOLD OUT", "Sold out"], ["RENTED OUT", "Rented out"]]} value={q.property_status} onPick={(v) => set("property_status", v)} /></FGroup>
      </div></FScroll>
      {active.length > 0 && <div className="fx-foot"><button className="btn btn-outline btn-block" onClick={clear}><X size={15} /> Clear filters ({active.length})</button></div>}
    </aside>
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
              {!wide && <button className="btn btn-outline btn-sm" onClick={() => setShowFilters((s) => !s)}><SlidersHorizontal size={15} /> Filters{active.length ? ` (${active.length})` : ""}</button>}
              <Link to={`/map${purpose === "sale" || purpose === "rent" ? `?advertisement_purpose=${purpose}` : ""}`} className="btn btn-outline btn-sm"><MapPin size={15} /> Map</Link>
              <div style={{ width: 200 }}><Dropdown value={q.price_order || ""} onChange={(v) => set("price_order", v)} align="right" options={[["", "Newest first"], ["low_to_high", "Price: low to high"], ["high_to_low", "Price: high to low"], ["oldest", "Oldest first"]]} /></div>
              <div className="seg hide-sm">
                <button className={layout === "grid" ? "on" : ""} onClick={() => setLayout("grid")} aria-label="Grid"><LayoutGrid size={15} /></button>
                <button className={layout === "list" ? "on" : ""} onClick={() => setLayout("list")} aria-label="List"><List size={15} /></button>
              </div>
            </div>
          </div>
          {active.length > 0 && (
            <div className="row-wrap" style={{ gap: 8, marginBottom: 20 }}>
              {active.map((k) => <button key={k} className="chip active" style={{ height: 32 }} onClick={() => set(k, "")}>{q[k]}<X size={13} /></button>)}
            </div>
          )}
          {!loading && !data?.items?.length
            ? <Empty title="No properties match">Try a nearby locality or remove a filter.</Empty>
            : <PropertyGrid loading={loading} items={data?.items || []} count={9} layout={layout} />}
          <Pagination page={page} last={data?.last} onChange={(n) => { const p = new URLSearchParams(params); p.set("page", n); setParams(p); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
        </section>
      </div>
    </>
  );
}
