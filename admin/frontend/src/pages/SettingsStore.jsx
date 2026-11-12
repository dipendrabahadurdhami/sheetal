// The stage 1.4 settings screens: Field builder, Theme, and Revenue share with its report (SETTINGS.md sections 3, 5, 6, 7; FRONTEND-KIT.md section 9).
// Where it fits: Admin → Settings shows <MoreSettings> (three links) under today's settings when signed in to the admin API; the pages are
// /admin/settings/fields, /admin/settings/theme and /admin/settings/revenue.
// How it works: every page reads and saves through the typed settings store (GET/PUT /admin/settings/store/:key, /admin/settings/forms,
// /admin/reports/revenue). The server validates and decides who may; the pages show its sentences.
// Rules: a field is archived, never deleted. A theme nobody could read is refused by the server and the page shows why. A change of the revenue share
// needs a reason and never rewrites earlier days.

import React, { useCallback, useEffect, useState } from "react";
import { fdatetime } from "@sheetal/shared/core/format";
import { Link } from "@sheetal/shared/core/router";
import { Badge, Button, Empty, Field, Input, PageHead, Panel, Select, Tabs, Textarea, Toggle, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { adminApi, adminDownload } from "../api";
import { FIELD_TYPES, FILLED_BY, changeWords, isHex, moveField, newField, patchField, previewVars, rupees, setArchived } from "./settingsWords";

const backToSettings = <Link to="/admin/settings" className="btn btn-outline"><Icon name="arrow-left" size={16} />Settings</Link>;
function useLoad(path, api) {
  const [state, setState] = useState({ loading: true });
  const load = useCallback(() => { setState((s) => ({ ...s, loading: !s.data })); return api("GET", path).then((r) => setState({ data: r.data, meta: r.meta })).catch((e) => setState({ error: e.message })); }, [api, path]);
  useEffect(() => { load(); }, [load]);
  return [state, load, setState];
}
const Waiting = ({ state, load, title }) => (state.error
  ? <Panel><Empty icon="circle-alert" title={`${title} could not be loaded`} action={<Button size="sm" onClick={load}>Try again</Button>}>{state.error}</Empty></Panel>
  : <Panel><p className="pf-pad small muted">Loading…</p></Panel>);

/** The three links shown under today's settings. */
export function MoreSettings() {
  const items = [
    ["/admin/settings/fields", "list-checks", "Field builder", "Which fields and documents a business profile and a verification ask for."],
    ["/admin/settings/theme", "sparkles", "Theme", "Sheetal's colours and corner radius, with a readability check."],
    ["/admin/settings/revenue", "chart-pie", "Revenue share and report", "The commission rule, the partner split and what Sheetal earned."],
  ];
  return (
    <section className="pf-stack" aria-label="More settings">
      <h2 className="pf-int-group">More settings</h2>
      <div className="pf-int-grid">{items.map(([to, icon, name, sub]) => (
        <Link key={to} to={to} className="card pf-int-card"><div className="pf-int-top"><Icon name={icon} size={18} /><b>{name}</b></div><p className="small muted">{sub}</p><span className="pf-int-open">Open<Icon name="arrow-right" size={14} /></span></Link>
      ))}</div>
    </section>
  );
}

// ── Field builder ──
export function FieldBuilderPage({ api = adminApi }) {
  const toast = useToast();
  const [state, load, setState] = useLoad("/admin/settings/forms", api);
  const [formId, setFormId] = useState(null);
  const [draft, setDraft] = useState(null);       // { id, fields }
  const [open, setOpen] = useState(null);         // key of the field being edited
  const [adding, setAdding] = useState({ label: "", type: "text" });
  const [busy, setBusy] = useState(false);
  if (!state.data) return <><PageHead title="Field builder" actions={backToSettings} /><Waiting state={state} load={load} title="The forms" /></>;
  const forms = state.data;
  const canChange = !!state.meta?.canChange;
  const form = forms.find((f) => f.id === formId) || forms[0];
  const fields = [...(draft?.id === form.id ? draft.fields : form.fields)].sort((a, b) => a.order - b.order);
  const dirty = draft?.id === form.id && JSON.stringify(draft.fields) !== JSON.stringify(form.fields);
  const edit = (next) => setDraft({ id: form.id, fields: next });
  const add = () => {
    const f = newField(fields, adding.label, adding.type);
    if (!f) return toast("Give the field an English name that is not used yet.");
    edit([...fields, f]); setAdding({ label: "", type: "text" }); setOpen(f.key);
  };
  const save = () => {
    setBusy(true);
    api("PUT", `/admin/settings/forms/${form.id}`, { label: form.label, fields })
      .then((r) => { toast(r.message); setState((s) => ({ ...s, data: s.data.map((f) => (f.id === form.id ? r.data : f)) })); setDraft(null); })
      .catch((e) => toast(e.message)).finally(() => setBusy(false));
  };
  return (
    <>
      <PageHead title="Field builder" sub="Choose which fields and documents each form asks for, who fills them and who may see them." actions={backToSettings} />
      <Tabs value={form.id} onChange={(v) => { setFormId(v); setDraft(null); setOpen(null); }} tabs={forms.map((f) => ({ id: f.id, label: f.label.en }))} />
      <Panel title={form.label.en} sub={`Version ${form.version}${form.edited ? "" : " (as delivered)"}. A field with answers is archived, never deleted.`}>
        <ul className="pf-list pf-approvals">
          {fields.map((f, i) => (
            <li key={f.key}>
              <div>
                <span><b>{f.label.en}</b> {f.required && <Badge tone="info">Required</Badge>} {f.visibility === "public" ? <Badge tone="ok">Public</Badge> : <Badge>Private</Badge>} {f.locked && <Badge tone="warn">Needed by Sheetal</Badge>} {f.archivedAt && <Badge tone="danger">Archived</Badge>}</span>
                <span className="small muted">{FIELD_TYPES.find((t) => t.id === f.type)?.label} · filled by {FILLED_BY.find((t) => t.id === f.filledBy)?.label.toLowerCase()} · key <code>{f.key}</code></span>
                {open === f.key && canChange && (
                  <div className="pf-form-stack">
                    <Field label="Name (English)"><Input value={f.label.en} maxLength={120} onChange={(e) => edit(patchField(fields, f.key, { label: { ...f.label, en: e.target.value } }))} /></Field>
                    <Field label="Name (Nepali)" optional><Input value={f.label.ne || ""} maxLength={120} onChange={(e) => edit(patchField(fields, f.key, { label: { en: f.label.en, ...(e.target.value ? { ne: e.target.value } : {}) } }))} /></Field>
                    <Field label="Who fills it"><Select value={f.filledBy} onChange={(v) => edit(patchField(fields, f.key, { filledBy: v }))} options={FILLED_BY} /></Field>
                    <Toggle checked={f.required} disabled={!!f.locked} label="Required" onChange={(v) => edit(patchField(fields, f.key, { required: v }))} />
                    <Toggle checked={f.visibility === "public"} label="Public (may show on the business's website and receipts)" onChange={(v) => edit(patchField(fields, f.key, { visibility: v ? "public" : "private" }))} />
                    {f.file && <Field label="Largest file (MB)"><Input type="number" min="0.5" max="25" step="0.5" value={f.file.maxMB} onChange={(e) => edit(patchField(fields, f.key, { file: { ...f.file, maxMB: Number(e.target.value) || 5 } }))} /></Field>}
                  </div>
                )}
              </div>
              {canChange && <div className="pf-row-actions">
                <Button size="sm" variant="ghost" aria-label={`Move ${f.label.en} up`} disabled={i === 0} onClick={() => edit(moveField(fields, f.key, -1))}><Icon name="arrow-up" size={14} /></Button>
                <Button size="sm" variant="ghost" aria-label={`Move ${f.label.en} down`} disabled={i === fields.length - 1} onClick={() => edit(moveField(fields, f.key, 1))}><Icon name="arrow-down" size={14} /></Button>
                <Button size="sm" variant="outline" onClick={() => setOpen(open === f.key ? null : f.key)}>{open === f.key ? "Close" : "Change"}</Button>
                {!f.locked && <Button size="sm" variant="outline" onClick={() => edit(setArchived(fields, f.key, !f.archivedAt))}>{f.archivedAt ? "Bring back" : "Archive"}</Button>}
              </div>}
            </li>
          ))}
        </ul>
        {canChange ? (
          <div className="pf-pad pf-row-actions" style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
            <Input style={{ maxWidth: 240 }} placeholder="New field name (English)" aria-label="New field name" value={adding.label} maxLength={120} onChange={(e) => setAdding((a) => ({ ...a, label: e.target.value }))} />
            <Select value={adding.type} aria-label="New field type" onChange={(v) => setAdding((a) => ({ ...a, type: v }))} options={FIELD_TYPES} />
            <Button variant="outline" icon="plus" disabled={!adding.label.trim()} onClick={add}>Add field</Button>
            <Button disabled={!dirty || busy} onClick={save}>Save form</Button>
            {dirty && <Button variant="ghost" onClick={() => setDraft(null)}>Undo my changes</Button>}
          </div>
        ) : <p className="pf-pad pf-hint"><Icon name="lock" size={13} />Your staff role can see forms but not change them.</p>}
      </Panel>
    </>
  );
}

// ── Theme ──
const COLOURS = [["brand", "Brand colour", true], ["dark", "Dark colour (text)", true], ["light", "Light colour (page)", true], ["button", "Buttons", false], ["text", "Body text", false], ["page", "Page background", false], ["surface", "Cards and forms", false]];
export function ThemePage({ api = adminApi }) {
  const toast = useToast();
  const [state, load] = useLoad("/admin/settings/store/platform.theme", api);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  if (!state.data) return <><PageHead title="Theme" actions={backToSettings} /><Waiting state={state} load={load} title="The theme" /></>;
  const d = state.data;
  const t = draft || d.value;
  const setColour = (k, v) => { const colors = { ...t.colors }; if (v) colors[k] = v; else delete colors[k]; setDraft({ ...t, colors }); };
  const bad = Object.values(t.colors).some((v) => !isHex(v));
  const run = (p) => { setBusy(true); p.then((r) => { toast(r.message); setDraft(null); return load(); }).catch((e) => toast(e.message)).finally(() => setBusy(false)); };
  return (
    <>
      <PageHead title="Theme" sub="Sheetal's own look: the website, the admin panel and every business without its own branding." actions={backToSettings} />
      <div className="pf-int-detail">
        <Panel title="Colours and shape" sub={d.isDefault && !draft ? "Using the default look." : undefined} pad>
          <div className="pf-form-stack">
            {COLOURS.map(([k, label, needed]) => (
              <Field key={k} label={label} optional={!needed} hint={!needed && !t.colors[k] ? "Empty: worked out from the three main colours." : undefined} error={t.colors[k] && !isHex(t.colors[k]) ? "Use a colour like #9D1D21." : undefined}>
                <div className="pf-row-actions" style={{ justifyContent: "flex-start", flexWrap: "nowrap" }}>
                  <input type="color" aria-label={`${label} picker`} disabled={!d.canChange} value={isHex(t.colors[k]) ? t.colors[k] : "#ffffff"} onChange={(e) => setColour(k, e.target.value.toUpperCase())} />
                  <Input value={t.colors[k] || ""} disabled={!d.canChange} maxLength={7} placeholder="#RRGGBB" onChange={(e) => setColour(k, e.target.value.trim())} />
                </div>
              </Field>
            ))}
            <Field label={`Corner radius: ${t.radius} px`}><input type="range" min="0" max="20" step="1" disabled={!d.canChange} value={t.radius} onChange={(e) => setDraft({ ...t, radius: Number(e.target.value) })} /></Field>
          </div>
          {d.canChange && <div className="pf-row-actions" style={{ justifyContent: "flex-start", marginTop: 14 }}>
            <Button disabled={!draft || bad || busy} onClick={() => run(api("PUT", "/admin/settings/store/platform.theme", { value: t }))}>Save theme</Button>
            {draft && <Button variant="ghost" onClick={() => setDraft(null)}>Undo my changes</Button>}
            {!d.isDefault && <Button variant="outline" disabled={busy} onClick={() => run(api("DELETE", "/admin/settings/store/platform.theme"))}>Back to the default</Button>}
          </div>}
        </Panel>
        <Panel title="Preview" pad>
          {!bad && <div className="pf-theme-preview" style={previewVars(t)}>
            <div className="pf-theme-card"><b>A card</b><p>This is how text reads on a card and on the page.</p><span className="pf-theme-btn">A button</span> <span className="pf-theme-link">A link</span></div>
          </div>}
          <p className="small muted">A look that cannot be read is refused when you save, with the reason.</p>
          {d.history?.length > 0 && <p className="small muted">Last change: {fdatetime(d.history[0].at)}.</p>}
        </Panel>
      </div>
    </>
  );
}

// ── Revenue share and report ──
export function RevenuePage({ api = adminApi }) {
  const toast = useToast();
  const [range, setRange] = useState("7d");
  const [report, loadReport] = useLoad(`/admin/reports/revenue?range=${range}`, api);
  const [share, loadShare] = useLoad("/admin/settings/store/platform.revenueShare", api);
  const [draft, setDraft] = useState(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const s = draft || share.data?.value;
  const num = (v) => (v === "" ? 0 : Math.max(0, Math.min(100, Number(v) || 0)));
  const save = () => {
    setBusy(true);
    api("PUT", "/admin/settings/store/platform.revenueShare", { value: s, reason: reason.trim() })
      .then((r) => { toast(r.message); setDraft(null); setReason(""); loadShare(); loadReport(); }).catch((e) => toast(e.message)).finally(() => setBusy(false));
  };
  const r = report.data;
  const stat = (label, key) => (<div className="card pf-stat" key={key}><span className="small muted">{label}</span><b className="tnum">{rupees(r.totals[key])}</b><span className="small muted">{changeWords(r.changePct[key])}</span></div>);
  return (
    <>
      <PageHead title="Revenue" sub="What Sheetal earned, by Nepal day, and the rule for its share of online payments." actions={backToSettings} />
      <Tabs value={range} onChange={setRange} tabs={[{ id: "today", label: "Today" }, { id: "7d", label: "Last 7 days" }, { id: "30d", label: "Last 30 days" }]} />
      {!r ? <Waiting state={report} load={loadReport} title="The report" /> : (
        <>
          <div className="pf-stat-row">{[stat("Net to Sheetal", "netPaisa"), stat("Subscriptions", "subscriptionPaisa"), stat("Commission", "commissionPaisa"), stat("Partner share", "partnerSharePaisa")]}</div>
          <Panel title={`${r.from} to ${r.to}`} sub={r.partnerBasis} actions={<Button size="sm" variant="outline" icon="download" onClick={() => adminDownload(`/admin/reports/revenue?range=${range}&format=csv`, `sheetal-revenue-${r.from}-to-${r.to}.csv`).catch((e) => toast(e.message))}>CSV</Button>}>
            <div className="pf-table-wrap"><table className="pf-table">
              <thead><tr><th>Day</th><th className="num">Collected</th><th className="num">Refunds</th><th className="num">Subscriptions</th><th className="num">Commission</th><th className="num">Partner</th><th className="num">Net</th></tr></thead>
              <tbody>{r.rows.map((x) => (<tr key={x.key}><td>{x.key}</td><td className="num tnum">{rupees(x.totals.grossPaisa)}</td><td className="num tnum">{rupees(x.totals.refundsPaisa)}</td><td className="num tnum">{rupees(x.totals.subscriptionPaisa)}</td><td className="num tnum">{rupees(x.totals.commissionPaisa)}</td><td className="num tnum">{rupees(x.totals.partnerSharePaisa)}</td><td className="num tnum"><b>{rupees(x.totals.netPaisa)}</b></td></tr>))}</tbody>
            </table></div>
          </Panel>
        </>
      )}
      {!s ? (share.error ? null : <Panel><p className="pf-pad small muted">Loading…</p></Panel>) : (
        <Panel title="Revenue share" sub="Applies to payments from the start date on. Earlier days are never rewritten." pad>
          <div className="pf-form-stack">
            <Field label="Sheetal's commission on online payments (%)"><Input type="number" min="0" max="100" step="0.25" disabled={!share.data.canChange} value={s.commissionPct} onChange={(e) => setDraft({ ...s, commissionPct: num(e.target.value) })} /></Field>
            <Toggle checked={s.technologyPartner.enabled} disabled={!share.data.canChange} label="Pay a part of the commission to a technology partner" onChange={(v) => setDraft({ ...s, technologyPartner: { ...s.technologyPartner, enabled: v } })} />
            {s.technologyPartner.enabled && <>
              <Field label="Partner name"><Input value={s.technologyPartner.name} maxLength={120} disabled={!share.data.canChange} onChange={(e) => setDraft({ ...s, technologyPartner: { ...s.technologyPartner, name: e.target.value } })} /></Field>
              <Field label="Partner's part of the commission (%)" hint="A part of Sheetal's commission, not of the payment."><Input type="number" min="0" max="100" step="0.25" disabled={!share.data.canChange} value={s.technologyPartner.sharePct} onChange={(e) => setDraft({ ...s, technologyPartner: { ...s.technologyPartner, sharePct: num(e.target.value) } })} /></Field>
            </>}
            <Field label="Start date (Nepal)" hint="It cannot move back before the current one."><Input type="date" disabled={!share.data.canChange} value={s.effectiveFrom} onChange={(e) => setDraft({ ...s, effectiveFrom: e.target.value })} /></Field>
            {draft && <Field label="Reason for this change" hint="5 to 300 characters. Saved in the audit log."><Textarea rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
          </div>
          {share.data.canChange ? <div className="pf-row-actions" style={{ justifyContent: "flex-start", marginTop: 14 }}>
            <Button disabled={!draft || reason.trim().length < 5 || busy} onClick={save}>Save revenue share</Button>
            {draft && <Button variant="ghost" onClick={() => { setDraft(null); setReason(""); }}>Undo my changes</Button>}
          </div> : <p className="pf-hint"><Icon name="lock" size={13} />Only staff who manage the revenue share can change it.</p>}
          {share.data.history?.length > 0 && <ul className="pf-list" style={{ marginTop: 12 }}>{share.data.history.slice(0, 5).map((h, i) => <li key={i}><span className="small">{fdatetime(h.at)} · changed {h.fields.join(", ")}{h.reason ? ` · "${h.reason}"` : ""}</span></li>)}</ul>}
        </Panel>
      )}
    </>
  );
}
