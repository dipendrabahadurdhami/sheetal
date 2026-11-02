import React, { useState } from "react";
import { useT } from "../core/i18n";
import { permCount, roleDesc, roleName } from "../core/rbac";
import { Button, Checkbox, Confirm, Field, Input, useToast } from "../core/ui";
import { Icon } from "../core/icons";

// Roles and access: role list on the left, name + grouped permissions on the right, save bar at the bottom.
// Shared by business workspaces and Sheetal staff. Only the Owner role (perms "*") is locked.
export function RoleEditor({ roles, groups, counts, canManage, onSave, onCreate, onDelete, customAllowed = true }) {
  const t = useT();
  const toast = useToast();
  const [sel, setSel] = useState((roles.find((r) => !r.perms.includes("*")) || roles[0])?.id);
  const role = roles.find((r) => r.id === sel) || roles[0];
  const create = () => {
    const id = onCreate({ name: t("roles.newName"), desc: "", perms: [] });
    setSel(id);
    toast(t("roles.toastCreated"));
  };
  return (
    <section className="card pf-rbox">
      <div className="pf-rbox-head">
        <div className="pf-panel-title"><h2>Roles and access</h2><span>What each role can see and change. The Owner role can't be edited.</span></div>
        {canManage && <Button variant="outline" size="sm" icon="plus" onClick={create} disabled={!customAllowed} title={!customAllowed ? t("roles.planLocked") : undefined}>New role</Button>}
      </div>
      <nav className="pf-rbox-list" aria-label="Roles">
        {roles.map((r) => {
          const owner = r.perms.includes("*");
          return (
            <button key={r.id} type="button" className={r.id === role?.id ? "on" : ""} onClick={() => setSel(r.id)} aria-current={r.id === role?.id}>
              <span className="pf-rbox-top"><b>{roleName(r, t)}</b>{owner && <Icon name="lock" size={13} />}<small className="tnum">{owner ? "All" : `${permCount(r, groups)} on`}</small></span>
              {roleDesc(r, t) && <span className="pf-rbox-desc">{roleDesc(r, t)}</span>}
            </button>
          );
        })}
        {canManage && !customAllowed && <p className="pf-hint pf-rbox-lock"><Icon name="lock" size={13} />{t("roles.planLocked")}</p>}
      </nav>
      {role && <RoleForm key={role.id + JSON.stringify(role.perms) + (role.name || "") + (role.desc || "")} role={role} groups={groups} canManage={canManage} members={counts[role.id] || 0}
        onSave={(r) => { onSave(r); toast(t("roles.toastSaved")); }}
        onDelete={() => { onDelete(role.id); setSel(roles.find((r) => r.id !== role.id && !r.perms.includes("*"))?.id || roles[0].id); toast(t("roles.toastDeleted")); }} />}
    </section>
  );
}

function RoleForm({ role, groups, canManage, members, onSave, onDelete }) {
  const t = useT();
  const owner = role.perms.includes("*");
  const locked = owner || !canManage;
  const allPerms = groups.flatMap((g) => g.perms);
  const [name, setName] = useState(roleName(role, t));
  const [desc, setDesc] = useState(roleDesc(role, t));
  const [perms, setPerms] = useState(owner ? allPerms : role.perms.filter((p) => allPerms.includes(p)));
  const [confirm, setConfirm] = useState(false);
  const has = (p) => perms.includes(p);
  const flip = (p, v) => setPerms((x) => (v ? [...x, p] : x.filter((y) => y !== p)));
  const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  const dirty = !locked && (name.trim() !== roleName(role, t) || desc !== roleDesc(role, t) || !same(perms, role.perms.filter((p) => allPerms.includes(p))));
  const people = `${members} ${members === 1 ? "person has" : "people have"} this role`;
  return (
    <>
      <div className="pf-rbox-form">
        {owner && <div className="pf-note"><Icon name="lock" size={16} />{t("roles.ownerNote")}</div>}
        <div className="pf-rbox-fields">
          <Field label="Role name"><Input value={name} disabled={locked} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="What it's for"><Input value={desc} disabled={locked} placeholder="One line about this job" onChange={(e) => setDesc(e.target.value)} /></Field>
        </div>
        <div className="pf-rbox-groups">
          {groups.map((g) => {
            const on = g.perms.filter(has).length;
            const full = on === g.perms.length;
            return (
              <section key={g.module} className="pf-rbox-group" aria-label={t(`permgroup.${g.module}`)}>
                <header><b>{t(`permgroup.${g.module}`)}</b>
                  {!locked && <button type="button" className="pf-rbox-all" onClick={() => setPerms((x) => (full ? x.filter((p) => !g.perms.includes(p)) : [...new Set([...x, ...g.perms])]))}>{full ? "Clear" : "All"}</button>}</header>
                {g.perms.map((p) => <Checkbox key={p} checked={has(p)} disabled={locked} label={t(`perm.${p}`)} onChange={(v) => flip(p, v)} />)}
              </section>
            );
          })}
        </div>
      </div>
      <div className="pf-rbox-foot">
        {canManage && !owner ? <Button variant="outline" size="sm" className="pf-danger" icon="trash-2" disabled={members > 0} title={members > 0 ? t("roles.deleteBlocked") : undefined} onClick={() => setConfirm(true)}>Delete role</Button> : <span />}
        <div className="pf-row-actions">
          <span className="small muted">{dirty ? t("common.unsaved") : people}</span>
          {!locked && <Button size="sm" disabled={!dirty || !name.trim()} onClick={() => onSave({ ...role, system: false, name: name.trim(), desc, perms })}>Save role</Button>}
        </div>
      </div>
      <Confirm open={confirm} onClose={() => setConfirm(false)} onConfirm={onDelete} danger title={t("roles.deleteTitle")} confirmLabel={t("common.delete")}>{t("roles.deleteText")}</Confirm>
    </>
  );
}
