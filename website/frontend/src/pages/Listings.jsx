// Buy and Rent search pages: filters, sorting, results and pagination from the website API.

import { useEffect, useMemo, useState } from "react";
import { useSEO } from "../utils/seo";
import { SearchTabs } from "../components/SearchTabs";
import { useSearchParams } from "react-router-dom";
import { LayoutGrid, List, SlidersHorizontal, X, MapPin } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api/endpoints";
import { isLivePath, toList } from "../api/client";
import { useAsync, useMedia } from "../hooks/useAsync";
import { PropertyGrid } from "../components/PropertyCard";
import { PageHead, Pagination, Empty } from "../components/ui";
import { Dropdown } from "../components/Dropdown";
import { SearchFilters } from "../components/SearchFilters";
import { SortSheet } from "../components/PhoneApp";
import { platformListings, matches } from "../utils/platformDb";

const PER = 12;
const META = {
  sale: { kicker: "Buy", title: "Property for sale", text: "Houses, land and apartments for sale across Nepal.", api: "sale" },
  rent: { kicker: "Rent", title: "Property for rent", text: "Flats, houses and commercial spaces ready to move in.", api: "rent" },
  search: { kicker: "Explore", title: "All listings", text: "Search every listing on Sheetal Property." },
};
const FILTER_KEYS = ["keyword", "property_type", "category", "min_price", "max_price", "bedrooms", "property_status", "price_order"];

export default function Listings({ purpose }) {
  useSEO(purpose === "rent" ? "Property for rent in Nepal" : purpose === "sale" ? "Property for sale in Nepal" : "Search properties", purpose === "rent" ? "Houses, flats, rooms, offices and shops for rent across Nepal." : purpose === "sale" ? "Houses, land, flats and commercial property for sale across Nepal." : "Search houses, land, flats and commercial property across Nepal.");
  const [params, setParams] = useSearchParams();
  const [layout, setLayout] = useState("grid");

  const [showFilters, setShowFilters] = useState(false);
  const wide = useMedia("(min-width: 1081px)");
  const phone = useMedia("(max-width: 600px)");
  const [sortOpen, setSortOpen] = useState(false);
  const meta = META[purpose];
  const page = Number(params.get("page") || 1);
  const q = Object.fromEntries(params);
  const hasFilters = FILTER_KEYS.some((k) => q[k]) || purpose === "search";
  const key = params.toString() + purpose;

  // business listings published from Sheetal workspaces go first on page 1
  // Only without the API: listings saved in this browser by the sample business panel (never on the live site).
  const own = page > 1 || q.property_status || isLivePath("sale") ? [] : platformListings().filter((p) => {
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
  // Several filters at once (a price range), so neither change is lost.
  const setMany = (o) => {
    const n = new URLSearchParams(params);
    for (const [k, v] of Object.entries(o)) v ? n.set(k, v) : n.delete(k);
    n.delete("page");
    setParams(n);
  };
  const clear = () => setParams({});
  const active = useMemo(() => FILTER_KEYS.filter((k) => q[k] && k !== "price_order"), [key]);  

  // The panel stays mounted while filters change (no remount), so it never jumps or loses its scroll.
  const filters = <SearchFilters purpose={purpose} q={q} set={set} setMany={setMany} clear={clear} active={active} />;

  return (
    <>
      {sortOpen && <SortSheet value={q.price_order || ""} onChange={(v) => set("price_order", v)} onClose={() => setSortOpen(false)} />}
      <div className="tools-hero listings-hero"><PageHead crumbs={[{ label: meta.kicker }]} kicker={meta.kicker} title={meta.title}>{meta.text}</PageHead></div>
      <div className="container listing-layout">
        {wide && filters}
        {!wide && showFilters && (
          <div className="pa-sheet" role="dialog" aria-label="All filters">
            <div className="pa-sheet-top"><button type="button" className="pa-ib" aria-label="Close filters" onClick={() => setShowFilters(false)}><X size={22} /></button><b>All filters</b><span style={{ width: 44 }} /></div>
            <div className="pa-sheet-body">{filters}</div>
            <div className="pa-sheet-bar"><button type="button" className="pa-clear" onClick={clear}>Clear all</button><button type="button" className="btn btn-primary pa-show" onClick={() => setShowFilters(false)}>{loading ? "Show results" : `Show ${(data?.total ?? 0).toLocaleString("en-IN")} results`}</button></div>
          </div>
        )}
        <section>
          <div className="toolbar">
            <SearchTabs />
            <div className="row" style={{ gap: 8 }}>
              {!wide && <button className="btn btn-outline btn-sm" onClick={() => setShowFilters((s) => !s)}><SlidersHorizontal size={15} /> Filters{active.length ? ` (${active.length})` : ""}</button>}
              <Link to={`/map${purpose === "sale" || purpose === "rent" ? `?advertisement_purpose=${purpose}` : ""}`} className="btn btn-outline btn-sm"><MapPin size={15} /> Map</Link>
              {phone
                ? <button className="btn btn-outline btn-sm" onClick={() => setSortOpen(true)}>Sort{q.price_order ? " ·" : ""}</button>
                : <div style={{ width: 200 }}><Dropdown value={q.price_order || ""} onChange={(v) => set("price_order", v)} align="right" options={[["", "Newest first"], ["low_to_high", "Price: low to high"], ["high_to_low", "Price: high to low"], ["oldest", "Oldest first"]]} /></div>}
              <div className="seg hide-sm">
                <button className={layout === "grid" ? "on" : ""} onClick={() => setLayout("grid")} aria-label="Grid"><LayoutGrid size={15} /></button>
                <button className={layout === "list" ? "on" : ""} onClick={() => setLayout("list")} aria-label="List"><List size={15} /></button>
              </div>
            </div>
          </div>
          {phone && !loading && data?.total > 0 && <div className="pa-count"><b>{data.total.toLocaleString("en-IN")}</b> places {purpose === "rent" ? "for rent" : purpose === "sale" ? "for sale" : "found"}</div>}
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
