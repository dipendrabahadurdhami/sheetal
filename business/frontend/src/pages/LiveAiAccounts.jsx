// Your own AI account on the business API (Business → AI accounts).
// Where it fits: /business/ai-accounts when signed in (the sample screen is AiAccounts in Sector.jsx).
// How it works: paste your own Anthropic key and your AI features (lead finder, Ask AI on your listings) use it instead of
// the AI included with your plan. Pick the model, set a monthly cap in credits (1 credit is about 1,000 tokens; 0 means no
// cap), test the key, switch it off or remove it. Usage on your own key doesn't use up your plan's credits.
// Rules: the key is write-only: once saved, only the last 4 characters are shown and it can't be read back. Only people
// who can change business settings see this. Sheetal can switch own keys off for everyone.

import React, { useEffect, useState } from "react";
import { Badge, Button, Empty, Field, Input, PageHead, Select, Stat, useToast } from "@sheetal/shared/core/ui";
import { bizApi } from "../api";

export function LiveAiAccounts({ tenant }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");
  const [cap, setCap] = useState("0");
  const [busy, setBusy] = useState(false);
  const fill = (x) => { setD(x); setModel(x.model); setCap(String(x.cap)); setKey(""); };
  useEffect(() => {
    let gone = false;
    bizApi("GET", "/ai-account").then((r) => { if (!gone) fill(r.data); }).catch((e) => { if (!gone) { setD((v) => v || false); toast(e.message); } });
    return () => { gone = true; };
  }, [tenant.id]);
  const run = async (fn) => { setBusy(true); try { await fn(); } catch (e) { toast(e.message); } finally { setBusy(false); } };
  const put = (body) => run(async () => { const r = await bizApi("PUT", "/ai-account", body); toast(r.message); fill(r.data); });
  const test = () => run(async () => { const r = await bizApi("POST", "/ai-account/test"); toast(r.message); });
  const remove = () => { if (!window.confirm("Remove your key? The AI included with your plan is used again.")) return; run(async () => { const r = await bizApi("DELETE", "/ai-account"); toast(r.message); fill(r.data); }); };
  if (d === null) return <p className="muted">Loading…</p>;
  if (d === false) return <Empty icon="sparkles" title="Couldn't load this" />;
  const changed = model !== d.model || Number(cap || 0) !== d.cap;
  return (
    <>
      <PageHead title="AI accounts" sub="Use your own Anthropic account for your AI features." />
      {!d.allowed && <div className="pf-note">Own AI accounts are switched off for now. The AI included with your plan keeps working.</div>}
      <div className="pf-grid-3" style={{ marginBottom: 16 }}>
        <Stat label="Using" value={d.hasKey && d.enabled ? "Your account" : "Included AI"} note={d.hasKey ? `Key ending ${d.last4}` : "No key saved"} />
        <Stat label="Used this month" value={`${d.used} credits`} note={d.cap ? `Cap ${d.cap} credits` : "No cap"} tone={d.cap && d.used >= d.cap ? "action" : undefined} />
      </div>
      <div className="pf-stack" style={{ maxWidth: 520 }}>
        <Field label={d.hasKey ? "Replace key" : "Anthropic key"} hint="Starts with sk-ant-. It is stored sealed and can't be shown again.">
          <Input type="password" autoComplete="off" value={key} placeholder={d.hasKey ? `•••• ${d.last4}` : "sk-ant-…"} onChange={(e) => setKey(e.target.value)} />
        </Field>
        <Field label="Model"><Select value={model} onChange={setModel} options={d.models.map((m) => ({ id: m.id, label: m.label || m.id }))} /></Field>
        <Field label="Monthly cap (credits)" hint="0 means no cap. When it is reached the lead finder stops until next month; Ask AI uses the included AI."><Input className="input tnum" inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value.replace(/\D/g, ""))} /></Field>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button disabled={busy || !d.allowed || (!key.trim() && (!d.hasKey || !changed))} onClick={() => put({ ...(key.trim() ? { apiKey: key.trim() } : {}), model, cap: Number(cap || 0) })}>Save</Button>
          {d.hasKey && <Button variant="outline" disabled={busy} onClick={test}>Test key</Button>}
          {d.hasKey && <Button variant="outline" disabled={busy || !d.allowed} onClick={() => put({ enabled: !d.enabled })}>{d.enabled ? "Switch off" : "Switch on"}</Button>}
          {d.hasKey && <Button variant="ghost" disabled={busy} onClick={remove}>Remove</Button>}
        </div>
        {d.hasKey && !d.enabled && <Badge tone="neutral">Switched off: the included AI is used</Badge>}
      </div>
    </>
  );
}
