// The About page, with the content of the current sheetalproperty.com About page.

import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, ChevronDown, Tag, KeyRound } from "lucide-react";
import {
  Home, ShieldCheck, Building2, Hotel, LineChart, Globe2, Phone, Mail, MapPin, Clock, Quote,
  Scissors, Code2, Sprout, Layers, Crown, Star, Sparkles, Users, Award, ArrowRight,
} from "lucide-react";
import { SERVICE_LINKS } from "./ServicePages";
import { DETAIL, NEW_SERVICES } from "./Services";
import { useSEO } from "../utils/seo";
import { adminPage, textBlocks } from "../utils/content";
import { readDb } from "../utils/platformDb";

const STATS = [["10+", "Years in Nepal real estate"], ["2,000+", "Active listings"], ["7", "Sheetal Group brands"]];
const CONTACT = { address: "Kathmandu, Nepal", phone1: "+977 980-1000434", phone2: "970-5250833", email: "shetalrealestate@gmail.com", hours: "Sunday – Friday · 9:00 AM – 6:00 PM" };
// Longer text shown when a service in "What we do" is opened (3–4 lines across the full width)
const SVC_TEXT = {
 "Sell a property": "Post your land, house, flat or shop for sale straight from the website. Add the price, size, location and photos, and our team checks the post before it goes live. Buyers contact you directly, you follow views and enquiries from your profile, and our legal team can check the papers and help on transfer day when you find a buyer.",
 "Rent out a property": "List a flat, room, house or shop for rent straight from the website. Add the monthly rent, deposit, photos and what is included, and our team checks the post before it goes live. Tenants contact you directly, you manage the post from your profile, and when you are ready, Sheetal can collect the rent and handle repairs for you.",
 "Home loan": "Compare home loan offers from partner banks in one place, with current interest rates, processing fees and the longest tenure each bank allows. Check your EMI and how much you can borrow before you visit a branch, then apply online once. Our team collects your documents, follows up with the bank and keeps you updated until the loan is approved and released.",
 "Legal help": "Before you pay a token, our legal team checks the lal purja, trace map, charkilla and tax receipts against land revenue office records, and flags disputes, mortgages or road setbacks. We draft the baina and sale agreements in plain Nepali and English, guide you through the malpot office on transfer day, and help with naamsari, inheritance and power of attorney.",
 "Property management": "We look after homes and shops for owners who live away or abroad. Our team finds and screens tenants, signs the rent agreement, collects rent every month and handles repairs with trusted local vendors. You get quarterly inspections with photos, a monthly owner statement, and rent paid into your bank account after our management fee and any repair costs.",
 "Pay rent online": "Tenants can pay rent from anywhere with Fonepay, eSewa, IME Pay or a bank transfer, and the landlord sees the payment straight away. Every payment gets a receipt by SMS, reminders go out before the due date, and late fees are added only after it. Landlords get a clear record of every month paid, which helps at tax time and when a lease is renewed.",
 "Rates & trends": "See average land and house prices for each locality, built from the listings on Sheetal and updated as new ones come in. Compare areas side by side, see how prices have moved over the last few years, and check the price per aana or per square foot before you make an offer. Use it as a starting point for negotiation; it is not a formal valuation.",
 "Post a requirement": "Tell us what you are looking for: the area, your budget, the type of property and when you need it. Our team shortlists matching homes, land or shops from owners and partner agencies, including ones not yet listed online. We call you with the best fits, arrange site visits at times that suit you, and stay with you through to the agreement.",
 "Host your property as a stay": "Own a villa, apartment or homestay? We set up your listing with photos, prices and house rules, and manage the booking calendar and guest messages for you. Guests pay online and payouts go to your bank after each stay. If you need it, our local partners handle cleaning, linen and check-in, so the property earns while you are away.",
 "Sell your project": "Developers get a project page with a live unit chart showing what is available, reserved and sold. Buyers book site visits and reserve units online with a token, and the instalment schedule, reminders and receipts run automatically. Post construction updates with photos and every buyer sees them on their account, which builds trust and cuts down phone calls.",
 "Raise funds for a project": "Developers and sponsors can raise money through an investment page with the plan, documents and expected timeline. Investors complete KYC and sign agreements online, and you send updates and quarterly statements from one place. Returns are paid through Sheetal with a record for every investor. Returns are never guaranteed, and the investor guide explains the risks in plain words.",
 "Property valuation": "A qualified valuer visits the site, measures the land and building, and checks the papers. We compare recent prices in the same locality and road access, then give you a written valuation report you can use to sell, buy, divide family property or apply for a loan. Reports follow the format partner banks accept, so you do not need a second valuation.",
 "Run your business on Sheetal": "Hotels, hosts, agencies and developers run their daily work from one place: bookings and calendar, point of sale for restaurants and bars, invoices and VAT, team roles, attendance and branches. Agreements are signed without paper, customers pay online, and you get your own booking website. Start with what you need and add more tools as you grow.",
 "Investor guide": "New to investing in property projects? The guide explains in plain words how investing works on Sheetal, what to check before you put money in, and which documents a sponsor must share. It shows how updates and returns appear on your account, what the risks are, and what happens if a project is delayed, so you can decide with clear expectations."
};
// services with paid plans: "See plans" opens the plans page on the right business type
const SVC_PLANS = { "Sell a property": "/post-property?type=sell", "Rent out a property": "/post-property?type=rent", "Post a requirement": "/requirement", "Host your property as a stay": "/post-property?type=stay", "Sell your project": "/post-property?type=project", "Raise funds for a project": "/post-property?type=invest", "Run your business on Sheetal": "/plans" };
const SVC_CTA = (t) => (t === "Run your business on Sheetal" ? "See plans" : "Post now");
const tel = (x) => "tel:" + String(x).replace(/[^\d+]/g, "").replace(/^(?!\+)(9\d{9})$/, "+977$1");

const VALUES = [
  ["01", "Transparency above all", "No hidden agendas and no inflated figures. Every recommendation is clear, honest and easy to verify."],
  ["02", "Strategic partnership", "We are not a traditional brokerage. We work alongside owners, investors and developers as long-term partners."],
  ["03", "Professional results", "Modern systems, skilled teams and a digital-first approach that raise the standard for Nepal's property market."],
  ["04", "Long-term relationships", "Our work continues well after a deal closes. We build partnerships on trust, growth and shared success."],
];

const JOURNEY = [
  ["2015", "Foundation", "Sheetal Property is founded to modernise and professionalise Nepal's property industry."],
  ["2017", "First major projects", "Our first residential colony and plotting projects launch across Kathmandu Valley."],
  ["2019", "Hospitality", "Munal & Mayur Resort opens in Chitwan, linking investment to Nepal's tourism growth."],
  ["2021", "Digital transformation", "Professional presentations, online networks and steady buyer pipelines become our standard."],
  ["2023", "Sheetal Group", "Real estate grows into a wider group spanning beauty, technology, agriculture and investment."],
  ["2025", "Seven brands", "Sheetal Group now runs seven sister brands, building destinations and lasting value across Nepal."],
  ["2026", "Sheetal platform", "Stays, projects and investments join buying and renting, and hotels, hosts, agencies and developers run their business on Sheetal."],
];

const BRANDS = [
  [Scissors, "Queens by Sheetal", "Salon & beauty", "/about/brands/queen.png"],
  [Code2, "Sheetal Technologies", "Digital & IT solutions", "/about/brands/technology.png"],
  [Sprout, "Sheetal Sanshee Agro Farm", "Sustainable farming", "/about/brands/farm.png"],
  [Layers, "Sheetal Sanshee Multipurpose", "Diversified services", "/about/brands/multi.png"],
  [Crown, "Sheemai Holdings", "Investment & holdings", "/about/brands/holdings.png"],
  [Hotel, "Munal & Mayur Resort", "Eco resort · Chitwan", "/about/brands/munal.png"],
];

const WHY = ["One place to buy, rent, stay, build and invest", "Clear listings and papers", "Online booking, payments and paperless agreements", "Strong market knowledge and local network", "Modern branding and digital-first marketing", "Transparent, relationship-focused model", "Residential, plotting and hospitality expertise", "Dedicated sales and operations support", "Leadership focused on long-term growth"];

const initials = (n) => n.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

function Head({ eyebrow, title, sub }) {
  return (
    <div className="ab-head">
      <span className="ab-eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      {sub && <p>{sub}</p>}
    </div>
  );
}

export default function About() {
  useSEO("About us", "Sheetal Property: Nepal's modern real estate company for property sales, management, development and investment since 2015.");
  const [openSvc, setOpenSvc] = useState(null);
  const [openTop, setOpenTop] = useState(0);
  // 10 cards = 2 full rows of 5. "Post a requirement" duplicated Property valuation's page; the investor guide is linked from "Raise funds for a project"
// 2 rows of 6: first row is everything you can post yourself, second row is services we do for you
  const ALL = [...SERVICE_LINKS.map(([to, I, t, d]) => [to, I, t, d, DETAIL[to] || []]), ...NEW_SERVICES,
    ["/post-property?type=sell", Tag, "Sell a property", "Land, house, flat or shop", []],
    ["/post-property?type=rent", KeyRound, "Rent out a property", "Flat, room, house or shop", []]];
  const ORDER = ["Sell a property", "Rent out a property", "Host your property as a stay", "Sell your project", "Raise funds for a project", "Post a requirement",
    "Home loan", "Legal help", "Property management", "Pay rent online", "Property valuation", "Run your business on Sheetal"];
  const SVCS = ORDER.map((t) => ALL.find((x) => x[2] === t)).filter(Boolean);
  const cur = SVCS.find((x) => x[2] === openSvc);
  // the short line and the points read as one paragraph; skip repeats
  const para = (d, list) => { const seen = new Set(); return [d, ...list].filter(Boolean).map((x) => String(x).trim()).filter((x) => { const k = x.replace(/\W/g, "").toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).map((x) => (/[.!?]$/.test(x) ? x : x + ".")).join(" "); };
  const toggle = (to, e) => { if (openSvc === to) { setOpenSvc(null); return; } const el = e.currentTarget.closest(".ab3-svc"); setOpenTop(el.offsetTop + el.offsetHeight); setOpenSvc(to); };
  const svcRef = useRef(null);
  // close the open service on Escape or a click outside the grid
  useEffect(() => {
    if (!openSvc) return;
    const key = (e) => e.key === "Escape" && setOpenSvc(null);
    const down = (e) => { if (svcRef.current && !svcRef.current.contains(e.target)) setOpenSvc(null); };
    document.addEventListener("keydown", key); document.addEventListener("mousedown", down);
    return () => { document.removeEventListener("keydown", key); document.removeEventListener("mousedown", down); };
  }, [openSvc]);
  // "Who we are" text saved in Admin → Content → Pages → About us replaces the built-in paragraphs
  const own = adminPage("about");
  const story = own ? textBlocks(own.body).map((b) => b[1]) : null;
  // everything else on this page can be changed in Admin → Content → Pages → About us
  const A = readDb().content?.pages?.about || {};
  const stats = A.stats?.length ? A.stats : STATS;
  const values = A.values?.length ? A.values.map(([t, d], i) => [String(i + 1).padStart(2, "0"), t, d]) : VALUES;
  const C = { ...CONTACT, ...(A.contact || {}) };
  return (
    <div className="ab3">
      <style>{`
.ab3 .ab-eyebrow::before{display:none}
/* Contact us: details on the left, buttons on the right, both centred on the same middle line */
.ab3 .ab3-contact{display:grid !important;grid-template-columns:minmax(0,1fr) auto;align-items:center !important;gap:24px 48px;padding-top:8px;padding-bottom:8px}
.ab3 .ab3-contact > div:first-child{display:flex;flex-direction:column;gap:16px}
.ab3 .ab3-contact h2{margin:0}
.ab3 .ab3-contact ul{display:grid;grid-template-columns:repeat(2,max-content);gap:14px 56px;margin:0;padding:0;list-style:none}
.ab3 .ab3-contact li{display:flex;align-items:center;gap:10px;margin:0}
.ab3 .ab3-contact-actions{display:flex;gap:12px;align-items:center;justify-content:flex-end;flex-wrap:wrap}
@media (max-width:900px){.ab3 .ab3-contact{grid-template-columns:1fr}.ab3 .ab3-contact ul{grid-template-columns:1fr}.ab3 .ab3-contact-actions{justify-content:flex-start}}
/* dark and red themes: brand logos shown as one bright colour. Invert + screen drops white logo backgrounds too */
[data-theme~="dark"] .ab3-brands .ab3-logo,[data-theme~="red"] .ab3-brands .ab3-logo{filter:grayscale(1) invert(1) brightness(1.35) contrast(1.15);mix-blend-mode:screen;background:transparent !important;border:0 !important}
.ab3 .ab3-stats{display:flex !important;flex-wrap:wrap;justify-content:center;gap:24px 64px;margin-left:auto;margin-right:auto;text-align:center}
.ab3 .ab3-stats > div{flex:0 1 220px;display:flex;flex-direction:column;align-items:center;text-align:center;border:0 !important;padding-left:0 !important;padding-right:0 !important}
.ab3 .ab3-stats > div::before,.ab3 .ab3-stats > div::after{display:none !important}
.ab3-hero .ab3-open{position:relative;isolation:isolate}
/* frosted glass over the whole banner, edge to edge */
/* blur the picture itself (a backdrop blur leaves a seam line in Chrome), then a light tint on top */
.ab3-hero::before{filter:blur(6px) saturate(1.1);transform:scale(1.06)}
.ab3-hero::after{content:"";position:absolute;inset:0;z-index:-1;pointer-events:none;background:rgba(255,255,255,.42)}
/* light theme: dark text lifted off the picture with a white halo and a short soft drop shadow */
.ab3-hero h1{text-shadow:0 1px 0 rgba(255,255,255,.95),0 0 18px rgba(255,255,255,.85),0 6px 14px rgba(60,20,20,.22) !important}
.ab3-hero .ab-eyebrow,.ab3-hero p,.ab3-hero .ab3-stats span{text-shadow:0 0 2px rgba(255,255,255,.95),0 0 12px rgba(255,255,255,.9) !important}
.ab3-hero .ab3-stats b{text-shadow:0 1px 0 rgba(255,255,255,.95),0 0 14px rgba(255,255,255,.9),0 4px 10px rgba(60,20,20,.2) !important}
/* dark and red themes: light text, so the glass and shadows go dark */
[data-theme~="dark"] .ab3-hero::after,[data-theme~="red"] .ab3-hero::after{background:rgba(16,16,20,.38)}
.ab3 .ab3-stats{border:0 !important;box-shadow:none !important;background:none !important}
.ab3 .ab3-stats::before,.ab3 .ab3-stats::after{display:none !important}
.ab3-hero,.ab3-hero .ab3-open{border:0 !important}
/* red theme: same full-colour photo and same blur as the other themes */
[data-theme~="red"] .ab3-hero::before{mix-blend-mode:normal !important}
[data-theme~="dark"] .ab3-hero h1,[data-theme~="red"] .ab3-hero h1,[data-theme~="dark"] .ab3-hero .ab3-stats b,[data-theme~="red"] .ab3-hero .ab3-stats b{text-shadow:0 1px 0 rgba(0,0,0,.5),0 6px 16px rgba(0,0,0,.45) !important}
[data-theme~="dark"] .ab3-hero .ab-eyebrow,[data-theme~="red"] .ab3-hero .ab-eyebrow,[data-theme~="dark"] .ab3-hero p,[data-theme~="red"] .ab3-hero p,[data-theme~="dark"] .ab3-hero .ab3-stats span,[data-theme~="red"] .ab3-hero .ab3-stats span{text-shadow:0 1px 3px rgba(0,0,0,.6) !important}
.ab3 .ab3-stats{flex-wrap:nowrap;gap:24px 48px}
.ab3 .ab3-stats > div{flex:0 1 200px;min-width:0}
@media (max-width:560px){.ab3 .ab3-stats{flex-wrap:wrap;gap:20px 28px}}
.ab3 .ab3-value{border:0 !important;padding-top:0}
.ab3 .ab3-value::before,.ab3 .ab3-value::after{display:none !important}
.ab3-contact .btn-primary,.ab3-contact .btn-primary:hover{color:var(--c-white)}
.ab3-contact .btn-outline:hover{color:var(--accent-ink)}
.ab3 .ab3-sec:last-child{padding-bottom:0}
.ab3-contact{align-items:center}
.ab3-hero{position:relative;isolation:isolate;overflow:hidden}
.ab3-hero::before{content:"";position:absolute;inset:0;z-index:-1;pointer-events:none;
  background:url("/brand/hero-sketch.png") center var(--hero-img-focus) / cover no-repeat;
  opacity:var(--hero-img-opacity);
  -webkit-mask-image:linear-gradient(180deg,rgba(0,0,0,.35) 0%,#000 30%);mask-image:linear-gradient(180deg,rgba(0,0,0,.35) 0%,#000 30%)}
[data-theme~="dark"] .ab3-hero::before{opacity:var(--hero-img-opacity-dark)}
[data-theme~="red"] .ab3-hero::before{mix-blend-mode:luminosity}
.ab3-hero h1{text-shadow:0 1px 0 rgba(255,255,255,.7)}
[data-theme~="dark"] .ab3-hero h1,[data-theme~="red"] .ab3-hero h1{text-shadow:0 2px 18px color-mix(in srgb,var(--c-slate) 45%,transparent)}
@media (max-width:760px){.ab3-hero::before{background-size:220% auto}}
`}</style>
      <section className="ab3-hero">
      <div className="container ab3-open">
        <span className="ab-eyebrow">About us</span>
        <h1>{A.heroTitle || "Building Nepal's future, property by property."}</h1>
        <p>{A.heroText || "Since 2015, Sheetal Property has helped owners, buyers and investors across Nepal with property sales, management and development."}</p>
        <div className="ab3-stats">{stats.map(([v, l]) => <div key={l}><b className="tnum">{v}</b><span>{l}</span></div>)}</div>
      </div>
      </section>

      <section className="container ab3-sec ab3-story">
        <style>{`
.ab3-story{grid-template-columns:200px minmax(0,1fr) !important;gap:40px !important}
.ab3-story-text{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:40px}
.ab3-story p{max-width:none !important;margin:0 !important;text-wrap:wrap;text-align:justify}
.ab3-story p{text-align-last:left}
@media (max-width:1080px){.ab3-story{grid-template-columns:1fr !important;gap:12px !important}.ab3-story-text{grid-template-columns:1fr;gap:12px}}
`}</style>
        <h2>Who we are</h2>
        <div className="ab3-story-text">
          {story ? story.map((x, i) => <p key={i}>{x}</p>) : <>
          <p>We are not just selling land, homes or projects. We build trust, long-term value and future-ready communities across Nepal. Every deal is explained clearly, from the first call to the final paperwork, so you know where you stand.</p>
          <p>We guide owners, buyers and investors through home loans, legal checks, property management and rent. Sheetal also lists stays, projects and investments, and gives hotels, hosts, agencies and developers online business tools.</p>
          </>}
        </div>
      </section>

      <section className="container ab3-sec">
        <style>{`
.ab3-svc-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:0 18px;align-items:start}
@media (max-width:1239px){.ab3-svc-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (max-width:1080px){.ab3-svc-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:900px){.ab3-svc-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:560px){.ab3-svc-grid{grid-template-columns:1fr}}
.ab3-svc{display:flex;flex-direction:column;border:0 !important;position:relative;transition:filter .2s,opacity .2s}
.ab3-svc-grid.has-open .ab3-svc:not(.open){filter:blur(2px);opacity:.45}
.ab3-svc.open{z-index:6}
.ab3-svc.open h4{color:var(--accent-ink)}
.ab3-svc-toggle{all:unset;box-sizing:border-box;cursor:pointer;display:flex;align-items:center;gap:12px;padding:16px 4px;width:100%}
.ab3-svc-toggle,.ab3-svc-toggle:hover,.ab3-svc-toggle[aria-expanded="true"]{border:0 !important;box-shadow:none !important;outline:0;background:transparent !important}
.ab3-svc-toggle:focus,.ab3-svc-toggle:active{outline:0 !important;border:0 !important;box-shadow:none !important}
.ab3-svc-toggle:focus-visible{outline:0 !important}
.ab3-svc-toggle:focus-visible h4{text-decoration:underline;text-underline-offset:4px}
.ab3-svc,.ab3-svc:hover,.ab3-svc:focus-within{outline:0 !important;box-shadow:none !important;border:0 !important}
.ab3-svc-links{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:4px}
.ab3-svc-links .btn-primary,.ab3-svc-links .btn-primary:hover{color:var(--c-white,#fff)}
.ab3-svc-toggle h4{flex:1;min-width:0;margin:0;font-size:15px;line-height:1.3;text-wrap:pretty}
.ab3-svc-toggle{gap:10px;padding:14px 2px;min-height:72px}
.ab3-svc-toggle:hover h4{color:var(--accent-ink)}
.ab3-svc-toggle .ab3-chev{flex:none;transition:transform .2s;color:var(--muted, currentColor)}
.ab3-svc.open .ab3-chev{transform:rotate(180deg)}
.ab3-svc-grid{position:relative}
.ab3-svc-body{position:absolute;left:0;right:0;z-index:7;display:flex;flex-direction:column;gap:12px;padding:20px 24px 22px;background:var(--c-white,#fff);border:0 !important;border-radius:var(--r-md,10px);box-shadow:0 18px 40px -12px rgba(0,0,0,.18)}
[data-theme~="dark"] .ab3-svc-body{background:var(--surface,#1c1c1c)}
@media (max-width:560px){.ab3-svc-body{position:static;top:auto !important;box-shadow:none;padding:0 4px 16px;background:transparent}.ab3-svc-grid.has-open .ab3-svc:not(.open){filter:none;opacity:1}}
.ab3-svc-body p{text-wrap:pretty;margin:0;max-width:none;font-size:15.5px;line-height:1.7}
.ab3-svc-body-head{display:flex;align-items:center;gap:10px}.ab3-svc-body-head h4{margin:0;font-size:17px}
.ab3-svc-body ul{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:6px}
.ab3-svc-more{display:inline-flex;align-items:center;gap:4px;color:var(--accent-ink);font-weight:500}
`}</style>
        <h2 className="ab3-h">What we do</h2>
        <div ref={svcRef} className={`ab3-svc-grid ${openSvc ? "has-open" : ""}`}>
          {SVCS.map(([to, I, t]) => (
            <div key={t} className={`ab3-svc ${openSvc === t ? "open" : ""}`}>
              <button type="button" className="ab3-svc-toggle" aria-expanded={openSvc === t} onClick={(e) => toggle(t, e)}>
                <I size={24} strokeWidth={1.5} color="var(--c-red)" />
                <h4>{t}</h4>
                <ChevronDown size={18} className="ab3-chev" />
              </button>
            </div>
          ))}
          {cur && <div className="ab3-svc-body" style={{ top: openTop }} role="region" aria-label={cur[2]}>
            <div className="ab3-svc-body-head">{(() => { const I = cur[1]; return <I size={22} strokeWidth={1.5} color="var(--c-red)" />; })()}<h4>{cur[2]}</h4></div>
            <p className="muted">{SVC_TEXT[cur[2]] || para(cur[3], cur[4])}</p>
            <div className="ab3-svc-links">
              <Link to={cur[0]} className="btn btn-outline btn-sm">See details <ChevronRight size={14} /></Link>
              {SVC_PLANS[cur[2]] && <Link to={SVC_PLANS[cur[2]]} className="btn btn-primary btn-sm">{SVC_CTA(cur[2])} <ChevronRight size={14} /></Link>}
            </div>
          </div>}
        </div>
      </section>

      <section className="container ab3-sec">
        <h2 className="ab3-h">Our values</h2>
        <div className="ab3-grid ab3-grid-4">
          {values.map(([n, t, d]) => <div key={n} className="ab3-value"><h3>{t}</h3><p>{d}</p></div>)}
        </div>
      </section>

      <section className="container ab3-sec">
        <style>{`
@media (min-width:1240px){
.ab3-brands{grid-template-columns:repeat(6,minmax(0,1fr)) !important;gap:28px 20px !important}
.ab3-brands .ab3-brand{flex-direction:column;align-items:center;text-align:center;gap:12px}
.ab3-brands .ab3-logo{width:80px !important;height:80px !important;border:0 !important;background:transparent !important}
.ab3-brands h3{font-size:15px;line-height:1.35;min-height:2.7em;display:flex;align-items:center;justify-content:center}
.ab3-brands p{font-size:13px;line-height:1.5;min-height:3em}
}
`}</style>
        <h2 className="ab3-h">Our other brands</h2>
        <div className="ab3-grid ab3-grid-3 ab3-brands">
          {BRANDS.map(([, n, t, img]) => (
            <div key={n} className="ab3-item ab3-brand"><img className="ab3-logo" src={img} alt={`${n} logo`} loading="lazy" /><div><h3>{n}</h3><p>{t}</p></div></div>
          ))}
        </div>
      </section>

      <section className="container ab3-sec">
        <div className="ab3-contact">
          <div>
            <ul>
              {C.address && <li><MapPin size={16} />{C.address}</li>}
              {(C.phone1 || C.phone2) && <li><Phone size={16} /><span>{[C.phone1, C.phone2].filter(Boolean).map((x, i) => <React.Fragment key={x}>{i > 0 && " · "}<a href={tel(x)}>{x}</a></React.Fragment>)}</span></li>}
              {C.email && <li><Mail size={16} /><a href={`mailto:${C.email}`}>{C.email}</a></li>}
              {C.hours && <li><Clock size={16} />{C.hours}</li>}
            </ul>
          </div>
          <div className="ab3-contact-actions">
            {C.phone1 && <a href={tel(C.phone1)} className="btn btn-primary"><Phone size={16} />Call us</a>}
            <Link to="/requirement" className="btn btn-outline">Post a requirement</Link>
          </div>
        </div>
      </section>
    </div>
  );
}