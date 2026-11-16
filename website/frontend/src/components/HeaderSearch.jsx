// The search box in the header: finds properties, stays, projects, investments, agencies and pages.

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, X, Home, BedDouble, Building2, TrendingUp, Users, FileText, CornerDownLeft, Store, Newspaper, LifeBuoy } from "lucide-react";
import { api } from "../api/endpoints";
import { toList } from "../api/client";
import { linkOf, titleOf, agencyName } from "../utils/format";
import { STAYS, PROJECTS, INVESTS } from "../market/Market";
import { SERVICE_LINKS } from "../pages/ServicePages";
import { NEW_SERVICES } from "../pages/Services";
import { seed, VERSION } from "@sheetal/shared/demo/demo";
import { config } from "@sheetal/shared/core/config";

const TYPE_LABEL = { hotel: "Hotel", host: "Host", developer: "Developer", agency: "Agency", sponsor: "Investment sponsor" };
const partners = () => { let s = null; try { s = JSON.parse(localStorage.getItem(config.storageKey)); } catch (e) { /* ignore */ } if (!s || s.version !== VERSION) s = seed(); return (s.tenants || []).filter((x) => x.status === "active"); };
const SERVICES = [...SERVICE_LINKS.map(([to, , t, d]) => [t, d, to]), ...NEW_SERVICES.map(([to, , t, d]) => [t, d, to])];
let blogCache = null;

// Header search: finds anything on the site (properties, stays, projects, investments, agencies, pages).
const PAGES = [
  ["Map search", "/map"], ["Partners", "/partners"], ["Agencies", "/partners?type=agency"], ["Partners", "/partners"], ["Services", "/services"], ["Journal", "/blog"],
  ["Post property", "/post-property"], ["Property demand", "/property-demand"], ["EMI calculator", "/tools/emi"], ["Offers", "/offers"],
  ["Gallery", "/gallery"], ["About us", "/about"], ["Contact", "/contact"], ["Apps and pricing", "/pricing"], ["My account", "/my-profile"],
];
const has = (q, ...xs) => xs.some((x) => String(x || "").toLowerCase().includes(q));
let agencyCache = null;

export function HeaderSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [props, setProps] = useState([]);
  const [agencies, setAgencies] = useState([]);
  const [blogs, setBlogs] = useState([]);
  const [sel, setSel] = useState(0);
  const ref = useRef(null);
  const input = useRef(null);
  const s = q.trim().toLowerCase();

  useEffect(() => {
    const h = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const k = (e) => { if ((e.key === "/" && !/input|textarea/i.test(document.activeElement?.tagName)) || ((e.ctrlKey || e.metaKey) && e.key === "k")) { e.preventDefault(); input.current?.focus(); setOpen(true); } };
    document.addEventListener("mousedown", h); document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); };
  }, []);
  useEffect(() => {
    if (s.length < 2) { setProps([]); return; }
    let live = true;
    const t = setTimeout(() => {
      api.search({ keyword: q.trim(), per_page: 5 }).then(toList).then((r) => live && setProps((r.items || []).slice(0, 5))).catch(() => live && setProps([]));
      (agencyCache ? Promise.resolve(agencyCache) : api.agents().then(toList).then((r) => (agencyCache = r.items || []))).then((all) => live && setAgencies(all.filter((a) => has(s, agencyName(a), a.address, a.company_name)).slice(0, 3))).catch(() => {});
      (blogCache ? Promise.resolve(blogCache) : api.blogs(1, 60).then(toList).then((r) => (blogCache = r.items || []))).then((all) => live && setBlogs(all.filter((b) => has(s, b.title, b.category?.name || b.category, b.excerpt || b.short_description)).slice(0, 3))).catch(() => {});
    }, 220);
    return () => { live = false; clearTimeout(t); };
  }, [s]);  

  const groups = s.length < 2 ? [] : [
    ["Properties", Home, props.map((p) => [titleOf(p), p.property_location, linkOf(p)])],
    ["Stays", BedDouble, STAYS.filter((x) => has(s, x.name, x.city, x.area, x.kind)).slice(0, 3).map((x) => [x.name, `${x.area}, ${x.city}`, `/stays/${x.id}`])],
    ["Projects", Building2, PROJECTS.filter((x) => has(s, x.name, x.city, x.area, x.type)).slice(0, 3).map((x) => [x.name, `${x.area}, ${x.city}`, `/project/${x.id}`])],
    ["Invest", TrendingUp, INVESTS.filter((x) => has(s, x.name, x.city, x.type)).slice(0, 3).map((x) => [x.name, `${x.type} · ${x.city}`, `/investment/${x.id}`])],
    ["Agencies", Users, agencies.map((a) => [agencyName(a), a.address, `/agency/${a.id}`])],
    ["Hotels and businesses", Store, partners().filter((x) => has(s, x.name, x.city, TYPE_LABEL[x.type])).slice(0, 4).map((x) => [x.name, `${TYPE_LABEL[x.type] || "Business"} · ${x.city}`, `/site/${x.id}`])],
    ["Services", LifeBuoy, SERVICES.filter(([l, d]) => has(s, l, d)).slice(0, 3)],
    ["Journal", Newspaper, blogs.map((b) => [b.title, b.category?.name || (typeof b.category === "string" ? b.category : null), `/blog/${b.slug || b.id}`])],
    ["Pages", FileText, PAGES.filter(([l]) => has(s, l)).slice(0, 4).map(([l, to]) => [l, null, to])],
  ].filter(([, , items]) => items.length);
  const flat = groups.flatMap(([, , items]) => items);
  const go = (to) => { navigate(to); setOpen(false); setQ(""); input.current?.blur(); };
  const submit = (e) => { e.preventDefault(); if (flat[sel]) go(flat[sel][2]); else if (s) go(`/sale?keyword=${encodeURIComponent(q.trim())}`); };
  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((i) => Math.min(flat.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((i) => Math.max(0, i - 1)); }
    else if (e.key === "Escape") { setOpen(false); input.current?.blur(); }
  };
  let n = -1;
  return (
    <form className={`hsearch ${open ? "open" : ""}`} ref={ref} onSubmit={submit} role="search">
      <Search size={16} className="hsearch-ico" aria-hidden="true" />
      <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setSel(0); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKey}
        placeholder="Search homes, hotels, agencies…" aria-label="Search the site" aria-expanded={open && s.length >= 2} aria-controls="hsearch-list" autoComplete="off" />
      {q ? <button type="button" className="hsearch-x" onClick={() => { setQ(""); input.current?.focus(); }} aria-label="Clear"><X size={14} /></button> : null}
      {open && s.length >= 2 && (
        <div className="hsearch-pop" id="hsearch-list" role="listbox">
          {groups.map(([label, Ic, items]) => (
            <div key={label} className="hsearch-g">
              <span className="hsearch-gl">{label}</span>
              {items.map(([t, sub, to]) => { n++; const i = n; return (
                <button key={to} type="button" role="option" aria-selected={sel === i} className={`hsearch-it ${sel === i ? "on" : ""}`} onMouseEnter={() => setSel(i)} onClick={() => go(to)}>
                  <Ic size={16} aria-hidden="true" /><span className="hsearch-t"><b>{t}</b>{sub && <small>{sub}</small>}</span>{sel === i && <CornerDownLeft size={14} className="hsearch-enter" aria-hidden="true" />}
                </button>); })}
            </div>
          ))}
          {!groups.length && <div className="hsearch-empty">Nothing found for “{q.trim()}”.</div>}
          <button type="submit" className="hsearch-all">See all property results for “{q.trim()}”</button>
        </div>
      )}
    </form>
  );
}
