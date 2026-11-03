import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { MapPin, Upload, QrCode, Handshake, Wallet, Home as HomeIcon, Trees, Building2, Store, BedDouble, Car, Clock, ChevronRight, ClipboardList } from "lucide-react";
import { PropertyGrid } from "../components/PropertyCard";
import { api } from "../api/endpoints";
import { toItem, toList } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { useApp } from "../context/AppContext";
import { PageHead, Empty, Modal, Avatar, usePaged, Paged } from "../components/ui";
import { agentName, fmtFull, fmtPrice, timeAgo, titleOf } from "../utils/format";
import { useSEO } from "../utils/seo";
import { PostLayout } from "../components/PostLayout";
import { readDb } from "../utils/platformDb";
import { ArrowLeft, Check, KeyRound, TrendingUp, X, Briefcase, DoorOpen, Phone, MessageCircle, Mail } from "lucide-react";

const TYPES = ["House", "Land", "Apartment", "Flat", "Commercial Space", "Office Space"];
const FAC = ["Parking", "Water supply", "Security", "Garden", "Lift", "Balcony", "Power backup"];
const budgetOf = (d) => Number(String(d.maximum_budget ?? d.budget ?? "").replace(/[^0-9.]/g, "")) || 0;
const locOf = (d) => d.prefered_location || d.location || d.preferred_location || "";
const purposeOf = (d) => d.tenant_option || d.purpose || "Buy";
// live API may send facilities as a JSON string or comma list
const facOf = (d) => { let f = d.facilities; if (typeof f === "string" && f.trim()) { try { f = JSON.parse(f); } catch { f = f.split(","); } } return (Array.isArray(f) ? f : []).map((x) => (x && typeof x === "object" ? x.name || x.title || "" : String(x || "")).trim()).filter(Boolean); };
// live API: vehicles is {"Car":1,"Bike":2} (object or JSON string)
const vehOf = (d) => { let v = d.vehicles; if (typeof v === "string") { try { v = JSON.parse(v); } catch { return v ? [v] : []; } } if (Array.isArray(v)) return v.map(String); if (v && typeof v === "object") return Object.entries(v).filter(([, n]) => Number(n) > 0).map(([k, n]) => (Number(n) > 1 ? `${k} ×${n}` : k)); return []; };
const titleOfDemand = (d) => (typeof d.requirement === "string" && d.requirement) || (typeof d.property_type === "string" && d.property_type) || "Property";
const cap = (s) => String(s || "").replace(/^\w/, (c) => c.toUpperCase());
const typeIcon = (d) => { const w = String(titleOfDemand(d)).toLowerCase(); return w.includes("land") ? Trees : /apartment|flat/.test(w) ? Building2 : /commercial|office|shop|space/.test(w) ? Store : HomeIcon; };
const demandCode = (d) => `REQ-${String(d.id).padStart(4, "0")}`;
const posterOf = (d) => cap(d.name || d.full_name || d.user?.name || [d.first_name, d.last_name].filter(Boolean).join(" ") || "Verified buyer");
const initialsOf = (d) => posterOf(d).split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const shortLoc = (d) => { const l = String(locOf(d) || ""); return l.length > 32 ? l.slice(0, 32).trim() + "…" : l; };
const budgetText = (d) => { const lo = Number(String(d.minimum_budget ?? "").replace(/[^0-9.]/g, "")) || 0; const hi = budgetOf(d); if (lo && hi && lo !== hi) return `${fmtPrice(lo)} – ${fmtPrice(hi)}`; return hi ? `Up to ${fmtPrice(hi)}` : lo ? `From ${fmtPrice(lo)}` : ""; };
const sentenceOf = (d) => { const p = String(purposeOf(d)).toLowerCase(); const verb = p === "rent" ? "to rent" : p === "invest" || p === "investment" ? "to invest in" : "to buy"; const what = String(titleOfDemand(d)).toLowerCase(); const l = locOf(d); return `Looking ${verb} ${/^[aeiou]/.test(what) ? "an" : "a"} ${what}${l ? ` in ${l}` : ""}`; };
const textOf = (v) => (typeof v === "string" ? v.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() : "");

export function Requirement() {
  useSEO("Post a requirement", "Tell us what property you need and we will find matching options.");
  const { toast } = useApp();
  const [params] = useSearchParams();
  const agentId = params.get("agent");
  const agent = useAsync(() => (agentId ? api.agent(agentId).then(toItem) : Promise.resolve(null)), [agentId]);
  const fee = useAsync(() => api.requirementFee().then(toItem).catch(() => null), []);
  const feeOn = fee.data && (fee.data.enabled ?? fee.data.is_enabled ?? Number(fee.data.amount) > 0) && Number(fee.data.amount) > 0;
  const [done, setDone] = useState(false);
  const [proof, setProof] = useState(null);
  const [ref, setRef] = useState("");
  const [f, setF] = useState({ name: "", phone: "", email: "", tenant_option: "Buy", property_type: "House", prefered_location: "", minimum_budget: "", maximum_budget: "", bedrooms: "", vehicles: "", facilities: [], description: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    if (feeOn && !proof) return toast("Please upload the payment screenshot.");
    const fd = new FormData();
    Object.entries(f).forEach(([k, v]) => (Array.isArray(v) ? v.forEach((x) => fd.append(`${k}[]`, x)) : fd.append(k, v)));
    if (agentId) fd.append("agent_id", agentId);
    if (proof) fd.append("payment_proof", proof);
    if (ref) fd.append("payment_reference", ref);
    try { await api.requirement(fd, agentId); setDone(true); toast("Requirement submitted"); } catch (x) { toast(x.errors ? Object.values(x.errors).flat()[0] : x.message || "Could not submit"); }
  };
  // ── step-by-step form ──
  const [step, setStep] = useState(0);
  const [err, setErr] = useState("");
  const [areas, setAreas] = useState([]);
  const [areaIn, setAreaIn] = useState("");
  const [extra, setExtra] = useState({ when: "", road: "", contactBy: "Call" });
  // payment options switched on in Admin → Settings → Payments
  const PS = readDb().platformSettings || {};
  const PAY = [["fonepay", "Fonepay QR"], ["esewa", "eSewa"], ["khalti", "Khalti"], ["imepay", "IME Pay"], ["connectips", "connectIPS"], ["bank", "Bank transfer"]].filter(([k]) => PS.gateways?.[k] ?? k === "fonepay");
  const [payBy, setPayBy] = useState(PAY[0]?.[0] || "fonepay");
  const proofUrl = proof ? URL.createObjectURL(proof) : null;
  const P = f.tenant_option;
  const noRooms = ["Land", "Commercial Space", "Office Space", "Shop"].includes(f.property_type);
  const BUDGETS = P === "Rent" ? [["Under 15K", 0, 15000], ["15K – 30K", 15000, 30000], ["30K – 60K", 30000, 60000], ["60K – 1 Lakh", 60000, 100000], ["1 Lakh +", 100000, 0]]
    : P === "Invest" ? [["10K – 1 Lakh", 10000, 100000], ["1 – 10 Lakh", 100000, 1000000], ["10 – 50 Lakh", 1000000, 5000000], ["50 Lakh +", 5000000, 0]]
    : [["Under 50 Lakh", 0, 5000000], ["50 Lakh – 1 Cr", 5000000, 10000000], ["1 – 2 Cr", 10000000, 20000000], ["2 – 5 Cr", 20000000, 50000000], ["5 Cr +", 50000000, 0]];
  const SUGGEST = ["Budhanilkantha", "Kapan", "Tokha", "Imadol", "Bhaisepati", "Baneshwor", "Lalitpur", "Bhaktapur", "Lakeside, Pokhara", "Chitwan"];
  const addArea = (x) => { const t = String(x).trim().replace(/,$/, ""); if (t && !areas.includes(t) && areas.length < 6) setAreas([...areas, t]); setAreaIn(""); };
  const STEPS_RQ = [["What you need", "Buy, rent or invest"], ["Where", "Areas you'd consider"], ["Budget", "Range and timeline"], ["Must-haves", "Rooms and facilities"], ["Contact", "How we reach you"]];
  const HEADS = [["What are you looking for?", "Pick one of each. You can change it later."], ["Where would you like it?", "Add up to 6 areas. More areas means more matches."], ["What is your budget?", "Pick a range or type your own."], ["What must it have?", "Only what really matters. Leave the rest empty."], ["How should we reach you?", "Our team calls you with matching options, usually within one working day."]];
  const valid = () => {
    if (step === 1 && !areas.length && !areaIn.trim()) return "Add at least one area.";
    if (step === 2 && f.minimum_budget && f.maximum_budget && Number(f.minimum_budget) > Number(f.maximum_budget)) return "Min budget is more than max budget.";
    if (step === 4) { if (!f.name.trim()) return "Add your name."; if (!/^\+?\d[\d\s-]{6,}$/.test(f.phone)) return "Add a valid phone number."; if (feeOn && !proof) return "Upload the payment screenshot."; }
    return "";
  };
  const go = (n) => { const e = n > step ? valid() : ""; setErr(e); if (e) return; if (step === 1 && areaIn.trim()) addArea(areaIn); setStep(n); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const send = async () => {
    const e = valid(); setErr(e); if (e) return;
    const notes = [extra.when && "Timeline: " + extra.when, extra.road && "Road: " + extra.road, extra.contactBy && "Contact by: " + extra.contactBy, f.description].filter(Boolean).join("\n");
    const full = { ...f, prefered_location: [...areas, areaIn.trim()].filter(Boolean).join(", "), bedrooms: noRooms ? "" : f.bedrooms, description: notes };
    const fd = new FormData();
    Object.entries(full).forEach(([k, v]) => (Array.isArray(v) ? v.forEach((x) => fd.append(`${k}[]`, x)) : fd.append(k, v)));
    if (agentId) fd.append("agent_id", agentId);
    if (proof) fd.append("payment_proof", proof);
    if (ref) fd.append("payment_reference", ref);
    try { await api.requirement(fd, agentId); setDone(true); toast("Requirement submitted"); } catch (x) { setErr(x.errors ? Object.values(x.errors).flat()[0] : x.message || "Could not submit"); }
  };
  const opt = (on, onClick, label, sub, Icon) => <button type="button" className={`pl-opt ${on ? "on" : ""}`} aria-pressed={on} onClick={onClick}>{Icon && <Icon size={20} />}<span>{label}</span>{sub && <small>{sub}</small>}</button>;
  const chip = (on, onClick, label) => <button type="button" key={label} className={`chip ${on ? "active" : ""}`} onClick={onClick}>{on && <Check size={14} />}{label}</button>;
  const budget = budgetText({ minimum_budget: f.minimum_budget, maximum_budget: f.maximum_budget });
  const sentence = sentenceOf({ tenant_option: P, property_type: f.property_type, prefered_location: [...areas, areaIn.trim()].filter(Boolean).join(", ") });
  const TYPE_ICON = { House: HomeIcon, Land: Trees, Apartment: Building2, Flat: Building2, Room: DoorOpen, "Commercial Space": Store, Shop: Store, "Office Space": Briefcase };
  const types = P === "Rent" ? ["House", "Flat", "Apartment", "Room", "Shop", "Office Space"] : P === "Invest" ? ["Land", "Apartment", "Commercial Space", "House"] : ["House", "Land", "Apartment", "Flat", "Commercial Space", "Office Space"];

  if (done) return <div className="container narrow" style={{ paddingTop: 48 }}><Empty title="Requirement received">Our team will call you with matching properties. <Link to="/search">Browse listings meanwhile</Link>.</Empty></div>;
  return (
    <PostLayout title="Post a requirement" intro="Tell us what you need. We match it with owners and agencies and call you with options." tabs={null}
      steps={STEPS_RQ} step={step} onStep={(i) => go(i)} section={HEADS[step][0]} sub={HEADS[step][1]} error={err}
      aside={<>
        {agent.data && <div className="pl-sum"><span className="tiny muted">Sending to</span><div className="row" style={{ gap: 10 }}><Avatar src={agent.data.photo} name={agentName(agent.data)} size={40} /><b>{agentName(agent.data)}</b></div></div>}
        <div className="pl-sum">
          <span className="tiny muted" style={{ textTransform: "uppercase", letterSpacing: ".08em" }}>Your request</span>
          <h4>{sentence}</h4>
          <dl>
            {budget && <><dt>Budget</dt><dd>{budget}</dd></>}
            {extra.when && <><dt>When</dt><dd>{extra.when}</dd></>}
            {!noRooms && f.bedrooms && <><dt>Bedrooms</dt><dd>{f.bedrooms}+</dd></>}
            {f.vehicles && <><dt>Parking</dt><dd>{f.vehicles}</dd></>}
            {extra.road && <><dt>Road</dt><dd>{extra.road}</dd></>}
          </dl>
          {f.facilities.length > 0 && <div className="pl-prev-facts">{f.facilities.map((x) => <span key={x}>{x}</span>)}</div>}
        </div>
        <div className="pl-note"><Handshake size={18} /><span><b>Free to post.</b> Owners and agencies with a match contact you. Your number is shared only with them.</span></div>
      </>}
      actions={<>
        {step > 0 ? <button type="button" className="btn btn-ghost" onClick={() => go(step - 1)}><ArrowLeft size={16} /> Back</button> : <Link to="/" className="btn btn-ghost">Cancel</Link>}
        {step < STEPS_RQ.length - 1 ? <button type="button" className="btn btn-primary" onClick={() => go(step + 1)}>Continue</button>
          : <button type="button" className="btn btn-primary" onClick={send}>Submit requirement</button>}
      </>}>
      {step === 0 && <>
        <div><span className="pl-lbl">I want to</span><div className="pl-opts">
          {opt(P === "Buy", () => setF({ ...f, tenant_option: "Buy", property_type: "House" }), "Buy", "A home, land or shop to own", HomeIcon)}
          {opt(P === "Rent", () => setF({ ...f, tenant_option: "Rent", property_type: "Flat" }), "Rent", "A flat, room or shop each month", KeyRound)}
          {opt(P === "Invest", () => setF({ ...f, tenant_option: "Invest", property_type: "Land" }), "Invest", "Land or property for returns", TrendingUp)}
        </div></div>
        <div><span className="pl-lbl">Property type</span><div className="pl-opts">{types.map((t) => opt(f.property_type === t, () => setF({ ...f, property_type: t }), t, null, TYPE_ICON[t] || HomeIcon))}</div></div>
      </>}
      {step === 1 && <>
        <div><span className="pl-lbl">Areas</span>
          <div className="pl-tagin">{areas.map((a) => <span key={a} className="pl-tag"><MapPin size={13} />{a}<button type="button" aria-label={`Remove ${a}`} onClick={() => setAreas(areas.filter((x) => x !== a))}><X size={13} /></button></span>)}
            <input value={areaIn} onChange={(e) => setAreaIn(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addArea(areaIn); } if (e.key === "Backspace" && !areaIn && areas.length) setAreas(areas.slice(0, -1)); }} placeholder={areas.length ? "Add another area" : "Type an area and press Enter"} /></div>
          <p className="pl-hint">Popular:</p>
          <div className="row-wrap" style={{ gap: 8, marginTop: 6 }}>{SUGGEST.filter((x) => !areas.includes(x)).map((x) => <button type="button" key={x} className="chip" onClick={() => addArea(x)}>+ {x}</button>)}</div>
        </div>
      </>}
      {step === 2 && <>
        <div><span className="pl-lbl">{P === "Rent" ? "Monthly rent" : P === "Invest" ? "Amount to invest" : "Budget"}</span>
          <div className="row-wrap" style={{ gap: 8 }}>{BUDGETS.map(([l, lo, hi]) => chip(String(f.minimum_budget) === String(lo || "") && String(f.maximum_budget) === String(hi || ""), () => setF({ ...f, minimum_budget: lo ? String(lo) : "", maximum_budget: hi ? String(hi) : "" }), l))}</div></div>
        <div className="form-grid">
          <div className="field"><label>Min (Rs.)</label><input className="input tnum" inputMode="numeric" value={f.minimum_budget} onChange={(e) => setF({ ...f, minimum_budget: e.target.value.replace(/\D/g, "") })} placeholder="Any" />{f.minimum_budget && <span className="tiny muted">{fmtPrice(f.minimum_budget)}</span>}</div>
          <div className="field"><label>Max (Rs.)</label><input className="input tnum" inputMode="numeric" value={f.maximum_budget} onChange={(e) => setF({ ...f, maximum_budget: e.target.value.replace(/\D/g, "") })} placeholder="Any" />{f.maximum_budget && <span className="tiny muted">{fmtPrice(f.maximum_budget)}</span>}</div>
        </div>
        <div><span className="pl-lbl">{P === "Rent" ? "Move in" : "When"}</span><div className="row-wrap" style={{ gap: 8 }}>{["Right away", "Within 3 months", "3 – 6 months", "Just looking"].map((x) => chip(extra.when === x, () => setExtra({ ...extra, when: extra.when === x ? "" : x }), x))}</div></div>
      </>}
      {step === 3 && <>
        {!noRooms && <div><span className="pl-lbl">Bedrooms</span><div className="row-wrap" style={{ gap: 8 }}>{["", "1", "2", "3", "4", "5"].map((b) => chip(String(f.bedrooms) === b, () => setF({ ...f, bedrooms: b }), b ? `${b}${b === "5" ? "+" : ""} BHK` : "Any"))}</div></div>}
        {["Land", "House"].includes(f.property_type) && <div><span className="pl-lbl">Road access</span><div className="row-wrap" style={{ gap: 8 }}>{["Any", "8 ft +", "13 ft +", "20 ft +", "Main road"].map((x) => chip(extra.road === x, () => setExtra({ ...extra, road: x === "Any" ? "" : x }), x))}</div></div>}
        <div><span className="pl-lbl">Parking</span><div className="row-wrap" style={{ gap: 8 }}>{[["", "Not needed"], ["Bike", "Bike"], ["Car", "Car"], ["Car & Bike", "Car and bike"]].map(([v, l]) => chip(f.vehicles === v, () => setF({ ...f, vehicles: v }), l))}</div></div>
        <div><span className="pl-lbl">Must have</span><div className="row-wrap" style={{ gap: 8 }}>{FAC.map((x) => chip(f.facilities.includes(x), () => setF({ ...f, facilities: f.facilities.includes(x) ? f.facilities.filter((y) => y !== x) : [...f.facilities, x] }), x))}</div></div>
        <div className="field"><label>Anything else?</label><textarea className="textarea" placeholder="Near a school, ground floor, pets allowed, lal purja ready…" value={f.description} onChange={set("description")} /></div>
      </>}
      {step === 4 && <>
        <div className="form-grid">
          <div className="field"><label>Full name *</label><input className="input" value={f.name} onChange={set("name")} autoComplete="name" /></div>
          <div className="field"><label>Phone *</label><input className="input" type="tel" value={f.phone} onChange={set("phone")} placeholder="98XXXXXXXX" autoComplete="tel" /></div>
          <div className="field full"><label>Email</label><input className="input" type="email" value={f.email} onChange={set("email")} autoComplete="email" /></div>
        </div>
        <div><span className="pl-lbl">Best way to reach you</span><div className="pl-opts">{[["Call", Phone], ["WhatsApp", MessageCircle], ["Email", Mail]].map(([x, I]) => opt(extra.contactBy === x, () => setExtra({ ...extra, contactBy: x }), x, null, I))}</div></div>
        {feeOn && <div className="pl-pay">
          <style>{`.pl-pay{border:1px solid var(--line);border-radius:14px;overflow:hidden}
.pl-pay-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;border-bottom:1px solid var(--line)}
.pl-pay-head b{color:var(--text-strong)}.pl-pay-amt{font-size:18px;font-weight:600;color:var(--c-red)}
.pl-pay-body{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px;padding:18px}
.pl-pay-how{display:flex;flex-direction:column;gap:12px}
.pl-pay-qr{width:160px;padding:8px;background:#fff;border:1px solid var(--line);border-radius:10px}
.pl-up{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;min-height:150px;padding:18px;text-align:center;border:1.5px dashed var(--line-strong);border-radius:12px;cursor:pointer;color:var(--text)}
.pl-up:hover{border-color:var(--c-red)}
.pl-up i{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;background:color-mix(in srgb,var(--c-red) 12%,transparent);color:var(--c-red)}
.pl-up b{color:var(--text-strong);font-size:14px}.pl-up small{font-size:12px;color:var(--muted,inherit)}
.pl-up-prev{display:flex;gap:12px;align-items:center;padding:10px;border:1px solid var(--line);border-radius:12px}
.pl-up-prev img{width:72px;height:72px;object-fit:cover;border-radius:8px}
@media (max-width:760px){.pl-pay-body{grid-template-columns:1fr}}`}</style>
          <div className="pl-pay-head"><span className="row" style={{ gap: 8 }}><QrCode size={18} color="var(--c-red)" /><b>Requirement fee</b></span><span className="pl-pay-amt tnum">{fmtFull(fee.data.amount)}</span></div>
          <div className="pl-pay-body">
            <div className="pl-pay-how">
              <span className="pl-lbl" style={{ margin: 0 }}>Pay with</span>
              <div className="row-wrap" style={{ gap: 8 }}>{PAY.map(([k, l]) => chip(payBy === k, () => setPayBy(k), l))}</div>
              {payBy === "fonepay" ? <><img className="pl-pay-qr" src="/pay/fonepay-qr.png" alt="Fonepay QR" /><span className="small muted">Scan with any bank or wallet app that supports Fonepay.</span></>
                : payBy === "bank" ? <span className="small">Transfer to <b>{PS.siteName || "Sheetal Property"}</b>. Ask us for the account number on {PS.supportPhone || "our support line"}, then upload the receipt.</span>
                : <span className="small">Send {fmtFull(fee.data.amount)} by {PAY.find((x) => x[0] === payBy)?.[1]} to <b className="tnum">{PS.supportPhone || "our support number"}</b> ({PS.siteName || "Sheetal Property"}).</span>}
              {fee.data.note && <span className="small muted">{fee.data.note}</span>}
            </div>
            <div className="stack" style={{ gap: 10 }}>
              <span className="pl-lbl" style={{ margin: 0 }}>Payment screenshot *</span>
              {proof ? <div className="pl-up-prev"><img src={proofUrl} alt="" /><div className="stack" style={{ gap: 4, minWidth: 0 }}><b className="small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{proof.name}</b><span className="row" style={{ gap: 8 }}><label className="btn btn-ghost btn-sm" style={{ cursor: "pointer" }}>Change<input type="file" accept="image/*" hidden onChange={(e) => e.target.files[0] && setProof(e.target.files[0])} /></label><button type="button" className="btn btn-ghost btn-sm" onClick={() => setProof(null)}>Remove</button></span></div></div>
                : <label className="pl-up" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const x = e.dataTransfer.files[0]; if (x) setProof(x); }}>
                  <i><Upload size={20} /></i><b>Upload payment screenshot</b><small>Drop the image here or click to choose · JPG or PNG</small>
                  <input type="file" accept="image/*" hidden onChange={(e) => e.target.files[0] && setProof(e.target.files[0])} />
                </label>}
              <input className="input" placeholder="Transaction ID (optional)" value={ref} onChange={(e) => setRef(e.target.value)} />
            </div>
          </div>
        </div>}
      </>}
    </PostLayout>
  );
}

/* ───────── Demand analytics ───────── */
const PCOL = { Buy: "var(--c-crimson)", Rent: "var(--c-slate)", Invest: "var(--c-red)" };
const PORDER = ["Buy", "Rent", "Invest"];
const normPurpose = (d) => { const p = String(purposeOf(d)).toLowerCase(); return p === "rent" ? "Rent" : /invest/.test(p) ? "Invest" : "Buy"; };
const typeName = (d) => cap((typeof d.property_type === "string" && d.property_type.trim()) || titleOfDemand(d));
const locName = (d) => cap(String(locOf(d) || "Any location").split(",")[0].trim()) || "Any location";
const budgetBucket = (d) => { const b = budgetOf(d); if (!b) return "Not stated"; if (normPurpose(d) === "Rent") return b <= 25000 ? "Rent ≤ 25K" : b <= 60000 ? "Rent 25–60K" : "Rent 60K+"; return b <= 1e7 ? "≤ 1 Cr" : b <= 3e7 ? "1–3 Cr" : "3 Cr+"; };
const pct = (v) => `${v.toFixed(1)}%`;
const clip = (t, n = 14) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const niceScale = (max) => {
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 5000];
  const step = steps.find((x) => max / x <= 5) || 5000;
  const nt = Math.max(2, Math.ceil(max / step));
  return { nt, yMax: step * nt };
};
const DIMS = [
  ["location", "Location", true, (d) => [locName(d)]],
  ["type", "Property type", true, (d) => [typeName(d)]],
  ["budget", "Budget", true, (d) => [budgetBucket(d)]],
  ["purpose", "Purpose", true, (d) => [normPurpose(d)]],
  ["fac", "Facilities", false, (d) => [...new Set(facOf(d).map(cap))]],
  ["veh", "Vehicles", false, (d) => { const v = vehOf(d); return v.length ? v : ["None"]; }],
];
const TOP_N = 8;

/* Column chart: one slim bar per group = number of requests, stacked by purpose. */
function DemandChart({ items }) {
  const [dimKey, setDimKey] = useState("location");
  const [hov, setHov] = useState(-1);
  const [, label, single, get] = DIMS.find((x) => x[0] === dimKey);
  const N = items.length;

  const rows = useMemo(() => {
    const m = {};
    items.forEach((d) => get(d).forEach((k) => { const r = m[k] || (m[k] = { k, total: 0, by: { Buy: 0, Rent: 0, Invest: 0 } }); r.total += 1; r.by[normPurpose(d)] += 1; }));
    let list = Object.values(m).sort((a, b) => b.total - a.total || a.k.localeCompare(b.k));
    if (single && list.length > TOP_N) {
      const other = { k: "Other", total: 0, by: { Buy: 0, Rent: 0, Invest: 0 } };
      list.slice(TOP_N - 1).forEach((r) => { other.total += r.total; PORDER.forEach((p) => { other.by[p] += r.by[p]; }); });
      list = [...list.slice(0, TOP_N - 1), other];
    } else if (!single) list = list.slice(0, TOP_N);
    list = [...list.filter((r) => r.k !== "Other"), ...list.filter((r) => r.k === "Other")];
    return list.map((r) => ({ ...r, share: (r.total / N) * 100 }));
  }, [items, dimKey]);

  const present = PORDER.filter((p) => rows.some((r) => r.by[p]));
  const { nt, yMax } = niceScale(Math.max(1, ...rows.map((r) => r.total)));
  const rot = rows.length > 9;
  const W = 1000, H = 360, L = 44, R = 16, T = 30, B = rot ? 84 : 48;
  const pw = W - L - R, ph = H - T - B, slot = pw / rows.length, bw = Math.min(34, slot * 0.42);
  const y = (v) => T + ph * (1 - v / yMax);
  const cx = (i) => L + slot * (i + 0.5);
  const h = hov >= 0 ? rows[hov] : null;
  const leader = rows.find((r) => r.k !== "Other") || rows[0];

  return (
    <div className="stack" style={{ gap: 24 }}>
      <style>{`@keyframes dcGrow{from{transform:scaleY(0)}to{transform:scaleY(1)}}@media (prefers-reduced-motion:reduce){.dc-bar{animation:none!important}}`}</style>
      <div className="rates-stats">
        <div><span>Open requests</span><b className="tnum">{N}</b></div>
        <div><span>{label} groups</span><b className="tnum">{rows.length}</b></div>
        <div><span>Most requested</span><b>{leader.k}</b></div>
        <div><span>Share of requests</span><b className="tnum">{pct(leader.share)}</b></div>
      </div>

      <div className="card card-pad stack" style={{ gap: 18 }}>
        <div className="row between" style={{ flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
          <div className="stack" style={{ gap: 4 }}>
            <h3>Demand by {label.toLowerCase()}</h3>
            <p className="small muted">{single ? "Number of requests in each group." : `A request can list several items, so these do not add up to ${N}.`}</p>
          </div>
          <div className="seg" style={{ flexWrap: "wrap" }}>{DIMS.map(([k, l]) => <button key={k} className={dimKey === k ? "on" : ""} onClick={() => { setDimKey(k); setHov(-1); }}>{l}</button>)}</div>
        </div>

        <div className="row" style={{ gap: 18, flexWrap: "wrap" }}>
          {present.map((p) => <span key={p} className="row small" style={{ gap: 6 }}><i style={{ width: 10, height: 10, borderRadius: 3, background: PCOL[p], display: "inline-block" }} />{p}</span>)}
        </div>

        <div style={{ overflowX: "auto" }}>
          <div style={{ position: "relative", minWidth: 640 }}>
            <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Bar chart of ${N} requests by ${label.toLowerCase()}`} style={{ width: "100%", display: "block", fontFamily: "var(--font-ui)" }}>
              {Array.from({ length: nt + 1 }, (_, i) => {
                const v = (yMax / nt) * i, yy = y(v);
                return (
                  <g key={i}>
                    <line x1={L} x2={W - R} y1={yy} y2={yy} stroke="var(--line)" strokeDasharray={i === 0 ? "" : "3 5"} />
                    <text x={L - 10} y={yy} textAnchor="end" dominantBaseline="central" fontSize="11.5" fill="var(--muted)">{v}</text>
                  </g>
                );
              })}

              <g key={dimKey}>
                {rows.map((r, i) => {
                  let acc = 0;
                  const x0 = cx(i) - bw / 2, top = y(r.total), id = `dc-${dimKey}-${i}`;
                  return (
                    <g key={r.k} opacity={hov < 0 || hov === i ? 1 : 0.35} style={{ transition: "opacity .15s" }}>
                      <g className="dc-bar" style={{ transformOrigin: `${cx(i)}px ${y(0)}px`, animation: `dcGrow .55s cubic-bezier(.2,.7,.2,1) ${i * 45}ms both` }}>
                        <clipPath id={id}><rect x={x0} y={top} width={bw} height={y(0) - top + 6} rx="6" /></clipPath>
                        <g clipPath={`url(#${id})`}>
                          {PORDER.filter((p) => r.by[p]).map((p) => {
                            const y1 = y(acc + r.by[p]), hh = y(acc) - y1;
                            acc += r.by[p];
                            return <rect key={p} x={x0} y={y1} width={bw} height={hh + 0.5} fill={PCOL[p]} />;
                          })}
                        </g>
                      </g>
                      <text x={cx(i)} y={top - 9} textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--text-strong)">{r.total}</text>
                      <text x={cx(i)} y={H - B + 22} textAnchor={rot ? "end" : "middle"} fontSize="12" fill="var(--text)" transform={rot ? `rotate(-32 ${cx(i)} ${H - B + 22})` : undefined}>{clip(r.k, 14)}</text>
                    </g>
                  );
                })}
              </g>

              {rows.map((r, i) => <rect key={r.k} x={L + slot * i} y={T} width={slot} height={ph + 40} fill="transparent" onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(-1)} />)}
            </svg>

            {h && (
              <div className="card tnum" style={{ position: "absolute", top: 36, left: `${(cx(hov) / W) * 100}%`, transform: hov >= rows.length / 2 ? "translateX(calc(-100% - 14px))" : "translateX(14px)", minWidth: 190, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 4, boxShadow: "var(--shadow)", background: "var(--card)", pointerEvents: "none", zIndex: 5 }}>
                <b style={{ color: "var(--text-strong)" }}>{h.k}</b>
                <span className="small">{h.total} {h.total === 1 ? "request" : "requests"} · {pct(h.share)}</span>
                <span className="small muted">{PORDER.filter((p) => h.by[p]).map((p) => `${p} ${h.by[p]}`).join(" · ")}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MatchModal({ demand, onClose }) {
  const { toast } = useApp();
  const mine = useAsync(() => api.myProperties().then(toList), []);
  const [pick, setPick] = useState(null);
  const [msg, setMsg] = useState("");
  const submit = async () => {
    try { const r = await api.demandMatch({ requirement_form_id: demand.id, property_id: pick, message: msg || undefined }); toast(r?.message || "Match submitted"); onClose(); }
    catch (x) { toast(x.status === 409 ? "You already submitted this property." : x.status === 403 ? "You can only match properties you own." : x.message); }
  };
  return (
    <Modal open onClose={onClose}>
      <div className="stack">
        <h3>Offer a property</h3>
        <p className="small muted">{titleOfDemand(demand)} in {locOf(demand) || "any location"}{budgetOf(demand) ? `, up to ${fmtPrice(budgetOf(demand))}` : ""}</p>
        <div className="stack" style={{ gap: 8, maxHeight: 280, overflowY: "auto" }}>
          {mine.loading ? <div className="sk" style={{ height: 80 }} /> : !mine.data?.items?.length ? <p className="small muted">You have no listings. <Link to="/post-property">Post one first</Link>.</p>
            : mine.data.items.map((p) => <button key={p.id} className={`chip ${pick === p.id ? "active" : ""}`} style={{ height: "auto", padding: "10px 12px", justifyContent: "space-between" }} onClick={() => setPick(p.id)}><span style={{ textAlign: "left" }}>{titleOf(p)}</span><span className="tnum">{fmtPrice(p.total_price)}</span></button>)}
        </div>
        <textarea className="textarea" style={{ minHeight: 80 }} placeholder="Message to the buyer (optional)" value={msg} onChange={(e) => setMsg(e.target.value)} />
        <button className="btn btn-primary" disabled={!pick} onClick={submit}><Handshake size={16} /> Submit match</button>
      </div>
    </Modal>
  );
}

export function Demands() {
  useSEO("Buyer requests", "Live property requirements from buyers and tenants in Nepal.");
  const { user, setAuth } = useApp();
  const { data, loading } = useAsync(() => api.demands().then(toList), []);
  const items = data?.items || [];
  const matches = useAsync(() => (items.length ? api.demandMatches(items.map((d) => d.id).join(",")).catch(() => null) : Promise.resolve(null)), [items.length]);
  // matches can come back as an array [{requirement_form_id, matches_count}] or an object keyed by id
  const count = (id) => {
    const raw = matches.data?.data ?? matches.data;
    if (Array.isArray(raw)) return Number(raw.find((m) => String(m.requirement_form_id) === String(id))?.matches_count) || 0;
    const v = raw && typeof raw === "object" ? raw[id] : null;
    return Array.isArray(v) ? v.length : Number(v?.matches_count ?? v) || 0;
  };
  const [view, setView] = useState("list");
  const [match, setMatch] = useState(null);
  const nav = useNavigate();
  const [type, setType] = useState("All");
  const filtered = items.filter((d) => type === "All" || purposeOf(d) === type);
  const pg = usePaged(filtered, 10, type);
  const shown = pg.items;
  const stats = useMemo(() => ({
    loc: Object.entries(items.reduce((a, d) => { const k = String(locOf(d)).split(",")[0].trim(); if (k) a[k] = (a[k] || 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 8),
  }), [items]);

  return (
    <>
      <div className="tools-hero demand-hero"><PageHead crumbs={[{ label: "Buyer requests" }]} title="What buyers are looking for">
        Live requests from buyers and tenants. Agents and owners can offer a matching property.
      </PageHead></div>
      <div className="container" style={{ paddingTop: 24 }}>
        <div className="toolbar">
          <div className="row" style={{ gap: 6 }}>{["All", "Buy", "Rent", "Invest"].map((t) => <button key={t} className={`chip ${type === t ? "active" : ""}`} style={{ height: 34 }} onClick={() => setType(t)}>{t}</button>)}</div>
          <div className="seg"><button className={view === "list" ? "on" : ""} onClick={() => setView("list")}>Requests</button><button className={view === "stats" ? "on" : ""} onClick={() => setView("stats")}>Analytics</button></div>
        </div>
        {loading ? <div className="sk" style={{ height: 320 }} /> : !items.length ? <Empty title="No open requests" /> : view === "stats" ? (
          filtered.length ? <DemandChart items={filtered} /> : <Empty title="No requests in this view" />
        ) : (
          <div className="dboard">
          <div className="dfeed" ref={pg.top}>
            {shown.map((d) => (
              <article key={d.id} className="dpost fade-in" onClick={() => nav(`/property-demand/${d.id}`, { state: { demand: d } })}>
                <header className="dpost-head">
                  <span className="dpost-av">{(() => { const I = typeIcon(d); return <I size={20} strokeWidth={1.7} />; })()}</span>
                  <div className="dpost-who"><b>{cap(titleOfDemand(d))} wanted</b><span>{demandCode(d)} · {timeAgo(d.created_at)}</span></div>
                  <span className={purposeOf(d).toLowerCase() === "rent" ? "tag tag-red" : "tag tag-line"}>{purposeOf(d)}</span>
                </header>
                <p className="dpost-text">{sentenceOf(d)}</p>
                {textOf(d.description) && <p className="dpost-desc">{textOf(d.description)}</p>}
                <div className="dpost-meta">
                  {budgetText(d) && <span className="dpost-budget tnum">{budgetText(d)}</span>}
                  {facOf(d).slice(0, 3).map((x) => <span key={x} className="dpost-chip">{x}</span>)}
                  {facOf(d).length > 3 && <span className="dpost-chip">+{facOf(d).length - 3}</span>}
                </div>
                <footer className="dpost-foot">
                  <span className="muted small tnum">{count(d.id) === 1 ? "1 offer" : `${count(d.id)} offers`}</span>
                  <div className="row" style={{ gap: 8 }}>
                    <span className="link small">View details <ChevronRight size={14} /></span>
                    <button className="btn btn-primary btn-sm" onClick={(ev) => { ev.stopPropagation(); user ? setMatch(d) : setAuth("login"); }}><Handshake size={15} /> I Have</button>
                  </div>
                </footer>
              </article>
            ))}
            <Paged pg={pg} />
            {!shown.length && <Empty title="No requests in this filter" />}
          </div>
          <aside className="dside">
            <PostReqCard />
            <div className="card card-pad stack" style={{ gap: 10 }}>
              <h4>Most wanted areas</h4>
              {stats.loc.slice(0, 6).map(([k, v]) => <div key={k} className="row between small"><span className="row" style={{ gap: 6, minWidth: 0 }}><MapPin size={13} className="muted" /><span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{cap(k)}</span></span><span className="tnum muted">{v}</span></div>)}
            </div>
          </aside>
          </div>
        )}
      </div>
      {match && <MatchModal demand={match} onClose={() => setMatch(null)} />}
    </>
  );
}

export function DemandDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user, setAuth } = useApp();
  const list = useAsync(() => api.demands().then(toList), []);
  const d = list.data?.items?.find((x) => String(x.id) === String(id));
  const [match, setMatch] = useState(null);
  const offers = useAsync(() => api.demandMatches(String(id)).catch(() => null), [id]);
  const offerCount = (() => { const raw = offers.data?.data ?? offers.data; if (Array.isArray(raw)) return Number(raw.find((m) => String(m.requirement_form_id) === String(id))?.matches_count) || 0; const v = raw?.[id]; return Array.isArray(v) ? v.length : Number(v?.matches_count ?? v) || 0; })();
  useSEO(d ? sentenceOf(d) : "Buyer request", "Property requirement from a buyer on Sheetal Property.");

  const similar = useAsync(async () => {
    if (!d) return { items: [] };
    const p = String(purposeOf(d)).toLowerCase();
    const purpose = p === "rent" ? "rent" : p.startsWith("inv") ? "invest" : "sale";
    const base = { per_page: 8, page: 1, advertisement_purpose: purpose, property_type: cap(titleOfDemand(d)) };
    if (budgetOf(d)) base.max_price = budgetOf(d);
    const kw = String(locOf(d)).split(/[,/]/)[0].trim();
    let r = await api.search(kw ? { ...base, keyword: kw } : base).then(toList).catch(() => ({ items: [] }));
    if (!r.items?.length) r = await api.search(base).then(toList).catch(() => ({ items: [] }));
    if (!r.items?.length) r = await api.byPurpose(purpose, 1, 8).then(toList).catch(() => ({ items: [] }));
    return r;
  }, [d?.id]);

  if (list.loading) return <div className="container" style={{ paddingTop: 32 }}><div className="sk" style={{ height: 360 }} /></div>;
  if (!d) return <div className="container"><Empty title="Request not found"><Link to="/property-demand">Back to all requests</Link></Empty></div>;
  const I = typeIcon(d);
  const iHave = () => (user ? setMatch(d) : setAuth("login"));
  const facts = [
    [I, "Looking for", cap(titleOfDemand(d))],
    [ClipboardList, "Purpose", cap(purposeOf(d))],
    budgetText(d) && [Wallet, "Budget", budgetText(d)],
    [MapPin, "Location", locOf(d) || "Any location"],
    d.bedrooms && [BedDouble, "Bedrooms", d.bedrooms],
    vehOf(d).length > 0 && [Car, "Vehicles", vehOf(d).join(", ")],
    [Clock, "Posted", timeAgo(d.created_at)],
    [Handshake, "Offers so far", offerCount],
  ].filter(Boolean);

  return (
    <>
      <div className="container ddetail-layout" style={{ paddingTop: 24 }}>
        <section className="stack" style={{ gap: 24, minWidth: 0 }}>
          <div className="row" style={{ gap: 14, alignItems: "center" }}>
            <span className="dpost-av" style={{ width: 56, height: 56 }}><I size={26} strokeWidth={1.6} /></span>
            <div className="stack" style={{ gap: 8, minWidth: 0 }}>
              <h1 style={{ fontSize: "clamp(22px, 2.6vw, 32px)", textTransform: "none" }}>{sentenceOf(d)}</h1>
              <div className="row" style={{ gap: 8 }}><span className={String(purposeOf(d)).toLowerCase() === "rent" ? "tag tag-red" : "tag tag-line"}>{purposeOf(d)}</span><span className="tiny muted tnum">{demandCode(d)}</span></div>
            </div>
          </div>
          <div className="dfacts">
            {facts.map(([Ic, k, v]) => <div key={k}><Ic size={18} strokeWidth={1.6} /><span>{k}</span><b className="tnum">{v}</b></div>)}
          </div>
          {facOf(d).length > 0 && <div className="stack" style={{ gap: 10 }}><h4>Must have</h4><div className="row-wrap" style={{ gap: 8 }}>{facOf(d).map((x) => <span key={x} className="dpost-chip" style={{ fontSize: 13, padding: "5px 12px" }}>{x}</span>)}</div></div>}
          {textOf(d.description) && <div className="stack" style={{ gap: 8 }}><h4>Notes from the buyer</h4><p style={{ whiteSpace: "pre-line", lineHeight: 1.75 }}>{textOf(d.description)}</p></div>}
          <div className="stack dmatch" style={{ gap: 16, paddingTop: 24 }}>
            <div className="section-head" style={{ marginBottom: 0 }}><div className="stack"><h2>Matching properties</h2><p>Listings that fit this request by type, purpose, area and budget.</p></div></div>
            {!similar.loading && !similar.data?.items?.length ? <Empty title="No matching listings yet">If you have one, tap I Have to offer it.</Empty> : <PropertyGrid loading={similar.loading} items={similar.data?.items || []} count={3} />}
          </div>
        </section>
        <aside className="dside">
          <div className="card card-pad stack" style={{ gap: 14, boxShadow: "var(--shadow)" }}>
            <span className="tiny muted" style={{ textTransform: "uppercase", letterSpacing: ".1em" }}>Budget</span>
            <div className="price-big tnum" style={{ fontSize: 26 }}>{budgetText(d) || "Open"}</div>
            <p className="small muted">Own a property that fits? Send it to this buyer. Our team shares it and arranges the visit.</p>
            <button className="btn btn-primary btn-block btn-lg" onClick={iHave}><Handshake size={17} /> I Have this property</button>
            <span className="small muted tnum" style={{ textAlign: "center" }}>{offerCount === 1 ? "1 offer sent" : `${offerCount} offers sent`}</span>
          </div>
          <PostReqCard />
        </aside>
      </div>
      {match && <MatchModal demand={match} onClose={() => setMatch(null)} />}
    </>
  );
}

function PostReqCard() {
  return (
    <div className="preq">
      <div className="preq-top">
        <span className="preq-ico"><ClipboardList size={20} strokeWidth={1.7} /></span>
        <div className="stack" style={{ gap: 2 }}>
          <span className="preq-kick">Looking for something?</span>
          <h4>Post your requirement</h4>
        </div>
      </div>
      <ol className="preq-steps">
        <li><b>1</b>Tell us the type, area and budget</li>
        <li><b>2</b>Owners and agents send matches</li>
        <li><b>3</b>We call you and arrange visits</li>
      </ol>
      <Link to="/requirement" className="btn btn-primary btn-block">Post requirement <ChevronRight size={16} /></Link>
    </div>
  );
}