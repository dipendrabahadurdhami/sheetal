// The business panel itself: the menu, the top bar, the switchers and every page's route and permission check.
// Where it fits: rendered by App.jsx for every /business path.
// How it works: BusinessApp loads the person's businesses (live.js) and shows a sign-in page (with "Try the demo"), a loading page, an "add your
// first business" page or an error until they are ready; then Workspace picks the open business, the person's role and branch access; builds the
// menu for the business type, plan and role; sends the picked branch with every API call; and routes each path to its screen on the server.
// Rules: there is no browser-storage sample workspace any more (P2-W6): every page works on the business API. PREVIEW lists the pages that are not
// built yet (shown as previews). Each route keeps its permission guard.

import { inkFor, btnInkFor } from "@sheetal/shared/core/contrast";
import { SetupChip } from "./Setup";
import React from "react";
import { PANEL_THEMES, THEMES } from "@sheetal/shared/core/theme";
import { BranchPicker } from "@sheetal/shared/layout/BranchPicker";
import { WorkspaceSwitcher } from "@sheetal/shared/layout/WorkspaceSwitcher";
import { useT } from "@sheetal/shared/core/i18n";
import { useStore } from "@sheetal/shared/core/store";
import { Link, Routes, useRouter } from "@sheetal/shared/core/router";
import { can, canAny, filterNav, roleName } from "@sheetal/shared/core/rbac";
import { manifestNavItem } from "@sheetal/config/menu";
import { Button, Empty, Select, Tabs } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { MenuButton, MenuLink, MenuSep, NoAccess, Pending, Shell } from "@sheetal/shared/layout/Shell";
import { BusinessRoles, TeamHub } from "./BusinessPages";
import { LiveOverview } from "./LiveOverview";
import { ListingWizard } from "./ListingWizard";
import { ListingsPage } from "./ListingsManager";
import { BusinessSettings, defaultTenantSettings } from "./BusinessSettings";
import { SettingsShell, settingsSections } from "./SettingsHub";
import { config } from "@sheetal/shared/core/config";
import { BusinessBilling, BusinessData } from "./BusinessBilling";
import { BillingReturn } from "./LiveBilling";
import { Marketplace } from "./Marketplace";
import { CartPage } from "./Cart";
import { Subscriptions } from "./Subscriptions";
import { useBillingMode, useBusinessEntitlements } from "../billingMode";
import { appOfPath, BillingPrompts, ReadOnlyBanner } from "@sheetal/ui/billing";
import { APPS as APP_MANIFESTS } from "@sheetal/config/apps";
import { Help, Tour } from "./Help";
import { GettingStarted } from "./GettingStarted";
import { MyProfile, NotificationsPage, useServerNotifs } from "@sheetal/shared/components/Me";
import { Domains } from "./Domains";
import { Mail } from "./Mail";
import { canAddBusiness, isLive, useBrand, useLiveWorkspace, useWorkspaceState, workRefresh, workspacesReload } from "../live";
import { useLiveSettings } from "../liveSettings";
import { bizApi, bizApiReady, setActiveBranch, signedIn } from "../api";
import { AddBusiness } from "./AddBusiness";
import { LiveBookings, LiveFrontDesk, LiveInvestors, LivePOS, LiveProjects, LiveCalendar } from "./LiveOps";
import { LiveAnalytics, LiveChannels } from "./LiveGrowth";
import { ReviewsPage } from "@sheetal/app-reviews/frontend";
import { AppSettingsPage } from "@sheetal/app-workspace/frontend";
import { Verification } from "./Verification";
import { Jobs } from "./Jobs";
import { Inbox } from "./Inbox";
import { Approvals } from "./Approvals";
import { SupportBanner } from "./SupportBanner";
import { DemoBar, TryDemo } from "./TryDemo";
import { LiveForms } from "./LiveForms";
import { LiveAgreements } from "./LiveAgreements";
import { LiveInvoices, LivePayouts } from "./LiveMoney";
import { ExpensesPage } from "@sheetal/app-expenses/frontend";
import { LiveStock } from "./LiveStock";
import { LiveDevelopers } from "./LiveDevelopers";
import { LiveAiAccounts } from "./LiveAiAccounts";
import { AiPlan } from "./AiPlan";
import { LiveRentals } from "./LiveRentals";
import { BackupOnly } from "./BusinessBilling";
import { LiveBranches, branchesOf } from "./Branches";
import { LivePromote } from "./LivePromote";
import { BranchProvider } from "@sheetal/shared/core/branch";
import { isFree, listingCap, planOf, typesFor } from "@sheetal/shared/core/plans";
import { UpgradeNeeded } from "./planBits";
import { Social, VoiceAssistant } from "./Connections";
import { ListingCheckups } from "./ListingCheckups";
import { checkupsOf, todaysList } from "@sheetal/shared/data/checkups";
import { TODAY } from "@sheetal/shared/core/format";
import { opsOf } from "@sheetal/shared/demo/ops";

const PREVIEW = [
  "/business/social", "/business/voice",
];

const TYPE_ICON = { hotel: "hotel", host: "bed-double", developer: "building-2", agency: "briefcase", sponsor: "hand-coins" };

export default function BusinessApp() {
  const { db } = useStore();
  useLiveWorkspace(); // the person's businesses, role and team (../live.js)
  useLiveSettings(); // settings, check-ups, listing options and import/export on the server (../liveSettings.js)
  const state = useWorkspaceState();
  const open = db.tenants.find((x) => x.id === db.session.tenantId);
  if (!bizApiReady() || !signedIn() || state === "signed-out") return <SignedOut />;
  if (state === "empty") return <FirstBusiness />;
  if (state === "error") return <Gatepage icon="circle-alert" title="Your business couldn't load" action={<Button onClick={workspacesReload}>Try again</Button>}>Check your internet connection, then try again.</Gatepage>;
  if (state !== "ready" || !open || !isLive(open.id)) return <div className="pf-root-loading"><div className="sk" style={{ height: "60vh", margin: 24, borderRadius: "var(--r)" }} /></div>;
  return <Workspace />;
}

/** A page on its own (no menu), for signing in, a first business or an error. */
function Gatepage({ icon, title, children, action }) {
  return (
    <main className="pf-gate" style={{ maxWidth: 560, margin: "10vh auto", padding: 16 }}>
      <section className="card pf-panel"><Empty icon={icon} title={title} action={action}>{children}</Empty></section>
    </main>
  );
}

/** Nobody is signed in: sign in on the website, or try a demo business (TryDemo.jsx). */
function SignedOut() {
  return (
    <main className="pf-gate" style={{ maxWidth: 640, margin: "8vh auto", padding: 16 }}>
      <section className="card pf-panel" style={{ marginBottom: 16 }}>
        <Empty icon="log-in" title="Sign in to your business" action={<a className="btn btn-primary" href="/">Sign in on the website</a>}>Your business panel uses your Sheetal Property account.</Empty>
      </section>
      {bizApiReady() && <TryDemo page="Sheetal Business" />}
    </main>
  );
}

/** Signed in, but not in any business yet: add one (or accept an invitation from the email). */
function FirstBusiness() {
  const [adding, setAdding] = React.useState(false);
  return (
    <>
      <Gatepage icon="building-2" title="Add your business" action={<Button icon="plus" onClick={() => setAdding(true)}>Add a business</Button>}>
        You are not in a business yet. Add yours, or open the invitation email your team sent you.
      </Gatepage>
      <AddBusiness open={adding} onClose={() => setAdding(false)} onAdded={() => workspacesReload()} />
    </>
  );
}

function Workspace() {
  const t = useT();
  const { db, update } = useStore();
  const { navigate } = useRouter();
  const [adding, setAdding] = React.useState(false);
  const s = db.session;
  // Sheetal staff support sessions end on their own after 30 minutes.
  React.useEffect(() => {
    if (!s.impersonating || !s.impersonatingUntil) return;
    const end = () => update((d) => { d.session.impersonating = null; d.session.impersonatingUntil = null; d.session.tenantId = d.session.memberships[0]; });
    const ms = s.impersonatingUntil - Date.now();
    if (ms <= 0) { end(); return; }
    const tm = setTimeout(end, ms);
    return () => clearTimeout(tm);
  }, [s.impersonating, s.impersonatingUntil]);
  const ids = [...new Set([...s.memberships, ...(s.impersonating ? [s.impersonating] : [])])];
  const tenant = db.tenants.find((x) => x.id === s.tenantId) || db.tenants.find((x) => x.id === ids[0]);
  // The business's own colours and logo (Business and Pro plans).
  const ownBrand = !!(db.plans.find((p) => p.id === tenant?.planId)?.price);
  useBrand(ownBrand ? tenant?.brandColors : null);
  // The colour-bars theme needs the business's own colours (Business and Pro): without them it isn't offered,
  // and a workspace using it falls back to dark.
  const hasColours = ownBrand && (tenant?.brandColors || []).length > 0;
  React.useEffect(() => { if (!hasColours && db.session.theme === "bars") update((d) => { d.session.theme = "dark"; }); }, [hasColours, db.session.theme]);
  const roles = db.tenantRoles[tenant.id];
  const owner = roles.find((r) => r.perms.includes("*"));
  // "View as another role" is a tool for the real owner only; staff and everyone else never see it.
  const realRole = roles.find((r) => r.id === s.liveRoles?.[tenant.id]);
  const canPreview = !!realRole?.perms.includes("*");
  // Previewing a role (owners checking what someone sees) wins; then the person's own role in this business.
  const role = roles.find((r) => r.id === s.previewRoleId) || roles.find((r) => r.id === s.liveRoles?.[tenant.id]) || owner || roles[0];
  const ts = db.tenantSettings[tenant.id] || defaultTenantSettings(tenant);
  const openBranches = branchesOf(db, tenant).filter((b) => b.status === "open").map((b) => b.name);
  // Signed in: the person's own branch access from the server (owners always all). Samples and role previews use a
  // sample member of that role.
  const mine = !s.previewRoleId ? s.liveScopes?.[tenant.id] : undefined;
  const sample = (db.members[tenant.id] || []).find((m) => m.roleId === role.id);
  const canAll = mine !== undefined ? mine === "all" : role.perms.includes("*") || role.key === "manager" || !sample || sample.scopes === "all";
  const allowed = canAll ? openBranches : openBranches.filter((b) => (mine ?? sample.scopes).includes(b));
  const picked = s.branchOf?.[tenant.id] || "all";
  const branch = canAll ? (picked === "all" || allowed.includes(picked) ? picked : "all") : (allowed.includes(picked) ? picked : allowed[0] || "all");
  // Signed in: every call carries the picked branch, so each branch shows only its own work.
  const branchId = branch === "all" ? "all" : (db.branches?.[tenant.id] || []).find((b) => b.name === branch)?.id || "all";
  setActiveBranch(branchId);
  React.useEffect(() => { workRefresh(); }, [tenant.id, branchId]);
  const brand = ts.branding.useBrand ? ts.branding.color : null;
  const T = tenant.type;
  // Pro sees every type's modules; Starter (free) sees only the basics.
  const plan = planOf(db, tenant);
  const types = typesFor(tenant, plan);
  // Per-app billing (Phase 3): the Marketplace and the Subscriptions page; today's plan pages for every other business.
  const billingMode = useBillingMode(tenant.id);
  const onApps = billingMode === "apps";
  // On apps, what a business may use comes from its app subscriptions (GET /entitlements), not from the old plan's Free/paid split (P3-FE-2).
  const ent = useBusinessEntitlements(tenant.id);
  const free = onApps ? false : isFree(plan);
  // The listing limit: on per-app billing it is the Listings edition the business has (free 3, full 500, more with a gift); on plans it is the old plan limit.
  const capNow = billingMode == null ? -1 : onApps ? (ent.limitOf("listings", "listings") ?? -1) : listingCap(plan); // unknown while loading: no wall
  const atCapNow = (count) => capNow !== -1 && count >= capNow;
  const { path: here } = useRouter();
  const hereApp = appOfPath(here);
  const appName = (id) => APP_MANIFESTS.find((a) => a.id === id)?.name?.en || id;
  const stays = types.includes("hotel") || types.includes("host");
  const any = (...p) => role.perms.includes("*") || canAny(role, p);
  const drafts = db.drafts[tenant.id] ? 1 : 0;
  // Unread leads, for the Inbox button in the top bar.
  const newLeads = (opsOf(db, tenant.id).conversations || []).filter((c) => c.unread).length;
  // Unread emails in the person's own and shared mailboxes (checked every minute), for the Email button.
  const newMail = s.mailUnread?.[tenant.id] || 0;
  const ck = checkupsOf(db, tenant.id);
  const toCheck = todaysList(db.listings.filter((l) => l.tenantId === tenant.id), ck.settings, ck.log, TODAY.slice(0, 10)).length;

  // The apps on the kernel (Expenses, Reviews, Rentals) get their entry from their manifest (@sheetal/config/menu); the rest stay written here until Phase 2.
  const nav = byApps(onApps, ent, withoutPaid(free, filterNav(fromManifests([
    { items: [{ to: "/business", exact: true, icon: "layout-grid", key: "nav.overview", perm: "workspace.overview.read" }, { to: "/business/analytics", icon: "chart-column", key: "nav.analytics", perm: "workspace.overview.read" }] },
    // Listings first (what every business does), then the people who answer them, then day-to-day operations.
    { group: "group.listings", items: [
      { to: "/business/listings", icon: "house", key: "nav.listings", permAny: ["listings.listing.read+listings.listing.create+listings.listing.update+listings.listing.delete+listings.listing.publish", "projects.project.read+projects.project.create+projects.project.update+projects.project.delete", "investments.offering.read+investments.offering.create+investments.offering.update+investments.offering.delete", "hotel.calendar.update", "workspace.overview.read"], count: drafts },
      { to: "/business/checkups", icon: "list-checks", key: "nav.checkups", permAny: ["listings.listing.read+listings.listing.create+listings.listing.update+listings.listing.delete+listings.listing.publish", "projects.project.read+projects.project.create+projects.project.update+projects.project.delete", "investments.offering.read+investments.offering.create+investments.offering.update+investments.offering.delete", "hotel.calendar.update"], count: toCheck || undefined, countTone: "action" },
      { to: "/business/promote", icon: "rocket", key: "nav.promote", permAny: ["listings.listing.read+listings.listing.create+listings.listing.update+listings.listing.delete+listings.listing.publish", "projects.project.read+projects.project.create+projects.project.update+projects.project.delete", "investments.offering.read+investments.offering.create+investments.offering.update+investments.offering.delete", "hotel.calendar.update", "workspace.billing.manage"] },
      manifestNavItem("/business/reviews"),
    ] },
    { group: "group.leads", items: [
      { to: "/business/inbox", icon: "messages-square", key: "nav.inbox", permAny: ["crm.message.reply", "crm.lead.read"] },
      { to: "/business/mail", icon: "mail", key: "nav.mail" },
      { to: "/business/forms", icon: "file-text", key: "nav.forms", permAny: ["crm.message.reply", "crm.lead.read", "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete"] },
      { to: "/business/agreements", paid: true, icon: "file-pen-line", key: "nav.agreements", permAny: ["agreements.agreement.read+agreements.agreement.create+agreements.agreement.update+agreements.agreement.delete"], count: undefined, countTone: "action" },
    ] },
    // Starter (free) gets its type's core tools within its limits; point of sale and stock are paid.
    { group: "group.operate", items: [
      { to: "/business/bookings", icon: "clipboard-list", key: "nav.bookings", perm: "hotel.booking.read", types: ["hotel", "host"] },
      { to: "/business/calendar", icon: "calendar-days", key: "nav.calendar", perm: "hotel.calendar.read", types: ["hotel", "host"] },
      { to: "/business/pos", paid: true, icon: "store", key: "nav.pos", permAny: ["pos.frontdesk.use", "pos.restaurant.use", "pos.extra.create"], types: ["hotel", "host"] },
      { to: "/business/stock", paid: true, icon: "package", key: "nav.stock", permAny: ["pos.restaurant.use", "pos.extra.create", "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete"], types: ["hotel", "host"] },
      manifestNavItem("/business/rentals"),
      { to: "/business/projects", icon: "building-2", key: "nav.projects", permAny: ["projects.project.read+projects.project.create+projects.project.update+projects.project.delete", "projects.progress.create"], types: ["developer"] },
      { to: "/business/collections", icon: "hand-coins", key: "nav.collections", perm: "collections.payment.read+collections.payment.create", types: ["developer", "agency"] },
      { to: "/business/investors", icon: "users", key: "nav.investors", perm: "investments.investor.read", types: ["sponsor"] },
    ] },
    { group: "group.money", items: [
      { to: "/business/invoices", icon: "receipt", key: "nav.invoices", perm: "invoicing.invoice.read" },
      { to: "/business/payouts", icon: "wallet", key: "nav.payouts", perm: "invoicing.payout.read" },
      manifestNavItem("/business/expenses", { paid: true }),
    ] },
    { group: "group.admin", items: [
      ...(onApps ? [{ to: "/business/marketplace", icon: "shopping-bag", key: "nav.marketplace", perm: "workspace.billing.manage", match: ["/business/marketplace"] }] : []),
      { to: "/business/team", icon: "users", key: "nav.team" },
      { to: "/business/jobs", icon: "briefcase", key: "nav.jobs", perm: "workspace.team.invite" },
      { to: can(role, "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete") ? "/business/settings" : "/business/billing", icon: "settings", key: "nav.settings", permAny: ["workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete", "workspace.billing.manage"], match: ["/business/settings", "/business/billing", "/business/domains", "/business/developers", "/business/data", "/business/branches", "/business/channels", "/business/ai-accounts"] },
      { to: "/business/help", icon: "life-buoy", key: "nav.help" },
    ] },
  ]), role, types)));

  const guard = (ok, el) => (ok ? el : <NoAccess />);
  const paid = (ok, el) => (free ? <UpgradeNeeded /> : guard(ok, el));
  const ended = ["suspended", "cancelled"].includes(tenant.status) && s.impersonating !== tenant.id;
  const serverNotifs = useServerNotifs(bizApi, "/notifications", true, tenant.id);
  const notifs = serverNotifs;
  const notifications = notifs.list.slice(0, 6).map((n) => ({ ...n, onOpen: () => notifs.read(n.id) }));

  // The business at the top of the sidebar. With its own branding (logo or colours) it takes Sheetal's logo spot;
  // until then Sheetal's logo stays and the business sits just under it. Clicking the name switches business.
  // The business always takes the top of the sidebar (no Sheetal logo there): its own logo on Business and Pro,
  // otherwise its initials. Sheetal's sample logos (/brand/…) never count as the business's.
  const logoOf = (x) => (db.plans.find((p) => p.id === x.planId)?.price && x.logoUrl && !x.logoUrl.startsWith("/brand/") ? x.logoUrl : null);
  // Each business with its type and the person's role there (the menu and access follow both).
  const roleIn = (id) => { const rs = db.tenantRoles[id] || []; return rs.find((r) => r.id === s.liveRoles?.[id]) || rs.find((r) => r.perms.includes("*")) || rs[0]; };
  const wsList = ids.map((id) => db.tenants.find((y) => y.id === id)).filter(Boolean).map((x) => ({
    id: x.id, name: x.name, logoUrl: logoOf(x), color: x.id === tenant.id ? brand || tenant.brandColors?.[0] : undefined,
    typeLabel: t(`type.${x.type}`), typeIcon: TYPE_ICON[x.type], role: roleIn(x.id) ? roleName(roleIn(x.id), t) : undefined,
  }));
  // Switching business opens its overview, since the pages differ by type and role.
  const pickWs = (v) => { update((d) => { d.session.tenantId = v; d.session.previewRoleId = null; }); navigate("/business"); };
  const addWs = canAddBusiness() ? <MenuButton icon="plus" onClick={() => setAdding(true)}>Add a business</MenuButton> : null;
  const wsSwitcher = <WorkspaceSwitcher footer={addWs} current={wsList.find((w) => w.id === tenant.id) || { id: tenant.id, name: tenant.name, logoUrl: logoOf(tenant) }} list={wsList} onPick={pickWs} big sub={`${t(`type.${tenant.type}`)} · ${tenant.city || "Nepal"}`} label={t("ws.switch")} />;

  return (
    <Shell sub={t("brand.business")} nav={nav} themes={hasColours ? PANEL_THEMES : THEMES} brandSlot={wsSwitcher} switcher={null} preview={PREVIEW} notifications={notifications} notifTo="/business/notifications" onReadAll={notifs.readAll}
      quickCreate={[
        any("listings.listing.read+listings.listing.create+listings.listing.update+listings.listing.delete+listings.listing.publish", "projects.project.read+projects.project.create+projects.project.update+projects.project.delete", "investments.offering.read+investments.offering.create+investments.offering.update+investments.offering.delete", "hotel.calendar.update") && { icon: "house-plus", label: t("listings.new"), to: "/business/listings/new" },
        stays && can(role, "hotel.booking.create") && { icon: "calendar-plus", label: t("bk.manual"), to: "/business/bookings" },
        !free && { icon: "file-pen-line", label: t("ag.new"), to: "/business/agreements" },
        any("crm.message.reply", "crm.lead.read", "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete") && { icon: "file-plus", label: "New online form", to: "/business/forms" },
        any("listings.listing.read+listings.listing.create+listings.listing.update+listings.listing.delete+listings.listing.publish", "projects.project.read+projects.project.create+projects.project.update+projects.project.delete", "investments.offering.read+investments.offering.create+investments.offering.update+investments.offering.delete", "hotel.calendar.update", "workspace.billing.manage") && { icon: "rocket", label: "Boost a listing", to: "/business/promote" },
        types.includes("agency") && !free && { icon: "key-round", label: "Rentals: rent bills", to: "/business/rentals/rent" },
        !free && can(role, "invoicing.invoice.read+invoicing.invoice.create") && { icon: "receipt", label: t("binv.new"), to: "/business/invoices" },
        can(role, "workspace.team.read+workspace.team.invite+workspace.team.update+workspace.team.remove") && { icon: "user-plus", label: t("team.invite"), to: "/business/team" },
        can(role, "workspace.team.invite") && { icon: "briefcase", label: "Post a job", to: "/business/jobs" },
        { icon: "calendar-days", label: t("hr.apply"), to: "/business/people" },
      ].filter(Boolean)}
      records={[
        ...settingsSections(role, t).flatMap((g) => g.items.map((i) => ({ kind: "setting", icon: i.icon, label: i.label, sub: `Settings · ${g.group}`, keywords: i.keywords, to: i.to }))),
        ...(opsOf(db, tenant.id).bookings || []).map((b) => ({ icon: "clipboard-list", label: `${b.id} · ${b.guest}`, sub: b.type, to: "/business/bookings" })),
        ...db.listings.filter((l) => l.tenantId === tenant.id).map((l) => ({ icon: "house", label: l.title, sub: l.id, to: "/business/listings" })),
        ...(db.agreements[tenant.id] || []).map((a) => ({ icon: "file-pen-line", label: a.title, sub: a.id, to: "/business/agreements" })),
        ...(db.members[tenant.id] || []).map((m) => ({ icon: "user", label: m.name, sub: m.email, to: "/business/team" })),
      ]}
      style={brand ? { "--accent": brand, "--accent-ink": inkFor(brand), "--btn-bg": brand, "--btn-ink": btnInkFor(brand), "--btn-bg-hover": `color-mix(in srgb, ${brand} 82%, white)`, "--accent-soft": `color-mix(in srgb, ${brand} 10%, var(--card))` } : undefined}
      banner={<><SupportBanner tenantId={tenant.id} /><DemoBar email={s.userEmail} />{role !== owner && <div className="pf-branchbar"><span>Previewing as {roleName(role, t)}. Pages this role can't use are hidden.</span><button onClick={() => update((d) => { d.session.previewRoleId = null; })}>Back to my view</button></div>}{branch !== "all" && <div className="pf-branchbar"><span>{t("br.viewing", { b: branch })}</span>{canAll && <button onClick={() => update((d) => { d.session.branchOf = { ...(d.session.branchOf || {}), [tenant.id]: "all" }; })}>{t("br.seeAll")}</button>}</div>}{s.impersonating === tenant.id && (
        <div className="pf-imp"><Icon name="eye" size={16} /><span>{t("ws.impersonating", { name: tenant.name })}</span>
          <Button size="sm" variant="light" onClick={() => { update((d) => { d.session.impersonating = null; d.session.tenantId = d.session.memberships[0]; }); navigate(`/admin/tenants/${tenant.id}`); }}>{t("ws.backToAdmin")}</Button></div>
      )}</>}
      topTools={<>
        {any("crm.message.reply", "crm.lead.read") && <Link to="/business/inbox" className="btn btn-ghost btn-icon pf-top-tool" title="Leads (Inbox)" aria-label={`Leads${newLeads ? `, ${newLeads} unread` : ""}`}><Icon name="messages-square" size={18} />{newLeads > 0 && <b className="pf-top-count">{newLeads > 99 ? "99+" : newLeads}</b>}</Link>}
        <Link to="/business/mail" className="btn btn-ghost btn-icon pf-top-tool" title="Email" aria-label={`Email${newMail ? `, ${newMail} unread` : ""}`}><Icon name="mail" size={18} />{newMail > 0 && <b className="pf-top-count">{newMail > 99 ? "99+" : newMail}</b>}</Link>
      </>}
      topLeft={<div className="pf-top-title"><b>{tenant.name}</b><span className="small muted">{t(`type.${T}`)} · {tenant.city}</span></div>}
      topExtra={<BranchPicker branch={branch} allowed={allowed} canAll={canAll} allLabel={t("br.all")} label={t("br.filter")}
        footer={can(role, "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete") ? <MenuLink to="/business/branches" icon={openBranches.length > 1 ? "settings" : "plus"}>{openBranches.length > 1 ? "Manage branches" : "Add a branch"}</MenuLink> : null}
        onPick={(v) => update((d) => { d.session.branchOf = { ...(d.session.branchOf || {}), [tenant.id]: v }; })} />}
      sideFooter={<><SetupChip tenant={tenant} /><Link to="/business/billing" className="pf-plan-chip"><Icon name="layers" size={15} /><span>{onApps ? t("mkt.chip") : `${(db.plans.find((p) => p.id === tenant.planId) || {}).name} plan`}</span><Icon name="chevron-right" size={14} /></Link>{canPreview && <div className="pf-side-foot"><span className="small muted">{t("preview.viewAs")}</span>
        <Select value={role.id} onChange={(v) => update((d) => { d.session.previewRoleId = v; })} options={roles.map((r) => ({ id: r.id, label: roleName(r, t) }))} aria-label={t("preview.role")} />
        <span className="tiny muted">{t("preview.viewAsHint")}</span></div>}</>}
      userMenu={<>
        <MenuLink to="/business/me" icon="user">My profile</MenuLink>
        <MenuLink to="/business/approvals" icon="shield-check">Approvals</MenuLink>
        <MenuLink to="/business/notifications" icon="bell">Notifications{notifs.unread ? ` (${notifs.unread})` : ""}</MenuLink>
        <MenuSep />
        <MenuLink to={`/site/${tenant.id}`} icon="globe">{t("menu.mySite")}</MenuLink>
        <MenuLink to="/business/help" icon="life-buoy">{t("nav.help")}</MenuLink>
        <MenuButton icon="map" onClick={() => update((d) => { d.session.tourDone = { ...(d.session.tourDone || {}), [tenant.id]: false }; })}>{t("tour.restart")}</MenuButton>
        <MenuSep />
        {(config.demo || s.platformRoleId) && <MenuLink to="/admin" icon="shield-check">{t("menu.admin")}</MenuLink>}
        <MenuButton icon="log-out" onClick={() => { try { localStorage.removeItem("sheetal_token"); } catch { /* storage off */ } window.location.href = "/"; }}>{t("menu.signOut")}</MenuButton>
      </>}>
      <AddBusiness open={adding} onClose={() => setAdding(false)} onAdded={() => navigate("/business")} />
      {/* A new key on switching branch reloads every page's data for that branch. */}
      <BranchProvider key={branchId} value={{ branch, branchId, allowed, canAll, first: openBranches[0] }}>
      {(billingMode === "apps" || billingMode === "shadow") && <BillingPrompts names={(app, edition) => ({ app: appName(app), edition })} />}
      {onApps && hereApp && <ReadOnlyBanner appName={appName(hereApp)} access={ent.accessOf(hereApp)} />}
      {ended ? <BackupOnly tenant={tenant} /> : <Routes fallback={<Pending part={2} />} routes={[
        { path: "/business", render: () => (<LiveOverview key={tenant.id} tenant={tenant} role={role} />) },
        { path: "/business/jobs", render: () => guard(can(role, "workspace.team.invite"), <Jobs key={tenant.id} tenant={tenant} />) },
        { path: "/business/approvals", render: () => <Approvals key={tenant.id} tenant={tenant} live tab="pending" /> },
        { path: "/business/approvals/:tab", render: ({ tab }) => <Approvals key={tenant.id + tab} tenant={tenant} live tab={["decided", "rules"].includes(tab) ? tab : "pending"} /> },
        { path: "/business/team", render: () => <TeamHub key={tenant.id + "m"} tenant={tenant} role={role} start={can(role, "workspace.team.read") ? "members" : "attendance"} /> },
        { path: "/business/roles", render: () => <TeamHub key={tenant.id + "r"} tenant={tenant} role={role} start="roles" /> },
        { path: "/business/listings", render: () => <ListingsPage tenant={tenant} canEdit={any("listings.listing.read+listings.listing.create+listings.listing.update+listings.listing.delete+listings.listing.publish", "projects.project.read+projects.project.create+projects.project.update+projects.project.delete", "investments.offering.read+investments.offering.create+investments.offering.update+investments.offering.delete", "hotel.calendar.update")} /> },
        { path: "/business/listings/new", render: () => (!db.drafts[tenant.id]?.editId && atCapNow(db.listings.filter((l) => l.tenantId === tenant.id && l.status !== "archived" && l.status !== "rejected").length) ? <UpgradeNeeded cap={capNow} /> : guard(any("listings.listing.read+listings.listing.create+listings.listing.update+listings.listing.delete+listings.listing.publish", "projects.project.read+projects.project.create+projects.project.update+projects.project.delete", "investments.offering.read+investments.offering.create+investments.offering.update+investments.offering.delete", "hotel.calendar.update"), <ListingWizard key={tenant.id} tenant={tenant} />)) },
        { path: "/business/agreements", render: () => (paid(can(role, "agreements.agreement.read+agreements.agreement.create+agreements.agreement.update+agreements.agreement.delete"), <LiveAgreements key={tenant.id} tenant={tenant} />)) },
        { path: "/business/agreements/new/:from/:fromId", render: ({ from, fromId }) => (paid(can(role, "agreements.agreement.read+agreements.agreement.create+agreements.agreement.update+agreements.agreement.delete"), <LiveAgreements key={tenant.id + from + fromId} tenant={tenant} from={from} fromId={fromId} />)) },
        { path: "/business/agreements/:id", render: ({ id }) => (paid(can(role, "agreements.agreement.read+agreements.agreement.create+agreements.agreement.update+agreements.agreement.delete"), <LiveAgreements key={tenant.id + id} tenant={tenant} id={id} />)) },
        { path: "/business/settings", render: () => guard(can(role, "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete"), <SettingsShell role={role}><BusinessSettings key={tenant.id} tenant={tenant} tab="profile" /></SettingsShell>) },
        { path: "/business/settings/verification", render: () => guard(can(role, "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete"), <SettingsShell role={role}>{<Verification key={tenant.id} tenant={tenant} />}</SettingsShell>) },
        { path: "/business/settings/apps", render: () => guard(can(role, "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete"), <SettingsShell role={role}><AppSettingsPage key={tenant.id} /></SettingsShell>) },
        { path: "/business/settings/roles", render: () => guard(can(role, "workspace.role.read+workspace.role.create+workspace.role.update+workspace.role.delete"), <SettingsShell role={role}><BusinessRoles key={tenant.id} tenant={tenant} role={role} /></SettingsShell>) },
        { path: "/business/settings/:tab", render: ({ tab }) => guard(can(role, "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete"), <SettingsShell role={role}><BusinessSettings key={tenant.id} tenant={tenant} tab={tab} /></SettingsShell>) },
        { path: "/business/billing/return/:provider/:id", render: ({ provider, id }) => <BillingReturn provider={provider} id={id} /> },
        { path: "/business/billing", render: () => guard(can(role, "workspace.billing.manage"), <SettingsShell role={role}>{onApps ? <Subscriptions key={tenant.id} tenant={tenant} /> : <BusinessBilling tenant={tenant} canManage />}</SettingsShell>) },
        { path: "/business/marketplace", render: () => guard(can(role, "workspace.billing.manage"), <Marketplace key={tenant.id} tenant={tenant} openApp={new URLSearchParams(window.location.search).get("app")} />) },
        { path: "/business/marketplace/cart", render: () => guard(can(role, "workspace.billing.manage"), <CartPage key={tenant.id} tenant={tenant} />) },
        { path: "/business/data", render: () => guard(can(role, "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete"), <SettingsShell role={role}><BusinessData tenant={tenant} /></SettingsShell>) },
        { path: "/business/pos", render: () => paid(any("pos.frontdesk.use", "pos.restaurant.use", "pos.extra.create", "pos.shift.close"), (<LivePOSHub key={tenant.id} tenant={tenant} role={role} />)) },
        { path: "/business/bookings", render: () => guard(can(role, "hotel.booking.read"), (<LiveBookings key={tenant.id} tenant={tenant} role={role} />)) },
        { path: "/business/inbox", render: () => guard(any("crm.message.reply", "crm.lead.read"), <Inbox key={tenant.id} tenant={tenant} />) },
        { path: "/business/forms", render: () => guard(any("crm.message.reply", "crm.lead.read", "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete"), (<LiveForms key={tenant.id} tenant={tenant} />)) },
        { path: "/business/forms/responses", render: () => guard(any("crm.message.reply", "crm.lead.read", "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete"), (<LiveForms key={tenant.id + "r"} tenant={tenant} view="responses" />)) },
        { path: "/business/forms/responses/:dest", render: ({ dest }) => guard(any("crm.message.reply", "crm.lead.read", "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete"), (<LiveForms key={tenant.id + "r" + dest} tenant={tenant} view="responses" dest={dest} />)) },
        { path: "/business/forms/:id", render: ({ id }) => guard(any("crm.message.reply", "crm.lead.read", "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete"), (<LiveForms key={tenant.id + id} tenant={tenant} view="build" id={id} />)) },
        { path: "/business/invoices", render: () => guard(can(role, "invoicing.invoice.read"), (<LiveInvoices key={tenant.id} tenant={tenant} />)) },
        { path: "/business/payouts", render: () => guard(can(role, "invoicing.payout.read"), (<LivePayouts key={tenant.id} tenant={tenant} />)) },
        { path: "/business/projects", render: () => guard(any("projects.project.read+projects.project.create+projects.project.update+projects.project.delete", "projects.progress.create"), (<LiveProjects key={tenant.id} tenant={tenant} role={role} />)) },
        { path: "/business/collections", render: () => guard(can(role, "collections.payment.read+collections.payment.create"), (<LiveProjects key={tenant.id + "c"} tenant={tenant} role={role} />)) },
        { path: "/business/investors", render: () => guard(can(role, "investments.investor.read"), (<LiveInvestors key={tenant.id} tenant={tenant} role={role} />)) },
        { path: "/business/reviews", render: () => guard(any("reviews.review.read+reviews.review.reply", "crm.customer.read+reviews.review.read"), (<ReviewsPage key={tenant.id} tenant={tenant} />)) },
        { path: "/business/expenses", render: () => paid(can(role, "expenses.expense.read+expenses.recurring.read+expenses.profit.read"), (<ExpensesPage key={tenant.id} tenant={tenant} />)) },
        { path: "/business/rentals", render: () => guard(any("rentals.rental.read", "rentals.rental.read+rentals.rental.create+rentals.rental.update+rentals.rental.delete"), (<LiveRentals key={tenant.id} tenant={tenant} />)) },
        { path: "/business/rentals/:tab", render: ({ tab }) => guard(any("rentals.rental.read", "rentals.rental.read+rentals.rental.create+rentals.rental.update+rentals.rental.delete"), (<LiveRentals key={tenant.id} tenant={tenant} tab={tab} />)) },
        { path: "/business/stock", render: () => paid(any("pos.restaurant.use", "pos.extra.create", "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete"), (<LiveStock key={tenant.id} tenant={tenant} />)) },
        { path: "/business/promote", render: () => guard(any("listings.listing.read+listings.listing.create+listings.listing.update+listings.listing.delete+listings.listing.publish", "projects.project.read+projects.project.create+projects.project.update+projects.project.delete", "investments.offering.read+investments.offering.create+investments.offering.update+investments.offering.delete", "hotel.calendar.update", "workspace.billing.manage"), <LivePromote key={tenant.id} tenant={tenant} />) },
        { path: "/business/promote/boost/:code", render: ({ code }) => guard(any("listings.listing.read+listings.listing.create+listings.listing.update+listings.listing.delete+listings.listing.publish", "projects.project.read+projects.project.create+projects.project.update+projects.project.delete", "investments.offering.read+investments.offering.create+investments.offering.update+investments.offering.delete", "hotel.calendar.update", "workspace.billing.manage"), <LivePromote key={tenant.id} tenant={tenant} code={code} />) },
        { path: "/business/promote/:tab", render: ({ tab }) => guard(any("listings.listing.read+listings.listing.create+listings.listing.update+listings.listing.delete+listings.listing.publish", "projects.project.read+projects.project.create+projects.project.update+projects.project.delete", "investments.offering.read+investments.offering.create+investments.offering.update+investments.offering.delete", "hotel.calendar.update", "workspace.billing.manage"), <LivePromote key={tenant.id} tenant={tenant} tab={tab} />) },
        { path: "/business/branches", render: () => guard(can(role, "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete"), <SettingsShell role={role}>{<LiveBranches tenant={tenant} role={role} />}</SettingsShell>) },
        { path: "/business/calendar", render: () => guard(can(role, "hotel.calendar.read"), (<LiveCalendar key={tenant.id} tenant={tenant} role={role} />)) },
        { path: "/business/analytics", render: () => guard(can(role, "workspace.overview.read"), (<LiveAnalytics key={tenant.id} tenant={tenant} />)) },
        { path: "/business/people", render: () => <TeamHub key={tenant.id + "a"} tenant={tenant} role={role} start="attendance" /> },
        { path: "/business/developers", render: () => guard(can(role, "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete"), <SettingsShell role={role}>{<LiveDevelopers key={tenant.id} tenant={tenant} />}</SettingsShell>) },
        { path: "/business/mail", render: () => <Mail key={tenant.id} /> },
        { path: "/business/domains", render: () => guard(can(role, "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete"), <SettingsShell role={role}><Domains key={tenant.id} tenant={tenant} /></SettingsShell>) },
        { path: "/business/channels", render: () => guard(can(role, "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete"), <SettingsShell role={role}>{<LiveChannels key={tenant.id} tenant={tenant} />}</SettingsShell>) },
        { path: "/business/ai-accounts", render: () => guard(can(role, "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete"), <SettingsShell role={role}>{onApps ? <AiPlan key={tenant.id} tenant={tenant} /> : <LiveAiAccounts key={tenant.id} tenant={tenant} />}</SettingsShell>) },
        { path: "/business/voice", render: () => paid(any("crm.message.reply", "crm.lead.read", "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete"), <VoiceAssistant key={tenant.id} tenant={tenant} />) },
        { path: "/business/checkups", render: () => guard(any("listings.listing.read+listings.listing.create+listings.listing.update+listings.listing.delete+listings.listing.publish", "projects.project.read+projects.project.create+projects.project.update+projects.project.delete", "investments.offering.read+investments.offering.create+investments.offering.update+investments.offering.delete", "hotel.calendar.update"), <ListingCheckups key={tenant.id} tenant={tenant} role={role} />) },
        { path: "/business/social", render: () => guard(any("listings.listing.read+listings.listing.create+listings.listing.update+listings.listing.delete+listings.listing.publish", "projects.project.read+projects.project.create+projects.project.update+projects.project.delete", "investments.offering.read+investments.offering.create+investments.offering.update+investments.offering.delete", "hotel.calendar.update"), <Social key={tenant.id} tenant={tenant} />) },
        { path: "/business/start", render: () => <GettingStarted key={tenant.id} tenant={tenant} /> },
        { path: "/business/help", render: () => <Help tenant={tenant} /> },
        { path: "/business/me", render: () => <MyProfile key={tenant.id} scope={`b-${tenant.id}`} roleLabel={roleName(role, t)} access={canAll ? "All branches" : allowed.join(", ")} homeTo="/business/settings" /> },
        { path: "/business/notifications", render: () => <NotificationsPage notifs={notifs} prefsTo="/business/me" /> },
      ]} />}
      </BranchProvider>
      {!s.tourDone?.[tenant.id] && <Tour tenant={tenant} onDone={() => update((d) => { d.session.tourDone = { ...(d.session.tourDone || {}), [tenant.id]: true }; })} />}
    </Shell>
  );
}

// Starter hides paid groups and items.
/** Drops the entries no manifest declared (manifestNavItem() answered null), so a missing manifest never breaks the menu. */
function fromManifests(nav) {
  return nav.map((g) => ({ ...g, items: g.items.filter(Boolean) }));
}

/** On per-app billing, the menu shows only the apps the business has (installed, trial, paid, or read-only to look at). */
function byApps(onApps, ent, nav) {
  if (!onApps) return nav;
  return nav.map((g) => ({ ...g, items: g.items.filter((it) => !it || !appOfPath(it.to) || ent.hasApp(appOfPath(it.to))) })).filter((g) => g.items.length);
}

function withoutPaid(free, nav) {
  if (!free) return nav;
  return nav.filter((g) => !g.paid).map((g) => ({ ...g, items: g.items.filter((it) => !it.paid) })).filter((g) => g.items.length);
}

export { Link };

/** Live front desk and restaurant till in one place, as the sample POS has them. */
function LivePOSHub({ tenant, role }) {
  const [tab, setTab] = React.useState(can(role, "pos.frontdesk.use") || can(role, "hotel.booking.update") ? "desk" : "till");
  return (
    <>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "desk", label: "Front desk", icon: "concierge-bell" }, { id: "till", label: "Restaurant and extras", icon: "utensils" }]} />
      {tab === "desk" ? <LiveFrontDesk tenant={tenant} role={role} /> : <LivePOS tenant={tenant} role={role} />}
    </>
  );
}
