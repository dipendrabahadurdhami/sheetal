// Sign in, sign up and forgot password, in a modal.
// Rules: Google and phone sign-in stay off until they are connected on the server.

import { useEffect, useState } from "react";
import { Eye, EyeOff, Smartphone, Mail, MailCheck, Store } from "lucide-react";
import { useApp } from "../context/AppContext";
import { api } from "../api/endpoints";
import { apiBase, isLivePath } from "../api/client";

// With the real API, Google and phone sign-in stay off until they are connected (Admin → Setup center).
const LIVE_LOGIN = isLivePath("login");
const NOT_YET = "This sign-in method isn't set up yet. Please use your email and password.";
import { Modal } from "./ui";
import { CodeInput } from "@sheetal/shared/components/CodeInput";

export function AuthModal() {
  const { auth, setAuth, login, verifyCode, toast } = useApp();
  const [f, setF] = useState({ email: "", password: "", user_name: "", confirm: "", user_type: "User" });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [unverified, setUnverified] = useState("");
  const [via, setVia] = useState("email"); // email | phone
  const [phone, setPhone] = useState({ no: "", sent: false, code: "" });
  const [sentTo, setSentTo] = useState("");
  // After the right password: the emailed code step ({ ticket, sent_to }).
  const [pending, setPending] = useState(null);
  const [code, setCode] = useState("");
  useEffect(() => { if (!auth) { setPending(null); setCode(""); } }, [auth]);
  const checkCode = async (c = code) => {
    if (!/^\d{6}$/.test(c) || busy) return;
    setErr(""); setBusy(true);
    try { await verifyCode(pending.ticket, c); setPending(null); setCode(""); }
    catch (x) { setErr(x.errors ? Object.values(x.errors).flat()[0] : x.message); setCode(""); if (/sign in again|expired/i.test(x.message || "")) setPending(null); }
    finally { setBusy(false); }
  };
  const resendCode = async () => {
    try { const r = await api.loginCodeResend(pending.ticket); toast(r?.message || "A new code is on its way."); setErr(""); }
    catch (x) { setErr(x.message); if (/sign in again|expired/i.test(x.message || "")) setPending(null); }
  };
  // With the real API the Google button shows only when the Super Admin has switched Google sign-in on (GET /site says so).
  const [googleOn, setGoogleOn] = useState(false);
  useEffect(() => { if (LIVE_LOGIN && auth) api.site().then((r) => setGoogleOn(!!r?.data?.googleSignIn)).catch(() => {}); }, [auth]);
  const googleLive = () => { setBusy(true); window.location.assign(`${apiBase}/auth/google/start`); };
  // Google: in sample mode, signs in the sample user.
  const google = async () => {
    if (LIVE_LOGIN) { setErr(NOT_YET); return; }
    setBusy(true); try { await login("demo@sheetal.test", "password"); toast("Signed in with Google"); setAuth(null); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const phoneGo = async (e) => {
    e.preventDefault(); setErr("");
    if (!phone.sent) { if (!/^9\d{9}$/.test(phone.no.replace(/\D/g, ""))) return setErr("Enter a 10-digit mobile number starting with 9."); setPhone({ ...phone, sent: true }); toast("Code sent by SMS"); return; }
    if (!/^\d{6}$/.test(phone.code)) return setErr("Enter the 6-digit code.");
    if (LIVE_LOGIN) { setErr(NOT_YET); return; }
    setBusy(true); try { await login("demo@sheetal.test", "password"); toast("Signed in"); setAuth(null); setPhone({ no: "", sent: false, code: "" }); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const close = () => { setAuth(null); setErr(""); };

  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      if (auth === "login") { const otp = await login(f.email, f.password); if (otp?.otp_required) { setPending(otp); setCode(""); } }
      if (auth === "register") {
        if (f.password !== f.confirm) throw new Error("Passwords do not match.");
        const r = await api.register({ user_name: f.user_name, email: f.email, password: f.password, password_confirmation: f.confirm, user_type: f.user_type });
        if (r?.errors) throw new Error(Object.values(r.errors).flat()[0]);
        setSentTo(f.email);
        setAuth("verify");
      }
      if (auth === "forgot") {
        const r = await api.forgot(f.email);
        toast(r?.message || "Reset link sent to your email.");
        setAuth("login");
      }
    } catch (x) {
      if (x.status === 403 && x.data?.must_verify) { setUnverified(x.data.email || f.email); setErr("Please verify your email first."); return; }
      setErr(x.errors ? Object.values(x.errors).flat()[0] : x.message);
    } finally { setBusy(false); }
  };

  const title = pending ? "Check your email" : { login: "Welcome back", register: "Create your account", forgot: "Reset password", verify: "Check your email" }[auth];
  return (
    <Modal open={!!auth} onClose={close}>
      <div className="stack" style={{ gap: 20 }}>
        <div className="stack" style={{ gap: 6 }}>
          <img src="/brand/logo-mark.png" alt="" style={{ height: 34, width: "auto", alignSelf: "flex-start" }} />
          <h2 style={{ fontSize: 26, marginTop: 10 }}>{title}</h2>
          <p className="muted small">{pending ? <>We sent a 6-digit code to <b>{pending.sent_to}</b>. It works for {pending.minutes || 10} minutes.</> : auth === "login" ? "Log in to save homes, post listings and contact agencies." : auth === "register" ? "Join thousands of buyers, owners and agencies." : "Enter your email and we will send a reset link."}</p>
        </div>
        {auth === "login" && !LIVE_LOGIN && <p className="tag tag-soft" style={{ height: "auto", padding: "8px 12px", textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>Demo data login: demo@sheetal.test / password</p>}
        {pending ? (
          <form className="stack" style={{ gap: 14 }} onSubmit={(e) => { e.preventDefault(); checkCode(); }}>
            <CodeInput value={code} onChange={setCode} onComplete={checkCode} disabled={busy} />
            {err && <p className="error">{err}</p>}
            <button className="btn btn-primary btn-lg btn-block" disabled={busy || code.length < 6}>{busy ? "Checking…" : "Verify and log in"}</button>
            <div className="row between small" style={{ gap: 12, flexWrap: "wrap" }}>
              <button type="button" className="link" style={{ background: "none", border: 0, padding: 0 }} onClick={resendCode}>Send a new code</button>
              <button type="button" className="link" style={{ background: "none", border: 0, padding: 0 }} onClick={() => { setPending(null); setCode(""); setErr(""); }}>Use another account</button>
            </div>
            <p className="tiny muted" style={{ margin: 0 }}>Not in your inbox? Look in Spam or Promotions. On a phone, the keyboard may offer the code by itself.</p>
          </form>
        ) : auth === "verify" ? (
          <div className="stack" style={{ gap: 14 }}>
            <MailCheck size={40} strokeWidth={1.5} color="var(--accent)" />
            <p>We sent a link to <b>{sentTo}</b>. Open it to verify your email, then log in.</p>
            <button type="button" className="btn btn-outline" onClick={async () => { try { const r = await api.resendVerification(sentTo); toast(r?.message || "Verification email sent."); } catch (x) { toast(x.message); } }}>Resend email</button>
            <button type="button" className="btn btn-primary btn-block" onClick={() => setAuth("login")}>I've verified, log in</button>
          </div>
        ) : <>
        {/* Google and phone sign-in are not built on the server yet: with the real API they are not offered at all (nothing unfinished is shown at launch). */}
        {auth !== "forgot" && LIVE_LOGIN && googleOn && (
          <button type="button" className="btn btn-outline btn-lg btn-block" onClick={googleLive} disabled={busy} style={{ gap: 10 }}>
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.2-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>
            Continue with Google
          </button>
        )}
        {auth !== "forgot" && !LIVE_LOGIN && <>
          <button type="button" className="btn btn-outline btn-lg btn-block" onClick={google} disabled={busy} style={{ gap: 10 }}>
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.2-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>
            Continue with Google
          </button>
          <div className="seg" style={{ alignSelf: "stretch", display: "grid", gridTemplateColumns: "1fr 1fr" }}>
            <button type="button" className={via === "email" ? "on" : ""} onClick={() => { setVia("email"); setErr(""); }}><Mail size={15} /> Email</button>
            <button type="button" className={via === "phone" ? "on" : ""} onClick={() => { setVia("phone"); setErr(""); }}><Smartphone size={15} /> Phone</button>
          </div>
        </>}
        {via === "phone" && auth !== "forgot" ? (
          <form className="stack" onSubmit={phoneGo}>
            <div className="field"><label>Mobile number</label><input className="input" inputMode="numeric" placeholder="98XXXXXXXX" value={phone.no} onChange={(e) => setPhone({ ...phone, no: e.target.value })} disabled={phone.sent} /></div>
            {phone.sent && <div className="field"><label>6-digit code</label><input className="input" inputMode="numeric" maxLength={6} autoFocus value={phone.code} onChange={(e) => setPhone({ ...phone, code: e.target.value.replace(/\D/g, "") })} /><button type="button" className="link small" style={{ alignSelf: "flex-start", background: "none", border: 0, padding: 0 }} onClick={() => setPhone({ ...phone, sent: false, code: "" })}>Change number</button></div>}
            {err && <p className="error">{err}</p>}
            <button className="btn btn-primary btn-lg btn-block" disabled={busy}>{busy ? "Please wait…" : phone.sent ? "Verify and continue" : "Send code"}</button>
          </form>
        ) : (
        <form className="stack" onSubmit={submit}>
          {auth === "register" && (
            <>
              <div className="field"><label>Full name</label><input className="input" required value={f.user_name} onChange={set("user_name")} /></div>
              <div className="field"><label>I am a</label>
                <div className="seg" style={{ alignSelf: "flex-start" }}>{[["User", "User"], ["Agent", "Agency"], ["Owner", "Owner"]].map(([t, l]) => <button type="button" key={t} className={f.user_type === t ? "on" : ""} onClick={() => setF({ ...f, user_type: t })}>{l}</button>)}</div>
              </div>
            </>
          )}
          <div className="field"><label>Email</label><input className="input" type="email" required value={f.email} onChange={set("email")} autoComplete="email" /></div>
          {auth !== "forgot" && (
            <div className="field"><label>Password</label>
              <div style={{ position: "relative" }}>
                <input className="input" type={show ? "text" : "password"} required minLength={auth === "register" ? 8 : 1} value={f.password} onChange={set("password")} autoComplete={auth === "login" ? "current-password" : "new-password"} />
                <button type="button" className="btn btn-ghost btn-icon" style={{ position: "absolute", right: 3, top: 3 }} onClick={() => setShow(!show)} aria-label="Show password">{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
              </div>
            </div>
          )}
          {auth === "register" && <div className="field"><label>Confirm password</label><input className="input" type="password" required value={f.confirm} onChange={set("confirm")} /></div>}
          {err && <p className="error">{err}</p>}
          {unverified && <button type="button" className="btn btn-outline btn-sm" style={{ alignSelf: "flex-start" }} onClick={async () => { try { const r = await api.resendVerification(unverified); toast(r?.message || "Verification email sent."); } catch (x) { toast(x.message); } }}>Resend verification email</button>}
          {auth === "login" && <button type="button" className="link small" style={{ alignSelf: "flex-end", background: "none", border: 0, padding: 0 }} onClick={() => setAuth("forgot")}>Forgot password?</button>}
          <button className="btn btn-primary btn-lg btn-block" disabled={busy}>{busy ? "Please wait…" : auth === "login" ? "Log in" : auth === "register" ? "Create account" : "Send reset link"}</button>
        </form>
        )}
        </>}
        <p className="small muted" style={{ textAlign: "center" }}>
          {auth === "verify" || pending ? null : auth === "login" ? <>New here? <button className="link" style={{ background: "none", border: 0, padding: 0 }} onClick={() => setAuth("register")}>Create an account</button></>
            : <>Already have an account? <button className="link" style={{ background: "none", border: 0, padding: 0 }} onClick={() => setAuth("login")}>Log in</button></>}
        </p>
        <a href="/business" className="small" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, color: "var(--accent-ink)" }}><Store size={15} /> Hotel, host, agency or developer? List your business</a>
      </div>
    </Modal>
  );
}
