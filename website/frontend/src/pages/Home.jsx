// The home page: hero search, featured and latest listings, and the marketplace rows.
// The hero shows paid home page banners behind the title and search when any are running (up to 3, sliding every
// 6 seconds, with a dark shade so the words stay readable); otherwise the plain hero. Small "Advertise here" and
// "Boost your listing" links lead businesses to Business → Promote.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useSEO } from "../utils/seo";
import { Home as HomeIcon, Trees, Building2, Building, Store, Briefcase, Castle, Calculator, Ruler, TrendingUp, KeyRound, Landmark, Receipt, Wallet } from "lucide-react";
import { api } from "../api/endpoints";
import { toList } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { HeroSearch } from "../components/HeroSearch";
import { PhoneHomeTop, LoopStrip } from "../components/PhoneApp";
import { useMedia } from "../hooks/useAsync";
import { PropertyCard, CardSkeleton, PropertyGrid } from "../components/PropertyCard";
import { SectionHead } from "../components/ui";
import { fmtDate, fmtPrice, imgUrl } from "../utils/format";
import { AgencyCard, JoinPanel } from "./Agencies";
import HomePlatformRows from "../market/SiteRows";

const CATS = [["House", HomeIcon], ["Land", Trees], ["Apartment", Building2], ["Flat", Building], ["Commercial Space", Store], ["Office Space", Briefcase], ["Bungalow", Castle]];
const PLACES = [["Kathmandu", "/demo/12.jpg"], ["Lalitpur", "/demo/15.jpg"], ["Bhaktapur", "/demo/17.jpg"], ["Pokhara", "/demo/19.jpg"]];
const FALLBACK_HERO = ["/demo/12.jpg", "/demo/15.jpg", "/demo/17.jpg"];

const adLink = { fontSize: 12, textDecoration: "underline", textUnderlineOffset: 3 };

// One banner's background: its own pictures (computer and phone), or for a listing banner the listing's photos as a grid
// (a big one and up to four small; on a phone a big one and a row of three) that fills the same space.
function BannerBg({ b, on, eager }) {
  const style = { position: "absolute", inset: 0, zIndex: -2, opacity: on ? 1 : 0, transition: "opacity .8s ease" };
  if (b.listing) {
    const ph = b.listing.photos.slice(0, 5);
    return (
      <div aria-hidden={!on} className={`hb-grid n${ph.length}`} style={style}>
        {ph.map((u, k) => <img key={u} src={u} alt={k ? "" : b.listing.title} loading={eager && k < 3 ? "eager" : "lazy"} decoding="async" />)}
      </div>
    );
  }
  return (
    <picture aria-hidden={!on} style={style}>
      <source media="(max-width: 700px)" srcSet={b.mobile} />
      <img src={b.desktop} alt={b.title || "Advertisement"} style={{ width: "100%", height: "100%", objectFit: "cover" }} loading={eager ? "eager" : "lazy"} />
    </picture>
  );
}

function Hero() {
  const banners = useAsync(() => api.banners().then((r) => r?.data || []).catch(() => []), []);
  const list = banners.data || [];
  const [i, setI] = useState(0);
  const cur = list[i % Math.max(1, list.length)];
  useEffect(() => {
    if (list.length < 2) return undefined;
    const t = setInterval(() => setI((x) => (x + 1) % list.length), 6000);
    return () => clearInterval(t);
  }, [list.length]);
  useEffect(() => { if (list.length) api.bannerSeen({ ids: list.map((b) => b.id) }).catch(() => {}); }, [list.length]);
  if (!list.length) {
    return (
      <section className="home-hero-plain">
        <div className="container">
          <h1 className="hh-title">Find your place in Nepal</h1><p className="hh-sub">Stays, homes, land, projects and investments across Nepal.</p>
          <HeroSearch />
          <a href="/business/promote/banner" className="muted" style={adLink}>Advertise here</a>
        </div>
      </section>
    );
  }
  const open = (b) => api.bannerClick({ id: b.id }).catch(() => {});
  return (
    <section className="home-hero-plain" style={{ position: "relative", overflow: "hidden", isolation: "isolate", minHeight: "min(70vh, 560px)", display: "flex", alignItems: "center" }}>
      {list.map((b, k) => <BannerBg key={b.id} b={b} on={k === i % list.length} eager={!k} />)}
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, zIndex: -1, background: "linear-gradient(180deg, rgba(0,0,0,.55), rgba(0,0,0,.35) 55%, rgba(0,0,0,.6))" }} />
      <div className="container" style={{ width: "100%" }}>
        <h1 className="hh-title" style={{ color: "#fff" }}>Find your place in Nepal</h1><p className="hh-sub" style={{ color: "rgba(255,255,255,.88)" }}>Stays, homes, land, projects and investments across Nepal.</p>
        <HeroSearch />
      </div>
      <div style={{ position: "absolute", left: 16, right: 16, bottom: 14, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", color: "#fff" }}>
        {cur.sponsored && <span className="tag tag-white" style={{ fontSize: 11 }}>Sponsored</span>}
        {cur.listing ? (
          // A listing banner opens the listing here on the site.
          <Link to={cur.link} onClick={() => open(cur)} className="hb-listing">
            <span className="hb-l-t"><b>{cur.title || cur.listing.title}</b><small>{[cur.listing.price ? `${fmtPrice(cur.listing.price)}${cur.listing.purpose === "rent" ? " / month" : ""}` : "", cur.listing.place].filter(Boolean).join(" · ")}</small></span>
            <span className="btn btn-sm" style={{ background: "#fff", color: "#111" }}>{cur.button || "View"}</span>
          </Link>
        ) : <>
          {cur.title && <b style={{ fontSize: 15, textShadow: "0 1px 3px rgba(0,0,0,.5)" }}>{cur.title}</b>}
          <a href={cur.link} target="_blank" rel="noopener noreferrer sponsored" onClick={() => open(cur)} className="btn btn-sm" style={{ background: "#fff", color: "#111" }}>{cur.button || "Learn more"}</a>
        </>}
        <span style={{ flex: 1 }} />
        {list.length > 1 && <span style={{ display: "flex", gap: 6 }}>{list.map((b, k) => <button key={b.id} type="button" aria-label={`Banner ${k + 1}`} onClick={() => setI(k)} style={{ width: 8, height: 8, borderRadius: 4, border: 0, padding: 0, background: k === i % list.length ? "#fff" : "rgba(255,255,255,.45)", cursor: "pointer" }} />)}</span>}
        <a href="/business/promote/banner" style={{ ...adLink, color: "rgba(255,255,255,.85)" }}>Advertise here</a>
      </div>
    </section>
  );
}

// On a phone a strip loops: swipe past the last card and the first comes round again, and the other way too.
const Strip = ({ className, children }) => {
  const phone = useMedia("(max-width: 600px)");
  return phone ? <LoopStrip className={className}>{children}</LoopStrip> : <div className={className}>{children}</div>;
};

const Row = ({ loading, items }) => (
  <Strip className="scroller">
    {loading ? Array.from({ length: 4 }, (_, i) => <CardSkeleton key={i} />) : items.map((p) => <PropertyCard key={p.id} p={p} />)}
  </Strip>
);

export default function Home() {
  useSEO(null, "Buy, sell and rent houses, land, flats and commercial space across Nepal, plus stays, projects and investments.");
  const featured = useAsync(() => api.featured().then(toList), []);
  const sale = useAsync(() => api.byPurpose("sale", 1, 8).then(toList), []);
  const rent = useAsync(() => api.byPurpose("rent", 1, 10).then(toList), []);
  const agencies = useAsync(() => api.agents().then(toList), []);
  const blogs = useAsync(() => api.blogs(1, 4).then(toList), []);

  const phone = useMedia("(max-width: 600px)");

  return (
    <>
      {phone ? <PhoneHomeTop /> : <Hero />}


      {(featured.loading || (featured.data?.items || []).length > 0) && <section className="section container">
        <SectionHead kicker="Hand-picked" title="Featured properties"
          action={<span style={{ display: "flex", gap: 16, alignItems: "baseline" }}>{!phone && <a href="/business/promote" className="muted" style={adLink}>Boost your listing here</a>}<Link to="/featured" className="link">View all</Link></span>} />
        <Row loading={featured.loading} items={featured.data?.items || []} />
      </section>}

      <HomePlatformRows SectionHead={SectionHead} Link={Link} />

      <section className="container">
        <SectionHead kicker="Explore by city" title="Browse by city" action={<Link to="/search" className="link">View all</Link>} />
        <Strip className="grid-4">
          {PLACES.map(([c, img]) => (
            <Link key={c} to={`/search?keyword=${c}`} className="loc-tile">
              <img src={img} alt="" loading="lazy" />
              <div><h3>{c}</h3></div>
            </Link>
          ))}
        </Strip>
      </section>

      {(sale.loading || (sale.data?.items || []).length > 0) && <section className="section container">
        <SectionHead kicker="For sale" title="Latest for sale" action={<Link to="/sale" className="link">View all</Link>} />
        {phone ? <Row loading={sale.loading} items={sale.data?.items || []} /> : <PropertyGrid loading={sale.loading} items={sale.data?.items || []} count={8} />}
      </section>}


      {(rent.loading || (rent.data?.items || []).length > 0) && <section className="section container">
        <SectionHead kicker="For rent" title="Latest for rent" action={<Link to="/rent" className="link">View all</Link>} />
        <Row loading={rent.loading} items={rent.data?.items || []} />
      </section>}

      {(agencies.loading || (agencies.data?.items || []).length > 0) && <section className="container">
        <SectionHead kicker="Our partners" title="Partners" action={<Link to="/partners?type=agency" className="link">View all</Link>} />
        <Strip className="agents-grid">
          {(agencies.data?.items || []).slice(0, 4).map((a) => <AgencyCard key={a.id} a={a} />)}
          {agencies.loading && Array.from({ length: 4 }, (_, i) => <div key={i} className="sk" style={{ height: 200, borderRadius: "var(--r-xl)" }} />)}
          {!agencies.loading && (agencies.data?.items || []).length < 4 && <JoinPanel span={4 - (agencies.data?.items || []).length} />}
        </Strip>
      </section>}

      <section className="section container">
        <SectionHead kicker="Plan with numbers" title="Calculators" action={<Link to="/tools/emi" className="link">View all</Link>} />
        <Strip className="tool-tiles">
          {[["emi", Calculator, "Home loan EMI"], ["units", Ruler, "Land units"], ["land-price", Landmark, "Land price"], ["property-tax", Receipt, "Property tax"], ["roi", TrendingUp, "Rental yield"], ["rent-vs-buy", KeyRound, "Rent vs buy"], ["afford", Wallet, "Affordability"]].map(([k, I, t]) => (
            <Link key={k} to={`/tools/${k}`} className="tool-tile">
              <span className="tool-tile-ico"><I size={20} strokeWidth={1.7} /></span>
              <span>{t}</span>
            </Link>
          ))}
        </Strip>
      </section>

      {(blogs.loading || (blogs.data?.items || []).length > 0) && <section className="container">
        <SectionHead kicker="Journal" title="Blog" action={<Link to="/blog" className="link">View all</Link>} />
        <style>{`@media (min-width: 1100px) { .home-blog-grid { grid-template-columns: repeat(4, minmax(0, 1fr)) !important; gap: 20px !important; } .home-blog-grid .post-card h3 { font-size: 16px; white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; } }`}</style>
        <Strip className="grid-3 home-blog-grid">
          {(blogs.data?.items || []).slice(0, phone ? 3 : 8).map((b) => (
            <Link key={b.id} to={`/blog/${b.slug}`} className="post-card">
              <div className="media"><img src={imgUrl(b.thumbnail || b.featured_image || b.image)} alt="" loading="lazy" /></div>
              <span className="tiny muted" style={{ textTransform: "uppercase", letterSpacing: ".12em" }}>{b.category?.name} · {fmtDate(b.published_at || b.created_at)}</span>
              <h3>{b.title}</h3>
            </Link>
          ))}
        </Strip>
      </section>}

    </>
  );
}