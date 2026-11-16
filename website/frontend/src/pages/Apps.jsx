// The public Apps pages (MB 14.4, P3-FE-5): /apps lists every app of the marketplace; /apps/:id shows one app's editions. Built from the public
// catalog (GET /v1/public/catalog); "Start free" signs the visitor in and opens their business marketplace on that app.
// Where it fits: routes in App.jsx. Components and the Start-free hook are in components/AppCatalog.jsx.
// Rules: only public catalog fields; no "verified", no PAN, no internal company names (appCatalog.test.jsx).

import { useParams, Link } from "react-router-dom";
import { api } from "../api/endpoints";
import { useAsync } from "../hooks/useAsync";
import { PageHead } from "../components/ui";
import { AppCard, EditionsTable, useStartFree } from "../components/AppCatalog";
import { useSEO } from "../utils/seo";

const useCatalog = () => useAsync(() => api.catalog().then((r) => r?.data || null), []);
const nameOf = (x) => (x == null ? "" : typeof x === "string" ? x : x.en || "");

export function AppsPage() {
  useSEO("Apps for your business", "Business apps for Nepal: CRM, hotel, point of sale, invoicing, rentals, people and more. Many are free; paid ones have a 14-day trial.");
  const { data, loading, error } = useCatalog();
  const { start, busy } = useStartFree();
  const apps = data?.apps || [];
  return (
    <>
      <div className="tools-hero plans-hero"><PageHead crumbs={[{ label: "Apps" }]} title="Apps for your business">Pick the apps you need. Start free; upgrade an app when you grow.</PageHead></div>
      <div className="container section-sm">
        <p style={{ display: "flex", gap: 12, flexWrap: "wrap" }}><Link to="/pricing" className="btn btn-outline">See all prices</Link><button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => start(null)}>Start free</button></p>
        {loading ? <div className="plans-grid plans-3">{Array.from({ length: 6 }, (_, i) => <div key={i} className="sk" style={{ height: 200, borderRadius: "var(--r)" }} />)}</div>
          : error || !apps.length ? <p className="muted">The apps can't be shown right now. Please try again soon.</p>
          : <div className="plans-grid plans-3">{apps.map((a) => <AppCard key={a.id} app={a} onStart={start} busy={busy} />)}</div>}
      </div>
    </>
  );
}

export function AppDetailPage() {
  const { id } = useParams();
  const { data, loading } = useCatalog();
  const { start, busy } = useStartFree();
  const app = data?.apps?.find((a) => a.id === id);
  useSEO(app ? `${nameOf(app.name)}: editions and prices` : "App", app ? `${nameOf(app.tagline) || nameOf(app.name)}. Free edition, prices with VAT and free limits.` : "Business apps on Sheetal Property.");
  return (
    <>
      <div className="tools-hero plans-hero"><PageHead crumbs={[{ label: "Apps", to: "/apps" }, { label: app ? nameOf(app.name) : "App" }]} title={app ? nameOf(app.name) : "App"}>{app ? nameOf(app.tagline) : ""}</PageHead></div>
      <div className="container section-sm">
        {loading ? <div className="sk" style={{ height: 320, borderRadius: "var(--r)" }} />
          : !app ? <p className="muted">That app isn't in the marketplace. <Link to="/apps" className="link">See all apps</Link></p>
          : <>
            <EditionsTable app={app} />
            <p style={{ marginTop: 20, display: "flex", gap: 12, flexWrap: "wrap" }}>
              {app.availability === "coming_soon" ? <b>Coming soon</b> : <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => start(app.id)}>Start free</button>}
              <Link to="/pricing" className="btn btn-outline">All prices</Link>
            </p>
          </>}
      </div>
    </>
  );
}
