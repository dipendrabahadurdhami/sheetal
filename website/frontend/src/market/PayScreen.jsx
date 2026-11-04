// One payment screen for every purpose: stay, reservation, investment, rent, invoice or plan (sample flow).
// How it works: choose a method, then processing, then paid, pending check, or failed with retry.

import React, { useEffect, useState } from "react";
import { useStore } from "@sheetal/shared/core/store";
import { rs } from "@sheetal/shared/core/format";
import { Badge, Button, Field, Input } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";

// Payment methods: the same ones as the Pay rent page.
const METHODS = [
  ["fonepay", "Fonepay QR", "qr-code", "qr", "Scan with any bank app"], ["esewa", "eSewa", "wallet", "online", "Instant"], ["khalti", "Khalti", "wallet", "online", "Instant"],
  ["imepay", "IME Pay", "wallet", "online", "Instant"], ["connectips", "connectIPS", "landmark", "online", "From your bank account"], ["bank", "Bank transfer", "landmark", "manual", "Checked in 2 hours"],
];
const COUPONS = { DASHAIN10: { pct: 10, min: 0 }, WELCOME500: { off: 500, min: 5000 }, HOLI2026: { expired: true } };

export function couponResult(code, amount) {
  const c = COUPONS[String(code || "").trim().toUpperCase()];
  if (!code) return null;
  if (!c) return { ok: false, msg: "This code isn't valid." };
  if (c.expired) return { ok: false, msg: "This code has expired." };
  if (amount < c.min) return { ok: false, msg: `Needs a total of at least ${rs(c.min)}.` };
  return { ok: true, off: c.pct ? Math.round((amount * c.pct) / 100) : c.off, msg: c.pct ? `${c.pct}% off applied` : `${rs(c.off)} off applied` };
}

export default function PayScreen({ purpose, lines = [], total, allowCoupon = true, onPaid, onBack, embedded = false }) {
  const { db } = useStore();
  const enabled = METHODS.filter(([k]) => db.platformSettings?.gateways?.[k] !== false);
  const [m, setM] = useState(enabled[0]?.[0] || "fonepay");
  const [state, setState] = useState("choose");
  const [ref, setRef] = useState("");
  const [refErr, setRefErr] = useState(false);
  const [code, setCode] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [applied, setApplied] = useState(null);
  const off = applied?.ok ? applied.off : 0;
  const due = Math.max(0, total - off);
  const kind = METHODS.find((x) => x[0] === m)?.[3];
  const label = METHODS.find((x) => x[0] === m)?.[1];

  const pay = () => {
    setState("processing");
    setTimeout(() => {
      if (kind !== "online") { setState("pending"); onPaid?.({ method: m, off, due, status: "pending_verification", ref }); return; }
      if (ref === "fail") { setState("failed"); return; }
      setState("paid"); onPaid?.({ method: m, off, due, status: "paid" });
    }, 1100);
  };
  useEffect(() => { setApplied(null); }, [total]);

  if (state === "processing") return <div className="pf-paystate"><span className="pf-spin" aria-hidden="true" /><b>Processing {rs(due)} with {label}…</b><span className="small muted">Don't close this page.</span></div>;
  if (state === "paid") return <div className="pf-paystate"><span className="pf-kind-ico"><Icon name="circle-check" size={30} /></span><b>Payment received</b><span className="small muted tnum">{rs(due)} · {label}. A receipt is in My payments.</span></div>;
  if (state === "pending") return <div className="pf-paystate"><span className="pf-kind-ico"><Icon name="clock" size={30} /></span><b>Pending verification</b><span className="small muted">We check {label} payments within 2 working hours and send your receipt.</span></div>;
  if (state === "failed") return <div className="pf-paystate"><span className="pf-kind-ico"><Icon name="triangle-alert" size={30} /></span><b>Payment failed</b><span className="small muted">No money was taken. Try again or choose another method.</span><div className="pf-row-actions"><Button variant="outline" onClick={() => setState("choose")}>Choose another method</Button><Button onClick={pay}>Retry</Button></div></div>;

  return (
    <div className={`pf-stack ${embedded ? "pay-embedded" : ""}`}>
      {!embedded && <div className="pf-note"><Icon name="receipt" size={16} /><span><b>{purpose}</b></span></div>}
      {!embedded && <div className="pf-totals">
        {lines.map(([l, v]) => <div key={l}><span>{l}</span><span className="tnum">{rs(v)}</span></div>)}
        {off > 0 && <div><span>Discount ({code.toUpperCase()})</span><span className="tnum">− {rs(off)}</span></div>}
        <div className="total"><span>To pay now</span><span className="tnum">{rs(due)}</span></div>
      </div>}
      <div className="pb-gw pay-methods" role="radiogroup" aria-label="Payment method">{enabled.map(([k, l, ic, , sub]) => <button key={k} type="button" role="radio" aria-checked={m === k} className={m === k ? "on" : ""} onClick={() => setM(k)}><Icon name={ic} size={20} /><span className="pay-m"><b>{l}</b><small>{sub}</small></span><i className="pay-dot" aria-hidden="true" /></button>)}</div>
      {kind === "qr" && <div className="pf-qrpay"><img src="/pay/fonepay-qr.png" alt="Fonepay QR" onError={(e) => { e.currentTarget.style.display = "none"; }} /><span className="small">Scan with any bank app or Fonepay, then enter the reference below.</span></div>}
      {kind !== "online" && <Field label="Payment reference" error={refErr && !ref.trim() ? "Enter the transaction ID so we can match your payment" : null}><Input id="pf-payref" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Transaction ID from your app or bank" /></Field>}
      {kind !== "online" && <label className="btn btn-outline btn-sm" style={{ alignSelf: "flex-start" }}><input type="file" hidden accept="image/*" /><Icon name="upload" size={14} />Upload screenshot</label>}
      {allowCoupon && (showCode ? <div className="pf-stack tight">
        <div className="pf-row-actions" style={{ justifyContent: "flex-start" }}><Input value={code} onChange={(e) => { setCode(e.target.value); setApplied(null); }} placeholder="Code" style={{ maxWidth: 200 }} /><Button variant="outline" size="sm" onClick={() => setApplied(couponResult(code, total))}>Apply</Button>{applied?.ok && <Button variant="ghost" size="sm" onClick={() => { setApplied(null); setCode(""); }}>Remove</Button>}</div>
        {applied && <span className={applied.ok ? "pf-hint" : "pf-error"}><Icon name={applied.ok ? "check" : "circle-alert"} size={13} />{applied.msg}</span>}
      </div> : <button type="button" className="link small" style={{ background: "none", border: 0, padding: 0, alignSelf: "flex-start", cursor: "pointer" }} onClick={() => setShowCode(true)}>Have a code?</button>)}
      {embedded && off > 0 && <div className="pf-totals"><div><span>Discount ({code.toUpperCase()})</span><span className="tnum">− {rs(off)}</span></div><div className="total"><span>To pay now</span><span className="tnum">{rs(due)}</span></div></div>}
      <div className="pf-row-actions pay-actions" style={{ justifyContent: onBack ? "space-between" : "flex-end" }}>
        {onBack && <Button variant="ghost" icon="arrow-left" onClick={onBack}>Back</Button>}
        <Button icon="lock" onClick={() => { if (kind !== "online" && !ref.trim()) { setRefErr(true); document.getElementById("pf-payref")?.focus(); return; } pay(); }}>{kind === "online" ? `Pay ${rs(due)} with ${label}` : "I have paid"}</Button>
      </div>
      <span className="tiny muted" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><Icon name="shield-check" size={13} />Payments go through Nepal-licensed providers. Sheetal never sees your PIN.</span>
    </div>
  );
}

export { Badge };
