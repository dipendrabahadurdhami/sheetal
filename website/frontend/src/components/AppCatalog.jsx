// The public app catalog on the website (MB 14.4, P3-FE-5): app cards, one app's editions table and the pricing table, built only from
// GET /v1/public/catalog (public fields: names, taglines, editions, prices with VAT, free limits). Also the "Start free" hand-off.
// Where it fits: pages/Apps.jsx (/apps), pages/AppDetail.jsx (/apps/:id) and pages/Pricing.jsx (/pricing).
// How it works: presentational components take the catalog as props (so the build-time test renders them and scans the HTML); useStartFree()
// asks the visitor to sign in, then POST /v1/start-free creates or picks their business and opens /business/marketplace?app=<id>.
// Rules: prices come from the catalog in paisa, shown with integer maths; the page never says "verified", never shows a PAN and never names the
// company behind the technology (appCatalog.test.jsx scans for them). "Coming soon" apps can't be started.

import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Minus } from "lucide-react";
import { useApp } from "../context/AppContext";
import { api } from "../api/endpoints";

/** Paisa as "Rs. 700" or "Rs. 700.50" (integers only). */
export const rsPaisa = (p) => {
  const v = Math.round(Number(p) || 0), a = Math.abs(v), ps = a % 100;
  return `Rs. ${Math.floor(a / 100).toLocaleString("en-IN")}${ps ? `.${String(ps).padStart(2, "0")}` : ""}`;
};
const words = (k) => { const s = String(k || "").replace(/[_.]+/g, " ").trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1) : ""; };
const nameOf = (x) => (x == null ? "" : typeof x === "string" ? x : x.en || "");
const limitText = (v) => (v == null || v === -1 ? "Unlimited" : Number(v).toLocaleString("en-IN"));
/** Months saved by paying yearly (from the catalog's two prices), or null. */
export const monthsSaved = (e) => (e.priceMonthPaisa && e.priceYearPaisa && e.priceYearPaisa < e.priceMonthPaisa * 12 ? Math.round((e.priceMonthPaisa * 12 - e.priceYearPaisa) / e.priceMonthPaisa) : null);
/** The cheapest paid edition's monthly price, or null. */
export const fromPrice = (app) => { const p = (app.editions || []).filter((e) => !e.free && e.priceMonthPaisa > 0).map((e) => e.priceMonthPaisa); return p.length ? Math.min(...p) : null; };

/** What an app's free edition gives, in words from the catalog's own limits: ["3 listings", "Unlimited stays"]. Empty when the app has no free edition. */
export function freeLimits(app) {
  const free = (app.editions || []).find((e) => e.free);
  if (!free) return [];
  const list = Object.entries(free.limits || {}).map(([k, v]) => limitPhrase(k, v)).filter(Boolean);
  return list.length ? list : ["The basics, no limits"];
}
/** One limit as words: "3 listings", "1 outlet", "100 bills per month", "50 MB receipt storage", "Unlimited stays". A limit of 0 is not part of the free edition (null). */
export function limitPhrase(key, value) {
  if (value === 0) return null;
  const mb = /_mb$/.test(key);
  let w = words(mb ? key.replace(/_mb$/, "") : key).toLowerCase();
  if (value === 1) { const [head, ...rest] = w.split(" per "); w = [head.replace(/([^s])s$/, "$1"), ...rest].join(" per "); }
  return mb ? `${limitText(value)} MB ${w}` : `${limitText(value)} ${w}`;
}

/** Signs the visitor in if needed, then opens the business marketplace on that app. */
export function useStartFree() {
  const { user, setAuth, toast } = useApp();
  const [busy, setBusy] = useState(null);
  const pending = useRef(null);
  const go = async (appId) => {
    setBusy(appId || "all");
    try { const r = await api.startFree(appId); window.location.assign(r?.data?.link || "/business/marketplace"); }
    catch (e) { toast(e?.message || "Could not open the marketplace. Please try again."); setBusy(null); }
  };
  const start = (appId) => { if (!user) { pending.current = appId ?? null; setAuth("login"); return; } go(appId); };
  useEffect(() => { if (user && pending.current !== null) { const a = pending.current; pending.current = null; go(a); } }, [user]);
  return { start, busy };
}

export function AppCard({ app, onStart, busy }) {
  const from = fromPrice(app);
  const soon = app.availability === "coming_soon";
  return (
    <article className="card plan-card" aria-labelledby={`app-${app.id}`} style={{ display: "flex", flexDirection: "column", gap: 10, padding: 20 }}>
      <h3 id={`app-${app.id}`} style={{ margin: 0 }}><Link to={`/apps/${app.id}`}>{nameOf(app.name)}</Link></h3>
      {app.tagline && <p className="small muted" style={{ margin: 0 }}>{nameOf(app.tagline)}</p>}
      <p style={{ margin: 0 }}>
        {soon ? <b>Coming soon</b> : <>
          {app.freeEdition && <b>Free</b>}
          {from != null && <span data-paisa={from}>{app.freeEdition ? " · " : ""}from {rsPaisa(from)} a month</span>}
        </>}
      </p>
      {!soon && app.freeEdition && <p className="small" style={{ margin: 0 }}>Free forever: {freeLimits(app).join(", ")}.</p>}
      {!soon && app.trialDays ? <p className="small muted" style={{ margin: 0 }}>{app.trialDays}-day free trial of the full edition, no card</p> : null}
      <div style={{ marginTop: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
        {!soon && <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => onStart(app.id)}>Start free</button>}
        <Link to={`/apps/${app.id}`} className="btn btn-outline">See editions</Link>
      </div>
    </article>
  );
}

/** One app's editions side by side: prices a month and a year, "you save", every free limit and feature. */
export function EditionsTable({ app }) {
  const eds = app.editions || [];
  const limits = [...new Set(eds.flatMap((e) => Object.keys(e.limits || {})))];
  const features = [...new Set(eds.flatMap((e) => e.features || []))];
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="table" style={{ minWidth: 160 + eds.length * 160, width: "100%" }}>
        <caption className="small muted" style={{ textAlign: "left" }}>Prices include 13% VAT. Pay monthly, or yearly and pay for 10 months.</caption>
        <thead><tr><th scope="col">Edition</th>{eds.map((e) => <th key={e.id} scope="col">{nameOf(e.name) || words(e.id)}</th>)}</tr></thead>
        <tbody>
          <tr><th scope="row">A month</th>{eds.map((e) => <td key={e.id} data-paisa={e.free ? 0 : e.priceMonthPaisa}>{e.free ? "Free" : rsPaisa(e.priceMonthPaisa)}</td>)}</tr>
          <tr><th scope="row">A year</th>{eds.map((e) => <td key={e.id} data-paisa={e.free ? 0 : e.priceYearPaisa}>{e.free ? "Free" : rsPaisa(e.priceYearPaisa)}{monthsSaved(e) ? <><br /><small className="muted">You save {monthsSaved(e)} months</small></> : null}</td>)}</tr>
          {limits.map((k) => <tr key={k}><th scope="row">{words(k)}</th>{eds.map((e) => <td key={e.id}>{k in (e.limits || {}) ? limitText(e.limits[k]) : "—"}</td>)}</tr>)}
          {features.map((f) => <tr key={f}><th scope="row">{words(f)}</th>{eds.map((e) => <td key={e.id}>{(e.features || []).includes(f) ? <span role="img" aria-label="Included"><Check size={16} /></span> : <span role="img" aria-label="Not included"><Minus size={16} /></span>}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}

/** Every app in one table: free edition, the full price a month and a year, trial. Then seats and add-ons. */
export function PricingTable({ catalog, onStart, busy }) {
  const apps = (catalog?.apps || []).filter((a) => a.availability !== "coming_soon");
  const soon = (catalog?.apps || []).filter((a) => a.availability === "coming_soon");
  const withFree = apps.filter((a) => a.freeEdition);
  const trial = Math.max(0, ...apps.map((a) => a.trialDays || 0));
  return (
    <>
      <section aria-labelledby="what-is-free" className="card" style={{ padding: 20, marginBottom: 24 }}>
        <h2 id="what-is-free" style={{ marginTop: 0 }}>What is free</h2>
        <ul style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 6 }}>
          <li><b>Posting property on the website is free.</b> No plan is needed to post.</li>
          <li><b>{withFree.length} of {apps.length} apps have a free edition, free forever.</b> No card, no end date. The table shows what each free edition includes.</li>
          {catalog?.business && <li><b>{catalog.business.freeSeats} team members are free</b> in every business.</li>}
          {trial > 0 && <li><b>{trial}-day free trial</b> of any full edition, once per app, no card. Your data is never deleted when a trial ends.</li>}
          <li><b>You pay only when you need more</b> than a free edition gives, app by app. Cancel a paid edition and the app returns to its free edition when the paid period ends.</li>
        </ul>
      </section>
      <div style={{ overflowX: "auto" }}>
        <table className="table" style={{ minWidth: 720, width: "100%" }}>
          <caption className="small muted" style={{ textAlign: "left" }}>All prices include 13% VAT. Yearly = 10 months.</caption>
          <thead><tr><th scope="col">App</th><th scope="col">Free edition includes</th><th scope="col">Full, a month</th><th scope="col">Full, a year</th><th scope="col">Trial</th><th scope="col" aria-label="Start" /></tr></thead>
          <tbody>{apps.map((a) => {
            const paid = (a.editions || []).filter((e) => !e.free).sort((x, y) => x.priceMonthPaisa - y.priceMonthPaisa)[0];
            return (
              <tr key={a.id}>
                <th scope="row"><Link to={`/apps/${a.id}`}>{nameOf(a.name)}</Link></th>
                <td>{a.freeEdition ? freeLimits(a).join(", ") : "No free edition"}</td>
                <td data-paisa={paid?.priceMonthPaisa ?? ""}>{paid ? rsPaisa(paid.priceMonthPaisa) : "—"}</td>
                <td data-paisa={paid?.priceYearPaisa ?? ""}>{paid ? rsPaisa(paid.priceYearPaisa) : "—"}</td>
                <td>{a.trialDays ? `${a.trialDays} days` : "—"}</td>
                <td><button type="button" className="btn btn-sm btn-primary" disabled={!!busy} onClick={() => onStart(a.id)}>Start free</button></td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      {catalog?.business && <p className="small" style={{ marginTop: 16 }}>
        {catalog.business.freeSeats} team members are free. Each extra seat: <span data-paisa={catalog.business.seatAddon.priceMonthPaisa}>{rsPaisa(catalog.business.seatAddon.priceMonthPaisa)}</span> a month.
      </p>}
      {catalog?.addons?.length > 0 && <ul className="small">{catalog.addons.map((x) => <li key={x.key}>{nameOf(x.name)}: <span data-paisa={x.priceMonthPaisa}>{rsPaisa(x.priceMonthPaisa)}</span> a month</li>)}</ul>}
      {catalog?.ai?.plans?.length > 0 && <p className="small">Sheetal AI: {catalog.ai.plans.map((p) => `${nameOf(p.name)} ${rsPaisa(p.priceMonthPaisa)} a month (${p.creditsPerMonth} credits)`).join(" · ")}. Or connect your own AI key.</p>}
      {soon.length > 0 && <p className="small muted">Coming soon: {soon.map((a) => nameOf(a.name)).join(", ")}.</p>}
    </>
  );
}
