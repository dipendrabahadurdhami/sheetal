import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search, Home as HomeIcon, X } from "lucide-react";
import { api } from "../api/endpoints";
import { toList } from "../api/client";
import { PageHead, SectionHead, Empty } from "../components/ui";
import { fmtPrice, purposeOf } from "../utils/format";
import { areaOf } from "../utils/areas";
import { useSEO } from "../utils/seo";

// land size in aana from whatever the poster filled in (1 ropani = 16 aana, 1 kattha ≈ 10.65 aana, 1 bigha = 20 kattha)
const aanaOf = (p) => {
  const n = (v) => parseFloat(String(v ?? "").replace(/,/g, "")) || 0;
  const r = n(p.land_area_in_ropani_lal) * 16 + n(p.land_area_in_anna_lal);
  if (r) return r;
  const k = n(p.land_area_in_katha_lal) * 10.65 + n(p.land_area_in_bigha_lal) * 213;
  if (k) return k;
  const sq = n(p.land_area_in_sqft_lal); if (sq) return sq / 342.25;
  const a = String(p.property_area || ""); const x = n(a);
  if (!x) return 0;
  if (/ropani/i.test(a)) return x * 16;
  if (/kat+ha/i.test(a)) return x * 10.65;
  if (/sq/i.test(a)) return x / 342.25;
  return /aana|anna/i.test(a) ? x : 0;
};
const KIND = [["All", null], ["House", /house|bungalow|bunglow|home|villa/i], ["Land", /land|plot/i], ["Apartment / Flat", /apartment|flat|room|bhk/i], ["Commercial", /commercial|office|shop|space|building/i]];
const kindOf = (p) => { const t = `${p.property_type || ""} ${p.propertycategory || ""} ${p.name || ""}`; return (KIND.find(([, re]) => re && re.test(t)) || ["Other"])[0]; };

// every live listing for the purpose, slimmed to what this page needs (no photos), cached in the browser for 6 h
const LS = "sheetal_rates_v3_";
const TTL = 6 * 60 * 60 * 1000;
const KEEP = ["id", "name", "purpose", "property_purpose", "property_type", "propertycategory", "class_type", "property_location", "location", "tol", "town", "street", "district", "city", "zone", "vdc_np_mnp", "locality",
  "total_price", "rent_per_month", "property_area", "land_area_in_ropani_lal", "land_area_in_anna_lal", "land_area_in_katha_lal", "land_area_in_bigha_lal", "land_area_in_sqft_lal", "advertisement_purpose"];
const slim = (p) => { const o = {}; KEEP.forEach((k) => { if (p[k] != null && p[k] !== "") o[k] = p[k]; }); if (o.purpose && typeof o.purpose === "object") o.purpose = o.purpose.name || ""; return o; };
const MEM = {};
const readCache = (k) => {
  if (MEM[k]) return MEM[k];
  try { const v = JSON.parse(localStorage.getItem(LS + k)); if (v && Date.now() - v.t < TTL) return (MEM[k] = v); } catch {}
  return null;
};
// same loader the map uses (all-properties, 100 per page, with retries) — then split into sale / rent here
const isRent = (p) => /rent/i.test(purposeOf(p)) || (!!Number(p.rent_per_month) && !Number(p.total_price));
const getPage = async (pg, per) => {
  for (let t = 0; t < 3; t++) {
    try { return toList(await api.allProperties(pg, per)); } catch (err) { console.warn("rates: page", pg, "try", t + 1, err); await new Promise((ok) => setTimeout(ok, 700 * (t + 1))); }
  }
  return null;
};
// instant start: our saved copy, else the copy the Map page already saved
const seed = () => {
  const own = readCache("all"); if (own) return { items: own.v.items, fresh: true };
  try { const m = JSON.parse(localStorage.getItem("sheetal_maplist4_all|")); if (m?.items?.length) return { items: m.items.map(slim), fresh: false }; } catch {}
  return { items: [], fresh: false };
};
function useAllListings() {
  const [st, setSt] = useState(() => { const s0 = seed(); return { items: s0.items, total: s0.items.length, done: s0.fresh, error: null }; });
  useEffect(() => {
    if (st.done) return;
    let alive = true;
    (async () => {
      const first = await getPage(1, 50);
      if (!alive) return;
      if (!first || !first.items.length) { setSt((x) => ({ ...x, done: true, error: x.items.length ? null : "The listings service did not answer. Check that the backend is running." })); return; }
      const size = first.items.length, total = Math.max(first.total || 0, size);
      const last = first.last > 1 ? first.last : total > size ? Math.ceil(total / size) : 1;
      const map = new Map(); first.items.forEach((p) => map.set(p.id, slim(p)));
      const push = (done) => alive && setSt((x) => {
        // keep showing the saved copy until the fresh one has caught up with it
        const fresh = [...map.values()];
        return { items: fresh.length >= x.items.length || done ? fresh : x.items, total, done, error: null };
      });
      push(last <= 1);
      const pages = Array.from({ length: last - 1 }, (_, i) => i + 2);
      for (let i = 0; i < pages.length && alive; i += 6) {
        const res = await Promise.all(pages.slice(i, i + 6).map((pg) => getPage(pg, 50)));
        res.forEach((g) => g && g.items.forEach((p) => map.set(p.id, slim(p))));
        push(i + 6 >= pages.length);
      }
      if (!alive) return;
      MEM.all = { t: Date.now(), v: { items: [...map.values()], total } };
      try { localStorage.setItem(LS + "all", JSON.stringify(MEM.all)); } catch {}
    })();
    return () => { alive = false; };
  }, []);  
  return st;
}

export default function RatesTrends() {
  useSEO("Rates & trends", "Average asking prices by city and locality across Nepal, built from live listings.");
  const [purpose, setPurpose] = useState("sale");
  const [kind, setKind] = useState("All");
  const [city, setCity] = useState("Kathmandu");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hov, setHov] = useState(-1);
  const [avgOn, setAvgOn] = useState(false);
  const [avgHov, setAvgHov] = useState(false);
  useEffect(() => {
    if (!open) return;
    const k = (e) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open]);
  const all = useAllListings();
  const data = useMemo(() => ({ items: all.items.filter((p) => (purpose === "rent" ? isRent(p) : !isRent(p))) }), [all.items, purpose]);
  const loading = !all.items.length && !all.done;
  const error = all.error ? new Error(all.error) : null;
  const progress = all.done ? `${all.items.length} listings` : `${all.items.length} of ${all.total || "…"} listings (still loading)`;

  const items = useMemo(() => (data?.items || []).map((p) => {
    const a = areaOf(p);
    const price = Number(purpose === "rent" ? (p.rent_per_month || p.total_price) : p.total_price) || 0;
    return { p, loc: a.locality || a.district, district: (a.province && a.district) || "Other", price, aana: aanaOf(p), kind: kindOf(p) };
  }).filter((x) => x.price > 0 && x.loc), [data, purpose]);

  const cities = useMemo(() => {
    const c = {}; items.forEach((x) => (c[x.district] = (c[x.district] || 0) + 1));
    return Object.entries(c).filter(([k]) => k !== "Other").sort((a, b) => b[1] - a[1]).slice(0, 7).map(([k]) => k);
  }, [items]);
  const cur = city === "All" || cities.includes(city) ? city : cities[0] || "All";

  const rows = useMemo(() => {
    const g = {};
    items.filter((x) => (cur === "All" || x.district === cur) && (kind === "All" || x.kind === kind) && (!q || x.loc.toLowerCase().includes(q.toLowerCase()))).forEach((x) => {
      const r = (g[x.loc] = g[x.loc] || { loc: x.loc, n: 0, sum: 0, per: [], min: Infinity, max: 0 });
      r.n++; r.sum += x.price; r.min = Math.min(r.min, x.price); r.max = Math.max(r.max, x.price);
      if (x.aana && purpose === "sale") r.per.push(x.price / x.aana);
    });
    return Object.values(g).map((r) => ({ ...r, avg: r.sum / r.n, aana: r.per.length ? r.per.reduce((s, v) => s + v, 0) / r.per.length : 0 })).sort((a, b) => b.n - a.n || b.avg - a.avg);
  }, [items, cur, kind, q, purpose]);

  const total = rows.reduce((s, r) => s + r.n, 0);
  const avgAll = total ? rows.reduce((s, r) => s + r.sum, 0) / total : 0;
  const top = [...rows].sort((a, b) => b.avg - a.avg).slice(0, 10);
  const maxTop = Math.max(1, ...top.map((r) => r.avg));
  const niceMax = (v) => { const e = 10 ** Math.floor(Math.log10(v)); const m = v / e; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * e; };
  const yMax = niceMax(maxTop);
  const ticks = [0, 1, 2, 3, 4].map((i) => (yMax * i) / 4);
  const unit = purpose === "rent" ? " / month" : "";
  const link = (loc) => `/search?keyword=${encodeURIComponent(loc)}&advertisement_purpose=${purpose}`;

  const what = purpose === "rent" ? "rent" : "price";
  const place = cur === "All" ? "Nepal" : cur;

  return (
    <>
      <div className="tools-hero rates-hero"><PageHead crumbs={[{ label: "Rates & trends" }]} title="Rates & trends">Average asking prices by city and locality, from current listings.</PageHead></div>
      <div className="container section-sm stack" style={{ gap: 40 }}>
        <div className="rates-bar" style={{ justifyContent: "flex-start", gap: 12 }}>
          <div className="rates-search" style={{ maxWidth: "none", flex: "1 1 260px" }}><Search size={16} /><input placeholder="Search a locality, e.g. Budhanilkantha" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <select className="select" aria-label="City" style={{ width: 180, height: 48 }} value={cur} onChange={(e) => setCity(e.target.value)}>{["All", ...cities].map((c) => <option key={c} value={c}>{c === "All" ? "All Nepal" : c}</option>)}</select>
          <select className="select" aria-label="Property type" style={{ width: 180, height: 48 }} value={kind} onChange={(e) => setKind(e.target.value)}>{KIND.map(([k]) => <option key={k} value={k}>{k === "All" ? "All types" : k}</option>)}</select>
          <div className="seg">{[["sale", "For sale"], ["rent", "For rent"]].map(([v, l]) => <button key={v} className={purpose === v ? "on" : ""} onClick={() => setPurpose(v)}>{l}</button>)}</div>
        </div>
          {loading ? <div className="stack" style={{ gap: 8, alignItems: "center" }}><div className="sk" style={{ height: 420, width: "100%" }} /><span className="small muted">Loading all live listings…</span></div> : error ? <Empty title="Could not load listings">{String(error.message || error)}</Empty> : !rows.length ? <Empty title="Not enough listings yet">Try another city or type.</Empty> : (
            <section><SectionHead title={`Average ${what} by locality in ${place}`} />
              <div className="card card-pad stack" style={{ gap: 16 }}>
                <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}>
                  <span className="small muted">Top {top.length} localities by average {what}. Hover a bar for details. Click the listings to search them, or the localities to see the full list.</span>
                  <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
                    <span className="small tnum row" style={{ gap: 6 }}>
                      <Link to={`/search?${cur === "All" ? "" : `keyword=${encodeURIComponent(cur)}&`}advertisement_purpose=${purpose}`} title="See these listings" style={{ color: "var(--accent-ink)", fontWeight: 500, textDecoration: "underline", textUnderlineOffset: 3 }}>{total} {total === 1 ? "listing" : "listings"}</Link>
                      <span className="muted">in</span>
                      <button type="button" onClick={() => setOpen(true)} title="See all localities" style={{ background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit", color: "var(--accent-ink)", fontWeight: 500, textDecoration: "underline", textUnderlineOffset: 3 }}>{rows.length} {rows.length === 1 ? "locality" : "localities"}</button>
                    </span>
                    <button type="button" className={`chip ${avgOn ? "active" : ""}`} aria-pressed={avgOn} onClick={() => setAvgOn((v) => !v)} onMouseEnter={() => setAvgHov(true)} onMouseLeave={() => setAvgHov(false)} onFocus={() => setAvgHov(true)} onBlur={() => setAvgHov(false)} style={{ height: 30 }}>
                      <span aria-hidden="true" style={{ width: 16, borderTop: "2px dashed currentColor" }} />Average {fmtPrice(avgAll)}
                    </button>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "76px minmax(0, 1fr)", columnGap: 8, marginTop: 28 }}>
                  <div style={{ position: "relative", height: 280 }}>
                    {ticks.map((t, i) => <span key={i} className="tiny muted tnum" style={{ position: "absolute", right: 6, bottom: `${(i / 4) * 100}%`, transform: "translateY(50%)", whiteSpace: "nowrap" }}>{i === 0 ? "0" : fmtPrice(t)}</span>)}
                  </div>
                  <div style={{ position: "relative", height: 280, borderLeft: "1px solid var(--line-strong)", borderBottom: "1px solid var(--line-strong)" }}>
                    {ticks.slice(1).map((t, i) => <div key={i} style={{ position: "absolute", left: 0, right: 0, bottom: `${((i + 1) / 4) * 100}%`, borderTop: "1px dashed var(--line)" }} />)}
                    {(avgOn || avgHov) && (
                      <div style={{ position: "absolute", left: 0, right: 0, bottom: `${(avgAll / yMax) * 100}%`, borderTop: "1.5px dashed var(--c-red)", zIndex: 1, pointerEvents: "none" }}>
                        <span className="tiny tnum" style={{ position: "absolute", right: 0, bottom: 2, color: "var(--accent-ink)", background: "var(--card)", padding: "0 4px" }}>Average {fmtPrice(avgAll)}</span>
                      </div>
                    )}
                    <div style={{ position: "absolute", inset: 0, display: "flex", gap: 12, padding: "0 12px" }}>
                      {top.map((r, i) => {
                        const h = (r.avg / yMax) * 100;
                        const right = i >= top.length / 2;
                        return (
                          <Link key={r.loc} to={link(r.loc)} onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(-1)} onFocus={() => setHov(i)} onBlur={() => setHov(-1)} style={{ position: "relative", flex: 1, minWidth: 0, height: "100%", display: "block" }}>
                            <i style={{ position: "absolute", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "70%", maxWidth: 56, height: `${Math.max(1, h)}%`, background: hov === i ? "var(--c-red)" : "var(--c-crimson)", borderRadius: "4px 4px 0 0", transition: "background .15s" }} />
                            <b className="tnum" style={{ position: "absolute", bottom: `calc(${h}% + 4px)`, left: 0, right: 0, textAlign: "center", fontSize: 11.5, fontWeight: 600, color: "var(--text-strong)", whiteSpace: "nowrap" }}>{fmtPrice(r.avg)}</b>
                            {hov === i && (
                              <div className="card card-pad tnum" style={{ position: "absolute", top: 0, zIndex: 5, minWidth: 190, [right ? "right" : "left"]: "calc(100% + 6px)", padding: 12, display: "flex", flexDirection: "column", gap: 4, boxShadow: "var(--shadow)", background: "var(--card)", pointerEvents: "none" }}>
                                <b style={{ color: "var(--text-strong)" }}>{r.loc}</b>
                                <span className="small">Average {what}: <b>{fmtPrice(r.avg)}</b>{unit}</span>
                                <span className="small">Listings: <b>{r.n}</b></span>
                                {purpose === "sale" && <span className="small">Avg. per aana: <b>{r.aana ? fmtPrice(r.aana) : "–"}</b></span>}
                                <span className="small muted">Range: {r.n > 1 ? `${fmtPrice(r.min)} – ${fmtPrice(r.max)}` : "–"}</span>
                              </div>
                            )}
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                  <div />
                  <div style={{ display: "flex", gap: 12, padding: "8px 12px 0" }}>
                    {top.map((r) => <Link key={r.loc} to={link(r.loc)} style={{ flex: 1, minWidth: 0, textAlign: "center", color: "var(--text-strong)" }}><span className="rates-name small" style={{ display: "block" }}>{r.loc}</span><span className="tiny muted tnum">{r.n} {r.n === 1 ? "listing" : "listings"}</span></Link>)}
                  </div>
                </div>
              </div>
            </section>
          )}
          <p className="tiny muted">{progress ? `Based on ${progress} for ${purpose}. ` : ""}Asking prices from current listings only. Final sale prices and government valuation can differ. For a written valuation, <Link to="/services">contact us</Link>.</p>
        {open && (
          <div role="dialog" aria-modal="true" aria-label="All localities" onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
            <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: "min(980px, 100%)", maxHeight: "85vh", display: "flex", flexDirection: "column", background: "var(--card)" }}>
              <div className="row between" style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)" }}>
                <h3>All localities in {place}</h3>
                <button className="btn btn-outline btn-sm" aria-label="Close" onClick={() => setOpen(false)}><X size={16} /></button>
              </div>
              <div style={{ overflow: "auto" }}>
                <table className="table tnum">
                  <thead><tr><th>Locality</th><th>Listings</th>{purpose === "sale" && <th>Avg. per aana</th>}<th>Average {what}</th><th>Range</th></tr></thead>
                  <tbody>{rows.map((r) => (
                    <tr key={r.loc}>
                      <td><Link to={link(r.loc)} className="row" style={{ gap: 8, color: "var(--text-strong)", fontWeight: 500 }}><HomeIcon size={14} className="muted" />{r.loc}</Link></td>
                      <td>{r.n}</td>
                      {purpose === "sale" && <td>{r.aana ? fmtPrice(r.aana) : "–"}</td>}
                      <td>{fmtPrice(r.avg)}{unit && <span className="tiny muted">{unit}</span>}</td>
                      <td className="muted small">{r.n > 1 ? `${fmtPrice(r.min)} – ${fmtPrice(r.max)}` : "–"}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}