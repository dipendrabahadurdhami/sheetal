// Admin → Pricing (MB 14.3, P3-FE-3): every app with its editions — price a month and a year, limits (unlimited, hard or soft with %), features,
// trial days, free edition on, visibility and availability — plus seat and add-on prices and the Sheetal AI plans. Before saving, "Who is
// affected" asks the server; a reason is required; a price rise that touches paying businesses goes for approval by a second staff member.
// Where it fits: /admin/pricing (AdminApp.jsx), permission platform.billing.read to look and platform.pricing.manage to change.
// How it works: GET /admin/pricing loads the catalog in use; edits go to a copy (pricingLogic.js); POST /admin/pricing/preview gives the
// changes, the paying businesses affected, refusals and whether approval is needed; PUT /admin/pricing saves (200) or sends for approval (202).
// Rules: prices are typed as rupees with up to 2 decimals and stored as paisa (integers, no floating point). The screen never decides who is
// affected: the preview does. A stale copy (someone saved first) answers 409 and offers Reload.

import React, { useEffect, useState } from "react";
import { fdate } from "@sheetal/shared/core/format";
import { Badge, Button, Empty, Field, Input, PageHead, Panel, Select, Textarea, Toggle, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { Link } from "@sheetal/shared/core/router";
import { adminApi } from "../api";
import { isDirty, paisaToRupees, previewBody, reasonOk, rsPaisa, rupeesToPaisa, saveBody, setAddon, setAiPlan, setApp, setEdition, setLimit, setSeatPrice, textOf, toggleFeature } from "./pricingLogic";

/** A rupee input that keeps the person's text and reports paisa (or null while it isn't a valid amount). */
function RupeeInput({ paisa, onPaisa, disabled, label }) {
  const [text, setText] = useState(paisaToRupees(paisa));
  useEffect(() => { setText(paisaToRupees(paisa)); }, [paisa]);
  const bad = rupeesToPaisa(text) == null;
  return <Input inputMode="decimal" aria-label={label} aria-invalid={bad || undefined} value={text} disabled={disabled}
    onChange={(e) => { setText(e.target.value); const p = rupeesToPaisa(e.target.value); if (p != null) onPaisa(p); }} style={bad ? { borderColor: "var(--danger, currentColor)" } : undefined} />;
}

export function Pricing() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(null);
  const [appId, setAppId] = useState(null);
  const [impact, setImpact] = useState(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [newFeature, setNewFeature] = useState("");

  const load = () => adminApi("GET", "/admin/pricing").then((r) => {
    setData(r.data); setDraft(r.data.catalog); setImpact(null); setStale(false);
    setAppId((a) => a || Object.keys(r.data.catalog.apps)[0]);
  }).catch((e) => toast(e.message));
  useEffect(() => { load(); }, []);

  if (!data || !draft) return <p className="muted pf-pad">Loading prices…</p>;
  const can = data.canChange;
  const dirty = isDirty(draft, data.catalog);
  const edit = (fn) => { setDraft((c) => fn(c)); setImpact(null); };
  const app = draft.apps[appId];
  const counts = (eid) => data.counts.editions?.[`${appId}:${eid}`] || { paying: 0, trialing: 0, free: 0 };
  const limitKeys = app ? [...new Set(Object.values(app.editions).flatMap((e) => Object.keys(e.limits)))] : [];
  const featureKeys = app ? [...new Set(Object.values(app.editions).flatMap((e) => e.features))] : [];
  const editions = app ? Object.entries(app.editions).sort(([, a], [, b]) => a.sort - b.sort) : [];

  const fail = (e) => { if (e.status === 409) setStale(true); toast(e.message); };
  const check = () => {
    setBusy(true);
    adminApi("POST", "/admin/pricing/preview", previewBody(draft)).then((r) => setImpact(r.data)).catch(fail).finally(() => setBusy(false));
  };
  const save = () => {
    setBusy(true);
    adminApi("PUT", "/admin/pricing", saveBody(draft, reason)).then((r) => { toast(r.message); setReason(""); load(); }).catch(fail).finally(() => setBusy(false));
  };

  return (
    <>
      <PageHead title="Pricing" sub="App prices, free limits, trials and add-ons. Prices include 13% VAT. Every change needs a reason and is kept in the history."
        actions={can && <Link to="/admin/approvals" className="btn btn-outline"><Icon name="shield-check" size={16} />Approvals{data.waiting.length ? ` (${data.waiting.length})` : ""}</Link>} />
      {!can && <div className="pf-alert progress"><Icon name="info" size={18} /><div><b>Read only</b><span>Your staff role can see prices. Changing them needs pricing rights.</span></div></div>}
      {stale && <div className="pf-alert action"><Icon name="circle-alert" size={18} /><div><b>Someone saved prices after you opened this page</b><span>Reload to see their change, then make yours again.</span></div><Button size="sm" onClick={load}>Reload</Button></div>}
      {data.waiting.map((w) => (
        <div key={w.id} className="pf-alert progress"><Icon name="clock" size={18} /><div><b>Waiting for approval: {w.label}</b><span>{w.makerNote} · asked {fdate(w.createdAt)} · ends {fdate(w.expiresAt)}</span></div></div>
      ))}

      <div className="pf-split">
        <Panel title="Apps" className="side">
          <ul className="pf-list" role="listbox" aria-label="Apps">
            {Object.entries(draft.apps).map(([id, a]) => (
              <li key={id}><button type="button" role="option" aria-selected={id === appId} className={`pf-choice ${id === appId ? "active" : ""}`} onClick={() => setAppId(id)} style={{ width: "100%" }}>
                <span className="pf-two" style={{ flex: 1 }}><b>{textOf(a.name) || id}</b><small>{a.availability === "coming_soon" ? "Coming soon" : a.visible ? "In the marketplace" : "Hidden"}{a.trialDays ? ` · ${a.trialDays}-day trial` : ""}</small></span>
              </button></li>
            ))}
          </ul>
        </Panel>

        {app && <Panel title={textOf(app.name) || appId} sub="Editions side by side. Leave a limit empty for unlimited." className="grow">
          <div className="pf-pad pf-stack">
            <div className="pf-row-actions" style={{ justifyContent: "flex-start", flexWrap: "wrap", gap: 16 }}>
              <Field label="Trial days (empty = no trial)"><Input type="number" min={0} max={90} disabled={!can} value={app.trialDays ?? ""} onChange={(e) => edit((c) => setApp(c, appId, { trialDays: e.target.value }))} /></Field>
              <Field label="Availability"><Select disabled={!can} value={app.availability} onChange={(v) => edit((c) => setApp(c, appId, { availability: v }))} options={[{ id: "live", label: "Live" }, { id: "coming_soon", label: "Coming soon" }]} /></Field>
              <Toggle checked={app.visible} disabled={!can} onChange={(v) => edit((c) => setApp(c, appId, { visible: v }))} label="Shown in the marketplace" />
              <Toggle checked={app.freeEditionEnabled} disabled={!can} onChange={(v) => edit((c) => setApp(c, appId, { freeEditionEnabled: v }))} label="Free edition on" />
            </div>
            <div className="pf-table-wrap"><table className="table pf-table" style={{ minWidth: 200 + editions.length * 220 }}>
              <caption className="small muted" style={{ textAlign: "left" }}>Prices in rupees, VAT included. Counts are businesses using each edition now.</caption>
              <thead><tr><th scope="col">Edition</th>{editions.map(([eid, e]) => <th key={eid} scope="col">{textOf(e.name) || eid}{e.free ? " (free)" : ""}<br /><small className="muted">{counts(eid).paying} paying · {counts(eid).trialing} on trial · {counts(eid).free} free</small></th>)}</tr></thead>
              <tbody>
                <tr><th scope="row">Price a month</th>{editions.map(([eid, e]) => <td key={eid}>{e.free ? "Free" : <RupeeInput label={`${eid} price a month`} disabled={!can} paisa={e.priceMonthPaisa} onPaisa={(p) => edit((c) => setEdition(c, appId, eid, { priceMonthPaisa: p }))} />}</td>)}</tr>
                <tr><th scope="row">Price a year</th>{editions.map(([eid, e]) => <td key={eid}>{e.free ? "Free" : <RupeeInput label={`${eid} price a year`} disabled={!can} paisa={e.priceYearPaisa} onPaisa={(p) => edit((c) => setEdition(c, appId, eid, { priceYearPaisa: p }))} />}</td>)}</tr>
                {limitKeys.map((k) => (
                  <tr key={k}><th scope="row">{k.replace(/[_.]+/g, " ")}</th>{editions.map(([eid, e]) => { const l = e.limits[k] || { value: null, behaviour: "hard" }; return (
                    <td key={eid}><div className="pf-row-actions" style={{ justifyContent: "flex-start", flexWrap: "nowrap" }}>
                      <Input type="number" min={0} aria-label={`${eid} ${k} limit`} placeholder="Unlimited" disabled={!can} value={l.value ?? ""} style={{ width: 100 }} onChange={(ev) => edit((c) => setLimit(c, appId, eid, k, { ...l, value: ev.target.value }))} />
                      <select className="select" aria-label={`${eid} ${k} at the limit`} disabled={!can} value={l.behaviour} onChange={(ev) => edit((c) => setLimit(c, appId, eid, k, { ...l, behaviour: ev.target.value }))}><option value="hard">Hard stop</option><option value="soft">Soft</option></select>
                      {l.behaviour === "soft" && <Input type="number" min={1} max={100} aria-label={`${eid} ${k} percent over`} disabled={!can} value={l.softOverPct ?? 20} style={{ width: 70 }} onChange={(ev) => edit((c) => setLimit(c, appId, eid, k, { ...l, softOverPct: ev.target.value }))} />}
                      {l.behaviour === "soft" && <span className="small muted">% over</span>}
                    </div></td>); })}</tr>
                ))}
                {featureKeys.map((f) => (
                  <tr key={f}><th scope="row">{f.replace(/[_.]+/g, " ")}</th>{editions.map(([eid, e]) => <td key={eid}><input type="checkbox" aria-label={`${eid} has ${f}`} disabled={!can} checked={e.features.includes(f)} onChange={() => edit((c) => toggleFeature(c, appId, eid, f))} /></td>)}</tr>
                ))}
              </tbody>
            </table></div>
            {can && <div className="pf-row-actions" style={{ justifyContent: "flex-start" }}>
              <Input placeholder="new_feature_key" aria-label="New feature key" value={newFeature} onChange={(e) => setNewFeature(e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, ""))} style={{ width: 220 }} />
              <Button variant="outline" size="sm" icon="plus" disabled={!/^[a-z][a-z0-9_.]{1,60}$/.test(newFeature) || featureKeys.includes(newFeature)}
                onClick={() => { const paid = editions.find(([, e]) => !e.free); if (paid) edit((c) => toggleFeature(c, appId, paid[0], newFeature)); setNewFeature(""); }}>Add a feature to the paid edition</Button>
            </div>}
          </div>
        </Panel>}
      </div>

      <Panel title="Seats and add-ons" sub="Business-level seats and each app's add-ons.">
        <div className="pf-table-wrap"><table className="table pf-table" style={{ minWidth: 640 }}>
          <thead><tr><th scope="col">Add-on</th><th scope="col">A month</th><th scope="col">A year</th><th scope="col">On sale</th></tr></thead>
          <tbody>
            <tr><th scope="row">Extra seat ({draft.business.freeSeats} free)</th>
              <td><RupeeInput label="Seat a month" disabled={!can} paisa={draft.business.seatAddon.priceMonthPaisa} onPaisa={(p) => edit((c) => setSeatPrice(c, { priceMonthPaisa: p }))} /></td>
              <td><RupeeInput label="Seat a year" disabled={!can} paisa={draft.business.seatAddon.priceYearPaisa} onPaisa={(p) => edit((c) => setSeatPrice(c, { priceYearPaisa: p }))} /></td><td>Always</td></tr>
            {draft.addons.map((a) => (
              <tr key={a.key}><th scope="row">{textOf(a.name)}{a.appId ? <small className="muted"> · {a.appId}</small> : null}</th>
                <td><RupeeInput label={`${a.key} a month`} disabled={!can} paisa={a.priceMonthPaisa} onPaisa={(p) => edit((c) => setAddon(c, a.key, { priceMonthPaisa: p }))} /></td>
                <td><RupeeInput label={`${a.key} a year`} disabled={!can} paisa={a.priceYearPaisa} onPaisa={(p) => edit((c) => setAddon(c, a.key, { priceYearPaisa: p }))} /></td>
                <td><input type="checkbox" aria-label={`${a.key} on sale`} disabled={!can} checked={a.active} onChange={(e) => edit((c) => setAddon(c, a.key, { active: e.target.checked }))} /></td></tr>
            ))}
          </tbody>
        </table></div>
      </Panel>

      {draft.ai && <Panel title="Sheetal AI plans" sub={`Top-up: ${rsPaisa(draft.ai.topup.priceGrossPaisa)} for ${draft.ai.topup.credits} credits.`}>
        <div className="pf-table-wrap"><table className="table pf-table" style={{ minWidth: 560 }}>
          <thead><tr><th scope="col">Plan</th><th scope="col">A month</th><th scope="col">A year</th><th scope="col">Credits a month</th></tr></thead>
          <tbody>{draft.ai.plans.map((p) => (
            <tr key={p.key}><th scope="row">{textOf(p.name)}</th>
              <td><RupeeInput label={`${p.key} a month`} disabled={!can} paisa={p.priceMonthPaisa} onPaisa={(v) => edit((c) => setAiPlan(c, p.key, { priceMonthPaisa: v }))} /></td>
              <td><RupeeInput label={`${p.key} a year`} disabled={!can} paisa={p.priceYearPaisa} onPaisa={(v) => edit((c) => setAiPlan(c, p.key, { priceYearPaisa: v }))} /></td>
              <td><Input type="number" min={0} aria-label={`${p.key} credits`} disabled={!can} value={p.creditsPerMonth} onChange={(e) => edit((c) => setAiPlan(c, p.key, { creditsPerMonth: Math.max(0, Math.floor(Number(e.target.value)) || 0) }))} /></td></tr>
          ))}</tbody>
        </table></div>
      </Panel>}

      {can && <Panel title="Save changes" pad>
        <div className="pf-stack">
          {!dirty && <p className="muted" style={{ margin: 0 }}>No changes yet.</p>}
          {dirty && <Button variant="outline" icon="users" disabled={busy} onClick={check}>Who is affected?</Button>}
          {impact && <ImpactView impact={impact} />}
          <Field label="Reason (5 to 300 characters, kept in the history)"><Textarea rows={2} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></Field>
          <div className="pf-row-actions" style={{ justifyContent: "flex-start" }}>
            <Button icon="check" disabled={busy || !dirty || !impact || !reasonOk(reason) || impact.refused?.length > 0} onClick={save}>{impact?.needsApproval && !impact?.approvalSkipped ? "Send for approval" : "Save prices"}</Button>
            {dirty && <Button variant="ghost" disabled={busy} onClick={() => { setDraft(data.catalog); setImpact(null); }}>Discard changes</Button>}
          </div>
          {dirty && !impact && <p className="small muted" style={{ margin: 0 }}>Check who is affected before saving.</p>}
        </div>
      </Panel>}

      <Panel title="History" sub="The last 20 saved versions.">
        {data.history?.length ? <ul className="pf-list">{data.history.map((h, i) => <li key={i}><Icon name="history" size={15} /><div style={{ flex: 1 }}><b>{h.reason || "Saved"}</b><span className="small muted">{fdate(h.at)}{h.fields?.length ? ` · ${h.fields.join(", ")}` : ""}</span></div></li>)}</ul>
          : <Empty icon="history" title="No changes saved yet" />}
      </Panel>
    </>
  );
}

const KIND = { price_rise: "Price rise", price_cut: "Price cut", paid_limit_cut: "Paid limit cut", free_limit_cut: "Free limit cut", limit_raise: "Limit raised", hidden: "Hidden", shown: "Shown", other: "Change" };
const valueText = (kind, v) => (v == null ? "unlimited" : typeof v === "number" && (kind === "price_rise" || kind === "price_cut") ? rsPaisa(v) : typeof v === "object" ? JSON.stringify(v) : String(v));
/** One change of the preview in words: "Price rise · hotel full · price a month: Rs. 700 → Rs. 800 (3 paying)". */
export const changeText = (c) => `${KIND[c.kind] || "Change"} · ${[c.appId, c.editionId || c.addonKey].filter(Boolean).join(" ")} · ${c.what}: ${valueText(c.kind, c.from)} → ${valueText(c.kind, c.to)} (${c.paying} paying, ${c.free} free)`;

/** The preview's answer: the changes, paying businesses affected, approval and refusals. Only the server's words and numbers. */
export function ImpactView({ impact }) {
  return (
    <div className="pf-stack" aria-live="polite">
      <div className="pf-row-actions" style={{ justifyContent: "flex-start" }}>
        <Badge tone={impact.payingAffected ? "action" : "done"}>{impact.payingAffected} paying subscriptions affected</Badge>
        {impact.needsApproval && <Badge tone="progress" icon="shield-check">{impact.approvalSkipped ? "Needs approval, but nobody else can approve: it saves at once and the audit says so" : "Needs approval"}</Badge>}
      </div>
      {impact.changes?.length > 0 && <ul className="pf-list">{impact.changes.map((c, i) => <li key={i}><Icon name="arrow-right" size={14} /><span>{changeText(c)}</span></li>)}</ul>}
      {impact.refused?.map((r, i) => <p key={i} className="pf-hint pf-tone-problem" role="alert"><Icon name="circle-alert" size={13} />{r}</p>)}
    </div>
  );
}
