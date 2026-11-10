// Platform settings on the admin API (Admin → Settings).
// Where it fits: used by AdminApp when isStaffLive(); the sample AdminSettings page stays for the signed-out preview.
// How it works: loads GET /admin/settings/platform, edits a copy, sends only what changed with PUT. Every change is
// written to the audit log by the server. Security and maintenance are for the super admin and show locked for others.
// Rules: the server checks every value (422 with a plain message); VAT and grace days here are the ones billing uses.

import React, { useEffect, useState } from "react";
import { Badge, Button, Field, Input, PageHead, Panel, ToggleRow, useToast } from "@sheetal/shared/core/ui";
import { adminApi } from "../api";

const num = (v) => (v === "" || v === null || v === undefined ? NaN : Number(v));
const firstError = (e) => Object.values(e.errors || {}).flat()[0] || e.message;

export function LivePlatformSettings() {
  const toast = useToast();
  const [saved, setSaved] = useState(null);
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => adminApi("GET", "/admin/settings/platform").then(({ data }) => {
    setSaved(data);
    setS({ ...data, domains: { ...data.domains }, maintenance: { ...data.maintenance }, languages: [...data.languages] });
  }).catch((e) => toast(e.message));
  useEffect(() => { load(); }, []);

  if (!s) return <><PageHead title="Platform settings" sub="Loading…" /></>;
  const locked = !s.canChangeSecurity;
  const set = (k, v) => setS((x) => ({ ...x, [k]: v }));
  const setIn = (group, k, v) => setS((x) => ({ ...x, [group]: { ...x[group], [k]: v } }));
  const dirty = JSON.stringify(s) !== JSON.stringify(saved);

  const body = () => {
    const out = {
      siteName: s.siteName, supportEmail: s.supportEmail, supportPhone: s.supportPhone, domains: s.domains,
      vatRate: num(s.vatRate), languages: s.languages, trialDays: num(s.trialDays), graceDays: num(s.graceDays), autoSuspend: s.autoSuspend,
    };
    if (!locked) Object.assign(out, { maxLoginAttempts: num(s.maxLoginAttempts), sessionDays: num(s.sessionDays), maintenance: s.maintenance });
    for (const k of ["vatRate", "trialDays", "graceDays", "maxLoginAttempts", "sessionDays"]) if (k in out && Number.isNaN(out[k])) out[k] = null; // the server answers with a plain message
    return out;
  };
  const save = () => {
    setBusy(true);
    adminApi("PUT", "/admin/settings/platform", body()).then((r) => { toast(r.message); load(); }).catch((e) => toast(firstError(e))).finally(() => setBusy(false));
  };
  const lang = (code, on) => set("languages", on ? [...new Set([...s.languages, code])] : s.languages.filter((x) => x !== code));
  const N = ({ k, label, hint, disabled }) => <Field label={label} hint={hint}><Input className="input tnum" inputMode="decimal" disabled={disabled} value={s[k] ?? ""} onChange={(e) => set(k, e.target.value.replace(/[^\d.]/g, ""))} /></Field>;

  return (
    <>
      <PageHead title="Platform settings" sub="Values for the whole platform. Every change is written to the audit log."
        actions={<><span className="small muted">{dirty ? "Unsaved changes" : "All saved"}</span><Button disabled={!dirty || busy} onClick={save}>Save</Button></>} />
      <div className="pf-stack">
        <Panel title="General" pad>
          <div className="pf-stack">
            <div className="pf-grid-2 tight">
              <Field label="Site name"><Input value={s.siteName} onChange={(e) => set("siteName", e.target.value)} /></Field>
              <Field label="Support email"><Input type="email" value={s.supportEmail} onChange={(e) => set("supportEmail", e.target.value)} /></Field>
            </div>
            <Field label="Support phone"><Input value={s.supportPhone} onChange={(e) => set("supportPhone", e.target.value)} /></Field>
            <div><b className="small">Languages on</b>
              <ToggleRow title="English" checked={s.languages.includes("en")} onChange={(v) => lang("en", v)} />
              <ToggleRow title="Nepali" checked={s.languages.includes("ne")} onChange={(v) => lang("ne", v)} />
            </div>
          </div>
        </Panel>

        <Panel title="Domains" sub="Write them without https://. Changing these does not move any server; it only changes what the platform says." pad>
          <div className="pf-grid-2 tight">
            <Field label="Website"><Input value={s.domains.site} onChange={(e) => setIn("domains", "site", e.target.value)} /></Field>
            <Field label="Business panel"><Input value={s.domains.business} onChange={(e) => setIn("domains", "business", e.target.value)} /></Field>
            <Field label="Admin panel"><Input value={s.domains.admin} onChange={(e) => setIn("domains", "admin", e.target.value)} /></Field>
          </div>
        </Panel>

        <Panel title="Money and plans" pad>
          <div className="pf-stack">
            <div className="pf-grid-2 tight">
              <N k="vatRate" label="VAT (%)" hint="Included in plan prices. Billing uses this." />
              <Field label="Commission" hint="Set per business type in Billing → Settings, where payouts read it."><a className="btn btn-outline btn-sm" href="/admin/billing">Open Billing settings</a></Field>
              <N k="trialDays" label="Trial days" hint="New businesses try the Business plan this many days, then move to Starter unless they pay. 0 = no trial." />
              <N k="graceDays" label="Grace days" hint="Days after a plan ends before the business moves to Starter." />
            </div>
            <ToggleRow title="Move to Starter automatically after the grace days" sub="When off, the business stays past due until staff act." checked={s.autoSuspend} onChange={(v) => set("autoSuspend", v)} />
          </div>
        </Panel>

        <Panel title="Security" sub={locked ? "Only the super admin can change these." : undefined} pad>
          <div className="pf-grid-2 tight">
            <N k="maxLoginAttempts" label="Wrong passwords allowed" disabled={locked} />
            <N k="sessionDays" label="Stay signed in for (days)" disabled={locked} />
          </div>
        </Panel>

        <Panel title="Maintenance mode" sub={locked ? "Only the super admin can change this." : "Visitors see the message; signed-in staff still see the site."} pad>
          <div className="pf-stack">
            <div><Badge tone={s.maintenance.on ? "warning" : "neutral"}>{s.maintenance.on ? "On" : "Off"}</Badge></div>
            <ToggleRow title="Maintenance mode" checked={s.maintenance.on} disabled={locked} onChange={(v) => setIn("maintenance", "on", v)} />
            <Field label="Message shown to visitors"><Input disabled={locked} value={s.maintenance.message} onChange={(e) => setIn("maintenance", "message", e.target.value)} /></Field>
          </div>
        </Panel>
      </div>
    </>
  );
}
