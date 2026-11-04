// Permissions, role templates and business types for the screens.
// Where it fits: menus and buttons hide what a role can't do (the server checks again).
// How it works: can(role, perm) and canAny(role, perms); labels come from i18n (perm.*, role.*).
// Rules: keep in step with backend-core/src/domain/permissions.ts; a test fails if they differ.

export const BUSINESS_TYPES = {
  hotel: { icon: "bed-double" },
  host: { icon: "house" },
  developer: { icon: "building-2" },
  agency: { icon: "briefcase" },
  sponsor: { icon: "hand-coins" },
};

// Business workspace permissions. `types` = which business types see the group.
export const BUSINESS_PERMS = [
  { module: "overview", types: "all", perms: ["overview.view"] },
  { module: "bookings", types: ["hotel", "host"], perms: ["bookings.view", "bookings.create", "bookings.edit", "bookings.cancel"] },
  { module: "calendar", types: ["hotel", "host"], perms: ["calendar.view", "calendar.edit"] },
  { module: "pos", types: ["hotel", "host"], perms: ["pos.frontdesk", "pos.restaurant", "pos.extras", "pos.discount", "pos.void", "shift.close"] },
  { module: "projects", types: ["developer"], perms: ["projects.manage", "progress.post", "visits.manage", "reservations.manage"] },
  { module: "collect", types: ["developer", "agency"], perms: ["collect.payments", "collect.refund"] },
  { module: "listings", types: ["agency"], perms: ["listings.manage", "leads.view", "leads.assign", "viewings.manage"] },
  { module: "investments", types: ["sponsor"], perms: ["investments.manage", "investors.view", "updates.post"] },
  { module: "money", types: "all", perms: ["invoices.view", "invoices.create", "payouts.view"] },
  { module: "customers", types: "all", perms: ["customers.view", "messages.reply", "reviews.reply"] },
  { module: "admin", types: "all", perms: ["team.view", "team.manage", "roles.manage", "settings.business", "billing.manage"] },
];

// Sheetal staff permissions for /admin.
export const PLATFORM_PERMS = [
  { module: "pdash", types: "all", perms: ["dashboard.view"] },
  { module: "tenants", types: "all", perms: ["tenants.view", "tenants.manage", "tenants.suspend", "tenants.impersonate"] },
  { module: "pbilling", types: "all", perms: ["plans.manage", "billing.view", "billing.refund"] },
  { module: "content", types: "all", perms: ["content.edit", "content.publish"] },
  { module: "moderation", types: "all", perms: ["moderation.listings", "moderation.kyc"] },
  { module: "system", types: "all", perms: ["staff.view", "staff.manage", "roles.manage", "settings.platform", "audit.view"] },
];

export const permsForType = (type) => BUSINESS_PERMS.filter((g) => g.types === "all" || g.types.includes(type));
export const permsForTypes = (types) => BUSINESS_PERMS.filter((g) => g.types === "all" || types.some((x) => g.types.includes(x)));
const allOf = (groups) => groups.flatMap((g) => g.perms);

const T = {
  hotel: [
    ["owner", ["*"]],
    ["manager", null],
    ["frontdesk", ["overview.view", "bookings.view", "bookings.create", "bookings.edit", "calendar.view", "pos.frontdesk", "pos.extras", "shift.close", "customers.view", "messages.reply"]],
    ["cashier", ["pos.restaurant", "pos.extras", "shift.close"]],
    ["housekeeping", ["calendar.view"]],
    ["accountant", ["overview.view", "bookings.view", "invoices.view", "invoices.create", "payouts.view"]],
  ],
  host: [
    ["owner", ["*"]],
    ["cohost", ["overview.view", "bookings.view", "bookings.create", "bookings.edit", "calendar.view", "calendar.edit", "pos.extras", "customers.view", "messages.reply", "reviews.reply"]],
    ["cleaner", ["calendar.view"]],
  ],
  developer: [
    ["owner", ["*"]],
    ["sales_manager", ["overview.view", "projects.manage", "visits.manage", "reservations.manage", "collect.payments", "customers.view", "messages.reply", "team.view", "invoices.view"]],
    ["sales_exec", ["visits.manage", "reservations.manage", "customers.view", "messages.reply"]],
    ["site_engineer", ["progress.post"]],
    ["accountant", ["overview.view", "collect.payments", "collect.refund", "invoices.view", "invoices.create", "payouts.view"]],
  ],
  agency: [
    ["owner", ["*"]],
    ["branch_manager", ["overview.view", "listings.manage", "leads.view", "leads.assign", "viewings.manage", "collect.payments", "customers.view", "messages.reply", "reviews.reply", "team.view"]],
    ["agent", ["listings.manage", "leads.view", "viewings.manage", "messages.reply"]],
    ["accountant", ["overview.view", "collect.payments", "invoices.view", "invoices.create", "payouts.view"]],
  ],
  sponsor: [
    ["owner", ["*"]],
    ["investor_relations", ["overview.view", "investors.view", "updates.post", "messages.reply"]],
    ["accountant", ["overview.view", "invoices.view", "payouts.view"]],
  ],
};

export function roleTemplatesFor(type) {
  const all = allOf(permsForType(type));
  return T[type].map(([key, perms]) => ({
    key, system: true, name: null,
    perms: perms || all.filter((p) => p !== "roles.manage" && p !== "billing.manage"),
  }));
}

export const PLATFORM_ROLE_TEMPLATES = [
  { key: "super_admin", perms: ["*"] },
  { key: "operations", perms: ["dashboard.view", "tenants.view", "tenants.manage", "tenants.suspend", "tenants.impersonate", "moderation.listings", "moderation.kyc", "audit.view", "staff.view"] },
  { key: "finance", perms: ["dashboard.view", "tenants.view", "plans.manage", "billing.view", "billing.refund"] },
  { key: "content_editor", perms: ["content.edit", "content.publish", "moderation.listings"] },
  { key: "support", perms: ["dashboard.view", "tenants.view", "tenants.impersonate", "audit.view"] },
].map((r) => ({ ...r, system: true, name: null }));

export const can = (role, perm) => !!role && (role.perms.includes("*") || role.perms.includes(perm));
export const canAny = (role, perms) => perms.some((p) => can(role, p));
export const roleName = (role, t) => (!role ? "—" : role.system ? t(`role.${role.key}`) : role.name);
export const roleDesc = (role, t) => (!role ? "" : role.system ? t(`roledesc.${role.key}`) : role.desc || "");
export const permCount = (role, groups) => (role.perms.includes("*") ? allOf(groups).length : role.perms.filter((p) => allOf(groups).includes(p)).length);

// Hide nav items the role can't use, drop empty groups. `type` is one business type or a list (Pro plans see every type).
export function filterNav(nav, role, type) {
  const types = [].concat(type);
  return nav
    .map((g) => ({ ...g, items: g.items.filter((it) =>
      (!it.types || it.types.some((x) => types.includes(x))) &&
      (!it.perm || can(role, it.perm)) &&
      (!it.permAny || canAny(role, it.permAny))) }))
    .filter((g) => g.items.length);
}
