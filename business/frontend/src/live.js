import { useCallback, useEffect } from "react";
import { useStore } from "@sheetal/shared/core/store";
import { bizApi, bizApiReady, setActiveTenant, signedIn } from "./api";

// When someone is signed in, the panel shows their real businesses, their own role, and the team, roles and
// invitations of the business they have open, from the business API. Screens still read the same store, so
// nothing else changes for them; team actions call the API and then reload (see liveRefresh).
// Modules not on the API yet (listings, bookings…) keep their current data until their phase.

const liveIds = new Set();
let reload = null;
/** True when this business comes from the API (its team actions must go through the API). */
export const isLive = (tenantId) => liveIds.has(tenantId);
/** Reloads the team of the open business after a change. */
export const liveRefresh = () => reload?.();

const day = (d) => (d ? String(d).slice(0, 10) : null);
const toTenant = (w, prev = {}) => ({
  ...prev, id: w.id, name: w.name, type: w.type, city: w.city || "", owner: prev.owner || w.name, email: w.email || "", phone: w.phone || "", pan: prev.pan || "",
  planId: w.plan.id, status: w.status, emailVerified: true, period: w.period, since: day(w.createdAt), renews: day(w.renewsAt), autoRenew: w.autoRenew,
  usage: prev.usage || { listings: 0, seats: 1, featured: 0 }, scopes: prev.scopes || ["Head office"], logoUrl: w.logoUrl,
});
const toMember = (m) => ({ id: m.id, name: m.name, email: m.email, phone: m.phone || "", roleId: m.roleId, status: m.status === "paused" ? "suspended" : m.status, lastActive: m.lastActive, scopes: m.scopes, twofa: false });
const toInvite = (i) => ({ id: i.id, email: i.email, roleId: i.roleId, scopes: i.scopes, status: i.status, sent: i.sent, expires: i.expires, by: i.by || "" });
const toRole = (r) => ({ id: r.id, key: r.key, name: r.name || undefined, perms: r.perms, system: r.system });

export function useLiveWorkspace() {
  const { db, update } = useStore();
  const current = db.session.tenantId;

  // 1 Who is signed in and which businesses they belong to.
  useEffect(() => {
    if (!bizApiReady() || !signedIn()) return;
    bizApi("GET", "/workspaces").then(({ data }) => {
      if (!data.workspaces.length) return;
      data.workspaces.forEach((w) => liveIds.add(w.id));
      update((d) => {
        const keep = data.workspaces.some((w) => w.id === d.session.tenantId) ? d.session.tenantId : data.workspaces[0].id;
        d.tenants = [...data.workspaces.map((w) => toTenant(w, d.tenants.find((t) => t.id === w.id))), ...d.tenants.filter((t) => !liveIds.has(t.id) && t.id !== "t13")];
        d.session = { ...d.session, userName: data.user.name, userEmail: data.user.email, memberships: data.workspaces.map((w) => w.id), tenantId: keep, liveRoles: Object.fromEntries(data.workspaces.map((w) => [w.id, w.role.id])) };
        for (const w of data.workspaces) {
          d.tenantRoles[w.id] = d.tenantRoles[w.id] || [toRole(w.role)];
          d.members[w.id] = d.members[w.id] || [];
          d.invites[w.id] = d.invites[w.id] || [];
          d.activity[w.id] = d.activity[w.id] || [];
        }
      });
    }).catch(() => { /* not signed in on the API, or it's off: the panel keeps working on its own data */ });
  }, []);

  // 2 The open business's team, roles and invitations.
  const loadTeam = useCallback(() => {
    if (!isLive(current)) return;
    setActiveTenant(current);
    bizApi("GET", "/team").then(({ data }) => update((d) => {
      d.members[current] = data.members.map(toMember);
      d.invites[current] = data.invites.map(toInvite);
      d.tenantRoles[current] = data.roles.map(toRole);
      d.activity[current] = data.activity.map((a) => ({ id: a.id, who: a.who, what: `${a.what.replace(/^\w+\./, "").replace(/_/g, " ")}${a.target ? ` ${a.target}` : ""}`, at: a.at }));
      const t = d.tenants.find((x) => x.id === current);
      if (t) t.usage = { ...t.usage, seats: data.seats.used };
    })).catch(() => {});
  }, [current]);
  useEffect(() => { reload = loadTeam; loadTeam(); return () => { if (reload === loadTeam) reload = null; }; }, [loadTeam]);
}

/** Team actions for a business from the API, with the same shape the team screens already use. */
export const liveTeam = (toast) => {
  const run = (p) => p.then((r) => { if (r?.message) toast(r.message); liveRefresh(); return r; }).catch((e) => { toast(e.message); liveRefresh(); });
  return {
    onInvite: (list) => run(bizApi("POST", "/team/invites", { invites: list.map((i) => ({ email: i.email, roleId: i.roleId, scopes: i.scopes || "all" })) })),
    onUpdateMember: (id, patch) => {
      const body = { roleId: patch.roleId, scopes: patch.scopes, status: patch.status ? (patch.status === "suspended" ? "paused" : "active") : undefined };
      if (Object.values(body).every((v) => v === undefined)) return; // two-step sign-in is managed per person, not here
      run(bizApi("PATCH", `/team/members/${id}`, body));
    },
    onRemoveMember: (id) => run(bizApi("DELETE", `/team/members/${id}`)),
    onRestoreMember: () => toast("Invite them again to bring them back."),
    onResend: (id) => run(bizApi("POST", `/team/invites/${id}/resend`)),
    onRevoke: (id) => run(bizApi("POST", `/team/invites/${id}/revoke`)),
    onCreateRole: (r) => { run(bizApi("POST", "/team/roles", { name: r.name, perms: r.perms })); return undefined; },
    onSaveRole: (r) => run(bizApi("PATCH", `/team/roles/${r.id}`, { name: r.name, perms: r.perms })),
    onDeleteRole: (id) => run(bizApi("DELETE", `/team/roles/${id}`)),
  };
};
