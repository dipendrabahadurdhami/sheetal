// Admin → Listing setup → Listing forms: the questions each listing type's form asks, in which steps and order.
// Staff rename steps and fields (English and Nepali), add help text, set fields required or optional, choose which
// categories see a field, hide fields, and add their own (text, number, pick one, pick several, yes or no, count).
// Where it fits: AdminListingSetup.jsx. Saved per type on the server (PUT /admin/catalog/forms/:kind); the business
// panel's listing wizard follows it (shared/src/data/formSetup.js). Core fields can be renamed but never hidden.

import React, { useState } from "react";
import { useStore } from "@sheetal/shared/core/store";
import { Button, Checkbox, Drawer, Field, Input, Panel, Seg, Toggle, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { CUSTOM_TYPES, formLayout } from "@sheetal/shared/data/formSetup";
import { adminApi } from "../api";
import { isStaffLive } from "../live";

const TYPE_NAMES = { choice: "Pick one", multi: "Pick several", counter: "Count", seg: "Pick one", text: "Short text", number: "Number", price: "Price", toggle: "Yes or no", land: "Land area", location: "Location", map: "Map pin", photos: "Photos", docs: "Papers", repeat: "List", story: "Title and description" };
const LISTS = ["facilities", "nearby", "environments", "furnishing", "facing", "roadType", "roadWidth", "ownershipDocs", "tenants", "utilities", "deposits", "leaseTerms", "stayAmenities", "roomAmenities", "bathroomAmenities", "kitchenItems", "roomViews", "safetyItems", "accessibility", "houseRules", "projectAmenities", "banks", "plotShapes", "landTypes", "commercialUses"];
const slug = (s) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);

export function AdminFormSetup() {
  const { db, update } = useStore();
  const toast = useToast();
  const C = db.catalog;
  const kinds = C.listingKinds || [];
  const [kind, setKind] = useState(kinds[0]?.id || "sell");
  const [edit, setEdit] = useState(null);
  const live = isStaffLive();
  const setup = C.forms?.[kind] || {};
  const steps = formLayout(kind, setup);

  const save = (next, msg) => {
    update((d) => { d.catalog.forms = { ...(d.catalog.forms || {}), [kind]: next }; });
    if (!live) { toast(msg); return; }
    adminApi("PUT", `/admin/catalog/forms/${kind}`, next).then(() => toast(msg)).catch((e) => toast(e.message));
  };
  const reset = () => {
    update((d) => { const f = { ...(d.catalog.forms || {}) }; delete f[kind]; d.catalog.forms = f; });
    if (live) adminApi("DELETE", `/admin/catalog/forms/${kind}`).then((r) => toast(r.message)).catch((e) => toast(e.message)); else toast("Back to the built-in form");
  };
  const withField = (name, patch) => ({ ...setup, fields: { ...(setup.fields || {}), [name]: { ...(setup.fields?.[name] || {}), ...patch } } });
  const withCustom = (fn) => ({ ...setup, custom: fn(setup.custom || []) });

  const moveStep = (i, dir) => {
    const j = i + dir; if (j < 0 || j >= steps.length) return;
    const order = steps.map((s) => s.id); [order[i], order[j]] = [order[j], order[i]];
    save({ ...setup, steps: Object.fromEntries(order.map((id, k) => [id, { ...(setup.steps?.[id] || {}), order: k }])) }, "Steps reordered");
  };
  const moveField = (st, i, dir) => {
    const j = i + dir; if (j < 0 || j >= st.fields.length) return;
    const names = st.fields.map((f) => f.name); [names[i], names[j]] = [names[j], names[i]];
    const fields = { ...(setup.fields || {}) };
    const custom = (setup.custom || []).map((c) => (names.includes(c.name) ? { ...c, order: names.indexOf(c.name) } : c));
    names.forEach((n, k) => { if (!custom.some((c) => c.name === n)) fields[n] = { ...(fields[n] || {}), order: k }; });
    save({ ...setup, fields, custom }, "Order saved");
  };
  const toggleHidden = (f) => {
    if (f.custom) save(withCustom((l) => l.filter((c) => c.name !== f.name)), "Field deleted");
    else save(withField(f.name, { hidden: !f.hidden }), f.hidden ? "Field shown again" : "Field hidden from the form");
  };
  const saveEdit = () => {
    const e = edit;
    const label = [e.en.trim(), e.ne.trim() || e.en.trim()];
    const help = e.helpEn.trim() ? [e.helpEn.trim(), e.helpNe.trim() || e.helpEn.trim()] : undefined;
    if (!label[0]) return;
    if (e.isNew || e.custom) {
      const name = e.name || `x_${slug(label[0]) || "field"}`;
      const c = { name, type: e.type, label, help, step: e.step, order: e.order ?? 99, req: !!e.req, cats: e.cats?.length ? e.cats : undefined,
        listKey: (e.type === "choice" || e.type === "multi") && e.source !== "own" ? e.source : undefined,
        options: (e.type === "choice" || e.type === "multi") && e.source === "own" ? e.optionsText.split("\n").map((s) => s.trim()).filter(Boolean).map((s) => ({ id: slug(s), en: s })) : undefined };
      save(withCustom((l) => (l.some((x) => x.name === name) ? l.map((x) => (x.name === name ? c : x)) : [...l, c])), e.isNew ? "Field added" : "Field saved");
    } else {
      save(withField(e.name, { label, help, step: e.step, ...(e.locked ? {} : { req: !!e.req }), cats: e.cats?.length ? e.cats : undefined }), "Field saved");
    }
    setEdit(null);
  };
  const open = (f, st) => setEdit({
    name: f?.name, isNew: !f, custom: f?.custom, locked: f?.locked, type: f?.type || "text", step: f?.step || st.id, order: f?.order,
    en: f?.label?.[0] || "", ne: f?.label?.[1] || "", helpEn: f?.note?.[0] || "", helpNe: f?.note?.[1] || "", req: !!f?.req, cats: f?.cats || [],
    source: f?.listKey || (f?.options ? "own" : "facilities"), optionsText: (f?.options || []).map((o) => o.en).join("\n"),
  });
  const isCustomType = edit && (edit.isNew || edit.custom);
  const cats = (kind === "sell" || kind === "rentout") ? C.categories || [] : [];

  return (
    <div className="pf-stack">
      <Panel title="Which form" sub="Each listing type has its own form. Changes apply to new and edited listings straight away." pad
        actions={C.forms?.[kind] && <Button size="sm" variant="ghost" icon="rotate-ccw" onClick={reset}>Reset this form</Button>}>
        <Seg value={kind} onChange={setKind} options={kinds.map((k) => ({ id: k.id, label: k.en }))} />
      </Panel>
      {steps.map((st, si) => (
        <Panel key={st.id} title={`${si + 1}. ${st.label[0]}`} sub={`${st.fields.filter((f) => !f.hidden).length} questions${st.hidden ? " · step hidden" : ""}`}
          actions={<div className="pf-row-actions">
            <button type="button" className="btn btn-ghost btn-icon" aria-label="Move step up" disabled={si === 0} onClick={() => moveStep(si, -1)}><Icon name="arrow-up" size={15} /></button>
            <button type="button" className="btn btn-ghost btn-icon" aria-label="Move step down" disabled={si === steps.length - 1} onClick={() => moveStep(si, 1)}><Icon name="arrow-down" size={15} /></button>
            <Button size="sm" variant="ghost" icon="pencil" onClick={() => { const en = prompt("Step name in English", st.label[0]); if (en === null) return; const ne = prompt("Step name in Nepali", st.label[1]) ?? st.label[1]; save({ ...setup, steps: { ...(setup.steps || {}), [st.id]: { ...(setup.steps?.[st.id] || {}), label: [en.trim() || st.label[0], ne.trim() || en.trim()] } } }, "Step renamed"); }}>Rename</Button>
            <Button size="sm" icon="plus" onClick={() => open(null, st)}>Add field</Button>
          </div>}>
          <ul className="pf-cat-list ls-list">{st.fields.map((f, i) => (
            <li key={f.name} style={f.hidden ? { opacity: 0.5 } : undefined}>
              <span className="pf-cat-ico"><Icon name={f.locked ? "lock" : f.custom ? "plus" : "list-checks"} size={16} /></span>
              <span className="pf-two"><b>{f.label?.[0] || f.name}{f.req && " *"}</b><small>{[TYPE_NAMES[f.type] || f.type, f.cats?.length ? `only ${f.cats.map((c) => cats.find((x) => x.id === c)?.en || c).join(", ")}` : null, f.hidden && "hidden", f.custom && "added by Sheetal"].filter(Boolean).join(" · ")}</small></span>
              <div className="pf-row-actions">
                <button type="button" className="btn btn-ghost btn-icon" aria-label="Move up" disabled={i === 0} onClick={() => moveField(st, i, -1)}><Icon name="arrow-up" size={15} /></button>
                <button type="button" className="btn btn-ghost btn-icon" aria-label="Move down" disabled={i === st.fields.length - 1} onClick={() => moveField(st, i, 1)}><Icon name="arrow-down" size={15} /></button>
                <button type="button" className="btn btn-ghost btn-icon" aria-label={"Edit " + (f.label?.[0] || f.name)} onClick={() => open(f, st)}><Icon name="pencil" size={15} /></button>
                {!f.locked && <button type="button" className="btn btn-ghost btn-icon" aria-label={f.custom ? "Delete" : f.hidden ? "Show" : "Hide"} onClick={() => toggleHidden(f)}><Icon name={f.custom ? "trash-2" : f.hidden ? "eye" : "x"} size={15} /></button>}
              </div>
            </li>
          ))}</ul>
        </Panel>
      ))}

      <Drawer open={!!edit} onClose={() => setEdit(null)} title={edit?.isNew ? "Add field" : "Edit field"} sub={edit?.locked ? "Every listing needs this field; it can be renamed and explained." : undefined}
        footer={<><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button disabled={!edit?.en.trim()} onClick={saveEdit}>Save</Button></>}>
        {edit && <div className="pf-stack">
          <Field label="Question in English"><Input value={edit.en} onChange={(e) => setEdit({ ...edit, en: e.target.value })} placeholder="e.g. Society fee" /></Field>
          <Field label="Question in Nepali" hint="Leave empty to use the English"><Input value={edit.ne} onChange={(e) => setEdit({ ...edit, ne: e.target.value })} /></Field>
          <Field label="Help text in English" hint="Shown under the question"><Input value={edit.helpEn} onChange={(e) => setEdit({ ...edit, helpEn: e.target.value })} /></Field>
          <Field label="Help text in Nepali"><Input value={edit.helpNe} onChange={(e) => setEdit({ ...edit, helpNe: e.target.value })} /></Field>
          {isCustomType && <Field label="Answer type"><select className="input" value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value })}>{CUSTOM_TYPES.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select></Field>}
          {isCustomType && (edit.type === "choice" || edit.type === "multi") && <>
            <Field label="Choices from"><select className="input" value={edit.source} onChange={(e) => setEdit({ ...edit, source: e.target.value })}><option value="own">Its own list (below)</option>{LISTS.map((k) => <option key={k} value={k}>Option list: {k}</option>)}</select></Field>
            {edit.source === "own" && <Field label="Choices, one per line"><textarea className="input" rows={5} value={edit.optionsText} onChange={(e) => setEdit({ ...edit, optionsText: e.target.value })} /></Field>}
          </>}
          <Field label="Step"><select className="input" value={edit.step} onChange={(e) => setEdit({ ...edit, step: e.target.value })}>{steps.map((s) => <option key={s.id} value={s.id}>{s.label[0]}</option>)}</select></Field>
          {!edit.locked && <div className="row" style={{ gap: 10 }}><Toggle checked={!!edit.req} onChange={(v) => setEdit({ ...edit, req: v })} /><span>Required: the form can't be sent without it</span></div>}
          {cats.length > 0 && <Field label="Show for these categories" hint="None ticked = every category">
            <div className="pf-check-grid">{cats.map((c) => <Checkbox key={c.id} label={c.en} checked={edit.cats.includes(c.id)} onChange={(v) => setEdit({ ...edit, cats: v ? [...edit.cats, c.id] : edit.cats.filter((x) => x !== c.id) })} />)}</div>
          </Field>}
        </div>}
      </Drawer>
    </div>
  );
}
