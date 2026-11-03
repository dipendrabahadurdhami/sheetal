import React, { useEffect, useState } from "react";
import { useStore } from "@sheetal/shared/core/store";
import { fdate, fdatetime, rs } from "@sheetal/shared/core/format";
import { Badge, Button, Drawer, Empty, Field, Input, Panel, Select, Stat, Table, Tabs, Textarea, ToggleRow, useToast } from "@sheetal/shared/core/ui";
import { adminApi } from "../api";

// Billing on the admin API: revenue, payments (bank transfers to confirm, refunds), invoices, and the
// gateway and billing settings. Payment keys are write-only: a saved key is never shown again.

const API_FILES = (import.meta.env.VITE_ADMIN_API_URL || "").replace(/\/v1\/?$/, "");
const PROVIDER = { esewa: "eSewa", khalti: "Khalti", fonepay: "Fonepay", manual: "Bank transfer" };
const STATUS_TONE = { paid: "done", pending_review: "action", failed: "problem", refunded: "neutral", open: "action", void: "neutral" };
const STATUS_WORD = { paid: "Paid", pending_review: "To check", failed: "Failed", refunded: "Refunded", initiated: "Started", open: "To pay", void: "Cancelled" };

function useApi(path) {
  const [s, setS] = useState({ data: null });
  const [tick, setTick] = useState(0);
  useEffect(() => { let gone = false; adminApi("GET", path).then((r) => !gone && setS({ data: r.data })).catch(() => !gone && setS({ data: null, failed: true })); return () => { gone = true; }; }, [path, tick]);
  return { ...s, reload: () => setTick((n) => n + 1) };
}
async function openProof(path, toast) {
  try {
    const res = await fetch(`${API_FILES}/v1${path}`, { headers: { Authorization: `Bearer ${localStorage.getItem("sheetal_token")}` } });
    if (!res.ok) throw new Error("Proof not found.");
    window.open(URL.createObjectURL(await res.blob()), "_blank", "noopener");
  } catch (e) { toast(e.message); }
}

export function LiveAdminBilling() {
  const toast = useToast();
  const { db } = useStore();
  const [tab, setTab] = useState("payments");
  const [show, setShow] = useState("pending_review");
  const summary = useApi("/admin/billing/summary");
  const payments = useApi(`/admin/billing/payments?status=${show}`);
  const invoices = useApi("/admin/billing/invoices");
  const [bill, setBill] = useState(null);
  const act = (p, path, body, done) => adminApi("POST", path, body).then((r) => { toast(r.message); payments.reload(); summary.reload(); invoices.reload(); done?.(); }).catch((e) => toast(e.message));
  const reject = (p) => { const note = window.prompt("Why can't this transfer be confirmed? The business gets this."); if (note?.trim()) act(p, `/admin/billing/payments/${p.id}/review`, { decision: "reject", note: note.trim() }); };
  const refund = (p) => { const note = window.prompt("Refund recorded after returning the money in the gateway's or bank's portal. Why?"); if (note?.trim()) act(p, `/admin/billing/payments/${p.id}/refund`, { note: note.trim() }); };
  const s = summary.data;
  const paidTenants = db.tenants;

  return (
    <>
      <div className="pf-stats">
        <Stat label="Received this month" value={s ? rs(s.thisMonth) : "—"} note={s ? `${s.paymentsThisMonth} payments` : ""} />
        <Stat label="Last 30 days" value={s ? rs(s.last30Days) : "—"} note={s ? s.byProvider.map((p) => `${PROVIDER[p.provider]} ${rs(p.total)}`).join(" · ") || "No payments yet" : ""} />
        <Stat label="Monthly plan value" value={s ? rs(s.mrr) : "—"} note={s ? `${s.payingBusinesses} paying businesses` : ""} />
        <Stat label="Needs attention" value={s ? s.toCheck + s.pastDue : "—"} note={s ? `${s.toCheck} transfers to check · ${s.pastDue} past due` : ""} tone={s && s.toCheck + s.pastDue ? "action" : undefined} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "payments", label: "Payments", icon: "wallet", count: s?.toCheck || undefined }, { id: "invoices", label: "Invoices", icon: "receipt" }, { id: "settings", label: "Settings", icon: "settings" }]} />

      {tab === "payments" && <section className="card pf-panel">
        <div className="pf-toolbar"><Select value={show} onChange={setShow} style={{ width: 220 }} aria-label="Show" options={[["pending_review", "Bank transfers to check"], ["paid", "Paid"], ["failed", "Failed"], ["refunded", "Refunded"], ["all", "All"]].map(([id, label]) => ({ id, label }))} /></div>
        {!payments.data ? <p className="muted pf-pad">Loading…</p> : <Table rows={payments.data} minWidth={820} empty={<Empty icon="circle-check" title="Nothing here" />} columns={[
          { key: "t", label: "Business", render: (r) => <span className="pf-two"><b>{r.tenant?.name || "—"}</b><small className="tnum">{r.invoice.number} · {r.invoice.planId.split("-").pop()} · {r.invoice.months} mo</small></span> },
          { key: "m", label: "Method", render: (r) => <span className="pf-two"><b>{PROVIDER[r.provider]}</b><small className="tnum">{r.providerRef || r.ref}</small></span> },
          { key: "a", label: "Amount", num: true, align: "right", render: (r) => rs(r.amount) },
          { key: "s", label: "Status", render: (r) => <span className="pf-two"><Badge tone={STATUS_TONE[r.status] || "neutral"}>{STATUS_WORD[r.status] || r.status}</Badge>{r.note && <small className="muted">{r.note}</small>}</span> },
          { key: "d", label: "When", num: true, render: (r) => fdatetime(r.paidAt || r.createdAt) },
          { key: "x", label: "", align: "right", render: (r) => <div className="pf-row-actions" style={{ justifyContent: "flex-end" }}>
            {r.proof && <Button size="sm" variant="ghost" icon="image" onClick={() => openProof(r.proof, toast)}>Receipt</Button>}
            {r.status === "pending_review" && <><Button size="sm" variant="outline" onClick={() => reject(r)}>Reject</Button><Button size="sm" icon="check" onClick={() => act(r, `/admin/billing/payments/${r.id}/review`, { decision: "confirm" })}>Confirm</Button></>}
            {r.status === "paid" && <Button size="sm" variant="ghost" onClick={() => refund(r)}>Refunded…</Button>}
          </div> },
        ]} />}
      </section>}

      {tab === "invoices" && <Panel title="Invoices" sub="Businesses pay open invoices from their billing page." actions={<><Button variant="outline" onClick={() => adminApi("POST", "/admin/billing/run-cycle").then((r) => { toast(r.message); invoices.reload(); summary.reload(); }).catch((e) => toast(e.message))}>Run renewals now</Button><Button icon="plus" onClick={() => setBill({ tenantId: "", planId: "", months: 1 })}>Bill a business</Button></>}>
        {!invoices.data ? <p className="muted pf-pad">Loading…</p> : <Table rows={invoices.data} minWidth={720} empty={<Empty icon="receipt" title="No invoices yet" />} columns={[
          { key: "n", label: "Invoice", render: (r) => <span className="pf-two"><b className="tnum">{r.number}</b><small>{r.tenant || "—"}</small></span> },
          { key: "p", label: "Plan", render: (r) => `${r.planId} · ${r.months} mo` },
          { key: "a", label: "Total (VAT)", num: true, align: "right", render: (r) => <span className="pf-two" style={{ alignItems: "flex-end" }}><b>{rs(r.total)}</b><small className="muted">VAT {rs(r.vat)}</small></span> },
          { key: "s", label: "Status", render: (r) => <Badge tone={STATUS_TONE[r.status]}>{STATUS_WORD[r.status]}</Badge> },
          { key: "d", label: "Due / paid", num: true, render: (r) => fdate(r.paidAt || r.dueAt) },
          { key: "x", label: "", align: "right", render: (r) => r.status === "open" && <Button size="sm" variant="ghost" onClick={() => window.confirm(`Cancel ${r.number}?`) && adminApi("POST", `/admin/billing/invoices/${r.id}/void`).then((x) => { toast(x.message); invoices.reload(); }).catch((e) => toast(e.message))}>Cancel</Button> },
        ]} />}
      </Panel>}

      {tab === "settings" && <BillingSettings />}

      <Drawer open={!!bill} onClose={() => setBill(null)} title="Bill a business" footer={bill && <><Button variant="ghost" onClick={() => setBill(null)}>Cancel</Button><Button disabled={!bill.tenantId || !bill.planId} onClick={() => adminApi("POST", "/admin/billing/invoices", { ...bill, months: Number(bill.months) }).then((r) => { toast(r.message); setBill(null); invoices.reload(); }).catch((e) => toast(e.message))}>Create invoice</Button></>}>
        {bill && <div className="pf-stack">
          <Field label="Business"><Select value={bill.tenantId} onChange={(v) => setBill({ ...bill, tenantId: v, planId: "" })} options={[{ id: "", label: "Choose…" }, ...paidTenants.map((t) => ({ id: t.id, label: `${t.name} (${t.type})` }))]} /></Field>
          <Field label="Plan"><Select value={bill.planId} onChange={(v) => setBill({ ...bill, planId: v })} options={[{ id: "", label: "Choose…" }, ...db.plans.filter((p) => p.price > 0 && p.type === paidTenants.find((t) => t.id === bill.tenantId)?.type).map((p) => ({ id: p.id, label: `${p.name} · ${rs(p.price)} a month` }))]} /></Field>
          <Field label="Months"><Select value={bill.months} onChange={(v) => setBill({ ...bill, months: Number(v) })} options={[1, 3, 6, 12].map((m) => ({ id: m, label: `${m} month${m > 1 ? "s" : ""}` }))} /></Field>
        </div>}
      </Drawer>
    </>
  );
}

function BillingSettings() {
  const toast = useToast();
  const billing = useApi("/admin/settings/billing");
  const pays = useApi("/admin/settings/payments");
  const [b, setB] = useState(null);
  const [g, setG] = useState(null);
  useEffect(() => { if (billing.data) setB({ ...billing.data, reminderDays: billing.data.reminderDays.join(", ") }); }, [billing.data]);
  useEffect(() => { if (pays.data) setG(structuredClone(pays.data)); }, [pays.data]);
  const saveBilling = () => adminApi("PUT", "/admin/settings/billing", { vatRate: Number(b.vatRate), graceDays: Number(b.graceDays), reminderDays: String(b.reminderDays).split(",").map((x) => Number(x.trim())).filter((x) => x > 0), bank: b.bank })
    .then((r) => { toast(r.message); billing.reload(); }).catch((e) => toast(e.message));
  const saveGateways = () => {
    const pick = (k, extra = []) => ({ enabled: !!g[k].enabled, mode: g[k].mode, secretKey: g[k].secretKey || undefined, ...Object.fromEntries(extra.map((x) => [x, g[k][x] || undefined])) });
    adminApi("PUT", "/admin/settings/payments", { esewa: pick("esewa", ["productCode"]), khalti: pick("khalti"), fonepay: pick("fonepay", ["merchantCode"]), manual: { enabled: !!g.manual.enabled } })
      .then((r) => { toast(r.message); pays.reload(); }).catch((e) => toast(e.message));
  };
  const setK = (k, patch) => setG((x) => ({ ...x, [k]: { ...x[k], ...patch } }));
  const gateway = (k, name, codeKey, codeLabel) => g && (
    <div className="pf-gateway" key={k}>
      <ToggleRow title={name} sub={g[k].hasSecret ? "Key saved" : "No key saved yet"} checked={!!g[k].enabled} onChange={(v) => setK(k, { enabled: v })} />
      <div className="pf-grid-2 tight">
        <Field label="Mode"><Select value={g[k].mode} onChange={(v) => setK(k, { mode: v })} options={[{ id: "test", label: "Test" }, { id: "live", label: "Live" }]} /></Field>
        {codeKey && <Field label={codeLabel}><Input value={g[k][codeKey] || ""} onChange={(e) => setK(k, { [codeKey]: e.target.value })} /></Field>}
      </div>
      <Field label="Secret key" hint={g[k].hasSecret ? "Leave empty to keep the saved key. It's stored encrypted and never shown." : "From the provider's merchant dashboard."}>
        <Input type="password" autoComplete="new-password" value={g[k].secretKey || ""} onChange={(e) => setK(k, { secretKey: e.target.value })} /></Field>
    </div>
  );
  return (
    <div className="pf-split">
      <Panel title="Payment methods" className="grow" sub="Only the super admin can change keys." pad>
        {!g ? <p className="muted">Loading…</p> : <div className="pf-stack">
          {g.testMerchant && <p className="small muted" style={{ margin: 0 }}>Not in production: eSewa's public test merchant (EPAYTEST) works until real keys are saved.</p>}
          {gateway("esewa", "eSewa", "productCode", "Merchant (product) code")}
          {gateway("khalti", "Khalti")}
          {gateway("fonepay", "Fonepay", "merchantCode", "Merchant code")}
          <ToggleRow title="Bank transfer" sub="Businesses upload a receipt; you confirm it under Payments." checked={!!g.manual.enabled} onChange={(v) => setG((x) => ({ ...x, manual: { enabled: v } }))} />
          <Button onClick={saveGateways}>Save payment methods</Button>
        </div>}
      </Panel>
      <Panel title="Billing" className="side" pad>
        {!b ? <p className="muted">Loading…</p> : <div className="pf-stack">
          <Field label="VAT (%)" hint="Plan prices include VAT; invoices show it separately."><Input className="input tnum" value={b.vatRate} onChange={(e) => setB({ ...b, vatRate: e.target.value })} /></Field>
          <Field label="Grace period (days)" hint="After a plan ends unpaid, everything keeps working this long, then it moves to Starter."><Input className="input tnum" value={b.graceDays} onChange={(e) => setB({ ...b, graceDays: e.target.value })} /></Field>
          <Field label="Reminders (days before)"><Input value={b.reminderDays} onChange={(e) => setB({ ...b, reminderDays: e.target.value })} /></Field>
          <Field label="Bank"><Input value={b.bank.name || ""} onChange={(e) => setB({ ...b, bank: { ...b.bank, name: e.target.value } })} /></Field>
          <Field label="Account name"><Input value={b.bank.accountName || ""} onChange={(e) => setB({ ...b, bank: { ...b.bank, accountName: e.target.value } })} /></Field>
          <Field label="Account number"><Input className="input tnum" value={b.bank.account || ""} onChange={(e) => setB({ ...b, bank: { ...b.bank, account: e.target.value } })} /></Field>
          <Field label="Note for payers"><Textarea rows={2} value={b.bank.note || ""} onChange={(e) => setB({ ...b, bank: { ...b.bank, note: e.target.value } })} /></Field>
          <Button onClick={saveBilling}>Save billing</Button>
        </div>}
      </Panel>
    </div>
  );
}
