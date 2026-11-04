// The form for posting stays, projects and investments from the website.
// How it works: fields per type are [key, label, kind, extra], where kind is text, num, money, seg, chips, check or year.

import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Upload, X, ArrowLeft, Check, Crown, Clock } from "lucide-react";
import { useApp } from "../context/AppContext";
import { fmtPrice } from "../utils/format";
import { EmailVerify } from "./EmailVerify";
import { PostLayout } from "./PostLayout";
import { FREE_PER_TYPE, POST_TYPES, hasPlan, isEmailVerified, myPosts, ownerOf, saveSitePosts, sitePosts, toPreview } from "../utils/sitePosts";

const DISTRICTS = ["Kathmandu", "Lalitpur", "Bhaktapur", "Kaski", "Chitwan", "Rupandehi", "Morang", "Sunsari", "Jhapa", "Kavrepalanchok", "Tanahun", "Mustang"];
// fields per type: [key, label, kind, extra]; kind: text | num | money | seg | chips | check | year
const FIELDS = {
  stay: [
    ["subtype", "What are you offering?", "seg", ["Homestay", "Room", "Villa", "Apartment", "Hotel or resort"]],
    ["title", "Name of the stay", "text", "e.g. Fewa View Homestay"],
    ["price", "Price per night (Rs.)", "money"], ["rooms", "Rooms", "num"], ["guests", "Max guests", "num"],
    ["checkin", "Check-in from", "text", "2:00 PM"], ["checkout", "Check-out by", "text", "11:00 AM"],
    ["amenities", "Amenities", "chips", ["Wi-Fi", "Parking", "Breakfast", "Hot water", "Kitchen", "Mountain view", "Airport pickup", "Air conditioning"]],
  ],
  project: [
    ["subtype", "Project type", "seg", ["Apartments", "Colony / plotting", "Villas", "Commercial"]],
    ["title", "Project name", "text", "e.g. Shetal Heights"], ["developer", "Developer / company", "text"],
    ["units", "Total units or plots", "num"], ["price", "Price from (Rs.)", "money"], ["completion", "Handover year", "year", "2028"],
    ["amenities", "Facilities", "chips", ["Lift", "Parking", "24h security", "Backup power", "Gym", "Garden", "Kids play area", "Water supply"]],
  ],
  invest: [
    ["subtype", "What is the money for?", "seg", ["Hotel or resort", "Housing", "Land", "Commercial", "Agriculture"]],
    ["title", "Investment title", "text", "e.g. Chitwan eco resort expansion"],
    ["target", "Amount to raise (Rs.)", "money"], ["min", "Minimum investment (Rs.)", "money"],
    ["returns", "Expected return", "text", "e.g. 8–10% a year, not guaranteed"], ["term", "Term (months)", "num"],
    ["risk", "I will show investors that returns are not guaranteed and money can be lost.", "check"],
  ],
};
const REQUIRED = { stay: ["title", "price"], project: ["title", "price"], invest: ["title", "target", "min", "risk"] };
const STEPS = [["Details", "Type, name and price"], ["Location", "District and area"], ["Photos", "Cover and gallery"], ["Contact", "Phone and description"]];
const SECTION = {
  stay: ["Tell guests about the stay", "Guests see this first. You can change it later."],
  project: ["Project details", "Buyers compare projects on these numbers."],
  invest: ["Investment details", "Be clear about the amount, the minimum and the risk."],
};
const STEP_HEAD = [null, ["Where is it?", "The full address is shared only after an enquiry."], ["Photos", "Bright, wide photos get more enquiries. The first one is the cover."], ["Contact and description", "Enquiries come to this phone and to your email."]];

export function SitePostForm({ type }) {
  const { user, toast } = useApp();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const editing = useMemo(() => sitePosts().find((p) => p.id === params.get("edit")), [params]);
  const T = POST_TYPES[type];
  const [step, setStep] = useState(0);
  const [err, setErr] = useState("");
  const [verified, setVerified] = useState(isEmailVerified(user));
  const [v, setV] = useState(() => editing?.values || { subtype: FIELDS[type][0][3][0], min: type === "invest" ? "10000" : "", amenities: [], name: user?.name || [user?.first_name, user?.last_name].filter(Boolean).join(" "), phone: user?.phone || user?.mobile || "", email: user?.email || "" });
  const [cover, setCover] = useState(editing?.cover || null);
  const [gallery, setGallery] = useState(editing?.gallery || []);
  const used = myPosts(user).filter((p) => p.type === type && p.status !== "rejected" && p.id !== editing?.id).length;
  const blocked = !editing && !hasPlan(user) && used >= FREE_PER_TYPE;
  const set = (k, x) => setV({ ...v, [k]: x });

  if (blocked) return (
    <div className="container narrow" style={{ paddingTop: 16 }}><div className="card card-pad stack" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 10 }}><Crown size={20} color="var(--c-red)" /><h3 style={{ margin: 0 }}>You've used your free {T.label.toLowerCase()} post</h3></div>
      <p className="muted" style={{ margin: 0 }}>A free account includes {FREE_PER_TYPE} post of each type. Choose a plan in your profile to post more, get featured placement and see who viewed your posts.</p>
      <div className="row-wrap" style={{ gap: 8 }}><Link to="/my-profile?tab=plan" className="btn btn-primary">See plans</Link><Link to="/my-profile?tab=listings" className="btn btn-outline">My posts</Link></div>
    </div></div>
  );

  const valid = () => {
    if (step === 0) { const miss = REQUIRED[type].filter((k) => !v[k] || (typeof v[k] === "string" && !v[k].trim())); if (miss.length) return type === "invest" && miss.includes("risk") && miss.length === 1 ? "Tick the risk note to continue." : "Fill in the fields marked *."; if (type === "invest" && Number(v.min) < 10000) return "Minimum investment is Rs. 10,000."; }
    if (step === 1 && (!v.district || !String(v.area || "").trim())) return "Add the district and area.";
    if (step === 2 && !cover) return "Add a cover photo.";
    if (step === 3 && !/^\+?\d[\d\s-]{6,}$/.test(String(v.phone || ""))) return "Add a contact phone number.";
    return "";
  };
  const next = () => { const e = valid(); setErr(e); if (!e) { setStep(step + 1); window.scrollTo({ top: 0, behavior: "smooth" }); } };
  const submit = () => {
    const e = valid(); setErr(e); if (e) return;
    if (!verified) { setErr("Verify your email first."); return; }
    const list = sitePosts();
    const rec = { id: editing?.id || "SP-" + Date.now().toString(36).toUpperCase(), type, owner: ownerOf(user), title: v.title.trim(), values: v, cover, gallery, status: "review", created: editing?.created || new Date().toISOString(), updated: new Date().toISOString(), views: editing?.views || 0, enquiries: editing?.enquiries || 0 };
    const i = list.findIndex((p) => p.id === rec.id);
    if (i >= 0) list[i] = rec; else list.unshift(rec);
    saveSitePosts(list);
    toast(editing ? "Changes sent for review" : "Sent for review. We'll email you when it's live.");
    nav("/my-profile?tab=listings");
  };
  const addPhotos = async (files, isCover) => {
    const out = (await Promise.all(Array.from(files).slice(0, isCover ? 1 : 12).map((f) => toPreview(f)))).filter(Boolean);
    if (isCover) setCover(out[0] || null); else setGallery([...gallery, ...out].slice(0, 12));
  };
  const req = (k) => (REQUIRED[type].includes(k) ? " *" : "");
  const field = ([k, label, kind, extra]) => {
    if (kind === "seg") return <div key={k} className="field full"><label>{label}</label><div className="row-wrap" style={{ gap: 8 }}>{extra.map((o) => <button type="button" key={o} className={`chip ${v[k] === o ? "active" : ""}`} onClick={() => set(k, o)}>{o}</button>)}</div></div>;
    if (kind === "chips") return <div key={k} className="field full"><label>{label}</label><div className="row-wrap" style={{ gap: 8 }}>{extra.map((o) => { const on = (v[k] || []).includes(o); return <button type="button" key={o} className={`chip ${on ? "active" : ""}`} onClick={() => set(k, on ? v[k].filter((x) => x !== o) : [...(v[k] || []), o])}>{on && <Check size={14} />}{o}</button>; })}</div></div>;
    if (kind === "check") return <label key={k} className="check small full"><input type="checkbox" checked={!!v[k]} onChange={(e) => set(k, e.target.checked)} />{label}{req(k)}</label>;
    const money = kind === "money";
    return <div key={k} className={`field ${k === "title" ? "full" : ""}`}><label>{label}{req(k)}</label>
      <input className="input" inputMode={money || kind === "num" || kind === "year" ? "numeric" : undefined} placeholder={kind === "text" || kind === "year" ? extra || "" : ""} value={v[k] || ""} onChange={(e) => set(k, money || kind === "num" || kind === "year" ? e.target.value.replace(/\D/g, "") : e.target.value)} />
      {money && v[k] && <span className="tiny muted">{fmtPrice(v[k])}</span>}</div>;
  };

  const head = step === 0 ? SECTION[type] : STEP_HEAD[step];
  return (
    <PostLayout type={type} steps={STEPS} step={step} onStep={(i) => { setErr(""); setStep(i); }} section={head[0]} sub={head[1]} error={err}
      preview={{ cover, title: v.title, price: type === "invest" ? v.target : v.price, per: type === "stay" ? " / night" : type === "invest" ? " to raise" : "", location: [v.area, v.district].filter(Boolean).join(", "), facts: [v.subtype, v.rooms && v.rooms + " rooms", v.guests && v.guests + " guests", v.units && v.units + " units", v.completion && "Handover " + v.completion, v.min && type === "invest" && "Min " + fmtPrice(v.min)] }}
      actions={<>
        {step > 0 ? <button className="btn btn-ghost" onClick={() => setStep(step - 1)}><ArrowLeft size={16} /> Back</button> : <Link to="/" className="btn btn-ghost">Cancel</Link>}
        {step < STEPS.length - 1 ? <button className="btn btn-primary" onClick={next}>Continue</button>
          : <button className="btn btn-primary" disabled={!verified} onClick={submit}>{editing ? "Send changes for review" : "Send for review"}</button>}
      </>}>
      {editing && <div className="pl-note"><Clock size={18} /><span>Editing <b>{editing.title}</b>. Saving sends it for review again.</span></div>}
      {step === 0 && <div className="form-grid">{FIELDS[type].map(field)}</div>}
      {step === 1 && <div className="form-grid">
        <div className="field"><label>District *</label><select className="select" value={v.district || ""} onChange={(e) => set("district", e.target.value)}><option value="">Select district</option>{DISTRICTS.map((d) => <option key={d}>{d}</option>)}</select></div>
        <div className="field"><label>Area *</label><input className="input" value={v.area || ""} onChange={(e) => set("area", e.target.value)} placeholder="e.g. Lakeside, Pokhara" /></div>
        <div className="field full"><label>Full address</label><input className="input" value={v.address || ""} onChange={(e) => set("address", e.target.value)} placeholder="Street, tole and ward. Shown only after an enquiry." /></div>
      </div>}
      {step === 2 && <>
        <div className="field"><label>Cover photo *</label>
          {cover ? <div className="thumbs" style={{ gridTemplateColumns: "minmax(0, 320px)" }}><div style={{ aspectRatio: "4/3" }}><img src={cover} alt="" /><button type="button" onClick={() => setCover(null)} aria-label="Remove"><X size={14} /></button></div></div>
            : <label className="drop"><Upload size={26} style={{ margin: "0 auto 8px" }} />Click to upload the main photo<input type="file" accept="image/*" hidden onChange={(e) => addPhotos(e.target.files, true)} /></label>}
        </div>
        <div className="field"><label>More photos ({gallery.length} of 12)</label>
          <label className="drop"><Upload size={22} style={{ margin: "0 auto 8px" }} />Add more photos<input type="file" accept="image/*" multiple hidden onChange={(e) => addPhotos(e.target.files, false)} /></label>
          {gallery.length > 0 && <div className="thumbs">{gallery.map((g, i) => <div key={i}><img src={g} alt="" /><button type="button" onClick={() => setGallery(gallery.filter((_, k) => k !== i))} aria-label="Remove"><X size={14} /></button></div>)}</div>}
        </div>
      </>}
      {step === 3 && <>
        <div className="form-grid">
          <div className="field"><label>Contact name</label><input className="input" value={v.name || ""} onChange={(e) => set("name", e.target.value)} /></div>
          <div className="field"><label>Contact phone *</label><input className="input" type="tel" value={v.phone || ""} onChange={(e) => set("phone", e.target.value)} placeholder="98XXXXXXXX" /></div>
          <div className="field full"><label>Description</label><textarea className="textarea" value={v.description || ""} onChange={(e) => set("description", e.target.value)} placeholder="What makes it worth a look: location, view, nearby places, papers ready" /></div>
        </div>
        {!verified && <EmailVerify user={user} onVerified={(email) => { setVerified(true); set("email", email); setErr(""); }} />}
        <p className="small muted" style={{ margin: 0 }}>Every post is checked by our team before it goes live. You can follow it in My profile → My properties.</p>
      </>}
    </PostLayout>
  );
}
