import { useState, useRef, useEffect } from "react";
import { ProjectsSection, InvestSection } from "../market/SiteRows";
import { Link } from "react-router-dom";
import { TrendingUp, ShieldCheck, Building2, Trees, Store, MapPin, Images, Search } from "lucide-react";
import { api } from "../api/endpoints";
import { toList } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { PageHead, SectionHead, usePaged, Paged } from "../components/ui";
import { PropertyGrid } from "../components/PropertyCard";
import { Dropdown } from "../components/Dropdown";
import { Enquiry } from "./ServicePages";
import { images, linkOf, titleOf, fmtPrice, purposeOf } from "../utils/format";
import { useSEO } from "../utils/seo";
import { SwipeArrows, ARROW_MIN } from "../components/SwipeArrows";

export function InvestmentExplore() {
  useSEO("Invest in property", "Land banks, commercial plots and income property in Nepal.");
  return (
    <>
      <PageHead crumbs={[{ label: "Invest", to: "/investment" }, { label: "Explore" }]} title="Investment"
        right={<Link to="/investment" className="btn btn-primary">All investment listings</Link>}>
        Land banks, commercial plots and rental buildings, checked by our team before they are offered.
      </PageHead>
      <div className="container section-sm stack" style={{ gap: 56 }}>
        <div className="grid-3">
          {[[Trees, "Land banking", "Plots on new road corridors and ring-road extensions."], [Store, "Commercial", "Shop fronts and offices with existing tenants."], [Building2, "Rental buildings", "Apartments and hostels with monthly income."]].map(([I, t, d]) => (
            <Link key={t} to="/investment#invest-list" className="card card-pad card-hover stack" style={{ gap: 10, color: "var(--text)" }}><I size={26} strokeWidth={1.4} color="var(--c-red)" /><h3>{t}</h3><p className="small muted">{d}</p></Link>
          ))}
        </div>
        <div id="invest-list"><InvestSection SectionHead={SectionHead} /></div>
        <section className="grid-2" style={{ gap: 48, alignItems: "start" }}>
          <div className="stack" style={{ gap: 16 }}>
            <h2>How we check an investment</h2>
            {[[ShieldCheck, "Title & approvals", "Lal purja, naksa, road status and land use zone."], [TrendingUp, "Return estimate", "Rent, yield and recent prices nearby."], [MapPin, "Location future", "Planned roads, schools and markets in the area."]].map(([I, t, d]) => (
              <div key={t} className="row" style={{ alignItems: "flex-start", gap: 14 }}><I size={22} color="var(--c-red)" style={{ flexShrink: 0, marginTop: 2 }} /><div><h4>{t}</h4><p className="small muted">{d}</p></div></div>
            ))}
            <Link to="/tools/roi" className="link">Rental yield calculator</Link>
          </div>
          <Enquiry service="Investment" title="Talk to an investment advisor" fields={[["budget", "Budget (Rs.)", "number"], ["horizon", "Time horizon", "text", ["Under 2 years", "2–5 years", "5+ years"]]]} />
        </section>
      </div>
    </>
  );
}

export function Project() {
  useSEO("Featured properties", "Hand-picked homes, land and rentals from Sheetal Property.");
  // backend returns only ~10 featured; top up with the newest listings so every page is a full 4×3 grid
  const { data, loading } = useAsync(() => Promise.all([
    api.featured().then(toList).catch(() => ({ items: [] })),
    api.search({ per_page: 60, page: 1 }).then(toList).catch(() => ({ items: [] })),
  ]).then(([f, s]) => {
    const seen = new Set(); const items = [];
    [...(f.items || []), ...(s.items || [])].forEach((p) => { if (p && !seen.has(p.id)) { seen.add(p.id); items.push(p); } });
    return { items };
  }), []);
  const all = data?.items || [];
  const cats = ["All", ...Array.from(new Set(all.map((p) => String(p.propertycategory || p.property_type || "").trim()).filter(Boolean)))];
  const [cat, setCat] = useState("All");
  const raw = cat === "All" ? all : all.filter((p) => String(p.propertycategory || p.property_type || "").trim() === cat);
  // keep rows full: trim to a multiple of 4 (never below one row)
  const list = raw.length > 4 ? raw.slice(0, raw.length - (raw.length % 4)) : raw;
  const pg = usePaged(list, 12, cat);
  return (
    <>
      <div className="tools-hero featured-hero"><PageHead crumbs={[{ label: "Featured" }]} title="Featured properties">Hand-picked homes, land and rentals our team recommends this week.</PageHead></div>
      <div className="container"><ProjectsSection SectionHead={SectionHead} /></div>
      <div className="container section-sm" ref={pg.top}>
        <div className="row between" style={{ gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
          <div className="row-wrap" style={{ gap: 8 }}>{cats.map((c) => <button key={c} className={`chip ${cat === c ? "active" : ""}`} onClick={() => setCat(c)}>{c}</button>)}</div>
          {!loading && <span className="small muted tnum">{list.length} {list.length === 1 ? "property" : "properties"}</span>}
        </div>
        {!loading && !list.length ? <p className="muted">No featured properties right now.</p> : <PropertyGrid loading={loading} items={pg.items} count={8} />}
        <Paged pg={pg} />
      </div>
    </>
  );
}

const GALLERY_CSS = `
.footer{position:relative;z-index:40;margin-top:0!important}
.rg-top{padding-bottom:12px;position:relative;z-index:5}
.rg-top{display:flex;flex-direction:column;gap:14px;padding-top:28px}
.rg-chips{display:flex;flex-wrap:wrap;gap:8px}
.rg-bar{display:flex;flex-wrap:wrap;gap:12px;align-items:center}
.rg-dd{flex:0 0 190px}
.rg-dd-s{flex-basis:160px}
.rg-dd .dd-btn{height:46px;border-radius:var(--r-pill);padding:0 16px}
.rg-search{flex:1 1 200px;min-width:0;display:flex;align-items:center;gap:10px;height:46px;padding:0 6px 0 16px;border:1px solid var(--line-strong);border-radius:var(--r-pill);background:var(--card)}
.rg-search:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.rg-search svg{color:var(--text);flex-shrink:0}
.rg-search input{flex:1;min-width:0;border:0;outline:0;background:transparent;font-size:14.5px;color:var(--text-strong)}
.rg-search button{height:34px;padding:0 16px;border:0;border-radius:var(--r-pill);background:var(--c-slate);color:#fff;font-size:13.5px;font-weight:600}
.rg-search button:hover{background:var(--c-red)}
.rg-seg{display:inline-flex;padding:4px;gap:2px;border:1px solid var(--line-strong);border-radius:var(--r-pill);background:var(--card)}
.rg-seg button{height:36px;padding:0 18px;border:0;border-radius:var(--r-pill);background:transparent;color:var(--text);font-size:13.5px;font-weight:500;transition:all .2s}
.rg-seg button:hover{color:var(--text-strong)}
.rg-seg button.on{background:var(--c-red);color:#fff}
.rg-stage{z-index:0;--fw:116px;--fh:84px;--fd:144px;position:relative;height:600px;overflow:hidden;cursor:grab;user-select:none;touch-action:pan-y}
.rg-stage:active{cursor:grabbing}
.rg-frame{position:absolute;left:0;top:0;width:var(--fw);height:var(--fh);display:block;padding:0;border:0;border-radius:14px;overflow:hidden;background:var(--surface-2);box-shadow:0 8px 22px rgba(0,0,0,.2);will-change:transform}
.rg-frame img{position:absolute;left:50%;top:50%;width:var(--fd);height:var(--fd);max-width:none;object-fit:cover;display:block;pointer-events:none;will-change:transform}
.rg-center{position:absolute;left:50%;top:var(--cy,46%);transform:translate(-50%,-50%);width:min(380px,56%);text-align:center;pointer-events:none;z-index:50}
.rg-hello{transition:opacity .25s,transform .25s}
.rg-hello img{display:block;margin:0 auto;height:130px;width:auto;max-width:100%}
[data-theme~="dark"] .rg-hello img{filter:brightness(0) invert(1)}
.rg-prev{position:absolute;left:50%;top:50%;width:min(340px,100%);transform:translate(-50%,-50%) scale(.96);opacity:0;transition:opacity .22s,transform .22s;text-align:center;padding:10px 16px}
.rg-prev b{display:block;font-size:20px;font-weight:600;line-height:1.25;color:var(--text-strong);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.rg-prev span{display:block;margin-top:4px;font-size:13px;color:var(--text)}
.rg-prev em{display:block;margin-top:8px;font-style:normal;font-weight:600;font-size:14px;color:var(--c-red)}
.rg-needle{position:absolute;height:7px;transform-origin:0 50%;background:var(--c-red);clip-path:polygon(0 0,100% 50%,0 100%);pointer-events:none;z-index:55;opacity:0;transition:transform .55s cubic-bezier(.3,1.45,.5,1),opacity .25s;filter:drop-shadow(0 1px 2px rgba(0,0,0,.3))}
.rg-center.has-prev .rg-hello{opacity:0;transform:scale(.96)}
.rg-center.has-prev .rg-prev{opacity:1;transform:translate(-50%,-50%) scale(1)}
.rg-needle.on{opacity:1}
[data-theme~="red"] .rg-needle{background:#fff;filter:drop-shadow(0 1px 4px rgba(0,0,0,.4))}
[data-theme~="red"] .rg-prev em{color:#fff}
[data-theme~="red"] .rg-hub{fill:#fff}
.rg-guide{position:absolute;left:0;top:0;pointer-events:none;z-index:1}
.rg-empty{padding:80px 0;text-align:center}
@media(max-width:700px){
  .rg-stage{--fw:66px;--fh:50px;--fd:83px;height:360px}
  .rg-frame{border-radius:10px;box-shadow:0 6px 16px rgba(0,0,0,.2)}
  .rg-center{width:150px}
  .rg-hello img{height:64px}
  .rg-prev{width:150px;padding:6px 8px}
  .rg-prev b{font-size:14px}
  .rg-prev span{font-size:11px}
  .rg-prev em{font-size:12px;margin-top:4px}
  .rg-dd,.rg-dd-s{flex:1 1 140px}
}
`;

// protractor geometry: centre of the circle sits on the footer edge, only the upper half exists
const geoFor = (w) => {
  const m = w < 700, fh = m ? 50 : 84;
  const R = m ? Math.min(w * 0.4, 165) : Math.min(w * 0.46, 640, window.innerHeight * 0.66);
  return { w, m, fh, R, cx: w / 2, cy: R + fh / 2 + 34 };
};

function Protractor({ g }) {
  const pt = (r, phi) => { const t = (phi * Math.PI) / 180; return [g.cx - r * Math.cos(t), g.cy - r * Math.sin(t)]; };
  const arc = (r) => `M ${pt(r, 0).join(" ")} A ${r} ${r} 0 0 1 ${pt(r, 180).join(" ")}`;
  const inner = g.m ? g.R - 40 : g.R - 64, outer = g.R + g.fh / 2 + 14;
  const line = { stroke: "var(--line-strong)", strokeWidth: 1.2, fill: "none" };
  const ticks = [];
  if (!g.m) for (let phi = 0; phi <= 180; phi += 10) {
    const big = phi % 30 === 0, [x1, y1] = pt(inner, phi), [x2, y2] = pt(inner - (big ? 16 : 8), phi), [tx, ty] = pt(inner - 34, phi);
    ticks.push(<line key={phi} x1={x1} y1={y1} x2={x2} y2={y2} {...line} />);
    if (big && phi > 0 && phi < 180) ticks.push(<text key={"t" + phi} x={tx} y={ty} textAnchor="middle" dominantBaseline="central" fontSize="11" fill="var(--muted, #888)">{phi}</text>);
  }
  return (
    <svg className="rg-guide" width={g.w} height={g.cy} viewBox={`0 0 ${g.w} ${g.cy}`} aria-hidden="true">
      <path d={arc(outer)} {...line} />
      <path d={arc(inner)} {...line} strokeDasharray="2 5" />
      <circle className="rg-hub" cx={g.cx} cy={g.cy - 1} r="7" fill="var(--c-red)" stroke="var(--card, #fff)" strokeWidth="2.5" />
      {ticks}
    </svg>
  );
}

const PURPOSES = [["", "All"], ["sale", "Sale"], ["rent", "Rent"]];

export function Gallery() {
  useSEO("Gallery", "Photos of homes, land and apartments listed with Sheetal Property.");
  const [type, setType] = useState("All");
  const [purpose, setPurpose] = useState("");
  const [kw, setKw] = useState("");
  const [draft, setDraft] = useState("");
  const { data, loading } = useAsync(() => api.search({
    per_page: 60, page: 1,
    ...(type !== "All" ? { property_type: type } : {}),
    ...(purpose ? { advertisement_purpose: purpose } : {}),
    ...(kw ? { keyword: kw } : {}),
  }).then(toList), [type, purpose, kw]);

  // one frame per photo (first two photos of each property), cycled so the ring is always full
  const pool = (data?.items || []).flatMap((p) => images(p).slice(0, 2).map((src) => ({ src, p })));
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 700px)");
    const f = () => setNarrow(mq.matches);
    f(); mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, []);
  const F = pool.length ? (narrow ? 6 : 12) : 0;
  // each frame hands its photo on every lap: when a frame slides out of sight and wraps round, it comes back with the next photo from the pool
  const laps = useRef([]);
  const [, setVer] = useState(0);
  const N = pool.length;
  const frames = Array.from({ length: F }, (_, i) => pool[(((i + (laps.current[i] || 0) * F) % N) + N) % N]);

  const [hov, setHov] = useState(null);
  const stage = useRef(null);
  const els = useRef([]);
  const hovRef = useRef(null);
  const [geo, setGeo] = useState(null);
  const geoRef = useRef(null);
  const needle = useRef(null);
  const dRef = useRef([]);
  const arrowApi = useRef(null);
  const st = useRef({ angle: 0, target: 0, drag: null, moved: 0, dir: 0, last: 0, prev: 0, sp: 0, vd: 0 });

  useEffect(() => {
    if (!F) return;
    let raf;
    const tick = () => {
      const s = st.current, el = stage.current;
      if (el) {
        if (hovRef.current == null && s.drag == null) s.target += s.dir * 0.16;  // still by default; keeps spinning the way you last pushed it
        s.angle += (s.target - s.angle) * 0.08;                           // eased, mechanical
        const v = s.angle - s.prev; s.prev = s.angle;                     // speed + direction of the ring this frame
        s.sp = s.sp * 0.9 + Math.abs(v) * 0.1;
        if (Math.abs(v) > 0.01) s.vd = Math.sign(v);                      // photos move right when the angle grows
        if (arrowApi.current) arrowApi.current(ARROW_MIN + s.sp * 30, s.sp > 0.05 ? -s.vd : 0);   // still: both heads; spinning: one head, pointing OPPOSITE to the way the photos travel
        const g = geoFor(el.clientWidth), { m, R, cx, cy } = g;
        if (!geoRef.current || geoRef.current.R !== R || geoRef.current.cx !== cx) { geoRef.current = g; setGeo(g); }
        el.style.height = cy + "px";                                          // stage ends exactly on the footer edge
        el.style.setProperty("--cy", cy - (m ? 62 : 150) + "px");
        let lapChanged = false;
        els.current.forEach((c, i) => {
          if (!c) return;
          // photos ride the arc and slide fully out of sight below the footer edge before wrapping to the other end
          const fw = m ? 66 : 116, over = (Math.asin(Math.min(1, (fw / 2 + 10) / R)) * 180) / Math.PI, P = 180 + 2 * over;
          const d = ((((s.angle + (i * P) / F + P / 2) % P) + P) % P) - P / 2, a = (d * Math.PI) / 180;
          dRef.current[i] = d;
          const base = (i * P) / F + P / 2, lap = Math.floor((s.angle + base) / P) - Math.floor(base / P);
          if (lap !== (laps.current[i] || 0)) { laps.current[i] = lap; lapChanged = true; }
          const x = cx + Math.sin(a) * R, y = cy - Math.cos(a) * R;
          c.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%) rotate(${d}deg)`;
          c.style.pointerEvents = Math.abs(d) < 88 ? "auto" : "none";
          c.style.zIndex = 20;
          const im = c.firstChild; if (im) im.style.transform = `translate(-50%,-50%) rotate(${-d}deg)`;   // photo stays upright
        });
        if (lapChanged) setVer((v) => v + 1);
        const nd = needle.current;
        if (nd) {                                                        // speedometer needle: hub -> dotted inner circle, tip just touches the dots
          const hi = hovRef.current, L = R - (m ? 40 : 64);
          nd.style.left = cx + "px"; nd.style.top = cy - 1 - 3.5 + "px"; nd.style.width = L + "px";
          nd.style.transform = `rotate(${hi != null && dRef.current[hi] != null ? dRef.current[hi] - 90 : -180}deg)`;
          nd.classList.toggle("on", hi != null);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const el0 = stage.current;
    const wheel = (e) => {                                  // sideways scroll / trackpad swipe sets the direction
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || !e.deltaX) return;
      e.preventDefault();
      st.current.dir = Math.sign(e.deltaX);
      st.current.target += e.deltaX * 0.25;
    };
    el0 && el0.addEventListener("wheel", wheel, { passive: false });
    return () => { cancelAnimationFrame(raf); el0 && el0.removeEventListener("wheel", wheel); };
  }, [F]);

  // keyboard: left / right arrow keys spin the ring (same as scrolling sideways); hold to keep going, Esc or Space stops it
  useEffect(() => {
    const key = (e) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target, tag = t && t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t && t.isContentEditable)) return;   // don't steal arrows while typing
      if (t && t.closest && t.closest('[role="listbox"],[role="menu"]')) return;                             // or inside an open dropdown
      const s = st.current;
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const d = e.key === "ArrowRight" ? 1 : -1;
        s.dir = d; s.target += d * 14;
      } else if ((e.key === "Escape" || e.key === " ") && s.dir) {
        e.preventDefault(); s.dir = 0;
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const setH = (i) => { hovRef.current = i; setHov(i); };
  const down = (e) => { st.current.drag = e.clientX; st.current.moved = 0; st.current.last = 0; };
  const move = (e) => {
    const s = st.current; if (s.drag == null) return;
    const dx = e.clientX - s.drag; s.drag = e.clientX; s.moved += Math.abs(dx); s.target += dx * 0.25;
    if (dx) s.last = dx;
  };
  const up = () => {
    const s = st.current; if (s.drag == null) return;
    s.drag = null;
    s.dir = s.moved > 6 ? Math.sign(s.last) : 0;          // drag left/right = keep spinning that way; a plain click stops it
  };
  const shown = hov != null ? frames[hov] : null;

  return (
    <>
      <style>{GALLERY_CSS}</style>
      <div className="container rg-top">
        <div className="rg-bar">
          <form className="rg-search" onSubmit={(e) => { e.preventDefault(); setKw(draft.trim()); }}>
            <Search size={17} />
            <input aria-label="Search gallery" value={draft} placeholder="City, locality or property code" onChange={(e) => { setDraft(e.target.value); if (!e.target.value) setKw(""); }} />
            <button type="submit">Search</button>
          </form>
          <div className="rg-dd"><Dropdown id="rg-type" value={type} onChange={setType} align="right" options={[["All", "All types"], ...["House", "Land", "Apartment", "Flat", "Commercial Space", "Bungalow"].map((t) => [t, t])]} /></div>
          <div className="rg-dd rg-dd-s"><Dropdown id="rg-purpose" value={purpose} onChange={setPurpose} align="right" options={[["", "All purposes"], ["sale", "Sale"], ["rent", "Rent"]]} /></div>
        </div>
      </div>
      {loading ? <div className="container"><div className="sk" style={{ height: 420, marginTop: 24 }} /></div> : !F ? (
        <div className="container rg-empty"><p className="muted"><Images size={16} /> No photos match this search.</p></div>
      ) : (
        <div className="rg-stage" ref={stage} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}>
          {geo && <Protractor g={geo} />}
          {geo && <SwipeArrows g={geo} hide={hov != null} apiRef={arrowApi} />}
          <div className="rg-needle" ref={needle} />
          {frames.map((s, i) => (
            <Link key={i} to={linkOf(s.p)} draggable={false} ref={(el) => (els.current[i] = el)} className="rg-frame" aria-label={titleOf(s.p)}
              onMouseEnter={() => setH(i)} onMouseLeave={() => setH(null)} onFocus={() => setH(i)} onBlur={() => setH(null)}
              onClick={(e) => { if (st.current.moved > 6) e.preventDefault(); }}>
              <img src={s.src} alt={titleOf(s.p)} draggable={false} loading="eager" />
            </Link>
          ))}
          <div className={`rg-center ${shown ? "has-prev" : ""}`}>
            <div className="rg-hello">
              <h1 style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}>Gallery</h1>
              <img src="/brand/logo-mark.png" alt="Sheetal Property" draggable={false} />
            </div>
            <div className="rg-prev" aria-hidden="true">
              {shown && <>
                <b>{titleOf(shown.p)}</b>
                {shown.p.property_location && <span>{shown.p.property_location}</span>}
                <em>{purposeOf(shown.p)} · {fmtPrice(purposeOf(shown.p) === "Rent" ? (shown.p.rent_per_month || shown.p.total_price || shown.p.price) : (shown.p.total_price || shown.p.price))}</em>
              </>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}