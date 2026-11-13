// Business → Settings → Apps: one tab per app the business has, with the settings that app's manifest lets a business set (scope "business").
// Where it fits: /business/settings/apps (BusinessApp.jsx, inside the Settings menu). Backend: apps/workspace/backend/app-settings.* (P2-W6).
// How it works: useApiGet loads GET /workspace/app-settings ({ apps: [{ app, label, settings: [{ key, label, type, value, default, stored }] }], canEdit });
// each setting is a field by its type (number, money, on/off, text, list one per line); Save sends PUT /workspace/app-settings/:key { value } and
// shows the server's message or its reasons next to the field.
// Rules: nothing is kept in the browser; people who can't change settings see the values read only.

import React, { useEffect, useState } from "react";
import { Button, Empty, Field, Input, PageHead, Panel, Tabs, Textarea, Toggle, useToast } from "@sheetal/ui/primitives";
import { bizApi } from "@sheetal/sdk/client";
import { useApiGet } from "@sheetal/sdk/hooks";

/** The text a field shows for a value of this type. */
export const toText = (type, v) => (v === null || v === undefined ? "" : type === "list" ? v.join("\n") : type === "json" ? JSON.stringify(v, null, 2) : String(v));
/** The value sent for the text in a field of this type (null for an empty number when the default is null). */
export function fromText(type, text, nullable) {
  const s = String(text ?? "").trim();
  if (type === "int" || type === "money") return s === "" ? (nullable ? null : 0) : Number(s.replace(/,/g, ""));
  if (type === "list") return s.split("\n").map((x) => x.trim()).filter(Boolean);
  if (type === "json") { try { return JSON.parse(s || "null"); } catch { return s; } }
  return s;
}

function SettingField({ s, canEdit, onSaved }) {
  const toast = useToast();
  const [v, setV] = useState(s.type === "bool" ? !!s.value : toText(s.type, s.value));
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setV(s.type === "bool" ? !!s.value : toText(s.type, s.value)); }, [s.value, s.type]);
  const label = s.label?.en || s.key;
  const save = (value) => {
    setBusy(true); setErr(null);
    bizApi("PUT", `/workspace/app-settings/${encodeURIComponent(s.key)}`, { value })
      .then((r) => { toast(r.message); onSaved(); })
      .catch((e) => { setErr(Object.values(e.errors || {}).flat()[0] || e.message); toast(e.message); })
      .finally(() => setBusy(false));
  };
  if (s.type === "bool") return <Field label={label}><Toggle checked={v} disabled={!canEdit || busy} onChange={(x) => { setV(x); save(x); }} aria-label={label} /></Field>;
  const multi = s.type === "list" || s.type === "json";
  const hint = s.type === "money" ? `Rupees${s.default === null ? "; leave empty for none" : ""}` : s.type === "list" ? "One per line" : undefined;
  return (
    <Field label={label} hint={hint} error={err}>
      <div className="pf-row">
        {multi ? <Textarea rows={4} value={v} disabled={!canEdit} onChange={(e) => setV(e.target.value)} />
          : <Input className={s.type === "int" || s.type === "money" ? "input tnum" : "input"} inputMode={s.type === "int" || s.type === "money" ? "numeric" : undefined} value={v} disabled={!canEdit} onChange={(e) => setV(e.target.value)} />}
        {canEdit && <Button variant="outline" disabled={busy || v === toText(s.type, s.value)} onClick={() => save(fromText(s.type, v, s.default === null))}>Save</Button>}
      </div>
    </Field>
  );
}

export function AppSettingsPage() {
  const { data, error, refresh } = useApiGet("/workspace/app-settings");
  const apps = data?.apps || [];
  const [tab, setTab] = useState(null);
  const open = apps.find((a) => a.app === tab) || apps[0];
  const head = <PageHead title="App settings" sub="Each app's own settings for your business." />;
  if (error) return <>{head}<Panel><Empty icon="circle-alert" title="App settings couldn't load">{error.message}</Empty></Panel></>;
  if (!data) return <>{head}<div className="sk" style={{ height: 240, borderRadius: "var(--r)" }} /></>;
  if (!apps.length) return <>{head}<Panel><Empty icon="settings" title="Nothing to set yet">None of your apps has settings of its own yet.</Empty></Panel></>;
  return (
    <>
      {head}
      <Tabs value={open.app} onChange={setTab} tabs={apps.map((a) => ({ id: a.app, label: a.label?.en || a.app }))} />
      <Panel pad>
        <div className="pf-stack">
          {open.settings.map((s) => <SettingField key={s.key} s={s} canEdit={data.canEdit} onSaved={refresh} />)}
          {!data.canEdit && <span className="small muted">Only people who manage the business's settings can change these.</span>}
        </div>
      </Panel>
    </>
  );
}
