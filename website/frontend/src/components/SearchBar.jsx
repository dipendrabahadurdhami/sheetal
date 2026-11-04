// The search bar on listing pages: location, type, price and more, kept in the page address.

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, MapPin, Building2, Landmark, Home } from "lucide-react";
import { api } from "../api/endpoints";
import { Dropdown } from "./Dropdown";

const TYPES = ["House", "Land", "Apartment", "Flat", "Commercial Space", "Office Space", "Bungalow"];
const BUDGETS = {
  sale: [["", "Any budget"], ["2500000", "Up to 25 Lakh"], ["5000000", "Up to 50 Lakh"], ["7500000", "Up to 75 Lakh"], ["10000000", "Up to 1 Cr"], ["15000000", "Up to 1.5 Cr"], ["20000000", "Up to 2 Cr"], ["30000000", "Up to 3 Cr"], ["50000000", "Up to 5 Cr"], ["100000000", "Up to 10 Cr"], ["200000000", "Up to 20 Cr"]],
  rent: [["", "Any budget"], ["10000", "Up to 10K / mo"], ["15000", "Up to 15K / mo"], ["25000", "Up to 25K / mo"], ["35000", "Up to 35K / mo"], ["50000", "Up to 50K / mo"], ["75000", "Up to 75K / mo"], ["100000", "Up to 1 Lakh / mo"], ["200000", "Up to 2 Lakh / mo"], ["500000", "Up to 5 Lakh / mo"]],
};

const POPULAR = ["Kathmandu", "Lalitpur", "Bhaktapur", "Pokhara", "Chitwan"];

export function SearchBar({ initialPurpose = "rent", compact, variant }) {
  const nav = useNavigate();
  const [purpose, setPurpose] = useState(initialPurpose);
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [max, setMax] = useState("");
  const [open, setOpen] = useState(false);
  const [sugg, setSugg] = useState(null);
  const wrap = useRef(null);

  // lists fill exactly down to the bottom of the banner
  useEffect(() => {
    const fit = () => {
      const bar = wrap.current?.querySelector(".search, .hs-form, .hs2-bar");
      const hero = wrap.current?.closest(".home-search");
      if (!bar || !hero) return;
      const room = hero.getBoundingClientRect().bottom - bar.getBoundingClientRect().bottom;
      bar.style.setProperty("--dd-room", `${Math.max(160, Math.floor(room))}px`);
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (wrap.current?.closest(".home-search")) ro.observe(wrap.current.closest(".home-search"));
    window.addEventListener("resize", fit);
    return () => { ro.disconnect(); window.removeEventListener("resize", fit); };
  }, []);
  useEffect(() => {
    const h = (e) => !wrap.current?.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => api.suggestions(q.trim()).then(setSugg).catch(() => setSugg(null)), 220);
    return () => clearTimeout(t);
  }, [q, open]);

  const go = (keyword = q) => {
    if (purpose === "investment") { setOpen(false); nav("/investment" + (keyword ? `?city=${encodeURIComponent(keyword)}` : "") + "#invest-list"); return; }
    if (purpose === "stay") { setOpen(false); nav("/stays" + (keyword ? `?where=${encodeURIComponent(keyword)}` : "")); return; }
    const p = new URLSearchParams();
    if (keyword) p.set("keyword", keyword);
    p.set("advertisement_purpose", purpose);
    if (type) p.set("property_type", type);
    if (max) p.set("max_price", max);
    setOpen(false);
    nav(`/search?${p}`);
  };

  const groups = sugg ? [
    ["Districts", sugg.districts, Landmark], ["Cities", sugg.cities, Building2],
    ["Localities", sugg.localities, MapPin], ["Properties", sugg.properties, Home],
  ].filter(([, l]) => l?.length) : [];

  const suggest = open && groups.length > 0 && (
    <div className="suggest">
      {groups.map(([label, list, Icon]) => (
        <div key={label}>
          <h6>{label}</h6>
          {list.slice(0, 5).map((it, i) => (
            <button type="button" key={label + i} onClick={() => { setQ(it.name); go(it.name); }}>
              <Icon size={16} className="sg-ico" />
              <span className="sg-name">{it.name}</span>{it.locality && <span className="sg-sub">{it.locality}</span>}
            </button>
          ))}
        </div>
      ))}
    </div>
  );

  if (variant === "hero") return (
    <div className="hs2" ref={wrap}>
      <form className="hs2-bar" onSubmit={(e) => { e.preventDefault(); go(); }}>
        <div className="hs2-seg" role="tablist">
          {[["sale", "Buy"], ["rent", "Rent"], ["stay", "Stay"], ["investment", "Invest"]].map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={purpose === k} className={purpose === k ? "on" : ""} onClick={() => { setPurpose(k); setMax(""); }}>{l}</button>
          ))}
        </div>
        <div className="hs2-where">
          <MapPin size={17} className="hs2-ico" />
          <input aria-label="Where" value={q} placeholder="City, locality or property code" autoComplete="off"
            onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} />
          {suggest}
        </div>
        <div className="hs2-type">
          <Dropdown bare id="hs2-type" value={type} onChange={setType} options={[["", "Any type"], ...TYPES.map((t) => [t, t])]} />
        </div>
        <button className="hs2-go" type="submit" aria-label="Search"><Search size={18} /></button>
      </form>
    </div>
  );

  return (
    <div className="search-wrap" ref={wrap}>
      {!compact && (
        <div className="search-tabs" role="tablist">
          {[["sale", "Buy"], ["rent", "Rent"], ["stay", "Stay"], ["investment", "Invest"]].map(([k, l]) => (
            <button key={k} role="tab" aria-selected={purpose === k} className={purpose === k ? "on" : ""} onClick={() => { setPurpose(k); setMax(""); }}>{l}</button>
          ))}
        </div>
      )}
      <form className="search" onSubmit={(e) => { e.preventDefault(); go(); }}>
        <div className="search-cell">
          <label htmlFor="s-where">Where</label>
          <input id="s-where" value={q} placeholder="City, locality or property code" autoComplete="off"
            onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} />
          {open && groups.length > 0 && (
            <div className="suggest">
              {groups.map(([label, list, Icon]) => (
                <div key={label}>
                  <h6>{label}</h6>
                  {list.slice(0, 5).map((it, i) => (
                    <button type="button" key={label + i} onClick={() => { setQ(it.name); go(it.name); }}>
                      <Icon size={16} className="sg-ico" />
                      <span className="sg-name">{it.name}</span>{it.locality && <span className="sg-sub">{it.locality}</span>}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="search-cell">
          <label htmlFor="s-type">Type</label>
          <Dropdown bare id="s-type" value={type} onChange={setType} options={[["", "All property types"], ...TYPES.map((t) => [t, t])]} />
        </div>
        <div className="search-cell">
          <label htmlFor="s-budget">Budget</label>
          <Dropdown bare id="s-budget" value={max} onChange={setMax} options={BUDGETS[purpose] || BUDGETS.sale} />
        </div>
        <button className="btn btn-primary" type="submit"><Search size={18} /> Search</button>
      </form>
    </div>
  );
}
