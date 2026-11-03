import React from "react";
import { useT } from "@sheetal/shared/core/i18n";
import { useStore } from "@sheetal/shared/core/store";
import { Routes } from "@sheetal/shared/core/router";
import { can, canAny, filterNav, roleName } from "@sheetal/shared/core/rbac";
import { Select } from "@sheetal/shared/core/ui";
import { MenuButton, MenuLink, MenuSep, NoAccess, Pending, Shell } from "@sheetal/shared/layout/Shell";
import { AdminDashboard, AdminTenants } from "./AdminDashboard";
import { AdminPlans, TenantDetail } from "./AdminTenants";
import { AdminSettings, AdminStaff } from "./AdminSystem";
import { AdminCatalog } from "./AdminListingSetup";
import { AdminAddons } from "@sheetal/shared/components/Addons";
import { AdminCareers, AdminDemand, AdminEarnings, AdminLeads, AdminMessages, AdminRequests, AdminSocial, AdminVoice, Hub } from "./AdminGrowth";
import { AdminAds, AdminAI, AdminAnalytics, AdminOrders } from "./AdminExtras";
import { MyProfile, NotificationsPage, adminLive, useNotifs } from "@sheetal/shared/components/Me";
import { AdminAudit, AdminBilling, AdminContent, AdminInbox, AdminModeration } from "./AdminOps";
import { AdminChannels } from "./AdminChannels";
import { AdminIntegrations } from "./AdminIntegrations";
import { AdminStatus } from "./AdminStatus";
import { otaOf } from "@sheetal/shared/data/ota";
import { config } from "@sheetal/shared/core/config";
import { isStaffLive, useLiveStaff, useReviewQueue } from "../live";
import { LiveAnalytics, LiveSetup, LiveStatus } from "./LiveSetup";

// Super admin: Sheetal staff control panel at /admin.
export default function AdminApp() {
  const t = useT();
  const { db, update, reset } = useStore();
  const role = db.platformRoles.find((r) => r.id === db.session.platformRoleId) || db.platformRoles[0];
  useLiveStaff(); // the real staff role when signed in (../live.js)
  const liveQueue = useReviewQueue(isStaffLive() && can(role, "moderation.listings"));
  const queue = isStaffLive() && can(role, "moderation.listings") ? liveQueue : null;
  const pending = db.tenants.filter((x) => x.status === "pending_verification").length + (queue ? queue.waiting : 0);

  const nav = filterNav([
    { items: [{ to: "/admin", exact: true, icon: "layout-grid", key: "nav.dashboard", perm: "dashboard.view" }, { to: "/admin/analytics", icon: "chart-column", key: "nav.traffic", perm: "dashboard.view" }] },
    { group: "group.businesses", items: [
      { to: "/admin/tenants", icon: "building-2", key: "nav.tenants", perm: "tenants.view" },
      { to: "/admin/plans", icon: "layers", key: "nav.plans", perm: "plans.manage" },
      { to: "/admin/addons", icon: "puzzle", key: "nav.addons", perm: "plans.manage" },
      { to: "/admin/billing", icon: "receipt", key: "nav.billing", perm: "billing.view" },
    ] },
    { group: "group.marketplace", items: [
      { to: "/admin/moderation", icon: "shield-check", key: "nav.moderation", permAny: ["moderation.listings", "moderation.kyc"], count: pending, countTone: "action" },
      { to: "/admin/catalog", icon: "list-checks", key: "nav.catalog", perm: "content.edit" },
      { to: "/admin/content", icon: "newspaper", key: "nav.content", perm: "content.edit" },
      { to: "/admin/ads", icon: "rocket", key: "nav.ads", perm: "content.edit" },
    ] },
    { group: "group.leads", items: [
      { to: "/admin/inbox", icon: "messages-square", key: "nav.inbox", perm: "tenants.view" },
    ] },
    { group: "group.connections", items: [
      { to: "/admin/integrations", icon: "plug", key: "nav.setup", perm: "settings.platform" },
      { to: "/admin/channels", icon: "network", key: "nav.channels", perm: "tenants.view", count: otaOf(db).requests.filter((r) => r.status === "requested").length || undefined, countTone: "action" },
      { to: "/admin/ai", icon: "sparkles", key: "nav.aiAdmin", perm: "settings.platform" },
    ] },
    { group: "group.system", items: [
      { to: "/admin/status", icon: "radar", key: "nav.status", perm: "settings.platform" },
      { to: "/admin/staff", icon: "user-round-cog", key: "nav.staff", perm: "staff.view" },
      { to: "/admin/settings", icon: "settings", key: "nav.settings", perm: "settings.platform" },
      { to: "/admin/audit", icon: "scroll-text", key: "nav.audit", perm: "audit.view" },
    ] },
  ], role);


  const inboxHub = (start) => <Hub key={"inbox-" + (start || "")} start={start} title={t("nav.inbox")} sub={t("hub.inboxSub")} tabs={[
    { id: "inbox", label: t("hub.support"), icon: "messages-square", el: <AdminInbox /> },
    { id: "leads", label: t("gl.master"), icon: "users", el: <AdminLeads /> },
    { id: "demand", label: t("nav.demand"), icon: "clipboard-list", el: <AdminDemand /> },
    { id: "requests", label: t("nav.requests"), icon: "calendar-check", el: <AdminRequests /> },
  ]} />;
  const contentHub = (start) => <Hub key={"content-" + (start || "")} start={start} title={t("nav.content")} sub={t("hub.contentSub")} tabs={[
    { id: "site", label: t("hub.pages"), icon: "newspaper", el: <AdminContent /> },
    { id: "social", label: t("nav.social"), icon: "megaphone", el: <AdminSocial /> },
    { id: "careers", label: t("nav.careers"), icon: "briefcase", el: <AdminCareers /> },
  ]} />;
  const billingHub = (start) => <Hub key={"billing-" + (start || "")} start={start} title={t("nav.billing")} sub={t("hub.billingSub")} tabs={[
    { id: "billing", label: t("nav.billing"), icon: "receipt", el: <AdminBilling role={role} /> },
    { id: "orders", label: "Orders, refunds and claims", icon: "rotate-ccw", el: <AdminOrders /> },
    { id: "earnings", label: t("nav.earnings"), icon: "hand-coins", el: <AdminEarnings /> },
  ]} />;
  const analyticsHub = (start) => <Hub key={"analytics-" + (start || "")} start={start} title={t("nav.traffic")} sub={t("an.trafficSub")} tabs={[
    { id: "traffic", label: t("an.traffic"), icon: "chart-column", el: isStaffLive() ? <LiveAnalytics /> : <AdminAnalytics /> },
    { id: "live", label: t("gm.live"), icon: "radio", el: <AdminMessages only="live" /> },
  ]} />;
  const aiHub = (start) => <Hub key={"ai-" + (start || "")} start={start} title={t("hub.aiTitle")} sub={t("hub.aiSub")} tabs={[
    { id: "ai", label: t("ai.featuresTitle"), icon: "sparkles", el: <AdminAI embedded /> },
    { id: "voice", label: t("nav.voice"), icon: "phone-call", el: <AdminVoice /> },
    { id: "templates", label: t("gm.templates"), icon: "file-text", el: <AdminMessages only="templates" /> },
    { id: "expiry", label: t("gm.expiry"), icon: "calendar-x", el: <AdminMessages only="expiry" /> },
  ]} />;
  const guard = (perm, el) => (perm === true || (Array.isArray(perm) ? canAny(role, perm) : can(role, perm)) ? el : <NoAccess />);

  const notifs = useNotifs("admin", adminLive(db));
  return (
    <Shell sub={t("brand.admin")} nav={nav} notifications={notifs.list.slice(0, 6).map((n) => ({ ...n, onOpen: () => notifs.read(n.id) }))} notifTo="/admin/notifications" onReadAll={notifs.readAll}
      quickCreate={[{ icon: "building-2", label: t("tenants.add"), to: "/admin/tenants" }, { icon: "layers", label: t("plans.new"), to: "/admin/plans" }, { icon: "user-plus", label: t("team.invite"), to: "/admin/staff" }, { icon: "newspaper", label: t("content.newPost"), to: "/admin/content" }]}
      records={db.tenants.map((x) => ({ icon: "building-2", label: x.name, sub: `${x.city} · ${x.owner}`, to: `/admin/tenants/${x.id}` }))}
      topLeft={<div className="pf-top-title"><b>{t("brand.adminTitle")}</b><span className="small muted">{db.platformSettings.mainDomain}{db.platformSettings.adminPath}</span></div>}
      sideFooter={config.demo && <div className="pf-side-foot"><span className="small muted">{t("preview.signedInAs")}</span>
        <Select value={role.id} onChange={(v) => update((d) => { d.session.platformRoleId = v; })} options={db.platformRoles.map((r) => ({ id: r.id, label: roleName(r, t) }))} aria-label={t("preview.role")} />
        <span className="tiny muted">{t("preview.roleHint")}</span></div>}
      userMenu={<>
        <MenuLink to="/admin/me" icon="user">My profile</MenuLink>
        <MenuLink to="/admin/notifications" icon="bell">Notifications{notifs.unread ? ` (${notifs.unread})` : ""}</MenuLink>
        <MenuSep />
        <MenuLink to="/business" icon="store">{t("menu.business")}</MenuLink>
        <MenuLink to="/" icon="layout-grid">{t("menu.home")}</MenuLink>
        <MenuSep />
        {config.demo && <MenuButton icon="rotate-ccw" onClick={reset}>{t("psettings.resetDemo")}</MenuButton>}
        <MenuButton icon="log-out" onClick={() => { try { localStorage.removeItem("sheetal_token"); } catch { /* storage off */ } window.location.href = "/"; }}>{t("menu.signOut")}</MenuButton>
      </>}>
      <Routes fallback={<Pending part={3} />} routes={[
        { path: "/admin", render: () => guard("dashboard.view", <AdminDashboard />) },
        { path: "/admin/tenants", render: () => guard("tenants.view", <AdminTenants />) },
        { path: "/admin/tenants/:id", render: ({ id }) => guard("tenants.view", <TenantDetail id={id} role={role} />) },
        { path: "/admin/plans", render: () => guard("plans.manage", <AdminPlans />) },
        { path: "/admin/catalog", render: () => guard("content.edit", <AdminCatalog />) },
        { path: "/admin/ai", render: () => guard("settings.platform", aiHub()) },
        { path: "/admin/voice", render: () => guard("settings.platform", aiHub("voice")) },
        { path: "/admin/messages", render: () => guard("settings.platform", aiHub("templates")) },
        { path: "/admin/leads", render: () => guard("tenants.view", inboxHub("leads")) },
        { path: "/admin/demand", render: () => guard("tenants.view", inboxHub("demand")) },
        { path: "/admin/requests", render: () => guard("tenants.view", inboxHub("requests")) },
        { path: "/admin/social", render: () => guard("content.edit", contentHub("social")) },
        { path: "/admin/careers", render: () => guard("content.edit", contentHub("careers")) },
        { path: "/admin/earnings", render: () => guard("billing.view", billingHub("earnings")) },
        { path: "/admin/ads", render: () => guard("content.edit", <AdminAds />) },
        { path: "/admin/channels", render: () => guard("tenants.view", <AdminChannels />) },
        { path: "/admin/analytics", render: () => guard("dashboard.view", analyticsHub()) },
        { path: "/admin/addons", render: () => guard("plans.manage", <AdminAddons />) },
        { path: "/admin/moderation", render: () => guard(["moderation.listings", "moderation.kyc"], <AdminModeration role={role} queue={queue} />) },
        { path: "/admin/content", render: () => guard("content.edit", contentHub()) },
        { path: "/admin/billing", render: () => guard("billing.view", billingHub()) },
        { path: "/admin/audit", render: () => guard("audit.view", <AdminAudit />) },
        { path: "/admin/inbox", render: () => guard("tenants.view", inboxHub()) },
        { path: "/admin/staff", render: () => guard("staff.view", <AdminStaff role={role} />) },
        { path: "/admin/settings", render: () => guard("settings.platform", <AdminSettings />) },
        { path: "/admin/status", render: () => guard("settings.platform", isStaffLive() ? <LiveStatus /> : <AdminStatus />) },
        { path: "/admin/integrations", render: () => guard("settings.platform", <>{isStaffLive() && <LiveSetup />}<AdminIntegrations /></>) },
        { path: "/admin/integrations/:id", render: ({ id }) => guard("settings.platform", <AdminIntegrations key={id} id={id} />) },
        { path: "/admin/me", render: () => <MyProfile scope="admin" roleLabel={roleName(role, t)} access="Sheetal staff" /> },
        { path: "/admin/notifications", render: () => <NotificationsPage notifs={notifs} prefsTo="/admin/me" /> },
      ]} />
    </Shell>
  );
}
