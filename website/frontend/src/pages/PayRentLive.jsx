// Pay rent online, on the website API: find your lease, see what is owed and where to pay, then send the reference
// and a screenshot. It counts once it is confirmed (by Sheetal Property, or by your agency if you pay it directly).
// Where it fits: /services/pay-rent when the rent API is live (PayRent in ServicePages.jsx picks this); signed-in
// people can also pick a lease from Profile → My rentals (?lease=<id>).
// Rules: nothing is shown without the right code and the mobile number on the lease, or a lease linked to the account.

import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Check, QrCode, Upload, Wallet } from "lucide-react";
import { useSEO } from "../utils/seo";
import { useApp } from "../context/AppContext";
import { api } from "../api/endpoints";

const rs = (n) => `Rs. ${Number(n || 0).toLocaleString("en-IN")}`;
const monthName = (m) => (m ? new Date(m + "-01T00:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) : "");
const today = () => new Date(Date.now() + 5.75 * 3600_000).toISOString().slice(0, 10);
const readBase64 = (file) => new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] || ""); r.onerror = () => fail(new Error("Couldn't read that picture.")); r.readAsDataURL(file); });

export function PayRentLive() {
  useSEO("Pay rent online", "Pay rent by Fonepay, eSewa, Khalti or bank transfer, with your property code.");
  const { toast, user } = useApp();
  const [params] = useSearchParams();
  const [find, setFind] = useState({ code: "", phone: "" });
  const [mine, setMine] = useState([]);
  const [view, setView] = useState(null);
  const [pay, setPay] = useState({ billId: "", amount: "", method: "", ref: "", paidOn: today() });
  const [proof, setProof] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  const show = (v) => { setView(v); const b = v.bills.find((x) => x.left > 0); setPay((p) => ({ ...p, billId: b?.id || "", amount: b ? String(b.left) : "", method: v.methods[0]?.method || "other" })); };
  useEffect(() => {
    if (!user) return;
    api.rentMine().then((r) => {
      const list = (r?.data || []).filter((x) => x.view);
      setMine(list);
      const want = params.get("lease");
      const pick = list.find((x) => x.leaseId === want) || (list.length === 1 ? list[0] : null);
      if (pick) show(pick.view);
    }).catch(() => {});
  }, [user]);

  const lookup = async (e) => {
    e.preventDefault(); setBusy(true);
    try { show((await api.rentFind({ code: find.code.trim(), phone: find.phone.trim() })).data); } catch (x) { toast(x.message); } finally { setBusy(false); }
  };
  const bill = view?.bills.find((b) => b.id === pay.billId);
  const method = view?.methods.find((m) => m.method === pay.method);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const r = await api.rentPay({ leaseId: view.leaseId, code: find.code || null, phone: find.phone || null, billId: pay.billId, amount: Number(pay.amount), method: pay.method, ref: pay.ref.trim(), paidOn: pay.paidOn, proof: proof ? await readBase64(proof) : null });
      setDone(r.message || "Sent."); toast(r.message || "Sent.");
    } catch (x) { toast(x.message); } finally { setBusy(false); }
  };

  return (
    <div className="container section-sm" style={{ maxWidth: 960 }}>
      <h1 style={{ marginBottom: 6 }}>Pay rent online</h1>
      <p className="muted" style={{ marginTop: 0 }}>Find your rent with the property code on your lease (like ER-0123 or LS-0007) and your mobile number. Pay, then send us the reference and a screenshot.</p>

      {done ? <div className="card card-pad stack" style={{ gap: 10, marginTop: 24 }}><Check size={28} color="var(--c-red)" /><h3>Payment sent</h3><p className="muted small">{done} You can follow it in Profile → My rentals{user ? "" : " after signing in"}.</p></div> : <>
        {!view && <div className="stack" style={{ gap: 16, marginTop: 24 }}>
          {mine.length > 1 && <div className="card card-pad stack" style={{ gap: 10 }}>
            <h3 style={{ margin: 0 }}>Your rentals</h3>
            {mine.map((m) => <button key={m.leaseId} type="button" className="btn btn-outline" style={{ justifyContent: "space-between" }} onClick={() => show(m.view)}><span>{m.view.unit} · {m.view.business}</span><span className="small">{m.lease}</span></button>)}
          </div>}
          <form className="card card-pad stack" onSubmit={lookup} style={{ maxWidth: 480 }}>
            <h3 style={{ margin: 0 }}>Find your rent</h3>
            <input className="input" placeholder="Property code (ER-0123) or lease code (LS-0007)" required value={find.code} onChange={(e) => setFind({ ...find, code: e.target.value.toUpperCase() })} />
            <input className="input" type="tel" placeholder="Mobile number on the lease" required={!user} value={find.phone} onChange={(e) => setFind({ ...find, phone: e.target.value })} />
            <button className="btn btn-primary" disabled={busy}>Find my rent</button>
            <span className="small muted">Don't know the code? It is on your lease and on the property's page. Or ask your agency.</span>
          </form>
        </div>}

        {view && <div className="detail-layout" style={{ marginTop: 24 }}>
          <div className="stack" style={{ gap: 16 }}>
            <div className="card card-pad stack" style={{ gap: 6 }}>
              <span className="small muted">{view.lease} · {view.business}</span>
              <h3 style={{ margin: 0 }}>{view.unit}</h3>
              <span className="small">Rent {rs(view.rent)} a month · {view.payTo === "sheetal" ? "Paid to Sheetal Property, who passes it to your agency" : `Paid to ${view.business} directly`}</span>
            </div>
            {view.bills.length ? <div className="card card-pad stack" style={{ gap: 8 }}>
              <h4 style={{ margin: 0 }}>What you owe</h4>
              {view.bills.map((b) => <label key={b.id} className="row" style={{ gap: 10, alignItems: "center", cursor: b.left ? "pointer" : "default", opacity: b.left ? 1 : 0.6 }}>
                <input type="radio" name="bill" disabled={!b.left} checked={pay.billId === b.id} onChange={() => setPay({ ...pay, billId: b.id, amount: String(b.left) })} />
                <span style={{ flex: 1 }}><b>{monthName(b.month)}</b> <span className="small muted">· due {b.due}{b.lateFee ? ` · late fee ${rs(b.lateFee)}` : ""}</span></span>
                <span className="small">{b.left ? rs(b.left) : "Waiting to be confirmed"}{b.pending && b.left ? <span className="muted"> ({rs(b.pending)} waiting)</span> : null}</span>
              </label>)}
            </div> : <div className="card card-pad"><p className="muted small" style={{ margin: 0 }}>Nothing is owed right now.</p></div>}
            <button type="button" className="btn btn-ghost" style={{ alignSelf: "flex-start" }} onClick={() => { setView(null); setDone(null); }}>Find another rental</button>
          </div>
          {bill && <aside><form className="card card-pad stack" onSubmit={submit}>
            <h3 style={{ margin: 0 }}>Pay {monthName(bill.month)}</h3>
            <select className="select" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>{view.methods.map((m) => <option key={m.method} value={m.method}>{m.label}</option>)}</select>
            {method && <div className="row" style={{ gap: 12, alignItems: "center" }}>
              {method.qr ? <img src={method.qr} alt={`${method.label} QR`} style={{ width: 140, background: "#FFFFFF", padding: 6, border: "1px solid var(--line)" }} /> : <QrCode size={22} color="var(--c-red)" />}
              <span className="small">{method.detail || (view.payTo === "sheetal" ? "Sheetal Property" : view.business)}{view.businessPhone && view.payTo === "business" ? ` · ${view.businessPhone}` : ""}</span>
            </div>}
            <input className="input" type="number" min="1" max={bill.left} placeholder="Amount (Rs.)" required value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} />
            <input className="input" type="date" max={today()} value={pay.paidOn} onChange={(e) => setPay({ ...pay, paidOn: e.target.value })} />
            <input className="input" placeholder="Transaction ID / reference" required minLength={3} value={pay.ref} onChange={(e) => setPay({ ...pay, ref: e.target.value })} />
            <label className="drop" style={{ padding: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer" }}><Upload size={18} style={{ flexShrink: 0 }} /><span>{proof ? proof.name : "Upload the payment screenshot"}</span><input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f && f.size > 8 * 1024 * 1024) { toast("Choose a picture under 8 MB."); return; } setProof(f || null); }} /></label>
            <button className="btn btn-primary" disabled={busy || !pay.amount || !pay.ref.trim()}><Wallet size={16} /> Send payment</button>
            <span className="small muted">It counts once {view.payTo === "sheetal" ? "Sheetal Property" : "your agency"} confirms the money arrived.</span>
          </form></aside>}
        </div>}
      </>}
    </div>
  );
}
