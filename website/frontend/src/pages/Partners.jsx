import { useState } from "react";
import { useSEO } from "../utils/seo";
import { Link, useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";
import { api } from "../api/endpoints";
import { toList } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { PageHead, Avatar, Stars, Empty, usePaged, Paged } from "../components/ui";
import { agencyName, agencyTier } from "../utils/format";
import { seed, VERSION } from "@sheetal/shared/demo/demo";
import { config } from "@sheetal/shared/core/config";

// One directory for every partner: hotels, hosts, developers, agencies and sponsors.
// Agencies come from the agency list (api.agents) and open the agency profile; other businesses open their business page.
const TABS = [["all", "All"], ["hotel", "Hotels"], ["host", "Hosts"], ["developer", "Developers"], ["agency", "Agencies"], ["sponsor", "Sponsors"]];
const KIND = { hotel: "Hotel", host: "Host", developer: "Developer", agency: "Agency", sponsor: "Sponsor" };
const tenants = () => { let s = null; try { s = JSON.parse(localStorage.getItem(config.storageKey)); } catch (e) { /* ignore */ } if (!s || s.version !== VERSION) s = seed(); return (s.tenants || []).filter((x) => x.status === "active" && x.type !== "agency"); };

function PartnerCard({ p }) {
  return (
    <Link to={p.to} className="card card-hover agent-card fade-in" style={{ color: "var(--text)" }}>
      <span className="agent-logo"><Avatar src={p.photo} name={p.name} /></span>
      <span className="tier">{p.kicker}</span>
      <h3 style={{ fontSize: 20 }}>{p.name}</h3>
      <span className="small muted">{p.place}</span>
      <div className="row small" style={{ gap: 14, marginTop: 6, justifyContent: "center" }}>
        {p.rating ? <span className="row" style={{ gap: 6 }}><Stars value={p.rating} size={12} /><span className="tnum">{p.rating}</span></span> : null}
        {p.count ? <span className="muted tnum">{p.count}</span> : null}
      </div>
    </Link>
  );
}

export default function Partners() {
  useSEO("Partners", "Agencies, hotels, developers and investment partners on Sheetal Property.");
  const [params, setParams] = useSearchParams();
  const type = TABS.some(([k]) => k === params.get("type")) ? params.get("type") : "all";
  const [q, setQ] = useState("");
  const { data, loading } = useAsync(() => api.agents().then(toList), []);
  const agencies = (data?.items || []).map((a) => ({ id: `a${a.id}`, type: "agency", name: agencyName(a), kicker: agencyTier(a.tier) ? `${agencyTier(a.tier)} agency` : "Agency", place: a.address || "Nepal", rating: a.avg_rating, count: a.listings_count ? `${a.listings_count} listings` : "", photo: a.photo, to: `/agency/${a.id}` }));
  const others = tenants().map((x) => ({ id: x.id, type: x.type, name: x.name, kicker: KIND[x.type] || "Business", place: `${x.city}, Nepal`, rating: x.rating, count: "", to: `/site/${x.id}` }));
  const all = [...others.filter((x) => x.type !== "sponsor"), ...agencies, ...others.filter((x) => x.type === "sponsor")];
  const list = all.filter((p) => (type === "all" || p.type === type) && (!q || `${p.name} ${p.place} ${p.kicker}`.toLowerCase().includes(q.toLowerCase())));
  const pg = usePaged(list, 18, type + "|" + q);
  const count = (k) => (k === "all" ? all.length : all.filter((p) => p.type === k).length);
  return (
    <>
      <div className="tools-hero agents-hero"><PageHead crumbs={[{ label: "Partners" }]} kicker="Our partners" title="Partners">Hotels, hosts, developers, agencies and sponsors across Nepal.</PageHead></div>
      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div className="row between" style={{ gap: 16, marginBottom: 28, flexWrap: "wrap" }}>
          <div className="row-wrap" style={{ gap: 8 }} role="tablist" aria-label="Partner type">
            {TABS.filter(([k]) => k === "all" || k === type || count(k) > 0).map(([k, l]) => <button key={k} role="tab" aria-selected={type === k} className={`chip ${type === k ? "active" : ""}`} onClick={() => setParams(k === "all" ? {} : { type: k })}>{l} <span className="tnum muted">{count(k)}</span></button>)}
          </div>
          <div style={{ position: "relative", width: "min(360px, 100%)" }}><Search size={16} style={{ position: "absolute", left: 14, top: 16 }} className="muted" /><input className="input" style={{ paddingLeft: 40 }} placeholder="Name or city" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search partners" /></div>
        </div>
        {loading && !list.length ? <div className="agents-grid">{Array.from({ length: 12 }, (_, i) => <div key={i} className="sk" style={{ height: 230, borderRadius: "var(--r-xl)" }} />)}</div>
          : list.length ? <div ref={pg.top}><div className="agents-grid">{pg.items.map((p) => <PartnerCard key={p.id} p={p} />)}</div><Paged pg={pg} /></div>
          : <Empty title="No partners found">Try another name or type.</Empty>}
      </div>
    </>
  );
}
