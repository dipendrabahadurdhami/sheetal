// Admin → Add-ons on the admin API: price, name, business types and on-sale switch of each add-on, with how many
// businesses have it. Businesses buy them in their Billing page.

import React, { useEffect, useState } from "react";
import { rs } from "@sheetal/shared/core/format";
import { Badge, Button, Drawer, Field, Input, PageHead, Table, ToggleRow, useToast } from "@sheetal/shared/core/ui";
import { adminApi } from "../api";

const TYPES = [["hotel", "Hotels"], ["host", "Homestays and hosts"], ["developer", "Developers"], ["agency", "Agencies"], ["sponsor", "Investment sponsors"]];

export function LiveAdminAddons() {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [edit, setEdit] = useState(null);
  const load = () => adminApi("GET", "/admin/addons").then((r) => setRows(r.data)).catch((e) => { setRows([]); toast(e.message); });
  useEffect(() => { load(); }, []);
  const save = () => adminApi("PUT", `/admin/addons/${edit.id}`, { name: edit.name.trim(), sub: edit.sub.trim(), price: Number(edit.price) || 0, types: edit.types, active: edit.active })
    .then((r) => { toast(r.message); setEdit(null); load(); }).catch((e) => toast(e.message));
  return (
    <>
      <PageHead title="Add-ons" sub="Extra room businesses on a paid plan can buy. They pay monthly with the plan; a new price counts from the next purchase or renewal." />
      <section className="card pf-panel">{!rows ? <p className="muted pf-pad">Loading…</p> : <Table rows={rows} onRowClick={(a) => setEdit({ ...a, price: String(a.price) })} minWidth={820} columns={[
        { key: "n", label: "Add-on", render: (a) => <span className="pf-two"><b>{a.name}</b><small>{a.sub} · +{a.step} {a.limitKey}</small></span> },
        { key: "p", label: "Price", num: true, align: "right", render: (a) => `${rs(a.price)} / ${a.unit} / month` },
        { key: "t", label: "For", render: (a) => <span className="small">{TYPES.filter(([k]) => a.types.includes(k)).map(([, l]) => l).join(", ")}</span> },
        { key: "u", label: "In use", num: true, render: (a) => (a.businesses ? `${a.units} by ${a.businesses} business${a.businesses > 1 ? "es" : ""}` : "—") },
        { key: "s", label: "", render: (a) => (a.active ? <Badge tone="done">On sale</Badge> : <Badge tone="neutral">Off</Badge>) },
      ]} />}</section>
      <Drawer open={!!edit} onClose={() => setEdit(null)} title={edit?.name} footer={<><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button disabled={!edit?.name.trim() || !edit?.types.length} onClick={save}>Save</Button></>}>
        {edit && <div className="pf-stack">
          <Field label="Name"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label="What it gives" optional><Input value={edit.sub} onChange={(e) => setEdit({ ...edit, sub: e.target.value })} /></Field>
          <Field label={`Price a month per ${edit.unit} (Rs., VAT included)`}><Input className="input tnum" inputMode="numeric" value={edit.price} onChange={(e) => setEdit({ ...edit, price: e.target.value.replace(/\D/g, "") })} /></Field>
          <ToggleRow title="On sale" sub="Off: businesses can't buy more; what they have keeps renewing." checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} />
          <h4 className="pf-subhead">Business types</h4>
          {TYPES.map(([k, l]) => <ToggleRow key={k} title={l} checked={edit.types.includes(k)} onChange={(v) => setEdit({ ...edit, types: v ? [...edit.types, k] : edit.types.filter((x) => x !== k) })} />)}
        </div>}
      </Drawer>
    </>
  );
}
