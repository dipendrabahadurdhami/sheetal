// A property's page: photos, details, price, area map, contact and visit forms, reviews and similar listings.
// Rules: the exact location stays private for sale and rent (area only, also in the Google listing data).

import { clean } from "../utils/sanitize";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { MapPin, Heart, Share2, BedDouble, Bath, Ruler, Compass, Car, Calendar, Layers, Phone, MessageCircle, Mail, Check, Eye, Hash, Route as RoadIcon, Sofa } from "lucide-react";
import { AskAi } from "../components/AskAi";
import { AreaMap } from "../components/LocationMap";
import { useSEO, trackView, SITE_URL } from "../utils/seo";
import { api } from "../api/endpoints";
import { toItem, toList } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { useApp } from "../context/AppContext";
import { Lightbox, Empty, Avatar, Stars } from "../components/ui";
import { ContactForm, TourForm, Reviews } from "../components/Forms";
import { PropertyCard } from "../components/PropertyCard";
import { agencyTier, agentName, fmtFull, fmtPrice, images, isSold, purposeOf, specs, titleOf, fmtDate } from "../utils/format";

const AMENITY = { parking: "Parking", water_supply: "Water supply", security: "Security guard", cctv: "CCTV", power_backup: "Power backup", garden: "Garden", balcony: "Balcony", lift: "Lift", wifi: "WiFi", gym: "Gym", swimming_pool: "Swimming pool", intercom: "Intercom", air_conditioning: "Air conditioning", laundry: "Laundry", gas: "Gas line" };
const ytId = (u = "") => (u.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/) || [])[1];

// Google listing card. Area only: the exact location stays private for sale and rent.
function listingSeo(p) {
  const abs = (u) => (u ? new URL(u, SITE_URL).href : undefined);
  const img = abs(images(p)[0]);
  const rent = purposeOf(p) === "Rent";
  return {
    type: "article", image: img,
    jsonLd: {
      "@context": "https://schema.org", "@type": "RealEstateListing", name: titleOf(p), url: SITE_URL + window.location.pathname, image: img, datePosted: p.created_at,
      offers: { "@type": "Offer", price: Number(rent ? p.rent_per_month || p.total_price : p.total_price) || undefined, priceCurrency: "NPR", availability: isSold(p) ? "https://schema.org/SoldOut" : "https://schema.org/InStock" },
      address: { "@type": "PostalAddress", addressLocality: p.property_location, addressRegion: p.district, addressCountry: "NP" },
    },
  };
}

export default function PropertyDetail() {
  const { id } = useParams();
  const { favs, toggleFav, toast } = useApp();
  const { data: p, loading, error } = useAsync(() => api.property(id).then(toItem), [id]);
  const [box, setBox] = useState(null);
  const [side, setSide] = useState("contact");
  const [ai, setAi] = useState(false);
  useSEO(p ? titleOf(p) : "Property", p?.property_description ? String(p.property_description).replace(/<[^>]*>/g, "").slice(0, 160) : undefined, p ? listingSeo(p) : {});
  useEffect(() => { if (p?.name) trackView(window.location.pathname, p.name); }, [p?.name]);
  const related = useAsync(async () => {
    if (!p) return { items: [] };
    const purpose = purposeOf(p).toLowerCase();
    const r = toList(await api.byPurpose(purpose, 1, 9));
    return { items: r.items.filter((x) => x.id !== p.id).slice(0, 4) };
  }, [p?.id]);

  if (loading) return <div className="container" style={{ paddingTop: 32 }}><div className="sk" style={{ height: 470, borderRadius: "var(--r-md)" }} /><div className="sk" style={{ height: 40, width: "60%", marginTop: 32 }} /></div>;
  if (error || !p) return <div className="container"><Empty title="Property not found">It may have been sold or removed. <Link to="/search">Browse other listings</Link>.</Empty></div>;

  const imgs = images(p);
  const s = specs(p);
  const purpose = purposeOf(p);
  const isRent = purpose === "Rent";
  const price = isRent ? (p.rent_per_month || p.total_price) : p.total_price;
  const fav = favs.has(Number(p.id));
  const agent = p.agent;
  const amen = [...Object.keys(AMENITY).filter((k) => p[k] && p[k] !== "0" && p[k] !== "no" && typeof p[k] !== "object"), ...(Array.isArray(p.amenities) ? p.amenities : [])]
    .map((a) => (typeof a === "object" ? a.name : AMENITY[a] || a)).filter((v, i, arr) => v && arr.indexOf(v) === i);
  const facts = [
    [BedDouble, "Bedrooms", s.beds || null], [Bath, "Bathrooms", s.baths || null], [Ruler, "Land area", s.area],
    [Layers, "Floors", p.floors || null], [Ruler, "Built-up", p.built_up_area], [RoadIcon, "Road access", p.road_access || p.main_road_width],
    [Compass, "Facing", p.facing || p.land_facing], [Car, "Parking", typeof p.parking === "string" ? p.parking : null], [Sofa, "Furnishing", p.furnishing],
    [Calendar, "Built in", p.built_year || p.completion_year], [Hash, "Property code", p.property_code], [Eye, "Views", p.views],
  ].filter(([, , v]) => v);
  const vid = ytId(p.youtube_url || "");
  const share = async () => {
    const url = window.location.href;
    if (navigator.share) { try { await navigator.share({ title: titleOf(p), url }); } catch {} }
    else { await navigator.clipboard.writeText(url); toast("Link copied"); }
  };

  return (
    <>
      <div className="container" style={{ paddingTop: 24 }}>
        <div className="crumbs"><Link to="/">Home</Link><span>/</span><Link to={`/${purpose.toLowerCase()}`}>{purpose === "Sale" ? "Buy" : purpose}</Link><span>/</span><span>{p.district || p.property_type}</span></div>
        <div className="row between detail-head" style={{ flexWrap: "wrap", alignItems: "center", gap: 16, marginBottom: 20 }}>
          <div className="stack" style={{ gap: 10, flex: "1 1 520px", minWidth: 0 }}>
                        <h1 style={{ fontSize: "clamp(26px, 3.4vw, 40px)" }}>{titleOf(p)}</h1>
            <div className="row-wrap" style={{ gap: 8 }}>
              <span className="tag tag-red">{p.price_per === "night" ? "Stay" : `For ${purpose}`}</span>
              {p.property_type && <span className="tag tag-line">{p.property_type}</span>}
              {isSold(p) && <span className="tag tag-line">{isRent ? "Rented out" : "Sold"}</span>}
            </div>
            <span className="row muted" style={{ gap: 6 }}><MapPin size={16} color="var(--c-red)" />{p.property_location}{p.district && !String(p.property_location).includes(p.district) ? `, ${p.district}` : ""}</span>
          </div>
          <div className="row detail-actions" style={{ gap: 8 }}>
            <button className="btn btn-outline" onClick={() => setAi(true)}>Ask AI</button>
            <button className="btn btn-outline" onClick={share}><Share2 size={16} /> Share</button>
            <button className="btn btn-outline" onClick={() => toggleFav(p.id)}><Heart size={16} fill={fav ? "var(--c-red)" : "none"} color={fav ? "var(--c-red)" : "currentColor"} /> {fav ? "Saved" : "Save"}</button>
          </div>
        </div>

        {(() => {
          // every photo fits in the same box: 1–5 use fixed layouts, 6+ become a phone-style grid (first photo big)
          const list = imgs.length ? imgs : ["/demo/1.jpg"];
          const n = list.length;
          if (n <= 5) return (
            <div className={`gallery g-${n}`}>
              {list.map((src, i) => <button key={i} className="g-item" onClick={() => setBox(i)}><img src={src} alt="" /></button>)}
            </div>
          );
          const cells = n + 3; // first photo takes 2×2
          const rows = Math.max(2, Math.round(Math.sqrt(cells / 2.6)));
          const cols = Math.ceil(cells / rows);
          const spare = rows * cols - cells; // last photo stretches to fill the row
          return (
            <div className="gallery g-many" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
              {list.map((src, i) => (
                <button key={i} className="g-item" onClick={() => setBox(i)}
                  style={i === 0 ? { gridColumn: "span 2", gridRow: "span 2" } : i === n - 1 && spare ? { gridColumn: `span ${spare + 1}` } : undefined}>
                  <img src={src} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          );
        })()}
      </div>

      <nav className="subnav" style={{ marginTop: 24 }}>
        <div className="container">{[["overview", "Overview"], ["details", "Details"], ["amenities", "Amenities"], vid && ["video", "Video"], ["location", "Location"], ["reviews", "Reviews"]].filter(Boolean).map(([k, l]) => <a key={k} href={`#${k}`}>{l}</a>)}</div>
      </nav>

      <div className="container detail-layout" style={{ marginTop: 0 }}>
        <div>
          <section id="overview" className="detail-section" style={{ paddingTop: 32 }}>
            <div className="row-wrap" style={{ gap: 28, marginBottom: 24 }}>
              {s.beds > 0 && <span className="row"><BedDouble size={20} strokeWidth={1.4} />{s.beds} bedrooms</span>}
              {s.baths > 0 && <span className="row"><Bath size={20} strokeWidth={1.4} />{s.baths} bathrooms</span>}
              {s.area && <span className="row"><Ruler size={20} strokeWidth={1.4} />{s.area}</span>}
              {p.created_at && <span className="row muted small">Listed {fmtDate(p.created_at)}</span>}
            </div>
            {p.property_highlights && <div className="card card-pad prose" style={{ background: "var(--surface)", borderColor: "transparent", marginBottom: 24 }} dangerouslySetInnerHTML={{ __html: clean(p.property_highlights) }} />}
            {p.property_description && <div className="prose" dangerouslySetInnerHTML={{ __html: clean(p.property_description) }} />}
            {p.other_description && <div className="prose" dangerouslySetInnerHTML={{ __html: clean(p.other_description) }} />}
          </section>

          <section id="details" className="detail-section">
            <h3>Property details</h3>
            <div className="facts">{facts.map(([I, l, v]) => <div key={l}><span>{l}</span><b className="tnum">{v}</b></div>)}</div>
          </section>

          {amen.length > 0 && (
            <section id="amenities" className="detail-section">
              <h3>What this place offers</h3>
              <div className="amenities">{amen.map((a) => <div key={a}><Check size={18} />{a}</div>)}</div>
            </section>
          )}

          <MoreDetails p={p} />
          <ProjectUnits p={p} />
          <StayRooms p={p} />

          {vid && (
            <section id="video" className="detail-section">
              <h3>Video tour</h3>
              <div style={{ aspectRatio: "16/9", borderRadius: "var(--r-md)", overflow: "hidden" }}>
                <iframe title="Video tour" src={`https://www.youtube-nocookie.com/embed/${vid}`} style={{ width: "100%", height: "100%", border: 0 }} allowFullScreen />
              </div>
            </section>
          )}

          <section id="location" className="detail-section">
            <h3>Location</h3>
            <p className="muted" style={{ marginBottom: 16 }}>{p.property_location}{p.district ? `, ${p.district}` : ""}</p>
            <AreaMap lat={p.latitude ?? p.lat} lng={p.longitude ?? p.lng} seed={p.property_code || p.id} area={p.property_location} shifted={!!p.location_approximate} />
          </section>

        </div>

        <aside style={{ paddingTop: 32 }}>
          <div id="enquire" className="card card-pad stack" style={{ gap: 20, boxShadow: "var(--shadow)" }}>
            <div>
              <span className="price-big tnum">{fmtPrice(price)}</span>{isRent && <span className="muted">{p.price_per === "night" ? " / night" : " / month"}</span>}
              {Number(price) > 0 && <div className="small muted tnum" style={{ marginTop: 4 }}>{fmtFull(price)}{p.price_negotiable ? " · negotiable" : ""}</div>}
            </div>
            {p.raise_funds && side !== "invest-done" && <InvestForm p={p} />}
            <div className="seg" style={{ width: "100%" }}>
              <button style={{ flex: 1 }} className={side === "contact" ? "on" : ""} onClick={() => setSide("contact")}>Agency</button>
              <button style={{ flex: 1 }} className={side === "owner" ? "on" : ""} onClick={() => setSide("owner")}>Owner</button>
              <button style={{ flex: 1 }} className={side === "tour" ? "on" : ""} onClick={() => setSide("tour")}>Visit</button>
            </div>
            {side === "tour" ? <TourForm propertyId={p.id} /> : <ContactForm key={side} to={side === "owner" ? "owner" : "agent"} compact agentId={agent?.id || p.agent_id} agentName={agentName(agent)} agentPhoto={agent?.photo} propertyId={p.id} propertyName={titleOf(p)} />}
            <div className="hr" style={{ margin: 0 }} />
            <Link to={agent?.id ? `/agency/${agent.id}` : "#"} className="row" style={{ color: "var(--text)" }}>
              <Avatar src={agent?.photo} name={agentName(agent)} size={52} logo />
              <div style={{ minWidth: 0 }}>
                <b style={{ color: "var(--text-strong)", fontWeight: 500 }}>{agentName(agent)}</b>
                <div className="tiny muted">{agent?.tier ? `${agencyTier(agent.tier)} agency` : agent?.designation || "Listing agency"}</div>
                {agent?.avg_rating && <Stars value={agent.avg_rating} size={12} />}
              </div>
            </Link>
            <div className="row" style={{ gap: 8 }}>
              {agent?.phone && <a className="btn btn-outline btn-sm" style={{ flex: 1 }} href={`tel:${agent.phone}`}><Phone size={14} /> Call</a>}
              {agent?.whatsapp && <a className="btn btn-outline btn-sm" style={{ flex: 1 }} href={`https://wa.me/${String(agent.whatsapp).replace(/\D/g, "")}`} target="_blank" rel="noreferrer"><MessageCircle size={14} /> WhatsApp</a>}
              {agent?.email && <a className="btn btn-outline btn-sm btn-icon" href={`mailto:${agent.email}`} aria-label="Email"><Mail size={14} /></a>}
            </div>
          </div>
          <section id="reviews" className="card card-pad stack" style={{ gap: 16, marginTop: 20 }}>
            <h3>Reviews</h3>
            <Reviews type="property" id={p.id} />
          </section>
        </aside>
      </div>

      {related.data?.items?.length > 0 && (
        <section className="container section-sm">
          <h2 style={{ marginBottom: 28 }}>Similar properties</h2>
          <div className="grid-cards">{related.data.items.map((r) => <PropertyCard key={r.id} p={r} />)}</div>
        </section>
      )}

      <div className="pa-listbar" role="group" aria-label="Contact">
        <a className="pa-sq" href={`tel:${agent?.phone || "+9779801136817"}`} aria-label="Call"><Phone size={20} /></a>
        <a className="pa-sq" href={`https://wa.me/${String(agent?.whatsapp || "9779801136817").replace(/\D/g, "")}?text=${encodeURIComponent(`Hello, I am asking about ${titleOf(p)} (#${p.property_code || p.id})`)}`} target="_blank" rel="noreferrer" aria-label="WhatsApp"><MessageCircle size={20} /></a>
        <button type="button" className="btn btn-primary" onClick={() => { setSide("contact"); document.getElementById("enquire")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>{isSold(p) ? "Ask about similar" : "Enquire"}</button>
      </div>

      {box !== null && <Lightbox images={imgs} index={box} onClose={() => setBox(null)} />}
      {ai && <AskAi open={ai} onClose={() => setAi(false)} start={p} />}
    </>
  );
}

// Rooms, beds, bathrooms and the other stay details the host chose in the listing form (business panel).
function StayRooms({ p }) {
  const rooms = Array.isArray(p.rooms) ? p.rooms : [];
  const sleeping = Array.isArray(p.sleeping) ? p.sleeping : [];
  const arr = (x) => (Array.isArray(x) ? x : []).filter(Boolean);
  const lists = [["Bathroom", [p.bathroom_type, ...arr(p.bathroom_items)]], ["Kitchen and dining", p.kitchen], ["Views", p.views], ["Safety", p.safety], ["Accessibility", p.accessibility], ["House rules", p.house_rules]]
    .map(([l, x]) => [l, arr(x)]).filter(([, x]) => x.length);
  const times = [p.check_in && `Check-in from ${p.check_in}`, p.check_out && `check-out by ${p.check_out}`, p.cancellation && `${p.cancellation} cancellation`].filter(Boolean).join(" · ");
  if (!rooms.length && !sleeping.length && !lists.length && !times) return null;
  const bedText = (r) => [r.bed && (r.beds > 1 ? `${r.beds} × ${r.bed} bed` : `${r.bed} bed`), r.bathroom && `${r.bathroom} bathroom`].filter(Boolean).join(" · ");
  return (
    <section id="rooms" className="detail-section">
      <h3>{rooms.length ? "Rooms" : "Where you'll sleep"}</h3>
      {rooms.length > 0 && <div className="facts">{rooms.map((r, i) => (
        <div key={i}><span>{[r.type, r.count > 1 && `${r.count} rooms`].filter(Boolean).join(" · ")}</span>
          <b>{[bedText(r), r.guests && `up to ${r.guests} guests`, r.view, r.size && `${r.size} sq ft`, Number(r.price) > 0 && `${fmtPrice(r.price)} / night`].filter(Boolean).join(" · ")}</b>
          {arr(r.amenities).length > 0 && <small className="muted">{arr(r.amenities).join(", ")}</small>}</div>
      ))}</div>}
      {sleeping.length > 0 && <div className="facts">{sleeping.map((r, i) => <div key={i}><span>{r.room}</span><b>{bedText(r)}</b></div>)}</div>}
      {lists.map(([l, x]) => <div key={l} style={{ marginTop: 16 }}><b className="small">{l}</b><div className="amenities">{x.map((a) => <div key={a}><Check size={18} />{a}</div>)}</div></div>)}
      {times && <p className="muted small" style={{ marginTop: 12 }}>{times}</p>}
    </section>
  );
}

// A project's unit types: type, how many, size and price ("Price on request" when the business left it empty).
function ProjectUnits({ p }) {
  const units = (Array.isArray(p.units) ? p.units : []).filter((u) => u && u.type);
  if (!units.length) return null;
  return (
    <section id="units" className="detail-section">
      <h3>Units</h3>
      <div className="facts">{units.map((u, i) => (
        <div key={i}><span>{[u.type, Number(u.count) > 0 && `${u.count} units`].filter(Boolean).join(" · ")}</span>
          <b>{[Number(u.size) > 0 && `${Number(u.size).toLocaleString("en-IN")} sq ft`, fmtPrice(u.price)].filter(Boolean).join(" · ")}</b></div>
      ))}</div>
    </section>
  );
}

// Invest online: shown when the business switched on "Raise funds online". The pledge (amount and contact) goes to the business, which
// sends the agreement and payment details; nothing is charged here.
function InvestForm({ p }) {
  const [f, setF] = useState({ amount: "", name: "", phone: "", email: "", note: "", website: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const send = async (e) => {
    e.preventDefault(); setErr(""); setBusy(true);
    try { const r = await api.invest(p.id, { ...f, amount: Number(String(f.amount).replace(/\D/g, "")) }); setMsg(r?.message || "Thank you. Your pledge is recorded."); }
    catch (x) { setErr(x.errors ? Object.values(x.errors).flat()[0] : x.message); }
    finally { setBusy(false); }
  };
  if (msg) return <div className="invest-done"><Check size={22} /><p className="small">{msg}</p></div>;
  return (
    <form className="stack invest-form" style={{ gap: 10 }} onSubmit={send}>
      <b>Invest in this project</b>
      <label className="field"><span className="small">Amount (Rs.)</span><input className="input tnum" inputMode="numeric" required placeholder="e.g. 5,00,000" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d,]/g, "") })} /></label>
      <input className="input" required minLength={2} maxLength={80} placeholder="Your name" autoComplete="name" value={f.name} onChange={set("name")} />
      <input className="input" type="tel" required placeholder="Phone" autoComplete="tel" value={f.phone} onChange={set("phone")} />
      <input className="input" type="email" placeholder="Email (optional)" autoComplete="email" value={f.email} onChange={set("email")} />
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="sr-only" value={f.website} onChange={set("website")} />
      {err && <p className="error small" style={{ margin: 0 }}>{err}</p>}
      <button className="btn btn-primary btn-block" disabled={busy}>{busy ? "Sending…" : "Pledge to invest"}</button>
      <p className="tiny muted" style={{ margin: 0 }}>No payment now. The business calls you with the agreement and how to pay.</p>
    </form>
  );
}

// The extra facts the listing form asks for each type (floor, society fee, land shape…) and fields Sheetal added.
function MoreDetails({ p }) {
  const rows = (Array.isArray(p.more) ? p.more : []).filter((r) => Array.isArray(r) && r[0] && r[1]);
  if (!rows.length) return null;
  return (
    <section id="more" className="detail-section">
      <h3>More details</h3>
      <div className="facts">{rows.map(([l, v]) => <div key={l}><span>{l}</span><b>{v}</b></div>)}</div>
    </section>
  );
}
