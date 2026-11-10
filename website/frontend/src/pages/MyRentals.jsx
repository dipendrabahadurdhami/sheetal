// Profile → My rentals: the leases linked to your account (they link when you find your rent on Pay rent with your
// mobile number while signed in), what you owe, and your rent payments with their status.
// Where it fits: Profile.jsx, tab "rentals". Pay opens /services/pay-rent with the lease picked.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/endpoints";
import { isLivePath } from "../api/client";

const rs = (n) => `Rs. ${Number(n || 0).toLocaleString("en-IN")}`;
const STATUS = { pending: "Waiting to be confirmed", confirmed: "Confirmed", rejected: "Not accepted" };

export function MyRentals() {
  const [list, setList] = useState(null);
  useEffect(() => { if (!isLivePath("rent/mine")) { setList([]); return; } api.rentMine().then((r) => setList(r?.data || [])).catch(() => setList([])); }, []);
  if (!list) return <p className="muted">Loading…</p>;
  if (!list.length) return (
    <div className="card card-pad stack" style={{ gap: 8 }}>
      <h3 style={{ margin: 0 }}>No rentals yet</h3>
      <p className="muted small" style={{ margin: 0 }}>Renting through an agency on Sheetal Property? Find your rent once with the property code and your mobile number, and it shows here from then on.</p>
      <Link className="btn btn-primary" style={{ alignSelf: "flex-start" }} to="/services/pay-rent">Find my rent</Link>
    </div>
  );
  return (
    <div className="stack" style={{ gap: 16 }}>
      {list.map((l) => {
        const owed = l.view ? l.view.bills.reduce((s, b) => s + b.left, 0) : 0;
        return (
          <div key={l.leaseId} className="card card-pad stack" style={{ gap: 10 }}>
            <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <div><b>{l.view ? l.view.unit : l.lease}</b><div className="small muted">{l.lease}{l.view ? ` · ${l.view.business}` : ""} · {l.start} to {l.end}{l.status === "ended" ? " · ended" : ""}</div></div>
              {l.view && <div className="row" style={{ gap: 10, alignItems: "center" }}><span className="small">{owed ? `${rs(owed)} owed` : "Nothing owed"}</span>{owed > 0 && <Link className="btn btn-primary" to={`/services/pay-rent?lease=${l.leaseId}`}>Pay rent</Link>}</div>}
            </div>
            {l.payments.length > 0 && <table className="table" style={{ width: "100%" }}><thead><tr><th>Month</th><th>Paid on</th><th>Amount</th><th>Status</th></tr></thead><tbody>
              {l.payments.map((p) => <tr key={p.id}><td>{p.month}</td><td>{p.paidOn}</td><td>{rs(p.amount)}</td><td>{STATUS[p.status] || p.status}{p.note ? <div className="small muted">{p.note}</div> : null}</td></tr>)}
            </tbody></table>}
          </div>
        );
      })}
    </div>
  );
}
