// One Sheetal Technologies software in detail (/technology/software/<id>), and the list of all of them (/technology/software).
// Where it fits: the software cards on /technology open these pages. The words (what it is, problems, features) are in data/software.js; the
// name, short line, which apps are still coming and which plans include it come live from GET /public/packs, so prices never go stale.
// How it works: hero with what it is, the problems it solves, every feature group, coming soon, the plans that include it, the other software,
// and the demo request form.

import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, Clock, Globe, Hotel, Building2, KeyRound, Layers, MessagesSquare, Receipt, Rocket, UsersRound, AlertCircle } from "lucide-react";
import { api } from "../api/endpoints";
import { toItem } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { useSEO } from "../utils/seo";
import { SOFTWARE_INFO } from "../data/software";
import { DemoRequest } from "../components/DemoRequest";

export const SOFT_ICON = { globe: Globe, "messages-square": MessagesSquare, receipt: Receipt, "users-round": UsersRound, "key-round": KeyRound, hotel: Hotel, "building-2": Building2, rocket: Rocket };
const rs = (paisa) => `Rs. ${Math.round(paisa / 100).toLocaleString("en-IN")}`;

function usePacks() {
  const { data, loading } = useAsync(() => api.packs().then(toItem), []);
  return { packs: data?.packs || [], software: data?.software || [], loading };
}

export function SoftwareList() {
  useSEO("Sheetal Technologies software", "CRM, accounting, HRM, property management, hospitality, projects and promotion software for businesses in Nepal.");
  const { software, loading } = usePacks();
  return (
    <div className="tech">
      <section className="tech-hero"><div className="container" style={{ paddingTop: 40, paddingBottom: 40 }}>
        <Link to="/technology" className="small soft-back"><ArrowLeft size={15} /> Sheetal Technologies</Link>
        <h1 style={{ fontSize: "clamp(28px, 4vw, 42px)", margin: "10px 0" }}>The software</h1>
        <p className="tech-lead">Pick one to see what it is, the problems it solves and every feature.</p>
      </div></section>
      <section className="container section">
        {loading ? <div className="sk" style={{ height: 300 }} /> : <SoftCards list={software} />}
      </section>
    </div>
  );
}

export function SoftCards({ list, skip }) {
  return (
    <div className="tech-soft">
      {list.filter((s) => s.id !== skip).map((s) => {
        const I = SOFT_ICON[s.icon] || Layers;
        const soon = s.apps.length > 0 && s.apps.every((a) => a.comingSoon);
        return (
          <Link key={s.id} to={`/technology/software/${s.id}`} className="card tech-soft-card tech-soft-link">
            <span className="tech-ico"><I size={20} /></span>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}><h3>{s.name.en}</h3>{s.free && <span className="tag tag-soft">Free</span>}{soon && <span className="tag tag-line">Coming soon</span>}</div>
            <p className="small muted">{s.tagline.en}</p>
            <span className="small soft-more">All features <ArrowRight size={14} /></span>
          </Link>
        );
      })}
    </div>
  );
}

export function SoftwarePage() {
  const { id } = useParams();
  const info = SOFTWARE_INFO[id];
  const { packs, software, loading } = usePacks();
  const s = software.find((x) => x.id === id);
  const name = s?.name.en || ({ cms: "Sheetal CMS", crm: "Sheetal CRM", accounting: "Sheetal Accounting", hrm: "Sheetal HRM", property: "Sheetal Property Management", hospitality: "Sheetal Hospitality", projects: "Sheetal Projects", growth: "Sheetal Promote" })[id] || "Software";
  useSEO(`${name}: features and plans`, info ? info.what.slice(0, 155) : "Sheetal Technologies software.");
  if (!info) {
    return <div className="container section"><h1>Not found</h1><p><Link className="link" to="/technology/software">See all the software</Link></p></div>;
  }
  const I = SOFT_ICON[s?.icon] || Layers;
  const inPacks = packs.filter((p) => p.software.includes(id));
  const soonApps = (s?.apps || []).filter((a) => a.comingSoon).map((a) => a.name.en);
  const soon = [...new Set([...(info.soon || [])])];

  return (
    <div className="tech soft-page">
      <section className="tech-hero">
        <div className="container soft-hero">
          <Link to="/technology" className="small soft-back"><ArrowLeft size={15} /> Sheetal Technologies</Link>
          <div className="row soft-title"><span className="tech-ico soft-ico"><I size={26} /></span><div className="stack" style={{ gap: 4 }}><span className="tier">{s?.free ? "Free for everyone" : "Business software"}</span><h1>{name}</h1></div></div>
          <p className="tech-lead">{info.what}</p>
          <p className="small muted"><b>Who it is for:</b> {info.who}</p>
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            <a href="#demo" className="btn btn-primary">Request a demo <ArrowRight size={16} /></a>
            {s?.free ? <Link to="/post-property" className="btn btn-outline">Start posting free</Link> : <a href="/technology#plans" className="btn btn-outline">See plans</a>}
          </div>
        </div>
      </section>

      <section className="container section">
        <div className="section-head"><div className="stack"><span className="tier">Problems it solves</span><h2>What gets easier</h2></div></div>
        <div className="soft-problems">
          {info.problems.map(([p, fix]) => (
            <div key={p} className="card card-pad soft-problem">
              <p className="soft-p"><AlertCircle size={17} /> <span>{p}</span></p>
              <p className="soft-fix"><Check size={17} /> <span>{fix}</span></p>
            </div>
          ))}
        </div>
      </section>

      <section className="container section" style={{ paddingTop: 0 }}>
        <div className="section-head"><div className="stack"><span className="tier">Features</span><h2>Everything in {name}</h2></div></div>
        <div className="soft-feats">
          {info.features.map(([g, items]) => (
            <div key={g} className="card card-pad soft-feat">
              <h3>{g}</h3>
              <ul>{items.map((x) => <li key={x}><Check size={15} /> <span>{x}</span></li>)}</ul>
            </div>
          ))}
          {soon.length > 0 && (
            <div className="card card-pad soft-feat soft-soon">
              <h3><Clock size={17} /> Coming soon</h3>
              <ul>{soon.map((x) => <li key={x}><Clock size={15} /> <span>{x}</span></li>)}</ul>
              {soonApps.length > 0 && <p className="tiny muted" style={{ margin: 0 }}>Included in your plan at no extra cost when it arrives.</p>}
            </div>
          )}
        </div>
      </section>

      {!s?.free && (
        <section className="container section" style={{ paddingTop: 0 }}>
          <div className="section-head"><div className="stack"><span className="tier">Plans</span><h2>Which plans include it</h2></div></div>
          {loading ? <div className="sk" style={{ height: 120 }} /> : (
            <div className="soft-packs">
              {packs.map((p) => {
                const has = inPacks.includes(p);
                const m1 = p.periods.find((x) => x.months === 1);
                return (
                  <div key={p.id} className={`card card-pad soft-pack ${has ? "" : "off"}`}>
                    <div className="row between" style={{ gap: 8 }}><b>{p.name.en}</b>{has ? <span className="tag tag-soft"><Check size={13} /> Included</span> : <span className="tag tag-line">Not included</span>}</div>
                    {m1 && <span className="small muted">{rs(m1.pricePaisa)} a month{m1.onOffer ? ` (${p.offerLabel?.en || "offer"})` : ""}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      <section className="container section" style={{ paddingTop: 0 }}>
        <div className="section-head"><div className="stack"><span className="tier">Works together</span><h2>The other software</h2><p>All of them share your customers, branches and team.</p></div></div>
        {loading ? <div className="sk" style={{ height: 200 }} /> : <SoftCards list={software} skip={id} />}
      </section>

      <section id="demo" className="container section" style={{ paddingTop: 0, paddingBottom: 72, scrollMarginTop: 80 }}>
        <div className="section-head"><div className="stack"><span className="tier">Demo</span><h2>See {name} with our team</h2><p>Tell us about your business. We call you, show you the software with your kind of work, and set up a demo account for you.</p></div></div>
        <DemoRequest key={id} pick={s?.free ? [] : [id]} />
      </section>
    </div>
  );
}
