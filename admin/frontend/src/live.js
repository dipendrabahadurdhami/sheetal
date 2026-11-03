import { useCallback, useEffect, useState } from "react";
import { useStore } from "@sheetal/shared/core/store";
import { adminApi, adminApiReady, signedIn } from "./api";

// When a Sheetal staff member is signed in, the panel runs on the admin API: their real staff role, businesses,
// plans, staff, the audit log and the listing review queue. Screens keep reading the same store, so they barely
// change; their actions call the API (liveAdmin) and then reload. Screens not on the API yet keep their own data.

let staffLive = false;
let reload = null;
/** True once the admin API has confirmed the signed-in person is Sheetal staff. */
export const isStaffLive = () => staffLive;
/** Loads businesses, plans, staff and the audit log again after a change. */
export const adminRefresh = () => reload?.();

const day = (d) => (d ? String(d).slice(0, 10) : null);
const ACTIONS = {
  "admin.tenant_updated": "updated", "admin.tenant_created": "set up", "admin.upgrade_done": "changed the plan of", "admin.upgrade_declined": "declined the upgrade for",
  "admin.staff_added": "added to staff", "admin.staff_role": "changed the staff role of", "admin.staff_removed": "removed from staff",
  "admin.plan_updated": "changed the plan", "admin.plan_created": "added the plan", "listing.approved": "approved listing", "listing.rejected": "sent back listing",
};
const what = (a) => `${ACTIONS[a.action] || a.action.replace(/^\w+\./, "").replace(/_/g, " ")}${a.target ? ` ${a.target}` : ""}`;

const toTenant = (x) => ({
  id: x.id, name: x.name, type: x.type, city: x.city || "", owner: x.owner?.name || x.name, email: x.owner?.email || x.email || "", phone: x.phone || "", pan: x.pan || "",
  planId: x.plan.id, status: x.status, period: x.period, since: day(x.createdAt), renews: day(x.renewsAt), autoRenew: x.autoRenew, emailVerified: true,
  usage: { seats: x.members, listings: x.listings }, scopes: ["Head office"], logoUrl: x.logoUrl,
});
const toStaff = (u) => ({
  id: u.id, name: u.userName, email: u.email, phone: u.phone || "", roleId: `p-${u.platformRole}`, status: u.invited ? "invited" : u.status === "active" ? "active" : "suspended",
  lastActive: u.lastLoginAt, scopes: "all", twofa: false,
});

async function allTenants() {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const r = await adminApi("GET", `/admin/tenants?per=500&page=${page}`);
    out.push(...r.data);
    if (page >= r.meta.last_page) break;
  }
  return out;
}

export function useLiveStaff() {
  const { update } = useStore();
  const [me, setMe] = useState(null);

  useEffect(() => {
    if (!adminApiReady() || !signedIn()) return;
    adminApi("GET", "/admin/me").then(({ data }) => {
      staffLive = true;
      update((d) => { d.session = { ...d.session, platformRoleId: `p-${data.role}`, userName: data.name, userEmail: data.email }; });
      setMe(data);
    }).catch(() => { /* not staff, or the API is off: the panel keeps working on its own data */ });
  }, []);

  const load = useCallback(() => {
    if (!me) return;
    const has = (p) => me.perms.includes("*") || me.perms.includes(p);
    if (has("tenants.view")) {
      allTenants().then((rows) => update((d) => { d.tenants = rows.map(toTenant); })).catch(() => {});
      adminApi("GET", "/admin/plans").then(({ data }) => update((d) => {
        d.plans = data.map((p) => ({ id: p.id, type: p.type, name: p.name, price: p.price, yearly: p.yearly, limits: p.limits, features: p.features, active: p.active, sort: p.sort }));
      })).catch(() => {});
    }
    if (has("staff.view")) {
      adminApi("GET", "/admin/staff").then(({ data }) => update((d) => { d.platformStaff = data.map(toStaff); d.platformInvites = []; })).catch(() => {});
    }
    if (has("audit.view")) {
      adminApi("GET", "/admin/audit").then(({ data }) => update((d) => {
        d.platformActivity = data.map((a) => ({ id: a.id, who: a.actor?.userName || "System", what: what(a), at: a.createdAt }));
      })).catch(() => {});
    }
  }, [me]);
  useEffect(() => { reload = load; load(); return () => { if (reload === load) reload = null; }; }, [load]);
}

/** One business in detail: its team and listings by status (the list only carries counts). */
export function useLiveTenant(id) {
  const [data, setData] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!staffLive || !id) return;
    let gone = false;
    adminApi("GET", `/admin/tenants/${id}`).then((r) => !gone && setData(r.data)).catch(() => {});
    return () => { gone = true; };
  }, [id, tick]);
  return [data, () => setTick((n) => n + 1)];
}

/** Admin actions on the API, each followed by a reload. They resolve with the API's answer, or throw after a toast. */
export const liveAdmin = (toast) => {
  const run = (p) => p.then((r) => { if (r?.message) toast(r.message); adminRefresh(); return r; }).catch((e) => { toast(e.message); throw e; });
  const roleOf = (roleId) => (roleId ? String(roleId).replace(/^p-/, "") : null);
  return {
    updateTenant: (id, patch) => run(adminApi("PATCH", `/admin/tenants/${id}`, patch)),
    addTenant: (b) => run(adminApi("POST", "/admin/tenants", b)),
    savePlan: (p, isNew) => run(isNew
      ? adminApi("POST", "/admin/plans", { type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, active: p.active })
      : adminApi("PATCH", `/admin/plans/${p.id}`, { name: p.name, price: p.price, limits: p.limits, features: p.features, active: p.active })),
    inviteStaff: (list) => Promise.all(list.map((i) => run(adminApi("POST", "/admin/staff", { email: i.email, name: i.name || i.email.split("@")[0], role: roleOf(i.roleId) })).catch(() => null))),
    setStaffRole: (id, roleId) => run(adminApi("PATCH", `/admin/staff/${id}`, { role: roleOf(roleId) })),
    removeStaff: (id) => run(adminApi("PATCH", `/admin/staff/${id}`, { role: null })),
  };
};

/** The listing review queue (oldest first) and the number waiting, refreshed every minute and after each decision. */
export function useReviewQueue(enabled) {
  const [state, setState] = useState({ rows: null, waiting: 0, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let gone = false;
    const load = () => adminApi("GET", "/admin/listings?status=pending")
      .then((r) => !gone && setState({ rows: r.data, waiting: r.meta.waiting, error: null }))
      .catch((e) => !gone && setState((s) => ({ ...s, rows: s.rows || [], error: e.message })));
    load();
    const every = setInterval(load, 60_000);
    return () => { gone = true; clearInterval(every); };
  }, [enabled, tick]);
  return { ...state, reload: () => setTick((n) => n + 1) };
}

export const reviewListing = (id) => adminApi("GET", `/admin/listings/${id}`).then((r) => r.data);
export const decideListing = (id, decision, note) => adminApi("POST", `/admin/listings/${id}/review`, { decision, note });
