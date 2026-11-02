import { SetupPanel } from "./Setup";
import { isLive, liveTeam } from "../live";
import React from "react";
import { useT } from "@sheetal/shared/core/i18n";
import { useStore, uid } from "@sheetal/shared/core/store";
import { Link, useRouter } from "@sheetal/shared/core/router";
import { fdate, inDays, TODAY } from "@sheetal/shared/core/format";
import { can, permsForTypes } from "@sheetal/shared/core/rbac";
import { typesFor } from "@sheetal/shared/core/plans";
import { checkupsOf, todaysList } from "@sheetal/shared/data/checkups";
import { Badge, Button, PageHead, Panel, Stat, Tabs, useToast } from "@sheetal/shared/core/ui";
import { People } from "./Workspace";
import { useBranch } from "@sheetal/shared/core/branch";
import { Structure } from "./Structure";
import { Icon } from "@sheetal/shared/core/icons";
import { TeamPanel } from "@sheetal/shared/components/TeamPanel";
import { RoleEditor } from "@sheetal/shared/components/RoleEditor";

const KPIS = {
  hotel: [["kpi.occupancy", "79%", "kpi.occupancyNote"], ["kpi.revenueMonth", "Rs. 3.12 Lakh", "kpi.vsLast"], ["kpi.arrivals", "3", "kpi.arrivalsNote"], ["kpi.rating", "4.7", "kpi.ratingNote"]],
  host: [["kpi.occupancy", "64%", "kpi.occupancyNote"], ["kpi.revenueMonth", "Rs. 96,000", "kpi.vsLast"], ["kpi.upcoming", "5", "kpi.upcomingNote"], ["kpi.rating", "4.9", "kpi.ratingNote"]],
  developer: [["kpi.unitsSold", "142 / 240", "kpi.unitsNote"], ["kpi.collectionsDue", "Rs. 1.84 Cr", "kpi.collectionsNote"], ["kpi.visits", "11", "kpi.visitsNote"], ["kpi.reservations", "6", "kpi.reservationsNote"]],
  agency: [["kpi.activeListings", "84", "kpi.listingsNote"], ["kpi.newLeads", "37", "kpi.leadsNote"], ["kpi.viewings", "9", "kpi.viewingsNote"], ["kpi.deals", "Rs. 4.2 Cr", "kpi.dealsNote"]],
  sponsor: [["kpi.raised", "Rs. 2.75 Cr", "kpi.raisedNote"], ["kpi.investors", "128", "kpi.investorsNote"], ["kpi.daysLeft", "21", "kpi.daysLeftNote"], ["kpi.updates", "4", "kpi.updatesNote"]],
};

export function BusinessOverview({ tenant, role }) {
  const t = useT();
  const { db } = useStore();
  const { navigate } = useRouter();
  const plan = db.plans.find((p) => p.id === tenant.planId);
  const invites = (db.invites[tenant.id] || []).filter((i) => i.status === "pending");
  const agreements = (db.agreements[tenant.id] || []).filter((a) => a.status === "sent" || a.status === "draft");
  const draft = db.drafts[tenant.id];
  const ck = checkupsOf(db, tenant.id);
  const toCheck = todaysList(db.listings.filter((l) => l.tenantId === tenant.id), ck.settings, ck.log, TODAY.slice(0, 10)).length;
  const todo = [
    ...(toCheck ? [{ icon: "list-checks", text: `${toCheck} listing${toCheck > 1 ? "s" : ""} to check today`, to: "/business/checkups", cta: "Start" }] : []),
    ...(draft ? [{ icon: "file-pen", text: t("bdash.todoDraft"), to: "/business/listings/new", cta: t("listings.resume") }] : []),
    ...agreements.map((a) => ({ icon: "file-pen-line", text: t(a.status === "draft" ? "bdash.todoAgDraft" : "bdash.todoAgSign", { id: a.id }), to: "/business/agreements", cta: t("common.open") })),
    ...invites.map((i) => ({ icon: "mail", text: t("bdash.todoInvite", { email: i.email }), to: "/business/team", cta: t("common.view") })),
    ...(tenant.status === "past_due" ? [{ icon: "credit-card", text: t("bdash.todoPastDue"), to: "/business/billing", cta: t("bdash.payNow") }] : []),
  ];
  const quick = [
    can(role, "listings.manage") || can(role, "projects.manage") || can(role, "investments.manage") || can(role, "calendar.edit") || role.perms.includes("*") ? { icon: "house-plus", label: t("listings.new"), to: "/business/listings/new" } : null,
    { icon: "file-pen-line", label: t("ag.new"), to: "/business/agreements" },
    can(role, "team.manage") ? { icon: "user-plus", label: t("team.invite"), to: "/business/team" } : null,
    { icon: "messages-square", label: t("nav.inbox"), to: "/business/inbox" },
    (tenant.type === "hotel" || tenant.type === "host") && { icon: "calendar-days", label: t("nav.calendar"), to: "/business/calendar" },
    { icon: "git-branch", label: t("nav.branches"), to: "/business/branches" },
  ].filter(Boolean).slice(0, 6);

  return (
    <>
      <PageHead title={t("bdash.hello", { name: db.session.userName.split(" ")[0] })} sub={`${tenant.name} · ${t(`type.${tenant.type}`)} · ${plan.name} ${t("bdash.plan")}`} />
      <SetupPanel tenant={tenant} />
      <div className="pf-stats">{KPIS[tenant.type].map(([l, v, n], i) => <Stat key={l} label={t(l)} value={v} note={t(n)} to={["/business/analytics", "/business/analytics", tenant.type === "hotel" || tenant.type === "host" ? "/business/bookings" : "/business/inbox", "/business/analytics"][i]} />)}</div>
      <div className="pf-quick-actions">
        {quick.map((q) => <Link key={q.to + q.label} to={q.to} className="card pf-qa"><Icon name={q.icon} size={20} /><span>{q.label}</span><Icon name="chevron-right" size={16} /></Link>)}
      </div>
      <div className="pf-split">
        <Panel title={t("bdash.todo")} sub={t("bdash.todoSub", { n: todo.length })} className="grow">
          {todo.length ? <ul className="pf-list">{todo.map((x, i) => (
            <li key={i}><span className="pf-li-ico"><Icon name={x.icon} size={17} /></span><div><span>{x.text}</span></div><Button variant="outline" size="sm" onClick={() => navigate(x.to)}>{x.cta}</Button></li>
          ))}</ul> : <p className="pf-pad small muted">{t("bdash.allClear")}</p>}
        </Panel>
        <Panel title={t("bdash.planUsage")} className="side" pad actions={<Link to="/business/billing" className="link small">{t("bdash.managePlan")}</Link>}>
          <div className="pf-stack">
            {Object.entries(plan.limits).map(([k, lim]) => (
              <div key={k} className="pf-meter"><div className="pf-meter-top"><span>{t(`limit.${k}`)}</span><b className="tnum">{tenant.usage[k] || 0} / {lim === -1 ? "∞" : lim}</b></div>
                <div className="bar"><i style={{ width: lim === -1 ? "4%" : `${Math.min(100, ((tenant.usage[k] || 0) / lim) * 100)}%` }} /></div></div>
            ))}
            <span className="small muted tnum">{t("bdash.renews", { d: fdate(tenant.renews) })}</span>
          </div>
        </Panel>
      </div>
    </>
  );
}

export function TeamHub({ tenant, role, start = "members" }) {
  const t = useT();
  const [tab, setTab] = React.useState(start);
  const tabs = [
    can(role, "team.view") && { id: "members", label: t("team.members"), icon: "users" },
    can(role, "team.view") && { id: "structure", label: t("org.tab"), icon: "network" },
    { id: "attendance", label: t("hr.tabAttendance"), icon: "map-pin" },
    can(role, "roles.manage") && { id: "roles", label: t("nav.roles"), icon: "key-round" },
  ].filter(Boolean);
  return (
    <>
      <PageHead title={t("team.pageTitle")} sub={t("team.hubSub")} />
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === "members" && <BusinessTeam tenant={tenant} role={role} embedded />}
      {tab === "structure" && <Structure tenant={tenant} />}
      {tab === "attendance" && <People tenant={tenant} role={role} embedded />}
      {tab === "roles" && <BusinessRoles tenant={tenant} role={role} embedded />}
    </>
  );
}

export function BusinessTeam({ tenant, role, embedded }) {
  const { db, update } = useStore();
  const toast = useToast();
  const live = isLive(tenant.id) ? liveTeam(toast) : null;
  const plan = db.plans.find((p) => p.id === tenant.planId);
  const tid = tenant.id;
  const { branch } = useBranch();
  const log = (d, what) => { (d.activity[tid] = d.activity[tid] || []).unshift({ id: uid("a"), who: d.session.userName, what, at: new Date().toISOString() }); };
  return (
    <>
      {!embedded && <PageHeadT k="team" />}
      <TeamPanel members={(db.members[tid] || []).filter((m) => branch === "all" || m.scopes === "all" || m.scopes.includes(branch))} invites={db.invites[tid] || []} roles={db.tenantRoles[tid]} groups={permsForTypes(typesFor(tenant, plan))}
        scopes={{ label: useT()(`scope.${tenant.type}`), options: tenant.scopes }} seats={{ limit: plan.limits.seats, plan: plan.name }}
        canManage={can(role, "team.manage")} activity={db.activity[tid] || []}
        onInvite={(list) => update((d) => { list.forEach((i) => { (d.invites[tid] = d.invites[tid] || []).unshift({ id: uid("i"), ...i, by: d.session.userName, sent: TODAY, expires: `${inDays(7)}T10:00`, status: "pending" }); log(d, `invited ${i.email}`); }); })}
        onUpdateMember={(id, patch) => update((d) => { const m = d.members[tid].find((x) => x.id === id); Object.assign(m, patch); log(d, `updated ${m.name}`); })}
        onRemoveMember={(id) => update((d) => { const m = d.members[tid].find((x) => x.id === id); d.members[tid] = d.members[tid].filter((x) => x.id !== id); log(d, `removed ${m.name}`); })}
        onRestoreMember={(m, at) => update((d) => { const l = d.members[tid] = d.members[tid] || []; if (!l.some((x) => x.id === m.id)) l.splice(at >= 0 ? at : l.length, 0, m); log(d, `restored ${m.name}`); })}
        dataKind="team"
        onResend={(id) => update((d) => { Object.assign(d.invites[tid].find((i) => i.id === id), { status: "pending", sent: TODAY, expires: `${inDays(7)}T10:00` }); })}
        onRevoke={(id) => update((d) => { d.invites[tid].find((i) => i.id === id).status = "revoked"; })}
        {...(live ? { onInvite: live.onInvite, onUpdateMember: live.onUpdateMember, onRemoveMember: live.onRemoveMember, onRestoreMember: live.onRestoreMember, onResend: live.onResend, onRevoke: live.onRevoke } : {})} />
    </>
  );
}

export function BusinessRoles({ tenant, role, embedded }) {
  const { db, update } = useStore();
  const toast = useToast();
  const live = isLive(tenant.id) ? liveTeam(toast) : null;
  const tid = tenant.id;
  const plan = db.plans.find((p) => p.id === tenant.planId);
  const counts = {};
  (db.members[tid] || []).forEach((m) => { counts[m.roleId] = (counts[m.roleId] || 0) + 1; });
  return (
    <>
      {!embedded && <PageHeadT k="roles" />}
      <RoleEditor roles={db.tenantRoles[tid]} groups={permsForTypes(typesFor(tenant, plan))} counts={counts} canManage={can(role, "roles.manage")} customAllowed={plan.features.custom_roles}
        onCreate={(r) => { const id = uid(`${tid}-role`); update((d) => { d.tenantRoles[tid].push({ id, key: id, system: false, ...r }); }); return id; }}
        onSave={(r) => update((d) => { d.tenantRoles[tid][d.tenantRoles[tid].findIndex((x) => x.id === r.id)] = r; })}
        onDelete={(id) => update((d) => { d.tenantRoles[tid] = d.tenantRoles[tid].filter((x) => x.id !== id); })}
        {...(live ? { onCreate: live.onCreateRole, onSave: live.onSaveRole, onDelete: live.onDeleteRole } : {})} />
    </>
  );
}

function PageHeadT({ k }) {
  const t = useT();
  return <PageHead title={t(`${k}.pageTitle`)} sub={t(`${k}.pageSub`)} />;
}

export { Badge };
