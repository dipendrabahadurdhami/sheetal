import React, { useState } from "react";
import { isStaffLive, liveAdmin, useLiveTenant } from "../live";
import { useT } from "@sheetal/shared/core/i18n";
import { useStore } from "@sheetal/shared/core/store";
import { Link, useRouter } from "@sheetal/shared/core/router";
import { fdate, rs, limitText } from "@sheetal/shared/core/format";
import { LIMIT_KEYS, PLAN_FEATURES, limitKeysFor } from "@sheetal/shared/core/plans";
import { can } from "@sheetal/shared/core/rbac";
import { Badge, Button, Confirm, Drawer, Empty, Field, Input, Meter, PageHead, Panel, Person, Seg, Select, StatusBadge, Toggle, ToggleRow, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { BUSINESS_TYPES } from "@sheetal/shared/core/rbac";
import { planOf, TenantName } from "./AdminDashboard";

const FEATURES = PLAN_FEATURES;

// Live (admin API): status, plan and auto-renew changes go to the API; the team comes from the business's detail.
export function TenantDetail({ id, role }) {
  const t = useT();
  const { db, update } = useStore();
  const { navigate } = useRouter();
  const toast = useToast();
  const [confirm, setConfirm] = useState(null);
  const live = isStaffLive() ? liveAdmin(toast) : null;
  const [detail, reloadDetail] = useLiveTenant(live ? id : null);
  const x = db.tenants.find((r) => r.id === id);
  if (!x) return live ? <p className="muted pf-pad">Loading the business…</p> : <Empty title={t("tenants.notFound")} action={<Link to="/admin/tenants" className="btn btn-outline">{t("common.back")}</Link>} />;
  const plan = planOf(db, x.planId);
  if (!plan) return <p className="muted pf-pad">Loading the business…</p>;
  const team = live ? (detail?.members || []).map((m) => ({ id: m.id, name: m.name, email: m.email, status: m.status === "paused" ? "suspended" : m.status })) : db.members[x.id] || [];
  const plans = db.plans.filter((p) => p.type === x.type);
  const change = (patch, done) => live.updateTenant(id, patch).then(() => { reloadDetail(); done?.(); }).catch(() => {});
  const setStatus = (status) => live ? change({ status: status === "rejected" ? "cancelled" : status }) : update((d) => { d.tenants.find((r) => r.id === id).status = status; d.platformActivity.unshift({ id: Math.random().toString(36), who: d.session.userName, what: `set ${x.name} to ${status}`, at: new Date().toISOString() }); });
  const open = () => {
    const reason = window.prompt("Why are you opening this business as support? This is saved in the audit log.");
    if (!reason || !reason.trim()) return;
    update((d) => {
      const name = (d.tenants.find((x) => x.id === id) || {}).name || id;
      d.platformActivity = [{ id: "act-" + Date.now(), who: d.session.userName, what: "opened " + name + " as support. Reason: " + reason.trim(), at: new Date().toISOString().slice(0, 16) }, ...(d.platformActivity || [])];
      d.session.impersonating = id; d.session.impersonatingUntil = Date.now() + 30 * 60 * 1000; d.session.tenantId = id; d.session.previewRoleId = null;
    });
    navigate("/business");
  };

  return (
    <>
      <PageHead back={<Link to="/admin/tenants" className="pf-back"><Icon name="arrow-left" size={15} />{t("tenants.title")}</Link>}
        title={x.name} sub={`${t(`type.${x.type}`)} · ${x.city} · ${t("tenants.since")} ${fdate(x.since)}`}
        actions={<>
          {can(role, "tenants.impersonate") && !live && <Button variant="outline" icon="external-link" onClick={open}>{t("tenant.open")}</Button>}
          {can(role, "tenants.suspend") && (x.status === "suspended"
            ? <Button icon="rotate-ccw" onClick={() => setConfirm("active")}>{t("tenant.reactivate")}</Button>
            : <Button variant="outline" className="pf-danger" icon="ban" onClick={() => setConfirm("suspended")}>{t("tenant.suspend")}</Button>)}
        </>} />

      {x.status === "pending_verification" && can(role, "moderation.kyc") && (
        <div className="pf-alert action">
          <Icon name="circle-alert" size={18} /><div><b>{t("tenant.kycTitle")}</b><span>{t("tenant.kycText")}</span></div>
          <Button variant="outline" size="sm" onClick={() => setStatus("rejected")}>{t("common.reject")}</Button>
          <Button size="sm" onClick={() => { setStatus("active"); if (!live) toast(t("tenant.toastApproved")); }}>{t("common.approve")}</Button>
        </div>
      )}

      <div className="pf-split">
        <div className="grow pf-stack">
          <Panel title={t("tenant.profile")} pad>
            <dl className="pf-kv">
              <dt>{t("common.status")}</dt><dd><StatusBadge status={x.status} /></dd>
              <dt>{t("tenants.owner")}</dt><dd>{x.owner}</dd>
              <dt>{t("common.email")}</dt><dd>{x.email}</dd>
              <dt>{t("common.phone")}</dt><dd className="tnum">{x.phone}</dd>
              <dt>{t("tenant.pan")}</dt><dd className="tnum">{x.pan}</dd>
              <dt>{t("tenant.workspace")}</dt><dd className="tnum">{db.platformSettings.mainDomain}{db.platformSettings.businessPath}/{x.id}</dd>
              {!live && <><dt>{t("tenant.scopes")}</dt><dd>{x.scopes.join(", ")}</dd></>}
              {detail && <><dt>{t("nav.listings")}</dt><dd className="tnum">{Object.entries(detail.listings).map(([k, n]) => `${n} ${k === "pending" ? "in review" : k}`).join(" · ") || "None"}</dd>
                <dt>Enquiries</dt><dd className="tnum">{detail.leads}</dd></>}
            </dl>
          </Panel>
          <Panel title={t("tenant.usage")} sub={t("tenant.usageSub", { plan: plan.name })} pad>
            <div className="pf-meters">
              {limitKeysFor(x.type, plan).map((k) => <Meter key={k} label={t(`limit.${k}`)} used={x.usage[k] || 0} limit={plan.limits[k]} />)}
            </div>
          </Panel>
          <Panel title={t("tenant.team")} sub={t("roles.people", { n: team.length })}>
            <ul className="pf-list">
              {team.map((m) => (
                <li key={m.id}><Person name={m.name} sub={m.email} /><StatusBadge status={m.status} /></li>
              ))}
            </ul>
          </Panel>
        </div>
        <div className="side pf-stack">
          <Panel title={t("tenant.subscription")} pad>
            <div className="pf-stack">
              <div className="pf-price-line"><b className="tnum">{rs(plan.price)}</b><span>{t("plans.perMonth")}</span></div>
              <dl className="pf-kv">
                <dt>{t("tenants.plan")}</dt><dd>{plan.name}</dd>
                <dt>{t("tenants.renews")}</dt><dd className="tnum">{fdate(x.renews)}</dd>
                <dt>Billing period</dt><dd className="tnum">{(x.period || 1) === 12 ? "1 year" : `${x.period || 1} month${(x.period || 1) > 1 ? "s" : ""}`}</dd>
                <dt>{t("tenant.method")}</dt><dd>Fonepay</dd>
              </dl>
              {plan.price > 0 && (
                <ToggleRow title="Auto-renew" sub={role.perms.includes("*") ? "Renew this plan automatically at the end of each period. Off by default." : "Only the super admin can change this."}
                  checked={!!x.autoRenew} disabled={!role.perms.includes("*")}
                  onChange={(v) => { if (!role.perms.includes("*")) return; if (live) { change({ autoRenew: v }); return; } update((d) => { d.tenants.find((r) => r.id === id).autoRenew = v; }); toast(v ? "Auto-renew is on" : "Auto-renew is off"); }} />
              )}
              {can(role, "tenants.manage") && (
                <Field label={t("tenant.changePlan")}>
                  <Select value={x.planId} onChange={(v) => { if (live) { change({ planId: v }); return; } update((d) => { d.tenants.find((r) => r.id === id).planId = v; }); toast(t("tenant.toastPlan")); }}
                    options={plans.map((p) => ({ id: p.id, label: `${p.name} · ${rs(p.price)}` }))} />
                </Field>
              )}
            </div>
          </Panel>
          <Panel title={t("tenant.invoices")}>
            <p className="small muted" style={{ padding: "12px 16px" }}>No invoices yet.</p>
          </Panel>
        </div>
      </div>
      <Confirm open={!!confirm} onClose={() => setConfirm(null)} danger={confirm === "suspended"} onConfirm={() => { setStatus(confirm); if (!live) toast(t(confirm === "suspended" ? "tenant.toastSuspended" : "tenant.toastReactivated")); }}
        title={t(confirm === "suspended" ? "tenant.suspendTitle" : "tenant.reactivateTitle", { name: x.name })} confirmLabel={t(confirm === "suspended" ? "tenant.suspend" : "tenant.reactivate")}>
        {t(confirm === "suspended" ? "tenant.suspendText" : "tenant.reactivateText")}
      </Confirm>
    </>
  );
}

export function AdminPlans() {
  const t = useT();
  const { db, update } = useStore();
  const toast = useToast();
  const [type, setType] = useState("hotel");
  const [edit, setEdit] = useState(null);
  const plans = db.plans.filter((p) => p.type === type);
  const tenantsOn = (pid) => db.tenants.filter((x) => x.planId === pid && x.status !== "cancelled").length;

  const live = isStaffLive() ? liveAdmin(toast) : null;
  const save = () => {
    if (live) { live.savePlan(edit, !db.plans.some((p) => p.id === edit.id)).then(() => setEdit(null)).catch(() => {}); return; }
    update((d) => {
      const i = d.plans.findIndex((p) => p.id === edit.id);
      if (i >= 0) d.plans[i] = edit; else d.plans.push(edit);
    });
    setEdit(null);
    toast(t("plans.toastSaved"));
  };
  const blank = () => ({ id: `${type}-${Date.now()}`, type, name: t("plans.newName"), price: 0, yearly: 0, limits: Object.fromEntries(LIMIT_KEYS[type].map((k) => [k, 1])), features: Object.fromEntries(FEATURES.map((f) => [f, false])), active: false });

  return (
    <>
      <PageHead title={t("plans.title")} sub={t("plans.sub")} actions={<Button icon="plus" onClick={() => setEdit(blank())}>{t("plans.new")}</Button>} />
      <Seg value={type} onChange={setType} label={t("tenants.type")} options={Object.keys(BUSINESS_TYPES).map((k) => ({ id: k, label: t(`type.${k}s`), icon: BUSINESS_TYPES[k].icon }))} />
      <div className="pf-plan-grid">
        {plans.map((p) => (
          <section key={p.id} className={`card pf-plan ${p.active ? "" : "off"}`}>
            <div className="pf-plan-top"><h3>{p.name}</h3>{p.active ? <Badge tone="done">{t("plans.live")}</Badge> : <Badge tone="neutral">{t("plans.hidden")}</Badge>}</div>
            <div className="pf-price-line"><b className="tnum">{rs(p.price)}</b><span>{t("plans.perMonth")}</span></div>
            <span className="small muted tnum">{t("plans.yearly", { v: rs(p.yearly) })}</span>
            <ul className="pf-plan-feats">
              {limitKeysFor(type, p).map((k) => <li key={k}><Icon name="check" size={15} /><span className="tnum">{limitText(p.limits[k])}</span> {t(`limit.${k}`)}</li>)}
              {FEATURES.map((f) => <li key={f} className={p.features[f] ? "" : "off"}><Icon name={p.features[f] ? "check" : "minus"} size={15} />{t(`feature.${f}`)}</li>)}
            </ul>
            <div className="pf-plan-foot"><span className="small muted tnum">{t("plans.onPlan", { n: tenantsOn(p.id) })}</span><Button variant="outline" size="sm" icon="pencil" onClick={() => setEdit(structuredClone(p))}>{t("common.edit")}</Button></div>
          </section>
        ))}
      </div>
      <Drawer open={!!edit} onClose={() => setEdit(null)} title={edit?.name} sub={t(`type.${type}`)}
        footer={<><Button variant="outline" onClick={() => setEdit(null)}>{t("common.cancel")}</Button><Button onClick={save}>{t("common.save")}</Button></>}>
        {edit && (
          <div className="pf-stack">
            <Field label={t("plans.name")}><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <div className="pf-grid-2 tight">
              <Field label={t("plans.monthly")}><Input className="input tnum" inputMode="numeric" value={edit.price} onChange={(e) => setEdit({ ...edit, price: Number(e.target.value.replace(/\D/g, "")) })} /></Field>
              {live
                ? <Field label={t("plans.yearlyPrice")} hint="12 months with the 39% saving, worked out from the monthly price."><Input className="input tnum" disabled value={Math.round(edit.price * 12 * 0.61)} /></Field>
                : <Field label={t("plans.yearlyPrice")}><Input className="input tnum" inputMode="numeric" value={edit.yearly} onChange={(e) => setEdit({ ...edit, yearly: Number(e.target.value.replace(/\D/g, "")) })} /></Field>}
            </div>
            <h4 className="pf-subhead">{t("plans.limits")}</h4>
            {limitKeysFor(type, edit).map((k) => (
              <div key={k} className="pf-limit-row">
                <span>{t(`limit.${k}`)}</span>
                <Input className="input tnum" style={{ width: 96 }} disabled={edit.limits[k] === -1} value={edit.limits[k] === -1 ? "" : edit.limits[k] ?? 0}
                  onChange={(e) => setEdit({ ...edit, limits: { ...edit.limits, [k]: Number(e.target.value.replace(/\D/g, "")) } })} aria-label={t(`limit.${k}`)} />
                <label className="check small"><input type="checkbox" checked={edit.limits[k] === -1} onChange={(e) => setEdit({ ...edit, limits: { ...edit.limits, [k]: e.target.checked ? -1 : 1 } })} />{t("common.unlimited")}</label>
              </div>
            ))}
            <h4 className="pf-subhead">{t("plans.features")}</h4>
            {FEATURES.map((f) => <ToggleRow key={f} title={t(`feature.${f}`)} sub={t(`featuredesc.${f}`)} checked={!!edit.features[f]} onChange={(v) => setEdit({ ...edit, features: { ...edit.features, [f]: v } })} />)}
            <ToggleRow title={t("plans.showOnSite")} sub={t("plans.showOnSiteSub")} checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} />
          </div>
        )}
      </Drawer>
    </>
  );
}

export { LIMIT_KEYS, FEATURES, TenantName, Toggle };
