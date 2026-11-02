import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useSEO } from "../utils/seo";
import { MapPin, Phone, MessageCircle, BadgeCheck } from "lucide-react";
import { Empty } from "../components/ui";
import { fmtPrice, fmtDate } from "../utils/format";
import { readDb } from "../utils/platformDb";
import { AreaMap, ExactMap } from "../components/LocationMap";
import { showsExactLocation } from "@sheetal/shared/data/catalog";
import { fdate } from "@sheetal/shared/core/format";
import { CheckupCard, useCheckups } from "@sheetal/shared/components/CheckupCard";
import { PlatformWrap } from "../market/SiteRows";

// A listing a business published from its workspace. Shows only the fields that listing has.
// Team members of the business that owns it also get a quick "check this listing" bar.
const SKIP = new Set(["title", "photos", "location", "pin", "category", "price", "rent", "description", "docs"]);
const human = (k) => k.replace(/([A-Z])/g, " $1").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

export default function ListingDetail() {
  const { id } = useParams();
  const db = readDb();
  const C = db.catalog || {};
  const l = (db.listings || []).find((x) => x.id === id && x.status === "published");
  useSEO(l?.title || "Listing", l ? `${l.title}. Listed by a Sheetal partner.` : undefined);
  if (!l) return <div className="container"><Empty title="Listing not found">It may have been sold or removed. <Link to="/search">Browse other listings</Link>.</Empty></div>;
  const v = l.values || {};
  const tenant = (db.tenants || []).find((t) => t.id === l.tenantId);
  const all = Object.values(C).filter(Array.isArray).flat();
  const name = (x) => all.find((o) => o && o.id === x)?.en || x;
  const show = (x) => {
    if (x === true) return "Yes";
    if (Array.isArray(x)) return x.map((y) => (typeof y === "object" ? null : name(y))).filter(Boolean).join(", ");
    if (x && typeof x === "object") return Object.entries(x).filter(([k, y]) => k !== "sys" && y).map(([k, y]) => `${y} ${k}`).join(" ");
    return typeof x === "string" ? name(x) : x;
  };
  const facts = [
    ["Type", name(v.category)],
    ...Object.entries(v).filter(([k]) => !SKIP.has(k)).map(([k, x]) => [human(k), show(x)]),
  ].filter(([, x]) => x !== undefined && x !== null && x !== "" && x !== false);
  const loc = [v.location?.area, name(v.location?.district)].filter(Boolean).join(", ");
  const photos = (v.photos || []).map((p) => p.url).filter(Boolean);
  const rent = l.kind === "rentout";
  const phone = String(tenant?.phone || "").replace(/[^\d+]/g, "");
  return (
    <div className="container" style={{ paddingTop: 24, paddingBottom: 48 }}>
      <nav className="muted small" style={{ marginBottom: 12 }}><Link to={rent ? "/rent" : "/sale"}>{rent ? "Rent" : "Buy"}</Link> / {l.id}</nav>
      {photos.length > 0 && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 8, marginBottom: 24 }}>
        {photos.slice(0, 5).map((src, i) => <img key={i} src={src} alt="" style={{ width: "100%", aspectRatio: "4 / 3", objectFit: "cover", borderRadius: "var(--r-md)" }} />)}
      </div>}
      {(db.session?.memberships || []).includes(l.tenantId) && <PlatformWrap><TeamCheck listing={l} /></PlatformWrap>}
      <div className="detail-layout" style={{ marginTop: 0 }}>
        <div>
          <section className="detail-section" style={{ paddingTop: 0 }}>
            <h1 style={{ marginBottom: 8 }}>{l.title}</h1>
            {loc && <span className="row muted" style={{ gap: 6 }}><MapPin size={16} color="var(--c-red)" />{loc}</span>}
            {l.lastChecked && <span className="cu-verified" style={{ marginTop: 6 }}><BadgeCheck size={14} />Information checked on {fdate(l.lastChecked)}</span>}
          </section>
          {facts.length > 0 && <section className="detail-section"><h3>Details</h3>
            <dl style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 2fr)", gap: "10px 16px" }}>
              {facts.map(([k, x]) => [<dt key={k + "k"} className="muted">{k}</dt>, <dd key={k + "v"} style={{ margin: 0 }}>{String(x)}</dd>])}
            </dl></section>}
          {v.description && <section className="detail-section"><h3>About this property</h3><p style={{ whiteSpace: "pre-line" }}>{v.description}</p></section>}
          {(loc || v.pin) && <section className="detail-section"><h3>Location</h3>
            {showsExactLocation(l.kind)
              ? <ExactMap lat={v.pin?.lat} lng={v.pin?.lng} name={l.title} address={loc} />
              : <AreaMap lat={v.pin?.lat} lng={v.pin?.lng} seed={l.id} area={loc} />}</section>}
        </div>
        <aside><div className="card card-pad" style={{ position: "sticky", top: 96, display: "grid", gap: 12 }}>
          <b style={{ fontSize: 24 }}>{fmtPrice(l.price || v.price || v.rent)}{rent ? " / month" : ""}</b>
          <span className="muted small">Listed by {tenant?.name || "a Sheetal partner"} · updated {fmtDate(l.updated)}</span>
          {phone && <a className="btn btn-primary btn-block" href={`tel:${phone}`}><Phone size={16} /> Call</a>}
          {phone && <a className="btn btn-outline btn-block" href={`https://wa.me/${phone.replace(/^\+/, "")}?text=${encodeURIComponent(`Hi, I am interested in ${l.title} (${l.id})`)}`} target="_blank" rel="noreferrer"><MessageCircle size={16} /> WhatsApp</a>}
        </div></aside>
      </div>
    </div>
  );
}

// Shown only to the listing's own team: last check, and the same compact check-up card as in Business.
function TeamCheck({ listing }) {
  const { act } = useCheckups(listing.tenantId);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState("");
  if (done) return <div className="cu-site-bar"><BadgeCheck size={16} /><span>Saved: <b>{done}</b>. Thank you.</span><a className="btn btn-outline btn-sm" href="/business/checkups">More to check</a></div>;
  return (
    <>
      <div className="cu-site-bar">
        <span><b>You manage this listing.</b> {listing.lastChecked ? `Last checked ${fdate(listing.lastChecked)}.` : "Never checked."}{listing.suggest?.length ? ` ${listing.suggest.length} possible fixes found.` : ""}</span>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(!open)}>{open ? "Close" : "Check it now"}</button>
      </div>
      {open && <div className="cu-phone" style={{ marginBottom: 24 }}><CheckupCard listing={listing} step={0} total={0} act={act}
        onDone={(a) => setDone({ ok: "all correct", edit: "details updated", sold: "sold or rented", extend: "extended", expire: "expired", remove: "removed", skip: "skipped" }[a])}
        onEdit={() => { window.location.href = "/business/checkups"; }} /></div>}
    </>
  );
}
