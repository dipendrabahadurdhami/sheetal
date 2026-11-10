// TEMPORARY: today's permission lists in the OLD names, and the alias map from the old names to the new ones.
// Where it fits: read as data by scripts/gen-permissions.mjs, which writes it into permissions.generated.ts / .js so the
// shims (backend-core/src/domain/permissions.ts, shared/src/core/rbac.js) can keep every old export exactly as before.
// How it works: the groups, role templates and staff roles are today's lists, copied unchanged. The alias maps are the
// tables of ACCESS.md section 6.1 and 6.2 (old name -> new names). scripts/check-manifests.mjs proves this file and the
// manifests agree: every old name has a mapping, every mapped name is declared, and the old role templates, translated
// with the maps, give the same abilities as the manifests' `roles`.
// Rules: do not edit the lists to change what a role can do (that is a later, deliberate task). Delete this file together
// with the shims and the alias layer at the end of Phase 1 (ACCESS.md section 6.3, point 4).

import type { AliasMap, BusinessType, PermGroup } from "./types.js";

export const LEGACY_BUSINESS_GROUPS: PermGroup[] = [
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

export const LEGACY_PLATFORM_GROUPS: PermGroup[] = [
  { module: "pdash", types: "all", perms: ["dashboard.view"] },
  { module: "tenants", types: "all", perms: ["tenants.view", "tenants.manage", "tenants.suspend", "tenants.impersonate"] },
  { module: "pbilling", types: "all", perms: ["plans.manage", "billing.view", "billing.refund"] },
  { module: "content", types: "all", perms: ["content.edit", "content.publish"] },
  { module: "moderation", types: "all", perms: ["moderation.listings", "moderation.kyc"] },
  { module: "system", types: "all", perms: ["staff.view", "staff.manage", "roles.manage", "settings.platform", "audit.view"] },
];

// null = every permission of the type except managing roles and billing (a manager, not an owner).
export const LEGACY_TEMPLATES: Record<BusinessType, [string, string[] | null][]> = {
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

export const LEGACY_PLATFORM_ROLES: Record<string, string[]> = {
  super_admin: ["*"],
  operations: ["dashboard.view", "tenants.view", "tenants.manage", "tenants.suspend", "tenants.impersonate", "moderation.listings", "moderation.kyc", "audit.view", "staff.view"],
  finance: ["dashboard.view", "tenants.view", "plans.manage", "billing.view", "billing.refund"],
  content_editor: ["content.edit", "content.publish", "moderation.listings"],
  support: ["dashboard.view", "tenants.view", "tenants.impersonate", "audit.view"],
};

export const LEGACY_ALIASES: AliasMap = {
  // workspace
  "overview.view": ["workspace.overview.read"],
  "team.view": ["workspace.team.read"],
  "team.manage": ["workspace.team.read", "workspace.team.invite", "workspace.team.update", "workspace.team.remove"],
  "roles.manage": ["workspace.role.read", "workspace.role.create", "workspace.role.update", "workspace.role.delete"],
  "settings.business": ["workspace.settings.update", "workspace.profile.update", "workspace.branding.update", "workspace.branch.create", "workspace.branch.update", "workspace.branch.delete"],
  "billing.manage": ["workspace.billing.manage"],
  // hotel
  "bookings.view": ["hotel.booking.read"],
  "bookings.create": ["hotel.booking.create"],
  "bookings.edit": ["hotel.booking.update"],
  "bookings.cancel": ["hotel.booking.cancel"],
  "calendar.view": ["hotel.calendar.read"],
  "calendar.edit": ["hotel.calendar.update"],
  // pos
  "pos.frontdesk": ["pos.frontdesk.use"],
  "pos.restaurant": ["pos.restaurant.use"],
  "pos.extras": ["pos.extra.create"],
  "pos.discount": ["pos.bill.discount"],
  "pos.void": ["pos.bill.void"],
  "shift.close": ["pos.shift.close"],
  // projects
  "projects.manage": ["projects.project.read", "projects.project.create", "projects.project.update", "projects.project.delete"],
  "progress.post": ["projects.progress.create"],
  "visits.manage": ["projects.visit.read", "projects.visit.create", "projects.visit.update", "projects.visit.delete"],
  "reservations.manage": ["projects.reservation.read", "projects.reservation.create", "projects.reservation.update", "projects.reservation.delete"],
  // collections
  "collect.payments": ["collections.payment.read", "collections.payment.create"],
  "collect.refund": ["collections.payment.refund"],
  // listings
  "listings.manage": ["listings.listing.read", "listings.listing.create", "listings.listing.update", "listings.listing.delete", "listings.listing.publish"],
  "viewings.manage": ["listings.viewing.read", "listings.viewing.create", "listings.viewing.update", "listings.viewing.delete"],
  // crm
  "leads.view": ["crm.lead.read"],
  "leads.assign": ["crm.lead.assign"],
  "customers.view": ["crm.customer.read", "reviews.review.read"],
  "messages.reply": ["crm.message.reply"],
  // rentals
  "rentals.view": ["rentals.rental.read"],
  "rentals.manage": ["rentals.rental.read", "rentals.rental.create", "rentals.rental.update", "rentals.rental.delete"],
  // investments
  "investments.manage": ["investments.offering.read", "investments.offering.create", "investments.offering.update", "investments.offering.delete"],
  "investors.view": ["investments.investor.read"],
  "updates.post": ["investments.update.create"],
  // agreements and people
  "agreements.manage": ["agreements.agreement.read", "agreements.agreement.create", "agreements.agreement.update", "agreements.agreement.delete"],
  "people.view": ["people.person.read"],
  "people.manage": ["people.person.read", "people.person.create", "people.person.update", "people.person.delete"],
  // invoicing
  "invoices.view": ["invoicing.invoice.read"],
  "invoices.create": ["invoicing.invoice.read", "invoicing.invoice.create"],
  "payouts.view": ["invoicing.payout.read"],
  // expenses
  "expenses.view": ["expenses.expense.read", "expenses.recurring.read", "expenses.profit.read"],
  "expenses.manage": ["expenses.expense.read", "expenses.recurring.read", "expenses.profit.read", "expenses.expense.create", "expenses.expense.update", "expenses.expense.delete", "expenses.expense.confirm", "expenses.recurring.create", "expenses.recurring.update", "expenses.recurring.stop"],
  // reviews
  "reviews.reply": ["reviews.review.read", "reviews.review.reply"],
};

// Sheetal staff: the same old names can mean something else here ("roles.manage"), so staff have their own map.
export const LEGACY_PLATFORM_ALIASES: AliasMap = {
  "dashboard.view": ["platform.dashboard.read"],
  "tenants.view": ["platform.business.read"],
  "tenants.manage": ["platform.business.read", "platform.business.create", "platform.business.update"],
  "tenants.suspend": ["platform.business.suspend"],
  "tenants.impersonate": ["platform.business.impersonate"],
  "plans.manage": ["platform.plan.read", "platform.plan.create", "platform.plan.update", "platform.plan.delete"],
  "billing.view": ["platform.billing.read"],
  "billing.refund": ["platform.billing.refund"],
  "content.edit": ["platform.content.update"],
  "content.publish": ["platform.content.publish"],
  "moderation.listings": ["platform.listing.moderate"],
  "moderation.kyc": ["platform.verification.review"],
  "staff.view": ["platform.staff.read"],
  "staff.manage": ["platform.staff.read", "platform.staff.create", "platform.staff.update", "platform.staff.remove"],
  "roles.manage": ["platform.role.manage"],
  "settings.platform": ["platform.settings.read", "platform.settings.update"],
  "audit.view": ["platform.audit.read"],
};
