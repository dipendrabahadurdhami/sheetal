// The big search on the home page: type tabs, one rounded bar, and a picker under each part.
// How it works: the type tiles under the bar change with the tab.

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, MapPin, CalendarDays, Users, Home, Wallet, Building2, Building, Minus, Plus, Hotel, Trees, Tent, BedDouble, Store, Briefcase, Castle, Landmark, Mountain, Tractor, Warehouse, Factory } from "lucide-react";

const TABS = [["stay", "Stay"], ["sale", "Buy"], ["rent", "Rent"], ["project", "Projects"], ["invest", "Invest"]];
const PLACES = ["Pokhara", "Kathmandu", "Lalitpur", "Bhaktapur", "Chitwan", "Nagarkot", "Lumbini", "Bandipur"];
import { PROPERTY_TYPE_NAMES } from "../utils/listingOptions";
// Every category and property type from Listing setup, plus the names old listings use (utils/listingOptions.js).
const TYPES = PROPERTY_TYPE_NAMES;
const BUY = [["", "Any budget"], ["5000000", "Up to 50 Lakh"], ["10000000", "Up to 1 Cr"], ["30000000", "Up to 3 Cr"], ["50000000", "Up to 5 Cr"]];
const RENT = [["", "Any budget"], ["20000", "Up to Rs. 20,000"], ["40000", "Up to Rs. 40,000"], ["80000", "Up to Rs. 80,000"]];
const PTYPE = ["Any project", "Apartment building", "Colony", "Villa project", "Commercial"];
const MIN = [["10000", "Rs. 10,000"], ["25000", "Rs. 25,000"], ["50000", "Rs. 50,000"], ["100000", "Rs. 1 Lakh"]];
// Type tiles under the bar change with the tab.
const TILES = {
  stay: [["Hotel", Hotel], ["Resort", Trees], ["Villa", Castle], ["Apartment", Building2], ["Homestay", Home], ["Cottage", Tent], ["Hostel", BedDouble], ["Lodge", Mountain], ["Guest house", Building]],
  sale: [["House", Home], ["Land", Trees], ["Apartment", Building2], ["Flat", Building], ["Commercial Space", Store], ["Office Space", Briefcase], ["Bungalow", Castle], ["Agricultural land", Tractor], ["Warehouse", Warehouse]],
  rent: [["House", Home], ["Flat", Building], ["Apartment", Building2], ["Room", BedDouble], ["Commercial Space", Store], ["Office Space", Briefcase], ["Bungalow", Castle], ["Shutter", Store], ["Warehouse", Warehouse]],
  project: [["Apartment building", Building2], ["Colony", Home], ["Villa project", Castle], ["Commercial complex", Store], ["Townhouses", Building], ["Plotting", Trees], ["Mixed use", Landmark], ["Industrial", Factory]],
  invest: [["Hotel", Hotel], ["Villa project", Castle], ["Colony", Home], ["Commercial", Landmark], ["Resort", Trees], ["Homestay", Home], ["Lodge", Mountain], ["Land bank", Tractor]],
};
const tileLink = (tab, t) => tab === "stay" ? `/stays?type=${encodeURIComponent(t)}` : tab === "project" ? `/project?type=${encodeURIComponent(t)}` : tab === "invest" ? `/investment/explore?type=${encodeURIComponent(t)}` : `/search?advertisement_purpose=${tab}&property_type=${encodeURIComponent(t)}`;
const iso = (d) => d.toISOString().slice(0, 10);
const nice = (s) => (s ? new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "");

function Seg({ label, value, placeholder, icon: I, active, onClick, children }) {
  return (
    <div className={`hx-seg ${active ? "on" : ""}`}>
      <button type="button" className="hx-seg-btn" onClick={onClick} aria-expanded={active}>
        <I size={18} strokeWidth={1.7} />
        <span><b>{label}</b><small className={value ? "" : "ph"}>{value || placeholder}</small></span>
      </button>
      {active && children && <div className="hx-pop">{children}</div>}
    </div>
  );
}

export function HeroSearch() {
  const nav = useNavigate();
  const box = useRef(null);
  const today = new Date();
  const [tab, setTab] = useState("stay");
  const [open, setOpen] = useState(null);
  const [where, setWhere] = useState("");
  const [from, setFrom] = useState(iso(new Date(today.getTime() + 7 * 864e5)));
  const [to, setTo] = useState(iso(new Date(today.getTime() + 10 * 864e5)));
  const [g, setG] = useState({ adults: 2, children: 0, rooms: 1 });
  const [type, setType] = useState("");
  const [budget, setBudget] = useState("");
  const [ptype, setPtype] = useState("Any project");
  const [min, setMin] = useState("10000");
  useEffect(() => { const h = (e) => box.current && !box.current.contains(e.target) && setOpen(null); document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, []);
  const nights = Math.max(1, Math.round((new Date(to) - new Date(from)) / 864e5));
  const tog = (k) => setOpen(open === k ? null : k);

  const go = () => {
    setOpen(null);
    const p = new URLSearchParams();
    if (tab === "stay") { if (where) p.set("where", where); p.set("from", from); p.set("to", to); p.set("guests", g.adults + g.children); return nav(`/stays?${p}`); }
    if (tab === "project") { if (where) p.set("city", where); if (ptype !== "Any project") p.set("type", ptype); return nav(`/project?${p}`); }
    if (tab === "invest") { if (where) p.set("city", where); p.set("min", min); return nav(`/investment/explore?${p}`); }
    if (where) p.set("keyword", where);
    p.set("advertisement_purpose", tab);
    if (type) p.set("property_type", type);
    if (budget) p.set("max_price", budget);
    nav(`/search?${p}`);
  };

  const pick = (list, val, set, next) => <div className="hx-list">{list.map(([v, l]) => <button type="button" key={v + l} className={val === v ? "on" : ""} onClick={() => { set(v); setOpen(next); }}>{l}</button>)}</div>;

  return (
    <div className="hx" ref={box}>
      <div className="hx-tabs" role="tablist">{TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => { setTab(k); setOpen(null); }}>{l}</button>)}</div>
      <div className={`hx-bar ${open ? "focus" : ""}`}>
        <Seg label="Where" icon={MapPin} value={where} placeholder="Search places" active={open === "where"} onClick={() => tog("where")}>
          <input className="input" autoFocus value={where} onChange={(e) => setWhere(e.target.value)} placeholder="City, area or property code" onKeyDown={(e) => e.key === "Enter" && go()} />
          <div className="hx-chips">{PLACES.map((x) => <button type="button" key={x} className={`chip ${where === x ? "active" : ""}`} onClick={() => { setWhere(x); setOpen(tab === "stay" ? "dates" : "type"); }}><MapPin size={14} />{x}</button>)}</div>
        </Seg>
        {tab === "stay" && <>
          <Seg label="Check in" icon={CalendarDays} value={nice(from)} placeholder="Add date" active={open === "dates"} onClick={() => tog("dates")}>
            <div className="hx-dates"><label>Check in<input type="date" className="input" min={iso(today)} value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value >= to) setTo(iso(new Date(new Date(e.target.value).getTime() + 864e5))); }} /></label>
              <label>Check out<input type="date" className="input" min={from} value={to} onChange={(e) => setTo(e.target.value)} /></label></div>
            <div className="hx-chips">{[1, 2, 3, 5, 7].map((n) => <button type="button" key={n} className={`chip ${nights === n ? "active" : ""}`} onClick={() => setTo(iso(new Date(new Date(from).getTime() + n * 864e5)))}>{n} {n === 1 ? "night" : "nights"}{n === 7 ? " · weekly price" : ""}</button>)}</div>
          </Seg>
          <Seg label="Check out" icon={CalendarDays} value={`${nice(to)} · ${nights} ${nights === 1 ? "night" : "nights"}`} placeholder="Add date" active={false} onClick={() => tog("dates")} />
          <Seg label="Who" icon={Users} value={`${g.adults + g.children} guests · ${g.rooms} ${g.rooms === 1 ? "room" : "rooms"}`} active={open === "who"} onClick={() => tog("who")}>
            {[["adults", "Adults", "13 or older", 1], ["children", "Children", "Under 13", 0], ["rooms", "Rooms", "", 1]].map(([k, l, s, lo]) => (
              <div key={k} className="hx-count"><span><b>{l}</b>{s && <small>{s}</small>}</span>
                <div><button type="button" aria-label={`Fewer ${l}`} disabled={g[k] <= lo} onClick={() => setG({ ...g, [k]: g[k] - 1 })}><Minus size={16} /></button><b>{g[k]}</b><button type="button" aria-label={`More ${l}`} onClick={() => setG({ ...g, [k]: g[k] + 1 })}><Plus size={16} /></button></div></div>
            ))}
          </Seg>
        </>}
        {(tab === "sale" || tab === "rent") && <>
          <Seg label="Property type" icon={Home} value={type} placeholder="Any type" active={open === "type"} onClick={() => tog("type")}>{pick([["", "Any type"], ...TYPES.map((x) => [x, x])], type, setType, "budget")}</Seg>
          <Seg label={tab === "rent" ? "Monthly budget" : "Budget"} icon={Wallet} value={(tab === "rent" ? RENT : BUY).find(([v]) => v === budget)?.[1]} placeholder="Any budget" active={open === "budget"} onClick={() => tog("budget")}>{pick(tab === "rent" ? RENT : BUY, budget, setBudget, null)}</Seg>
        </>}
        {tab === "project" && <Seg label="Project type" icon={Building2} value={ptype} active={open === "type"} onClick={() => tog("type")}>{pick(PTYPE.map((x) => [x, x]), ptype, setPtype, null)}</Seg>}
        {tab === "invest" && <Seg label="Minimum amount" icon={Wallet} value={MIN.find(([v]) => v === min)?.[1]} active={open === "type"} onClick={() => tog("type")}>{pick(MIN, min, setMin, null)}</Seg>}
        <button type="button" className="hx-go" onClick={go} aria-label="Search"><Search size={20} /><span>Search</span></button>
      </div>
      <nav className={`hh-types n${TILES[tab].length}`} aria-label="Browse by type">
        {TILES[tab].map(([t, I]) => <button type="button" key={t} onClick={() => nav(tileLink(tab, t))}><I size={18} strokeWidth={1.6} /><span>{t}</span></button>)}
      </nav>
    </div>
  );
}
