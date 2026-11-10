// The oracle for the permission shims: a frozen copy of the OLD files, taken from the P1-BE-2 zip before they were replaced.
// Where it fits: test/permissions-unchanged.test.ts and test/permissions-alias.test.ts compare the new shims with this.
// How it works: `oldApi` is backend-core/src/domain/permissions.ts as it was, `oldUi` is shared/src/core/rbac.js as it was (names and code unchanged;
// only the "export" words are removed and types added so it compiles).
// Rules: NEVER edit the lists or functions below to make a test pass. If a permission must change, that is a deliberate task that changes this oracle on purpose.

/* eslint-disable @typescript-eslint/no-explicit-any -- frozen copy of the old code; `any` only so the old JS compiles unchanged. */

// ───────────── OLD backend-core/src/domain/permissions.ts ─────────────
const api = (() => {

const BUSINESS_TYPES = ["hotel", "host", "developer", "agency", "sponsor"] as const;
type BusinessType = (typeof BUSINESS_TYPES)[number];

interface PermGroup { module: string; types: "all" | BusinessType[]; perms: string[] }

const BUSINESS_PERMS: PermGroup[] = [
  { module: "overview", types: "all", perms: ["overview.view"] },
  { module: "bookings", types: ["hotel", "host"], perms: ["bookings.view", "bookings.create", "bookings.edit", "bookings.cancel"] },
  { module: "calendar", types: ["hotel", "host"], perms: ["calendar.view", "calendar.edit"] },
  { module: "pos", types: ["hotel", "host"], perms: ["pos.frontdesk", "pos.restaurant", "pos.extras", "pos.discount", "pos.void", "shift.close"] },
  { module: "projects", types: ["developer"], perms: ["projects.manage", "progress.post", "visits.manage", "reservations.manage"] },
  { module: "collect", types: ["developer", "agency"], perms: ["collect.payments", "collect.refund"] },
  { module: "listings", types: ["agency"], perms: ["listings.manage", "leads.view", "leads.assign", "viewings.manage"] },
  { module: "rentals", types: ["agency"], perms: ["rentals.view", "rentals.manage"] },
  { module: "investments", types: ["sponsor"], perms: ["investments.manage", "investors.view", "updates.post"] },
  { module: "agreements", types: "all", perms: ["agreements.manage"] },
  { module: "people", types: "all", perms: ["people.view", "people.manage"] },
  { module: "money", types: "all", perms: ["invoices.view", "invoices.create", "payouts.view", "expenses.view", "expenses.manage"] },
  { module: "customers", types: "all", perms: ["customers.view", "messages.reply", "reviews.reply"] },
  { module: "admin", types: "all", perms: ["team.view", "team.manage", "roles.manage", "settings.business", "billing.manage"] },
];

const PLATFORM_PERMS: PermGroup[] = [
  { module: "pdash", types: "all", perms: ["dashboard.view"] },
  { module: "tenants", types: "all", perms: ["tenants.view", "tenants.manage", "tenants.suspend", "tenants.impersonate"] },
  { module: "pbilling", types: "all", perms: ["plans.manage", "billing.view", "billing.refund"] },
  { module: "content", types: "all", perms: ["content.edit", "content.publish"] },
  { module: "moderation", types: "all", perms: ["moderation.listings", "moderation.kyc"] },
  { module: "system", types: "all", perms: ["staff.view", "staff.manage", "roles.manage", "settings.platform", "audit.view"] },
];

const permsForTypes = (types: readonly BusinessType[]) => BUSINESS_PERMS.filter((g) => g.types === "all" || types.some((t) => (g.types as BusinessType[]).includes(t)));
const allOf = (groups: PermGroup[]) => groups.flatMap((g) => g.perms);

const TEMPLATES: Record<BusinessType, [string, string[] | null][]> = {
  hotel: [
    ["owner", ["*"]],
    ["manager", null],
    ["frontdesk", ["overview.view", "bookings.view", "bookings.create", "bookings.edit", "calendar.view", "pos.frontdesk", "pos.extras", "shift.close", "customers.view", "messages.reply"]],
    ["cashier", ["pos.restaurant", "pos.extras", "shift.close"]],
    ["housekeeping", ["calendar.view"]],
    ["accountant", ["overview.view", "bookings.view", "invoices.view", "invoices.create", "payouts.view", "expenses.view", "expenses.manage"]],
  ],
  host: [
    ["owner", ["*"]],
    ["cohost", ["overview.view", "bookings.view", "bookings.create", "bookings.edit", "calendar.view", "calendar.edit", "pos.extras", "customers.view", "messages.reply", "reviews.reply"]],
    ["cleaner", ["calendar.view"]],
  ],
  developer: [
    ["owner", ["*"]],
    ["sales_manager", ["overview.view", "projects.manage", "visits.manage", "reservations.manage", "collect.payments", "customers.view", "messages.reply", "team.view", "invoices.view", "agreements.manage", "people.view", "people.manage"]],
    ["sales_exec", ["visits.manage", "reservations.manage", "customers.view", "messages.reply"]],
    ["site_engineer", ["progress.post"]],
    ["accountant", ["overview.view", "collect.payments", "collect.refund", "invoices.view", "invoices.create", "payouts.view", "expenses.view", "expenses.manage"]],
  ],
  agency: [
    ["owner", ["*"]],
    ["branch_manager", ["overview.view", "listings.manage", "leads.view", "leads.assign", "viewings.manage", "collect.payments", "customers.view", "messages.reply", "reviews.reply", "team.view", "expenses.view", "expenses.manage", "rentals.view", "rentals.manage", "agreements.manage", "people.view", "people.manage"]],
    ["agent", ["listings.manage", "leads.view", "viewings.manage", "messages.reply"]],
    ["accountant", ["overview.view", "collect.payments", "invoices.view", "invoices.create", "payouts.view", "expenses.view", "expenses.manage", "rentals.view", "rentals.manage"]],
  ],
  sponsor: [
    ["owner", ["*"]],
    ["investor_relations", ["overview.view", "investors.view", "updates.post", "messages.reply"]],
    ["accountant", ["overview.view", "invoices.view", "payouts.view", "expenses.view", "expenses.manage"]],
  ],
};

function roleTemplatesFor(type: BusinessType): { key: string; perms: string[] }[] {
  const all = allOf(permsForTypes([type]));
  return TEMPLATES[type].map(([key, perms]) => ({ key, perms: perms ?? all.filter((p) => p !== "roles.manage" && p !== "billing.manage") }));
}

const PLATFORM_ROLES: Record<string, string[]> = {
  super_admin: ["*"],
  operations: ["dashboard.view", "tenants.view", "tenants.manage", "tenants.suspend", "tenants.impersonate", "moderation.listings", "moderation.kyc", "audit.view", "staff.view"],
  finance: ["dashboard.view", "tenants.view", "plans.manage", "billing.view", "billing.refund"],
  content_editor: ["content.edit", "content.publish", "moderation.listings"],
  support: ["dashboard.view", "tenants.view", "tenants.impersonate", "audit.view"],
};

const hasPerm = (perms: readonly string[], perm: string) => perms.includes("*") || perms.includes(perm);

/** Every permission id a business of these types can give out (Pro plans see every type's). */
const businessPermsFor = (types: readonly BusinessType[]) => allOf(permsForTypes(types));

  return { BUSINESS_TYPES, BUSINESS_PERMS, PLATFORM_PERMS, roleTemplatesFor, PLATFORM_ROLES, hasPerm, businessPermsFor };
})();

// ───────────── OLD shared/src/core/rbac.js ─────────────
const ui = (() => {

const BUSINESS_TYPES = {
  hotel: { icon: "bed-double" },
  host: { icon: "house" },
  developer: { icon: "building-2" },
  agency: { icon: "briefcase" },
  sponsor: { icon: "hand-coins" },
};

const BUSINESS_PERMS: any[] = [
  { module: "overview", types: "all", perms: ["overview.view"] },
  { module: "bookings", types: ["hotel", "host"], perms: ["bookings.view", "bookings.create", "bookings.edit", "bookings.cancel"] },
  { module: "calendar", types: ["hotel", "host"], perms: ["calendar.view", "calendar.edit"] },
  { module: "pos", types: ["hotel", "host"], perms: ["pos.frontdesk", "pos.restaurant", "pos.extras", "pos.discount", "pos.void", "shift.close"] },
  { module: "projects", types: ["developer"], perms: ["projects.manage", "progress.post", "visits.manage", "reservations.manage"] },
  { module: "collect", types: ["developer", "agency"], perms: ["collect.payments", "collect.refund"] },
  { module: "listings", types: ["agency"], perms: ["listings.manage", "leads.view", "leads.assign", "viewings.manage"] },
  { module: "rentals", types: ["agency"], perms: ["rentals.view", "rentals.manage"] },
  { module: "investments", types: ["sponsor"], perms: ["investments.manage", "investors.view", "updates.post"] },
  { module: "agreements", types: "all", perms: ["agreements.manage"] },
  { module: "people", types: "all", perms: ["people.view", "people.manage"] },
  { module: "money", types: "all", perms: ["invoices.view", "invoices.create", "payouts.view", "expenses.view", "expenses.manage"] },
  { module: "customers", types: "all", perms: ["customers.view", "messages.reply", "reviews.reply"] },
  { module: "admin", types: "all", perms: ["team.view", "team.manage", "roles.manage", "settings.business", "billing.manage"] },
];

const PLATFORM_PERMS: any[] = [
  { module: "pdash", types: "all", perms: ["dashboard.view"] },
  { module: "tenants", types: "all", perms: ["tenants.view", "tenants.manage", "tenants.suspend", "tenants.impersonate"] },
  { module: "pbilling", types: "all", perms: ["plans.manage", "billing.view", "billing.refund"] },
  { module: "content", types: "all", perms: ["content.edit", "content.publish"] },
  { module: "moderation", types: "all", perms: ["moderation.listings", "moderation.kyc"] },
  { module: "system", types: "all", perms: ["staff.view", "staff.manage", "roles.manage", "settings.platform", "audit.view"] },
];

const permsForType = (type: any) => BUSINESS_PERMS.filter((g: any) => g.types === "all" || g.types.includes(type));
const permsForTypes = (types: any) => BUSINESS_PERMS.filter((g: any) => g.types === "all" || types.some((x: any) => g.types.includes(x)));
const allOf = (groups: any) => groups.flatMap((g: any) => g.perms);

const T: any = {
  hotel: [
    ["owner", ["*"]],
    ["manager", null],
    ["frontdesk", ["overview.view", "bookings.view", "bookings.create", "bookings.edit", "calendar.view", "pos.frontdesk", "pos.extras", "shift.close", "customers.view", "messages.reply"]],
    ["cashier", ["pos.restaurant", "pos.extras", "shift.close"]],
    ["housekeeping", ["calendar.view"]],
    ["accountant", ["overview.view", "bookings.view", "invoices.view", "invoices.create", "payouts.view", "expenses.view", "expenses.manage"]],
  ],
  host: [
    ["owner", ["*"]],
    ["cohost", ["overview.view", "bookings.view", "bookings.create", "bookings.edit", "calendar.view", "calendar.edit", "pos.extras", "customers.view", "messages.reply", "reviews.reply"]],
    ["cleaner", ["calendar.view"]],
  ],
  developer: [
    ["owner", ["*"]],
    ["sales_manager", ["overview.view", "projects.manage", "visits.manage", "reservations.manage", "collect.payments", "customers.view", "messages.reply", "team.view", "invoices.view", "agreements.manage", "people.view", "people.manage"]],
    ["sales_exec", ["visits.manage", "reservations.manage", "customers.view", "messages.reply"]],
    ["site_engineer", ["progress.post"]],
    ["accountant", ["overview.view", "collect.payments", "collect.refund", "invoices.view", "invoices.create", "payouts.view", "expenses.view", "expenses.manage"]],
  ],
  agency: [
    ["owner", ["*"]],
    ["branch_manager", ["overview.view", "listings.manage", "leads.view", "leads.assign", "viewings.manage", "collect.payments", "customers.view", "messages.reply", "reviews.reply", "team.view", "expenses.view", "expenses.manage", "rentals.view", "rentals.manage", "agreements.manage", "people.view", "people.manage"]],
    ["agent", ["listings.manage", "leads.view", "viewings.manage", "messages.reply"]],
    ["accountant", ["overview.view", "collect.payments", "invoices.view", "invoices.create", "payouts.view", "expenses.view", "expenses.manage", "rentals.view", "rentals.manage"]],
  ],
  sponsor: [
    ["owner", ["*"]],
    ["investor_relations", ["overview.view", "investors.view", "updates.post", "messages.reply"]],
    ["accountant", ["overview.view", "invoices.view", "payouts.view", "expenses.view", "expenses.manage"]],
  ],
};

function roleTemplatesFor(type: any) {
  const all = allOf(permsForType(type));
  return T[type].map(([key, perms]: any) => ({
    key, system: true, name: null,
    perms: perms || all.filter((p: any) => p !== "roles.manage" && p !== "billing.manage"),
  }));
}

const PLATFORM_ROLE_TEMPLATES: any[] = [
  { key: "super_admin", perms: ["*"] },
  { key: "operations", perms: ["dashboard.view", "tenants.view", "tenants.manage", "tenants.suspend", "tenants.impersonate", "moderation.listings", "moderation.kyc", "audit.view", "staff.view"] },
  { key: "finance", perms: ["dashboard.view", "tenants.view", "plans.manage", "billing.view", "billing.refund"] },
  { key: "content_editor", perms: ["content.edit", "content.publish", "moderation.listings"] },
  { key: "support", perms: ["dashboard.view", "tenants.view", "tenants.impersonate", "audit.view"] },
].map((r: any) => ({ ...r, system: true, name: null }));

const can = (role: any, perm: any) => !!role && (role.perms.includes("*") || role.perms.includes(perm));
const canAny = (role: any, perms: any) => perms.some((p: any) => can(role, p));
const roleName = (role: any, t: any) => (!role ? "—" : role.system ? t(`role.${role.key}`) : role.name);
const roleDesc = (role: any, t: any) => (!role ? "" : role.system ? t(`roledesc.${role.key}`) : role.desc || "");
const permCount = (role: any, groups: any) => (role.perms.includes("*") ? allOf(groups).length : role.perms.filter((p: any) => allOf(groups).includes(p)).length);

function filterNav(nav: any, role: any, type: any) {
  const types: any[] = ([] as any[]).concat(type);
  return nav
    .map((g: any) => ({ ...g, items: g.items.filter((it: any) =>
      (!it.types || it.types.some((x: any) => types.includes(x))) &&
      (!it.perm || can(role, it.perm)) &&
      (!it.permAny || canAny(role, it.permAny))) }))
    .filter((g: any) => g.items.length);
}

  return { BUSINESS_TYPES, BUSINESS_PERMS, PLATFORM_PERMS, permsForType, permsForTypes, roleTemplatesFor, PLATFORM_ROLE_TEMPLATES, can, canAny, roleName, roleDesc, permCount, filterNav };
})();

export const oldApi = api;
export const oldUi = ui;
