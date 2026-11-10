// The filter sidebar every search page uses (Buy, Rent, Search, Stays, Projects, Investments): a search box that
// searches as you type, then short lists with a count beside every choice, like the big booking sites.
// Where it fits: Listings.jsx (sale, rent, search) uses <SearchFilters>, with counts from the website API
// (GET /search/facets). Catalog.jsx (stays, projects, investments) builds its own groups and uses <FilterRail>.
// How it works: the panel stays mounted while filters change, so it never jumps, flickers or loses its scroll; on wide
// screens it is sticky under the header with its own scroll, on small screens a plain block under the Filters button.
// Each list counts what matches all the other filters, so picking one choice never empties the rest of its list.

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { request } from "../api/client";
import { PROPERTY_TYPE_NAMES } from "../utils/listingOptions";
import "./SearchFilters.css";

const L = 1e5, CR = 1e7;
/** Quick price ranges per page: [min, max, label]. */
export const PRICE_RANGES = {
  sale: [["", 50 * L, "Under 50 lakh"], [50 * L, CR, "50 lakh – 1 crore"], [CR, 2 * CR, "1 – 2 crore"], [2 * CR, 5 * CR, "2 – 5 crore"], [5 * CR, "", "Over 5 crore"]],
  rent: [["", 20000, "Under 20,000"], [20000, 50000, "20,000 – 50,000"], [50000, L, "50,000 – 1 lakh"], [L, "", "Over 1 lakh"]],
  stay: [["", 3000, "Under 3,000 a night"], [3000, 6000, "3,000 – 6,000"], [6000, 10000, "6,000 – 10,000"], [10000, "", "Over 10,000"]],
  project: [["", 50 * L, "Under 50 lakh"], [50 * L, CR, "50 lakh – 1 crore"], [CR, 2 * CR, "1 – 2 crore"], [2 * CR, "", "Over 2 crore"]],
  invest: [["", 25000, "Under 25,000"], [25000, L, "25,000 – 1 lakh"], [L, 5 * L, "1 – 5 lakh"], [5 * L, "", "Over 5 lakh"]],
};

function Group({ title, children }) {
  return <section className="sf-g"><h4 className="sf-h"><span>{title}</span></h4>{children}</section>;
}

/** options: [value, label, count]. One choice (tick again to remove), or several with `multi` (value is an array). */
export function Checks({ options, value, onPick, limit = 6, multi = false }) {
  const [all, setAll] = useState(false);
  const isOn = (v) => (multi ? (value || []).includes(v) : value === v);
  const shown = all ? options : options.slice(0, limit);
  for (const o of options) if (isOn(o[0]) && !shown.includes(o)) shown.push(o);
  return (
    <ul className="sf-list">
      {shown.map(([v, label, n]) => {
        const on = isOn(v);
        return (
          <li key={String(v)}>
            <label className={`sf-row${on ? " on" : ""}${n === 0 && !on ? " none" : ""}`}>
              <input type="checkbox" checked={on} onChange={() => onPick(multi ? v : on ? "" : v)} />
              <span className="sf-l">{label}</span>
              {n != null && <span className="sf-n tnum">{n.toLocaleString("en-IN")}</span>}
            </label>
          </li>
        );
      })}
      {options.length > limit && <li><button type="button" className="sf-more" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${options.length}`}</button></li>}
    </ul>
  );
}

/** Min and max boxes plus quick ranges; changes both at once through onRange(min, max). */
export function PriceBox({ min: minNow = "", max: maxNow = "", ranges = PRICE_RANGES.sale, onRange }) {
  const [min, setMin] = useState(minNow);
  const [max, setMax] = useState(maxNow);
  useEffect(() => { setMin(minNow); setMax(maxNow); }, [minNow, maxNow]);
  const apply = () => { if (String(min) !== String(minNow) || String(max) !== String(maxNow)) onRange(min, max); };
  const now = ranges.find(([a, b]) => String(a) === String(minNow) && String(b) === String(maxNow));
  return (
    <>
      <div className="sf-price">
        <input className="tnum" inputMode="numeric" placeholder="Min" aria-label="Minimum price" value={min} onChange={(e) => setMin(e.target.value.replace(/\D/g, ""))} onBlur={apply} onKeyDown={(e) => e.key === "Enter" && apply()} />
        <input className="tnum" inputMode="numeric" placeholder="Max" aria-label="Maximum price" value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, ""))} onBlur={apply} onKeyDown={(e) => e.key === "Enter" && apply()} />
      </div>
      <Checks options={ranges.map(([a, b, l]) => [`${a}-${b}`, l, null])} value={now ? `${now[0]}-${now[1]}` : ""} limit={6}
        onPick={(v) => { const [a, b] = v ? v.split("-") : ["", ""]; onRange(a, b); }} />
    </>
  );
}

/** The panel: search box, "Clear all", then the groups. A group is { title, options, value, onPick, multi, limit }
 *  or { title, price: { min, max, ranges, onRange } }. */
export function FilterRail({ placeholder = "Locality, city or #code", keyword = "", onKeyword, active = 0, onClear, groups }) {
  const [kw, setKw] = useState(keyword);
  const rail = useRef(null);
  const typing = useRef(false);
  // The box follows the address (back button, Clear all) unless the person is typing in it.
  useEffect(() => { if (!typing.current) setKw(keyword); }, [keyword]);
  // Searches a moment after typing stops, so every key press doesn't reload the list.
  useEffect(() => {
    if (!typing.current) return undefined;
    const t = setTimeout(() => { typing.current = false; if (kw.trim() !== keyword) onKeyword(kw.trim()); }, 450);
    return () => clearTimeout(t);
  }, [kw]);
  return (
    <aside ref={rail} className="sfilters" aria-label="Filters">
      <div className="sf-top">
        <label className="sf-search">
          <Search size={15} aria-hidden="true" />
          <input value={kw} placeholder={placeholder} aria-label={placeholder}
            onChange={(e) => { typing.current = true; setKw(e.target.value); }}
            onKeyDown={(e) => { if (e.key === "Enter") { typing.current = false; onKeyword(kw.trim()); } }} />
          {kw && <button type="button" className="sf-x" aria-label="Clear search" onClick={() => { typing.current = false; setKw(""); onKeyword(""); }}><X size={13} /></button>}
        </label>
        {active > 0 && <button type="button" className="sf-clear" onClick={onClear}>Clear all ({active})</button>}
      </div>
      <div className="sf-body">{groups.filter(Boolean).map((g) => (
        <Group key={g.title} title={g.title}>
          {g.price ? <PriceBox {...g.price} /> : <Checks options={g.options} value={g.value} onPick={g.onPick} multi={g.multi} limit={g.limit} />}
        </Group>
      ))}</div>
    </aside>
  );
}

function useFacets(q, purpose) {
  const [facets, setFacets] = useState(null);
  const params = { ...q };
  delete params.page; delete params.price_order;
  if (purpose === "sale" || purpose === "rent") params.advertisement_purpose = purpose;
  const key = JSON.stringify(params);
  useEffect(() => {
    let gone = false;
    const t = setTimeout(() => {
      request("get", "search/facets", { params }).then((r) => { if (!gone) setFacets(r?.data && !Array.isArray(r.data) ? r.data : null); }).catch(() => {});
    }, 120);
    return () => { gone = true; clearTimeout(t); };
  }, [key]);
  return facets;
}

const CATS = ["House", "Apartment", "Land", "Commercial"];
const STATUS = [["AVAILABLE", "Available"], ["SOLD OUT", "Sold out"], ["RENTED OUT", "Rented out"]];
const BEDS = ["1", "2", "3", "4", "5"];

/** Buy, Rent and Search: counts from the website API. */
export function SearchFilters({ purpose, q, set, setMany, clear, active }) {
  const f = useFacets(q, purpose);
  const nav = useNavigate();
  // Stay, Projects and Invest have their own pages: picking one goes there (a place typed in the search comes along).
  const PAGES = { stay: "/stays", project: "/project", invest: "/investment/explore" };
  const pickPurpose = (v) => { if (purpose !== "search" && v !== "stay" && v !== "project" && v !== "invest") { nav(v ? `/${v}` : "/search"); return; } if (PAGES[v]) { const k = v === "stay" ? "where" : v === "invest" ? "city" : "keyword"; nav(q.keyword ? `${PAGES[v]}?${k}=${encodeURIComponent(q.keyword)}` : PAGES[v]); } else set("advertisement_purpose", v); };
  const counted = (list) => (list || []).map((x) => [x.name, x.name, x.count]);
  const pricePurpose = purpose === "search" ? q.advertisement_purpose : purpose;
  return (
    <FilterRail keyword={q.keyword || ""} onKeyword={(v) => set("keyword", v)} active={active.length} onClear={clear} groups={[
      { title: "Purpose", options: [["sale", "Buy", f?.purpose ? f.purpose.sale : null], ["rent", "Rent", f?.purpose ? f.purpose.rent : null], ["stay", "Stay", null], ["project", "Projects", null], ["invest", "Invest", null]], value: purpose === "search" ? q.advertisement_purpose || "" : purpose, onPick: pickPurpose },
      { title: "Property type", limit: 8, options: f?.property_type?.length ? counted(f.property_type) : PROPERTY_TYPE_NAMES.map((t) => [t, t, null]), value: q.property_type || "", onPick: (v) => set("property_type", v) },
      { title: "Price (Rs.)", price: { min: q.min_price || "", max: q.max_price || "", ranges: PRICE_RANGES[pricePurpose === "rent" ? "rent" : "sale"], onRange: (a, b) => setMany({ min_price: a, max_price: b }) } },
      { title: "Bedrooms", options: BEDS.map((b) => [b, `${b}+ bedrooms`, f?.bedrooms ? f.bedrooms[b] ?? 0 : null]), value: q.bedrooms || "", onPick: (v) => set("bedrooms", v) },
      { title: "Category", options: f?.category?.length ? counted(f.category) : CATS.map((c) => [c, c, null]), value: q.category || "", onPick: (v) => set("category", v) },
      { title: "Availability", options: STATUS.map(([v, l]) => [v, l, f?.property_status ? f.property_status[v] ?? 0 : null]), value: q.property_status || "", onPick: (v) => set("property_status", v) },
    ]} />
  );
}
