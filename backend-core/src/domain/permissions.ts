// Permissions: business role templates per business type, and Sheetal staff roles.
// Where it fits: business roles are created from these templates for every new business; the APIs check permissions
// with hasPerm(); the admin API checks staff with PLATFORM_ROLES.
// How it works: a role is a list of permission ids; "*" means everything (owners, super admins).
// Rules: keep in step with shared/src/core/rbac.js (the screens use that copy); test/domain.test.ts fails if they differ.

export const BUSINESS_TYPES = ["hotel", "host", "developer", "agency", "sponsor"] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

interface PermGroup { module: string; types: "all" | BusinessType[]; perms: string[] }

export const BUSINESS_PERMS: PermGroup[] = [
  { module: "overview", types: "all", perms: ["overview.view"] },
  { module: "bookings", types: ["hotel", "host"], perms: ["bookings.view", "bookings.create", "bookings.edit", "bookings.cancel"] },
  { module: "calendar", types: ["hotel", "host"], perms: ["calendar.view", "calendar.edit"] },
  { module: "pos", types: ["hotel", "host"], perms: ["pos.frontdesk", "pos.restaurant", "pos.extras", "pos.discount", "pos.void", "shift.close"] },
  { module: "projects", types: ["developer"], perms: ["projects.manage", "progress.post", "visits.manage", "reservations.manage"] },
  { module: "collect", types: ["developer", "agency"], perms: ["collect.payments", "collect.refund"] },
  { module: "listings", types: ["agency"], perms: ["listings.manage", "leads.view", "leads.assign", "viewings.manage"] },
  { module: "investments", types: ["sponsor"], perms: ["investments.manage", "investors.view", "updates.post"] },
  { module: "money", types: "all", perms: ["invoices.view", "invoices.create", "payouts.view", "expenses.view", "expenses.manage"] },
  { module: "customers", types: "all", perms: ["customers.view", "messages.reply", "reviews.reply"] },
  { module: "admin", types: "all", perms: ["team.view", "team.manage", "roles.manage", "settings.business", "billing.manage"] },
];

export const PLATFORM_PERMS: PermGroup[] = [
  { module: "pdash", types: "all", perms: ["dashboard.view"] },
  { module: "tenants", types: "all", perms: ["tenants.view", "tenants.manage", "tenants.suspend", "tenants.impersonate"] },
  { module: "pbilling", types: "all", perms: ["plans.manage", "billing.view", "billing.refund"] },
  { module: "content", types: "all", perms: ["content.edit", "content.publish"] },
  { module: "moderation", types: "all", perms: ["moderation.listings", "moderation.kyc"] },
  { module: "system", types: "all", perms: ["staff.view", "staff.manage", "roles.manage", "settings.platform", "audit.view"] },
];

const permsForTypes = (types: readonly BusinessType[]) => BUSINESS_PERMS.filter((g) => g.types === "all" || types.some((t) => (g.types as BusinessType[]).includes(t)));
const allOf = (groups: PermGroup[]) => groups.flatMap((g) => g.perms);

// null = every permission of the type except managing roles and billing (a manager, not an owner).
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
    ["sales_manager", ["overview.view", "projects.manage", "visits.manage", "reservations.manage", "collect.payments", "customers.view", "messages.reply", "team.view", "invoices.view"]],
    ["sales_exec", ["visits.manage", "reservations.manage", "customers.view", "messages.reply"]],
    ["site_engineer", ["progress.post"]],
    ["accountant", ["overview.view", "collect.payments", "collect.refund", "invoices.view", "invoices.create", "payouts.view", "expenses.view", "expenses.manage"]],
  ],
  agency: [
    ["owner", ["*"]],
    ["branch_manager", ["overview.view", "listings.manage", "leads.view", "leads.assign", "viewings.manage", "collect.payments", "customers.view", "messages.reply", "reviews.reply", "team.view", "expenses.view", "expenses.manage"]],
    ["agent", ["listings.manage", "leads.view", "viewings.manage", "messages.reply"]],
    ["accountant", ["overview.view", "collect.payments", "invoices.view", "invoices.create", "payouts.view", "expenses.view", "expenses.manage"]],
  ],
  sponsor: [
    ["owner", ["*"]],
    ["investor_relations", ["overview.view", "investors.view", "updates.post", "messages.reply"]],
    ["accountant", ["overview.view", "invoices.view", "payouts.view", "expenses.view", "expenses.manage"]],
  ],
};

export function roleTemplatesFor(type: BusinessType): { key: string; perms: string[] }[] {
  const all = allOf(permsForTypes([type]));
  return TEMPLATES[type].map(([key, perms]) => ({ key, perms: perms ?? all.filter((p) => p !== "roles.manage" && p !== "billing.manage") }));
}

export const PLATFORM_ROLES: Record<string, string[]> = {
  super_admin: ["*"],
  operations: ["dashboard.view", "tenants.view", "tenants.manage", "tenants.suspend", "tenants.impersonate", "moderation.listings", "moderation.kyc", "audit.view", "staff.view"],
  finance: ["dashboard.view", "tenants.view", "plans.manage", "billing.view", "billing.refund"],
  content_editor: ["content.edit", "content.publish", "moderation.listings"],
  support: ["dashboard.view", "tenants.view", "tenants.impersonate", "audit.view"],
};

export const hasPerm = (perms: readonly string[], perm: string) => perms.includes("*") || perms.includes(perm);

/** Every permission id a business of these types can give out (Pro plans see every type's). */
export const businessPermsFor = (types: readonly BusinessType[]) => allOf(permsForTypes(types));
