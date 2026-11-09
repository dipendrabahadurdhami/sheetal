// Google, WhatsApp and Cloudflare connections on the admin API (Admin → Setup center).
// Where it fits: shown above the sample Setup center cards when isStaffLive() (AdminApp.jsx); fields come from
// LIVE_INTEGRATIONS in shared/src/data/integrations.js.
// How it works: each card loads GET /admin/settings/integrations/:id, saves with PUT and checks with POST .../test.
// Keys and tokens are write-only: the page only knows whether one is saved (hasSecret) and never shows it again.
// Rules: only the super admin can save keys; Turnstile (robot check) is set below in Setup; plain, short copy.

import React, { useEffect, useState } from "react";
import { LIVE_INTEGRATIONS, STATUS_LABEL, STATUS_TONE } from "@sheetal/shared/data/integrations";
import { Badge, Button, Field, Input, Panel, Seg, useToast } from "@sheetal/shared/core/ui";
import { adminApi } from "../api";

const firstError = (e) => Object.values(e.errors || {}).flat()[0] || e.message;
const hasKey = (k) => `has${k[0].toUpperCase()}${k.slice(1)}`;

function Card({ meta }) {
  const toast = useToast();
  const [info, setInfo] = useState(null);
  const [v, setV] = useState({});
  const [checks, setChecks] = useState(null);
  const [busy, setBusy] = useState("");
  const base = `/admin/settings/integrations/${meta.id}`;

  const load = () => adminApi("GET", base).then(({ data }) => { setInfo(data); setV({}); }).catch((e) => toast(e.message));
  useEffect(() => { load(); }, []);
  if (!info) return <Panel title={meta.name} pad><p className="muted">Loading…</p></Panel>;

  const shown = meta.id === "whatsapp" && (v.mode ?? info.mode ?? "cloud") === "qr" ? meta.fields.filter((f) => f.key === "mode" || f.key === "qrStatus") : meta.fields.filter((f) => f.key !== "qrStatus");
  const dirty = Object.values(v).some((x) => x !== undefined && x !== "");
  const save = () => {
    setBusy("save");
    // an empty secret box means "keep the saved key", so it is not sent
    const body = Object.fromEntries(Object.entries(v).filter(([k, x]) => x !== undefined && !(x === "" && meta.fields.find((f) => f.key === k)?.secret)));
    adminApi("PUT", base, body).then((r) => { toast(r.message); setChecks(null); load(); }).catch((e) => toast(firstError(e))).finally(() => setBusy(""));
  };
  const test = () => {
    setBusy("test");
    adminApi("POST", `${base}/test`).then(({ data }) => { setChecks(data.checks); load(); }).catch((e) => toast(firstError(e))).finally(() => setBusy(""));
  };

  return (
    <Panel title={meta.name} sub={meta.sub} pad>
      <div className="pf-stack">
        <div><Badge tone={STATUS_TONE[info.status]}>{STATUS_LABEL[info.status]}</Badge></div>
        {shown.map((f) => {
          const cur = v[f.key] ?? (f.secret ? "" : info[f.key] ?? "");
          if (f.type === "seg") return <Field key={f.key} label={f.label}><Seg value={cur || f.options[0].id} onChange={(x) => setV({ ...v, [f.key]: x })} options={f.options} /></Field>;
          return (
            <Field key={f.key} label={f.label} hint={f.secret && info[hasKey(f.key)] ? "Saved. Enter a new value to replace it." : f.hint}>
              <Input type={f.secret ? "password" : "text"} autoComplete="off" placeholder={f.secret && info[hasKey(f.key)] ? "••••••••••••" : f.placeholder} value={cur} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} />
            </Field>
          );
        })}
        <div className="pf-row-actions" style={{ justifyContent: "flex-start" }}>
          <Button disabled={!dirty || busy === "save"} onClick={save}>Save</Button>
          <Button className="btn btn-outline" disabled={busy === "test" || dirty} onClick={test}>{busy === "test" ? "Testing…" : "Test"}</Button>
        </div>
        {dirty && <p className="small muted" style={{ margin: 0 }}>Save before you test.</p>}
        {checks && <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{checks.map((c) => <li key={c.name}><b>{c.name}:</b> {c.ok ? "OK. " : "Problem. "}{c.message}</li>)}</ul>}
        {info.lastTest && !checks && <p className="small muted" style={{ margin: 0 }}>Last test: {info.lastTest.ok ? "passed" : "failed"}.</p>}
      </div>
    </Panel>
  );
}

export function LiveIntegrations() {
  return <div className="pf-stack">{LIVE_INTEGRATIONS.map((m) => <Card key={m.id} meta={m} />)}</div>;
}
