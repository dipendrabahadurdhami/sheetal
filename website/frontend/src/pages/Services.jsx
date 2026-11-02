import { Link } from "react-router-dom";
import { Check, ChevronRight, BedDouble, Building2, HandCoins, Ruler, Store, ShieldCheck } from "lucide-react";
import { PageHead, SectionHead } from "../components/ui";
import { Enquiry, SERVICE_LINKS } from "./ServicePages";
import { useSEO } from "../utils/seo";

/* Extra detail for each of the six services, keyed by link. */
export const DETAIL = {
  "/services/home-loan": ["Offers from partner banks", "Your file prepared and submitted", "Follow-up until the offer letter", "Clear list of documents needed"],
  "/services/legal-help": ["Lal purja and Malpot checks", "Court, mortgage and guthi checks", "Deed transfer and registration", "Checks before any advance"],
  "/services/management": ["Tenant search and rent collection", "Repairs with trusted vendors", "Quarterly inspections with photos", "Rent paid to your account monthly"],
  "/services/pay-rent": ["Pay by Fonepay, eSewa or IME Pay", "Send reference and screenshot", "Receipt after owner confirms", "One payment form per month"],
  "/rates-and-trends": ["Average prices by locality", "See how areas moved over time", "Compare areas before you buy", "Built from current listings"],
  "/requirement": ["Tell us the area, budget and type", "Team shortlists matching options", "We call you with the best fits", "Matched with owners and agencies"],
};

/* Services added with the Sheetal platform: stays, projects, investments and business tools. */
export const NEW_SERVICES = [
  ["/stays", BedDouble, "Host your property as a stay", "For villa, apartment and homestay owners", ["Listing, photos and prices set up", "Booking calendar and guest messages", "Payments and payouts handled", "Cleaning and check-in support"]],
  ["/project", Building2, "Sell your project", "For developers of buildings and colonies", ["Project page with unit chart", "Site-visit booking and reservations", "Instalment schedule and reminders", "Construction updates for buyers"]],
  ["/investment/explore", HandCoins, "Raise funds for a project", "For developers and sponsors", ["Investment page with documents", "Investor KYC and agreements", "Updates and statements to investors", "Returns paid through Sheetal"]],
  ["/services/valuation", Ruler, "Property valuation", "For owners, buyers and banks", ["Site visit by a valuer", "Market comparison by locality", "Written valuation report", "Accepted by partner banks"]],
  ["/business", Store, "Run your business on Sheetal", "For hotels, hosts, agencies and developers", ["Point of sale, bookings and calendar", "Team, roles, attendance and branches", "Agreements without paper", "Your own booking website"]],
  ["/help/investing", ShieldCheck, "Investor guide", "For first-time investors", ["How investing works on Sheetal", "What to check before you invest", "How updates and returns are shown", "Risks explained in plain words"]],
];
// services with paid plans: "See plans" opens the plans page on the right business type
export const PLANS_OF = { "/stays": "/post-property?type=stay", "/project": "/post-property?type=project", "/investment/explore": "/post-property?type=invest", "/business": "/plans" };

const HOW = [
  ["Tell us what you need", "Pick a service or send the enquiry form. A few details are enough."],
  ["We match a specialist", "A loan officer, lawyer or property manager picks up your request."],
  ["We call you back", "Within one working day, we explain the options and next steps."],
  ["We handle the paperwork", "Documents, banks and offices are followed up on your behalf."],
  ["You stay updated", "Clear updates by phone or email at every stage."],
  ["Done and confirmed", "You get the result in writing: offer letter, lal purja or receipt."],
];

export default function Services() {
  useSEO("Services", "Home loans, legal help, property management, rent payment, valuation, stays, projects and investments.");
  return (
    <>
      <div className="tools-hero services-hero"><PageHead crumbs={[{ label: "Services" }]} title="Services">One team for loans, paperwork, tenants, payments, stays, projects and investments.</PageHead></div>
      <div className="container section-sm detail-layout" style={{ marginTop: 0 }}>
        <div className="stack" style={{ gap: 48 }}>
          <style>{`@media (min-width: 1240px) { .svc-grid { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; gap: 28px !important; } } .svc-card { display: flex; flex-direction: column; } .svc-card p, .svc-card li { text-wrap: wrap; } .svc-card p { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; } .svc-more { margin-top: auto !important; padding-top: 6px; }`}</style>
          <div className="grid-2 svc-grid" style={{ gap: 32 }}>
            {SERVICE_LINKS.map(([to, I, t, d]) => (
              <div key={to} className="stack svc-card" style={{ gap: 10, borderTop: "2px solid var(--line-strong)", paddingTop: 18 }}>
                <Link to={to} style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start", color: "inherit", textDecoration: "none" }}>
                  <I size={24} strokeWidth={1.5} color="var(--c-red)" />
                  <h4>{t}</h4>
                  <p className="small muted">{d}</p>
                </Link>
                <ul className="stack" style={{ gap: 6, listStyle: "none", padding: 0, margin: 0 }}>
                  {(DETAIL[to] || []).map((x) => <li key={x} className="small row" style={{ gap: 8, alignItems: "flex-start" }}><Check size={14} color="var(--c-red)" style={{ marginTop: 3, flexShrink: 0 }} />{x}</li>)}
                </ul>
                <Link to={to} className="small svc-more" style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--accent-ink)", fontWeight: 500 }}>See details <ChevronRight size={14} /></Link>
              </div>
            ))}
          </div>
          <section><SectionHead title="For owners, hosts, developers and investors" />
            <div className="grid-2 svc-grid" style={{ gap: 32 }}>
              {NEW_SERVICES.map(([to, I, t, d, list]) => (
                <div key={to} className="stack svc-card" style={{ gap: 10, borderTop: "2px solid var(--line-strong)", paddingTop: 18 }}>
                  <Link to={to} style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start", color: "inherit", textDecoration: "none" }}>
                    <I size={24} strokeWidth={1.5} color="var(--c-red)" /><h4>{t}</h4><p className="small muted">{d}</p>
                  </Link>
                  <ul className="stack" style={{ gap: 6, listStyle: "none", padding: 0, margin: 0 }}>
                    {list.map((x) => <li key={x} className="small row" style={{ gap: 8, alignItems: "flex-start" }}><Check size={14} color="var(--c-red)" style={{ marginTop: 3, flexShrink: 0 }} />{x}</li>)}
                  </ul>
                  <div className="svc-more" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <Link to={to} className="btn btn-outline btn-sm">See details <ChevronRight size={14} /></Link>
                    {PLANS_OF[to] && <Link to={PLANS_OF[to]} className="btn btn-primary btn-sm" style={{ color: "var(--c-white, #fff)" }}>{to === "/business" ? "See plans" : "Post now"} <ChevronRight size={14} /></Link>}
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section><SectionHead title="How it works" />
            <div className="steps-num">{HOW.map(([t, d], i) => <div key={t}><h4>{i + 1}. {t}</h4><p className="small muted">{d}</p></div>)}</div>
          </section>
        </div>
        <aside style={{ alignSelf: "stretch" }}><div className="sticky-card" style={{ boxShadow: "none" }}>
          <Enquiry service="General enquiry" title="General enquiry" fields={[["service", "Service", "text", [...SERVICE_LINKS.map(([, , t]) => t), ...NEW_SERVICES.map(([, , t]) => t)]]]} />
        </div></aside>
      </div>
    </>
  );
}