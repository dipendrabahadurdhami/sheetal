import React, { useCallback, useEffect, useState } from "react";
import { useStore } from "@sheetal/shared/core/store";
import { fdate, rs } from "@sheetal/shared/core/format";
import { Badge, Button, Drawer, Empty, Field, Input, PageHead, Panel, Seg, StatusBadge, Table, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { planFeatureList } from "@sheetal/shared/core/plans";
import { config } from "@sheetal/shared/core/config";
import { bizApi, fileToBase64 } from "../api";
import { workRefresh, workspacesReload } from "../live";

// Billing on the business API: the plan, paying by eSewa, Khalti, Fonepay or bank transfer, and invoices.
// Gateways send the payer back to /business/billing/return/<provider>/<payment> (BillingReturn below).

const PERIOD_LABEL = { 1: "1 month", 3: "3 months", 6: "6 months", 12: "1 year" };
const METHOD_ICON = { esewa: "wallet", khalti: "wallet", fonepay: "qr-code", manual: "landmark" };

/** Sends the browser to the gateway: posts eSewa's form, or follows the redirect. */
function goToGateway(c) {
  if (c.method === "form") {
    const f = document.createElement("form");
    f.method = "POST"; f.action = c.action;
    for (const [k, v] of Object.entries(c.fields)) { const i = document.createElement("input"); i.type = "hidden"; i.name = k; i.value = v; f.appendChild(i); }
    document.body.appendChild(f); f.submit();
  } else if (c.method === "redirect") window.location.assign(c.url);
}

export function LiveBilling({ tenant, canManage }) {
  const toast = useToast();
  const { db } = useStore();
  const [data, setData] = useState(null);
  const [months, setMonths] = useState(12);
  const [pay, setPay] = useState(null); // { planId, months, invoiceId, label, total }
  const [manual, setManual] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => bizApi("GET", "/billing").then((r) => setData(r.data)).catch((e) => toast(e.message)), []);
  useEffect(() => { load(); }, [load, tenant.id]);

  if (!data) return <p className="muted pf-pad">Loading billing…</p>;
  const cur = data.plan;
  const openInvoices = data.invoices.filter((i) => i.status === "open");
  const start = (method) => {
    setBusy(true);
    const body = pay.invoiceId ? { provider: method, invoiceId: pay.invoiceId } : { provider: method, planId: pay.planId, months: pay.months };
    bizApi("POST", "/billing/checkout", body).then((r) => {
      if (r.data.method === "manual") { setManual({ ...r.data, label: pay.label }); setPay(null); setBusy(false); return; }
      goToGateway(r.data);
    }).catch((e) => { toast(e.message); setBusy(false); });
  };
  const fullPlan = (id) => db.plans.find((p) => p.id === id) || {};

  return (
    <>
      <PageHead title="Plan and billing" sub="Your plan, payments and invoices. Prices include 13% VAT." />
      {tenant.status === "past_due" || data.status === "past_due" ? (
        <div className="pf-alert action"><Icon name="circle-alert" size={18} /><div><b>Your plan payment is due</b><span>Everything keeps working until {fdate(data.graceUntil)}. After that, {tenant.name} moves to the free Starter plan.</span></div>
          {openInvoices[0] && canManage && <Button size="sm" icon="credit-card" onClick={() => setPay({ invoiceId: openInvoices[0].id, label: `${openInvoices[0].number} · ${openInvoices[0].plan}`, total: openInvoices[0].total })}>Pay now</Button>}</div>
      ) : openInvoices[0] && canManage ? (
        <div className="pf-alert progress"><Icon name="receipt" size={18} /><div><b>Invoice {openInvoices[0].number} is ready</b><span>{openInvoices[0].plan} for {PERIOD_LABEL[openInvoices[0].months]}: {rs(openInvoices[0].total)}, due {fdate(openInvoices[0].dueAt)}.</span></div>
          <Button size="sm" icon="credit-card" onClick={() => setPay({ invoiceId: openInvoices[0].id, label: `${openInvoices[0].number} · ${openInvoices[0].plan}`, total: openInvoices[0].total })}>Pay</Button></div>
      ) : null}
      {data.coveredBy && <div className="pf-alert done"><Icon name="badge-check" size={18} /><div><b>Covered by {data.coveredBy.name}'s Pro plan</b><span>{tenant.name} has Pro with no bill of its own, as long as {data.coveredBy.name} stays on Pro{data.coveredBy.renewsAt ? ` (paid until ${fdate(data.coveredBy.renewsAt)})` : ""}. Renew from {data.coveredBy.name}'s billing page.</span></div></div>}
      {data.canCover && canManage && <div className="pf-alert action"><Icon name="layers" size={18} /><div><b>Include in your Pro plan</b><span>{data.canCover.name} is on Pro. Put {tenant.name} on Pro too, with no extra bill.</span></div>
        <Button size="sm" icon="badge-check" disabled={busy} onClick={() => { setBusy(true); bizApi("POST", "/workspace/cover", { on: true }).then((r) => { toast(r.message); load(); workspacesReload(); }).catch((e) => toast(e.message)).finally(() => setBusy(false)); }}>Include in my Pro plan</Button></div>}
      {data.pendingProofs.length > 0 && <div className="pf-alert progress"><Icon name="clock" size={18} /><div><b>Bank transfer being checked</b><span>Sheetal confirms transfers within a working day; your plan starts then.</span></div></div>}

      <Panel title="Your plan" pad>
        <dl className="pf-kv">
          <dt>Plan</dt><dd><b>{cur.name}</b> {cur.price ? `· ${rs(cur.price)} a month` : "· free"}</dd>
          <dt>Status</dt><dd><StatusBadge status={data.status} /></dd>
          {cur.price > 0 && <><dt>Paid until</dt><dd className="tnum">{fdate(data.renewsAt)}</dd>
            <dt>Renewal</dt><dd>{data.autoRenew ? "A renewal invoice is sent 7 days before; pay it to continue." : "We remind you 7 days and 1 day before; pay the renewal invoice to continue."}</dd></>}
        </dl>
      </Panel>

      <section className="card pf-panel">
        <div className="pf-panel-head"><div className="pf-panel-title"><h2>Plans</h2><span>Paying for the same plan adds the time after your current period. A new plan starts when it's paid.</span></div>
          <div className="pf-panel-actions"><Seg value={months} onChange={setMonths} label="Billing period" options={[1, 3, 6, 12].map((m) => { const save = data.plans[0]?.periods.find((p) => p.months === m)?.save; return { id: m, label: PERIOD_LABEL[m] + (save ? ` · save ${save}%` : "") }; })} /></div></div>
        <div className="pf-plan-grid pf-pad">
          {data.plans.map((p) => {
            const isCur = p.id === cur.id;
            const total = p.periods.find((x) => x.months === months)?.total ?? 0;
            return (
              <div key={p.id} className={`card pf-plan ${isCur ? "cur" : ""}`}>
                <div className="pf-plan-top"><h3>{p.name}</h3>{isCur && <Badge tone="done">Your plan</Badge>}</div>
                <div className="pf-price-line"><b className="tnum">{p.price ? rs(total) : "Free"}</b><span>{p.price ? `for ${PERIOD_LABEL[months]}` : "always"}</span></div>
                <ul className="pf-plan-feats">{planFeatureList(fullPlan(p.id), tenant.type, db.aiConfig?.credits).map(([on, text]) => <li key={text} className={on ? "" : "off"}><Icon name={on ? "check" : "minus"} size={15} />{text}</li>)}</ul>
                <div className="pf-plan-foot">{canManage && p.price > 0 && <Button block variant={isCur ? "outline" : "primary"} onClick={() => setPay({ planId: p.id, months, label: `${p.name} · ${PERIOD_LABEL[months]}`, total })}>{isCur ? "Renew" : "Choose"} · {rs(total)}</Button>}
                  {!p.price && !isCur && <span className="small muted">If you don't renew, your business moves here after the grace period. Listings stay.</span>}</div>
              </div>
            );
          })}
        </div>
      </section>

      <Panel title="Invoices">
        <Table rows={data.invoices} minWidth={620} empty={<Empty icon="receipt" title="No invoices yet" />} columns={[
          { key: "n", label: "Invoice", render: (r) => <span className="pf-two"><b className="tnum">{r.number}</b><small>{r.plan} · {PERIOD_LABEL[r.months]}</small></span> },
          { key: "d", label: "Date", num: true, render: (r) => fdate(r.issuedAt) },
          { key: "a", label: "Amount", num: true, align: "right", render: (r) => rs(r.total) },
          { key: "s", label: "Status", render: (r) => <Badge tone={r.status === "paid" ? "done" : r.status === "open" ? "action" : "neutral"}>{r.status === "paid" ? "Paid" : r.status === "open" ? "To pay" : "Cancelled"}</Badge> },
          { key: "x", label: "", align: "right", render: (r) => <div className="pf-row-actions" style={{ justifyContent: "flex-end" }}>
            {r.status === "open" && canManage && <Button size="sm" onClick={() => setPay({ invoiceId: r.id, label: `${r.number} · ${r.plan}`, total: r.total })}>Pay</Button>}
            <Button size="sm" variant="ghost" icon="printer" onClick={() => printInvoice(r.id, toast)}>View</Button></div> },
        ]} />
      </Panel>

      <Drawer open={!!pay} onClose={() => !busy && setPay(null)} title="How do you want to pay?" sub={pay ? `${pay.label} · ${rs(pay.total)}` : ""}>
        {pay && <div className="pf-stack">
          {data.methods.map((m) => (
            <button key={m.id} type="button" className="pf-choice" disabled={busy} onClick={() => start(m.id)}>
              <Icon name={METHOD_ICON[m.id] || "credit-card"} size={20} /><span className="pf-two" style={{ flex: 1 }}><b>{m.name}{m.test ? " (test mode)" : ""}</b>
                <small>{m.id === "manual" ? "Pay into Sheetal's bank account and upload the receipt." : `You'll go to ${m.name} to pay, then come back here.`}</small></span><Icon name="arrow-right" size={16} />
            </button>
          ))}
          {!data.methods.length && <Empty icon="wallet" title="No way to pay is set up yet">Please contact Sheetal support.</Empty>}
          <p className="small muted" style={{ margin: 0 }}>Sheetal never sees your card, wallet or bank login. Each payment is checked with the provider before your plan changes.</p>
        </div>}
      </Drawer>
      <ManualProof manual={manual} bank={data.bank} onClose={() => setManual(null)} onSent={() => { setManual(null); load(); }} />
    </>
  );
}

function ManualProof({ manual, bank, onClose, onSent }) {
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try { const r = await bizApi("POST", `/billing/payments/${manual.paymentId}/proof`, { data: await fileToBase64(file), reference: ref || undefined }); toast(r.message); onSent(); }
    catch (e) { toast(e.message); } finally { setBusy(false); }
  };
  return (
    <Drawer open={!!manual} onClose={onClose} title="Pay by bank transfer" sub={manual ? `${manual.label} · ${rs(manual.amount)}` : ""}
      footer={manual && <><Button variant="ghost" onClick={onClose}>Later</Button><Button icon="upload" disabled={!file || busy} onClick={send}>{busy ? "Sending…" : "Send receipt"}</Button></>}>
      {manual && <div className="pf-stack">
        {bank?.account ? <dl className="pf-kv"><dt>Bank</dt><dd>{bank.name}</dd><dt>Account name</dt><dd>{bank.accountName}</dd><dt>Account no.</dt><dd className="tnum">{bank.account}</dd><dt>Amount</dt><dd className="tnum"><b>{rs(manual.amount)}</b></dd><dt>Write in remarks</dt><dd className="tnum"><b>{manual.reference}</b></dd></dl>
          : <p className="muted">Sheetal's bank details aren't set up yet. Please contact support.</p>}
        {bank?.note && <p className="small muted">{bank.note}</p>}
        <Field label="Receipt or screenshot"><input type="file" accept="image/*" onChange={(e) => setFile(e.target.files[0] || null)} /></Field>
        <Field label="Bank reference (optional)"><Input value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
      </div>}
    </Drawer>
  );
}

/** Opens a printable invoice (Print → Save as PDF). */
async function printInvoice(id, toast) {
  try {
    const { data: i } = await bizApi("GET", `/billing/invoices/${id}`);
    const w = window.open("", "_blank");
    if (!w) return toast("Allow pop-ups to view the invoice.");
    const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const money = (n) => `Rs. ${Number(n).toLocaleString("en-IN")}`;
    const b = i.billedTo || {};
    w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(i.number)}</title><style>body{font:14px/1.5 system-ui,sans-serif;max-width:720px;margin:40px auto;color:#111}h1{font-size:22px;margin:0}table{width:100%;border-collapse:collapse;margin:24px 0}td,th{padding:8px;border-bottom:1px solid #ddd;text-align:left}td:last-child,th:last-child{text-align:right}.muted{color:#666}.tot td{font-weight:700}@media print{button{display:none}}</style>
      <img src="${esc(config.logo)}" alt="Sheetal Property" style="height:34px"><h1>Tax invoice ${esc(i.number)}</h1><p class="muted">Issued ${esc(fdate(i.issuedAt))}${i.paidAt ? ` · Paid ${esc(fdate(i.paidAt))}` : ` · Due ${esc(fdate(i.dueAt))}`}</p>
      <p><b>Billed to</b><br>${esc(b.name)}${b.pan ? `<br>PAN ${esc(b.pan)}` : ""}${b.city ? `<br>${esc(b.city)}` : ""}${b.email ? `<br>${esc(b.email)}` : ""}</p>
      <table><tr><th>Item</th><th>Amount</th></tr><tr><td>${esc(i.plan)} plan, ${esc(PERIOD_LABEL[i.months])}${i.periodStart ? ` (${esc(fdate(i.periodStart))} – ${esc(fdate(i.periodEnd))})` : ""}</td><td>${money(i.subtotal)}</td></tr>
      <tr><td>VAT 13%</td><td>${money(i.vat)}</td></tr><tr class="tot"><td>Total</td><td>${money(i.total)}</td></tr></table>
      ${i.payments.map((p) => `<p class="muted">Paid ${money(p.amount)} by ${esc(p.provider)} on ${esc(fdate(p.paidAt))}${p.providerRef ? `, ref ${esc(p.providerRef)}` : ""}${p.status === "refunded" ? " (refunded)" : ""}</p>`).join("")}
      <p class="muted">${esc(i.seller.name)} · ${esc(i.seller.email)}</p><button onclick="print()">Print or save as PDF</button>`);
    w.document.close();
  } catch (e) { toast(e.message); }
}

/** Where eSewa, Khalti and Fonepay send the payer back: checks the payment, then shows the result. */
export function BillingReturn({ provider, id }) {
  const [state, setState] = useState({ status: "checking", message: "Checking your payment with the provider…" });
  useEffect(() => {
    const q = Object.fromEntries(new URLSearchParams(window.location.search));
    const body = q.failed || q.status === "User canceled" ? { failed: true }
      : provider === "esewa" ? { data: q.data } : provider === "khalti" ? { pidx: q.pidx } : { query: q };
    bizApi("POST", `/billing/payments/${id}/verify`, body)
      .then((r) => { setState({ status: r.data.status, message: r.message }); workRefresh(); })
      .catch((e) => setState({ status: "failed", message: e.message }));
  }, [provider, id]);
  const ok = state.status === "paid";
  return (
    <div className="card pf-pad pf-stack" style={{ maxWidth: 520, margin: "8vh auto", textAlign: "center" }}>
      <Icon name={state.status === "checking" ? "clock" : ok ? "circle-check" : "circle-alert"} size={36} />
      <h1 style={{ fontSize: 22, margin: 0 }}>{state.status === "checking" ? "One moment" : ok ? "Payment received" : "Payment not completed"}</h1>
      <p className="muted" style={{ margin: 0 }}>{state.message}</p>
      {state.status !== "checking" && <a className="btn btn-primary" href="/business/billing">Back to billing</a>}
    </div>
  );
}
