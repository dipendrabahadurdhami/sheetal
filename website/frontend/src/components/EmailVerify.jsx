import { useEffect, useState } from "react";
import { MailCheck } from "lucide-react";
import { markEmailVerified } from "../utils/sitePosts";

// Email check before the first post. UI only: any 6-digit code works until the API sends real codes.
export function EmailVerify({ user, onVerified }) {
  const [email, setEmail] = useState(user?.email || "");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [wait, setWait] = useState(0);
  const [err, setErr] = useState("");
  useEffect(() => { if (!wait) return; const t = setTimeout(() => setWait(wait - 1), 1000); return () => clearTimeout(t); }, [wait]);
  const send = () => { if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { setErr("Enter a valid email address."); return; } setErr(""); setSent(true); setWait(30); };
  const verify = () => { if (!/^\d{6}$/.test(code)) { setErr("Enter the 6-digit code from the email."); return; } markEmailVerified(email); onVerified(email); };
  return (
    <div className="card card-pad stack" style={{ gap: 12, borderColor: "var(--c-red)" }}>
      <div className="row" style={{ gap: 10 }}><MailCheck size={20} color="var(--c-red)" /><h4 style={{ margin: 0 }}>Verify your email to post</h4></div>
      <p className="small muted" style={{ margin: 0 }}>We send review updates and enquiries to this address. You only do this once.</p>
      <div className="row-wrap" style={{ gap: 8 }}>
        <input className="input" type="email" value={email} disabled={sent} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" style={{ flex: "1 1 240px" }} />
        {!sent ? <button type="button" className="btn btn-primary" onClick={send}>Send code</button>
          : <button type="button" className="btn btn-ghost btn-sm" disabled={wait > 0} onClick={() => { setSent(false); setCode(""); }}>{wait > 0 ? `Change or resend in ${wait}s` : "Change email or resend"}</button>}
      </div>
      {sent && <div className="row-wrap" style={{ gap: 8 }}>
        <input className="input tnum" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="6-digit code" style={{ flex: "0 1 180px", letterSpacing: ".3em" }} />
        <button type="button" className="btn btn-primary" onClick={verify}>Verify</button>
        <span className="tiny muted" style={{ alignSelf: "center" }}>Code sent to {email}</span>
      </div>}
      {err && <p className="error" style={{ margin: 0 }}>{err}</p>}
    </div>
  );
}
