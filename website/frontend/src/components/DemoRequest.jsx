// "Request a demo" for Sheetal Technologies: demos are given by Sheetal's team, not by a self-serve button (the owner's rule of 27 Nov 2026).
// Where it fits: the bottom of /technology (#demo) and of every /technology/software/<id> page; the business panel's sign-in page links here.
// How it works: POST /demo-request (website API, engage routes) saves a lead of kind "demo" for Sheetal and rings the super admin's bell
// with the name, business, phone and the software wanted (Admin -> Leads). The robot check is added by the API client when it is on.

import { useState } from "react";
import { CheckCircle2, Send } from "lucide-react";
import { api } from "../api/endpoints";

const TYPES = ["Real estate agency", "Hotel or resort", "Homestay or holiday home", "Housing developer", "Investment sponsor", "Other business"];
const SIZES = ["Just me", "2 to 5", "6 to 20", "21 to 50", "More than 50"];
const SOFT = [["crm", "CRM"], ["accounting", "Accounting"], ["hrm", "HRM"], ["property", "Property management"], ["hospitality", "Hospitality"], ["projects", "Projects"], ["growth", "Promote"]];
const NAME = Object.fromEntries(SOFT);

export function DemoRequest({ pick = [] }) {
  const [f, setF] = useState({ name: "", phone: "", email: "", business_name: "", business_type: "", city: "", team_size: "", time: "", message: "", website: "" });
  const [soft, setSoft] = useState(pick);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const toggle = (id) => setSoft((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const r = await api.demoRequest({ ...f, software: soft.map((id) => NAME[id]), preferred_contact_time: f.time, description: f.message });
      setDone(r?.message || "Thank you. Our team will call you soon.");
    } catch (x) {
      setErr(x?.message || "Couldn't send. Please try again or call +977 980-1136817.");
    } finally { setBusy(false); }
  };

  if (done) {
    return (
      <div className="card card-pad demo-done">
        <CheckCircle2 size={40} />
        <h3>Request received</h3>
        <p className="small muted">{done}</p>
      </div>
    );
  }
  return (
    <form className="card card-pad demo-form" onSubmit={submit}>
      <div className="demo-grid">
        <label className="field"><span>Your name *</span><input className="input" required minLength={2} maxLength={80} autoComplete="name" value={f.name} onChange={set("name")} /></label>
        <label className="field"><span>Phone *</span><input className="input" type="tel" required maxLength={30} autoComplete="tel" placeholder="98XXXXXXXX" value={f.phone} onChange={set("phone")} /></label>
        <label className="field"><span>Email</span><input className="input" type="email" maxLength={120} autoComplete="email" value={f.email} onChange={set("email")} /></label>
        <label className="field"><span>Business name</span><input className="input" maxLength={120} autoComplete="organization" value={f.business_name} onChange={set("business_name")} /></label>
        <label className="field"><span>Type of business</span><select className="input" value={f.business_type} onChange={set("business_type")}><option value="">Choose…</option>{TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
        <label className="field"><span>City</span><input className="input" maxLength={80} placeholder="Kathmandu" value={f.city} onChange={set("city")} /></label>
        <label className="field"><span>Team size</span><select className="input" value={f.team_size} onChange={set("team_size")}><option value="">Choose…</option>{SIZES.map((t) => <option key={t}>{t}</option>)}</select></label>
        <label className="field"><span>Good time to call</span><input className="input" maxLength={40} placeholder="e.g. weekdays after 11 am" value={f.time} onChange={set("time")} /></label>
      </div>
      <fieldset className="demo-soft">
        <legend>Which software do you want to see?</legend>
        <div className="demo-chips">{SOFT.map(([id, l]) => <button key={id} type="button" className={`chip ${soft.includes(id) ? "active" : ""}`} aria-pressed={soft.includes(id)} onClick={() => toggle(id)}>{l}</button>)}</div>
      </fieldset>
      <label className="field"><span>Anything we should know?</span><textarea className="input" rows={3} maxLength={2000} placeholder="How you work today, what you want to fix…" value={f.message} onChange={set("message")} /></label>
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="sr-only" value={f.website} onChange={set("website")} />
      {err && <p className="small" role="alert" style={{ color: "var(--danger, #b42318)", margin: 0 }}>{err}</p>}
      <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <button className="btn btn-primary" disabled={busy}><Send size={16} /> {busy ? "Sending…" : "Request a demo"}</button>
        <span className="small muted">Free, no obligation. Our team calls you within one working day.</span>
      </div>
    </form>
  );
}
