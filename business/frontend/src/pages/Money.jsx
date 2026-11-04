// Customer invoices (drafts, credit notes, receipts, printable PDF) and payouts (sample data, marked Preview).

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { DataActions, exportCSV } from "@sheetal/shared/components/DataIO";
import { DeleteConfirm, useUndo, restoreAt } from "@sheetal/shared/components/Crud";
import { useT } from "@sheetal/shared/core/i18n";
import { useStore } from "@sheetal/shared/core/store";
import { fdate, rs, TODAY } from "@sheetal/shared/core/format";
import { Badge, Button, Drawer, Empty, Field, Input, Modal, PageHead, Seg, Select, Stat, StatusBadge, Table, Tabs, Textarea, ToggleRow, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { defaultTenantSettings } from "./BusinessSettings";
import { Link } from "@sheetal/shared/core/router";
import { Counter } from "./ListingWizard";
import { addDays, invoicesOf, invoiceFromRow, invoiceRow, nextNo, statusOf, totals } from "@sheetal/shared/demo/money";

const DAY = TODAY.slice(0, 10);
const ST = { draft: ["neutral", "Draft", "file-pen"], unpaid: ["progress", "Sent", "send"], partly: ["progress", "Part paid", "clock"], overdue: ["action", "Overdue", "circle-alert"], paid: ["done", "Paid", "check"], credit: ["neutral", "Credit note", "rotate-ccw"], cancelled: ["problem", "Cancelled", "ban"] };
const InvStatus = ({ inv }) => { const [tone, label, icon] = ST[statusOf(inv)]; return <Badge tone={tone} icon={icon}>{label}</Badge>; };
const METHODS = ["Cash", "Fonepay", "eSewa", "Khalti", "Card", "Bank transfer"];
const CANCEL = ["Raised by mistake", "Customer details were wrong", "Booking cancelled before payment", "Duplicate invoice", "Other"];
const QUICK = ["Room night", "Breakfast", "Airport pickup", "Service fee", "Consultation"];

function useMoney(tenant) {
  const { db, update } = useStore();
  const list = invoicesOf(db, tenant.id);
  const set = (fn) => update((d) => { d.money = d.money || {}; d.money[tenant.id] = d.money[tenant.id] || {}; if (!d.money[tenant.id].invoices) d.money[tenant.id].invoices = invoicesOf(d, tenant.id); fn(d.money[tenant.id].invoices); });
  return [list, set];
}

export function Invoices({ tenant }) {
  const t = useT();
  const toast = useToast();
  const undo = useUndo();
  const { db } = useStore();
  const ts = db.tenantSettings[tenant.id] || defaultTenantSettings(tenant);
  const [list, setList] = useMoney(tenant);
  const [tab, setTab] = useState("all");
  const [openId, setOpenId] = useState(null);
  const [edit, setEdit] = useState(null);
  const [pay, setPay] = useState(null);
  const [cancel, setCancel] = useState(null);
  const [credit, setCredit] = useState(null);
  const [del, setDel] = useState(null);
  const [print, setPrint] = useState(null);
  const open = list.find((x) => x.id === openId);
  const live = list.filter((x) => x.status !== "draft" && x.status !== "cancelled");
  const TABS = {
    all: (x) => x.status !== "cancelled", unpaid: (x) => ["unpaid", "partly", "overdue"].includes(statusOf(x)), paid: (x) => statusOf(x) === "paid",
    draft: (x) => x.status === "draft", credit: (x) => x.kind === "credit" && x.status !== "cancelled", cancelled: (x) => x.status === "cancelled",
  };
  const rows = list.filter(TABS[tab]);
  const month = DAY.slice(0, 7);
  const billed = live.filter((x) => x.kind === "invoice" && x.date.startsWith(month)).reduce((s, x) => s + totals(x).total, 0);
  const due = live.filter((x) => x.kind === "invoice").map((x) => totals(x).balance);
  const vat = live.reduce((s, x) => s + totals(x).vat, 0);
  const biz = { name: tenant.name, pan: ts.profile?.pan || tenant.pan, address: ts.profile?.address || `${tenant.city}, Nepal`, phone: ts.profile?.phone || tenant.phone, email: ts.profile?.email || tenant.email };

  const blank = () => ({ id: nextNo(list, "INV-"), kind: "invoice", to: "", phone: "", pan: "", order: "", date: DAY, due: addDays(DAY, 10), vatPct: 13, status: "draft", notes: "", lines: [{ what: "Room night", qty: 1, rate: 6500 }], receipts: [], isNew: true });
  const saveInv = (inv, send) => {
    const { isNew, ...x } = inv;
    setList((l) => { const i = l.findIndex((y) => y.id === x.id); const rec = { ...x, status: send ? "sent" : "draft", ...(send ? { sentOn: DAY } : {}) }; if (i >= 0) l[i] = rec; else l.unshift(rec); });
    setEdit(null); setOpenId(x.id); toast(send ? `${x.id} sent to ${x.to}` : "Draft saved");
  };
  const sendDraft = (inv) => { setList((l) => { Object.assign(l.find((y) => y.id === inv.id), { status: "sent", sentOn: DAY }); }); toast(`${inv.id} sent to ${inv.to}`); };
  const addReceipt = (inv, r) => {
    setList((l) => { const x = l.find((y) => y.id === inv.id); x.receipts = [...(x.receipts || []), { id: nextNo(l.flatMap((y) => y.receipts || []), "RC-"), ...r }]; });
    setPay(null); toast("Payment recorded. Receipt ready to print or send.");
  };
  const doCancel = (inv, reason) => { setList((l) => { Object.assign(l.find((y) => y.id === inv.id), { status: "cancelled", cancelReason: reason, cancelledOn: DAY }); }); setCancel(null); undo(`${inv.id} cancelled`, () => setList((l) => { const x = l.find((y) => y.id === inv.id); x.status = inv.status; delete x.cancelReason; delete x.cancelledOn; })); };
  const doCredit = (inv, lines, reason) => {
    const id = nextNo(list, "CN-");
    setList((l) => { l.unshift({ id, kind: "credit", creditFor: inv.id, reason, to: inv.to, phone: inv.phone, pan: inv.pan, order: inv.order, date: DAY, due: DAY, vatPct: inv.vatPct, status: "sent", lines, receipts: [] }); });
    setCredit(null); setOpenId(id); toast(`Credit note ${id} issued against ${inv.id}`);
  };
  const credited = (inv) => list.filter((x) => x.kind === "credit" && x.creditFor === inv.id && x.status !== "cancelled").reduce((s, x) => s - totals(x).total, 0);

  return (
    <>
      <PageHead title={t("nav.invoices")} sub={t("binv.sub", { pan: biz.pan })} actions={<>
        <DataActions kind="invoices" rows={list.filter((x) => x.kind === "invoice" && x.status !== "cancelled").map(invoiceRow)} onImport={(r) => setList((l) => { r.forEach((x) => l.unshift(invoiceFromRow(x, l))); })} />
        <Button icon="plus" onClick={() => setEdit(blank())}>{t("binv.new")}</Button></>} />
      <div className="pf-stats">
        <Stat label={t("binv.billed")} value={rs(billed)} note={t("binv.thisMonth")} />
        <Stat label={t("binv.toCollect")} value={rs(due.reduce((s, x) => s + x, 0))} note={t("binv.unpaidN", { n: due.filter((x) => x > 0).length })} tone="action" noteIcon="circle-alert" />
        <Stat label={t("binv.vatCollected")} value={rs(vat)} note={t("binv.vatNote")} />
      </div>
      <section className="card pf-panel">
        <div className="pf-pad-x"><Tabs value={tab} onChange={setTab} tabs={[["all", "All"], ["unpaid", "Unpaid"], ["paid", "Paid"], ["draft", "Drafts"], ["credit", "Credit notes"], ["cancelled", "Cancelled"]].map(([id, label]) => ({ id, label, count: list.filter(TABS[id]).length || undefined }))} /></div>
        <Table rows={rows} onRowClick={(r) => setOpenId(r.id)} minWidth={900}
          empty={<Empty icon="receipt" title={tab === "all" ? "No invoices yet" : "Nothing here"} action={tab === "all" ? <Button icon="plus" onClick={() => setEdit(blank())}>{t("binv.new")}</Button> : <Button variant="outline" onClick={() => setTab("all")}>Show all invoices</Button>}>{tab === "all" ? "Create your first invoice. Bookings and POS bills also land here." : "Try another tab."}</Empty>}
          columns={[
            { key: "id", label: t("billing.invoice"), render: (r) => <span className="pf-two"><b className="tnum">{r.id}</b><small className="tnum">{r.kind === "credit" ? `For ${r.creditFor}` : r.order ? <Link to="/business/bookings">{r.order}</Link> : "Manual"}</small></span> },
            { key: "to", label: t("binv.billedTo"), render: (r) => r.to },
            { key: "date", label: t("billing.date"), num: true, render: (r) => fdate(r.date) },
            { key: "due", label: t("pbill.due"), num: true, render: (r) => (r.kind === "credit" ? "—" : fdate(r.due)) },
            { key: "amt", label: t("billing.amount"), num: true, align: "right", render: (r) => rs(totals(r).total) },
            { key: "bal", label: t("pos.balance"), num: true, align: "right", render: (r) => (r.status === "cancelled" ? "—" : rs(totals(r).balance)) },
            { key: "st", label: t("common.status"), render: (r) => <InvStatus inv={r} /> },
            { key: "x", label: "", align: "right", render: (r) => <div className="pf-row-actions" style={{ justifyContent: "flex-end" }} onClick={(e) => e.stopPropagation()}>
              {r.status === "draft" ? <Button variant="ghost" size="sm" icon="pencil" onClick={() => setEdit(structuredClone(r))}>Edit</Button>
                : ["unpaid", "partly", "overdue"].includes(statusOf(r)) && <Button variant="outline" size="sm" icon="link" onClick={() => toast(t("inbox.toastPayLink"))}>{t("binv.payLink")}</Button>}
              <Button variant="ghost" size="sm" icon="download" onClick={() => setPrint({ doc: "invoice", inv: r })}>PDF</Button>
            </div> },
          ]} />
      </section>

      <Drawer open={!!open} onClose={() => setOpenId(null)} title={open && `${open.kind === "credit" ? "Credit note" : "Invoice"} ${open.id}`} sub={open && `${open.to} · ${fdate(open.date)}`}
        footer={open && <>
          {open.status === "draft" && <Button variant="ghost" className="pf-danger pf-foot-left" icon="trash-2" onClick={() => setDel(open)}>Delete</Button>}
          {open.status !== "draft" && open.status !== "cancelled" && totals(open).paid === 0 && <Button variant="ghost" className="pf-danger pf-foot-left" icon="ban" onClick={() => setCancel(open)}>Cancel</Button>}
          <Button variant="outline" icon="printer" onClick={() => setPrint({ doc: "invoice", inv: open })}>Print or PDF</Button>
          {open.status === "draft" && <><Button variant="outline" icon="pencil" onClick={() => setEdit(structuredClone(open))}>Edit</Button><Button icon="send" disabled={!open.to.trim()} onClick={() => sendDraft(open)}>Send</Button></>}
          {open.kind === "invoice" && open.status === "sent" && totals(open).paid > 0 && credited(open) < totals(open).total && <Button variant="outline" icon="rotate-ccw" onClick={() => setCredit(open)}>Credit note</Button>}
          {open.kind === "invoice" && open.status === "sent" && totals(open).balance > 0 && <Button icon="banknote" onClick={() => setPay({ inv: open, amount: String(totals(open).balance), method: "Cash", at: DAY })}>Record payment</Button>}
        </>}>
        {open && <InvoiceSummary inv={open} list={list} onReceipt={(r) => setPrint({ doc: "receipt", inv: open, receipt: r })} onOpen={setOpenId} />}
      </Drawer>

      {edit && <InvoiceEditor inv={edit} onClose={() => setEdit(null)} onSave={saveInv} />}

      <Drawer open={!!pay} onClose={() => setPay(null)} title="Record payment" sub={pay && `${pay.inv.id} · ${pay.inv.to} · balance ${rs(totals(pay.inv).balance)}`}
        footer={pay && <><Button variant="outline" onClick={() => setPay(null)}>{t("common.cancel")}</Button><Button icon="check" disabled={!(Number(pay.amount) > 0) || Number(pay.amount) > totals(pay.inv).balance} onClick={() => addReceipt(pay.inv, { at: pay.at, amount: Number(pay.amount), method: pay.method })}>Save payment</Button></>}>
        {pay && <div className="pf-stack">
          <Field label="Amount" error={Number(pay.amount) > totals(pay.inv).balance ? `More than the balance of ${rs(totals(pay.inv).balance)}` : null}><div className="pf-unit"><span>Rs.</span><input className="input tnum" inputMode="numeric" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value.replace(/\D/g, "") })} /></div></Field>
          <Field label="Paid by"><div className="pf-chips">{METHODS.map((m) => <button key={m} type="button" className={`chip ${pay.method === m ? "active" : ""}`} onClick={() => setPay({ ...pay, method: m })}>{m}</button>)}</div></Field>
          <Field label="Date"><Input type="date" value={pay.at} onChange={(e) => setPay({ ...pay, at: e.target.value })} /></Field>
        </div>}
      </Drawer>

      <CancelModal inv={cancel} onClose={() => setCancel(null)} onConfirm={doCancel} />
      {credit && <CreditDrawer inv={credit} already={credited(credit)} onClose={() => setCredit(null)} onIssue={doCredit} />}
      <DeleteConfirm item={del} name={del?.id} what="draft" onClose={() => setDel(null)}
        onDelete={(x) => { setList((l) => { l.splice(l.findIndex((y) => y.id === x.id), 1); }); setOpenId(null); }}
        onRestore={(x) => setList((l) => { restoreAt(l, x, 0); })}>Drafts were never sent, so nothing changes for the customer.</DeleteConfirm>
      {print && <PrintDoc {...print} biz={biz} list={list} onDone={() => setPrint(null)} />}
    </>
  );
}

function InvoiceSummary({ inv, list, onReceipt, onOpen }) {
  const tt = totals(inv);
  const credits = list.filter((x) => x.kind === "credit" && x.creditFor === inv.id);
  return (
    <div className="pf-stack">
      <div className="pf-inv-head"><InvStatus inv={inv} /><b className="tnum">{rs(tt.total)}</b></div>
      {inv.status === "cancelled" && <div className="pf-note"><Icon name="ban" size={16} /><span>Cancelled on {fdate(inv.cancelledOn)}. Reason: {inv.cancelReason}</span></div>}
      {inv.kind === "credit" && <div className="pf-note"><Icon name="rotate-ccw" size={16} /><span>Credit note against <button type="button" className="link" onClick={() => onOpen(inv.creditFor)}>{inv.creditFor}</button>. {inv.reason}</span></div>}
      <dl className="pf-kv">
        <dt>Billed to</dt><dd>{inv.to}{inv.pan ? ` · PAN ${inv.pan}` : ""}</dd>
        {inv.phone && <><dt>Phone</dt><dd className="tnum">{inv.phone}</dd></>}
        <dt>Date</dt><dd className="tnum">{fdate(inv.date)}</dd>
        {inv.kind === "invoice" && <><dt>Due</dt><dd className="tnum">{fdate(inv.due)}</dd></>}
        {inv.order && <><dt>Booking</dt><dd className="tnum">{inv.order}</dd></>}
      </dl>
      <div className="pf-totals">
        {inv.lines.map((l, i) => <div key={i}><span>{l.what}{l.qty > 1 ? ` × ${l.qty}` : ""}</span><span className="tnum">{rs(l.qty * l.rate)}</span></div>)}
        <div><span>VAT {inv.vatPct}%</span><span className="tnum">{rs(Math.abs(tt.vat))}</span></div>
        <div className="total"><span>Total</span><span className="tnum">{rs(tt.total)}</span></div>
        {inv.kind === "invoice" && inv.status !== "draft" && <><div><span>Paid</span><span className="tnum">{rs(tt.paid)}</span></div><div className="total"><span>Balance</span><span className="tnum">{rs(tt.balance)}</span></div></>}
      </div>
      {inv.notes && <p className="small muted">{inv.notes}</p>}
      {(inv.receipts || []).length > 0 && <section className="pf-stack tight"><b className="pf-strong">Receipts</b>
        <ul className="pf-list">{inv.receipts.map((r) => <li key={r.id}><span className="pf-li-ico"><Icon name="receipt" size={16} /></span><div><b className="tnum">{r.id} · {rs(r.amount)}</b><span className="small muted">{r.method} · {fdate(r.at)}</span></div><Button variant="ghost" size="sm" icon="printer" onClick={() => onReceipt(r)}>Receipt</Button></li>)}</ul></section>}
      {credits.length > 0 && <section className="pf-stack tight"><b className="pf-strong">Credit notes</b>
        <ul className="pf-list">{credits.map((c) => <li key={c.id}><span className="pf-li-ico"><Icon name="rotate-ccw" size={16} /></span><div><b className="tnum">{c.id} · {rs(totals(c).total)}</b><span className="small muted">{c.reason}</span></div><Button variant="ghost" size="sm" onClick={() => onOpen(c.id)}>Open</Button></li>)}</ul></section>}
    </div>
  );
}

function InvoiceEditor({ inv, onClose, onSave }) {
  const t = useT();
  const [f, setF] = useState(inv);
  const [dirty, setDirty] = useState(false);
  const set = (patch) => { setF((x) => ({ ...x, ...patch })); setDirty(true); };
  const setLine = (i, patch) => set({ lines: f.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const tt = totals(f);
  const ok = f.to.trim() && f.lines.length && f.lines.every((l) => l.what.trim() && l.rate > 0) && f.due >= f.date;
  return (
    <Drawer open onClose={onClose} title={inv.isNew ? t("binv.new") : `Edit ${inv.id}`} sub={inv.isNew ? "Saved as a draft until you send it" : "Drafts can be changed until they are sent"}
      footer={<><span className="small muted tnum pf-foot-left">{t("pos.total")}: <b className="pf-strong">{rs(tt.total)}</b>{dirty && " · unsaved"}</span><Button variant="outline" onClick={() => onSave(f, false)} disabled={!f.to.trim()}>{t("wiz.saveDraft")}</Button><Button icon="send" disabled={!ok} onClick={() => onSave(f, true)}>{t("binvf.send")}</Button></>}>
      <div className="pf-stack">
        <div className="pf-grid-2 tight">
          <Field label={t("binv.billedTo")}><Input value={f.to} onChange={(e) => set({ to: e.target.value })} placeholder="Name or company" /></Field>
          <Field label="PAN" optional><Input className="input tnum" value={f.pan} onChange={(e) => set({ pan: e.target.value.replace(/\D/g, "").slice(0, 9) })} placeholder="9 digits" /></Field>
        </div>
        <div className="pf-grid-2 tight">
          <Field label="Phone" optional><Input className="input tnum" value={f.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="98XXXXXXXX" /></Field>
          <Field label="Booking or order" optional><Input className="input tnum" value={f.order} onChange={(e) => set({ order: e.target.value })} placeholder="BK-2027-0418" /></Field>
        </div>
        <div className="pf-grid-2 tight">
          <Field label="Invoice date"><Input type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} /></Field>
          <Field label="Due" error={f.due < f.date ? "Due date is before the invoice date" : null}><Input type="date" value={f.due} onChange={(e) => set({ due: e.target.value })} /></Field>
        </div>
        {f.lines.map((l, i) => (
          <div key={i} className="pf-repeat">
            <div className="pf-repeat-head"><b>{t("binvf.line", { n: i + 1 })}</b>{f.lines.length > 1 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => set({ lines: f.lines.filter((_, j) => j !== i) })}><Icon name="trash-2" size={14} />{t("common.delete")}</button>}</div>
            <Field label="Item"><Input value={l.what} onChange={(e) => setLine(i, { what: e.target.value })} /></Field>
            <div className="pf-chips">{QUICK.map((x) => <button key={x} type="button" className={`chip ${l.what === x ? "active" : ""}`} onClick={() => setLine(i, { what: x })}>{x}</button>)}</div>
            <div className="pf-grid-2 tight"><Field label={t("binvf.qty")}><Counter value={l.qty} min={1} max={99} onChange={(n) => setLine(i, { qty: n })} label={t("binvf.qty")} /></Field>
              <Field label={t("binvf.rate")}><div className="pf-unit"><span>Rs.</span><input className="input tnum" inputMode="numeric" value={l.rate || ""} onChange={(e) => setLine(i, { rate: Number(e.target.value.replace(/\D/g, "")) })} /></div></Field></div>
          </div>
        ))}
        <Button variant="outline" icon="plus" onClick={() => set({ lines: [...f.lines, { what: "Service fee", qty: 1, rate: 1000 }] })}>{t("binvf.addLine")}</Button>
        <ToggleRow title={t("pos.vat")} sub="13% VAT on the subtotal" checked={f.vatPct > 0} onChange={(v) => set({ vatPct: v ? 13 : 0 })} />
        <Field label="Note on the invoice" optional><Textarea rows={2} value={f.notes || ""} onChange={(e) => set({ notes: e.target.value })} placeholder="Bank details, thank-you note" style={{ minHeight: 64 }} /></Field>
        <div className="pf-totals"><div><span>{t("pos.subtotal")}</span><span className="tnum">{rs(tt.sub)}</span></div><div><span>{t("pos.vat")}</span><span className="tnum">{rs(tt.vat)}</span></div><div className="total"><span>{t("pos.total")}</span><span className="tnum">{rs(tt.total)}</span></div></div>
      </div>
    </Drawer>
  );
}

function CancelModal({ inv, onClose, onConfirm }) {
  const [why, setWhy] = useState(CANCEL[0]);
  const [other, setOther] = useState("");
  useEffect(() => { setWhy(CANCEL[0]); setOther(""); }, [inv?.id]);
  const reason = why === "Other" ? other.trim() : why;
  return (
    <Modal open={!!inv} onClose={onClose} title={inv ? `Cancel ${inv.id}?` : ""}
      footer={<><Button variant="outline" onClick={onClose}>Keep invoice</Button><Button variant="outline" className="pf-danger" icon="ban" disabled={!reason} onClick={() => onConfirm(inv, reason)}>Cancel invoice</Button></>}>
      <div className="pf-stack">
        <p className="small" style={{ color: "var(--text)" }}>The invoice stays in your records with the reason, as the tax office requires. It no longer counts towards what customers owe.</p>
        <Field label="Reason"><Select value={why} onChange={setWhy} options={CANCEL.map((x) => ({ id: x, label: x }))} /></Field>
        {why === "Other" && <Field label="Describe the reason"><Input value={other} onChange={(e) => setOther(e.target.value)} autoFocus /></Field>}
      </div>
    </Modal>
  );
}

function CreditDrawer({ inv, already, onClose, onIssue }) {
  const max = totals(inv).total - already;
  const [mode, setMode] = useState("full");
  const [amount, setAmount] = useState(String(max));
  const [reason, setReason] = useState("");
  const gross = mode === "full" ? max : Math.min(max, Number(amount) || 0);
  const net = Math.round(gross / (1 + (inv.vatPct || 0) / 100));
  return (
    <Drawer open onClose={onClose} title={`Credit note for ${inv.id}`} sub={`${inv.to} · up to ${rs(max)} can be credited`}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button icon="rotate-ccw" disabled={!(gross > 0) || !reason.trim()} onClick={() => onIssue(inv, [{ what: `Credit against ${inv.id}: ${reason.trim()}`, qty: 1, rate: net }], reason.trim())}>Issue credit note</Button></>}>
      <div className="pf-stack">
        <Field label="How much"><Seg value={mode} onChange={setMode} options={[{ id: "full", label: `Full ${rs(max)}` }, { id: "part", label: "Part" }]} /></Field>
        {mode === "part" && <Field label="Amount including VAT" error={Number(amount) > max ? `Up to ${rs(max)}` : null}><div className="pf-unit"><span>Rs.</span><input className="input tnum" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} /></div></Field>}
        <Field label="Reason" hint="Printed on the credit note"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Refund for one night not stayed" /></Field>
        <div className="pf-totals"><div><span>Before VAT</span><span className="tnum">{rs(net)}</span></div><div><span>VAT {inv.vatPct}%</span><span className="tnum">{rs(gross - net)}</span></div><div className="total"><span>Credit</span><span className="tnum">− {rs(gross)}</span></div></div>
        <p className="pf-hint">Refund the money from POS or your bank. The credit note is the tax record of it.</p>
      </div>
    </Drawer>
  );
}

// Printable invoice / credit note / receipt. Uses the browser's print dialog, which also saves as PDF.
function PrintDoc({ doc, inv, receipt, biz, onDone }) {
  useEffect(() => {
    document.body.classList.add("pf-printing");
    const done = () => { document.body.classList.remove("pf-printing"); onDone(); };
    window.addEventListener("afterprint", done, { once: true });
    const id = setTimeout(() => window.print(), 60);
    return () => { clearTimeout(id); window.removeEventListener("afterprint", done); document.body.classList.remove("pf-printing"); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const tt = totals(inv);
  const title = doc === "receipt" ? "Payment receipt" : inv.kind === "credit" ? "Credit note" : inv.status === "draft" ? "Invoice (draft)" : "Tax invoice";
  return createPortal(
    <div className="pf-print-root" aria-hidden="true">
      <article className="pf-print-doc">
        <header><div><h1>{biz.name}</h1><p>{biz.address}</p><p>{biz.phone} · {biz.email}</p><p>PAN {biz.pan}</p></div>
          <div className="pf-print-meta"><h2>{title}</h2><p><b>{doc === "receipt" ? receipt.id : inv.id}</b></p><p>Date {fdate(doc === "receipt" ? receipt.at : inv.date)}</p>{doc !== "receipt" && inv.kind === "invoice" && <p>Due {fdate(inv.due)}</p>}{inv.kind === "credit" && <p>Against {inv.creditFor}</p>}{inv.status === "cancelled" && <p><b>CANCELLED</b> · {inv.cancelReason}</p>}</div></header>
        <section className="pf-print-to"><span>{doc === "receipt" ? "Received from" : "Billed to"}</span><b>{inv.to}</b>{inv.pan && <span>PAN {inv.pan}</span>}{inv.phone && <span>{inv.phone}</span>}{inv.order && <span>Booking {inv.order}</span>}</section>
        {doc === "receipt" ? <table><tbody>
          <tr><td>Payment for invoice {inv.id}</td><td className="num">{rs(receipt.amount)}</td></tr>
          <tr><td>Paid by</td><td className="num">{receipt.method}</td></tr>
          <tr className="total"><td>Balance after this payment</td><td className="num">{rs(Math.max(0, tt.total - (inv.receipts || []).filter((r) => r.at <= receipt.at && r.id <= receipt.id).reduce((s, r) => s + r.amount, 0)))}</td></tr>
        </tbody></table> : <table>
          <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Amount</th></tr></thead>
          <tbody>{inv.lines.map((l, i) => <tr key={i}><td>{l.what}</td><td className="num">{l.qty}</td><td className="num">{rs(l.rate)}</td><td className="num">{rs(l.qty * l.rate)}</td></tr>)}</tbody>
          <tfoot>
            <tr><td colSpan={3}>Subtotal</td><td className="num">{rs(Math.abs(tt.sub))}</td></tr>
            <tr><td colSpan={3}>VAT {inv.vatPct}%</td><td className="num">{rs(Math.abs(tt.vat))}</td></tr>
            <tr className="total"><td colSpan={3}>{inv.kind === "credit" ? "Total credited" : "Total"}</td><td className="num">{rs(Math.abs(tt.total))}</td></tr>
            {inv.kind === "invoice" && tt.paid > 0 && <tr><td colSpan={3}>Paid</td><td className="num">{rs(tt.paid)}</td></tr>}
            {inv.kind === "invoice" && tt.paid > 0 && <tr className="total"><td colSpan={3}>Balance</td><td className="num">{rs(tt.balance)}</td></tr>}
          </tfoot>
        </table>}
        {inv.kind === "credit" && <p>{inv.reason}</p>}
        {inv.notes && doc !== "receipt" && <p>{inv.notes}</p>}
        <footer>Issued through Sheetal · This is a computer-generated document.</footer>
      </article>
    </div>, document.body);
}

export function Payouts({ tenant }) {
  const t = useT();
  const toast = useToast();
  const { db } = useStore();
  const ts = db.tenantSettings[tenant.id] || defaultTenantSettings(tenant);
  const own = ts.payments.mode === "own";
  const rows = []; // payouts come from the payments API
  const exportRows = rows.map((r) => ({ ...r, status: t(`status.${r.status}`) }));
  return (
    <>
      <PageHead title={t("nav.payouts")} sub={own ? t("bpay.ownSub") : t("bpay.sub", { bank: ts.payments.payoutBank.bank || "your bank" })} actions={!own && <>
        <DataActions kind="payouts" onlyExport rows={exportRows} />
        <Button variant="outline" icon="download" onClick={() => { exportCSV("payouts", exportRows); toast("Statement downloaded"); }}>{t("bpay.statement")}</Button></>} />
      {own ? <div className="pf-note">{t("bpay.ownNote")}</div> : <>
        <div className="pf-stats">
          <Stat label={t("bpay.next")} value={rs(rows[0]?.net || 0)} note={rows[0] ? fdate(rows[0].date) : "None yet"} />
          <Stat label={t("bpay.last30")} value={rs(rows.slice(1).reduce((s, r) => s + r.net, 0))} note={t("bpay.afterFee")} />
          <Stat label={t("bpay.fees")} value={rs(rows.reduce((s, r) => s + r.fee, 0))} note={t("bpay.commission")} />
        </div>
        <section className="card pf-panel"><Table rows={rows} minWidth={680} columns={[
          { key: "id", label: t("pbill.payout"), num: true, render: (r) => <b className="pf-strong">{r.id}</b> },
          { key: "date", label: t("billing.date"), num: true, render: (r) => fdate(r.date) },
          { key: "g", label: t("bpay.gross"), num: true, align: "right", render: (r) => rs(r.gross) },
          { key: "f", label: t("bpay.commission"), num: true, align: "right", render: (r) => `− ${rs(r.fee)}` },
          { key: "n", label: t("bpay.net"), num: true, align: "right", render: (r) => <b className="pf-strong">{rs(r.net)}</b> },
          { key: "s", label: t("common.status"), render: (r) => <StatusBadge status={r.status} /> },
        ]} /></section>
      </>}
    </>
  );
}
