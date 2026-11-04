// Listing setup: which listing kinds each business type can create, and every option the listing forms and the
// website's filters show (41 lists, two of them grouped: property types per category and areas per district).
// Where it fits: Admin → Listing setup. Signed in as staff, every change is saved on the server (admin API
// /admin/catalog); the business panel's listing forms and the website's filters follow it. The built-in lists, which
// work with no changes at all, are shared/src/data/catalog.js.
// How it works: each change saves the whole list (or the one group) it touched; "Reset" goes back to the built-in one.

import React, { useState } from "react";
import { useT } from "@sheetal/shared/core/i18n";
import { useStore } from "@sheetal/shared/core/store";
import { BUSINESS_TYPES } from "@sheetal/shared/core/rbac";
import { CATALOG, mergeCatalog } from "@sheetal/shared/data/catalog";
import { Button, Checkbox, Confirm, Drawer, Field, Input, PageHead, Panel, SearchInput, Seg, Tabs, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { adminApi } from "../api";
import { isStaffLive } from "../live";

const CAT_GROUPS = [
  ["categories", "home"], ["propertyTypes", "home"], ["classTypes", "home"], ["ownerTypes", "home"], ["urgency", "home"], ["facilities", "home"], ["nearby", "home"],
  ["environments", "home"], ["exteriorLooks", "home"], ["furnishing", "home"], ["interiorLooks", "home"], ["facing", "home"], ["roadWidth", "home"], ["roadType", "home"],
  ["propertyStatus", "home"], ["ownershipDocs", "home"], ["boosts", "home"],
  ["tenants", "rent"], ["utilities", "rent"], ["deposits", "rent"], ["leaseTerms", "rent"],
  ["stayTypesHotel", "stay"], ["stayTypesUnit", "stay"], ["stars", "stay"], ["roomTypes", "stay"], ["bedTypes", "stay"], ["sleepingSpaces", "stay"], ["bathroomTypes", "stay"],
  ["roomAmenities", "stay"], ["bathroomAmenities", "stay"], ["kitchenItems", "stay"], ["roomViews", "stay"], ["stayAmenities", "stay"], ["safetyItems", "stay"],
  ["accessibility", "stay"], ["houseRules", "stay"], ["checkTimes", "stay"], ["cancellation", "stay"],
  ["projectTypes", "project"], ["projectStatus", "project"], ["unitTypes", "project"], ["projectAmenities", "project"], ["banks", "project"],
  ["investTypes", "invest"], ["returnTypes", "invest"], ["payoutFrequency", "invest"], ["minInvest", "invest"],
  ["districts", "location"], ["areas", "location"],
];
const GROUPS = ["home", "rent", "stay", "project", "invest", "location"];
// Lists kept per parent: property types per category, areas (plain names) per district.
const GROUPED = { propertyTypes: "categories", areas: "districts" };
const LABELS = {
  propertyTypes: "Property types", classTypes: "Area type", ownerTypes: "Posted by", urgency: "How soon", roadWidth: "Road width", deposits: "Deposit",
  stars: "Star rating", sleepingSpaces: "Sleeping spaces", bathroomTypes: "Bathroom types", roomAmenities: "In the room", bathroomAmenities: "Bathroom items",
  kitchenItems: "Kitchen and dining", roomViews: "Views", safetyItems: "Safety", accessibility: "Accessibility", checkTimes: "Check-in and check-out times",
  projectStatus: "Project status", minInvest: "Minimum investment", areas: "Areas", g_stay: "Stays",
};
const ICONS = ["circle-check", "house", "building-2", "car", "wifi", "droplets", "zap", "trees", "mountain", "shield-check", "key-round", "bed-double", "bed-single", "utensils", "cooking-pot", "chef-hat", "sofa", "armchair", "tv", "sun", "moon", "store", "school", "hospital", "bus", "landmark", "map-pin", "calendar-days", "wallet", "flame", "eye", "star", "lock", "heater", "concierge-bell", "plane", "wine", "coffee", "waves", "sprout"];
const slug = (s) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

export function AdminCatalog() {
  const t = useT(); const toast = useToast();
  const { db, update } = useStore();
  const label = (k) => { const s = t("catalog." + k); return !s || s === "catalog." + k ? LABELS[k] || k : s; };
  const [tab, setTab] = useState("options");
  const [key, setKey] = useState("facilities");
  const [parent, setParent] = useState(null);
  const [find, setFind] = useState(""); const [q, setQ] = useState("");
  const [edit, setEdit] = useState(null); const [ask, setAsk] = useState(null);
  const [stored, setStored] = useState(null);
  const live = isStaffLive();

  const parentKey = GROUPED[key];
  const parents = parentKey ? db.catalog[parentKey] || [] : [];
  const par = parentKey ? (parents.some((p) => p.id === parent) ? parent : parents[0]?.id) : null;
  const names = key === "areas";
  const raw = parentKey ? db.catalog[key]?.[par] || [] : db.catalog[key] || [];
  const items = names ? raw.map((s) => ({ id: s, en: s, ne: s, icon: "map-pin" })) : raw;
  const shown = items.map((it, i) => ({ ...it, i })).filter((it) => !q.trim() || (it.en + " " + it.ne + " " + it.id).toLowerCase().includes(q.trim().toLowerCase()));
  const lists = CAT_GROUPS.filter(([k]) => !find.trim() || label(k).toLowerCase().includes(find.trim().toLowerCase()));
  const countOf = (k) => { const v = db.catalog[k]; return Array.isArray(v) ? v.length : Object.values(v || {}).reduce((n, l) => n + (l?.length || 0), 0); };
  const kinds = db.catalog.listingKinds || [];
  const types = Object.keys(BUSINESS_TYPES);
  const byType = db.catalog.kindsByType || {};
  const usedBy = (kind) => types.filter((ty) => (byType[ty] || []).includes(kind));

  // Signed in: the options as saved on the server, laid over the built-in lists.
  const apply = (data) => { setStored(data); update((d) => { d.catalog = structuredClone(mergeCatalog(CATALOG, data)); }); };
  const reload = () => adminApi("GET", "/admin/catalog").then((r) => apply(r.data)).catch(() => {});
  React.useEffect(() => { if (live) adminApi("GET", "/admin/catalog").then((r) => apply(r.data)).catch((e) => toast(e.message)); }, [live]);
  const changed = parentKey ? !!stored?.lists?.[key]?.[par] : Array.isArray(stored?.lists?.[key]);

  const setList = (list, msg) => {
    const value = names ? list.map((x) => x.en) : list;
    update((d) => { if (parentKey) d.catalog[key] = { ...(d.catalog[key] || {}), [par]: value }; else d.catalog[key] = value; });
    if (!live) { toast(msg); return; }
    const url = parentKey ? `/admin/catalog/groups/${key}/${par}` : `/admin/catalog/lists/${key}`;
    adminApi("PUT", url, { items: value }).then((r) => { apply(r.data); toast(msg); }).catch((e) => { toast(e.message); reload(); });
  };
  const resetList = () => {
    if (!live) { update((d) => { if (parentKey) d.catalog[key] = { ...d.catalog[key], [par]: structuredClone(CATALOG[key]?.[par] || []) }; else d.catalog[key] = structuredClone(CATALOG[key] || []); }); toast("Back to the built-in list"); return; }
    adminApi("DELETE", parentKey ? `/admin/catalog/groups/${key}/${par}` : `/admin/catalog/lists/${key}`).then((r) => { apply(r.data); toast(r.message); }).catch((e) => toast(e.message));
  };
  const save = () => {
    const en = (edit.en || "").trim(); if (!en) return;
    const a = [...items];
    const rec = names ? { id: en, en, ne: en } : { id: edit.id || slug(en), en, ne: (edit.ne || "").trim() || en, icon: edit.icon || "circle-check" };
    if (names && a.some((x, j) => j !== edit.i && x.en.toLowerCase() === en.toLowerCase())) { toast(`“${en}” is already in the list`); return; }
    if (edit.i != null) a[edit.i] = names ? rec : { ...a[edit.i], ...rec, id: a[edit.i].id };
    else if (a.some((x) => x.id === rec.id)) a.push({ ...rec, id: rec.id + "_" + a.length }); else a.push(rec);
    setList(a, edit.i != null ? "Option updated" : t("catalog.toastAdded")); setEdit(null);
  };
  const move = (i, dir) => { const j = i + dir; if (j < 0 || j >= items.length) return; const a = [...items]; [a[j], a[i]] = [a[i], a[j]]; setList(a, "Order saved"); };
  const setKindFor = (ty, kind, on) => {
    const next = structuredClone(byType);
    const l = next[ty] = next[ty] || [];
    const k = l.indexOf(kind);
    if (on && k < 0) l.push(kind);
    if (!on && k >= 0) l.splice(k, 1);
    update((d) => { d.catalog.kindsByType = next; });
    const name = kinds.find((x) => x.id === kind)?.en || kind;
    const msg = on ? name + " turned on for " + t("type." + ty) : name + " turned off for " + t("type." + ty);
    if (!live) { toast(msg); return; }
    adminApi("PUT", "/admin/catalog/kinds", { kindsByType: next }).then((r) => { apply(r.data); toast(msg); }).catch((e) => toast(e.message));
  };
  const parentName = parents.find((p) => p.id === par)?.en || "";
  const title = label(key) + (parentKey && parentName ? " · " + parentName : "");

  return (
    <>
      <PageHead title={t("catalog.title")} sub="What businesses can list, and the choices every listing form and website filter offers. Everything has a full built-in list, so nothing needs adding by hand; changes apply straight away." />
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
              {ks.map(([k]) => <button key={k} type="button" className={key === k ? "on" : ""} aria-current={key === k ? "page" : undefined} onClick={() => { setKey(k); setQ(""); setParent(null); }}><span>{label(k)}</span><span className="pf-count">{countOf(k)}</span></button>)}
            </div>); })}
        </nav>
        <Panel title={title} sub={items.length + (names ? " areas" : " options") + " · shown in this order on every form and filter" + (changed ? " · changed by Sheetal" : "")} className="grow"
          actions={<>{changed && <Button size="sm" variant="ghost" icon="rotate-ccw" onClick={resetList}>Reset</Button>}<Button size="sm" icon="plus" onClick={() => setEdit({ en: "", ne: "", icon: "circle-check" })}>{names ? "Add area" : "Add option"}</Button></>}>
          {parentKey && <div className="pf-pad" style={{ paddingBottom: 0 }}>
            <span className="small muted">{parentKey === "districts" ? "District" : "Category"}</span>
            {parents.length > 8
              ? <select className="input" value={par || ""} onChange={(e) => { setParent(e.target.value); setQ(""); }} aria-label="District">{parents.map((p) => <option key={p.id} value={p.id}>{p.en} ({(db.catalog[key]?.[p.id] || []).length})</option>)}</select>
              : <Seg value={par} onChange={(v) => { setParent(v); setQ(""); }} options={parents.map((p) => ({ id: p.id, label: p.en }))} />}
          </div>}
          {items.length > 6 && <div className="pf-pad" style={{ paddingBottom: 0 }}><SearchInput value={q} onChange={setQ} placeholder={"Search " + label(key).toLowerCase()} /></div>}
          {shown.length ? <ul className="pf-cat-list ls-list">{shown.map((it) => (
            <li key={it.id + it.i}>
              <span className="pf-cat-ico"><Icon name={it.icon || "circle-check"} size={18} /></span>
              <span className="pf-two"><b>{it.en}</b>{!names && <small>{it.ne}</small>}</span>
              {!names && <code className="tiny muted">{it.id}</code>}
              <div className="pf-row-actions">
                <button type="button" className="btn btn-ghost btn-icon" aria-label={"Move " + it.en + " up"} disabled={it.i === 0 || !!q} onClick={() => move(it.i, -1)}><Icon name="arrow-up" size={15} /></button>
                <button type="button" className="btn btn-ghost btn-icon" aria-label={"Move " + it.en + " down"} disabled={it.i === items.length - 1 || !!q} onClick={() => move(it.i, 1)}><Icon name="arrow-down" size={15} /></button>
                <button type="button" className="btn btn-ghost btn-icon" aria-label={"Edit " + it.en} onClick={() => setEdit({ ...it })}><Icon name="pencil" size={15} /></button>
                <button type="button" className="btn btn-ghost btn-icon" aria-label={"Delete " + it.en} onClick={() => setAsk(it)}><Icon name="trash-2" size={15} /></button>
              </div>
            </li>
          ))}</ul> : <p className="pf-pad small muted">{q ? "Nothing matches “" + q + "”." : names ? "No areas for this district yet. Businesses can still type their own." : "No options yet. Add the first one."}</p>}
        </Panel>
      </div>}

      <Drawer open={!!edit} onClose={() => setEdit(null)} title={edit && edit.i != null ? (names ? "Edit area" : "Edit option") : names ? "Add area" : "Add option"} sub={title}
        footer={<><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button disabled={!edit || !(edit.en || "").trim()} onClick={save}>{edit && edit.i != null ? "Save" : names ? "Add area" : "Add option"}</Button></>}>
        {edit && <div className="pf-stack">
          <Field label={names ? "Area name" : "Name in English"}><Input value={edit.en} onChange={(e) => setEdit({ ...edit, en: e.target.value })} placeholder={names ? "e.g. Dhapasi" : "e.g. Solar water heater"} /></Field>
          {!names && <Field label="Name in Nepali" hint="Leave empty to use the English name"><Input value={edit.ne} onChange={(e) => setEdit({ ...edit, ne: e.target.value })} placeholder="सोलार पानी तताउने" /></Field>}
          {!names && <Field label="Icon"><div className="ls-icons" role="radiogroup" aria-label="Icon">{ICONS.map((ic) => <button key={ic} type="button" role="radio" aria-checked={edit.icon === ic} aria-label={ic} className={edit.icon === ic ? "on" : ""} onClick={() => setEdit({ ...edit, icon: ic })}><Icon name={ic} size={18} /></button>)}</div></Field>}
          {edit.i == null && !names && <p className="pf-hint"><Icon name="info" size={13} />Saved as <code>{slug(edit.en || "") || "…"}</code>. Existing listings keep their saved choices.</p>}
        </div>}
      </Drawer>
      <Confirm open={!!ask} onClose={() => setAsk(null)} danger confirmLabel="Delete" title={ask ? "Delete “" + ask.en + "”?" : ""}
        onConfirm={() => setList(items.filter((_, j) => j !== ask.i), names ? "Area deleted" : "Option deleted")}>
        It will no longer appear on listing forms and filters. Listings that already use it keep showing it.
      </Confirm>
    </>
  );
}
