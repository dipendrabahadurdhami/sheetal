import React, { useMemo, useState } from "react";
import { useT } from "../core/i18n";
import { fdate, fdatetime, isEmail } from "../core/format";
import { roleDesc, roleName, permCount } from "../core/rbac";
import { Button, Checkbox, Confirm, Empty, Field, Modal, Person, SearchInput, Select, StatusBadge, Table, Tabs, Textarea, ToggleRow, useToast } from "../core/ui";
import { Icon } from "../core/icons";
import { DataActions } from "./DataIO";
import { useUndo } from "./Crud";

// Team management used by both a business workspace and Sheetal staff (/admin/staff).
export function TeamPanel({ members, invites, roles, groups, scopes, seats, canManage, activity = [], onInvite, onUpdateMember, onRemoveMember, onRestoreMember, onResend, onRevoke, dataKind }) {
  const t = useT();
  const toast = useToast();
  const undo = useUndo();
  const [tab, setTab] = useState("members");
  const [q, setQ] = useState("");
  const [roleF, setRoleF] = useState("all");
  const [inviting, setInviting] = useState(false);
  const [openId, setOpenId] = useState(null);
  const byId = useMemo(() => Object.fromEntries(roles.map((r) => [r.id, r])), [roles]);
  const pending = invites.filter((i) => i.status === "pending");
  const usedSeats = members.filter((m) => m.status !== "suspended").length + pending.length;
  const seatsLeft = seats.limit === -1 ? Infinity : seats.limit - usedSeats;
  const ql = q.toLowerCase();
  const list = members.filter((m) => (roleF === "all" || m.roleId === roleF) && `${m.name} ${m.email}`.toLowerCase().includes(ql));
  const open = list.find((m) => m.id === openId) || list[0];
  const isOwner = (m) => byId[m.roleId]?.perms.includes("*");
  const scopeText = (s) => (s === "all" ? t("team.allAccess") : s.join(", "));

  const inviteCols = [
    { key: "email", label: t("common.email"), render: (i) => <span className="pf-strong">{i.email}</span> },
    { key: "role", label: t("team.role"), render: (i) => roleName(byId[i.roleId], t) },
    { key: "by", label: t("team.invitedBy"), render: (i) => i.by },
    { key: "sent", label: t("team.sent"), num: true, render: (i) => fdate(i.sent) },
    { key: "exp", label: t("team.expires"), num: true, render: (i) => fdate(i.expires) },
    { key: "st", label: t("common.status"), render: (i) => <StatusBadge status={i.status} /> },
    { key: "act", label: "", align: "right", render: (i) => canManage && i.status !== "revoked" && (
      <div className="pf-row-actions">
        <Button variant="outline" size="sm" icon="send" onClick={() => { onResend(i.id); toast(t("team.toastResent", { email: i.email })); }}>{t("team.resend")}</Button>
        {i.status === "pending" && <Button variant="ghost" size="sm" onClick={() => { onRevoke(i.id); toast(t("team.toastRevoked")); }}>{t("team.revoke")}</Button>}
      </div>
    ) },
  ];

  return (
    <section className="card pf-panel">
      <div className="pf-panel-head">
        <div className="pf-panel-title">
          <h2>{t("team.title")}</h2>
          <span className="tnum">{seats.limit === -1 ? t("team.seatsUnlimited", { used: usedSeats }) : t("team.seats", { used: usedSeats, limit: seats.limit, plan: seats.plan })}</span>
        </div>
        <div className="pf-panel-actions">
          {dataKind && <DataActions kind={dataKind} size="sm" onlyExport={!canManage}
            rows={members.map((m) => ({ ...m, role: roleName(byId[m.roleId], t), status: t(`status.${m.status}`) }))}
            onImport={(rows) => {
              const taken = new Set([...members.map((m) => m.email), ...pending.map((i) => i.email)]);
              const assignable = roles.filter((r) => !r.perms.includes("*"));
              const list = rows.filter((r) => !taken.has(r.email)).map((r) => ({ email: r.email, roleId: (assignable.find((x) => roleName(x, t).toLowerCase() === String(r.role || "").toLowerCase()) || assignable[0])?.id, scopes: "all", lang: "en", note: "" }));
              if (list.length) { onInvite(list); setTab("invites"); }
            }} />}
          {canManage && <Button icon="user-plus" onClick={() => setInviting(true)} disabled={seatsLeft <= 0}>{t("team.invite")}</Button>}
        </div>
      </div>
      <div className="pf-pad-x">
        <Tabs value={tab} onChange={setTab} tabs={[
          { id: "members", label: t("team.members"), count: members.length },
          { id: "invites", label: t("team.invites"), count: pending.length },
          { id: "activity", label: t("team.activity") },
        ]} />
      </div>
      {tab === "members" && (
        <div className="pf-tbox">
          <div className="pf-tbox-list">
            <div className="pf-tbox-tools">
              <SearchInput value={q} onChange={setQ} placeholder={t("team.search")} />
              <Select value={roleF} onChange={setRoleF} options={[{ id: "all", label: t("team.allRoles") }, ...roles.map((r) => ({ id: r.id, label: roleName(r, t) }))]} aria-label={t("team.role")} />
            </div>
            <nav aria-label={t("team.members")}>
              {list.map((m) => (
                <button key={m.id} type="button" className={m.id === open?.id ? "on" : ""} aria-current={m.id === open?.id} onClick={() => setOpenId(m.id)}>
                  <span className="pf-tbox-top"><b>{m.name}</b>{isOwner(m) && <Icon name="lock" size={13} />}<small className={m.status === "active" ? "" : "pf-tone-action"}>{m.status === "active" ? roleName(byId[m.roleId], t) : t(`status.${m.status}`)}</small></span>
                  <span className="pf-tbox-sub">{m.status === "active" ? (scopes ? scopeText(m.scopes) : m.email) : roleName(byId[m.roleId], t)}</span>
                </button>
              ))}
              {!list.length && (members.length
                ? <Empty title={t("team.noMatch")} action={<Button variant="outline" size="sm" onClick={() => { setQ(""); setRoleF("all"); }}>Clear search</Button>} />
                : <Empty icon="users" title="No one on the team yet" action={canManage && <Button icon="user-plus" onClick={() => setInviting(true)}>{t("team.invite")}</Button>}>Invite the people who work with you. Each gets their own login.</Empty>)}
            </nav>
          </div>
          {open && <div className="pf-tbox-detail">
            <div className="pf-tbox-person"><Person name={open.name} sub={open.email} size={40} /><StatusBadge status={open.status} /></div>
            <MemberDetail key={open.id} m={open} roles={roles} byId={byId} groups={groups} scopes={scopes} canEdit={canManage && !isOwner(open)} onUpdate={onUpdateMember} />
          </div>}
          {open && <div className="pf-tbox-foot">
            {canManage && !isOwner(open) ? <div className="pf-row-actions"><MemberActions m={open} onUpdate={onUpdateMember} onRemove={(id) => { const copy = structuredClone(open); const at = members.findIndex((x) => x.id === id); onRemoveMember(id); setOpenId(null); undo(t("team.toastRemoved"), onRestoreMember ? () => onRestoreMember(copy, at) : null); }} /></div> : <span className="small muted">{isOwner(open) ? "The owner can't be changed here." : ""}</span>}
            <span className="small muted tnum">{t("team.lastActive")}: {fdatetime(open.lastActive)}</span>
          </div>}
        </div>
      )}
      {tab === "invites" && <Table columns={inviteCols} rows={invites} empty={<Empty icon="mail" title={t("team.noInvites")}>{t("team.noInvitesText")}</Empty>} />}
      {tab === "activity" && (
        activity.length ? <ul className="pf-feed">{activity.map((a) => (
          <li key={a.id}><Icon name="history" size={16} /><span><b>{a.who}</b> {a.what}</span><time className="tnum">{fdatetime(a.at)}</time></li>
        ))}</ul> : <Empty icon="history" title={t("team.noActivity")} />
      )}

      <InviteModal open={inviting} onClose={() => setInviting(false)} roles={roles} groups={groups} scopes={scopes} seatsLeft={seatsLeft}
        existing={[...members.map((m) => m.email), ...pending.map((i) => i.email)]}
        onSubmit={(list) => { onInvite(list); setInviting(false); setTab("invites"); toast(t("team.toastInvited", { n: list.length })); }} />

    </section>
  );
}

function MemberDetail({ m, roles, byId, groups, scopes, canEdit, onUpdate }) {
  const t = useT();
  const role = byId[m.roleId];
  const assignable = roles.filter((r) => !r.perms.includes("*"));
  return (
    <div className="pf-stack">
      <dl className="pf-kv">
        <dt>{t("common.phone")}</dt><dd className="tnum">{m.phone}</dd>
        <dt>{t("team.lastActive")}</dt><dd className="tnum">{fdatetime(m.lastActive)}</dd>
      </dl>
      <Field label={t("team.role")} hint={roleDesc(role, t)}>
        {canEdit
          ? <Select value={m.roleId} onChange={(v) => onUpdate(m.id, { roleId: v })} options={assignable.map((r) => ({ id: r.id, label: roleName(r, t) }))} />
          : <div className="input pf-static">{roleName(role, t)}</div>}
      </Field>
      <div className="pf-note"><Icon name="key-round" size={16} />{t("team.permSummary", { n: permCount(role, groups) })}</div>
      {scopes && (
        <Field label={scopes.label}>
          <div className="pf-checks">
            <Checkbox label={t("team.allAccess")} checked={m.scopes === "all"} disabled={!canEdit} onChange={(v) => onUpdate(m.id, { scopes: v ? "all" : [] })} />
            {m.scopes !== "all" && scopes.options.map((s) => (
              <Checkbox key={s} label={s} checked={m.scopes.includes(s)} disabled={!canEdit}
                onChange={(v) => onUpdate(m.id, { scopes: v ? [...m.scopes, s] : m.scopes.filter((x) => x !== s) })} />
            ))}
          </div>
        </Field>
      )}
      <ToggleRow title={t("team.require2fa")} sub={t("team.require2faSub")} checked={m.twofa} disabled={!canEdit} onChange={(v) => onUpdate(m.id, { twofa: v })} />
    </div>
  );
}

function MemberActions({ m, onUpdate, onRemove }) {
  const t = useT();
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      {m.status === "suspended"
        ? <Button variant="outline" size="sm" icon="user-check" onClick={() => onUpdate(m.id, { status: "active" })}>{t("team.reactivate")}</Button>
        : <Button variant="outline" size="sm" icon="ban" onClick={() => onUpdate(m.id, { status: "suspended" })}>{t("team.suspend")}</Button>}
      <Button variant="outline" size="sm" className="pf-danger" icon="user-x" onClick={() => setConfirm(true)}>{t("team.remove")}</Button>
      <Confirm open={confirm} onClose={() => setConfirm(false)} onConfirm={() => onRemove(m.id)} danger title={t("team.removeTitle", { name: m.name })} confirmLabel={t("team.remove")}>
        {t("team.removeText")}
      </Confirm>
    </>
  );
}

function InviteModal({ open, onClose, roles, groups, scopes, seatsLeft, existing, onSubmit }) {
  const t = useT();
  const assignable = roles.filter((r) => !r.perms.includes("*"));
  const [emails, setEmails] = useState("");
  const [roleId, setRoleId] = useState(assignable[0]?.id);
  const [scope, setScope] = useState("all");
  const [lang, setLang] = useState("en");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const role = roles.find((r) => r.id === roleId);
  const parsed = emails.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);

  const submit = () => {
    if (!parsed.length) return setErr(t("invite.errEmpty"));
    const bad = parsed.find((e) => !isEmail(e));
    if (bad) return setErr(t("invite.errBad", { email: bad }));
    const dup = parsed.find((e) => existing.includes(e));
    if (dup) return setErr(t("invite.errDup", { email: dup }));
    if (parsed.length > seatsLeft) return setErr(t("invite.errSeats", { n: seatsLeft }));
    onSubmit(parsed.map((email) => ({ email, roleId, scopes: scope, lang, note })));
    setEmails(""); setNote(""); setErr("");
  };

  return (
    <Modal open={open} onClose={onClose} title={t("invite.title")} wide
      footer={<><Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button><Button icon="send" onClick={submit}>{parsed.length > 1 ? t("invite.sendN", { n: parsed.length }) : t("invite.send")}</Button></>}>
      <div className="pf-stack">
        <Field label={t("invite.emails")} hint={seatsLeft === Infinity ? t("invite.hint") : t("invite.hintSeats", { n: seatsLeft })} error={err}>
          <Textarea rows={2} value={emails} onChange={(e) => { setEmails(e.target.value); setErr(""); }} placeholder="name@business.com, another@gmail.com" style={{ minHeight: 76 }} />
        </Field>
        <Field label={t("team.role")}>
          <div className="pf-role-pick">
            {assignable.map((r) => (
              <button key={r.id} type="button" className={roleId === r.id ? "on" : ""} onClick={() => setRoleId(r.id)} aria-pressed={roleId === r.id}>
                <b>{roleName(r, t)}</b><span>{roleDesc(r, t)}</span><small className="tnum">{t("team.permSummary", { n: permCount(r, groups) })}</small>
              </button>
            ))}
          </div>
        </Field>
        {scopes && role && (
          <Field label={scopes.label}>
            <div className="pf-chip-row">
              <button type="button" className={`chip ${scope === "all" ? "active" : ""}`} onClick={() => setScope("all")}>{t("team.allAccess")}</button>
              {scopes.options.map((s) => {
                const on = scope !== "all" && scope.includes(s);
                return <button key={s} type="button" className={`chip ${on ? "active" : ""}`} aria-pressed={on}
                  onClick={() => setScope(scope === "all" ? [s] : on ? scope.filter((x) => x !== s) : [...scope, s])}>{s}</button>;
              })}
            </div>
          </Field>
        )}
        <div className="pf-grid-2 tight">
          <Field label={t("invite.lang")}>
            <Select value={lang} onChange={setLang} options={[{ id: "en", label: "English" }, { id: "ne", label: "नेपाली" }]} />
          </Field>
          <Field label={t("invite.note")} optional>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("invite.notePh")} />
          </Field>
        </div>
        <p className="pf-hint">{t("invite.expiry")}</p>
      </div>
    </Modal>
  );
}
