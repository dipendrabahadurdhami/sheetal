// Paid add-ons on top of a plan: the list, the admin editor and the business's buying screen.
// Where it fits: Admin → Add-ons and the business panel's billing area (sample data for now, marked Preview).
// How it works: Sheetal sets each add-on's price, unit and which business types may buy it.

import React, { useState } from "react";
import { useT } from "../core/i18n";
import { useStore } from "../core/store";
import { rs } from "../core/format";
import { Badge, Button, Drawer, Field, Input, PageHead, Table, ToggleRow, useToast } from "../core/ui";
import { Icon } from "../core/icons";
import { BUSINESS_TYPES } from "../core/rbac";
import { isAllAccess, planOf } from "../core/plans";

export const ADDONS = [
  { id: "pos", icon: "store", price: 1500, unit: "outlet", types: ["hotel", "host"], includedIn: ["hotel-pro"] },
  { id: "seats", icon: "users", price: 300, unit: "seat", types: ["hotel", "host", "developer", "agency", "sponsor"], includedIn: [] },
  { id: "hr", icon: "map-pin", price: 50, unit: "staff", types: ["hotel", "host", "developer", "agency", "sponsor"], includedIn: ["hotel-pro", "developer-pro", "agency-pro"] },
  { id: "inbox", icon: "messages-square", price: 1200, unit: "month", types: ["hotel", "host", "developer", "agency"], includedIn: ["agency-pro"] },
  { id: "channel", icon: "refresh-cw", price: 900, unit: "month", types: ["hotel", "host"], includedIn: ["hotel-business", "hotel-pro"] },
  { id: "mailbox", icon: "mail", price: 200, unit: "mailbox", types: ["hotel", "host", "developer", "agency", "sponsor"], includedIn: [] },
  { id: "api", icon: "code", price: 2500, unit: "month", types: ["hotel", "host", "developer", "agency", "sponsor"], includedIn: ["hotel-pro", "developer-pro", "agency-pro"] },
];

export function AdminAddons() {
  const t = useT();
  const { db, update } = useStore();
  const toast = useToast();
  const list = db.addons || ADDONS;
  const [edit, setEdit] = useState(null);
  const save = () => { update((d) => { d.addons = (d.addons || structuredClone(ADDONS)).map((a) => (a.id === edit.id ? edit : a)); }); setEdit(null); toast(t("plans.toastSaved")); };
  return (
    <>
      <PageHead title={t("addon.title")} sub={t("addon.sub")} />
      <section className="card pf-panel"><Table rows={list} onRowClick={(a) => setEdit(structuredClone(a))} minWidth={820} columns={[
        { key: "n", label: t("addon.addon"), render: (a) => <span className="pf-person"><span className="pf-li-ico"><Icon name={a.icon} size={16} /></span><span className="pf-two"><b>{t(`addon.${a.id}`)}</b><small>{t(`addon.${a.id}Sub`)}</small></span></span> },
        { key: "p", label: t("addon.price"), num: true, align: "right", render: (a) => `${rs(a.price)} / ${t(`addon.u_${a.unit}`)}` },
        { key: "t", label: t("addon.for"), render: (a) => <span className="pf-chips">{a.types.map((ty) => <span key={ty} className="pf-type-dot" title={t(`type.${ty}`)}><Icon name={BUSINESS_TYPES[ty].icon} size={14} /></span>)}</span> },
        { key: "i", label: t("addon.included"), render: (a) => a.includedIn.length ? <span className="small">{a.includedIn.map((p) => db.plans.find((x) => x.id === p)).filter(Boolean).map((p) => `${t(`type.${p.type}`)} ${p.name}`).join(", ")}</span> : <span className="small muted">—</span> },
        { key: "x", label: "", align: "right", render: () => <Button variant="ghost" size="sm" icon="pencil">{t("common.edit")}</Button> },
      ]} /></section>
      <Drawer open={!!edit} onClose={() => setEdit(null)} title={edit && t(`addon.${edit.id}`)} footer={<><Button variant="outline" onClick={() => setEdit(null)}>{t("common.cancel")}</Button><Button onClick={save}>{t("common.save")}</Button></>}>
        {edit && <div className="pf-stack">
          <Field label={t("addon.price")} hint={t("addon.per", { u: t(`addon.u_${edit.unit}`) })}><Input className="input tnum" value={edit.price} onChange={(e) => setEdit({ ...edit, price: Number(e.target.value.replace(/\D/g, "")) })} /></Field>
          <h4 className="pf-subhead">{t("addon.for")}</h4>
          {Object.keys(BUSINESS_TYPES).map((ty) => <ToggleRow key={ty} title={t(`type.${ty}`)} checked={edit.types.includes(ty)} onChange={(v) => setEdit({ ...edit, types: v ? [...edit.types, ty] : edit.types.filter((x) => x !== ty) })} />)}
          <h4 className="pf-subhead">{t("addon.included")}</h4>
          {db.plans.filter((p) => edit.types.includes(p.type)).map((p) => <ToggleRow key={p.id} title={`${t(`type.${p.type}`)} · ${p.name}`} checked={edit.includedIn.includes(p.id)} onChange={(v) => setEdit({ ...edit, includedIn: v ? [...edit.includedIn, p.id] : edit.includedIn.filter((x) => x !== p.id) })} />)}
        </div>}
      </Drawer>
    </>
  );
}

export function BusinessAddons({ tenant, canManage }) {
  const t = useT();
  const { db, update } = useStore();
  const toast = useToast();
  const owned = db.ownedAddons?.[tenant.id] || { pos: 2, channel: 1 };
  const list = (db.addons || ADDONS).filter((a) => a.types.includes(tenant.type));
  const setQty = (id, n) => update((d) => { d.ownedAddons = d.ownedAddons || {}; d.ownedAddons[tenant.id] = { ...owned, [id]: n }; });
  // Pro includes every add-on.
  const included = (a) => a.includedIn.includes(tenant.planId) || isAllAccess(planOf(db, tenant));
  const monthly = list.reduce((s, a) => s + (included(a) ? 0 : (owned[a.id] || 0) * a.price), 0);
  return (
    <section className="card pf-panel">
      <div className="pf-panel-head"><div className="pf-panel-title"><h2>{t("addon.title")}</h2><span className="tnum">{t("addon.monthly", { v: rs(monthly) })}</span></div></div>
      <ul className="pf-list">{list.map((a) => {
        const inc = included(a);
        const q = owned[a.id] || 0;
        return (
          <li key={a.id}><span className="pf-li-ico"><Icon name={a.icon} size={16} /></span>
            <div><b>{t(`addon.${a.id}`)}</b><span className="small muted">{t(`addon.${a.id}Sub`)} · <span className="tnum">{rs(a.price)} / {t(`addon.u_${a.unit}`)}</span></span></div>
            {inc ? <Badge tone="done">{t("addon.inPlan")}</Badge> : canManage ? (
              <div className="pf-counter" role="group" aria-label={t(`addon.${a.id}`)}>
                <button type="button" disabled={!q} onClick={() => setQty(a.id, q - 1)} aria-label="−"><Icon name="minus" size={15} /></button><b className="tnum">{q}</b>
                <button type="button" onClick={() => { setQty(a.id, q + 1); toast(t("addon.toastAdded")); }} aria-label="+"><Icon name="plus" size={15} /></button>
              </div>) : <span className="tnum">{q}</span>}
          </li>
        );
      })}</ul>
    </section>
  );
}
