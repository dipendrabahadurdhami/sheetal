// Sheetal Technologies: the landing page of the business software (the owner's plan of 27 Nov 2026).
// Where it fits: /technology on the website (and technology.sheetalproperty.com once its address points here). Every price, pack and software
// comes from GET /v1/public/packs (the catalog super admin edits in Admin -> Pricing), so the page never shows an old price.
// How it works: what the company makes, the software (each a group of apps), the three plans with a 1 month / 6 months / 1 year switch and the
// offer, why it fits businesses in Nepal, a short FAQ, and the way in (the business panel's Plans page; posting on the website stays free).
// Rules: no claim the product can't keep (no store apps yet: "works on phone and computer"); brand colours are the logo's own.

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, Check, X, Globe, MessagesSquare, Receipt, UsersRound, KeyRound, Hotel, Building2, Rocket, Layers, GitBranch, Smartphone,
  Wallet, FileText, ShieldCheck, ChevronDown, Sparkles,
} from "lucide-react";
import { api } from "../api/endpoints";
import { toItem } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { useSEO } from "../utils/seo";

const ICON = { globe: Globe, "messages-square": MessagesSquare, receipt: Receipt, "users-round": UsersRound, "key-round": KeyRound, hotel: Hotel, "building-2": Building2, rocket: Rocket };
const LENGTHS = [[1, "Monthly"], [6, "6 months"], [12, "1 year"]];
const PER = { 1: "a month", 6: "for 6 months", 12: "for 1 year" };
const rs = (paisa) => `Rs. ${Math.round(paisa / 100).toLocaleString("en-IN")}`;

const WHY = [
  [Layers, "All in one place", "Listings, leads, invoices, staff and bookings share the same customers and the same data. Nothing to copy between programs."],
  [GitBranch, "Many branches, many businesses", "Run every branch, and more than one business, from one sign-in. Each person sees only the branches you give them."],
  [Wallet, "Built for Nepal", "eSewa, Khalti, Fonepay and bank transfer; VAT invoices with Nepal's fiscal year; Nepali and English."],
  [Globe, "Your listings on Sheetal Property", "Publish property, hotels, projects and jobs on sheetalproperty.com for free, and get the leads straight into your CRM."],
  [Smartphone, "Works on phone and computer", "Use it in the browser on any phone, tablet or computer. Nothing to install."],
  [ShieldCheck, "Your data stays yours", "Roles and permissions for every person, approvals for important steps, and a history of who changed what."],
];

const FAQ = [
  ["Is posting on the website really free?", "Yes. Any business or person can post property for sale or rent, hotels, apartments, projects, blogs and jobs on sheetalproperty.com without paying. The plans are for the business software."],
  ["Can I change plan later?", "Yes. Start with any plan and move up when you need more. Your data stays the same."],
  ["What does 6 months or 1 year save?", "Paying for 6 months saves about 10% and paying for a year about 20% against paying every month."],
  ["How do I pay?", "With eSewa, Khalti, Fonepay or a bank transfer. Every payment gets a VAT invoice."],
  ["Do you help us start?", "Yes. Our team helps you set up your branches, team and first records."],
];

export function Technology() {
  useSEO("Sheetal Technologies: business software for Nepal", "CRM, accounting, HRM, property management, hotel and project software in three simple plans. Posting on Sheetal Property stays free.");
  const { data, loading } = useAsync(() => api.packs().then(toItem), []);
  const [months, setMonths] = useState(12);
  const [open, setOpen] = useState(0);
  const packs = data?.packs || [];
  const software = data?.software || [];
  const paid = useMemo(() => software.filter((s) => !s.free), [software]);
  const offer = packs.find((p) => p.offerLabel)?.offerLabel?.en;
  const from = packs.length ? Math.min(...packs.map((p) => p.periods.find((x) => x.months === 1)?.pricePaisa || Infinity)) : null;

  return (
    <div className="tech">
      <section className="tech-hero">
        <div className="container tech-hero-in">
          <div className="stack" style={{ gap: 18 }}>
            <span className="tier">Sheetal Technologies</span>
            <h1>Business software for real estate, hotels and property businesses in Nepal</h1>
            <p className="tech-lead">CRM, accounting, HRM, property management, hotel and project software that work together, for one branch or many. In three simple plans.</p>
            <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
              <a href="#plans" className="btn btn-primary">See plans <ArrowRight size={16} /></a>
              <Link to="/post-property" className="btn btn-outline">Post on the website free</Link>
            </div>
            {from && Number.isFinite(from) && <p className="small muted">{offer ? `${offer}: ` : ""}plans from {rs(from)} a month, VAT included.</p>}
          </div>
          <div className="tech-logo"><img src="/about/brands/technology.png" alt="Sheetal Technologies" /></div>
        </div>
      </section>

      <section className="container section">
        <div className="section-head"><div className="stack"><span className="tier">The software</span><h2>Everything a property business runs on</h2><p>Each software does one job well, and all of them share your customers, branches and team.</p></div></div>
        {loading ? <div className="sk" style={{ height: 240 }} /> : (
          <div className="tech-soft">
            {software.map((s) => {
              const I = ICON[s.icon] || Layers;
              const soon = s.apps.length > 0 && s.apps.every((a) => a.comingSoon);
              return (
                <div key={s.id} className="card tech-soft-card">
                  <span className="tech-ico"><I size={20} /></span>
                  <div className="row" style={{ gap: 8, flexWrap: "wrap" }}><h3>{s.name.en}</h3>{s.free && <span className="tag tag-soft">Free</span>}{soon && <span className="tag tag-line">Coming soon</span>}</div>
                  <p className="small muted">{s.tagline.en}</p>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section id="plans" className="tech-plans-wrap" style={{ scrollMarginTop: 80 }}>
        <div className="container section">
          <div className="section-head"><div className="stack"><span className="tier">Plans</span><h2>Three plans. Pay monthly, for 6 months or a year.</h2><p>Prices include 13% VAT. Longer periods save more.</p></div>
            <div className="seg" role="radiogroup" aria-label="How long">{LENGTHS.map(([m, l]) => <button key={m} type="button" role="radio" aria-checked={months === m} className={months === m ? "on" : ""} onClick={() => setMonths(m)}>{l}</button>)}</div>
          </div>
          {loading ? <div className="sk" style={{ height: 420 }} /> : (
            <div className="tech-plans">
              {packs.map((p) => {
                const pr = p.periods.find((x) => x.months === months);
                return (
                  <div key={p.id} className={`card tech-plan ${p.highlight ? "hi" : ""}`}>
                    {p.highlight && <span className="tech-badge"><Sparkles size={13} /> Most popular</span>}
                    <h3>{p.name.en}</h3>
                    <p className="small muted">{p.tagline.en}</p>
                    <div className="tech-price">
                      {pr.onOffer && <span className="tag tag-red">{p.offerLabel?.en || "Offer"}</span>}
                      <div className="row" style={{ alignItems: "baseline", gap: 8, flexWrap: "wrap" }}><b>{rs(pr.pricePaisa)}</b><span className="small muted">{PER[months]}</span></div>
                      {pr.onOffer ? <span className="small muted"><s>{rs(pr.normalPaisa)}</s> normal price</span> : <span className="small muted">&nbsp;</span>}
                      {months > 1 && <span className="small muted">{rs(Math.round(pr.pricePaisa / months / 100) * 100)} a month</span>}
                    </div>
                    <ul className="tech-feats">
                      <li><Check size={15} /> Sheetal CMS: free website listings</li>
                      {paid.map((s) => {
                        const has = p.software.includes(s.id);
                        return <li key={s.id} className={has ? "" : "off"}>{has ? <Check size={15} /> : <X size={15} />} {s.name.en}</li>;
                      })}
                    </ul>
                    <a href="/business/plans" className={`btn ${p.highlight ? "btn-primary" : "btn-outline"} btn-block`}>Choose {p.name.en}</a>
                  </div>
                );
              })}
            </div>
          )}
          <p className="small muted" style={{ marginTop: 16 }}>Choosing a plan opens your business panel. New to Sheetal? Sign in with your Sheetal Property account and add your business first; it takes a minute.</p>
        </div>
      </section>

      <section className="container section">
        <div className="section-head"><div className="stack"><span className="tier">Why Sheetal Technologies</span><h2>Made for how property businesses work here</h2></div></div>
        <div className="tech-why">
          {WHY.map(([I, h, t]) => (
            <div key={h} className="stack" style={{ gap: 8 }}><span className="tech-ico"><I size={20} /></span><h3>{h}</h3><p className="small muted">{t}</p></div>
          ))}
        </div>
      </section>

      <section className="container section" style={{ paddingTop: 0 }}>
        <div className="section-head"><div className="stack"><span className="tier">Questions</span><h2>Good to know</h2></div></div>
        <div className="card tech-faq">
          {FAQ.map(([q, a], i) => (
            <div key={q} className="tech-faq-row">
              <button type="button" aria-expanded={open === i} onClick={() => setOpen(open === i ? -1 : i)}><span>{q}</span><ChevronDown size={18} style={{ transform: open === i ? "rotate(180deg)" : "none", transition: "transform .2s" }} /></button>
              {open === i && <p className="small">{a}</p>}
            </div>
          ))}
        </div>
      </section>

      <section className="container" style={{ paddingBottom: 72 }}>
        <div className="card card-pad tech-cta">
          <div className="stack" style={{ gap: 6 }}><h2>Run your business on Sheetal</h2><p className="small muted">Start with a plan today, or post your listings on the website for free.</p></div>
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}><a href="#plans" className="btn btn-primary">See plans</a><Link to="/contact" className="btn btn-outline"><FileText size={16} /> Talk to us</Link></div>
        </div>
        <p className="tiny muted" style={{ marginTop: 16, textAlign: "center" }}>Sheetal Technologies is the software brand of Shetal Sanshee Technologies P. Ltd., part of Sheetal Group.</p>
      </section>
    </div>
  );
}
