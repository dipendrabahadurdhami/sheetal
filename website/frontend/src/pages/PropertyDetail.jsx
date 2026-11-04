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
              <span className="tag tag-red">For {purpose}</span>
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
          <div className="card card-pad stack" style={{ gap: 20, boxShadow: "var(--shadow)" }}>
            <div>
              <span className="price-big tnum">{fmtPrice(price)}</span>{isRent && <span className="muted"> / month</span>}
              {Number(price) > 0 && <div className="small muted tnum" style={{ marginTop: 4 }}>{fmtFull(price)}{p.price_negotiable ? " · negotiable" : ""}</div>}
            </div>
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

      {box !== null && <Lightbox images={imgs} index={box} onClose={() => setBox(null)} />}
      {ai && <AskAi open={ai} onClose={() => setAi(false)} start={p} />}
    </>
  );
}
