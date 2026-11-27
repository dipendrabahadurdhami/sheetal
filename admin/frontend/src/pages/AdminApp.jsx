// The admin panel itself: the menu, the staff bell and every page's route and permission check.
// Where it fits: rendered by App.jsx for every /admin path.
// How it works: the staff role decides the menu; signed in, pages that are on the admin API use their live screens
// and the bell shows staff work from the server; otherwise the sample screens.
// Rules: PREVIEW lists the pages that still show sample data when signed in; remove a path once its page is on the
// server. Each route keeps its permission guard.

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
import { LiveAdminAddons } from "./LiveAddons";
import { Pricing } from "./Pricing";
import { Coupons } from "./Coupons";
import { PlatformApprovals } from "./PlatformApprovals";
import { BusinessSubscriptions } from "./BusinessSubscriptions";
import { BillingV3, Revenue, Sales } from "./SalesRevenue";
import { LegalInfo } from "./LegalInfo";
import { LiveAdminPromote } from "./LivePromote";
import { LiveLeads } from "./LiveLeads";
import { LiveEarnings } from "./LiveEarnings";
import { LiveDashboard } from "./LiveDashboard";
import { AdminCareers, AdminDemand, AdminEarnings, AdminLeads, AdminMessages, AdminRequests, Hub } from "./AdminGrowth";
import { AdminAI, AdminAnalytics, AdminOrders } from "./AdminExtras";
import { MyProfile, NotificationsPage, adminLive, useNotifs, useServerNotifs } from "@sheetal/shared/components/Me";
import { AdminAudit, AdminBilling, AdminContent, AdminInbox, AdminModeration } from "./AdminOps";
import { AdminChannels } from "./AdminChannels";
import { AdminIntegrations } from "./AdminIntegrations";
import { IntegrationCenter } from "./IntegrationCenter";
import { FieldBuilderPage, MoreSettings, RevenuePage, ThemePage } from "./SettingsStore";
import { AdminStatus } from "./AdminStatus";
import { otaOf } from "@sheetal/shared/data/ota";
import { config } from "@sheetal/shared/core/config";
import { isStaffLive, useLiveStaff, useReviewQueue } from "../live";
import { adminApi } from "../api";
import { LiveAnalytics, LiveOutbox, LiveSetup, LiveStatus } from "./LiveSetup";
import { AdminEmail } from "./AdminEmail";
import { LivePlatformSettings } from "./LivePlatformSettings";
import { LiveChannels, useOtaWaiting } from "./LiveChannels";
import { LiveAiFeatures } from "./LiveAiFeatures";
import { LiveExpiry, LiveTemplates } from "./LiveMessages";

const PREVIEW = ["/admin/voice", "/admin/social"];

export default function AdminApp() {
  const t = useT();
  const { db, update, reset } = useStore();
  const role = db.platformRoles.find((r) => r.id === db.session.platformRoleId) || db.platformRoles[0];
  useLiveStaff(); // the real staff role when signed in (../live.js)
  const liveQueue = useReviewQueue(isStaffLive() && can(role, "platform.listing.moderate"));
  const queue = isStaffLive() && can(role, "platform.listing.moderate") ? liveQueue : null;
  const otaWaiting = useOtaWaiting(isStaffLive() && can(role, "platform.business.read")); // requests waiting for the channel team
  const pending = db.tenants.filter((x) => x.status === "pending_verification").length + (queue ? queue.waiting : 0);

  const nav = filterNav([
    { items: [{ to: "/admin", exact: true, icon: "layout-grid", key: "nav.dashboard", perm: "platform.dashboard.read" }, { to: "/admin/analytics", icon: "chart-column", key: "nav.traffic", perm: "platform.dashboard.read" }] },
    // The menu in five short groups; pages set once or used rarely fold under "More" (they open by themselves when visited).
    { group: "group.businesses", items: [
      { to: "/admin/tenants", icon: "building-2", key: "nav.tenants", perm: "platform.business.read" },
      { to: "/admin/moderation", icon: "shield-check", key: "nav.moderation", permAny: ["platform.listing.moderate", "platform.verification.review"], count: pending, countTone: "action" },
      { to: "/admin/inbox", icon: "messages-square", key: "nav.inbox", perm: "platform.business.read" },
    ] },
    { group: "group.money", items: [
      ...(isStaffLive() ? [{ to: "/admin/pricing", icon: "tag", key: "nav.pricingPacks", perm: "platform.billing.read" }] : []),
      { to: "/admin/billing", icon: "receipt", key: "nav.billing", perm: "platform.billing.read" },
      ...(isStaffLive() ? [
        { to: "/admin/billing-apps", icon: "landmark", key: "nav.appBilling", perm: "platform.billing.read" },
        { to: "/admin/coupons", icon: "ticket", key: "nav.coupons", perm: "platform.billing.read" },
        { to: "/admin/approvals", icon: "shield-check", key: "nav.approvals", permAny: ["platform.pricing.manage", "platform.billing.refund"] },
      ] : []),
      { to: "/admin/promote", icon: "trending-up", key: "nav.promote", perm: "platform.billing.read" },
    ] },
    { group: "group.website", items: [
      { to: "/admin/content", icon: "newspaper", key: "nav.content", perm: "platform.content.update" },
      { to: "/admin/catalog", icon: "list-checks", key: "nav.catalog", perm: "platform.content.update" },
    ] },
    { group: "group.system", items: [
      { to: "/admin/integrations", icon: "plug", key: "nav.setup", perm: "platform.settings.read+platform.settings.update" },
      { to: "/admin/email", icon: "mail", key: "nav.email", perm: "platform.settings.read+platform.settings.update" },
      { to: "/admin/staff", icon: "user-round-cog", key: "nav.staff", perm: "platform.staff.read" },
      { to: "/admin/settings", icon: "settings", key: "nav.settings", perm: "platform.settings.read+platform.settings.update" },
    ] },
    { group: "group.more", fold: true, items: [
      { to: "/admin/plans", icon: "layers", key: "nav.oldPlans", perm: "platform.plan.read+platform.plan.create+platform.plan.update+platform.plan.delete" },
      { to: "/admin/addons", icon: "puzzle", key: "nav.addons", perm: "platform.plan.read+platform.plan.create+platform.plan.update+platform.plan.delete" },
      ...(isStaffLive() ? [
        { to: "/admin/sales", icon: "receipt", key: "nav.appSales", perm: "platform.revenue.read" },
        { to: "/admin/revenue", icon: "chart-column", key: "nav.appRevenue", perm: "platform.revenue.read" },
        { to: "/admin/legal", icon: "file-text", key: "nav.legal", perm: "platform.settings.read" },
      ] : []),
      { to: "/business/mail", icon: "inbox", key: "nav.mailbox", perm: "platform.settings.read+platform.settings.update" },
      { to: "/admin/channels", icon: "network", key: "nav.channels", perm: "platform.business.read", count: (isStaffLive() ? otaWaiting : otaOf(db).requests.filter((r) => r.status === "requested").length) || undefined, countTone: "action" },
      { to: "/admin/ai", icon: "sparkles", key: "nav.aiAdmin", perm: "platform.settings.read+platform.settings.update" },
      { to: "/admin/status", icon: "radar", key: "nav.status", perm: "platform.settings.read+platform.settings.update" },
      { to: "/admin/audit", icon: "scroll-text", key: "nav.audit", perm: "platform.audit.read" },
    ] },
  ], role);


  const inboxHub = (start) => <Hub key={"inbox-" + (start || "")} start={start} title={t("nav.inbox")} sub={t("hub.inboxSub")} tabs={[
    { id: "inbox", label: t("hub.support"), icon: "messages-square", el: <AdminInbox /> },
    { id: "leads", label: t("gl.master"), icon: "users", el: isStaffLive() ? <LiveLeads /> : <AdminLeads /> },
    { id: "demand", label: t("nav.demand"), icon: "clipboard-list", el: <AdminDemand /> },
    { id: "requests", label: t("nav.requests"), icon: "calendar-check", el: <AdminRequests /> },
  ]} />;
  const contentHub = (start) => <Hub key={"content-" + (start || "")} start={start} title={t("nav.content")} sub={t("hub.contentSub")} tabs={[
    { id: "site", label: t("hub.pages"), icon: "newspaper", el: <AdminContent /> },
    { id: "careers", label: t("nav.careers"), icon: "briefcase", el: <AdminCareers /> },
  ]} />;
  const billingHub = (start) => <Hub key={"billing-" + (start || "")} start={start} title={t("nav.billing")} sub={t("hub.billingSub")} tabs={[
    { id: "billing", label: t("nav.billing"), icon: "receipt", el: <AdminBilling role={role} /> },
    // Sample orders only: not shown to signed-in staff (app refunds are in App billing; a real orders list is not built).
    ...(isStaffLive() ? [] : [{ id: "orders", label: "Orders, refunds and claims", icon: "rotate-ccw", el: <AdminOrders /> }]),
    { id: "earnings", label: t("nav.earnings"), icon: "hand-coins", el: isStaffLive() ? <LiveEarnings /> : <AdminEarnings /> },
  ]} />;
  const analyticsHub = (start) => <Hub key={"analytics-" + (start || "")} start={start} title={t("nav.traffic")} sub={t("an.trafficSub")} tabs={[
    { id: "traffic", label: t("an.traffic"), icon: "chart-column", el: isStaffLive() ? <LiveAnalytics /> : <AdminAnalytics /> },
    // "Live visitors" is a sample list (invented numbers): not shown to signed-in staff.
    ...(isStaffLive() ? [] : [{ id: "live", label: t("gm.live"), icon: "radio", el: <AdminMessages only="live" /> }]),
  ]} />;
  const aiHub = (start) => <Hub key={"ai-" + (start || "")} start={start} title={t("hub.aiTitle")} sub={t("hub.aiSub")} tabs={[
    { id: "ai", label: t("ai.featuresTitle"), icon: "sparkles", el: isStaffLive() ? <LiveAiFeatures embedded /> : <AdminAI embedded /> },
    { id: "templates", label: t("gm.templates"), icon: "file-text", el: isStaffLive() ? <LiveTemplates /> : <AdminMessages only="templates" /> },
    { id: "expiry", label: t("gm.expiry"), icon: "calendar-x", el: isStaffLive() ? <LiveExpiry /> : <AdminMessages only="expiry" /> },
  ]} />;
  const guard = (perm, el) => (perm === true || (Array.isArray(perm) ? canAny(role, perm) : can(role, perm)) ? el : <NoAccess />);

  // Signed in as staff: the bell comes from the server (work waiting for Sheetal's team); otherwise the sample's.
  const sampleNotifs = useNotifs("admin", adminLive(db));
  const serverNotifs = useServerNotifs(adminApi, "/admin/notifications", isStaffLive());
  const notifs = isStaffLive() ? serverNotifs : sampleNotifs;
  return (
    <Shell sub={t("brand.admin")} nav={nav} preview={isStaffLive() ? PREVIEW : []} notifications={notifs.list.slice(0, 6).map((n) => ({ ...n, onOpen: () => notifs.read(n.id) }))} notifTo="/admin/notifications" onReadAll={notifs.readAll}
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
        { path: "/admin", render: () => guard("platform.dashboard.read", isStaffLive() ? <LiveDashboard /> : <AdminDashboard />) },
        { path: "/admin/tenants", render: () => guard("platform.business.read", <AdminTenants />) },
        { path: "/admin/tenants/:id", render: ({ id }) => guard("platform.business.read", <TenantDetail id={id} role={role} />) },
        { path: "/admin/tenants/:id/subscriptions", render: ({ id }) => guard("platform.business.read", <BusinessSubscriptions key={id} id={id} />) },
        { path: "/admin/pricing", render: () => guard("platform.billing.read", <Pricing />) },
        { path: "/admin/sales", render: () => guard("platform.revenue.read", <Sales />) },
        { path: "/admin/revenue", render: () => guard("platform.revenue.read", <Revenue />) },
        { path: "/admin/billing-apps", render: () => guard("platform.billing.read", <BillingV3 />) },
        { path: "/admin/legal", render: () => guard("platform.settings.read", <LegalInfo />) },
        { path: "/admin/coupons", render: () => guard("platform.billing.read", <Coupons />) },
        { path: "/admin/approvals", render: () => guard(["platform.pricing.manage", "platform.billing.refund"], <PlatformApprovals />) },
        { path: "/admin/plans", render: () => guard("platform.plan.read+platform.plan.create+platform.plan.update+platform.plan.delete", <AdminPlans />) },
        { path: "/admin/catalog", render: () => guard("platform.content.update", <AdminCatalog />) },
        { path: "/admin/ai", render: () => guard("platform.settings.read+platform.settings.update", aiHub()) },
        { path: "/admin/voice", render: () => guard("platform.settings.read+platform.settings.update", aiHub("voice")) },
        { path: "/admin/messages", render: () => guard("platform.settings.read+platform.settings.update", aiHub("templates")) },
        { path: "/admin/leads", render: () => guard("platform.business.read", inboxHub("leads")) },
        { path: "/admin/demand", render: () => guard("platform.business.read", inboxHub("demand")) },
        { path: "/admin/requests", render: () => guard("platform.business.read", inboxHub("requests")) },
        { path: "/admin/social", render: () => guard("platform.content.update", contentHub("social")) },
        { path: "/admin/careers", render: () => guard("platform.content.update", contentHub("careers")) },
        { path: "/admin/earnings", render: () => guard("platform.billing.read", billingHub("earnings")) },
        { path: "/admin/channels", render: () => guard("platform.business.read", isStaffLive() ? <LiveChannels canWork={can(role, "platform.business.read+platform.business.create+platform.business.update")} canSettings={can(role, "platform.settings.read+platform.settings.update")} /> : <AdminChannels />) },
        { path: "/admin/analytics", render: () => guard("platform.dashboard.read", analyticsHub()) },
        { path: "/admin/addons", render: () => guard("platform.plan.read+platform.plan.create+platform.plan.update+platform.plan.delete", isStaffLive() ? <LiveAdminAddons /> : <AdminAddons />) },
        { path: "/admin/promote", render: () => guard("platform.billing.read", isStaffLive() ? <LiveAdminPromote /> : <div className="pf-pad muted">Sign in as Sheetal staff to manage boosts and banners.</div>) },
        { path: "/admin/moderation", render: () => guard(["platform.listing.moderate", "platform.verification.review"], <AdminModeration role={role} queue={queue} />) },
        { path: "/admin/content", render: () => guard("platform.content.update", contentHub()) },
        { path: "/admin/billing", render: () => guard("platform.billing.read", billingHub()) },
        { path: "/admin/audit", render: () => guard("platform.audit.read", <AdminAudit />) },
        { path: "/admin/inbox", render: () => guard("platform.business.read", inboxHub()) },
        { path: "/admin/staff", render: () => guard("platform.staff.read", <AdminStaff role={role} />) },
        { path: "/admin/settings", render: () => guard("platform.settings.read+platform.settings.update", isStaffLive() ? <><LivePlatformSettings /><MoreSettings /></> : <AdminSettings />) },
        // Stage 1.4: screens on the typed settings store (signed in to the admin API only).
        { path: "/admin/settings/fields", render: () => guard("platform.settings.read+platform.settings.update", isStaffLive() ? <FieldBuilderPage /> : <AdminSettings />) },
        { path: "/admin/settings/theme", render: () => guard("platform.settings.read+platform.settings.update", isStaffLive() ? <ThemePage /> : <AdminSettings />) },
        { path: "/admin/settings/revenue", render: () => guard("platform.settings.read+platform.settings.update", isStaffLive() ? <RevenuePage /> : <AdminSettings />) },
        { path: "/admin/email", render: () => guard("platform.settings.read+platform.settings.update", isStaffLive() ? <AdminEmail /> : <section className="card pf-panel"><p className="muted">Sign in to the live admin to see email health.</p></section>) },
        { path: "/admin/status", render: () => guard("platform.settings.read+platform.settings.update", isStaffLive() ? <><LiveStatus /><LiveOutbox /></> : <AdminStatus />) },
        // Signed in to the admin API: the Integration Center (stage 1.3). Not signed in: the old sample screen. LiveSetup keeps the AI and Meta key forms
        // until those connections are built in the Center.
        { path: "/admin/integrations", render: () => guard("platform.settings.read+platform.settings.update", isStaffLive() ? <><IntegrationCenter /><LiveSetup /></> : <AdminIntegrations />) },
        { path: "/admin/integrations/:id", render: ({ id }) => guard("platform.settings.read+platform.settings.update", isStaffLive() ? <IntegrationCenter key={id} id={id} /> : <AdminIntegrations key={id} id={id} />) },
        { path: "/admin/me", render: () => <MyProfile scope="admin" roleLabel={roleName(role, t)} access="Sheetal staff" /> },
        { path: "/admin/notifications", render: () => <NotificationsPage notifs={notifs} prefsTo="/admin/me" /> },
      ]} />
    </Shell>
  );
}
