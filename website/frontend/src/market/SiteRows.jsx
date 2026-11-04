// Home page rows: popular stays, featured projects and open investments, plus the post-a-property type picker.
// How it works: until something is posted, a row invites owners to post the first one instead of standing empty.

import React from "react";
import { StoreProvider, useStore as useSt0 } from "@sheetal/shared/core/store";
import { I18nProvider } from "@sheetal/shared/core/i18n";
import { RouterProvider } from "@sheetal/shared/core/router";
import { StayCard, ProjectCard, InvestCard, useCatalog } from "./Market";
import { rs } from "@sheetal/shared/core/format";
import "@sheetal/shared/styles/platform.css";
import { InviteCards } from "../components/InviteCards";

// Usage in pages/Home.jsx:  <HomePlatformRows SectionHead={SectionHead} Link={Link} />
function Rows({ SectionHead, Link }) {
  const { stays, projects, invests } = useCatalog();
  const rows = [
    ["stay", "Stay in Nepal", "Popular stays", "/stays", "See all stays", stays.slice(0, 4).map((s) => <StayCard key={s.id} s={s} />)],
    ["project", "Under construction and ready", "Featured projects", "/project", "See all projects", projects.slice(0, 4).map((p) => <ProjectCard key={p.id} p={p} />)],
    ["invest", "Fund from Rs. 10,000", "Open investments", "/investment/explore", "See all", invests.slice(0, 4).map((v) => <InvestCard key={v.id} v={v} />)],
  ];
  // Until something is posted, a row invites owners to post the first one instead of standing empty.
  return rows.map(([kind, kicker, title, to, label, cards]) => (
    <section key={title} className="section container">
      <SectionHead kicker={kicker} title={title} action={cards.length ? <Link to={to} className="link">{label}</Link> : null} />
      {cards.length ? <div className="pb-grid pb-home-row">{cards}</div> : <InviteCards kind={kind} compact />}
    </section>
  ));
}

export default function HomePlatformRows(props) {
  return <Wrap><Rows {...props} /></Wrap>;
}

const Lang = ({ children }) => { const { db } = useSt0(); return <I18nProvider lang={db.session.lang}>{children}</I18nProvider>; };
const Wrap = ({ children }) => <StoreProvider><Lang><RouterProvider mode="history">{children}</RouterProvider></Lang></StoreProvider>;
const Chips = ({ value, options, onChange }) => <div className="pf-chips">{options.map((o) => <button key={o} type="button" className={`chip ${value === o ? "active" : ""}`} onClick={() => onChange(o)}>{o}</button>)}</div>;

function ProjectsInner({ SectionHead }) {
  const { projects } = useCatalog();
  const [city, setCity] = React.useState("All"); const [status, setStatus] = React.useState("All");
  if (!projects.length) return <section className="section-sm"><SectionHead kicker="Buildings, colonies and villa projects" title="Projects" /><InviteCards kind="project" /></section>;
  const cities = ["All", ...new Set(projects.map((p) => p.city))];
  const list = projects.filter((p) => (city === "All" || p.city === city) && (status === "All" || p.status === status));
  return (<section className="section-sm"><SectionHead kicker="Buildings, colonies and villa projects" title={`${list.length} projects`} />
    <div className="pf-stack" style={{ gap: 12, marginBottom: 20 }}><Chips value={city} options={cities} onChange={setCity} /><Chips value={status} options={["All", "Upcoming", "Under construction", "Ready to move"]} onChange={setStatus} /></div>
    <div className="pb-grid pb-home-row">{list.map((p) => <ProjectCard key={p.id} p={p} />)}</div></section>);
}
function InvestInner({ SectionHead }) {
  const { invests } = useCatalog();
  const [st, setSt] = React.useState("Open");
  if (!invests.length) return <section><SectionHead kicker="Fund from Rs. 10,000 · returns not guaranteed" title="Project investments" /><InviteCards kind="invest" /></section>;
  const isOpen = (v) => v.raised < v.target;
  const list = invests.filter((v) => st === "All" || (st === "Open" ? isOpen(v) : !isOpen(v)));
  return (<section><SectionHead kicker="Fund from Rs. 10,000 · returns not guaranteed" title="Project investments" />
    <div style={{ marginBottom: 20 }}><Chips value={st} options={["Open", "Funded", "All"]} onChange={setSt} /></div>
    <div className="pb-grid pb-home-row">{list.map((v) => <InvestCard key={v.id} v={v} />)}</div></section>);
}
export const ProjectsSection = (p) => <Wrap><ProjectsInner {...p} /></Wrap>;
export const InvestSection = (p) => <Wrap><InvestInner {...p} /></Wrap>;

// New calculators for your Tools page: invest-return, host-income, pay-schedule
export function ToolCalc({ kind }) {
  const [a, setA] = React.useState({ amt: 100000, rate: 12, yrs: 3, nightly: 6000, occ: 60, fee: 10, price: 8500000 });
  const N = ({ k, label, unit }) => <div className="field"><label>{label}</label><div className="pf-unit"><input className="input tnum" value={a[k].toLocaleString("en-IN")} onChange={(e) => setA({ ...a, [k]: Number(e.target.value.replace(/\D/g, "")) || 0 })} /><span>{unit}</span></div></div>;
  if (kind === "invest-return") { const end = a.amt * Math.pow(1 + a.rate / 100, a.yrs);
    return <div className="pf-calc"><N k="amt" label="Amount" unit="Rs." /><N k="rate" label="Expected return a year" unit="%" /><N k="yrs" label="Years" unit="yrs" /><div className="pf-calc-out"><span>Could become</span><b className="tnum">{rs(end)}</b><small>Gain {rs(end - a.amt)}. Returns are estimates and not guaranteed.</small></div></div>; }
  if (kind === "host-income") { const gross = a.nightly * 30 * (a.occ / 100);
    return <div className="pf-calc"><N k="nightly" label="Price per night" unit="Rs." /><N k="occ" label="Nights booked" unit="%" /><N k="fee" label="Sheetal fee" unit="%" /><div className="pf-calc-out"><span>About a month</span><b className="tnum">{rs(gross * (1 - a.fee / 100))}</b><small>{Math.round(30 * a.occ / 100)} nights × {rs(a.nightly)}, after the fee.</small></div></div>; }
  const stages = [["Booking", 10, "On reservation"], ["Structure", 30, "When the frame is done"], ["Plaster", 30, "When walls are finished"], ["Handover", 30, "At key handover"]];
  return <div className="pf-calc"><N k="price" label="Unit price" unit="Rs." /><div className="pf-calc-out" style={{ gridColumn: "1 / -1" }}><table className="table"><thead><tr><th>Stage</th><th>When</th><th style={{ textAlign: "right" }}>Amount</th></tr></thead><tbody>{stages.map(([s, p, w]) => <tr key={s}><td>{s} · {p}%</td><td>{w}</td><td className="tnum" style={{ textAlign: "right" }}>{rs(a.price * p / 100)}</td></tr>)}</tbody></table><small>Bank loan for 70% over 20 years at 11%: about {rs(Math.round((a.price * 0.7 * (0.11 / 12)) / (1 - Math.pow(1 + 0.11 / 12, -240))))} a month.</small></div></div>;
}

const Tile = ({ icon, title, sub, to, onClick, on }) => { const C = to ? "a" : "button"; return <C href={to} type={to ? undefined : "button"} onClick={onClick} className={`card pb-pick ${on ? "on" : ""}`}><span className="pf-kind-ico"><Icon name={icon} size={22} /></span><b>{title}</b><small className="muted">{sub}</small></C>; };
import { Icon } from "@sheetal/shared/core/icons";

// Post property, step one: pick the type. Sell and Rent go on to the main post form (pages/PostProperty.jsx).
export function PostTypePicker() {
  // every type is posted from the website and reviewed before it goes live
  const k = (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("type")) || "sell";
  return <div className="container narrow" style={{ paddingTop: 16 }}><div className="pb-picks">
    <Tile icon="tag" title="Sell" sub="House, land, flat or commercial" on={k === "sell"} to="/post-property?type=sell" />
    <Tile icon="key-round" title="Rent out" sub="Monthly rent and deposit" on={k === "rent"} to="/post-property?type=rent" />
    <Tile icon="bed-double" title="Offer a stay" sub="Homestay, room, villa or hotel" on={k === "stay"} to="/post-property?type=stay" />
    <Tile icon="building-2" title="List a project" sub="Apartments, colony, villas" on={k === "project"} to="/post-property?type=project" />
    <Tile icon="hand-coins" title="Open an investment" sub="Raise funds from Rs. 10,000" on={k === "invest"} to="/post-property?type=invest" />
  </div><p className="small muted" style={{ marginTop: 8 }}>Free with a Sheetal account. Every post is reviewed before it goes live, and you manage it from My profile.</p></div>;
}

export { Wrap as PlatformWrap };
