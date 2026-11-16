// Admin → Pricing → "Billing rules" (MB section 16; added with the cutover, P3-OPS-2): the switch that lets businesses buy apps, and the
// numbers every invoice and renewal follows (VAT, trial, grace and read-only days, refund window, price rise notice, minimum charge,
// reminder days).
// Where it fits: a panel at the bottom of Pricing.jsx. Permission platform.billing.read to look and platform.pricing.manage to change
// (the setting's own permissions; the server decides).
// How it works: GET / PUT /admin/settings/store/platform.billing { value, reason } (the typed settings store, like LegalInfo.jsx). The
// form and its checks are in billingRulesLogic.js; a reason is required and every change is kept in the history.
// Rules: "Sales on" is the launch switch of the cutover runbook (docs/p3-cutover-runbook.md): off, a business on apps can look and use
// its free editions and trials but cannot pay. Fields this panel does not show are sent back exactly as they were saved.

import React, { useEffect, useState } from "react";
import { fdatetime } from "@sheetal/shared/core/format";
import { Button, Field, Input, Panel, Toggle, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { adminApi } from "../api";
import { RULE_FIELDS, bodyOf, formOf, problemsOf, rulesDirty } from "./billingRulesLogic";
import { reasonOk } from "./pricingLogic";

export function BillingRules() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [f, setF] = useState(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => adminApi("GET", "/admin/settings/store/platform.billing").then((r) => { setData(r.data); setF(formOf(r.data.value)); }).catch((e) => toast(e.message));
  useEffect(() => { load(); }, []);
  if (!data || !f) return <Panel title="Billing rules" pad><p className="muted">Loading…</p></Panel>;

  const can = data.canChange;
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const bad = problemsOf(f);
  const dirty = rulesDirty(data.value, f);
  const save = () => {
    const body = bodyOf(data.value, f, reason);
    if (!body) return;
    setBusy(true);
    adminApi("PUT", "/admin/settings/store/platform.billing", body).then((r) => { toast(r.message || "Saved."); setReason(""); load(); }).catch((e) => toast(e.message)).finally(() => setBusy(false));
  };

  return (
    <Panel title="Billing rules" sub="The sales switch and the numbers every invoice and renewal follows. Each change needs a reason." pad>
      <div className="pf-stack">
        <div className={`pf-alert ${f.salesEnabled ? "progress" : "action"}`}>
          <Icon name={f.salesEnabled ? "circle-check" : "circle-alert"} size={18} />
          <div><b>{f.salesEnabled ? "Sales are on" : "Sales are off"}</b>
            <span>{f.salesEnabled ? "A business on app subscriptions can pay for apps, add-ons and Sheetal AI." : "Nobody can pay for an app yet: the cart shows prices as a preview only. Switch this on for the pilot."}</span></div>
          <Toggle checked={f.salesEnabled} disabled={!can} onChange={set("salesEnabled")} label="Sales on" />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, alignItems: "start" }}>
          {RULE_FIELDS.map(([k, label, , , help]) => (
            <Field key={k} label={label} hint={help} error={bad[k]}><Input inputMode="decimal" disabled={!can} value={f[k]} maxLength={6} onChange={set(k)} /></Field>
          ))}
          <Field label="Minimum charge (Rs)" hint="A smaller amount due is carried to the next invoice." error={bad.minCharge}><Input inputMode="decimal" disabled={!can} value={f.minCharge} maxLength={8} onChange={set("minCharge")} /></Field>
          <Field label="Reminders before a renewal (days)" hint="For example 7, 1." error={bad.reminderDays}><Input disabled={!can} value={f.reminderDays} maxLength={40} onChange={set("reminderDays")} /></Field>
          <Field label="Reminders after a missed renewal (days)" hint="For example 3, 6." error={bad.pastDueReminderDays}><Input disabled={!can} value={f.pastDueReminderDays} maxLength={40} onChange={set("pastDueReminderDays")} /></Field>
        </div>
        {can && <>
          <Field label="Reason for the change (5 to 300 characters)"><Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></Field>
          <div className="pf-row-actions" style={{ justifyContent: "flex-start" }}>
            <Button icon="check" disabled={busy || !dirty || Object.keys(bad).length > 0 || !reasonOk(reason)} onClick={save}>Save billing rules</Button>
            {dirty && <Button variant="ghost" disabled={busy} onClick={() => setF(formOf(data.value))}>Discard changes</Button>}
          </div>
        </>}
        {data.history?.length > 0 && <ul className="pf-list">{data.history.slice(0, 5).map((h, i) => <li key={i}><Icon name="history" size={14} /><span className="small">{fdatetime(h.at)} · {h.reason || "Saved"}{h.fields?.length ? ` · ${h.fields.join(", ")}` : ""}</span></li>)}</ul>}
      </div>
    </Panel>
  );
}
