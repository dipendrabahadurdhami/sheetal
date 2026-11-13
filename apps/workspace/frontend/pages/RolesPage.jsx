// Roles and access for a signed-in business, on the NEW permission names with scopes (ACCESS.md sections 5 and 8; roadmap stage 1.2).
// Where it fits: Business → Team → Roles and Settings → Roles when the business is live (BusinessPages.jsx picks it); the sample workspace keeps the old RoleEditor.
// Moved here from business/frontend/src/pages/LiveRoles.jsx in P2-W6 (that file is a one-line shim); `onChanged` lets the panel shell reload its copy.
// How it works: GET /team answers every role as `grants` ("app.resource.action:scope", whatever the role stores today) and the `catalog` of the apps this
// business has (each permission with the scopes its manifest allows and the Phase 1 cap). The screen shows one block per app; a ticked permission gets a
// scope picker when more than one scope is on offer. Save sends the grants to PATCH /team/roles/:id (or POST for a new role); the server checks again.
// Rules: the Owner role is locked. A scope wider than an app's cap is never offered (Expenses and Reviews: no "All branches" for now; a short note says so).
// Saving a role stores it in the new names; nobody gains or loses access by that (an old name becomes the new names it stood for).

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { bizApi } from "@sheetal/sdk/client";
import { useT } from "@sheetal/shared/core/i18n";
import { roleDesc, roleName } from "@sheetal/shared/core/rbac";
import { Button, Checkbox, Confirm, Empty, Field, Input, Select, useToast } from "@sheetal/ui/primitives";
import { Icon } from "@sheetal/shared/core/icons";
import { SCOPE_LABEL, capNote, catalogByApp, defaultScope, grantCount, grantsToMap, mapToPerms, sameMap, scopesOffered } from "../roleGrants.js";

export function RolesPage({ tenant, canManage, customAllowed = true, api = bizApi, onChanged }) {
  const t = useT();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [sel, setSel] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api("GET", "/team").then(({ data: d }) => { setData(d); setError(null); }).catch((e) => setError(e.message)), [api]);
  useEffect(() => { load(); }, [load, tenant?.id]);

  const run = (p, pick) => {
    setBusy(true);
    return p.then((r) => { if (r?.message) toast(r.message); if (pick) setSel(pick(r)); return load(); })
      .catch((e) => toast(e.message))
      .finally(() => { setBusy(false); onChanged?.(); });
  };

  if (error && !data) return <section className="card pf-rbox"><Empty icon="circle-alert" title="Roles could not be loaded" action={<Button size="sm" onClick={load}>Try again</Button>}>{error}</Empty></section>;
  if (!data) return <section className="card pf-rbox"><p className="pf-pad small muted">Loading roles…</p></section>;

  const roles = data.roles;
  const catalog = data.catalog || [];
  const counts = {};
  for (const m of data.members) counts[m.roleId] = (counts[m.roleId] || 0) + 1;
  const role = roles.find((r) => r.id === sel) || roles.find((r) => !r.grants.includes("*")) || roles[0];

  return (
    <section className="card pf-rbox">
      <div className="pf-rbox-head">
        <div className="pf-panel-title"><h2>Roles and access</h2><span>What each role can see and change, app by app. The Owner role can't be edited.</span></div>
        {canManage && <Button variant="outline" size="sm" icon="plus" disabled={!customAllowed || busy} title={!customAllowed ? t("roles.planLocked") : undefined}
          onClick={() => run(api("POST", "/team/roles", { name: t("roles.newName"), perms: [] }), (r) => r?.data?.id)}>New role</Button>}
      </div>
      <nav className="pf-rbox-list" aria-label="Roles">
        {roles.map((r) => {
          const owner = r.grants.includes("*");
          return (
            <button key={r.id} type="button" className={r.id === role?.id ? "on" : ""} onClick={() => setSel(r.id)} aria-current={r.id === role?.id}>
              <span className="pf-rbox-top"><b>{roleName(r, t)}</b>{owner && <Icon name="lock" size={13} />}<small className="tnum">{owner ? "All" : `${grantCount(r.grants, catalog)} on`}</small></span>
              {roleDesc(r, t) && <span className="pf-rbox-desc">{roleDesc(r, t)}</span>}
            </button>
          );
        })}
        {canManage && !customAllowed && <p className="pf-hint pf-rbox-lock"><Icon name="lock" size={13} />{t("roles.planLocked")}</p>}
      </nav>
      {role && <RoleGrantsForm key={role.id + role.grants.join("|") + (role.name || "")} role={role} catalog={catalog} canManage={canManage} members={counts[role.id] || 0} busy={busy}
        onSave={(body) => run(api("PATCH", `/team/roles/${role.id}`, body))}
        onDelete={() => run(api("DELETE", `/team/roles/${role.id}`), () => null)} />}
    </section>
  );
}

function RoleGrantsForm({ role, catalog, canManage, members, busy, onSave, onDelete }) {
  const t = useT();
  const owner = role.grants.includes("*");
  const locked = owner || !canManage;
  const start = useMemo(() => grantsToMap(role.grants, catalog), [role, catalog]);
  const apps = useMemo(() => catalogByApp(catalog), [catalog]);
  const [name, setName] = useState(roleName(role, t));
  const [map, setMap] = useState(start);
  const [confirm, setConfirm] = useState(false);
  const renamed = name.trim() !== roleName(role, t);
  const changed = !sameMap(map, start);
  const dirty = !locked && (renamed || changed);
  const set = (e, scope) => setMap((m) => { const next = { ...m }; if (scope) next[e.id] = scope; else delete next[e.id]; return next; });
  const setAll = (entries, on) => setMap((m) => { const next = { ...m }; for (const e of entries) { if (on) next[e.id] = next[e.id] || defaultScope(e); else delete next[e.id]; } return next; });
  const people = `${members} ${members === 1 ? "person has" : "people have"} this role`;

  return (
    <>
      <div className="pf-rbox-form">
        {owner && <div className="pf-note"><Icon name="lock" size={16} />{t("roles.ownerNote")}</div>}
        <div className="pf-rbox-fields">
          <Field label="Role name"><Input value={name} disabled={locked} maxLength={60} onChange={(e) => setName(e.target.value)} /></Field>
        </div>
        {apps.map((app) => {
          const note = capNote(app);
          return (
            <div key={app.id} className="pf-rbox-app">
              <h3 className="pf-rbox-apphead">{app.name}</h3>
              {note && <p className="pf-hint"><Icon name="info" size={13} />{note}</p>}
              <div className="pf-rbox-groups">
                {app.groups.map((g) => {
                  const on = g.entries.filter((e) => map[e.id]).length;
                  const full = on === g.entries.length;
                  return (
                    <section key={g.name} className="pf-rbox-group" aria-label={`${app.name}: ${g.name}`}>
                      <header><b>{g.name}</b>{!locked && <button type="button" className="pf-rbox-all" onClick={() => setAll(g.entries, !full)}>{full ? "Clear" : "All"}</button>}</header>
                      {g.entries.map((e) => {
                        const offered = scopesOffered(e);
                        return (
                          <div key={e.id} className="pf-rbox-perm">
                            <Checkbox checked={!!map[e.id]} disabled={locked} label={e.label} onChange={(v) => set(e, v ? defaultScope(e) : null)} />
                            {map[e.id] && offered.length > 1 && (
                              <Select value={map[e.id]} disabled={locked} aria-label={`Where: ${e.label}`} onChange={(v) => set(e, v)}
                                options={offered.map((s) => ({ id: s, label: SCOPE_LABEL[s] }))} />
                            )}
                          </div>
                        );
                      })}
                    </section>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="pf-rbox-foot">
        {canManage && !owner && !role.system ? <Button variant="outline" size="sm" className="pf-danger" icon="trash-2" disabled={members > 0 || busy} title={members > 0 ? t("roles.deleteBlocked") : undefined} onClick={() => setConfirm(true)}>Delete role</Button> : <span />}
        <div className="pf-row-actions">
          <span className="small muted">{dirty ? t("common.unsaved") : people}</span>
          {!locked && <Button size="sm" disabled={!dirty || !name.trim() || busy}
            onClick={() => onSave({ ...(renamed ? { name: name.trim() } : {}), ...(changed ? { perms: mapToPerms(map, catalog) } : {}) })}>Save role</Button>}
        </div>
      </div>
      <Confirm open={confirm} onClose={() => setConfirm(false)} onConfirm={onDelete} danger title={t("roles.deleteTitle")} confirmLabel={t("common.delete")}>{t("roles.deleteText")}</Confirm>
    </>
  );
}
