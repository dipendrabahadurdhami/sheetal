import React, { useState } from "react";
import { useStore } from "@sheetal/shared/core/store";
import { Link } from "@sheetal/shared/core/router";
import { fdate, rs } from "@sheetal/shared/core/format";
import { Badge, Button, Drawer, Field, Input, Seg, Table, Textarea, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { Page, SavedBody } from "./Market";

// Customer account (§9, §20–27) — one place for every order: status timeline, payments, documents,
// cancel and refund, check-in details, stay hub, report a problem, review, receipt. Plus saved items.
const FLOW = { confirmed: ["Booked", "Paid", "Checked in", "Checked out", "Completed"], reserved: ["Reserved", "Token paid", "Agreement", "Instalments", "Handover"], invested: ["Invested", "Cooling-off", "Active", "Returns paid", "Exited"] };
const STEP = { confirmed: 1, reserved: 1, invested: 1, completed: 4, cancelled: -1, refund_pending: -1 };
const Wrap = ({ embedded, children }) => (embedded ? <div className="pf-stack">{children}</div> : <Page><section className="pb-inner pf-stack" style={{ padding: "28px 24px" }}>{children}</section></Page>);
const LABEL = { paid: "Paid", pending_verification: "Pending verification", confirmed: "Confirmed", reserved: "Reserved", invested: "Invested", completed: "Completed", cancelled: "Cancelled", refund_pending: "Refund pending" };
const REFUND = { flexible: 100, moderate: 50, strict: 0 };
export const demoOrders = (db) => [...(db.customer?.orders || []),
  { code: "BK-2027-0388", tid: "t4", title: "Fewa View Villa, Sedi", kind: "stay", from: "2027-01-18", to: "2027-01-21", total: 36000, paid: 36000, method: "khalti", status: "completed", at: "2027-01-10", policy: "flexible", claim: 3500, problem: "Damage claim: broken lamp" },
  { code: "INV-2027-0022", tid: "t5", title: "Chitwan Jungle Lodge", kind: "invest", total: 100000, paid: 100000, method: "connectips", status: "invested", at: "2027-01-20" }];

export function Account({ start = "orders", embedded, kinds }) {
  const { db, update } = useStore();
  const toast = useToast();
  const [tab, setTab] = useState(start);
  const [open, setOpen] = useState(null);
  const all = demoOrders(db);
  const orders = kinds ? all.filter((x) => kinds.includes(x.kind || "stay")) : all;
  const o = orders.find((x) => x.code === open);
  const setOrder = (code, patch) => update((d) => {
    d.customer = d.customer || { orders: [] };
    let x = d.customer.orders.find((y) => y.code === code);
    if (x) Object.assign(x, patch); else { x = { ...orders.find((y) => y.code === code), ...patch }; d.customer.orders.push(x); }
    const ops = d.ops?.[x.tid];
    if (ops) {
      const b = ops.bookings?.find((y) => y.id === code);
      if (b && patch.status === "refund_pending") b.status = "cancelled";
      if (b && patch.paid) b.paid = patch.paid;
      if (patch.problem || patch.status === "refund_pending") { ops.convs = ops.convs || []; ops.convs.unshift({ id: `cv${Date.now()}`, name: "Sita Gurung", phone: "9841010101", ch: "web", stage: "new", unread: 1, last: patch.problem ? `Problem reported: ${patch.problem}` : `Booking ${code} cancelled, refund requested`, at: "2027-03-02T10:00", msgs: [{ from: "them", text: patch.problem ? `${patch.problem} problem in booking ${code}.` : `I cancelled ${code}. Refund ${patch.refund}.`, at: "10:00" }], tags: [patch.problem ? "Problem" : "Cancellation"] }); }
    }
  });
  return (
    <Wrap embedded={embedded}>
      {!embedded && <h1 className="pb-h1" style={{ fontSize: 28 }}>My account</h1>}
      {!embedded && <Seg value={tab} onChange={setTab} options={[{ id: "orders", label: "Bookings and orders", icon: "calendar-check" }, { id: "payments", label: "Payments", icon: "receipt" }, { id: "saved", label: "Saved", icon: "heart" }, { id: "profile", label: "Profile and ID", icon: "id-card" }]} />}
      {tab === "orders" && !orders.length && <div className="pf-empty"><Icon name="calendar-check" size={36} /><h3>Nothing here yet</h3><p>Bookings, reservations and investments you make appear here.</p></div>}
      {tab === "orders" && <div className="pf-stack">{orders.map((x) => (
        <button key={x.code} className="card pf-pad pb-order pb-order-btn" onClick={() => setOpen(x.code)}>
          <div className="pb-ph"><Icon name={x.kind === "invest" ? "chart-pie" : x.kind === "reserve" ? "building-2" : "bed-double"} size={18} /></div>
          <div className="pf-two" style={{ flex: 1 }}><b>{x.title}</b><small className="tnum">{x.code}{x.from ? ` · ${fdate(x.from)} – ${fdate(x.to)}` : ""}</small></div>
          <Badge tone={x.status === "cancelled" ? "neutral" : x.status === "refund_pending" ? "action" : "done"}>{LABEL[x.status] || x.status}</Badge>
          {x.paid < x.total && <span className="small pf-tone-action tnum">{rs(x.total - x.paid)} due</span>}
          <Icon name="chevron-right" size={18} />
        </button>
      ))}</div>}
      {tab === "payments" && <div className="card pf-panel"><Table rows={orders.map((x) => ({ ...x, id: x.code }))} minWidth={560} columns={[
        { key: "c", label: "Order", num: true, render: (x) => <b className="pf-strong">{x.code}</b> }, { key: "d", label: "Date", num: true, render: (x) => fdate(x.at) },
        { key: "m", label: "Method", render: (x) => x.method }, { key: "p", label: "Paid", num: true, align: "right", render: (x) => rs(x.paid) },
        { key: "s", label: "Status", render: (x) => <Badge tone={x.status === "pending_verification" ? "progress" : x.status === "cancelled" ? "neutral" : "done"}>{LABEL[x.status] || x.status}</Badge> },
        { key: "r", label: "", align: "right", render: (x) => <Button variant="ghost" size="sm" icon="download" onClick={() => setOpen(x.code)}>Receipt</Button> },
      ]} /></div>}
      {tab === "saved" && <SavedBody />}
      {tab === "profile" && <div className="card pf-pad pf-stack" style={{ maxWidth: 560 }}>
        <div className="pf-grid-2 tight"><Field label="Full name"><Input defaultValue="Sita Gurung" /></Field><Field label="Phone"><Input className="input tnum" defaultValue="9841010101" /></Field></div>
        <Field label="ID for check-in and KYC" hint="Shown only to the host or developer you book with, and Sheetal's verification team."><div className="pf-chips">{["Citizenship", "Passport", "Driving licence"].map((x, i) => <button key={x} className={`chip ${i === 0 ? "active" : ""}`}>{x}</button>)}</div></Field>
        <label className="drop pf-drop"><input type="file" hidden /><Icon name="upload" size={22} /><b>Upload ID (front and back)</b></label>
        <Badge tone="done" icon="check">ID added · investing unlocked</Badge>
      </div>}
      <Drawer open={!!o} onClose={() => setOpen(null)} title={o?.title} sub={o?.code}>{o && <OrderDetail o={o} setOrder={setOrder} toast={toast} />}</Drawer>
    </Wrap>
  );
}

function OrderDetail({ o, setOrder, toast }) {
  const [mode, setMode] = useState(null);
  const [f, setF] = useState({ reason: "Plans changed", issue: "Hot water", note: "", stars: 5, review: "", arrival: "14:00" });
  const flow = FLOW[o.kind === "invest" ? "invested" : o.kind === "reserve" ? "reserved" : "confirmed"];
  const at = o.status === "completed" ? 4 : STEP[o.status] ?? 1;
  const stay = !o.kind || o.kind === "stay";
  const refund = Math.round((o.paid * (REFUND[o.policy || "moderate"] ?? 50)) / 100);
  const upcoming = stay && !["completed", "cancelled", "refund_pending"].includes(o.status);
  return (
    <div className="pf-stack">
      {at >= 0 ? <ol className="pf-steps-h">{flow.map((s, i) => <li key={s} className={i <= at ? "done" : ""}><span>{i <= at ? <Icon name="check" size={12} /> : i + 1}</span>{s}</li>)}</ol>
        : <div className="pf-note"><Icon name="rotate-ccw" size={16} />{o.status === "refund_pending" ? `Cancelled. Refund of ${rs(o.refund || 0)} is on its way: requested → approved → sent to ${o.method} (3–5 working days).` : "Cancelled."}</div>}
      <dl className="pf-kv"><dt>Total</dt><dd className="tnum">{rs(o.total)}</dd><dt>Paid</dt><dd className="tnum">{rs(o.paid)} · {o.method}</dd>{o.paid < o.total && <><dt>Balance</dt><dd className="tnum">{rs(o.total - o.paid)}</dd></>}{o.from && <><dt>Dates</dt><dd className="tnum">{fdate(o.from)} – {fdate(o.to)}</dd></>}</dl>
      {stay && <div className="pf-note"><Icon name="shield-check" size={16} />{o.status === "completed" ? (o.claim ? `Security deposit Rs. 5,000: host claimed ${rs(o.claim)} for damage. Sheetal is reviewing.` : "Security deposit Rs. 5,000 released to you.") : "Security deposit Rs. 5,000 is held and released 48 hours after check-out unless the host reports damage."}</div>}
      <div className="pf-chips">
        <span className="chip"><Icon name="file-text" size={14} />{stay ? "Booking voucher" : o.kind === "invest" ? "Investment agreement" : "Reservation agreement"}</span>
        <button className="chip" onClick={() => setMode("receipt")}><Icon name="receipt" size={14} />Receipt</button>
        <Link to={`/site/${o.tid}`} className="chip"><Icon name="message-circle" size={14} />Message</Link>
      </div>
      {o.paid < o.total && !["cancelled", "refund_pending"].includes(o.status) && <Button icon="credit-card" onClick={() => { setOrder(o.code, { paid: o.total }); toast("Balance paid. Receipt sent."); }}>Pay balance {rs(o.total - o.paid)}</Button>}
      {upcoming && <div className="pf-row-actions" style={{ justifyContent: "flex-start" }}>
        <Button variant="outline" size="sm" icon="id-card" onClick={() => setMode("checkin")}>Check-in details</Button>
        <Button variant="outline" size="sm" icon="concierge-bell" onClick={() => setMode("hub")}>Stay hub</Button>
        <Button variant="outline" size="sm" icon="triangle-alert" onClick={() => setMode("problem")}>Report a problem</Button>
        <Button variant="ghost" size="sm" className="pf-danger" onClick={() => setMode("cancel")}>Cancel booking</Button>
      </div>}
      {o.status === "completed" && !o.reviewed && <Button variant="outline" icon="star" onClick={() => setMode("review")}>Write a review</Button>}
      {mode === "cancel" && <div className="card pf-pad pf-stack">
        <b>Cancel this booking</b>
        <Field label="Why?"><div className="pf-chips">{["Plans changed", "Found another place", "Dates wrong", "Other"].map((r) => <button key={r} className={`chip ${f.reason === r ? "active" : ""}`} onClick={() => setF({ ...f, reason: r })}>{r}</button>)}</div></Field>
        <div className="pf-totals"><div><span>Policy</span><span>{o.policy || "moderate"}</span></div><div className="total"><span>You get back</span><span className="tnum">{rs(refund)}</span></div></div>
        <Button className="pf-danger" variant="outline" onClick={() => { setOrder(o.code, { status: "refund_pending", refund }); setMode(null); toast("Cancelled. Refund requested."); }}>Confirm cancellation</Button>
      </div>}
      {mode === "checkin" && <div className="card pf-pad pf-stack"><b>Before you arrive</b>
        <Field label="Arrival time"><Seg value={f.arrival} onChange={(v) => setF({ ...f, arrival: v })} options={["12:00", "14:00", "18:00", "22:00"].map((x) => ({ id: x, label: x }))} /></Field>
        <Field label="ID of each guest"><label className="btn btn-outline"><input type="file" hidden /><Icon name="upload" size={16} />Upload IDs</label></Field>
        <Button onClick={() => { setMode(null); toast("Check-in details sent to the hotel"); }}>Send to hotel</Button></div>}
      {mode === "hub" && <div className="card pf-pad pf-stack"><b>Your stay</b><dl className="pf-kv"><dt>Wi-Fi</dt><dd className="tnum">Lakeside-Guest · lake2027</dd><dt>Breakfast</dt><dd>07:00–10:00, terrace</dd><dt>Front desk</dt><dd className="tnum">061-465000</dd><dt>Check-out</dt><dd>11:00</dd></dl>
        <div className="pf-chips">{["Order room service", "Book airport drop", "Late check-out", "Extra towels"].map((x) => <button key={x} className="chip" onClick={() => toast(`${x}: sent to front desk`)}>{x}</button>)}</div></div>}
      {mode === "problem" && <div className="card pf-pad pf-stack"><b>Report a problem</b>
        <div className="pf-chips">{["Hot water", "Cleanliness", "Noise", "Not as described", "Safety", "Other"].map((x) => <button key={x} className={`chip ${f.issue === x ? "active" : ""}`} onClick={() => setF({ ...f, issue: x })}>{x}</button>)}</div>
        <Textarea rows={3} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="What happened?" style={{ minHeight: 70 }} />
        <label className="btn btn-outline btn-sm" style={{ alignSelf: "flex-start" }}><input type="file" hidden accept="image/*" /><Icon name="camera" size={14} />Add photo</label>
        <Button onClick={() => { setOrder(o.code, { problem: f.issue }); setMode(null); toast("Reported. The host has 2 hours to reply; Sheetal steps in after that."); }}>Send report</Button></div>}
      {mode === "review" && <div className="card pf-pad pf-stack"><b>How was it?</b>
        <div className="pf-chips">{[1, 2, 3, 4, 5].map((n) => <button key={n} className={`chip ${f.stars >= n ? "active" : ""}`} onClick={() => setF({ ...f, stars: n })}>★</button>)}</div>
        <Textarea rows={3} value={f.review} onChange={(e) => setF({ ...f, review: e.target.value })} placeholder="Cleanliness, staff, location…" style={{ minHeight: 70 }} />
        <Button disabled={!f.review} onClick={() => { setOrder(o.code, { reviewed: true }); setMode(null); toast("Review posted"); }}>Post review</Button></div>}
      {mode === "receipt" && <Receipt o={o} />}
    </div>
  );
}

export function Receipt({ o }) {
  const { db } = useStore();
  const x = db.tenants.find((t) => t.id === o.tid) || {};
  const vat = Math.round((o.total / 1.13) * 0.13);
  return (
    <article className="pf-doc">
      <header><b>{o.paid >= o.total ? "Receipt" : "Invoice"}</b><span className="tnum">{o.code}</span></header>
      <div className="pf-kv" style={{ display: "grid" }}><span>From</span><span>{x.name} · PAN {x.pan}</span><span>Billed to</span><span>Sita Gurung · 9841010101</span><span>Date</span><span className="tnum">{fdate(o.at)}</span></div>
      <div className="pf-totals"><div><span>{o.title}</span><span className="tnum">{rs(o.total - vat)}</span></div><div><span>VAT 13%</span><span className="tnum">{rs(vat)}</span></div><div className="total"><span>Total</span><span className="tnum">{rs(o.total)}</span></div><div><span>Paid by {o.method}</span><span className="tnum">{rs(o.paid)}</span></div></div>
      <footer className="pf-legal-slot">Cancellation and refund terms apply as shown at booking. [Legal text from Sheetal.]</footer>
    </article>
  );
}

/* Staff side: every order, refund and complaint (admin Billing → Orders and refunds) */
export function AdminOrders() {
  const { db, update } = useStore();
  const toast = useToast();
  const orders = demoOrders(db);
  const [f, setF] = useState("all");
  const rows = orders.filter((o) => f === "all" || (f === "refunds" ? o.status === "refund_pending" : f === "problems" ? o.problem : o.status === f)).map((o) => ({ ...o, id: o.code }));
  return (
    <section className="card pf-panel">
      <div className="pf-toolbar"><Seg value={f} onChange={setF} options={[{ id: "all", label: "All orders" }, { id: "refunds", label: "Refunds" }, { id: "problems", label: "Problems and claims" }]} /></div>
      <Table rows={rows} minWidth={860} columns={[
        { key: "c", label: "Order", render: (o) => <span className="pf-two"><b className="tnum">{o.code}</b><small>{o.title}</small></span> },
        { key: "b", label: "Business", render: (o) => <span className="small">{db.tenants.find((t) => t.id === o.tid)?.name}</span> },
        { key: "p", label: "Paid", num: true, align: "right", render: (o) => rs(o.paid) },
        { key: "s", label: "Status", render: (o) => <Badge tone={o.status === "refund_pending" ? "action" : o.problem ? "problem" : "done"}>{o.problem ? `Problem: ${o.problem}` : LABEL[o.status] || o.status}</Badge> },
        { key: "x", label: "", align: "right", render: (o) => o.status === "refund_pending" && <Button size="sm" onClick={() => { update((d) => { const x = d.customer?.orders.find((y) => y.code === o.code); if (x) x.status = "cancelled"; }); toast(`Refund of ${rs(o.refund || 0)} sent`); }}>Approve refund</Button> },
      ]} />
    </section>
  );
}
