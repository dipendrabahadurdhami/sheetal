// The Team and Roles hubs (the Overview is LiveOverview.jsx).
// How it works: Members is the Workspace app's TeamPage and Roles its RolesPage (via LiveRoles), both in apps/workspace/frontend (P2-W6), on the
// business API; Attendance is the People app's page; Structure draws the business's chart.

import { liveRefresh } from "../live";
import { TeamPage } from "@sheetal/app-workspace/frontend";
import React from "react";
import { useT } from "@sheetal/shared/core/i18n";
import { useStore } from "@sheetal/shared/core/store";
import { can, permsForTypes } from "@sheetal/shared/core/rbac";
import { typesFor } from "@sheetal/shared/core/plans";
import { PageHead, Tabs } from "@sheetal/shared/core/ui";
import { LivePeople } from "./LivePeople";
import { Structure } from "./Structure";
import { LiveRoles } from "./LiveRoles";

export function TeamHub({ tenant, role, start = "members" }) {
  const t = useT();
  const [tab, setTab] = React.useState(start);
  const tabs = [
    can(role, "workspace.team.read") && { id: "members", label: t("team.members"), icon: "users" },
    can(role, "workspace.team.read") && { id: "structure", label: t("org.tab"), icon: "network" },
    { id: "attendance", label: t("hr.tabAttendance"), icon: "map-pin" },
    can(role, "workspace.role.read+workspace.role.create+workspace.role.update+workspace.role.delete") && { id: "roles", label: t("nav.roles"), icon: "key-round" },
  ].filter(Boolean);
  return (
    <>
      <PageHead title={t("team.pageTitle")} sub={t("team.hubSub")} />
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === "members" && <BusinessTeam tenant={tenant} role={role} embedded />}
      {tab === "structure" && <Structure tenant={tenant} />}
      {tab === "attendance" && <LivePeople tenant={tenant} embedded />}
      {tab === "roles" && <BusinessRoles tenant={tenant} role={role} embedded />}
    </>
  );
}

export function BusinessTeam({ tenant, role, embedded }) { return <LiveTeam tenant={tenant} role={role} embedded={embedded} />; }

function LiveTeam({ tenant, role, embedded }) {
  const { db } = useStore();
  const plan = db.plans.find((p) => p.id === tenant.planId);
  return (
    <>
      {!embedded && <PageHeadT k="team" />}
      <TeamPage tenant={tenant} groups={permsForTypes(typesFor(tenant, plan))} planName={plan?.name} onChanged={liveRefresh}
        canManage={can(role, "workspace.team.read+workspace.team.invite+workspace.team.update+workspace.team.remove")} />
    </>
  );
}

export function BusinessRoles({ tenant, role, embedded }) {
  const { db } = useStore();
  const plan = db.plans.find((p) => p.id === tenant.planId);
  return <>{!embedded && <PageHeadT k="roles" />}<LiveRoles key={tenant.id} tenant={tenant} canManage={can(role, "workspace.role.read+workspace.role.create+workspace.role.update+workspace.role.delete")} customAllowed={plan?.features.custom_roles} /></>;
}

function PageHeadT({ k }) {
  const t = useT();
  return <PageHead title={t(`${k}.pageTitle`)} sub={t(`${k}.pageSub`)} />;
}


