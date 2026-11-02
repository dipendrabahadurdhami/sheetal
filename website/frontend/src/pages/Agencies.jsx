import { useState } from "react";
import { useSEO } from "../utils/seo";
import { Link } from "react-router-dom";
import { Search, Home as HomeIcon, ClipboardList, Users, ArrowRight } from "lucide-react";
import { api } from "../api/endpoints";
import { toList } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { PageHead, Avatar, Stars, Empty, usePaged, Paged } from "../components/ui";
import { agencyName, agencyTier } from "../utils/format";

const TIERS = ["All", "Pro", "Business", "Starter"];

export function AgencyCard({ a }) {
  return (
    <Link to={`/agency/${a.id}`} className="card card-hover agent-card fade-in" style={{ color: "var(--text)" }}>
      <span className="agent-logo"><Avatar src={a.photo} name={agencyName(a)} /></span>
      <span className="tier">{agencyTier(a.tier) || "Agency"}</span>
      <h3 style={{ fontSize: 20 }} className="row">{agencyName(a)}</h3>
      <span className="small muted">{a.address || a.designation || "Real estate agency"}</span>
      <div className="row small" style={{ gap: 14, marginTop: 6 }}>
        {a.avg_rating ? <span className="row" style={{ gap: 6 }}><Stars value={a.avg_rating} size={12} /><span className="tnum">{a.avg_rating}</span></span> : null}
        {a.listings_count ? <span className="muted tnum">{a.listings_count} listings</span> : null}
      </div>
    </Link>
  );
}

// Fills the rest of the row next to the agencies: wide when there are only a few, stacked when narrow.
export function JoinPanel({ span }) {
  const pts = [[HomeIcon, "List your properties", "Reach buyers across Nepal."], [ClipboardList, "Receive buyer requests", "Matched to demands near you."], [Users, "Get real leads", "Calls straight to your phone."]];
  return (
    <div className={`card join-panel span-${span} ${span >= 3 ? "wide" : "narrow"}`} style={{ "--span": span }}>
      <div className="join-points">
        {pts.map(([I, h, d]) => (
          <div key={h} className="join-point" style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 8 }}>
            <span className="tool-tile-ico"><I size={18} strokeWidth={1.7} /></span>
            <b style={{ display: "block" }}>{h}</b>
            <span className="small muted" style={{ display: "block", maxWidth: 240 }}>{d}</span>
          </div>
        ))}
      </div>
      <div className="join-actions" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12, width: "100%" }}>
        <Link to="/plans?type=agency" className="btn btn-primary btn-block">See agency plans <ArrowRight size={16} /></Link>
        <Link to="/plans" className="btn btn-outline btn-block">Refer an agency</Link>
      </div>
    </div>
  );
}

export default function Agencies() {
  useSEO("Real estate agencies", "Real estate agencies across Nepal: cities they serve, plans and live listings.");
  const { data, loading } = useAsync(() => api.agents().then(toList), []);
  const [q, setQ] = useState("");
  const [tier, setTier] = useState("All");
  const list = (data?.items || []).filter((a) =>
    (tier === "All" || String(a.tier || "").includes(tier)) &&
    (!q || [agencyName(a), a.company_name, a.address, a.designation].join(" ").toLowerCase().includes(q.toLowerCase())));
  const pg = usePaged(list, 12, tier + "|" + q);
  const fill = pg.items.length < 4 ? 4 - pg.items.length : 0; // empty cells in the first row → join panel

  return (
    <>
      <div className="tools-hero agents-hero"><PageHead crumbs={[{ label: "Agencies" }]} kicker="Our agencies" title="Agencies">
        Real estate agencies across Nepal.
      </PageHead></div>
      <div className="container" style={{ paddingTop: 24 }}>
        <div className="row between" style={{ gap: 16, marginBottom: 28, flexWrap: "wrap" }}>
          <div className="row-wrap" style={{ gap: 8 }}>{TIERS.map((t) => <button key={t} className={`chip ${tier === t ? "active" : ""}`} onClick={() => setTier(t)}>{t}</button>)}</div>
          <div style={{ position: "relative", width: "min(360px, 100%)" }}><Search size={16} style={{ position: "absolute", left: 14, top: 16 }} className="muted" /><input className="input" style={{ paddingLeft: 40 }} placeholder="Name, company or city" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        </div>
        {loading ? <div className="grid-cards">{Array.from({ length: 8 }, (_, i) => <div key={i} className="sk" style={{ height: 260, borderRadius: "var(--r-md)" }} />)}</div>
          : list.length ? <div ref={pg.top}><div className="agents-grid">{pg.items.map((a) => <AgencyCard key={a.id} a={a} />)}{fill > 0 && <JoinPanel span={fill} />}</div><Paged pg={pg} /></div>
          : <Empty title="No agencies found">Try another name or tier.</Empty>}
      </div>
    </>
  );
}
