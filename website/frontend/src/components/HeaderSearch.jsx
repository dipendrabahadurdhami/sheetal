// The search box in the header: finds properties, stays, projects, investments, agencies, jobs, journal articles and pages.

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, X, Home, BedDouble, Building2, TrendingUp, Users, FileText, CornerDownLeft, Store, Newspaper, LifeBuoy, Briefcase } from "lucide-react";
import { api } from "../api/endpoints";
import { toList } from "../api/client";
import { linkOf, titleOf, agencyName } from "../utils/format";
import { useLiveCatalog } from "../market/Market";
import { SERVICE_LINKS } from "../pages/ServicePages";
import { NEW_SERVICES } from "../pages/Services";
import { seed, VERSION } from "@sheetal/shared/demo/demo";
import { config } from "@sheetal/shared/core/config";

const TYPE_LABEL = { hotel: "Hotel", host: "Host", developer: "Developer", agency: "Agency", sponsor: "Investment sponsor" };
const partners = () => { let s = null; try { s = JSON.parse(localStorage.getItem(config.storageKey)); } catch (e) { /* ignore */ } if (!s || s.version !== VERSION) s = seed(); return (s.tenants || []).filter((x) => x.status === "active"); };
const SERVICES = [...SERVICE_LINKS.map(([to, , t, d]) => [t, d, to]), ...NEW_SERVICES.map(([to, , t, d]) => [t, d, to])];
let blogCache = null;
// Open jobs change more often than articles: kept for five minutes.
let jobCache = null;
const jobsNow = () => (jobCache && Date.now() - jobCache.at < 300_000 ? Promise.resolve(jobCache.items) : api.jobs().then(toList).then((r) => { jobCache = { at: Date.now(), items: r.items || [] }; return jobCache.items; }));
// Words that mean "show me the jobs" or "show me the articles", whatever the rest of the text.
const JOB_WORDS = /\b(jobs?|careers?|vacanc(y|ies)|hiring|recruit\w*|work with|openings?|apply)\b/;
const BLOG_WORDS = /\b(blog|journal|news|articles?|guides?|tips)\b/;

// Header search: finds anything on the site (properties, stays, projects, investments, agencies, jobs, articles, pages).
// A page's third item is other words people type for it.
const PAGES = [
  ["Careers", "/careers", "jobs job vacancy vacancies hiring work apply cv"], ["Journal", "/blog", "blog news articles guides"],
  ["Map search", "/map"], ["Partners", "/partners"], ["Agencies", "/partners?type=agency"], ["Services", "/services"],
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
  const [jobs, setJobs] = useState([]);
  const [sel, setSel] = useState(0);
  const ref = useRef(null);
  const input = useRef(null);
  const s = q.trim().toLowerCase();
  // Published stays, projects and investments from businesses (loaded the first time someone types).
  const live = useLiveCatalog(s.length >= 2);

  useEffect(() => {
    const h = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const k = (e) => { if ((e.key === "/" && !/input|textarea/i.test(document.activeElement?.tagName)) || ((e.ctrlKey || e.metaKey) && e.key === "k")) { e.preventDefault(); input.current?.focus(); setOpen(true); } };
    document.addEventListener("mousedown", h); document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); };
  }, []);
  useEffect(() => {
    if (s.length < 2) { setProps([]); setJobs([]); return; }
    let live = true;
    const t = setTimeout(() => {
      api.search({ keyword: q.trim(), per_page: 5 }).then(toList).then((r) => live && setProps((r.items || []).slice(0, 5))).catch(() => live && setProps([]));
      (agencyCache ? Promise.resolve(agencyCache) : api.agents().then(toList).then((r) => (agencyCache = r.items || []))).then((all) => live && setAgencies(all.filter((a) => has(s, agencyName(a), a.address, a.company_name)).slice(0, 3))).catch(() => {});
      (blogCache ? Promise.resolve(blogCache) : api.blogs(1, 50).then(toList).then((r) => (blogCache = r.items || []))).then((all) => live && setBlogs(all.filter((b) => BLOG_WORDS.test(s) || has(s, b.title, b.category?.name || b.category, b.excerpt || b.short_description, ...(b.tags || []))).slice(0, 3))).catch(() => {});
      // "job", "career", "hiring"… show every open job; anything else matches the title, department, place or company.
      jobsNow().then((all) => live && setJobs(all.filter((j) => JOB_WORDS.test(s) || has(s, j.title, j.department, j.location, j.company?.name)).slice(0, 5))).catch(() => live && setJobs([]));
    }, 220);
    return () => { live = false; clearTimeout(t); };
  }, [s]);  

  const groups = s.length < 2 ? [] : [
    ["Properties", Home, props.map((p) => [titleOf(p), p.property_location, linkOf(p)])],
    ["Stays", BedDouble, live.stays.filter((x) => /\b(stays?|hotels?|rooms?|homestays?|resorts?)\b/.test(s) || has(s, x.name, x.city, x.area, x.kind)).slice(0, 3).map((x) => [x.name, [x.area, x.city].filter(Boolean).join(", "), x.href || `/stays/${x.id}`])],
    ["Projects", Building2, live.projects.filter((x) => /\bprojects?\b/.test(s) || has(s, x.name, x.city, x.area, x.type)).slice(0, 3).map((x) => [x.name, [x.area, x.city].filter(Boolean).join(", "), x.href || `/project/${x.id}`])],
    ["Invest", TrendingUp, live.invests.filter((x) => /\binvest\w*\b/.test(s) || has(s, x.name, x.city, x.type)).slice(0, 3).map((x) => [x.name, [x.type, x.city].filter(Boolean).join(" · "), x.href || `/investment/${x.id}`])],
    ["Agencies", Users, agencies.map((a) => [agencyName(a), a.address, `/agency/${a.id}`])],
    ["Hotels and businesses", Store, partners().filter((x) => has(s, x.name, x.city, TYPE_LABEL[x.type])).slice(0, 4).map((x) => [x.name, `${TYPE_LABEL[x.type] || "Business"} · ${x.city}`, `/site/${x.id}`])],
    ["Services", LifeBuoy, SERVICES.filter(([l, d]) => has(s, l, d)).slice(0, 3)],
    ["Jobs", Briefcase, jobs.map((j) => [j.title, [j.company && !j.company.own ? j.company.name : null, j.location, j.department].filter(Boolean).join(" · "), `/careers/${j.slug}`])],
    ["Journal", Newspaper, blogs.map((b) => [b.title, b.category?.name || (typeof b.category === "string" ? b.category : null), `/blog/${b.slug || b.id}`])],
    ["Pages", FileText, PAGES.filter(([l, , words]) => has(s, l) || (words || "").split(" ").some((w) => w.startsWith(s) || s.split(/\s+/).includes(w))).slice(0, 4).map(([l, to]) => [l, null, to])],
  ].filter(([, , items]) => items.length);
  const flat = groups.flatMap(([, , items]) => items);
  const go = (to) => { navigate(to); setOpen(false); setQ(""); input.current?.blur(); };
  // Enter opens the picked result; with none, job words open Careers, article words the Journal, anything else the property search.
  const submit = (e) => { e.preventDefault(); if (flat[sel]) go(flat[sel][2]); else if (JOB_WORDS.test(s)) go("/careers"); else if (BLOG_WORDS.test(s)) go("/blog"); else if (s) go(`/sale?keyword=${encodeURIComponent(q.trim())}`); };
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
        placeholder="Search homes, hotels, jobs…" aria-label="Search the site" aria-expanded={open && s.length >= 2} aria-controls="hsearch-list" autoComplete="off" />
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
          {JOB_WORDS.test(s) ? <button type="button" className="hsearch-all" onClick={() => go("/careers")}>See all open jobs</button>
            : <button type="button" className="hsearch-all" onClick={() => go(`/sale?keyword=${encodeURIComponent(q.trim())}`)}>See all property results for “{q.trim()}”</button>}
        </div>
      )}
    </form>
  );
}
