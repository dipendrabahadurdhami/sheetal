// Admin → Coupons (MB 14.3 and 15, P3-FE-3): make a code (percent, a fixed amount, or extra trial days), limit it to apps or editions, a first
// purchase, a minimum spend, dates, a total cap and a per-business limit; pause, resume or end it; see who used it.
// Where it fits: /admin/coupons (AdminApp.jsx); platform.billing.read to look, platform.pricing.manage to change (the API checks).
// How it works: GET/POST /admin/coupons, PATCH /admin/coupons/:id (with the version: a stale copy answers 409), GET …/redemptions.
// Rules: a fixed amount is typed in rupees and sent as paisa (pricingLogic.couponBody); dates are Nepal dates.

import React, { useEffect, useState } from "react";
import { fdate } from "@sheetal/shared/core/format";
import { Badge, Button, Checkbox, Drawer, Empty, Field, Input, PageHead, Panel, Select, Table, useToast } from "@sheetal/shared/core/ui";
import { adminApi } from "../api";
import { couponBody, couponPatchBody, rsPaisa, rupeesToPaisa } from "./pricingLogic";

const KIND = { percent: "% off", fixed_paisa: "Amount off", trial_days: "Extra trial days" };
const BLANK = { code: "", kind: "percent", value: "", appIds: [], editionIds: [], firstPurchaseOnly: false, minSpend: "", validFrom: "", validTo: "", maxRedemptions: "", perBusinessLimit: "1", periods: "1" };
const valueText = (c) => (c.kind === "percent" ? `${c.value}% off` : c.kind === "fixed_paisa" ? `${rsPaisa(c.value)} off` : `+${c.value} trial days`);

export function Coupons() {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [apps, setApps] = useState([]);
  const [form, setForm] = useState(null);
  const [uses, setUses] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => adminApi("GET", "/admin/coupons").then((r) => setRows(r.data)).catch((e) => toast(e.message));
  useEffect(() => {
    load();
    adminApi("GET", "/admin/pricing").then((r) => setApps(Object.entries(r.data.catalog.apps).map(([id, a]) => ({ id, name: a.name?.en || id, editions: Object.keys(a.editions) })))).catch(() => {});
  }, []);

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v?.target ? (v.target.type === "checkbox" ? v.target.checked : v.target.value) : v }));
  const valueOk = form && (form.kind === "fixed_paisa" ? rupeesToPaisa(form.value) > 0 : Number(form.value) >= 1 && (form.kind !== "percent" || Number(form.value) <= 100));
  const create = () => {
    setBusy(true);
    adminApi("POST", "/admin/coupons", couponBody(form)).then((r) => { toast(r.message || "Coupon made."); setForm(null); load(); }).catch((e) => toast(e.message)).finally(() => setBusy(false));
  };
  const patch = (c, p) => adminApi("PATCH", `/admin/coupons/${c.id}`, couponPatchBody(c, p)).then((r) => { toast(r.message); load(); }).catch((e) => { toast(e.message); if (e.status === 409) load(); });
  const showUses = (c) => adminApi("GET", `/admin/coupons/${c.id}/redemptions`).then((r) => setUses({ c, rows: r.data })).catch((e) => toast(e.message));

  return (
    <>
      <PageHead title="Coupons" sub="Codes customers type in the cart. Each use is counted; a code is never applied twice past its limits."
        actions={<Button icon="plus" onClick={() => setForm({ ...BLANK })}>New coupon</Button>} />
      <Panel>
        {!rows ? <p className="muted pf-pad">Loading coupons…</p> : (
          <Table rows={rows} minWidth={820} empty={<Empty icon="ticket" title="No coupons yet" />} columns={[
            { key: "code", label: "Code", render: (c) => <span className="pf-two"><b className="tnum">{c.code}</b><small>{valueText(c)}{c.periods > 1 ? ` for ${c.periods} periods` : ""}</small></span> },
            { key: "for", label: "For", render: (c) => (c.appliesTo === "all" ? "All apps" : c.appliesTo === "apps" ? c.appIds.join(", ") : c.editionIds.join(", ")) + (c.firstPurchaseOnly ? " · first purchase" : "") },
            { key: "dates", label: "Valid", render: (c) => `${c.validFrom ? fdate(c.validFrom) : "now"} – ${c.validTo ? fdate(c.validTo) : "no end"}` },
            { key: "uses", label: "Used", num: true, render: (c) => `${c.uses}${c.maxRedemptions ? ` / ${c.maxRedemptions}` : ""} · ${rsPaisa(c.discountPaisa)}` },
            { key: "st", label: "Status", render: (c) => <Badge tone={c.active ? "done" : "neutral"}>{c.active ? "On" : "Paused"}</Badge> },
            { key: "x", label: "", align: "right", render: (c) => <div className="pf-row-actions" style={{ justifyContent: "flex-end" }}>
              <Button size="sm" variant="ghost" onClick={() => showUses(c)}>Who used it</Button>
              <Button size="sm" variant="outline" onClick={() => patch(c, { active: !c.active })}>{c.active ? "Pause" : "Resume"}</Button>
              {c.active && <Button size="sm" variant="ghost" onClick={() => patch(c, { validTo: new Date().toISOString() })}>End now</Button>}
            </div> },
          ]} />
        )}
      </Panel>

      <Drawer open={!!form} onClose={() => !busy && setForm(null)} title="New coupon" sub="Customers type the code in the cart."
        footer={form && <><Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button><Button disabled={busy || !/^[A-Za-z0-9_-]{3,32}$/.test(form.code.trim()) || !valueOk} onClick={create}>Make coupon</Button></>}>
        {form && <div className="pf-stack">
          <Field label="Code (3 to 32 letters, numbers, - or _)"><Input value={form.code} onChange={(e) => set("code")(e.target.value.toUpperCase())} /></Field>
          <Field label="Kind"><Select value={form.kind} onChange={set("kind")} options={Object.entries(KIND).map(([id, label]) => ({ id, label }))} /></Field>
          <Field label={form.kind === "percent" ? "Percent off (1 to 100)" : form.kind === "fixed_paisa" ? "Amount off in rupees" : "Extra trial days"}><Input inputMode="decimal" value={form.value} onChange={set("value")} /></Field>
          <Field label="Only for these apps (none = all apps)">
            <div className="pf-chips">{apps.map((a) => <button key={a.id} type="button" className={`chip ${form.appIds.includes(a.id) ? "active" : ""}`} aria-pressed={form.appIds.includes(a.id)}
              onClick={() => setForm((f) => ({ ...f, appIds: f.appIds.includes(a.id) ? f.appIds.filter((x) => x !== a.id) : [...f.appIds, a.id] }))}>{a.name}</button>)}</div>
          </Field>
          <Checkbox checked={form.firstPurchaseOnly} onChange={set("firstPurchaseOnly")} label="Only a business's first purchase" />
          <Field label="Minimum spend in rupees" optional><Input inputMode="decimal" value={form.minSpend} onChange={set("minSpend")} /></Field>
          <div className="pf-row-actions" style={{ justifyContent: "flex-start" }}>
            <Field label="Valid from" optional><Input type="date" value={form.validFrom} onChange={set("validFrom")} /></Field>
            <Field label="Valid to" optional><Input type="date" value={form.validTo} onChange={set("validTo")} /></Field>
          </div>
          <div className="pf-row-actions" style={{ justifyContent: "flex-start" }}>
            <Field label="Total uses" optional><Input type="number" min={1} value={form.maxRedemptions} onChange={set("maxRedemptions")} /></Field>
            <Field label="Uses per business"><Input type="number" min={1} max={100} value={form.perBusinessLimit} onChange={set("perBusinessLimit")} /></Field>
            <Field label="Periods it applies to"><Input type="number" min={1} max={12} value={form.periods} onChange={set("periods")} /></Field>
          </div>
        </div>}
      </Drawer>

      <Drawer open={!!uses} onClose={() => setUses(null)} title={uses ? `Who used ${uses.c.code}` : ""}>
        {uses && <Table rows={uses.rows} minWidth={420} empty={<Empty icon="ticket" title="Nobody has used it yet" />} columns={[
          { key: "b", label: "Business", render: (r) => r.business || r.tenantId },
          { key: "n", label: "Invoice", render: (r) => r.number || "—" },
          { key: "d", label: "Discount", num: true, align: "right", render: (r) => rsPaisa(r.discountPaisa) },
          { key: "at", label: "Date", num: true, render: (r) => fdate(r.at) },
        ]} />}
      </Drawer>
    </>
  );
}
