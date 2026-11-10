// Message wording and expiry reminders on the admin API (Admin → Messages).
// Where it fits: the "Templates" and "Expiry" tabs of the Messages hub in AdminApp when isStaffLive().
// How it works: Templates lists every message the system sends; staff change the subject and text, preview it with sample
// values, send themselves a test, switch their wording off, or reset to the built-in text. Expiry sets which reminders
// go out (plans, listings, boosts, banners), shows what is coming in the next 7 days and what went out last, and can send
// today's reminders now.
// Rules: only the placeholders listed under the editor can be used; the server checks and audits everything.

import React, { useEffect, useState } from "react";
import { fdate } from "@sheetal/shared/core/format";
import { Badge, Button, Field, Input, PageHead, Panel, Table, Textarea, ToggleRow, useToast } from "@sheetal/shared/core/ui";
import { adminApi } from "../api";

const firstError = (e) => Object.values(e.errors || {}).flat()[0] || e.message;

export function LiveTemplates() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [key, setKey] = useState("verify_email");
  const [lang, setLang] = useState("en");
  const [f, setF] = useState({ subject: "", body: "", active: true });
  const [preview, setPreview] = useState(null);
  const load = () => adminApi("GET", "/admin/templates").then((r) => setD(r.data)).catch((e) => toast(firstError(e)));
  useEffect(() => { load(); }, []);
  const def = d?.defs.find((x) => x.key === key);
  const saved = d?.saved.find((x) => x.key === key && x.channel === "email" && x.lang === lang);
  useEffect(() => { if (def) { setF(saved ? { subject: saved.subject, body: saved.body, active: saved.active } : { subject: def.subject, body: def.body, active: true }); setPreview(null); } }, [key, lang, d]);
  if (!d || !def) return <PageHead title="Templates" sub="Loading…" />;
  const act = (p, ok) => p.then((r) => { toast(r.message || ok); load(); }).catch((e) => toast(firstError(e)));
  const body = { channel: "email", lang, subject: f.subject, body: f.body, active: f.active };
  const insert = (v) => setF({ ...f, body: `${f.body}{{${v}}}` });
  return (
    <div className="pf-settings">
      <Panel title="Messages" sub="Everything the system sends. A dot means you changed the wording." pad>
        <div className="pf-stack">
          {d.defs.map((x) => { const custom = d.saved.some((s) => s.key === x.key && s.active); return (
            <button key={x.key} type="button" className={`btn ${x.key === key ? "btn-primary" : "btn-ghost"}`} style={{ justifyContent: "space-between", textAlign: "left" }} onClick={() => setKey(x.key)}>
              <span className="pf-two"><b>{x.name}</b><small>{x.when}</small></span>{custom && <Badge tone="done">Edited</Badge>}
            </button>); })}
        </div>
      </Panel>
      <Panel title={def.name} sub={def.when} pad>
        <div className="pf-stack">
          <div className="pf-row-actions" style={{ justifyContent: "flex-start" }}>
            {d.langs.map((l) => <Button key={l} size="sm" variant={l === lang ? "primary" : "outline"} onClick={() => setLang(l)}>{l === "en" ? "English" : "Nepali"}</Button>)}
            {saved && <Badge tone={saved.active ? "done" : "neutral"}>{saved.active ? "Your wording is used" : "Switched off: built-in text is used"}</Badge>}
            {!saved && <Badge tone="neutral">Built-in text</Badge>}
          </div>
          {lang !== "en" && !saved && <p className="small muted" style={{ margin: 0 }}>No Nepali wording yet. The built-in English text (shown) is the starting point; the system sends English unless a Nepali copy is saved for the language it uses.</p>}
          <Field label="Subject"><Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></Field>
          <Field label="Text"><Textarea rows={10} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
          <div className="small">Add a value: {d.defs.find((x) => x.key === key).allowed.map((v) => <Button key={v} size="sm" variant="ghost" onClick={() => insert(v)}>{`{{${v}}}`}</Button>)}</div>
          <ToggleRow title="Use my wording" sub="Off sends the built-in text again without deleting yours." checked={f.active} onChange={(v) => setF({ ...f, active: v })} />
          <div className="pf-row-actions" style={{ justifyContent: "flex-start" }}>
            <Button onClick={() => act(adminApi("PUT", `/admin/templates/${key}`, body), "Saved.")}>Save</Button>
            <Button variant="outline" onClick={() => adminApi("POST", `/admin/templates/${key}/preview`, { subject: f.subject, body: f.body }).then((r) => setPreview(r.data)).catch((e) => toast(firstError(e)))}>Preview</Button>
            <Button variant="outline" onClick={() => act(adminApi("POST", `/admin/templates/${key}/test`, { subject: f.subject, body: f.body }), "Sent.")}>Send me a test</Button>
            {saved && <Button variant="ghost" onClick={() => act(adminApi("DELETE", `/admin/templates/${key}?channel=email&lang=${lang}`), "Reset.")}>Reset to built-in</Button>}
          </div>
          {preview && <div className="card pf-pad"><b>{preview.subject}</b><pre style={{ whiteSpace: "pre-wrap", margin: "8px 0 0", font: "inherit" }}>{preview.body}</pre><p className="small muted" style={{ margin: "8px 0 0" }}>Shown with sample values.</p></div>}
        </div>
      </Panel>
    </div>
  );
}

const KIND = { plan_renewal: "Plan renews", listing_stale: "Listing not updated", boost_ending: "Boost ends", banner_ending: "Banner ends" };
const kindName = (k) => KIND[k.replace(/_\d+$/, "")] || k;

export function LiveExpiry() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [s, setS] = useState(null);
  const load = () => adminApi("GET", "/admin/reminders").then((r) => { setD(r.data); setS(JSON.parse(JSON.stringify(r.data.settings))); }).catch((e) => toast(firstError(e)));
  useEffect(() => { load(); }, []);
  if (!d || !s) return <PageHead title="Expiry reminders" sub="Loading…" />;
  const dirty = JSON.stringify(s) !== JSON.stringify(d.settings);
  const save = () => adminApi("PUT", "/admin/reminders", { plan: { on: s.plan.on, days: String(s.plan.days).split(",").map((x) => Number(x.trim())).filter((x) => x) }, listings: { on: s.listings.on, staleDays: Number(s.listings.staleDays) }, boosts: s.boosts, banners: s.banners }).then((r) => { toast(r.message); load(); }).catch((e) => toast(firstError(e)));
  const run = () => adminApi("POST", "/admin/reminders/run").then((r) => { toast(r.message); load(); }).catch((e) => toast(firstError(e)));
  return (
    <>
      <PageHead title="Expiry reminders" sub="Reminders go to the business owner (a bell and an email) after 9 am Nepal time, once each." actions={<Button variant="outline" onClick={run}>Send today's now</Button>} />
      <Panel title="What to remind" pad>
        <div className="pf-stack">
          <ToggleRow title="Plan renews soon (no auto-pay)" sub="Billing already reminds on its own days; this adds the others." checked={s.plan.on} onChange={(v) => setS({ ...s, plan: { ...s.plan, on: v } })} />
          <Field label="Days before the plan ends" hint="Separate with commas, like 7, 3, 1."><Input value={Array.isArray(s.plan.days) ? s.plan.days.join(", ") : s.plan.days} onChange={(e) => setS({ ...s, plan: { ...s.plan, days: e.target.value.replace(/[^\d, ]/g, "") } })} /></Field>
          <ToggleRow title="Listings nobody has updated" sub="Listings never expire on their own, so this reminds when a listing hasn't been touched for a while." checked={s.listings.on} onChange={(v) => setS({ ...s, listings: { ...s.listings, on: v } })} />
          <Field label="Days without an update"><Input className="input tnum" inputMode="numeric" value={s.listings.staleDays} onChange={(e) => setS({ ...s, listings: { ...s.listings, staleDays: e.target.value.replace(/\D/g, "") } })} /></Field>
          <ToggleRow title="Boost ends tomorrow" checked={s.boosts.on} onChange={(v) => setS({ ...s, boosts: { on: v } })} />
          <ToggleRow title="Banner ends tomorrow" checked={s.banners.on} onChange={(v) => setS({ ...s, banners: { on: v } })} />
          <div><Button disabled={!dirty} onClick={save}>Save</Button></div>
        </div>
      </Panel>
      <Panel title="Coming in the next 7 days" pad>
        <Table rows={d.upcoming} minWidth={560} empty={<p className="muted">Nothing to send.</p>} columns={[
          { key: "w", label: "Send on", render: (x) => fdate(x.sendOn) }, { key: "b", label: "Business", render: (x) => <b>{x.business}</b> },
          { key: "k", label: "Reminder", render: (x) => kindName(x.kind) }, { key: "d", label: "About", render: (x) => x.what },
        ]} />
      </Panel>
      <Panel title="Sent lately" pad>
        <Table rows={d.recent} minWidth={480} empty={<p className="muted">Nothing sent yet.</p>} columns={[
          { key: "w", label: "Sent", render: (x) => fdate(x.at) }, { key: "b", label: "Business", render: (x) => x.business }, { key: "k", label: "Reminder", render: (x) => kindName(x.kind) },
        ]} />
      </Panel>
    </>
  );
}
