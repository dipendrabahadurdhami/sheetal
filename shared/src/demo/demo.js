import { PLATFORM_ROLE_TEMPLATES, roleTemplatesFor } from "../core/rbac";
import { CATALOG } from "../data/catalog";
import { TODAY } from "../core/format";

export const VERSION = 18;

// Plans: every business type has the same three. limit -1 = unlimited.
// Starter is free, renews itself every month, and every new account starts on it: one listing, the basics only.
// Paid plans can be bought for 1, 3, 6 or 12 months (see PERIODS in core/plans.js); `yearly` is the 12-month price.
// Business unlocks the tools of the account's own type. Pro unlocks every listing kind and module in one workspace.
const OFF = { pos: false, channel_sync: false, agreements: false, api: false, custom_roles: false, multi_property: false, all_kinds: false };
const PRO_FEATURES = { pos: true, channel_sync: true, agreements: true, api: true, custom_roles: true, multi_property: true, all_kinds: true };
const PRO_LIMITS = { listings: -1, stays: 10, rooms: -1, units: -1, outlets: 10, projects: 10, investments: 5, seats: 25, featured: 20 };
const TYPE_PLANS = {
  hotel: { starter: { rooms: 10, outlets: 0 }, business: { rooms: 40, outlets: 3 }, features: { pos: true, channel_sync: true, agreements: true, custom_roles: true, multi_property: true } },
  host: { starter: { units: 1 }, business: { units: 10 }, features: { pos: true, channel_sync: true, agreements: true, custom_roles: true, multi_property: true } },
  developer: { starter: { projects: 1, units: 50 }, business: { projects: 2, units: 300 }, features: { agreements: true, custom_roles: true, multi_property: true } },
  agency: { starter: { listings: 1 }, business: { listings: 150 }, features: { agreements: true, custom_roles: true, multi_property: true } },
  sponsor: { starter: { investments: 1 }, business: { investments: 3 }, features: { agreements: true, custom_roles: true } },
};
export const PLANS = Object.entries(TYPE_PLANS).flatMap(([type, x]) => [
  { id: `${type}-starter`, type, name: "Starter", price: 0, yearly: 0, limits: { ...x.starter, seats: 1, featured: 0 }, features: { ...OFF }, active: true },
  { id: `${type}-business`, type, name: "Business", price: 1500, yearly: 10980, limits: { ...x.business, seats: 10, featured: 8 }, features: { ...OFF, ...x.features }, active: true },
  { id: `${type}-pro`, type, name: "Pro", price: 3000, yearly: 21960, limits: { ...PRO_LIMITS }, features: { ...PRO_FEATURES }, active: true },
]);

// Real starting data only: Sheetal Property and the super admin. Every other business, listing, booking,
// lead and invoice comes from the backend (and the old-site import), not from here.
const today = TODAY.slice(0, 10);
const inOneYear = (() => { const d = new Date(`${today}T00:00:00Z`); d.setUTCFullYear(d.getUTCFullYear() + 1); return d.toISOString().slice(0, 10); })();

const TENANTS = [
  { id: "t13", name: "Sheetal Property", type: "agency", city: "Kathmandu", owner: "Sheetal Property", email: "shetalrealestate@gmail.com", phone: "+977 980-1136817", pan: "", planId: "agency-pro", status: "active", emailVerified: true, period: 12, since: today, renews: inOneYear, usage: { listings: 0, seats: 1, featured: 0 }, scopes: ["Head office"] },
];

// A team member with their role id.
const M = (id, name, email, phone, roleId, status, last, scopes, twofa = true) => ({ id, name, email, phone, roleId, status, lastActive: last, scopes, twofa });

export function seed() {
  const tenantRoles = {}, members = {}, invites = {};
  TENANTS.forEach((t) => {
    tenantRoles[t.id] = roleTemplatesFor(t.type).map((r) => ({ ...r, id: `${t.id}-${r.key}` }));
    members[t.id] = [M("m1", t.owner, t.email, t.phone, `${t.id}-owner`, "active", TODAY, "all")];
    invites[t.id] = [];
  });
  const platformRoles = PLATFORM_ROLE_TEMPLATES.map((r) => ({ ...r, id: `p-${r.key}` }));

  return {
    version: VERSION,
    session: {
      userName: "Sheetal Admin", userEmail: "admin@sheetalproperty.com", lang: "en", theme: "light",
      platformRoleId: "p-super_admin", tenantId: "t13", previewRoleId: null, memberships: ["t13"], impersonating: null,
    },
    plans: PLANS,
    // Auto-renew is off for everyone until a super admin turns it on.
    tenants: TENANTS.map((t) => ({ autoRenew: false, ...t })),
    tenantRoles, members, invites,
    activity: { t13: [] },
    platformRoles,
    platformStaff: [M("s1", "Sheetal Admin", "admin@sheetalproperty.com", "980-1136817", "p-super_admin", "active", TODAY, "all")],
    platformInvites: [],
    platformActivity: [],
    revenue: [],
    catalog: structuredClone(CATALOG),
    listings: [],
    drafts: {},
    contacts: {},
    agreements: {},
    platformSettings: {
      siteName: "Sheetal Property", supportEmail: "support@sheetalproperty.com", supportPhone: "+977 980-1136817", timezone: "Asia/Kathmandu", showBS: true,
      mainDomain: "sheetalproperty.com", adminPath: "/admin", businessPath: "/business", businessDomain: "business.sheetalproperty.com", businessDomainLive: false,
      gateways: { fonepay: true, esewa: true, khalti: true, imepay: true, connectips: true, prabhupay: false, nps_card: true, bank: true, cash: true, visa_mc: true, unionpay: false, paypal: false, stripe: false, alipay: false },
      // Entered in Admin → Settings → Payments; empty until the real merchant accounts are added.
      gatewayKeys: { khalti_public: "", khalti_secret: "", esewa_merchant: "", fonepay_merchant: "" },
      commission: { stays: 10, projects: 1, agency: 0, investments: 2 }, vat: 13, serviceCharge: 10, payoutDay: "friday", payoutHoldDays: 2,
      email: { from: "Sheetal Property <no-reply@sheetalproperty.com>" }, whatsapp: true,
      languages: { en: true, ne: true }, defaultLang: "en",
      security: { staff2fa: true, business2fa: false, sessionHours: 12, ipAllow: "" },
      trialDays: 14, graceDays: 7, autoSuspend: true, kycRequired: true,
    },
    tenantSettings: {},
    ops: {},
    checkups: {},
    channels: { whatsapp: true, messenger: true, instagram: true, web: true, sms: false, email: true },
  };
}
