// Loads a signed-in person's real data into the panel and sends their changes to the business API.
// Where it fits: useLiveWorkspace() runs once in BusinessApp; screens keep reading the same store.
// How it works: loads the person's businesses and role, then the open business's team, branches, listings, leads
// and unread email (every minute); exports the actions screens call (team, listings, leads, branches, branding,
// profile, add a business) and reload helpers.
// Rules: isLive(tenantId) tells a screen whether to use the API or the sample data.

import { useCallback, useEffect, useState } from "react";
import { useStore } from "@sheetal/shared/core/store";
import { emptyOps } from "@sheetal/shared/demo/ops";
import { brandTheme } from "@sheetal/shared/core/palette";
import { bizApi, bizApiReady, fileToBase64, setActiveTenant, signedIn } from "./api";
import { branchBody } from "./access/branchAccess";
import { takeSupportTokenFromUrl } from "@sheetal/sdk/support";

// A Sheetal support session opened from the admin panel arrives as #support=… : keep it for this tab and clean the address bar, before the first API call.
takeSupportTokenFromUrl();

const liveIds = new Set();
let reload = null;
/** True when this business comes from the API (its team actions must go through the API). */
export const isLive = (tenantId) => liveIds.has(tenantId);
/** Reloads the team of the open business after a change. */
export const liveRefresh = () => reload?.();

const day = (d) => (d ? String(d).slice(0, 10) : null);
const toTenant = (w, prev = {}) => ({
  ...prev, id: w.id, name: w.name, type: w.type, city: w.city || "", owner: prev.owner || w.name, email: w.email || "", phone: w.phone || "",
  planId: w.plan.id, status: w.status, emailVerified: true, period: w.period, since: day(w.createdAt), renews: day(w.renewsAt), autoRenew: w.autoRenew,
  usage: prev.usage || { listings: 0, seats: 1, featured: 0 }, scopes: prev.scopes || ["Head office"], logoUrl: w.logoUrl, brandColors: w.brandColors || [],
  pan: w.pan || "", address: w.address || "", vatRegistered: !!w.vatRegistered, website: w.website || "", coveredById: w.coveredById || null,
  verification: w.verification || "none",
});
/** The settings form's profile from the server's business record. */
export const profileOf = (t) => ({ displayName: t.name, city: t.city || "", phone: t.phone || "", email: t.email || "", address: t.address || "", pan: t.pan || "", vatRegistered: !!t.vatRegistered, website: t.website || "" });
const toMember = (m) => ({ id: m.id, name: m.name, email: m.email, phone: m.phone || "", roleId: m.roleId, status: m.status === "paused" ? "suspended" : m.status, lastActive: m.lastActive, scopes: m.scopes, branchIds: m.branchIds, twofa: false });
const toInvite = (i) => ({ id: i.id, email: i.email, roleId: i.roleId, scopes: i.scopes, branchIds: i.branchIds, status: i.status, sent: i.sent, expires: i.expires, by: i.by || "" });
const toBranch = (b) => ({ id: b.id, name: b.name, address: b.address || "", phone: b.phone || "", manager: b.manager || "", receipt: b.receipt || "", status: b.status, rooms: b.rooms, staff: b.staff, live: true });
const toRole = (r) => ({ id: r.id, key: r.key, name: r.name || undefined, perms: r.perms, system: r.system });

export function useLiveWorkspace() {
  const { db, update } = useStore();
  const current = db.session.tenantId;
  // Bumped once the businesses are known, so the loaders below run even when the open business stays the same.
  const [known, setKnown] = useState(0);

  // 1 Who is signed in and which businesses they belong to (again after adding a business).
  const loadWorkspaces = useCallback((open) => {
    if (!bizApiReady() || !signedIn()) return Promise.resolve();
    return bizApi("GET", "/workspaces").then(({ data }) => {
      if (!data.workspaces.length) return;
      data.workspaces.forEach((w) => liveIds.add(w.id));
      setKnown((n) => n + 1);
      update((d) => {
        const keep = open && data.workspaces.some((w) => w.id === open) ? open : data.workspaces.some((w) => w.id === d.session.tenantId) ? d.session.tenantId : data.workspaces[0].id;
        d.tenants = [...data.workspaces.map((w) => toTenant(w, d.tenants.find((t) => t.id === w.id))), ...d.tenants.filter((t) => !liveIds.has(t.id) && t.id !== "t13")];
        d.session = { ...d.session, userName: data.user.name, userEmail: data.user.email, memberships: data.workspaces.map((w) => w.id), tenantId: keep, liveRoles: Object.fromEntries(data.workspaces.map((w) => [w.id, w.role.id])),
          // The branches the person works in, per business: "all" or a list of names (owners always "all").
          liveScopes: Object.fromEntries(data.workspaces.map((w) => [w.id, w.scopes])) };
        for (const w of data.workspaces) {
          // The profile always comes from the server (the same on every device).
          if (d.tenantSettings[w.id]) d.tenantSettings[w.id].profile = profileOf(d.tenants.find((t) => t.id === w.id));
          d.tenantRoles[w.id] = d.tenantRoles[w.id] || [toRole(w.role)];
          d.members[w.id] = d.members[w.id] || [];
          d.invites[w.id] = d.invites[w.id] || [];
          d.activity[w.id] = d.activity[w.id] || [];
        }
      });
    }).catch(() => { /* not signed in on the API, or it's off: the panel keeps working on its own data */ });
  }, []);
  useEffect(() => { wsReload = loadWorkspaces; loadWorkspaces(); return () => { if (wsReload === loadWorkspaces) wsReload = null; }; }, [loadWorkspaces]);

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
  }, [current, known]);
  useEffect(() => { reload = loadTeam; loadTeam(); return () => { if (reload === loadTeam) reload = null; }; }, [loadTeam]);

  // 2b The open business's branches (only the ones this person works in).
  const loadBranches = useCallback(() => {
    if (!isLive(current)) return;
    setActiveTenant(current);
    bizApi("GET", "/branches").then(({ data }) => update((d) => {
      d.branches = d.branches || {};
      d.branches[current] = data.branches.map(toBranch);
      const t = d.tenants.find((x) => x.id === current);
      if (t) t.scopes = data.branches.filter((b) => b.status === "open").map((b) => b.name);
      d.session.liveScopes = { ...(d.session.liveScopes || {}), [current]: data.access };
    })).catch(() => {});
  }, [current, known]);
  useEffect(() => { branchReload = loadBranches; loadBranches(); return () => { if (branchReload === loadBranches) branchReload = null; }; }, [loadBranches]);

  // 3 The open business's listings and leads (website enquiries), refreshed after every change and every minute.
  const loadWork = useCallback(() => {
    if (!isLive(current)) return;
    setActiveTenant(current);
    bizApi("GET", "/listings").then(({ data, meta }) => update((d) => {
      d.listings = [...d.listings.filter((l) => l.tenantId !== current), ...data];
      const t = d.tenants.find((x) => x.id === current);
      if (t) t.usage = { ...t.usage, listings: meta.used };
    })).catch(() => {});
    mailReload = () => bizApi("GET", "/mail/unread").then(({ data }) => update((d) => { d.session.mailUnread = { ...(d.session.mailUnread || {}), [current]: data.unread }; })).catch(() => {});
    mailReload();
    bizApi("GET", "/leads").then(({ data }) => update((d) => {
      if (!d.ops[current]) d.ops[current] = emptyOps();
      d.ops[current].conversations = data.map((c) => ({ ...c, assignee: c.assignee || null }));
    })).catch(() => { /* this role doesn't see leads */ });
  }, [current, known]);
  useEffect(() => {
    workReload = loadWork;
    loadWork();
    const every = setInterval(loadWork, 60_000);
    return () => { clearInterval(every); if (workReload === loadWork) workReload = null; };
  }, [loadWork]);
}

let wsReload = null;
/** Creates another business owned by the signed-in person, then opens it. */
export const addBusiness = async (body) => {
  const r = await bizApi("POST", "/workspaces", body);
  await wsReload?.(r.data.id);
  return r;
};
/** Reloads the person's businesses (plans, roles) after a change such as joining a Pro plan. */
export const workspacesReload = () => wsReload?.();
/** Whether the panel is signed in to the API (adding a business needs it). */
export const canAddBusiness = () => bizApiReady() && signedIn();

let branchReload = null;
/** Branch actions for the open business; the branch list (and everyone's access) reloads after each. */
export const liveBranches = (toast) => {
  const run = (p) => p.then((r) => { if (r?.message) toast(r.message); branchReload?.(); reload?.(); return r; }).catch((e) => { toast(e.message); throw e; });
  const body = (b) => ({ name: b.name?.trim(), address: b.address || null, phone: b.phone || null, manager: b.manager || null, receipt: b.receipt || null });
  return {
    add: (b) => run(bizApi("POST", "/branches", body(b))),
    save: (b) => run(bizApi("PATCH", `/branches/${b.id}`, body(b))),
    setOpen: (b, open) => run(bizApi("PATCH", `/branches/${b.id}`, { status: open ? "open" : "closed" })),
    remove: (b) => run(bizApi("DELETE", `/branches/${b.id}`)),
  };
};

let workReload = null;
let mailReload = null;
/** Re-counts unread email for the top bar (after reading mail). */
export const mailCountRefresh = () => mailReload?.();
/** Reloads listings and leads of the open business after a change. */
const workListeners = new Set();
export const workRefresh = () => { workReload?.(); workListeners.forEach((fn) => fn()); };

/** One page of the open business's listings from the API, with counts per status; reloads after every change. */
export function useListingPage(tenantId, { q, kind, status, per }) {
  const [state, setState] = useState({ rows: null, meta: null, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => { const fn = () => setTick((n) => n + 1); workListeners.add(fn); return () => workListeners.delete(fn); }, []);
  useEffect(() => {
    if (!tenantId) return undefined;
    let gone = false;
    const params = new URLSearchParams({ page: "1", per: String(per), status });
    if (kind !== "all") params.set("kind", kind);
    if (q.trim()) params.set("q", q.trim());
    // Typing in the search waits a moment before asking the server.
    const wait = setTimeout(() => {
      setActiveTenant(tenantId);
      bizApi("GET", `/listings?${params}`)
        .then((r) => !gone && setState({ rows: r.data, meta: r.meta, error: null }))
        .catch((e) => !gone && setState((x) => ({ ...x, rows: x.rows || [], error: e.message })));
    }, q.trim() ? 300 : 0);
    return () => { gone = true; clearTimeout(wait); };
  }, [tenantId, q, kind, status, per, tick]);
  return state;
}

const runWith = (toast) => (p) => p.then((r) => { if (r?.message) toast(r.message); workRefresh(); return r; }).catch((e) => { toast(e.message); workRefresh(); throw e; });

/** Listing actions for a business from the API (ids are listing codes, e.g. SP-0006). */
export const liveListings = (toast) => {
  const run = runWith(toast);
  return {
    setStatus: (ids, status) => run(bizApi("POST", "/listings/status", { ids, status })).catch(() => {}),
    remove: (ids) => run(bizApi("POST", "/listings/delete", { ids })).catch(() => {}),
    duplicate: (id) => run(bizApi("POST", `/listings/${id}/duplicate`)).catch(() => {}),
    open: (id) => bizApi("GET", `/listings/${id}`).then((r) => r.data),
    moveTargets: (id) => bizApi("GET", `/listings/${id}/move-targets`).then((r) => r.data),
    move: (id, tenantId) => run(bizApi("POST", `/listings/${id}/move`, { tenantId })),
    /** Creates or updates from the wizard. Throws with field errors, so the wizard can show them. */
    save: (editId, body) => run(editId ? bizApi("PATCH", `/listings/${editId}`, body) : bizApi("POST", "/listings", body)),
  };
};

/** Uploads one photo for a listing; returns { file, url }. */
export const uploadListingPhoto = async (file) =>
  (await bizApi("POST", "/listing-photos", { data: await fileToBase64(file) })).data;

/** Lead actions from the Inbox. */
export const liveLeads = (toast) => {
  const run = runWith(toast);
  return {
    update: (id, patch) => run(bizApi("PATCH", `/leads/${id}`, patch)).catch(() => {}),
    read: (id) => bizApi("PATCH", `/leads/${id}`, { read: true }).catch(() => {}),
    reply: (id, text) => run(bizApi("POST", `/leads/${id}/reply`, { text })),
  };
};

/** Team actions for a business from the API, with the same shape the team screens already use. */
// Branch access goes to the server by branch ID (stage 1.2): the screen picks names, `branches` (the business's branch list) turns them into ids.
export const liveTeam = (toast, branches = []) => {
  const run = (p) => p.then((r) => { if (r?.message) toast(r.message); liveRefresh(); return r; }).catch((e) => { toast(e.message); liveRefresh(); });
  return {
    onInvite: (list) => run(bizApi("POST", "/team/invites", { invites: list.map((i) => ({ email: i.email, roleId: i.roleId, ...branchBody(i.scopes || "all", branches) })) })),
    onUpdateMember: (id, patch) => {
      const body = { roleId: patch.roleId, ...branchBody(patch.scopes, branches), status: patch.status ? (patch.status === "suspended" ? "paused" : "active") : undefined };
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

/** Saves the business profile (name, city, address, contacts, PAN, VAT, website). */
export const saveProfile = (p) => bizApi("PATCH", "/workspace/profile", {
  name: p.displayName?.trim(), city: p.city ?? "", address: p.address ?? "", phone: p.phone ?? "", email: p.email ?? "",
  pan: p.pan ?? "", vatRegistered: !!p.vatRegistered, website: p.website ?? "",
});

/** Saves the logo (base64, or null to remove) and brand colours, then updates the open business. */
export const saveBranding = (tenantId, body) => bizApi("PUT", "/workspace/branding", body);

/** Paints the workspace in the open business's own colours (see html.has-brand in platform.css). */
export function useBrand(colors) {
  const key = (colors || []).join(",");
  useEffect(() => {
    const t = brandTheme(colors);
    const root = document.documentElement;
    const vars = { "--brand-accent": t?.accent, "--brand-accent-text": t?.accentText, "--brand-accent-ink": t?.accentInk, "--brand-accent-soft": t?.accentSoft, "--brand-light-bar": t?.lightBar, "--brand-dark-bar": t?.darkBar, "--brand-deep": t?.deep, "--brand-base": t?.base, "--brand": t?.brand, "--brand-dark-page": t?.darkPage, "--brand-mist": t?.mist, "--brand-light-text": t?.lightText, "--brand-light-line": t?.lightLine };
    root.classList.toggle("has-brand", !!t);
    for (const [k, v] of Object.entries(vars)) { if (v) root.style.setProperty(k, v); else root.style.removeProperty(k); }
    return () => { root.classList.remove("has-brand"); for (const k of Object.keys(vars)) root.style.removeProperty(k); };
  }, [key]);
}

/** Saves one settings section (payments, notifications, listings, documents, branding, checkups) on the server. */
export const saveSettings = (section, value) => bizApi("PUT", `/workspace/settings/${section}`, value);

/** Uploads a payment QR image; returns its address. */
export const uploadQr = async (file) => (await bizApi("POST", "/workspace/settings/qr", { data: await fileToBase64(file) })).data.url;
