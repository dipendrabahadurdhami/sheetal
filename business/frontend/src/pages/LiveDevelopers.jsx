// Developer keys on the business API (Business → Settings → Developers).
// Where it fits: /business/developers when signed in (the sample screen is Developers in Sector.jsx).
// How it works: make a key with a name and what it may do (read listings, send enquiries, read stays). The key is shown
// once in a box to copy; after that only its start is shown. Revoking stops it at once. Below is how to call the API.
// Rules: only people who can change business settings see this. The server keeps only a hash of the key, so a lost key
// can't be shown again: revoke it and make a new one.

import React, { useEffect, useState } from "react";
import { fdate } from "@sheetal/shared/core/format";
import { Badge, Button, Empty, Field, Input, Modal, PageHead, Table, useToast } from "@sheetal/shared/core/ui";
import { bizApi } from "../api";

const SCOPES = [
  { id: "listings.read", label: "Read listings", sub: "Your published listings." },
  { id: "leads.write", label: "Send enquiries", sub: "Puts an enquiry in your Inbox." },
  { id: "bookings.read", label: "Read stays", sub: "Bookings, without guest contact details." },
];
const API = (import.meta.env.VITE_WEBSITE_API_URL || "https://YOUR-SHEETAL-API/v1").replace(/\/+$/, "");

export function LiveDevelopers({ tenant }) {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [tick, setTick] = useState(0);
  const [form, setForm] = useState(null);
  const [shown, setShown] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let gone = false;
    bizApi("GET", "/developers/keys").then((r) => { if (!gone) setRows(r.data); }).catch((e) => { if (!gone) { setRows((d) => d || false); toast(e.message); } });
    return () => { gone = true; };
  }, [tenant.id, tick]);
  const make = async () => {
    setBusy(true);
    try { const r = await bizApi("POST", "/developers/keys", { name: form.name.trim(), scopes: form.scopes }); setForm(null); setShown(r.data.key); setTick((n) => n + 1); } catch (e) { toast(e.message); } finally { setBusy(false); }
  };
  const revoke = (k) => { if (!window.confirm(`Revoke "${k.name}"? Anything using it stops working now.`)) return; bizApi("DELETE", `/developers/keys/${k.id}`).then((r) => { toast(r.message); setTick((n) => n + 1); }).catch((e) => toast(e.message)); };
  const copy = () => { try { navigator.clipboard.writeText(shown); toast("Copied."); } catch { toast("Select the key and copy it."); } };
  const toggle = (id) => setForm((f) => ({ ...f, scopes: f.scopes.includes(id) ? f.scopes.filter((x) => x !== id) : [...f.scopes, id] }));
  return (
    <>
      <PageHead title="Developers" sub="Keys for your website or app to use your listings and send enquiries." actions={<Button icon="plus" onClick={() => setForm({ name: "", scopes: ["listings.read"] })}>New key</Button>} />
      <Table rows={rows || []} minWidth={720} empty={<Empty icon="key" title="No keys yet" />} columns={[
        { key: "n", label: "Name", render: (k) => k.name },
        { key: "k", label: "Key", render: (k) => <code>{k.shown}</code> },
        { key: "s", label: "Can", render: (k) => k.scopes.map((s) => SCOPES.find((x) => x.id === s)?.label || s).join(", ") },
        { key: "u", label: "Last used", render: (k) => k.lastUsedAt ? fdate(k.lastUsedAt) : "Never" },
        { key: "a", label: "", render: (k) => k.revoked ? <Badge tone="neutral">Revoked</Badge> : <Button size="sm" variant="ghost" onClick={() => revoke(k)}>Revoke</Button> },
      ]} />
      <h3 style={{ margin: "24px 0 8px" }}>How to use a key</h3>
      <p className="small muted">Send it as a Bearer token. Each key can make 60 calls a minute.</p>
      <pre className="small" style={{ overflowX: "auto", padding: 12, border: "1px solid var(--line, #ddd)", borderRadius: 8 }}>{`# Your published listings (listings.read)
curl ${API}/public/listings?per=20 \\
  -H "Authorization: Bearer sk_live_YOUR_KEY"

# Send an enquiry to your Inbox (leads.write)
curl -X POST ${API}/public/leads \\
  -H "Authorization: Bearer sk_live_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Hari","phone":"9841000000","message":"Is this still available?","listing_code":"EV-1"}'

# Stays, without guest contact details (bookings.read)
curl "${API}/public/bookings?from=2026-12-01&to=2026-12-31" \\
  -H "Authorization: Bearer sk_live_YOUR_KEY"`}</pre>
      <Modal open={!!form} onClose={() => setForm(null)} title="New key" footer={form && <><Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button><Button disabled={busy || form.name.trim().length < 2 || !form.scopes.length} onClick={make}>Make key</Button></>}>
        {form && (
          <div className="pf-stack">
            <Field label="Name" hint="So you know what uses it, e.g. Company website."><Input value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="What can it do?">
              {SCOPES.map((s) => <label key={s.id} className="small" style={{ display: "block", margin: "6px 0" }}><input type="checkbox" checked={form.scopes.includes(s.id)} onChange={() => toggle(s.id)} /> <strong>{s.label}</strong> <span className="muted">{s.sub}</span></label>)}
            </Field>
          </div>
        )}
      </Modal>
      <Modal open={!!shown} onClose={() => setShown(null)} title="Copy your key now" footer={<Button onClick={() => setShown(null)}>I have copied it</Button>}>
        <p className="small">This is the only time it is shown. If you lose it, revoke it and make a new one.</p>
        <pre style={{ overflowX: "auto", padding: 12, border: "1px solid var(--line, #ddd)", borderRadius: 8, userSelect: "all" }}>{shown}</pre>
        <Button variant="outline" icon="copy" onClick={copy}>Copy</Button>
      </Modal>
    </>
  );
}
