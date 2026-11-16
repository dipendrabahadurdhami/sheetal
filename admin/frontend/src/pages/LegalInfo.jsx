// Admin → Legal and required info (MB 14.3, P3-FE-4): the company details printed on Sheetal's tax invoices (legal name, PAN, VAT, address,
// contact; never on public pages), and where to edit the sale terms, refund policy and invoice footer (content pages) and the required business
// information before a paid purchase (the field builder, SETTINGS.md section 5).
// Where it fits: /admin/legal (AdminApp.jsx), permission platform.settings.read to look and platform.settings.update to change.
// How it works: GET / PUT /admin/settings/store/platform.company { value, reason } (the typed settings store; a reason is required).
// Rules: a PAN has 9 digits or is empty; the server checks again and answers in plain words.

import React, { useEffect, useState } from "react";
import { fdatetime } from "@sheetal/shared/core/format";
import { Link } from "@sheetal/shared/core/router";
import { Button, Checkbox, Field, Input, PageHead, Panel, Textarea, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { adminApi } from "../api";
import { companyBody, panOk } from "./reportsLogic";
import { reasonOk } from "./pricingLogic";

export function LegalInfo() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [f, setF] = useState(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => adminApi("GET", "/admin/settings/store/platform.company").then((r) => { setData(r.data); setF(r.data.value); }).catch((e) => toast(e.message));
  useEffect(() => { load(); }, []);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const save = () => {
    setBusy(true);
    adminApi("PUT", "/admin/settings/store/platform.company", companyBody(f, reason)).then((r) => { toast(r.message || "Saved."); setReason(""); load(); }).catch((e) => toast(e.message)).finally(() => setBusy(false));
  };
  const can = data?.canChange;
  return (
    <>
      <PageHead title="Legal and required info" sub="What Sheetal's tax invoices say about the seller, and where the sale terms and required business details are kept." />
      <Panel title="Company details on invoices" sub="Printed on every tax invoice from the moment it is paid. Never shown on public pages." pad>
        {!f ? <p className="muted">Loading…</p> : <div className="pf-stack">
          {data.isDefault && <div className="pf-alert action"><Icon name="circle-alert" size={18} /><div><b>Not filled in yet</b><span>Fill these in before the first paid app sale: invoices show only the site name until then.</span></div></div>}
          <div className="pf-row-actions" style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
            <Field label="Trade name"><Input disabled={!can} value={f.tradeName} maxLength={120} onChange={set("tradeName")} /></Field>
            <Field label="Legal name"><Input disabled={!can} value={f.legalName} maxLength={160} onChange={set("legalName")} /></Field>
            <Field label="PAN (9 digits)" error={panOk(f.pan) ? undefined : "A PAN has 9 digits."}><Input disabled={!can} inputMode="numeric" value={f.pan} maxLength={11} onChange={set("pan")} /></Field>
          </div>
          <Checkbox disabled={!can} checked={f.vatRegistered} onChange={set("vatRegistered")} label="Registered for VAT" />
          <Field label="Address"><Textarea disabled={!can} rows={2} value={f.address} maxLength={300} onChange={set("address")} /></Field>
          <div className="pf-row-actions" style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
            <Field label="Phone"><Input disabled={!can} value={f.phone} maxLength={40} onChange={set("phone")} /></Field>
            <Field label="Email"><Input disabled={!can} type="email" value={f.email} maxLength={120} onChange={set("email")} /></Field>
          </div>
          {can && <>
            <Field label="Reason for the change (5 to 300 characters)"><Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></Field>
            <div><Button icon="check" disabled={busy || !panOk(f.pan) || !reasonOk(reason)} onClick={save}>Save company details</Button></div>
          </>}
          {data.history?.length > 0 && <ul className="pf-list">{data.history.slice(0, 5).map((h, i) => <li key={i}><Icon name="history" size={14} /><span className="small">{fdatetime(h.at)} · {h.reason || "Saved"}{h.fields?.length ? ` · ${h.fields.join(", ")}` : ""}</span></li>)}</ul>}
        </div>}
      </Panel>
      <Panel title="Sale terms, refund policy and invoice footer" pad>
        <p className="muted" style={{ marginTop: 0 }}>These are content pages. Edit them in Content; the cart links to the sale terms and refund policy.</p>
        <Link to="/admin/content" className="btn btn-outline btn-sm"><Icon name="newspaper" size={15} />Open Content</Link>
      </Panel>
      <Panel title="Required business information before a paid purchase" pad>
        <p className="muted" style={{ marginTop: 0 }}>PAN, address, VAT registration and any other field a business must give before buying. Edit them in the field builder.</p>
        <Link to="/admin/settings/fields" className="btn btn-outline btn-sm"><Icon name="list-checks" size={15} />Open the field builder</Link>
      </Panel>
    </>
  );
}
