import { useState } from "react";
import { MessageSquareText, CalendarDays } from "lucide-react";
import { api } from "../api/endpoints";
import { toList } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { useApp } from "../context/AppContext";
import { Stars, Avatar } from "./ui";
import { timeAgo } from "../utils/format";
import { addMessage } from "../utils/threads";

const REASONS = ["More details", "Price", "Site visit", "Documents"];

export function ContactForm({ agentId, agentName, agentPhoto, propertyId, propertyName, compact, to = "agent" }) {
  const { user, toast } = useApp();
  const [f, setF] = useState({ name: user?.user_name || "", email: user?.email || "", phone: user?.phone || "", message: propertyName ? `Hi, I am interested in "${propertyName}". Please share more details.` : "", terms: true, reasons: [] });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      if (to === "owner") {
        await api.contactOwner({ name: f.name, email: f.email, mobile_number: "+977" + f.phone.replace(/^\+?977/, ""), property_id: propertyId, terms_agrement: f.terms ? "yes" : "no", reasons: f.reasons, reason_other: f.message, preferred_contact_time: "", preferred_date: "" });
      } else {
        await api.contactAgent({
          agent_id: agentId, property_id: propertyId, name: f.name, email: f.email, phone: f.phone,
          contact_form: `Phone: ${f.phone} | Property: ${propertyName || ""} | Message: ${f.message}`,
          terms_agrement: f.terms ? "yes" : "no", reasons: f.reasons,
        });
      }
      addMessage({ agentId, agentName: to === "owner" ? "Property owner" : agentName, agentPhoto, propertyId, propertyName, text: f.message || f.reasons.join(", ") });
      toast("Message sent. See replies in My profile, Messages.");
      setF({ ...f, message: "" });
    } catch (x) { toast(x.message || "Could not send. Try again."); } finally { setBusy(false); }
  };
  return (
    <form className="stack" style={{ gap: 12 }} onSubmit={submit}>
      <div className="row-wrap" style={{ gap: 6 }}>{REASONS.map((r) => { const on = f.reasons.includes(r); return <button type="button" key={r} className={`chip ${on ? "active" : ""}`} style={{ height: 30, padding: "0 10px", fontSize: 12 }} onClick={() => setF({ ...f, reasons: on ? f.reasons.filter((x) => x !== r) : [...f.reasons, r] })}>{r}</button>; })}</div>
      <input className="input" placeholder="Full name" required value={f.name} onChange={set("name")} />
      <div className={compact ? "stack" : "form-grid"} style={{ gap: 12 }}>
        <input className="input" type="email" placeholder="Email" required value={f.email} onChange={set("email")} />
        <input className="input" type="tel" placeholder="Phone (98XXXXXXXX)" required value={f.phone} onChange={set("phone")} />
      </div>
      <textarea className="textarea" placeholder="Your message" required value={f.message} onChange={set("message")} style={{ minHeight: 96 }} />
      <label className="check"><input type="checkbox" checked={f.terms} onChange={(e) => setF({ ...f, terms: e.target.checked })} />I agree to be contacted about this enquiry.</label>
      <button className="btn btn-primary btn-block" disabled={busy}><MessageSquareText size={16} />{busy ? "Sending…" : to === "owner" ? "Contact owner" : "Contact agency"}</button>
    </form>
  );
}

const TIMES = ["10:00 AM", "11:30 AM", "1:00 PM", "2:30 PM", "4:00 PM"];
export function TourForm({ propertyId }) {
  const { user, toast } = useApp();
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i + 1); return d; });
  const [date, setDate] = useState(days[0].toISOString().slice(0, 10));
  const [time, setTime] = useState(TIMES[1]);
  const [f, setF] = useState({ name: user?.user_name || "", phone: user?.phone || "", email: user?.email || "" });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      await api.scheduleTour({ date, time, name: f.name, email: f.email, phone: f.phone, message_description: "", property_id: propertyId, reasons: ["Site visit"], reason_other: "", preferred_contact_time: time });
      toast("Visit booked. We will confirm by phone.");
    } catch (x) { toast(x.message || "Could not book. Try again."); } finally { setBusy(false); }
  };
  return (
    <form className="stack" style={{ gap: 14 }} onSubmit={submit}>
      <div className="row" style={{ gap: 8, overflowX: "auto", scrollbarWidth: "none" }}>
        {days.map((d) => {
          const v = d.toISOString().slice(0, 10);
          return (
            <button type="button" key={v} onClick={() => setDate(v)} className={`chip ${date === v ? "active" : ""}`} style={{ flexDirection: "column", height: 66, minWidth: 60, gap: 0, borderRadius: "var(--r-md)" }}>
              <span className="tiny">{d.toLocaleDateString("en", { weekday: "short" })}</span>
              <b style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 600, lineHeight: 1.1 }}>{d.getDate()}</b>
            </button>
          );
        })}
      </div>
      <div className="row-wrap" style={{ gap: 8 }}>{TIMES.map((t) => <button type="button" key={t} className={`chip ${time === t ? "active" : ""}`} style={{ height: 34 }} onClick={() => setTime(t)}>{t}</button>)}</div>
      <input className="input" placeholder="Full name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <input className="input" type="tel" placeholder="Phone" required value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
      <input className="input" type="email" placeholder="Email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      <button className="btn btn-primary btn-block" disabled={busy}><CalendarDays size={16} />{busy ? "Booking…" : "Book a visit"}</button>
    </form>
  );
}

export function Reviews({ type, id }) {
  const { user, setAuth, toast } = useApp();
  const { data, loading, reload } = useAsync(() => api.reviews(type, id).then(toList), [type, id]);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const items = data?.items || [];
  const avg = items.length ? items.reduce((s, r) => s + Number(r.rating || 0), 0) / items.length : 0;
  const submit = async (e) => {
    e.preventDefault();
    if (!user) { setAuth("login"); return; }
    try {
      await api.addReview(type === "agent" ? { type, rating, comment, agent_id: id } : { type, rating, comment, property_id: id });
      setComment(""); toast("Thank you for your review."); reload();
    } catch (x) { toast(x.message || "Could not post review."); }
  };
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row" style={{ gap: 14 }}>
        <span className="price-big tnum">{avg ? avg.toFixed(1) : "–"}</span>
        <div><Stars value={avg} /><div className="small muted">{items.length} review{items.length === 1 ? "" : "s"}</div></div>
      </div>
      {loading ? <div className="sk" style={{ height: 60 }} /> : items.slice(0, 6).map((r) => (
        <div className="review" key={r.id}>
          <div className="row" style={{ marginBottom: 8 }}>
            <Avatar src={r.user?.photo} name={r.user?.name || r.user_name || "Guest"} size={36} />
            <div><b style={{ fontWeight: 500, color: "var(--text-strong)" }}>{r.user?.name || r.user_name || "Guest"}</b><div className="tiny muted">{timeAgo(r.created_at)}</div></div>
            <span style={{ marginLeft: "auto" }}><Stars value={r.rating} size={13} /></span>
          </div>
          <p>{r.comment}</p>
          {/* The business's public answer. */}
          {r.reply && <div className="review-reply"><b>Reply from the agency</b><p>{r.reply}</p></div>}
        </div>
      ))}
      <form className="stack" style={{ gap: 10, marginTop: 16 }} onSubmit={submit}>
        <div className="row"><span className="small">Your rating</span><Stars value={rating} size={20} onPick={setRating} /></div>
        <textarea className="textarea" placeholder="Share your experience" required value={comment} onChange={(e) => setComment(e.target.value)} style={{ minHeight: 84 }} />
        <button className="btn btn-outline" style={{ alignSelf: "flex-start" }}>Post review</button>
      </form>
    </div>
  );
}
