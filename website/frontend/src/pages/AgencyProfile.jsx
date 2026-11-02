import { useState, useRef } from "react";
import { useSEO } from "../utils/seo";
import { ProfileExtras } from "../market/SiteRows";
import { Link, useParams } from "react-router-dom";
import { Phone, Mail, MessageCircle, MapPin, Facebook, Instagram, Globe } from "lucide-react";
import { api } from "../api/endpoints";
import { toItem, toList } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { Avatar, Stars, Empty, Pagination } from "../components/ui";
import { PropertyGrid } from "../components/PropertyCard";
import { ContactForm, Reviews } from "../components/Forms";
import { agencyName, agencyTier } from "../utils/format";

export default function AgencyProfile() {
  const { id } = useParams();
  const { data: a, loading, error } = useAsync(() => api.agent(id).then(toItem), [id]);
  useSEO(a ? agencyName(a) : "Agency", a ? `Listings and contact details for ${agencyName(a)}.` : undefined);
  const PER = 12;
  const [pg, setPg] = useState(1);
  // One page at a time from the API (an agency can have thousands of listings).
  const props = useAsync(() => api.agentProperties(id, pg, PER).then(toList), [id, pg]);
  const listTop = useRef(null);
  const all = props.data?.items || [];
  // The demo data returns everything at once; the API returns one page and the total.
  const paged = all.length <= PER;
  const total = props.data?.total ?? all.length;
  const last = paged ? Math.max(1, props.data?.last || 1) : Math.max(1, Math.ceil(all.length / PER));
  const page = Math.min(pg, last);
  const pageItems = paged ? all : all.slice((page - 1) * PER, page * PER);
  const goPage = (n) => { setPg(n); const el = listTop.current; if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 90, behavior: "smooth" }); };
  if (loading) return <div className="container section"><div className="sk" style={{ height: 220, borderRadius: "var(--r-md)" }} /></div>;
  if (error || !a) return <div className="container"><Empty title="Agency not found"><Link to="/partners?type=agency">See all agencies</Link></Empty></div>;
  const name = agencyName(a);
  const socials = [[Facebook, a.facebook_url], [Instagram, a.instagram_url], [Globe, a.website_url || a.website]].filter(([, h]) => h && h !== "null");

  return (
    <>
      <section style={{ borderBottom: "1px solid var(--line)" }}>
        <style>{`
.hero-contact-d,.hero-social-d{display:none}
@media (min-width: 900px){
  .agent-hero{grid-template-columns:auto 1fr auto !important}
  .hero-contact-m{display:none !important}
  .hero-contact-d{display:flex;flex-direction:column;gap:8px;width:210px}
  .hero-contact-d .btn{padding:8px 12px !important;font-size:13px !important;min-height:0 !important;justify-content:center;gap:6px}
  .hero-contact-d .btn-icon{padding:8px !important;flex:0 0 auto}
  .hero-contact-row{display:flex;gap:8px;justify-content:center}
  .hero-social-d{display:inline-flex;align-items:center;gap:4px}
  .hero-social-d .btn{padding:6px !important;min-height:0 !important}
  .hero-contact-row .btn-outline{flex:1}
}
`}</style>
        <div className="container agent-hero" style={{ paddingTop: 40, paddingBottom: 32, display: "grid", gridTemplateColumns: "auto 1fr", gap: 32, alignItems: "center" }}>
          <Avatar src={a.photo} name={name} size={140} />
          <div className="stack" style={{ gap: 10 }}>
            <span className="tier">{agencyTier(a.tier) ? `${agencyTier(a.tier)} agency` : "Agency"}</span>
            <h1 style={{ fontSize: "clamp(28px, 3.6vw, 42px)" }} className="row">{name}</h1>
            <span className="muted">{[a.designation, a.company_name !== name ? a.company_name : null].filter(Boolean).join(" · ")}</span>
            <div className="row-wrap" style={{ gap: 18 }}>
              {a.avg_rating && <span className="row" style={{ gap: 8 }}><Stars value={a.avg_rating} /><span className="tnum">{a.avg_rating} ({a.review_count || 0})</span></span>}
              {a.address && <span className="row muted small" style={{ gap: 6 }}><MapPin size={14} />{a.address}</span>}
              {socials.length > 0 && <span className="hero-social-d">{socials.map(([I, h]) => <a key={h} className="btn btn-ghost btn-icon" href={h} target="_blank" rel="noreferrer"><I size={16} /></a>)}</span>}
            </div>
            <div className="row-wrap hero-contact-m" style={{ marginTop: 8 }}>
              {a.phone && <a className="btn btn-primary" href={`tel:${a.phone}`}><Phone size={16} /> {a.phone}</a>}
              {a.whatsapp && <a className="btn btn-outline" href={`https://wa.me/${String(a.whatsapp).replace(/\D/g, "")}`} target="_blank" rel="noreferrer"><MessageCircle size={16} /> WhatsApp</a>}
              {a.email && <a className="btn btn-outline" href={`mailto:${a.email}`}><Mail size={16} /> Email</a>}
              {socials.map(([I, h]) => <a key={h} className="btn btn-ghost btn-icon" href={h} target="_blank" rel="noreferrer"><I size={17} /></a>)}
            </div>
          </div>
          <div className="hero-contact-d">
            {a.phone && <a className="btn btn-primary" href={`tel:${a.phone}`}><Phone size={14} /> {a.phone}</a>}
            <div className="hero-contact-row">
              {a.whatsapp && <a className="btn btn-outline" href={`https://wa.me/${String(a.whatsapp).replace(/\D/g, "")}`} target="_blank" rel="noreferrer"><MessageCircle size={14} /> WhatsApp</a>}
              {a.email && <a className="btn btn-outline" href={`mailto:${a.email}`}><Mail size={14} /> Email</a>}
            </div>
          </div>
        </div>
      </section>
      <div className="container detail-layout">
        <div className="stack" style={{ gap: 48 }}>
          {a.about && <section><h3 style={{ marginBottom: 12 }}>About {a.first_name || name}</h3><p className="prose">{a.about}</p></section>}
          <section ref={listTop}>
            <div className="row between" style={{ marginBottom: 20, alignItems: "baseline" }}>
              <h3>Listings by {a.first_name || name}</h3>
              {total > 0 && <span className="small muted">{total.toLocaleString("en-IN")} {total === 1 ? "property" : "properties"}</span>}
            </div>
            <style>{`@media (min-width: 1100px) { .agent-grid > div { grid-template-columns: repeat(4, minmax(0, 1fr)) !important; gap: 14px !important; } }`}</style>
            {!props.loading && !all.length ? <p className="muted">No active listings right now.</p> : <div className="agent-grid"><PropertyGrid loading={props.loading} items={pageItems} count={4} /></div>}
            <Pagination page={page} last={last} onChange={goPage} />
          </section>
        </div>
        <aside className="stack agent-side" style={{ gap: 16 }}>
          <div className="card card-pad stack"><h3>Send a message</h3><ContactForm compact agentId={a.id} /></div>
          <div className="card card-pad stack agent-reviews"><h3>Client reviews</h3><Reviews type="agent" id={a.id} /></div>
        </aside>
      </div>
      <ProfileExtras />
    </>
  );
}