// The phone app parts: the compact Home top (search pill, type chips, banner, quick grid), the full-screen search,
// and the side menu with groups that open one at a time. They only show on phones (see "Phone app" in theme.css).
// Where it fits: Home.jsx shows PhoneHomeTop instead of the big hero on a phone; Layout.jsx shows PhoneMenu as the menu.

import { Children, cloneElement, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Menu, Search, SlidersHorizontal, X, ArrowLeft, Clock, MapPin, Navigation, Home, KeyRound, BedDouble, Building2, TrendingUp, Map as MapIcon, Plus, ClipboardList, ChevronDown, ChevronRight, Compass, Wallet, Scale, Ruler, Calculator, Newspaper, Briefcase, Phone, MessageCircle, User, Sun, Moon, Droplet, HandCoins, Users, Images, Info, BadgeCheck, ExternalLink, Tag, Landmark, Receipt, HelpCircle, Layers } from "lucide-react";
import { api } from "../api/endpoints";
import { toList } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { useApp } from "../context/AppContext";
import { fmtPrice, linkOf, titleOf, agencyName } from "../utils/format";
import { THEMES } from "@sheetal/shared/core/theme";

/** A sideways strip that goes round like a circle: the cards are repeated three times and the scroll is moved back
 *  by one copy whenever you reach either end, so you never hit a wall. With fewer than three cards it is a plain strip. */
export function LoopStrip({ className, children }) {
  const ref = useRef(null);
  const kids = Children.toArray(children);
  const n = kids.length;
  const loop = n >= 3;
  const items = loop ? [0, 1, 2].flatMap((c) => kids.map((k) => cloneElement(k, { key: `${k.key}__${c}` }))) : kids;
  const geo = () => {
    const el = ref.current;
    if (!el || !el.children[n]) return null;
    const base2 = el.children[n].offsetLeft - parseFloat(getComputedStyle(el).paddingLeft || 0);
    const w = el.children[n].offsetLeft - el.children[0].offsetLeft;
    return { base2, w };
  };
  useLayoutEffect(() => {
    if (!loop) return;
    const g = geo();
    if (g) ref.current.scrollLeft = g.base2;
  }, [n, loop]);
  const onScroll = () => {
    if (!loop) return;
    const el = ref.current, g = geo();
    if (!g) return;
    const base1 = g.base2 - g.w, base3 = g.base2 + g.w;
    if (el.scrollLeft <= base1 + 1) el.scrollLeft += g.w;
    else if (el.scrollLeft >= base3 - 1) el.scrollLeft -= g.w;
  };
  return <div ref={ref} className={`${className}${loop ? " pa-loop" : ""}`} onScroll={onScroll}>{items}</div>;
}

/** The logo for the phone bars: the mark, and SHEETAL over PROPERTY set to exactly the same width. */
export function PhoneLogo() {
  return (
    <Link to="/" className="pa-logo" aria-label="Sheetal Property home">
      <img src="/brand/logo-mark.png" alt="" />
      <svg viewBox="0 0 112 32" width="112" height="32" aria-hidden="true" focusable="false">
        <text x="0" y="14" textLength="112" lengthAdjust="spacing" className="pa-lw1">SHEETAL</text>
        <text x="0" y="29" textLength="112" lengthAdjust="spacing" className="pa-lw2">PROPERTY</text>
      </svg>
    </Link>
  );
}

/** While a full-screen layer is open, the page behind it must not scroll (only the layer does). */
function useLock() {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("pa-lock");
    return () => root.classList.remove("pa-lock");
  }, []);
}

const PLACES = ["Kathmandu", "Lalitpur", "Bhaktapur", "Pokhara", "Chitwan", "Nagarkot", "Lumbini", "Bandipur"];
const RECENT = "sheetal.recent.searches";
const recent = () => { try { return JSON.parse(localStorage.getItem(RECENT)) || []; } catch { return []; } };
const remember = (t) => { try { localStorage.setItem(RECENT, JSON.stringify([t, ...recent().filter((x) => x !== t)].slice(0, 5))); } catch { /* storage blocked */ } };

/** Full-screen search: recent, popular places, live suggestions, code search (#SP-0006). */
export function PhoneSearch({ onClose }) {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [items, setItems] = useState([]);
  const [rec, setRec] = useState(recent);
  const box = useRef(null);
  useLock();
  useEffect(() => { box.current?.focus(); }, []);
  const s = q.trim();
  useEffect(() => {
    if (s.length < 2) { setItems([]); return undefined; }
    let live = true;
    const t = setTimeout(() => {
      api.search({ keyword: s.replace(/^#/, ""), per_page: 6 }).then(toList).then((r) => live && setItems(r.items || [])).catch(() => live && setItems([]));
    }, 220);
    return () => { live = false; clearTimeout(t); };
  }, [s]);
  const go = (to, text) => { if (text) remember(text); onClose(); nav(to); };
  const goText = (t) => go(`/search?keyword=${encodeURIComponent(t)}`, t);
  const Bold = ({ t }) => { const i = t.toLowerCase().indexOf(s.toLowerCase()); return i < 0 || !s ? <>{t}</> : <>{t.slice(0, i)}<b>{t.slice(i, i + s.length)}</b>{t.slice(i + s.length)}</>; };
  return (
    <div className="pa-full" role="dialog" aria-label="Search">
      <form className="pa-sbar" onSubmit={(e) => { e.preventDefault(); if (s) goText(s); }}>
        <button type="button" className="pa-ib" aria-label="Back" onClick={onClose}><ArrowLeft size={22} /></button>
        <input ref={box} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search homes, stays, land, projects" enterKeyHint="search" aria-label="Search" />
        {q && <button type="button" className="pa-ib" aria-label="Clear" onClick={() => { setQ(""); box.current?.focus(); }}><X size={20} /></button>}
      </form>
      <div className="pa-sbody">
        {s.length < 2 ? <>
          <button className="pa-row" onClick={() => go("/map")}><span className="pa-ico"><Navigation size={18} /></span><span className="pa-t">Near me<small>Show places around you</small></span><ChevronRight size={16} /></button>
          {rec.length > 0 && <><div className="pa-gh">Recent</div>
            {rec.map((t) => <div key={t} className="pa-row"><button className="pa-row-in" onClick={() => goText(t)}><span className="pa-ico"><Clock size={18} /></span><span className="pa-t">{t}</span></button><button className="pa-ib" aria-label="Remove" onClick={() => { localStorage.setItem(RECENT, JSON.stringify(rec.filter((x) => x !== t))); setRec(recent()); }}><X size={16} /></button></div>)}</>}
          <div className="pa-gh">Popular places</div>
          <div className="pa-chips">{PLACES.map((c) => <button key={c} className="pa-chip" onClick={() => goText(c)}>{c}</button>)}</div>
          <div className="pa-gh">Find by code</div>
          <div className="pa-row"><span className="pa-ico"><Search size={18} /></span><span className="pa-t">Type a code such as #SP-0006<small>Jumps straight to that listing</small></span></div>
        </> : <>
          <div className="pa-gh">Places</div>
          <button className="pa-row" onClick={() => goText(s)}><span className="pa-ico"><MapPin size={18} /></span><span className="pa-t">Search "<Bold t={s} />" in everything</span><ChevronRight size={16} /></button>
          {items.length > 0 && <div className="pa-gh">Properties</div>}
          {items.map((p) => <button key={p.id} className="pa-row" onClick={() => go(linkOf(p), s)}><span className="pa-ico"><Home size={18} /></span><span className="pa-t"><Bold t={titleOf(p)} /><small>{p.property_code ? `#${p.property_code} · ` : ""}{fmtPrice(p.rent_per_month || p.total_price || p.price)}</small></span></button>)}
        </>}
      </div>
    </div>
  );
}

const TYPES = [["All", "/search"], ["Buy", "/sale"], ["Rent", "/rent"], ["Stays", "/stays"], ["Projects", "/project"], ["Invest", "/investment/explore"]];
const QUICK = [[Home, "Buy", "/sale"], [KeyRound, "Rent", "/rent"], [BedDouble, "Stays", "/stays"], [Building2, "Projects", "/project"], [TrendingUp, "Invest", "/investment/explore"], [MapIcon, "Map", "/map"], [ClipboardList, "Requirement", "/requirement"], [Menu, "More", "#menu", true]];
const adLink = { fontSize: 12, textDecoration: "underline", textUnderlineOffset: 3 };

const SLIDES = [[KeyRound, "Pay rent online", "Find your lease and pay in minutes", "Pay rent", "/services/pay-rent"], [Landmark, "Home loan", "Compare banks and see your EMI", "Compare", "/services/home-loan"], [Scale, "Legal help", "Land papers, agreements, transfers", "Get help", "/services/legal-help"], [Building2, "Property management", "We look after your tenants", "Learn more", "/services/management"], [Ruler, "Property valuation", "Find out what your property is worth", "Request", "/services/valuation"]];

/** With no paid banner, our own services slide by on their own: no arrows, no dots, one tap opens the service. */
function ServiceSlides() {
  const box = useRef(null);
  useEffect(() => {
    const el = box.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    let k = 0;
    const t = setInterval(() => { k = (k + 1) % SLIDES.length; el.scrollTo({ left: k * el.clientWidth, behavior: "smooth" }); }, 4000);
    return () => clearInterval(t);
  }, []);
  return (
    <>
      <div className="pa-slides" ref={box}>
        {SLIDES.map(([I, t, d, b, to]) => (
          <Link key={to} to={to} className="pa-slide"><span className="pa-slide-ico"><I size={30} strokeWidth={1.6} /></span><b>{t}</b><small>{d}</small><span className="pa-wb">{b}</span></Link>
        ))}
      </div>
    </>
  );
}

function Banner() {
  const banners = useAsync(() => api.banners().then((r) => r?.data || []).catch(() => []), []);
  const list = banners.data || [];
  const [i, setI] = useState(0);
  const [hold, setHold] = useState(false);
  useEffect(() => {
    if (list.length < 2 || hold) return undefined;
    const t = setInterval(() => setI((x) => (x + 1) % list.length), 6000);
    return () => clearInterval(t);
  }, [list.length, hold]);
  useEffect(() => { if (list.length) api.bannerSeen({ ids: list.map((b) => b.id) }).catch(() => {}); }, [list.length]);
  // The space is always the same height: while loading it is a skeleton, and with no paid banner it is our own.
  if (banners.loading) return <div className="pa-banner sk" aria-hidden="true" />;
  if (!list.length) return <ServiceSlides />;
  const cur = list[i % list.length];
  return (
    <>
      <div className="pa-banner" onTouchStart={() => setHold(true)} onTouchEnd={() => setHold(false)}>
        <img src={cur.mobile || cur.desktop} alt={cur.title || "Advertisement"} />
        <span className="pa-spn">Sponsored</span>
        <div className="pa-shade"><b>{cur.title}</b><a className="pa-wb" href={cur.link} target="_blank" rel="noopener noreferrer sponsored" onClick={() => api.bannerClick({ id: cur.id }).catch(() => {})}>{cur.button || "Learn more"}</a></div>
        {list.length > 1 && <span className="pa-dots">{list.map((b, k) => <button key={b.id} aria-label={`Banner ${k + 1}`} className={k === i % list.length ? "on" : ""} onClick={() => setI(k)} />)}</span>}
      </div>
      <div className="pa-adv"><a href="/business/promote/banner" style={adLink}>Advertise here</a></div>
    </>
  );
}

/** The first screen of Home on a phone: about 150 px of search, then the banner and 8 quick tiles. */
export function PhoneHomeTop() {
  const [open, setOpen] = useState(false);
  return (
    <section className="pa-home">
      <button className="pa-pill" onClick={() => setOpen(true)}><Search size={20} /><span>Search homes, stays, land, projects</span><SlidersHorizontal size={18} /></button>
      <div className="pa-types">{TYPES.map(([l, to], k) => <Link key={l} to={to} className={`pa-chip ${k === 0 ? "on" : ""}`}>{l}</Link>)}</div>
      <Banner />
      <div className="pa-quick">{QUICK.map(([I, l, to, hot]) => (hot
        ? <button key={l} type="button" className="pa-q" onClick={() => window.dispatchEvent(new Event("pa-open-menu"))}><span><I size={26} strokeWidth={1.75} /></span>{l}</button>
        : <Link key={l} to={to} className="pa-q"><span><I size={26} strokeWidth={1.75} /></span>{l}</Link>))}</div>
      {open && <PhoneSearch onClose={() => setOpen(false)} />}
    </section>
  );
}

const GROUPS = [
  ["Explore", Compass, [[Home, "Buy", "Homes and land for sale", "/sale"], [KeyRound, "Rent", "Houses and flats to rent", "/rent"], [BedDouble, "Stays", "Hotels, homestays, villas", "/stays"], [Building2, "Projects", "Apartments and colonies", "/project"], [HandCoins, "Invest", "From Rs. 10,000", "/investment/explore"], [MapIcon, "Map search", "See places on a map", "/map"], [Users, "Partners and agencies", "Find a local agency", "/partners?type=agency"], [ClipboardList, "Buyer requests", "What buyers want", "/property-demand"], [Plus, "Post a requirement", "Tell us what you need", "/requirement"]]],
  ["Services", Wallet, [[Landmark, "Home loan", "Compare banks, see your EMI", "/services/home-loan"], [Scale, "Legal help", "Land papers and agreements", "/services/legal-help"], [Building2, "Property management", "We look after your tenants", "/services/management"], [KeyRound, "Pay rent", "Find your lease and pay", "/services/pay-rent"], [Ruler, "Property valuation", "What is it worth?", "/services/valuation"]]],
  ["Tools", Calculator, [[Calculator, "EMI", null, "/tools/emi"], [Ruler, "Land unit converter", null, "/tools/units"], [Tag, "Land price estimator", null, "/tools/land-price"], [Receipt, "Property tax estimator", null, "/tools/property-tax"], [TrendingUp, "Rental yield", null, "/tools/roi"], [KeyRound, "Rent vs buy", null, "/tools/rent-vs-buy"], [Wallet, "Affordability", null, "/tools/afford"], [TrendingUp, "Investment return", null, "/tools/invest-return"], [BedDouble, "Host income", null, "/tools/host-income"], [Layers, "Project payment schedule", null, "/tools/pay-schedule"]], true],
  ["Learn", Newspaper, [[Newspaper, "Journal", "Guides and news", "/blog"], [TrendingUp, "Rates and trends", "Prices by area", "/rates-and-trends"], [Images, "Gallery", "Photos and videos", "/gallery"], [Tag, "Offers", "Deals for you", "/offers"], [HelpCircle, "Help", "Answers to common questions", "/help/booking"]]],
  ["Company", Briefcase, [[Info, "About", "Who we are", "/about"], [Briefcase, "Careers", "Join the team", "/careers"], [Phone, "Contact", "Call +977 980-1136817", "tel:+9779801136817", false, true], [BadgeCheck, "Apps and pricing", "Free to start, for every business", "/pricing"], [ExternalLink, "Start a business", "Opens in your browser", "/business", false, true]]],
];
const THEME_ICON = { light: Sun, dark: Moon, red: Droplet };

/** The side menu: person card, groups that open one at a time, theme, WhatsApp and Call, small legal links. */
const SORTS = [["", "Newest first"], ["low_to_high", "Price: low to high"], ["high_to_low", "Price: high to low"], ["oldest", "Oldest first"]];

/** Sort as a bottom sheet with radio rows. */
export function SortSheet({ value, onChange, onClose }) {
  return (
    <div className="pa-dim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pa-bsheet" role="dialog" aria-label="Sort by">
        <div className="pa-grabbar" />
        <b className="pa-bs-t">Sort by</b>
        {SORTS.map(([v, l]) => <button key={l} type="button" className="pa-radio" role="radio" aria-checked={value === v} onClick={() => { onChange(v); onClose(); }}><span>{l}</span><i className={value === v ? "on" : ""} /></button>)}
      </div>
    </div>
  );
}

export function PhoneMenu({ onClose }) {
  const { user, setAuth, theme, setTheme } = useApp();
  const [open, setOpen] = useState("Explore");
  useLock();
  const name = user ? (user.name || [user.first_name, user.last_name].filter(Boolean).join(" ") || user.email) : null;
  return (
    <div className="pa-menu-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <nav className="pa-menu" aria-label="Menu">
        <div className="pa-mtop"><PhoneLogo /><button type="button" className="pa-hbtn" aria-label="Close menu" onClick={onClose}><X size={22} /></button></div>
        <div className="pa-groups">
          {GROUPS.map(([g, GI, rows, grid]) => (
            <div key={g}>
              <button className={`pa-grp ${open === g ? "open" : ""}`} aria-expanded={open === g} onClick={() => setOpen(open === g ? "" : g)}><GI size={20} /><span>{g}</span>{open === g ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>
              {open === g && (grid
                ? rows.map(([I, t, , to]) => <Link key={to} to={to} className="pa-mrow" onClick={onClose}><span className="pa-t">{t}</span></Link>)
                : rows.map(([I, t, d, to, , ext]) => (ext
                  ? <a key={to} href={to} className="pa-mrow" onClick={onClose}><span className="pa-ico"><I size={16} /></span><span className="pa-t">{t}<small>{d}</small></span></a>
                  : <Link key={to} to={to} className="pa-mrow" onClick={onClose}><span className="pa-ico"><I size={16} /></span><span className="pa-t">{t}<small>{d}</small></span></Link>)))}
            </div>
          ))}
        </div>
        <div className="pa-foot">
          {user
            ? <Link to="/my-profile" className="pa-person" onClick={onClose}><User size={22} /><span><b>{name}</b>{user.email && user.email !== name && <small>{user.email}</small>}</span><ChevronRight size={16} /></Link>
            : <button className="pa-person" onClick={() => { onClose(); setAuth("login"); }}><User size={22} /><span><b>Log in or sign up</b><small>Save homes, get alerts</small></span><ChevronRight size={16} /></button>}
          <div className="pa-seg" role="group" aria-label="Theme">{THEMES.map((t) => { const I = THEME_ICON[t.id] || Sun; return <button key={t.id} className={theme === t.id ? "on" : ""} onClick={() => setTheme(t.id)}><I size={14} />{t.label || t.id[0].toUpperCase() + t.id.slice(1)}</button>; })}</div>
          <div className="pa-two"><a href="https://wa.me/9779801136817" target="_blank" rel="noreferrer"><MessageCircle size={16} />WhatsApp</a><a href="tel:+9779801136817"><Phone size={16} />Call</a></div>
          <div className="pa-legal"><Link to="/privacy-policy" onClick={onClose}>Privacy</Link> · <Link to="/terms-and-conditions" onClick={onClose}>Terms</Link> · <Link to="/data-deletion" onClick={onClose}>Data deletion</Link> · Version 1.0</div>
        </div>
      </nav>
    </div>
  );
}
