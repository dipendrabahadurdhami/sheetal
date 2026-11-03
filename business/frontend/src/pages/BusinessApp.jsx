import { inkFor, btnInkFor } from "@sheetal/shared/core/contrast";
import { Rentals } from "./Rentals";
import { SetupChip } from "./Setup";
import React from "react";
import { useT } from "@sheetal/shared/core/i18n";
import { useStore } from "@sheetal/shared/core/store";
import { Link, Routes, useRouter } from "@sheetal/shared/core/router";
import { can, canAny, filterNav, roleName } from "@sheetal/shared/core/rbac";
import { Button, Select, Tabs } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { MenuButton, MenuLink, MenuSep, NoAccess, Pending, Shell } from "@sheetal/shared/layout/Shell";
import { BusinessOverview, BusinessRoles, TeamHub } from "./BusinessPages";
import { ListingWizard } from "./ListingWizard";
import { ListingsPage } from "./ListingsManager";
import { Agreements } from "./Agreements";
import { BusinessSettings, defaultTenantSettings } from "./BusinessSettings";
import { SettingsShell, settingsSections } from "./SettingsHub";
import { config } from "@sheetal/shared/core/config";
import { BusinessBilling, BusinessData } from "./BusinessBilling";
import { BillingReturn } from "./LiveBilling";
import { Help, Tour } from "./Help";
import { MyProfile, NotificationsPage, businessSeed, useNotifs } from "@sheetal/shared/components/Me";
import { Domains } from "./Domains";
import { Mail } from "./Mail";
import { isLive, useBrand, useLiveWorkspace } from "../live";
import { POS, Bookings } from "./POS";
import { LiveBookings, LiveFrontDesk, LiveInvestors, LivePOS, LiveProjects } from "./LiveOps";
import { LiveAnalytics, LiveChannels } from "./LiveGrowth";
import { Inbox } from "./Inbox";
import { Forms } from "./Forms";
import { formsOf } from "@sheetal/shared/core/forms";
import { Invoices, Payouts } from "./Money";
import { Analytics, Developers } from "./Workspace";
import { BackupOnly } from "./BusinessBilling";
import { Branches, Calendar, branchesOf } from "./Branches";
import { Promote } from "./Promote";
import { BranchProvider } from "@sheetal/shared/core/branch";
import { Collections, Expenses, Investors, Projects, Reviews, Stock } from "./Sector";
import { atListingCap, isFree, listingCap, planOf, typesFor } from "@sheetal/shared/core/plans";
import { UpgradeNeeded } from "./planBits";
import { AiAccounts, Channels, Social, VoiceAssistant } from "./Connections";
import { ListingCheckups } from "./ListingCheckups";
import { checkupsOf, todaysList } from "@sheetal/shared/data/checkups";
import { TODAY } from "@sheetal/shared/core/format";
import { opsOf } from "@sheetal/shared/demo/ops";

// Business workspace at /business (later its own domain). One account can belong to several businesses.
export default function BusinessApp() {
  const t = useT();
  const { db, update, reset } = useStore();
  const { navigate } = useRouter();
  useLiveWorkspace(); // real businesses, role and team when signed in (../live.js)
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
  useBrand(tenant?.brandColors); // the business's own colours, when it has set them
  const roles = db.tenantRoles[tenant.id];
  const owner = roles.find((r) => r.perms.includes("*"));
  // Previewing a role (owners checking what someone sees) wins; then the person's own role in this business.
  const role = roles.find((r) => r.id === s.previewRoleId) || roles.find((r) => r.id === s.liveRoles?.[tenant.id]) || owner || roles[0];
  const ts = db.tenantSettings[tenant.id] || defaultTenantSettings(tenant);
  const openBranches = branchesOf(db, tenant).filter((b) => b.status === "open").map((b) => b.name);
  const sample = (db.members[tenant.id] || []).find((m) => m.roleId === role.id);
  const canAll = role.perms.includes("*") || role.key === "manager" || !sample || sample.scopes === "all";
  const allowed = canAll ? openBranches : openBranches.filter((b) => sample.scopes.includes(b));
  const picked = s.branchOf?.[tenant.id] || "all";
  const branch = canAll ? (picked === "all" || allowed.includes(picked) ? picked : "all") : (allowed.includes(picked) ? picked : allowed[0] || "all");
  const brand = ts.branding.useBrand ? ts.branding.color : null;
  const T = tenant.type;
  // Pro sees every type's modules; Starter (free) sees only the basics.
  const plan = planOf(db, tenant);
  const types = typesFor(tenant, plan);
  const free = isFree(plan);
  const stays = types.includes("hotel") || types.includes("host");
  const any = (...p) => role.perms.includes("*") || canAny(role, p);
  const drafts = db.drafts[tenant.id] ? 1 : 0;
  const pendingAg = (db.agreements[tenant.id] || []).filter((a) => a.status === "sent").length;
  const ck = checkupsOf(db, tenant.id);
  const toCheck = todaysList(db.listings.filter((l) => l.tenantId === tenant.id), ck.settings, ck.log, TODAY.slice(0, 10)).length;

  const nav = withoutPaid(free, filterNav([
    { items: [{ to: "/business", exact: true, icon: "layout-grid", key: "nav.overview", perm: "overview.view" }, { to: "/business/analytics", icon: "chart-column", key: "nav.analytics", perm: "overview.view" }] },
    // Listings first (what every business does), then the people who answer them, then day-to-day operations.
    { group: "group.listings", items: [
      { to: "/business/listings", icon: "house", key: "nav.listings", permAny: ["listings.manage", "projects.manage", "investments.manage", "calendar.edit", "overview.view"], count: drafts },
      { to: "/business/checkups", icon: "list-checks", key: "nav.checkups", permAny: ["listings.manage", "projects.manage", "investments.manage", "calendar.edit"], count: toCheck || undefined, countTone: "action" },
      { to: "/business/promote", icon: "rocket", key: "nav.promote", permAny: ["listings.manage", "projects.manage", "investments.manage", "calendar.edit", "billing.manage"] },
      { to: "/business/social", icon: "megaphone", key: "nav.bizSocial", permAny: ["listings.manage", "projects.manage", "investments.manage", "calendar.edit"] },
      { to: "/business/reviews", icon: "star", key: "nav.reviews", permAny: ["reviews.reply", "customers.view"] },
    ] },
    { group: "group.leads", items: [
      { to: "/business/inbox", icon: "messages-square", key: "nav.inbox", permAny: ["messages.reply", "leads.view"] },
      { to: "/business/mail", icon: "mail", key: "nav.mail" },
      { to: "/business/voice", paid: true, icon: "phone-call", key: "nav.bizVoice", permAny: ["messages.reply", "leads.view", "settings.business"] },
      { to: "/business/forms", icon: "file-text", key: "nav.forms", permAny: ["messages.reply", "leads.view", "settings.business"] },
      { to: "/business/agreements", paid: true, icon: "file-pen-line", key: "nav.agreements", permAny: ["customers.view", "listings.manage", "reservations.manage", "investments.manage", "overview.view"], count: pendingAg, countTone: "action" },
    ] },
    // Starter (free) gets its type's core tools within its limits; point of sale and stock are paid.
    { group: "group.operate", items: [
      { to: "/business/bookings", icon: "clipboard-list", key: "nav.bookings", perm: "bookings.view", types: ["hotel", "host"] },
      { to: "/business/calendar", icon: "calendar-days", key: "nav.calendar", perm: "calendar.view", types: ["hotel", "host"] },
      { to: "/business/pos", paid: true, icon: "store", key: "nav.pos", permAny: ["pos.frontdesk", "pos.restaurant", "pos.extras"], types: ["hotel", "host"] },
      { to: "/business/stock", paid: true, icon: "package", key: "nav.stock", permAny: ["pos.restaurant", "pos.extras", "settings.business"], types: ["hotel", "host"] },
      { to: "/business/rentals", icon: "key-round", key: "nav.rentals", permAny: ["listings.manage", "customers.view", "collect.payments"], types: ["agency"] },
      { to: "/business/projects", icon: "building-2", key: "nav.projects", permAny: ["projects.manage", "progress.post"], types: ["developer"] },
      { to: "/business/collections", icon: "hand-coins", key: "nav.collections", perm: "collect.payments", types: ["developer", "agency"] },
      { to: "/business/investors", icon: "users", key: "nav.investors", perm: "investors.view", types: ["sponsor"] },
    ] },
    { group: "group.money", items: [
      { to: "/business/invoices", icon: "receipt", key: "nav.invoices", perm: "invoices.view" },
      { to: "/business/payouts", icon: "wallet", key: "nav.payouts", perm: "payouts.view" },
      { to: "/business/expenses", paid: true, icon: "chart-pie", key: "nav.expenses", perm: "invoices.view" },
    ] },
    { group: "group.admin", items: [
      { to: "/business/team", icon: "users", key: "nav.team" },
      { to: can(role, "settings.business") ? "/business/settings" : "/business/billing", icon: "settings", key: "nav.settings", permAny: ["settings.business", "billing.manage"], match: ["/business/settings", "/business/billing", "/business/domains", "/business/developers", "/business/data", "/business/branches", "/business/channels", "/business/ai-accounts"] },
      { to: "/business/help", icon: "life-buoy", key: "nav.help" },
    ] },
  ], role, types));

  const guard = (ok, el) => (ok ? el : <NoAccess />);
  const paid = (ok, el) => (free ? <UpgradeNeeded /> : guard(ok, el));
  const ended = ["suspended", "cancelled"].includes(tenant.status) && s.impersonating !== tenant.id;
  const notifs = useNotifs(`b-${tenant.id}`, businessSeed(tenant));
  const notifications = notifs.list.slice(0, 6).map((n) => ({ ...n, onOpen: () => notifs.read(n.id) }));

  const switcher = (
    <div className="pf-ws">
      <span className="pf-ws-logo" style={tenant.logoUrl ? { background: "#fff" } : brand ? { background: brand } : undefined}>{tenant.logoUrl ? <img src={tenant.logoUrl} alt="" /> : ts.branding.logoText}</span>
      <Select value={tenant.id} aria-label={t("ws.switch")} options={ids.map((id) => { const x = db.tenants.find((y) => y.id === id); return { id, label: x.name }; })}
        onChange={(v) => update((d) => { d.session.tenantId = v; d.session.previewRoleId = null; })} />
    </div>
  );

  return (
    <Shell sub={t("brand.business")} nav={nav} switcher={switcher} notifications={notifications} notifTo="/business/notifications" onReadAll={notifs.readAll}
      quickCreate={[
        any("listings.manage", "projects.manage", "investments.manage", "calendar.edit") && { icon: "house-plus", label: t("listings.new"), to: "/business/listings/new" },
        stays && can(role, "bookings.create") && { icon: "calendar-plus", label: t("bk.manual"), to: "/business/bookings" },
        !free && { icon: "file-pen-line", label: t("ag.new"), to: "/business/agreements" },
        any("messages.reply", "leads.view", "settings.business") && { icon: "file-plus", label: "New online form", to: "/business/forms" },
        types.includes("agency") && !free && { icon: "key-round", label: "Rentals: rent bills", to: "/business/rentals/rent" },
        !free && can(role, "invoices.create") && { icon: "receipt", label: t("binv.new"), to: "/business/invoices" },
        can(role, "team.manage") && { icon: "user-plus", label: t("team.invite"), to: "/business/team" },
        { icon: "calendar-days", label: t("hr.apply"), to: "/business/people" },
      ].filter(Boolean)}
      records={[
        ...settingsSections(role, t).flatMap((g) => g.items.map((i) => ({ kind: "setting", icon: i.icon, label: i.label, sub: `Settings · ${g.group}`, keywords: i.keywords, to: i.to }))),
        ...(opsOf(db, tenant.id).bookings || []).map((b) => ({ icon: "clipboard-list", label: `${b.id} · ${b.guest}`, sub: b.type, to: "/business/bookings" })),
        ...db.listings.filter((l) => l.tenantId === tenant.id).map((l) => ({ icon: "house", label: l.title, sub: l.id, to: "/business/listings" })),
        ...(db.agreements[tenant.id] || []).map((a) => ({ icon: "file-pen-line", label: a.title, sub: a.id, to: "/business/agreements" })),
        ...formsOf(db, tenant).map((f) => ({ icon: "file-text", label: f.title, sub: "Form", to: `/business/forms/${f.id}` })),
        ...(db.members[tenant.id] || []).map((m) => ({ icon: "user", label: m.name, sub: m.email, to: "/business/team" })),
      ]}
      style={brand ? { "--accent": brand, "--accent-ink": inkFor(brand), "--btn-bg": brand, "--btn-ink": btnInkFor(brand), "--btn-bg-hover": `color-mix(in srgb, ${brand} 82%, white)`, "--accent-soft": `color-mix(in srgb, ${brand} 10%, var(--card))` } : undefined}
      banner={<>{role !== owner && <div className="pf-branchbar"><span>Previewing as {roleName(role, t)}. Pages this role can't use are hidden.</span><button onClick={() => update((d) => { d.session.previewRoleId = null; })}>Back to my view</button></div>}{branch !== "all" && <div className="pf-branchbar"><span>{t("br.viewing", { b: branch })}</span>{canAll && <button onClick={() => update((d) => { d.session.branchOf = { ...(d.session.branchOf || {}), [tenant.id]: "all" }; })}>{t("br.seeAll")}</button>}</div>}{s.impersonating === tenant.id && (
        <div className="pf-imp"><Icon name="eye" size={16} /><span>{t("ws.impersonating", { name: tenant.name })}</span>
          <Button size="sm" variant="light" onClick={() => { update((d) => { d.session.impersonating = null; d.session.tenantId = d.session.memberships[0]; }); navigate(`/admin/tenants/${tenant.id}`); }}>{t("ws.backToAdmin")}</Button></div>
      )}</>}
      topLeft={<div className="pf-top-title"><b>{tenant.name}</b><span className="small muted">{t(`type.${T}`)} · {tenant.city}</span></div>}
      topExtra={allowed.length > 1 || (canAll && openBranches.length > 1) ? <select className="select pf-branch-pick" aria-label={t("br.filter")} value={branch} onChange={(e) => update((d) => { d.session.branchOf = { ...(d.session.branchOf || {}), [tenant.id]: e.target.value }; })}>
        {canAll && <option value="all">{t("br.all")}</option>}{allowed.map((b) => <option key={b} value={b}>{b}</option>)}</select> : allowed.length === 1 ? <span className="pf-branch-fixed"><span className="pf-ws-dot" />{allowed[0]}</span> : null}
      sideFooter={<><SetupChip tenant={tenant} /><Link to="/business/billing" className="pf-plan-chip"><Icon name="layers" size={15} /><span>{(db.plans.find((p) => p.id === tenant.planId) || {}).name} plan</span><Icon name="chevron-right" size={14} /></Link>{(config.demo || role !== owner) && <div className="pf-side-foot"><span className="small muted">{t("preview.viewAs")}</span>
        <Select value={role.id} onChange={(v) => update((d) => { d.session.previewRoleId = v; })} options={roles.map((r) => ({ id: r.id, label: roleName(r, t) }))} aria-label={t("preview.role")} />
        <span className="tiny muted">{t("preview.viewAsHint")}</span></div>}</>}
      userMenu={<>
        <MenuLink to="/business/me" icon="user">My profile</MenuLink>
        <MenuLink to="/business/notifications" icon="bell">Notifications{notifs.unread ? ` (${notifs.unread})` : ""}</MenuLink>
        <MenuSep />
        <MenuLink to={`/site/${tenant.id}`} icon="globe">{t("menu.mySite")}</MenuLink>
        <MenuLink to="/business/help" icon="life-buoy">{t("nav.help")}</MenuLink>
        <MenuButton icon="map" onClick={() => update((d) => { d.session.tourDone = { ...(d.session.tourDone || {}), [tenant.id]: false }; })}>{t("tour.restart")}</MenuButton>
        <MenuSep />
        {(config.demo || s.platformRoleId) && <MenuLink to="/admin" icon="shield-check">{t("menu.admin")}</MenuLink>}
        {config.demo && <MenuButton icon="rotate-ccw" onClick={reset}>{t("psettings.resetDemo")}</MenuButton>}
        <MenuButton icon="log-out" onClick={() => { try { localStorage.removeItem("sheetal_token"); } catch { /* storage off */ } window.location.href = "/"; }}>{t("menu.signOut")}</MenuButton>
      </>}>
      <BranchProvider value={{ branch, allowed, canAll, first: openBranches[0] }}>
      {ended ? <BackupOnly tenant={tenant} /> : <Routes fallback={<Pending part={2} />} routes={[
        { path: "/business", render: () => <BusinessOverview tenant={tenant} role={role} /> },
        { path: "/business/team", render: () => <TeamHub key={tenant.id + "m"} tenant={tenant} role={role} start={can(role, "team.view") ? "members" : "attendance"} /> },
        { path: "/business/roles", render: () => <TeamHub key={tenant.id + "r"} tenant={tenant} role={role} start="roles" /> },
        { path: "/business/listings", render: () => <ListingsPage tenant={tenant} canEdit={any("listings.manage", "projects.manage", "investments.manage", "calendar.edit")} /> },
        { path: "/business/listings/new", render: () => (!db.drafts[tenant.id]?.editId && atListingCap(plan, db.listings.filter((l) => l.tenantId === tenant.id && l.status !== "archived" && l.status !== "rejected").length) ? <UpgradeNeeded cap={listingCap(plan)} /> : guard(any("listings.manage", "projects.manage", "investments.manage", "calendar.edit"), <ListingWizard key={tenant.id} tenant={tenant} />)) },
        { path: "/business/agreements", render: () => paid(any("customers.view", "listings.manage", "reservations.manage", "investments.manage", "overview.view"), <Agreements tenant={tenant} />) },
        { path: "/business/settings", render: () => guard(can(role, "settings.business"), <SettingsShell role={role}><BusinessSettings key={tenant.id} tenant={tenant} tab="profile" /></SettingsShell>) },
        { path: "/business/settings/roles", render: () => guard(can(role, "roles.manage"), <SettingsShell role={role}><BusinessRoles key={tenant.id} tenant={tenant} role={role} /></SettingsShell>) },
        { path: "/business/settings/:tab", render: ({ tab }) => guard(can(role, "settings.business"), <SettingsShell role={role}><BusinessSettings key={tenant.id} tenant={tenant} tab={tab} /></SettingsShell>) },
        { path: "/business/billing/return/:provider/:id", render: ({ provider, id }) => <BillingReturn provider={provider} id={id} /> },
        { path: "/business/billing", render: () => guard(can(role, "billing.manage"), <SettingsShell role={role}><BusinessBilling tenant={tenant} canManage /></SettingsShell>) },
        { path: "/business/data", render: () => guard(can(role, "settings.business"), <SettingsShell role={role}><BusinessData tenant={tenant} /></SettingsShell>) },
        { path: "/business/pos", render: () => paid(any("pos.frontdesk", "pos.restaurant", "pos.extras", "shift.close"), (isLive(tenant.id) ? <LivePOSHub key={tenant.id} tenant={tenant} role={role} /> : <POS key={tenant.id} tenant={tenant} role={role} />)) },
        { path: "/business/bookings", render: () => guard(can(role, "bookings.view"), (isLive(tenant.id) ? <LiveBookings key={tenant.id} tenant={tenant} role={role} /> : <Bookings tenant={tenant} role={role} />)) },
        { path: "/business/inbox", render: () => guard(any("messages.reply", "leads.view"), <Inbox key={tenant.id} tenant={tenant} />) },
        { path: "/business/forms", render: () => guard(any("messages.reply", "leads.view", "settings.business"), <Forms key={tenant.id} tenant={tenant} />) },
        { path: "/business/forms/responses", render: () => guard(any("messages.reply", "leads.view", "settings.business"), <Forms key={tenant.id + "r"} tenant={tenant} view="responses" />) },
        { path: "/business/forms/responses/:dest", render: ({ dest }) => guard(any("messages.reply", "leads.view", "settings.business"), <Forms key={tenant.id + "r"} tenant={tenant} view="responses" dest={dest} />) },
        { path: "/business/forms/:id", render: ({ id }) => guard(any("messages.reply", "leads.view", "settings.business"), <Forms key={tenant.id + id} tenant={tenant} view="build" id={id} />) },
        { path: "/business/invoices", render: () => guard(can(role, "invoices.view"), <Invoices tenant={tenant} />) },
        { path: "/business/payouts", render: () => guard(can(role, "payouts.view"), <Payouts tenant={tenant} />) },
        { path: "/business/projects", render: () => guard(any("projects.manage", "progress.post"), (isLive(tenant.id) ? <LiveProjects key={tenant.id} tenant={tenant} role={role} /> : <Projects key={tenant.id} tenant={tenant} />)) },
        { path: "/business/collections", render: () => guard(can(role, "collect.payments"), (isLive(tenant.id) ? <LiveProjects key={tenant.id + "c"} tenant={tenant} role={role} /> : <Collections key={tenant.id} tenant={tenant} />)) },
        { path: "/business/investors", render: () => guard(can(role, "investors.view"), (isLive(tenant.id) ? <LiveInvestors key={tenant.id} tenant={tenant} role={role} /> : <Investors key={tenant.id} tenant={tenant} />)) },
        { path: "/business/reviews", render: () => guard(any("reviews.reply", "customers.view"), <Reviews key={tenant.id} tenant={tenant} />) },
        { path: "/business/expenses", render: () => paid(can(role, "invoices.view"), <Expenses key={tenant.id} tenant={tenant} />) },
        { path: "/business/rentals", render: () => guard(any("listings.manage", "customers.view", "collect.payments"), <Rentals key={tenant.id} tenant={tenant} />) },
        { path: "/business/rentals/:tab", render: ({ tab }) => guard(any("listings.manage", "customers.view", "collect.payments"), <Rentals key={tenant.id} tenant={tenant} tab={tab} />) },
        { path: "/business/stock", render: () => paid(any("pos.restaurant", "pos.extras", "settings.business"), <Stock key={tenant.id} tenant={tenant} />) },
        { path: "/business/promote", render: () => guard(any("listings.manage", "projects.manage", "investments.manage", "calendar.edit", "billing.manage"), <Promote tenant={tenant} />) },
        { path: "/business/branches", render: () => guard(can(role, "settings.business"), <SettingsShell role={role}><Branches tenant={tenant} role={role} /></SettingsShell>) },
        { path: "/business/calendar", render: () => guard(can(role, "calendar.view"), <Calendar key={tenant.id} tenant={tenant} role={role} />) },
        { path: "/business/analytics", render: () => guard(can(role, "overview.view"), (isLive(tenant.id) ? <LiveAnalytics key={tenant.id} tenant={tenant} /> : <Analytics tenant={tenant} />)) },
        { path: "/business/people", render: () => <TeamHub key={tenant.id + "a"} tenant={tenant} role={role} start="attendance" /> },
        { path: "/business/developers", render: () => guard(can(role, "settings.business"), <SettingsShell role={role}><Developers tenant={tenant} /></SettingsShell>) },
        { path: "/business/mail", render: () => <Mail key={tenant.id} /> },
        { path: "/business/domains", render: () => guard(can(role, "settings.business"), <SettingsShell role={role}><Domains key={tenant.id} tenant={tenant} /></SettingsShell>) },
        { path: "/business/channels", render: () => guard(can(role, "settings.business"), <SettingsShell role={role}>{isLive(tenant.id) ? <LiveChannels key={tenant.id} tenant={tenant} /> : <Channels key={tenant.id} tenant={tenant} />}</SettingsShell>) },
        { path: "/business/ai-accounts", render: () => guard(can(role, "settings.business"), <SettingsShell role={role}><AiAccounts key={tenant.id} tenant={tenant} /></SettingsShell>) },
        { path: "/business/voice", render: () => paid(any("messages.reply", "leads.view", "settings.business"), <VoiceAssistant key={tenant.id} tenant={tenant} />) },
        { path: "/business/checkups", render: () => guard(any("listings.manage", "projects.manage", "investments.manage", "calendar.edit"), <ListingCheckups key={tenant.id} tenant={tenant} role={role} />) },
        { path: "/business/social", render: () => guard(any("listings.manage", "projects.manage", "investments.manage", "calendar.edit"), <Social key={tenant.id} tenant={tenant} />) },
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
function withoutPaid(free, nav) {
  if (!free) return nav;
  return nav.filter((g) => !g.paid).map((g) => ({ ...g, items: g.items.filter((it) => !it.paid) })).filter((g) => g.items.length);
}

export { Link };

/** Live front desk and restaurant till in one place, as the sample POS has them. */
function LivePOSHub({ tenant, role }) {
  const [tab, setTab] = React.useState(can(role, "pos.frontdesk") || can(role, "bookings.edit") ? "desk" : "till");
  return (
    <>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "desk", label: "Front desk", icon: "concierge-bell" }, { id: "till", label: "Restaurant and extras", icon: "utensils" }]} />
      {tab === "desk" ? <LiveFrontDesk tenant={tenant} role={role} /> : <LivePOS tenant={tenant} role={role} />}
    </>
  );
}
