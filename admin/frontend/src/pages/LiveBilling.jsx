// Billing on the admin API: revenue, payments (bank transfers to confirm, refunds), invoices, payouts to businesses,
// and gateway and billing settings.
// Rules: payment keys are write-only: a saved key is never shown again.

import React, { useEffect, useState } from "react";
import { useStore } from "@sheetal/shared/core/store";
import { fdate, fdatetime, rs } from "@sheetal/shared/core/format";
import { Badge, Button, Drawer, Empty, Field, Input, Panel, Select, Stat, Table, Tabs, Textarea, ToggleRow, useToast } from "@sheetal/shared/core/ui";
import { adminApi } from "../api";

const API_FILES = (import.meta.env.VITE_ADMIN_API_URL || "").replace(/\/v1\/?$/, "");
const PROVIDER = { esewa: "eSewa", khalti: "Khalti", fonepay: "Fonepay", manual: "Bank transfer" };
const STATUS_TONE = { paid: "done", pending_review: "action", failed: "problem", refunded: "neutral", open: "action", void: "neutral" };
const STATUS_WORD = { paid: "Paid", pending_review: "To check", failed: "Failed", refunded: "Refunded", initiated: "Started", open: "To pay", void: "Cancelled" };

// An invoice from the Marketplace (apps) has no plan; show that in words instead of crashing.
export const planWord = (planId) => (planId ? planId.split("-").pop() : "apps");

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
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "payments", label: "Payments", icon: "wallet", count: s?.toCheck || undefined }, { id: "invoices", label: "Invoices", icon: "receipt" }, { id: "payouts", label: "Payouts", icon: "hand-coins" }, { id: "rent", label: "Rent payments", icon: "key-round" }, { id: "settings", label: "Settings", icon: "settings" }]} />

      {tab === "payments" && <section className="card pf-panel">
        <div className="pf-toolbar"><Select value={show} onChange={setShow} style={{ width: 220 }} aria-label="Show" options={[["pending_review", "Bank transfers to check"], ["paid", "Paid"], ["failed", "Failed"], ["refunded", "Refunded"], ["all", "All"]].map(([id, label]) => ({ id, label }))} /></div>
        {!payments.data ? <p className="muted pf-pad">Loading…</p> : <Table rows={payments.data} minWidth={820} empty={<Empty icon="circle-check" title="Nothing here" />} columns={[
          { key: "t", label: "Business", render: (r) => <span className="pf-two"><b>{r.tenant?.name || "—"}</b><small className="tnum">{r.invoice.number} · {planWord(r.invoice.planId)} · {r.invoice.months} mo</small></span> },
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
          { key: "p", label: "Plan", render: (r) => `${r.planId || "App purchase"} · ${r.months} mo` },
          { key: "a", label: "Total (VAT)", num: true, align: "right", render: (r) => <span className="pf-two" style={{ alignItems: "flex-end" }}><b>{rs(r.total)}</b><small className="muted">VAT {rs(r.vat)}</small></span> },
          { key: "s", label: "Status", render: (r) => <Badge tone={STATUS_TONE[r.status]}>{STATUS_WORD[r.status]}</Badge> },
          { key: "d", label: "Due / paid", num: true, render: (r) => fdate(r.paidAt || r.dueAt) },
          { key: "x", label: "", align: "right", render: (r) => r.status === "open" && <Button size="sm" variant="ghost" onClick={() => window.confirm(`Cancel ${r.number}?`) && adminApi("POST", `/admin/billing/invoices/${r.id}/void`).then((x) => { toast(x.message); invoices.reload(); }).catch((e) => toast(e.message))}>Cancel</Button> },
        ]} />}
      </Panel>}

      {tab === "payouts" && <PayoutsPanel />}

      {tab === "rent" && <RentPaymentsPanel />}

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

/** Rent tenants paid online: payments made to Sheetal Property are checked and confirmed here (then they are paid out to
 *  the business with its payout); payments made to a business's own account can be seen and confirmed too. */
function RentPaymentsPanel() {
  const toast = useToast();
  const [status, setStatus] = useState("pending");
  const [to, setTo] = useState("sheetal");
  const list = useApi(`/admin/rent-payments?status=${status}&to=${to}`);
  const say = (r) => { toast(r.message); list.reload(); };
  const proof = (p) => adminApi("GET", `/admin/rent-payments/${p.id}/proof`).then((r) => {
    const bin = atob(r.data.data); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    window.open(URL.createObjectURL(new Blob([bytes], { type: r.data.type })), "_blank", "noopener");
  }).catch((e) => toast(e.message));
  const reject = (p) => { const note = window.prompt(`Why can't ${p.bill} (${rs(p.amount)}) be confirmed? The tenant sees this.`); if (note?.trim()) adminApi("POST", `/admin/rent-payments/${p.id}/reject`, { note: note.trim() }).then(say).catch((e) => toast(e.message)); };
  const confirm = (p) => window.confirm(`Confirm ${rs(p.amount)} from ${p.renter} for ${p.bill}? Check the money is in the account first.`) && adminApi("POST", `/admin/rent-payments/${p.id}/confirm`).then(say).catch((e) => toast(e.message));
  return (
    <Panel title="Rent payments" sub="Rent tenants paid online. Check the money arrived, then confirm. Payments to Sheetal are paid out to the business with its next payout.">
      <div className="pf-toolbar">
        <Select value={status} onChange={setStatus} style={{ width: 180 }} aria-label="Show" options={[["pending", "To check"], ["confirmed", "Confirmed"], ["rejected", "Rejected"], ["all", "All"]].map(([id, label]) => ({ id, label }))} />
        <Select value={to} onChange={setTo} style={{ width: 220 }} aria-label="Paid to" options={[["sheetal", "Paid to Sheetal"], ["business", "Paid to the business"], ["all", "Paid to anyone"]].map(([id, label]) => ({ id, label }))} />
      </div>
      {!list.data ? <p className="muted pf-pad">Loading…</p> : <Table rows={list.data} minWidth={980} empty={<Empty icon="circle-check" title="Nothing here" />} columns={[
        { key: "t", label: "Tenant", render: (r) => <span className="pf-two"><b>{r.renter}</b><small>{r.tenant} · {r.unit}</small></span> },
        { key: "b", label: "Bill", render: (r) => <span className="pf-two"><b className="tnum">{r.bill}</b><small>{r.month} · {r.lease}</small></span> },
        { key: "m", label: "Paid by", render: (r) => <span className="pf-two"><b>{r.method}</b><small className="tnum">{r.ref}{r.to === "business" ? " · to the business" : ""}</small></span> },
        { key: "a", label: "Amount", num: true, align: "right", render: (r) => rs(r.amount) },
        { key: "d", label: "Paid on", num: true, render: (r) => fdate(r.paidOn) },
        { key: "s", label: "Status", render: (r) => <span className="pf-two"><Badge tone={{ pending: "action", confirmed: "done", rejected: "problem" }[r.status]}>{{ pending: "To check", confirmed: "Confirmed", rejected: "Rejected" }[r.status]}</Badge>{r.note && <small className="muted">{r.note}</small>}</span> },
        { key: "x", label: "", align: "right", render: (r) => <div className="pf-row-actions" style={{ justifyContent: "flex-end" }}>
          {r.hasProof && <Button size="sm" variant="ghost" icon="image" onClick={() => proof(r)}>Screenshot</Button>}
          {r.status === "pending" && <><Button size="sm" variant="outline" onClick={() => reject(r)}>Reject</Button><Button size="sm" icon="check" onClick={() => confirm(r)}>Confirm</Button></>}
        </div> },
      ]} />}
    </Panel>
  );
}

/** Payouts to businesses: what is waiting, run the payouts, mark them paid or failed, enter a settlement by hand. */
function PayoutsPanel() {
  const toast = useToast();
  const { db } = useStore();
  const [show, setShow] = useState("pending");
  const list = useApi(`/admin/payouts?status=${show}`);
  const [manual, setManual] = useState(null);
  const [waitingFor, setWaitingFor] = useState(null);
  useEffect(() => {
    if (!manual?.tenantId) { setWaitingFor(null); return; }
    let gone = false;
    adminApi("GET", `/admin/payouts/waiting/${manual.tenantId}`).then((r) => { if (gone) return; setWaitingFor(r.data); setManual((m) => m && { ...m, settleWaiting: r.data.net > 0 }); }).catch(() => !gone && setWaitingFor(null));
    return () => { gone = true; };
  }, [manual?.tenantId]);
  const canRecord = manual && manual.tenantId && manual.note.trim() && (manual.settleWaiting ? waitingFor?.net > 0 : Number(manual.gross) > 0);
  const record = () => adminApi("POST", "/admin/payouts/manual", { tenantId: manual.tenantId, settleWaiting: !!manual.settleWaiting, ...(manual.settleWaiting ? {} : { gross: Number(manual.gross), fee: Number(manual.fee) || 0 }), paidOn: manual.paidOn, bankRef: manual.bankRef.trim() || null, note: manual.note.trim() }).then((r) => { say(r); setManual(null); }).catch((e) => toast(e.message));
  const s = list.data?.summary;
  const say = (r) => { toast(r.message); list.reload(); };
  const run = () => adminApi("POST", "/admin/payouts/run").then((r) => { say(r); (r.data.skipped || []).forEach((k) => toast(`${k.tenant}: ${k.reason}`)); }).catch((e) => toast(e.message));
  const paid = (p) => { const ref = window.prompt(`Bank reference for ${p.no} (the transfer you sent). Leave empty if there is none.`); if (ref !== null) adminApi("POST", `/admin/payouts/${p.id}/paid`, { bankRef: ref.trim() || undefined }).then(say).catch((e) => toast(e.message)); };
  const failed = (p) => { const reason = window.prompt(`Why did ${p.no} fail? The business gets this, and the money goes back to waiting.`); if (reason?.trim()) adminApi("POST", `/admin/payouts/${p.id}/fail`, { reason: reason.trim() }).then(say).catch((e) => toast(e.message)); };
  const day = (d) => (d ? d[0].toUpperCase() + d.slice(1) : "");
  return (
    <>
      <div className="pf-stats">
        <Stat label="Waiting to be paid out" value={s ? rs(s.waiting.net) : "—"} note={s ? `${s.waiting.count} payments · ${s.waiting.businesses} businesses` : ""} />
        <Stat label="Pending transfers" value={s ? rs(s.pending.net) : "—"} note={s ? `${s.pending.count} to send from the bank` : ""} tone={s?.pending.count ? "action" : undefined} />
        <Stat label="Paid this month" value={s ? rs(s.paidThisMonth.net) : "—"} note={s ? `Commission kept ${rs(s.paidThisMonth.fee)}` : ""} />
        <Stat label="Next run" value={s ? fdate(s.schedule.nextOn) : "—"} note={s ? `${day(s.schedule.day)}s · money held ${s.schedule.holdDays} days` : ""} />
      </div>
      <Panel title="Payouts" sub="Make the payouts, send the transfers from the bank, then mark each one paid." actions={<><Button variant="outline" icon="plus" onClick={() => setManual({ tenantId: "", settleWaiting: false, gross: "", fee: "0", paidOn: new Date().toISOString().slice(0, 10), bankRef: "", note: "" })}>Manual payout</Button><Button icon="wallet" onClick={() => window.confirm("Make payouts from all waiting money that is past the hold days?") && run()}>Run payouts</Button></>}>
        <div className="pf-toolbar"><Select value={show} onChange={setShow} style={{ width: 200 }} aria-label="Show" options={[["pending", "To send"], ["paid", "Paid"], ["failed", "Failed"], ["all", "All"]].map(([id, label]) => ({ id, label }))} /></div>
        {!list.data ? <p className="muted pf-pad">Loading…</p> : <Table rows={list.data.rows} minWidth={860} empty={<Empty icon="wallet" title="No payouts here" />} columns={[
          { key: "p", label: "Payout", render: (r) => <span className="pf-two"><b className="tnum">{r.no}</b><small>{r.kind === "manual" ? "Manual" : "Run"} · {fdate(r.scheduledOn)}</small></span> },
          { key: "t", label: "Business", render: (r) => <span className="pf-two"><b>{r.tenant}</b><small>{r.branch}</small></span> },
          { key: "b", label: "Send to", render: (r) => <span className="pf-two"><b>{r.bank.bank || "—"}</b><small className="tnum">{r.bank.holder}{r.bank.account ? ` · ${r.bank.account}` : ""}</small></span> },
          { key: "a", label: "Amount", num: true, align: "right", render: (r) => <span className="pf-two" style={{ alignItems: "flex-end" }}><b>{rs(r.net)}</b><small className="muted">{rs(r.gross)} − {rs(r.fee)}</small></span> },
          { key: "s", label: "Status", render: (r) => <span className="pf-two"><Badge tone={{ pending: "action", paid: "done", failed: "problem" }[r.status]}>{{ pending: "To send", paid: "Paid", failed: "Failed" }[r.status]}</Badge>{(r.failReason || r.bankRef || r.note) && <small className="muted">{r.failReason || (r.bankRef ? `Ref ${r.bankRef}` : r.note)}</small>}</span> },
          { key: "x", label: "", align: "right", render: (r) => r.status === "pending" && <div className="pf-row-actions" style={{ justifyContent: "flex-end" }}><Button size="sm" variant="outline" onClick={() => failed(r)}>Failed…</Button><Button size="sm" icon="check" onClick={() => paid(r)}>Mark paid</Button></div> },
        ]} />}
      </Panel>
      <Drawer open={!!manual} onClose={() => setManual(null)} title="Manual payout" footer={manual && <><Button variant="ghost" onClick={() => setManual(null)}>Cancel</Button><Button disabled={!canRecord} onClick={record}>Record payout</Button></>}>
        {manual && <div className="pf-stack">
          <p className="small muted" style={{ margin: 0 }}>For a settlement you already paid outside the run. It is recorded as paid and the business is told.</p>
          <Field label="Business"><Select value={manual.tenantId} onChange={(v) => setManual({ ...manual, tenantId: v, settleWaiting: false })} options={[{ id: "", label: "Choose…" }, ...db.tenants.map((t) => ({ id: t.id, label: t.name }))]} /></Field>
          {waitingFor && (waitingFor.net > 0
            ? <ToggleRow title={`Pay out the waiting money: ${rs(waitingFor.net)}`} sub={`${waitingFor.count} payments, ${rs(waitingFor.gross)} less ${rs(waitingFor.fee)} commission. The next run won't pay it again.`} checked={!!manual.settleWaiting} onChange={(v) => setManual({ ...manual, settleWaiting: v })} />
            : <p className="small muted" style={{ margin: 0 }}>Nothing is waiting for this business. Enter the amount you paid.</p>)}
          {!manual.settleWaiting && <div className="pf-grid-2 tight">
            <Field label="Amount collected (Rs.)"><Input className="input tnum" inputMode="numeric" value={manual.gross} onChange={(e) => setManual({ ...manual, gross: e.target.value.replace(/\D/g, "") })} /></Field>
            <Field label="Commission (Rs.)"><Input className="input tnum" inputMode="numeric" value={manual.fee} onChange={(e) => setManual({ ...manual, fee: e.target.value.replace(/\D/g, "") })} /></Field>
          </div>}
          <div className="pf-grid-2 tight">
            <Field label="Paid on"><Input type="date" value={manual.paidOn} onChange={(e) => setManual({ ...manual, paidOn: e.target.value })} /></Field>
            <Field label="Bank reference" optional><Input value={manual.bankRef} onChange={(e) => setManual({ ...manual, bankRef: e.target.value })} /></Field>
          </div>
          <Field label="What is it for?"><Input value={manual.note} onChange={(e) => setManual({ ...manual, note: e.target.value })} placeholder="October site settlement" /></Field>
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
    <>
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
    <PayoutSettings />
    </>
  );
}

/** Commission by business type, the payout weekday and the hold days. Only the super admin can change them. */
function PayoutSettings() {
  const toast = useToast();
  const cfg = useApi("/admin/settings/payouts");
  const [p, setP] = useState(null);
  useEffect(() => { if (cfg.data) { const { canEdit, commission, day, holdDays } = cfg.data; setP({ canEdit, day, holdDays: String(holdDays), commission: Object.fromEntries(Object.entries(commission).map(([k, v]) => [k, String(v)])) }); } }, [cfg.data]);
  const save = () => adminApi("PUT", "/admin/settings/payouts", { commission: Object.fromEntries(Object.entries(p.commission).map(([k, v]) => [k, Number(v)])), day: p.day, holdDays: Number(p.holdDays) })
    .then((r) => { toast(r.message); cfg.reload(); }).catch((e) => toast(e.message));
  const rate = (k, label) => <Field label={label}><Input className="input tnum" inputMode="decimal" disabled={!p.canEdit} value={p.commission[k]} onChange={(e) => setP({ ...p, commission: { ...p.commission, [k]: e.target.value.replace(/[^\d.]/g, "") } })} /></Field>;
  return (
    <Panel title="Payouts" sub={p && !p.canEdit ? "Only the super admin can change these." : "What Sheetal keeps from money it collects for a business, and when it pays the rest out."} pad>
      {!p ? <p className="muted">Loading…</p> : <div className="pf-stack">
        <div className="pf-grid-2 tight">
          {rate("stays", "Commission: hotels and hosts (%)")}
          {rate("projects", "Commission: developers (%)")}
          {rate("agency", "Commission: agencies (%)")}
          {rate("investments", "Commission: sponsors (%)")}
        </div>
        <div className="pf-grid-2 tight">
          <Field label="Payout day"><Select value={p.day} disabled={!p.canEdit} onChange={(v) => setP({ ...p, day: v })} options={["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].map((d) => ({ id: d, label: d[0].toUpperCase() + d.slice(1) }))} /></Field>
          <Field label="Hold days" hint="Money collected in the last N days waits, so refunds settle first."><Input className="input tnum" inputMode="numeric" disabled={!p.canEdit} value={p.holdDays} onChange={(e) => setP({ ...p, holdDays: e.target.value.replace(/\D/g, "") })} /></Field>
        </div>
        <p className="small muted" style={{ margin: 0 }}>A new commission applies to money collected from now on; money already collected keeps its old one.</p>
        {p.canEdit && <Button onClick={save}>Save payout settings</Button>}
      </div>}
    </Panel>
  );
}
