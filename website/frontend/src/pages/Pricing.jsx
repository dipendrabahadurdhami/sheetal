// The public Pricing page (MB 14.4, P3-FE-5): every app's free edition and full price (month and year, VAT included), trials, seats, add-ons
// and Sheetal AI, from GET /v1/public/catalog. Replaces the Starter / Business / Pro plans page once the move to apps is signed off (the old
// /plans page stays until then).
// Where it fits: /pricing (App.jsx). Components in components/AppCatalog.jsx.
// Rules: only public catalog fields; the numbers are the API's; no "verified", no PAN, no internal company names (appCatalog.test.jsx).

import { api } from "../api/endpoints";
import { useAsync } from "../hooks/useAsync";
import { PageHead } from "../components/ui";
import { PricingTable, useStartFree } from "../components/AppCatalog";
import { useSEO } from "../utils/seo";

export default function PricingPage() {
  useSEO("Pricing", "Free-forever editions and simple per-app prices, VAT included. Pay monthly, or yearly for 10 months.");
  const { data, loading, error } = useAsync(() => api.catalog().then((r) => r?.data || null), []);
  const { start, busy } = useStartFree();
  return (
    <>
      <div className="tools-hero plans-hero"><PageHead crumbs={[{ label: "Pricing" }]} title="Simple prices, app by app">Start free, no card. Pay only for the apps you use, monthly or yearly.</PageHead></div>
      <div className="container section-sm">
        {loading ? <div className="sk" style={{ height: 360, borderRadius: "var(--r)" }} />
          : error || !data ? <p className="muted">Prices can't be shown right now. Please try again soon.</p>
          : <PricingTable catalog={data} onStart={start} busy={busy} />}
      </div>
    </>
  );
}
