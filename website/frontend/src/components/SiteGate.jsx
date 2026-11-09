// Public site settings on the website: Google tags and the maintenance page.
// Where it fits: wraps the main site in App.jsx (not /admin, /business, forms or signing pages).
// How it works: asks GET /v1/site once. When Google Analytics and Search Console values are set it adds them to the
// page (Analytics in utils/seo.js and a verification meta tag). When maintenance mode is on everyone sees a short
// maintenance page, except signed-in Sheetal staff, who see the site with a thin notice on top.
// Rules: if /site can't be reached the site stays open; nothing secret comes from this endpoint.

import React, { useEffect, useState } from "react";
import { api } from "../api/endpoints";
import { Analytics, applySiteSettings } from "../utils/seo";

function Maintenance({ message }) {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, textAlign: "center" }}>
      <div style={{ maxWidth: 460 }}>
        <img src="/brand/logo-full.png" alt="Sheetal Property" style={{ maxWidth: 200, marginBottom: 24 }} />
        <h1 style={{ fontSize: 24, margin: "0 0 12px" }}>We'll be back soon</h1>
        <p style={{ margin: 0, opacity: 0.8 }}>{message}</p>
      </div>
    </main>
  );
}

export function SiteGate({ children }) {
  const [site, setSite] = useState(null);
  useEffect(() => {
    let on = true;
    api.site().then((r) => on && setSite(r.data)).catch(() => on && setSite({}));
    return () => { on = false; };
  }, []);
  useEffect(() => { if (site) applySiteSettings(site); }, [site]);

  const maintenance = site?.maintenance?.on;
  if (maintenance && !site.staff) return <Maintenance message={site.maintenance.message} />;
  return (
    <>
      <Analytics gaId={site?.googleAnalyticsId} />
      {maintenance && <div role="status" style={{ background: "#b45309", color: "#fff", padding: "6px 12px", fontSize: 13, textAlign: "center" }}>Maintenance mode is on. Only Sheetal staff can see the site.</div>}
      {children}
    </>
  );
}
