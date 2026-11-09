// Business → Overview on the business API: every number comes from GET /overview (nothing is sample data).
// Where it fits: BusinessApp.jsx shows it at /business when isLive(tenant.id); the sample BusinessOverview stays for the demo.
// How it works: loads once for the open business and branch (the panel remounts it when the branch changes) and every
// minute; shows only the blocks the server sent (the server hides what the role may not see). Each empty block says
// what to do next.
// Rules: whole rupees; dates as the server sends them (Nepal days); every card links to the page behind it.

import React, { useCallback, useEffect, useState } from "react";
import { useT } from "@sheetal/shared/core/i18n";
import { useStore } from "@sheetal/shared/core/store";
import { Link, useRouter } from "@sheetal/shared/core/router";
import { fdate, rs } from "@sheetal/shared/core/format";
import { can } from "@sheetal/shared/core/rbac";
import { Button, Empty, Meter, PageHead, Panel, Stat } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { bizApi } from "../api";
import { SetupPanel } from "./Setup";

const LIMIT_LABEL = { seats: "Team seats", listings: "Listings", featured: "Featured listings", outlets: "POS outlets" };

export function LiveOverview({ tenant, role }) {
  const t = useT();
  const { db } = useStore();
  const { navigate } = useRouter();
  const [d, setD] = useState(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => bizApi("GET", "/overview").then((r) => { setD(r.data); setFailed(false); }).catch(() => setFailed(true)), [tenant.id]);
  useEffect(() => { setD(null); load(); const every = setInterval(load, 60_000); return () => clearInterval(every); }, [load]);

  const quick = [
    can(role, "listings.manage") || can(role, "projects.manage") || can(role, "investments.manage") || can(role, "calendar.edit") || role.perms.includes("*") ? { icon: "house-plus", label: t("listings.new"), to: "/business/listings/new" } : null,
    { icon: "file-pen-line", label: t("ag.new"), to: "/business/agreements" },
    can(role, "team.manage") ? { icon: "user-plus", label: t("team.invite"), to: "/business/team" } : null,
    { icon: "messages-square", label: t("nav.inbox"), to: "/business/inbox" },
    (tenant.type === "hotel" || tenant.type === "host") && { icon: "calendar-days", label: t("nav.calendar"), to: "/business/calendar" },
    { icon: "git-branch", label: t("nav.branches"), to: "/business/branches" },
  ].filter(Boolean).slice(0, 6);

  const head = <PageHead title={t("bdash.hello", { name: db.session.userName.split(" ")[0] })} sub={`${tenant.name} · ${t(`type.${tenant.type}`)}${d?.plan ? ` · ${d.plan.name} ${t("bdash.plan")}` : ""}`} />;
  if (!d) return <>{head}<SetupPanel tenant={tenant} /><p className="muted pf-pad">{failed ? "The overview couldn't load. Check your connection and try again." : "Loading…"}</p>{failed && <div className="pf-pad"><Button variant="outline" onClick={load}>Try again</Button></div>}</>;

  const s = d.today?.stays, ag = d.today?.agency, dev = d.today?.developer;
  // Up to four headline numbers, picked from what this person may see.
  const stats = [
    s && { label: "Occupancy this month", value: s.occupancyPct == null ? "—" : `${s.occupancyPct}%`, note: s.rooms ? `${s.nightsSold} of ${s.rooms * s.days} room nights` : "Add rooms to see this", to: "/business/calendar" },
    s && { label: "Arrivals today", value: s.arrivals, note: `${s.departures} leaving today`, to: "/business/bookings" },
    s && { label: "In the house", value: s.inHouse, note: "Guests checked in now", to: "/business/bookings" },
    d.listings && { label: "Published listings", value: d.listings.published, note: `${d.listings.pending} waiting for review · ${d.listings.drafts} drafts`, to: "/business/listings" },
    d.leads && { label: "New leads this week", value: d.leads.newThisWeek, note: d.leads.unread ? `${d.leads.unread} unread` : "All read", to: "/business/inbox", tone: d.leads.unread ? "action" : undefined },
    ag && { label: "Viewings, next 7 days", value: ag.viewingsThisWeek, note: "Booked in the Inbox", to: "/business/inbox" },
    dev?.siteVisits != null && { label: "Open site visits", value: dev.siteVisits, note: "Requests not closed yet", to: "/business/inbox" },
    dev?.reservations != null && { label: "Reservations", value: dev.reservations, note: `${dev.sold} units sold`, to: "/business/collections" },
    d.rent && { label: "Rent late", value: d.rent.lateCount, note: d.rent.late ? `${rs(d.rent.late)} to collect` : "Nothing late", to: "/business/rentals", tone: d.rent.lateCount ? "action" : undefined },
    d.money?.invoices && { label: "Invoices overdue", value: d.money.invoices.overdue, note: d.money.invoices.overdue ? `${rs(d.money.invoices.overdueTotal)} to collect` : "Nothing overdue", to: "/business/invoices", tone: d.money.invoices.overdue ? "action" : undefined },
  ].filter(Boolean).slice(0, 4);

  const m = d.money || {};
  const rows = [
    m.invoices && ["receipt", "Invoices this month", `${m.invoices.sent} sent (${rs(m.invoices.sentTotal)}) · ${m.invoices.paid} paid · ${m.invoices.overdue} overdue`, "/business/invoices"],
    m.expenses && ["wallet", "Expenses", `${rs(m.expenses.total)} spent · ${m.expenses.count} entries`, "/business/expenses"],
    m.expenses && ["trending-up", "Profit this month", `${rs(m.expenses.profit)} (${rs(m.expenses.received)} received less expenses)`, "/business/expenses"],
    m.payouts && ["hand-coins", "Payouts from Sheetal", `${rs(m.payouts.pending)} on its way · ${rs(m.payouts.waiting)} waiting for the next run`, "/business/payouts"],
    d.rent && ["home", "Rent", `${rs(d.rent.due)} due this month (${d.rent.dueCount} bills) · ${rs(d.rent.late)} late`, "/business/rentals"],
  ].filter(Boolean);

  const p = d.plan, pr = d.promote;
  return (
    <>
      {head}
      <SetupPanel tenant={tenant} />
      {stats.length > 0 && <div className="pf-stats">{stats.map((x) => <Stat key={x.label} {...x} />)}</div>}
      <div className="pf-quick-actions">
        {quick.map((q) => <Link key={q.to + q.label} to={q.to} className="card pf-qa"><Icon name={q.icon} size={20} /><span>{q.label}</span><Icon name="chevron-right" size={16} /></Link>)}
      </div>
      <div className="pf-split">
        <Panel title={t("bdash.todo")} sub={t("bdash.todoSub", { n: d.attention.length })} className="grow">
          {d.attention.length ? <ul className="pf-list">{d.attention.map((x) => (
            <li key={x.id}><span className="pf-li-ico"><Icon name={x.icon} size={17} /></span><div><span>{x.text}</span></div><Button variant="outline" size="sm" onClick={() => navigate(x.to)}>{x.cta}</Button></li>
          ))}</ul> : <p className="pf-pad small muted">{t("bdash.allClear")}</p>}
        </Panel>
        {p && <Panel title={t("bdash.planUsage")} className="side" pad actions={can(role, "billing.manage") ? <Link to="/business/billing" className="link small">{t("bdash.managePlan")}</Link> : undefined}>
          <div className="pf-stack">
            {p.usage.map((u) => u.used == null
              ? <div key={u.key} className="pf-meter"><div className="pf-meter-top"><span>{LIMIT_LABEL[u.key] || u.key}</span><b className="tnum">{u.limit === -1 ? "Unlimited" : `Up to ${u.limit}`}</b></div></div>
              : <Meter key={u.key} label={LIMIT_LABEL[u.key] || u.key} used={u.used} limit={u.limit} />)}
            {p.renewsAt ? <span className="small muted tnum">{t("bdash.renews", { d: fdate(p.renewsAt) })}</span> : <span className="small muted">{p.price ? "No renewal date yet." : "Starter is free and doesn't renew."}</span>}
          </div>
        </Panel>}
      </div>
      <div className="pf-split">
        {rows.length > 0 && <Panel title="Money this month" className="grow">
          <ul className="pf-list">{rows.map(([icon, label, text, to]) => (
            <li key={label}><span className="pf-li-ico"><Icon name={icon} size={17} /></span><div><b>{label}</b><br /><span className="small muted tnum">{text}</span></div><Button variant="ghost" size="sm" onClick={() => navigate(to)}>Open</Button></li>
          ))}</ul>
        </Panel>}
        {d.listings && <Panel title="Listings" className={rows.length ? "side" : "grow"} actions={<Link to="/business/listings" className="link small">All listings</Link>}>
          {d.listings.published + d.listings.pending + d.listings.drafts ? <ul className="pf-list">
            <li><div><b className="tnum">{d.listings.published}</b> published</div></li>
            <li><div><b className="tnum">{d.listings.pending}</b> waiting for Sheetal to review</div></li>
            <li><div><b className="tnum">{d.listings.drafts}</b> drafts</div></li>
          </ul> : <Empty icon="house-plus" title="No listings yet" action={<Button size="sm" onClick={() => navigate("/business/listings/new")}>Add your first listing</Button>}>Add one and send it for review to show it on the website.</Empty>}
        </Panel>}
        {pr && <Panel title="Boosts and banners" className="side" actions={<Link to="/business/promote" className="link small">Promote</Link>}>
          {pr.liveBoosts + pr.liveBanners + pr.unpaid ? <ul className="pf-list">
            <li><div><b className="tnum">{pr.liveBoosts}</b> boosts live</div></li>
            <li><div><b className="tnum">{pr.liveBanners}</b> home banners live</div></li>
            {pr.unpaid > 0 && <li><div><b className="tnum">{pr.unpaid}</b> waiting for payment</div></li>}
          </ul> : <Empty icon="megaphone" title="Nothing promoted" action={<Button size="sm" variant="outline" onClick={() => navigate("/business/promote")}>See how it works</Button>}>Boost a listing to show it first on the website.</Empty>}
        </Panel>}
      </div>
    </>
  );
}
