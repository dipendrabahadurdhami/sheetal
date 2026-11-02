import { PLATFORM_ROLE_TEMPLATES, roleTemplatesFor } from "../core/rbac";
import { CATALOG } from "../data/catalog";
import { seedOps } from "./ops";

export const VERSION = 17;

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

const TENANTS = [
  { id: "t1", name: "Lakeside Retreat Hotel", type: "hotel", city: "Pokhara", owner: "Dipesh Dhakal", email: "dipesh@lakesideretreat.com.np", phone: "+977 980-1136817", pan: "609874512", planId: "hotel-business", status: "active", since: "2027-01-12", renews: "2027-04-12", usage: { rooms: 28, outlets: 2, seats: 8, featured: 2 }, scopes: ["Rooms and front desk", "Lakeside Café", "Rooftop Bar"] },
  { id: "t2", name: "Shetal Heights Developers", type: "developer", city: "Lalitpur", owner: "Dipesh Dhakal", email: "sales@shetalheights.com.np", phone: "+977 984-1234567", pan: "610245789", planId: "developer-pro", status: "active", since: "2026-11-03", renews: "2027-05-03", usage: { projects: 3, units: 240, seats: 6, featured: 3 }, scopes: ["Shetal Heights", "Bhaisepati Villas", "Imadol Residency"] },
  { id: "t3", name: "Himalayan Homes Realty", type: "agency", city: "Kathmandu", owner: "Ramesh Karki", email: "info@himalayanhomes.com.np", phone: "+977 985-1012345", pan: "605513278", planId: "agency-business", status: "active", since: "2026-09-21", renews: "2027-03-21", usage: { listings: 84, seats: 6, featured: 5 }, scopes: ["Baneshwor branch", "Lalitpur branch"] },
  { id: "t4", name: "Fewa View Villa", type: "host", city: "Pokhara", owner: "Dipesh Dhakal", email: "stay@fewaview.com.np", phone: "+977 981-5566778", pan: "612003114", planId: "host-starter", status: "active", since: "2027-02-01", renews: "2027-03-08", usage: { units: 1, seats: 2, featured: 0 }, scopes: ["Fewa View Villa"] },
  { id: "t5", name: "Chitwan Jungle Lodge Pvt. Ltd.", type: "sponsor", city: "Chitwan", owner: "Anita Shrestha", email: "invest@chitwanlodge.com.np", phone: "+977 986-4433221", pan: "613347820", planId: "sponsor-pro", status: "pending_verification", since: "2027-02-26", renews: "2027-03-26", usage: { investments: 1, seats: 3, featured: 0 }, scopes: ["Sauraha lodge"] },
  { id: "t6", name: "Nagarkot Sunrise Resort", type: "hotel", city: "Bhaktapur", owner: "Sanjay Maharjan", email: "gm@nagarkotsunrise.com", phone: "+977 980-2223344", pan: "604412398", planId: "hotel-pro", status: "active", since: "2026-06-14", renews: "2027-06-14", usage: { rooms: 62, outlets: 4, seats: 21, featured: 6 }, scopes: ["Main block", "Sunrise Restaurant", "Spa"] },
  { id: "t7", name: "Kathmandu Property Point", type: "agency", city: "Kathmandu", owner: "Bishal Thapa", email: "hello@ktmpropertypoint.com", phone: "+977 982-7788990", pan: "614552103", planId: "agency-business", status: "trial", since: "2027-02-22", renews: "2027-03-08", usage: { listings: 12, seats: 2, featured: 0 }, scopes: ["Head office"] },
  { id: "t8", name: "Lumbini Garden Homestay", type: "host", city: "Rupandehi", owner: "Gita Pokharel", email: "lumbinigarden@gmail.com", phone: "+977 984-6655443", pan: "611120987", planId: "host-business", status: "past_due", since: "2026-10-05", renews: "2027-02-25", usage: { units: 2, seats: 1, featured: 0 }, scopes: ["Homestay"] },
  { id: "t9", name: "Valley Builders & Developers", type: "developer", city: "Bhaktapur", owner: "Rabin Shakya", email: "projects@valleybuilders.com.np", phone: "+977 985-3344556", pan: "607789201", planId: "developer-business", status: "active", since: "2026-08-30", renews: "2027-08-30", usage: { projects: 2, units: 186, seats: 7, featured: 1 }, scopes: ["Suryabinayak Homes", "Thimi Towers"] },
  { id: "t10", name: "Bandipur Heritage Inn", type: "hotel", city: "Tanahun", owner: "Krishna Shrestha", email: "bandipurinn@gmail.com", phone: "+977 986-1122334", pan: "608812345", planId: "hotel-business", status: "suspended", since: "2026-05-11", renews: "2027-01-11", usage: { rooms: 12, outlets: 1, seats: 2, featured: 0 }, scopes: ["Inn"] },
  { id: "t11", name: "Everest Realty Group", type: "agency", city: "Lalitpur", owner: "Pasang Sherpa", email: "contact@everestrealty.com.np", phone: "+977 980-9988776", pan: "603398712", planId: "agency-pro", status: "active", since: "2026-03-18", renews: "2027-03-18", usage: { listings: 312, seats: 18, featured: 14 }, scopes: ["Pulchowk", "Boudha", "Pokhara"] },
  { id: "t12", name: "Thamel Boutique Apartments", type: "host", city: "Kathmandu", owner: "Nirmala Joshi", email: "stay@thamelboutique.com", phone: "+977 981-2233445", pan: "615567432", planId: "host-business", status: "active", since: "2026-12-09", renews: "2027-03-09", usage: { units: 8, seats: 4, featured: 2 }, scopes: ["Thamel block A", "Thamel block B"] },
  { id: "t13", name: "Sheetal Property", type: "agency", city: "Kathmandu", owner: "Sheetal Property", email: "shetalrealestate@gmail.com", phone: "+977 980-1136817", pan: "", planId: "agency-pro", status: "active", emailVerified: true, period: 12, since: "2027-03-02", renews: "2028-03-02", usage: { listings: 2680, seats: 1, featured: 0 }, scopes: ["Head office"] },
];

const M = (id, name, email, phone, roleKey, status, last, scopes, twofa = true) => ({ id, name, email, phone, roleKey, status, lastActive: last, scopes, twofa });

const MEMBERS = {
  t1: [
    M("m1", "Dipesh Dhakal", "dipesh@lakesideretreat.com.np", "980-1136817", "owner", "active", "2027-03-02T09:58", "all"),
    M("m2", "Sunita Karki", "sunita@lakesideretreat.com.np", "981-2345678", "manager", "active", "2027-03-02T09:41", "all"),
    M("m3", "Bikash Thapa", "bikash@lakesideretreat.com.np", "984-1122334", "frontdesk", "active", "2027-03-02T08:12", ["Rooms and front desk"]),
    M("m4", "Anjali Rai", "anjali@lakesideretreat.com.np", "986-7788990", "frontdesk", "active", "2027-03-01T22:47", ["Rooms and front desk"], false),
    M("m5", "Ramesh Shrestha", "ramesh@lakesideretreat.com.np", "980-4455667", "cashier", "active", "2027-03-01T21:30", ["Lakeside Café", "Rooftop Bar"], false),
    M("m6", "Maya Tamang", "maya@lakesideretreat.com.np", "982-6677889", "housekeeping", "active", "2027-03-02T07:05", ["Rooms and front desk"], false),
    M("m7", "Kiran Joshi", "kiran@ledgerworks.com.np", "985-9900112", "accountant", "active", "2027-02-28T16:20", "all"),
    M("m8", "Prakash Magar", "prakash@lakesideretreat.com.np", "981-3344556", "c1", "suspended", "2027-02-10T23:55", ["Rooms and front desk"], false),
  ],
  t2: [
    M("m1", "Dipesh Dhakal", "dipesh@shetalheights.com.np", "980-1136817", "owner", "active", "2027-03-02T09:30", "all"),
    M("m2", "Suman Adhikari", "suman@shetalheights.com.np", "984-5566778", "sales_manager", "active", "2027-03-02T09:12", "all"),
    M("m3", "Pooja Shrestha", "pooja@shetalheights.com.np", "981-6677880", "sales_exec", "active", "2027-03-01T18:44", ["Shetal Heights"]),
    M("m4", "Hari Bhandari", "hari@shetalheights.com.np", "986-3344221", "site_engineer", "active", "2027-03-02T07:50", ["Shetal Heights", "Bhaisepati Villas"], false),
    M("m5", "Kiran Joshi", "kiran@ledgerworks.com.np", "985-9900112", "accountant", "active", "2027-02-27T15:02", "all"),
  ],
  t3: [
    M("m1", "Ramesh Karki", "ramesh@himalayanhomes.com.np", "985-1012345", "owner", "active", "2027-03-02T09:20", "all"),
    M("m2", "Sita Gurung", "sita@himalayanhomes.com.np", "984-1010101", "branch_manager", "active", "2027-03-02T08:45", ["Baneshwor branch"]),
    M("m3", "Hari Bhandari", "hari.bhandari@himalayanhomes.com.np", "980-0000003", "agent", "active", "2027-03-01T17:10", ["Baneshwor branch"]),
    M("m4", "Gita Rai", "gita.rai@himalayanhomes.com.np", "980-0000004", "agent", "active", "2027-03-02T09:01", ["Lalitpur branch"], false),
  ],
  t13: [
    M("m1", "Sheetal Property", "shetalrealestate@gmail.com", "980-1136817", "owner", "active", "2027-03-02T09:40", "all"),
    M("m2", "Sita Gurung", "sita@sheetalproperty.com", "984-1010101", "branch_manager", "active", "2027-03-02T09:10", "all"),
    M("m3", "Hari Bhandari", "hari@sheetalproperty.com", "980-0000003", "agent", "active", "2027-03-01T17:30", "all", false),
  ],
  t4: [
    M("m1", "Dipesh Dhakal", "dipesh@fewaview.com.np", "980-1136817", "owner", "active", "2027-03-02T08:00", "all"),
    M("m2", "Laxmi Gurung", "laxmi@fewaview.com.np", "981-4455112", "cleaner", "active", "2027-03-01T11:00", "all", false),
  ],
};

const INVITES = {
  t1: [
    { id: "i1", email: "rohan.kc@gmail.com", roleKey: "frontdesk", scopes: ["Rooms and front desk"], by: "Sunita Karki", sent: "2027-02-27T11:20", expires: "2027-03-06T11:20", status: "pending", lang: "ne" },
    { id: "i2", email: "nisha.bar@gmail.com", roleKey: "cashier", scopes: ["Rooftop Bar"], by: "Dipesh Dhakal", sent: "2027-02-18T15:00", expires: "2027-02-25T15:00", status: "expired", lang: "en" },
  ],
  t2: [{ id: "i1", email: "arjun.sales@gmail.com", roleKey: "sales_exec", scopes: ["Imadol Residency"], by: "Suman Adhikari", sent: "2027-03-01T10:00", expires: "2027-03-08T10:00", status: "pending", lang: "en" }],
};

const ACTIVITY = {
  t1: [
    { id: "a1", who: "Sunita Karki", what: "invited rohan.kc@gmail.com as Front desk", at: "2027-02-27T11:20" },
    { id: "a2", who: "Dipesh Dhakal", what: "suspended Prakash Magar", at: "2027-02-11T09:02" },
    { id: "a3", who: "Dipesh Dhakal", what: "created role Night auditor", at: "2027-02-05T18:30" },
    { id: "a4", who: "Sunita Karki", what: "changed Anjali Rai from Housekeeping to Front desk", at: "2027-01-28T13:15" },
  ],
};

const PLATFORM_STAFF = [
  M("s1", "Sheetal Admin", "admin@sheetalproperty.com", "980-1136817", "super_admin", "active", "2027-03-02T10:00", "all"),
  M("s2", "Asha Pandey", "asha@sheetalproperty.com", "981-1100223", "operations", "active", "2027-03-02T09:35", "all"),
  M("s3", "Rajan K.C.", "rajan@sheetalproperty.com", "984-2200334", "finance", "active", "2027-03-01T17:48", "all"),
  M("s4", "Srijana Lama", "srijana@sheetalproperty.com", "986-3300445", "content_editor", "active", "2027-03-02T08:20", "all", false),
];

const LISTINGS = [
  { id: "L-1042", tenantId: "t3", kind: "sell", title: "4 BHK house for sale in Budhanilkantha", status: "published", price: 32000000, views: 1284, leads: 14, updated: "2027-02-28" },
  { id: "L-1043", tenantId: "t3", kind: "rentout", title: "Furnished 2 BHK flat for rent in Jhamsikhel", status: "published", price: 45000, views: 902, leads: 22, updated: "2027-03-01" },
  { id: "L-1051", tenantId: "t3", kind: "sell", title: "8 aana residential plot in Bhaisepati", status: "in_review", price: 24000000, views: 0, leads: 0, updated: "2027-03-02" },
  { id: "L-1055", tenantId: "t3", kind: "rentout", title: "Shutter for rent on Baneshwor main road", status: "draft", price: 38000, views: 0, leads: 0, updated: "2027-03-02" },
  { id: "S-201", tenantId: "t1", kind: "stay_hotel", title: "Lakeside Retreat Hotel", status: "published", price: 4500, views: 5320, leads: 46, updated: "2027-02-20" },
  { id: "S-202", tenantId: "t1", kind: "stay_unit", title: "Garden villa at Lakeside Retreat", status: "published", price: 12000, views: 1880, leads: 9, updated: "2027-02-22" },
  { id: "P-31", tenantId: "t2", kind: "project", title: "Shetal Heights, Bhaisepati", status: "published", price: 8500000, views: 7410, leads: 63, updated: "2027-02-25" },
  { id: "S-301", tenantId: "t4", kind: "stay_unit", title: "Fewa View Villa, Sedi", status: "published", price: 12000, views: 2410, leads: 18, updated: "2027-02-14" },
  // Sheetal Property: imported from the old site, all live. Each has a check date for Listing check-ups;
  // `suggest` holds values read from the old title and description that the team confirms in a check-up.
  { id: "L-2001", tenantId: "t13", kind: "sell", title: "Residential land for sale in Budhanilkantha", status: "published", price: 37000000, views: 2214, leads: 19, updated: "2027-03-01", lastChecked: "2027-01-10", checkDue: "2027-04-10", values: { location: { area: "Budhanilkantha" }, pin: { lat: 27.7731, lng: 85.3634 } } },
  { id: "L-2002", tenantId: "t13", kind: "rentout", title: "Office space for rent in Gairidhara", status: "published", price: 342000, views: 980, leads: 7, updated: "2027-02-27", lastChecked: "2026-12-05", checkDue: "2027-03-04", values: { location: { area: "Gairidhara" }, pin: { lat: 27.7199, lng: 85.3285 } } },
  { id: "L-2003", tenantId: "t13", kind: "sell", title: "House on sale at dhapasi", status: "published", price: 33000000, views: 412, leads: 3, updated: "2027-03-02", checkDue: "2027-02-20",
    suggest: [{ field: "title", label: "Title", from: "House on sale at dhapasi", to: "House for sale in Dhapasi, 5 aana" }, { field: "category", label: "Type", from: "Residential Bungalow (old)", to: "House" }, { field: "landArea", label: "Land area", from: "", to: "5 aana" }, { field: "roadWidth", label: "Road", from: "", to: "13 ft black-topped" }] },
  { id: "L-2004", tenantId: "t13", kind: "rentout", title: "commercial Space On Rent At chakrapath", status: "published", price: 70000, views: 288, leads: 2, updated: "2027-03-02",
    suggest: [{ field: "title", label: "Title", from: "commercial Space On Rent At chakrapath", to: "Commercial space for rent in Chakrapath" }, { field: "category", label: "Type", from: "Home (old)", to: "Commercial" }, { field: "area", label: "Area", from: "chakrapat", to: "Chakrapath" }] },
  { id: "L-2005", tenantId: "t13", kind: "rentout", title: "Full furnished house on rent at Maitrinagar", status: "published", price: 80000, views: 351, leads: 4, updated: "2027-03-02", checkDue: "2027-03-03",
    suggest: [{ field: "bedrooms", label: "Bedrooms", from: "", to: "4" }, { field: "bathrooms", label: "Bathrooms", from: "", to: "3" }, { field: "furnishing", label: "Furnishing", from: "", to: "Fully furnished" }] },
  { id: "L-2006", tenantId: "t13", kind: "sell", title: "4 BHK house for sale in Bhaisepati", status: "published", price: 42500000, views: 640, leads: 6, updated: "2027-02-15", lastChecked: "2026-11-28", checkDue: "2027-02-28" },
  { id: "L-2007", tenantId: "t13", kind: "rentout", title: "2 BHK flat for rent in Baneshwor", status: "published", price: 35000, views: 1190, leads: 15, updated: "2027-02-25", lastChecked: "2027-02-25", checkDue: "2027-05-25" },
  { id: "L-2008", tenantId: "t13", kind: "sell", title: "8 aana land for sale in Kapan", status: "published", price: 21000000, views: 377, leads: 2, updated: "2027-01-20", lastChecked: "2026-12-30", checkDue: "2027-03-05",
    suggest: [{ field: "roadWidth", label: "Road", from: "", to: "16 ft" }, { field: "facing", label: "Facing", from: "", to: "East" }] },
];

const CONTACTS = {
  t3: [
    { id: "c1", name: "Shyam Prasad Adhikari", role: "seller", phone: "984-1234500", citizenship: "27-01-74-01234", district: "Kathmandu", father: "Hari Prasad Adhikari", grandfather: "Tika Ram Adhikari", address: "Budhanilkantha-3, Kathmandu" },
    { id: "c2", name: "Rita Maharjan", role: "buyer", phone: "981-5550011", citizenship: "25-02-70-05678", district: "Lalitpur", father: "Krishna Maharjan", grandfather: "Bhim Maharjan", address: "Patan-11, Lalitpur" },
    { id: "c3", name: "Binod Gautam", role: "landlord", phone: "980-7712345", citizenship: "27-01-68-09876", district: "Kathmandu", father: "Shiva Gautam", grandfather: "Dhan Gautam", address: "Jhamsikhel, Lalitpur-3" },
    { id: "c4", name: "Ankit Sharma", role: "tenant", phone: "986-0044556", citizenship: "31-01-79-04411", district: "Kaski", father: "Mohan Sharma", grandfather: "Gopal Sharma", address: "Pokhara-8, Kaski" },
  ],
};

const AGREEMENTS = {
  t3: [
    { id: "AG-2027-0019", template: "baina", title: "Bainā for 4 BHK house, Budhanilkantha", listingId: "L-1042", parties: { first: "c1", second: "c2" }, amount: 1500000, total: 32000000, deadline: "2027-03-31", status: "signed", created: "2027-02-20", signed: { first: "2027-02-20T14:10", second: "2027-02-20T14:32" }, docs: { lalpurja: true, citizenship: true, charkilla: true, trace: true, tiro: false, naksa: true } },
    { id: "AG-2027-0021", template: "rent", title: "Rent agreement, 2 BHK Jhamsikhel", listingId: "L-1043", parties: { first: "c3", second: "c4" }, amount: 45000, deposit: 90000, deadline: "2028-03-14", status: "sent", created: "2027-03-01", signed: { first: "2027-03-01T16:00" }, docs: { citizenship: true, lalpurja: true } },
    { id: "AG-2027-0022", template: "commission", title: "Commission agreement with Shyam Prasad Adhikari", listingId: "L-1042", parties: { first: "c1" }, amount: 2, deadline: "2027-08-20", status: "draft", created: "2027-03-02", signed: {}, docs: {} },
  ],
};

export function seed() {
  const tenantRoles = {};
  TENANTS.forEach((t) => {
    tenantRoles[t.id] = roleTemplatesFor(t.type).map((r) => ({ ...r, id: `${t.id}-${r.key}` }));
  });
  tenantRoles.t1.push({ id: "t1-c1", key: "c1", system: false, name: "Night auditor", desc: "Closes the day after 22:00, checks folios and the cash drawer.", perms: ["overview.view", "bookings.view", "pos.frontdesk", "shift.close", "invoices.view"] });

  const members = {}; const invites = {};
  TENANTS.forEach((t) => {
    const list = MEMBERS[t.id] || [M("m1", t.owner, t.email, t.phone, "owner", "active", "2027-03-01T12:00", "all")];
    members[t.id] = list.map(({ roleKey, ...m }) => ({ ...m, roleId: `${t.id}-${roleKey}` }));
    invites[t.id] = (INVITES[t.id] || []).map(({ roleKey, ...i }) => ({ ...i, roleId: `${t.id}-${roleKey}` }));
  });
  const platformRoles = PLATFORM_ROLE_TEMPLATES.map((r) => ({ ...r, id: `p-${r.key}` }));

  return {
    version: VERSION,
    session: {
      userName: "Sheetal Admin", userEmail: "admin@sheetalproperty.com", lang: "en", theme: "light",
      platformRoleId: "p-super_admin", tenantId: "t13", previewRoleId: null, memberships: ["t13", "t1", "t2", "t3", "t4"], impersonating: null,
    },
    plans: PLANS,
    // Auto-renew is off for everyone until a super admin turns it on.
    tenants: TENANTS.map((t) => ({ autoRenew: false, ...t })),
    tenantRoles, members, invites,
    activity: { t1: ACTIVITY.t1, t2: [], t3: [], t4: [], t13: [] },
    platformRoles,
    platformStaff: PLATFORM_STAFF.map(({ roleKey, ...m }) => ({ ...m, roleId: `p-${roleKey}` })),
    platformInvites: [{ id: "pi1", email: "manish@sheetalproperty.com", roleId: "p-support", scopes: "all", by: "Dipesh Dhakal", sent: "2027-03-01T09:00", expires: "2027-03-08T09:00", status: "pending", lang: "en" }],
    platformActivity: [
      { id: "pa1", who: "Asha Pandey", what: "approved verification for Thamel Boutique Apartments", at: "2027-03-01T15:40" },
      { id: "pa2", who: "Rajan K.C.", what: "changed Hotel Business price to Rs. 9,900", at: "2027-02-26T11:05" },
      { id: "pa3", who: "Dipesh Dhakal", what: "suspended Bandipur Heritage Inn", at: "2027-02-12T10:30" },
    ],
    revenue: [{ m: "Oct", v: 61200 }, { m: "Nov", v: 68400 }, { m: "Dec", v: 74900 }, { m: "Jan", v: 81300 }, { m: "Feb", v: 88600 }],
    catalog: structuredClone(CATALOG),
    listings: LISTINGS,
    drafts: {},
    contacts: CONTACTS,
    agreements: AGREEMENTS,
    platformSettings: {
      siteName: "Sheetal Property", supportEmail: "support@sheetalproperty.com", supportPhone: "+977 980-1136817", timezone: "Asia/Kathmandu", showBS: true,
      mainDomain: "sheetalproperty.com", adminPath: "/admin", businessPath: "/business", businessDomain: "business.sheetalproperty.com", businessDomainLive: false,
      gateways: { fonepay: true, esewa: true, khalti: true, imepay: true, connectips: true, prabhupay: false, nps_card: true, bank: true, cash: true, visa_mc: true, unionpay: false, paypal: false, stripe: false, alipay: false },
      gatewayKeys: { khalti_public: "live_public_key_3f8a…", khalti_secret: "••••••••••••", esewa_merchant: "EPAYTEST", fonepay_merchant: "SHETAL01" },
      commission: { stays: 10, projects: 1, agency: 0, investments: 2 }, vat: 13, serviceCharge: 10, payoutDay: "friday", payoutHoldDays: 2,
      email: { from: "Sheetal Property <no-reply@sheetalproperty.com>" }, whatsapp: true,
      languages: { en: true, ne: true }, defaultLang: "en",
      security: { staff2fa: true, business2fa: false, sessionHours: 12, ipAllow: "" },
      trialDays: 14, graceDays: 7, autoSuspend: true, kycRequired: true,
    },
    tenantSettings: {},
    ops: { t1: seedOps() },
    checkups: { t13: { settings: { perDay: 3 }, log: [
      { id: "ck3", at: "2027-03-01T16:20", listingId: "L-2007", title: "2 BHK flat for rent in Baneshwor", action: "ok", by: "Hari Bhandari", detail: "" },
      { id: "ck2", at: "2027-03-01T11:05", listingId: "L-1999", title: "Shutter for rent in Kalanki", action: "sold", by: "Sita Gurung", detail: "" },
      { id: "ck1", at: "2027-02-28T15:42", listingId: "L-2001", title: "Residential land for sale in Budhanilkantha", action: "extend", by: "Sita Gurung", detail: "Next check 10 Apr 2027." },
      { id: "ck0", at: "2027-02-28T10:12", listingId: "L-1998", title: "Flat for rent in Sanepa", action: "skip", by: "Hari Bhandari", detail: "" },
    ] } },
    channels: { whatsapp: true, messenger: true, instagram: true, web: true, sms: true, email: true },
  };
}
