import { Link } from "react-router-dom";
import { useSEO } from "../utils/seo";
import { Home as HomeIcon, Trees, Building2, Building, Store, Briefcase, Castle, Calculator, Ruler, TrendingUp, KeyRound, Landmark, Receipt, Wallet } from "lucide-react";
import { api } from "../api/endpoints";
import { toList } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { HeroSearch } from "../components/HeroSearch";
import { PropertyCard, CardSkeleton, PropertyGrid } from "../components/PropertyCard";
import { SectionHead } from "../components/ui";
import { fmtDate, imgUrl } from "../utils/format";
import { AgencyCard, JoinPanel } from "./Agencies";
import HomePlatformRows from "../market/SiteRows";

const CATS = [["House", HomeIcon], ["Land", Trees], ["Apartment", Building2], ["Flat", Building], ["Commercial Space", Store], ["Office Space", Briefcase], ["Bungalow", Castle]];
const PLACES = [["Kathmandu", "/demo/12.jpg"], ["Lalitpur", "/demo/15.jpg"], ["Bhaktapur", "/demo/17.jpg"], ["Pokhara", "/demo/19.jpg"]];
const FALLBACK_HERO = ["/demo/12.jpg", "/demo/15.jpg", "/demo/17.jpg"];

function Hero() {
  return (
    <section className="home-hero-plain">
      <div className="container">
        <h1 className="hh-title">Find your place in Nepal</h1><p className="hh-sub">Stays, homes, land, projects and investments across Nepal.</p>
        <HeroSearch />
      </div>
    </section>
  );
}

const Row = ({ loading, items }) => (
  <div className="scroller">
    {loading ? Array.from({ length: 4 }, (_, i) => <CardSkeleton key={i} />) : items.map((p) => <PropertyCard key={p.id} p={p} />)}
  </div>
);

export default function Home() {
  useSEO(null, "Buy, sell and rent houses, land, flats and commercial space across Nepal, plus stays, projects and investments.");
  const featured = useAsync(() => api.featured().then(toList), []);
  const sale = useAsync(() => api.byPurpose("sale", 1, 8).then(toList), []);
  const rent = useAsync(() => api.byPurpose("rent", 1, 10).then(toList), []);
  const agencies = useAsync(() => api.agents().then(toList), []);
  const blogs = useAsync(() => api.blogs(1, 4).then(toList), []);

  return (
    <>
      <Hero />


      <section className="section container">
        <SectionHead kicker="Hand-picked" title="Featured properties"
          action={<Link to="/featured" className="link">View all</Link>} />
        <Row loading={featured.loading} items={featured.data?.items || []} />
      </section>

      <HomePlatformRows SectionHead={SectionHead} Link={Link} />

      <section className="container">
        <SectionHead kicker="Explore by city" title="Browse by city" />
        <div className="grid-4">
          {PLACES.map(([c, img]) => (
            <Link key={c} to={`/search?keyword=${c}`} className="loc-tile">
              <img src={img} alt="" loading="lazy" />
              <div><h3>{c}</h3></div>
            </Link>
          ))}
        </div>
      </section>

      <section className="section container">
        <SectionHead kicker="For sale" title="Latest for sale" action={<Link to="/sale" className="link">View all</Link>} />
        <PropertyGrid loading={sale.loading} items={sale.data?.items || []} count={8} />
      </section>


      <section className="section container">
        <SectionHead kicker="For rent" title="Latest for rent" action={<Link to="/rent" className="link">View all</Link>} />
        <Row loading={rent.loading} items={rent.data?.items || []} />
      </section>

      <section className="container">
        <SectionHead kicker="Our partners" title="Agencies" action={<Link to="/partners?type=agency" className="link">View all</Link>} />
        <div className="agents-grid">
          {(agencies.data?.items || []).slice(0, 4).map((a) => <AgencyCard key={a.id} a={a} />)}
          {agencies.loading && Array.from({ length: 4 }, (_, i) => <div key={i} className="sk" style={{ height: 200, borderRadius: "var(--r-xl)" }} />)}
          {!agencies.loading && (agencies.data?.items || []).length < 4 && <JoinPanel span={4 - (agencies.data?.items || []).length} />}
        </div>
      </section>

      <section className="section container">
        <SectionHead kicker="Plan with numbers" title="Calculators" />
        <div className="tool-tiles">
          {[["emi", Calculator, "Home loan EMI"], ["units", Ruler, "Land units"], ["land-price", Landmark, "Land price"], ["property-tax", Receipt, "Property tax"], ["roi", TrendingUp, "Rental yield"], ["rent-vs-buy", KeyRound, "Rent vs buy"], ["afford", Wallet, "Affordability"]].map(([k, I, t]) => (
            <Link key={k} to={`/tools/${k}`} className="tool-tile">
              <span className="tool-tile-ico"><I size={20} strokeWidth={1.7} /></span>
              <span>{t}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="container">
        <SectionHead kicker="Journal" title="Blog" action={<Link to="/blog" className="link">All articles</Link>} />
        <style>{`@media (min-width: 1100px) { .home-blog-grid { grid-template-columns: repeat(4, minmax(0, 1fr)) !important; gap: 20px !important; } .home-blog-grid .post-card h3 { font-size: 16px; white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; } }`}</style>
        <div className="grid-3 home-blog-grid">
          {(blogs.data?.items || []).map((b) => (
            <Link key={b.id} to={`/blog/${b.slug}`} className="post-card">
              <div className="media"><img src={imgUrl(b.thumbnail || b.featured_image || b.image)} alt="" loading="lazy" /></div>
              <span className="tiny muted" style={{ textTransform: "uppercase", letterSpacing: ".12em" }}>{b.category?.name} · {fmtDate(b.published_at || b.created_at)}</span>
              <h3>{b.title}</h3>
            </Link>
          ))}
        </div>
      </section>

    </>
  );
}