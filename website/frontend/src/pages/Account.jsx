import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Loader2, Send, MessageSquare, Eye, EyeOff } from "lucide-react";
import { api } from "../api/endpoints";
import { mockRequest } from "../demo/api/router";
import { useApp } from "../context/AppContext";
import { Avatar, Empty } from "../components/ui";
import { listThreads, addMessage } from "../utils/threads";
import { timeAgo } from "../utils/format";
import { useSEO } from "../utils/seo";

export function Messages() {
  useSEO("Messages", undefined, { noindex: true });
  const [threads, setThreads] = useState(listThreads);
  const [active, setActive] = useState(threads[0]?.id);
  const [text, setText] = useState("");
  const { toast, user } = useApp();
  useEffect(() => { const h = () => setThreads(listThreads()); window.addEventListener("sheetal:threads", h); return () => window.removeEventListener("sheetal:threads", h); }, []);
  const t = threads.find((x) => x.id === active) || threads[0];
  const send = async (e) => {
    e.preventDefault();
    if (!text.trim() || !t) return;
    addMessage({ ...t, text });
    setText("");
    try { await api.contactAgent({ agent_id: t.agentId, property_id: t.propertyId, name: user?.user_name || "", email: user?.email || "", phone: user?.phone || "", contact_form: `Property: ${t.propertyName || ""} | Message: ${text}`, terms_agrement: "yes" }); }
    catch { toast("Saved here, but could not reach the agent right now."); }
  };
  if (!threads.length) return <Empty icon={MessageSquare} title="No messages yet">Contact an agent from any property page and the conversation appears here. <Link to="/search">Browse listings</Link></Empty>;
  return (
    <div className="chat">
      <div className="chat-list">
        {threads.map((x) => (
          <button key={x.id} className={x.id === t?.id ? "on" : ""} onClick={() => setActive(x.id)}>
            <Avatar src={x.agentPhoto} name={x.agentName} size={40} />
            <span style={{ minWidth: 0 }}>
              <b style={{ display: "block", fontWeight: 500, color: "var(--text-strong)" }}>{x.agentName}</b>
              <span className="tiny muted" style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.propertyName || "General enquiry"}</span>
            </span>
            <span className="tiny muted" style={{ marginLeft: "auto", whiteSpace: "nowrap" }}>{timeAgo(x.updated)}</span>
          </button>
        ))}
      </div>
      <div className="chat-body">
        <div className="row" style={{ padding: "14px 20px", borderBottom: "1px solid var(--line)" }}>
          <b style={{ fontWeight: 500, color: "var(--text-strong)" }}>{t.agentName}</b>
          {t.propertyId && <Link to={`/property/${t.propertyId}`} className="link small" style={{ marginLeft: "auto" }}>View property</Link>}
        </div>
        <div className="chat-msgs">{t.messages.map((m, i) => <div key={i} className={`bubble ${m.me ? "me" : ""}`}>{m.text}<div className="tiny" style={{ opacity: .7, marginTop: 4 }}>{timeAgo(m.at)}</div></div>)}</div>
        <form className="row" style={{ padding: 12, borderTop: "1px solid var(--line)", gap: 8 }} onSubmit={send}>
          <input className="input" placeholder="Write a message" value={text} onChange={(e) => setText(e.target.value)} />
          <button className="btn btn-primary btn-icon" aria-label="Send"><Send size={16} /></button>
        </form>
      </div>
    </div>
  );
}

export function VerifyEmail() {
  useSEO("Verify email", undefined, { noindex: true });
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { loadUser, toast } = useApp();
  const [state, setState] = useState("Verifying your account…");
  useEffect(() => {
    const run = async () => {
      const q = params.get("queryURL");
      if (!q) { setState("This verification link is not valid."); return; }
      try {
        let res;
        res = await mockRequest("get", "/email/verify/demo");
        if (res?.token) { localStorage.setItem("sheetal_token", res.token); await loadUser(); toast("Email verified. You are logged in."); nav("/"); }
        else { setState(res?.message || "Email verified. You can log in now."); }
      } catch (e) { setState(e.response?.data?.message || "Verification failed. The link may have expired."); }
    };
    run();
  }, []);  
  return <div className="container"><Empty icon={Loader2} title={state}><Link to="/">Go to home</Link></Empty></div>;
}

export function ResetPassword() {
  useSEO("Reset password", undefined, { noindex: true });
  const { token } = useParams();
  const nav = useNavigate();
  const { toast, setAuth } = useApp();
  const [f, setF] = useState({ email: "", password: "", password_confirmation: "" });
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const submit = async (e) => {
    e.preventDefault(); setErr("");
    if (f.password !== f.password_confirmation) return setErr("Passwords do not match.");
    try { const r = await api.resetPassword({ token, ...f }); toast(r?.message || "Password reset."); nav("/"); setAuth("login"); }
    catch (x) { setErr(x.errors ? Object.values(x.errors).flat()[0] : x.message); }
  };
  return (
    <div className="container section" style={{ maxWidth: 480 }}>
      <form className="card card-pad stack" onSubmit={submit}>
        <h2>Set a new password</h2>
        <div className="field"><label>Email</label><input className="input" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <div className="field"><label>New password</label><div style={{ position: "relative" }}><input className="input" type={show ? "text" : "password"} required minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /><button type="button" className="btn btn-ghost btn-icon" style={{ position: "absolute", right: 3, top: 3 }} onClick={() => setShow(!show)}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></div>
        <div className="field"><label>Confirm password</label><input className="input" type="password" required value={f.password_confirmation} onChange={(e) => setF({ ...f, password_confirmation: e.target.value })} /></div>
        {err && <p className="error">{err}</p>}
        <button className="btn btn-primary btn-lg">Reset password</button>
      </form>
    </div>
  );
}
