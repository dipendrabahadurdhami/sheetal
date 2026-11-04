// Listing setup: which listing kinds each business type can create, and the options every listing form shows.
// Where it fits: Admin → Listing setup. Signed in as staff, every change is saved on the server (admin API
// /admin/catalog) and the business panel's listing forms follow it; the built-in list is shared/src/data/catalog.js.
// How it works: each change saves the whole list it touched; "Reset" goes back to the built-in list.

import React, { useState } from "react";
import { useT } from "@sheetal/shared/core/i18n";
import { useStore } from "@sheetal/shared/core/store";
import { BUSINESS_TYPES } from "@sheetal/shared/core/rbac";
import { CATALOG, mergeCatalog } from "@sheetal/shared/data/catalog";
import { Button, Checkbox, Confirm, Drawer, Field, Input, PageHead, Panel, SearchInput, Tabs, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { adminApi } from "../api";
import { isStaffLive } from "../live";

const CAT_GROUPS = [
  ["categories", "home"], ["facilities", "home"], ["nearby", "home"], ["environments", "home"], ["exteriorLooks", "home"], ["furnishing", "home"],
  ["interiorLooks", "home"], ["facing", "home"], ["propertyStatus", "home"], ["roadType", "home"], ["ownershipDocs", "home"], ["boosts", "home"],
  ["tenants", "rent"], ["utilities", "rent"], ["leaseTerms", "rent"],
  ["stayTypesHotel", "stay"], ["stayTypesUnit", "stay"], ["roomTypes", "stay"], ["bedTypes", "stay"], ["stayAmenities", "stay"], ["houseRules", "stay"], ["cancellation", "stay"],
  ["projectTypes", "project"], ["unitTypes", "project"], ["projectAmenities", "project"], ["banks", "project"],
  ["investTypes", "invest"], ["returnTypes", "invest"], ["payoutFrequency", "invest"],
  ["districts", "location"],
];
const GROUPS = ["home", "rent", "stay", "project", "invest", "location"];
const ICONS = ["circle-check", "house", "building-2", "car", "wifi", "droplets", "zap", "trees", "mountain", "shield-check", "key-round", "bed-double", "bath", "utensils", "sofa", "sun", "store", "school", "hospital", "bus", "landmark", "map-pin", "calendar-days", "wallet"];
const slug = (s) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

export function AdminCatalog() {
  const t = useT(); const toast = useToast();
  const { db, update } = useStore();
  const [tab, setTab] = useState("options");
  const [key, setKey] = useState("facilities");
  const [find, setFind] = useState(""); const [q, setQ] = useState("");
  const [edit, setEdit] = useState(null); const [ask, setAsk] = useState(null);
  const [stored, setStored] = useState(null);
  const live = isStaffLive();
  const items = db.catalog[key] || [];
  const shown = items.map((it, i) => ({ ...it, i })).filter((it) => !q.trim() || (it.en + " " + it.ne + " " + it.id).toLowerCase().includes(q.trim().toLowerCase()));
  const lists = CAT_GROUPS.filter(([k]) => !find.trim() || t("catalog." + k).toLowerCase().includes(find.trim().toLowerCase()));
  const kinds = db.catalog.listingKinds || [];
  const types = Object.keys(BUSINESS_TYPES);
  const byType = db.catalog.kindsByType || {};
  const usedBy = (kind) => types.filter((ty) => (byType[ty] || []).includes(kind));

  // Signed in: the options as saved on the server, laid over the built-in list.
  const apply = (data) => { setStored(data); update((d) => { d.catalog = structuredClone(mergeCatalog(CATALOG, data)); }); };
  React.useEffect(() => { if (live) adminApi("GET", "/admin/catalog").then((r) => apply(r.data)).catch((e) => toast(e.message)); }, [live]);
  const changed = !!stored?.lists?.[key];

  const setList = (k, list, msg) => {
    update((d) => { d.catalog[k] = list; });
    if (!live) { toast(msg); return; }
    adminApi("PUT", `/admin/catalog/lists/${k}`, { items: list }).then((r) => { apply(r.data); toast(msg); }).catch((e) => { toast(e.message); adminApi("GET", "/admin/catalog").then((r) => apply(r.data)).catch(() => {}); });
  };
  const resetList = () => {
    if (!live) { update((d) => { d.catalog[key] = structuredClone(CATALOG[key] || []); }); toast("Back to the built-in list"); return; }
    adminApi("DELETE", `/admin/catalog/lists/${key}`).then((r) => { apply(r.data); toast(r.message); }).catch((e) => toast(e.message));
  };
  const save = () => {
    const en = (edit.en || "").trim(); if (!en) return;
    const a = [...items];
    const rec = { id: edit.id || slug(en), en, ne: (edit.ne || "").trim() || en, icon: edit.icon || "circle-check" };
    if (edit.i != null) a[edit.i] = { ...a[edit.i], ...rec, id: a[edit.i].id };
    else if (a.some((x) => x.id === rec.id)) a.push({ ...rec, id: rec.id + "_" + a.length }); else a.push(rec);
    setList(key, a, edit.i != null ? "Option updated" : t("catalog.toastAdded")); setEdit(null);
  };
  const move = (i, dir) => { const j = i + dir; if (j < 0 || j >= items.length) return; const a = [...items]; [a[j], a[i]] = [a[i], a[j]]; setList(key, a, "Order saved"); };
  const setKindFor = (ty, kind, on) => {
    const next = structuredClone(byType);
    const l = next[ty] = next[ty] || [];
    const k = l.indexOf(kind);
    if (on && k < 0) l.push(kind);
    if (!on && k >= 0) l.splice(k, 1);
    update((d) => { d.catalog.kindsByType = next; });
    const label = kinds.find((x) => x.id === kind)?.en || kind;
    const msg = on ? label + " turned on for " + t("type." + ty) : label + " turned off for " + t("type." + ty);
    if (!live) { toast(msg); return; }
    adminApi("PUT", "/admin/catalog/kinds", { kindsByType: next }).then((r) => { apply(r.data); toast(msg); }).catch((e) => toast(e.message));
  };

  return (
    <>
      <PageHead title={t("catalog.title")} sub="What businesses can list, and the choices every listing form offers. Changes apply to new and edited listings straight away." />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "options", label: "Form options", icon: "list-checks", count: CAT_GROUPS.length }, { id: "types", label: "Listing types", icon: "layers", count: kinds.length }]} />

      {tab === "types" && <Panel title="Who can list what" sub="Tick the listing types each kind of business can create. Unticked types disappear from their New listing screen. Pro plans can always list every type.">
        <div className="pf-table-wrap"><table className="table pf-table ls-matrix" style={{ minWidth: 720 }}>
          <thead><tr><th>Listing type</th>{types.map((ty) => <th key={ty} style={{ textAlign: "center" }}><span className="ls-type"><Icon name={BUSINESS_TYPES[ty].icon} size={15} />{t("type." + ty)}</span></th>)}</tr></thead>
          <tbody>{kinds.map((k) => (
            <tr key={k.id}>
              <td><span className="pf-two"><b>{k.en}</b><small>{k.ne} · {usedBy(k.id).length ? usedBy(k.id).length + " business types" : "Not offered"}</small></span></td>
              {types.map((ty) => <td key={ty} style={{ textAlign: "center" }}><Checkbox checked={(byType[ty] || []).includes(k.id)} onChange={(v) => setKindFor(ty, k.id, v)} label="" /></td>)}
            </tr>
          ))}</tbody>
        </table></div>
      </Panel>}

      {tab === "options" && <div className="pf-settings ls-wrap">
        <nav className="pf-settings-nav ls-nav" aria-label="Option lists">
          <SearchInput value={find} onChange={setFind} placeholder="Find a list" />
          {GROUPS.map((g) => { const ks = lists.filter(([, gg]) => gg === g); if (!ks.length) return null; return (
            <div key={g} className="ls-group">
              <span className="pf-nav-group">{t("catalog.g_" + g)}</span>
              {ks.map(([k]) => <button key={k} type="button" className={key === k ? "on" : ""} aria-current={key === k ? "page" : undefined} onClick={() => { setKey(k); setQ(""); }}><span>{t("catalog." + k)}</span><span className="pf-count">{(db.catalog[k] || []).length}</span></button>)}
            </div>); })}
        </nav>
        <Panel title={t("catalog." + key)} sub={items.length + " options · shown in this order on every form" + (changed ? " · changed by Sheetal" : "")} className="grow"
          actions={<>{changed && <Button size="sm" variant="ghost" icon="rotate-ccw" onClick={resetList}>Reset</Button>}<Button size="sm" icon="plus" onClick={() => setEdit({ en: "", ne: "", icon: "circle-check" })}>Add option</Button></>}>
          {items.length > 6 && <div className="pf-pad" style={{ paddingBottom: 0 }}><SearchInput value={q} onChange={setQ} placeholder={"Search " + t("catalog." + key).toLowerCase()} /></div>}
          {shown.length ? <ul className="pf-cat-list ls-list">{shown.map((it) => (
            <li key={it.id}>
              <span className="pf-cat-ico"><Icon name={it.icon || "circle-check"} size={18} /></span>
              <span className="pf-two"><b>{it.en}</b><small>{it.ne}</small></span>
              <code className="tiny muted">{it.id}</code>
              <div className="pf-row-actions">
                <button type="button" className="btn btn-ghost btn-icon" aria-label={"Move " + it.en + " up"} disabled={it.i === 0 || !!q} onClick={() => move(it.i, -1)}><Icon name="arrow-up" size={15} /></button>
                <button type="button" className="btn btn-ghost btn-icon" aria-label={"Move " + it.en + " down"} disabled={it.i === items.length - 1 || !!q} onClick={() => move(it.i, 1)}><Icon name="arrow-down" size={15} /></button>
                <button type="button" className="btn btn-ghost btn-icon" aria-label={"Edit " + it.en} onClick={() => setEdit({ ...it })}><Icon name="pencil" size={15} /></button>
                <button type="button" className="btn btn-ghost btn-icon" aria-label={"Delete " + it.en} onClick={() => setAsk(it)}><Icon name="trash-2" size={15} /></button>
              </div>
            </li>
          ))}</ul> : <p className="pf-pad small muted">{q ? "No option matches “" + q + "”." : "No options yet. Add the first one."}</p>}
        </Panel>
      </div>}

      <Drawer open={!!edit} onClose={() => setEdit(null)} title={edit && edit.i != null ? "Edit option" : "Add option"} sub={t("catalog." + key)}
        footer={<><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button disabled={!edit || !(edit.en || "").trim()} onClick={save}>{edit && edit.i != null ? "Save" : "Add option"}</Button></>}>
        {edit && <div className="pf-stack">
          <Field label="Name in English"><Input value={edit.en} onChange={(e) => setEdit({ ...edit, en: e.target.value })} placeholder="e.g. Solar water heater" /></Field>
          <Field label="Name in Nepali" hint="Leave empty to use the English name"><Input value={edit.ne} onChange={(e) => setEdit({ ...edit, ne: e.target.value })} placeholder="सोलार पानी तताउने" /></Field>
          <Field label="Icon"><div className="ls-icons" role="radiogroup" aria-label="Icon">{ICONS.map((ic) => <button key={ic} type="button" role="radio" aria-checked={edit.icon === ic} aria-label={ic} className={edit.icon === ic ? "on" : ""} onClick={() => setEdit({ ...edit, icon: ic })}><Icon name={ic} size={18} /></button>)}</div></Field>
          {edit.i == null && <p className="pf-hint"><Icon name="info" size={13} />Saved as <code>{slug(edit.en || "") || "…"}</code>. Existing listings keep their saved choices.</p>}
        </div>}
      </Drawer>
      <Confirm open={!!ask} onClose={() => setAsk(null)} danger confirmLabel="Delete" title={ask ? "Delete “" + ask.en + "”?" : ""}
        onConfirm={() => setList(key, items.filter((_, j) => j !== ask.i), "Option deleted")}>
        It will no longer appear on listing forms. Listings that already use it keep showing it.
      </Confirm>
    </>
  );
}
