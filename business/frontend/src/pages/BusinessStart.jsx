// Sheetal Business for someone not signed in: the plans first, then sign in or create an account right here, then the emailed code.
// Where it fits: BusinessApp.jsx shows it instead of the old "Sign in on the website" card. The account is the same Sheetal account as the
// website (siteAuth.js talks to the website API), so one email and password work everywhere.
// How it works: 1) plans from GET /public/packs (live prices, 1 / 6 / 12 months); "Choose" remembers the plan for the Plans page.
// 2) sign in (email + password) or create an account (name, email, phone, business name and type, password). 3) the 6-digit code sent
// by email (CodeInput fills from the phone keyboard). Done: the token is kept for 7 days of not opening the app, and the panel opens on
// the Plans page with the chosen plan ready to pay (or the overview when no plan was chosen).

import React, { useEffect, useState } from "react";
import { Icon } from "@sheetal/shared/core/icons";
import { CodeInput } from "@sheetal/shared/components/CodeInput";
import { keepSignIn, savePick, siteCall } from "../siteAuth";

const LENGTHS = [[1, "Monthly"], [6, "6 months"], [12, "1 year"]];
const PER = { 1: "a month", 6: "for 6 months", 12: "for 1 year" };
const TYPES = [["agency", "Real estate agency", "house"], ["hotel", "Hotel or resort", "hotel"], ["host", "Homestay or holiday home", "bed-double"], ["developer", "Housing developer", "building-2"], ["sponsor", "Investment sponsor", "hand-coins"]];
const rs = (paisa) => `Rs. ${Math.round(paisa / 100).toLocaleString("en-IN")}`;
const errOf = (x) => (x?.errors ? Object.values(x.errors).flat()[0] : x?.message) || "Something went wrong.";

export function BusinessStart() {
  const [step, setStep] = useState("plans"); // plans | account | code
  const [mode, setMode] = useState("signin"); // signin | signup
  const [data, setData] = useState(null);
  const [loadErr, setLoadErr] = useState("");
  const [months, setMonths] = useState(12);
  const [pick, setPick] = useState(null); // pack id, or "free"
  useEffect(() => { siteCall("GET", "/public/packs").then((r) => setData(r.data || r)).catch((e) => setLoadErr(e.message)); }, []);
  useEffect(() => { window.scrollTo({ top: 0, behavior: "smooth" }); }, [step]);
  const packs = data?.packs || [];
  const software = data?.software || [];
  const chosen = packs.find((p) => p.id === pick);

  const choose = (id) => { setPick(id); setMode("signup"); setStep("account"); };
  const signIn = () => { setMode("signin"); setStep("account"); };

  return (
    <div className="bs">
      <header className="bs-top">
        <a href="/" className="brand bs-brand"><img src="/brand/logo-mark.png" alt="" /><span className="brand-word"><b>SHEETAL</b><span>BUSINESS</span></span></a>
        {step === "plans" ? <button type="button" className="btn btn-outline btn-sm" onClick={signIn}>Sign in</button>
          : <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStep("plans")}><Icon name="arrow-left" size={15} /> Plans</button>}
      </header>

      {step === "plans" && (
        <main className="bs-main bs-fade">
          <section className="bs-hero">
            <span className="tier">Sheetal Technologies</span>
            <h1>Run your business on Sheetal</h1>
            <p>CRM, accounting, HRM, property, hotel and project software that work together. Pick a plan, then sign in or create your account in a minute.</p>
            <div className="seg bs-seg" role="radiogroup" aria-label="How long">{LENGTHS.map(([m, l]) => <button key={m} type="button" role="radio" aria-checked={months === m} className={months === m ? "on" : ""} onClick={() => setMonths(m)}>{l}{m > 1 && <small>{m === 6 ? " −10%" : " −20%"}</small>}</button>)}</div>
          </section>
          {loadErr ? <div className="card card-pad bs-err"><p>{loadErr}</p><button type="button" className="btn btn-outline btn-sm" onClick={() => window.location.reload()}>Try again</button></div> : (
            <div className="bs-packs">
              {(packs.length ? packs : [0, 1, 2]).map((p, i) => p === i ? <div key={i} className="card bs-pack sk" style={{ height: 420 }} /> : (() => {
                const pr = p.periods.find((x) => x.months === months);
                return (
                  <div key={p.id} className={`card bs-pack ${p.highlight ? "hi" : ""}`}>
                    {p.highlight && <span className="bs-badge"><Icon name="sparkles" size={13} /> Most popular</span>}
                    <h2>{p.name.en}</h2>
                    <p className="small muted">{p.tagline.en}</p>
                    <div className="bs-price">
                      {pr.onOffer && <span className="tag tag-red">{p.offerLabel?.en || "Offer"}</span>}
                      <div><b>{rs(pr.pricePaisa)}</b> <span className="small muted">{PER[months]}</span></div>
                      {pr.onOffer ? <span className="small muted"><s>{rs(pr.normalPaisa)}</s> normal price</span> : <span className="small">&nbsp;</span>}
                    </div>
                    <ul className="bs-feats">
                      <li><Icon name="check" size={15} /> Free website listings (Sheetal CMS)</li>
                      {software.filter((s) => !s.free).map((s) => {
                        const has = p.software.includes(s.id);
                        return <li key={s.id} className={has ? "" : "off"}><Icon name={has ? "check" : "x"} size={15} /> {s.name.en.replace(/^Sheetal /, "")}</li>;
                      })}
                    </ul>
                    <button type="button" className={`btn ${p.highlight ? "btn-primary" : "btn-outline"} btn-block`} onClick={() => choose(p.id)}>Choose {p.name.en} <Icon name="arrow-right" size={15} /></button>
                  </div>
                );
              })())}
            </div>
          )}
          <div className="bs-under">
            <button type="button" className="link" onClick={() => choose("free")}>Only want to post listings? Start free, no plan needed</button>
            <span className="muted small">Prices include 13% VAT. Pay with eSewa, Khalti, Fonepay or bank transfer.</span>
            <a className="link small" href="/technology#demo">Want to see it first? Request a demo</a>
          </div>
        </main>
      )}

      {step !== "plans" && (
        <main className="bs-main bs-narrow bs-fade">
          {pick && (
            <div className="bs-chosen">
              <Icon name={pick === "free" ? "globe" : "layers"} size={17} />
              <span>{pick === "free" ? <>Free: <b>website listings</b></> : <>Plan: <b>{chosen?.name.en}</b> · {LENGTHS.find((l) => l[0] === months)[1]}</>}</span>
              <button type="button" className="link small" onClick={() => setStep("plans")}>Change</button>
            </div>
          )}
          <Account mode={mode} setMode={setMode} step={step} setStep={setStep} pick={pick} months={months} />
        </main>
      )}
    </div>
  );
}

function Account({ mode, setMode, step, setStep, pick, months }) {
  const [f, setF] = useState({ name: "", email: "", phone: "", business: "", type: "agency", password: "" });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [ticket, setTicket] = useState(null);
  const [code, setCode] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const done = (res) => {
    keepSignIn(res);
    if (pick && pick !== "free") savePick(pick, months);
    window.location.assign(pick && pick !== "free" ? "/business/plans" : "/business/");
  };
  const startLogin = async () => {
    const r = await siteCall("POST", "/login", { email: f.email.trim().toLowerCase(), password: f.password });
    if (r.otp_required) { setTicket(r); setCode(""); setStep("code"); return; }
    done(r);
  };
  const submit = async (e) => {
    e.preventDefault(); setErr(""); setNote(""); setBusy(true);
    try {
      if (mode === "signup") {
        await siteCall("POST", "/register", { user_name: f.name, email: f.email.trim().toLowerCase(), password: f.password, password_confirmation: f.password, user_type: "Agent", business_name: f.business || undefined, business_type: f.type, phone: f.phone || undefined });
      }
      await startLogin();
    } catch (x) {
      if (x.status === 409) { setMode("signin"); setErr("This email already has a Sheetal account. Sign in with its password."); }
      else setErr(errOf(x));
    } finally { setBusy(false); }
  };
  const verify = async (c = code) => {
    if (!/^\d{6}$/.test(c) || busy) return;
    setErr(""); setBusy(true);
    try { done(await siteCall("POST", "/login/code", { ticket: ticket.ticket, code: c })); }
    catch (x) { setErr(errOf(x)); setCode(""); if (/sign in again|expired/i.test(x.message || "")) { setStep("account"); setTicket(null); } }
    finally { setBusy(false); }
  };
  const resend = async () => {
    setErr("");
    try { const r = await siteCall("POST", "/login/code/resend", { ticket: ticket.ticket }); setNote(r.message); }
    catch (x) { setErr(errOf(x)); }
  };
  const forgot = async () => {
    setErr(""); setNote("");
    if (!/\S+@\S+\.\S+/.test(f.email)) { setErr("Type your email first, then tap Forgot password."); return; }
    try { const r = await siteCall("POST", "/forgot-password", { email: f.email.trim().toLowerCase() }); setNote(r.message || "If the email has an account, a reset link is on its way."); }
    catch (x) { setErr(errOf(x)); }
  };

  if (step === "code") {
    return (
      <form className="card bs-card" onSubmit={(e) => { e.preventDefault(); verify(); }}>
        <span className="bs-ico"><Icon name="mail-check" size={26} /></span>
        <h1>Check your email</h1>
        <p className="muted">We sent a 6-digit code to <b>{ticket?.sent_to}</b>. It works for {ticket?.minutes || 10} minutes.</p>
        <CodeInput value={code} onChange={setCode} onComplete={verify} disabled={busy} />
        {err && <p className="bs-error" role="alert">{err}</p>}
        {note && <p className="small muted" role="status">{note}</p>}
        <button className="btn btn-primary btn-lg btn-block" disabled={busy || code.length < 6}>{busy ? "Checking…" : "Verify and continue"}</button>
        <div className="bs-row">
          <button type="button" className="link small" onClick={resend}>Send a new code</button>
          <button type="button" className="link small" onClick={() => { setStep("account"); setTicket(null); setErr(""); }}>Use another account</button>
        </div>
        <p className="tiny muted">Not in your inbox? Look in Spam or Promotions. On a phone, the keyboard may offer the code by itself.</p>
      </form>
    );
  }

  return (
    <form className="card bs-card" onSubmit={submit}>
      <h1>{mode === "signin" ? "Sign in to Sheetal Business" : "Create your account"}</h1>
      <p className="muted small">{mode === "signin" ? "Use your Sheetal Property email and password: one account for the website and the business panel." : "One account for the website and the business panel. Already have one? Sign in instead."}</p>
      <div className="seg bs-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={mode === "signin"} className={mode === "signin" ? "on" : ""} onClick={() => { setMode("signin"); setErr(""); }}>Sign in</button>
        <button type="button" role="tab" aria-selected={mode === "signup"} className={mode === "signup" ? "on" : ""} onClick={() => { setMode("signup"); setErr(""); }}>Create account</button>
      </div>
      {mode === "signup" && <>
        <label className="field"><span>Your name</span><input className="input" required minLength={2} maxLength={60} autoComplete="name" value={f.name} onChange={set("name")} /></label>
        <label className="field"><span>Business name</span><input className="input" required minLength={2} maxLength={80} autoComplete="organization" placeholder="e.g. Lakeside Homestay" value={f.business} onChange={set("business")} /></label>
        <div className="field"><span>What kind of business?</span>
          <div className="bs-types">{TYPES.map(([id, l, ic]) => <button type="button" key={id} className={`bs-type ${f.type === id ? "on" : ""}`} aria-pressed={f.type === id} onClick={() => setF({ ...f, type: id })}><Icon name={ic} size={18} /><span>{l}</span></button>)}</div>
        </div>
        <label className="field"><span>Mobile number</span><input className="input" type="tel" inputMode="tel" maxLength={20} autoComplete="tel" placeholder="98XXXXXXXX" value={f.phone} onChange={set("phone")} /></label>
      </>}
      <label className="field"><span>Email</span><input className="input" type="email" required autoComplete="email" inputMode="email" value={f.email} onChange={set("email")} /></label>
      <label className="field"><span>Password</span>
        <span className="bs-pass">
          <input className="input" type={show ? "text" : "password"} required minLength={mode === "signup" ? 8 : 1} autoComplete={mode === "signin" ? "current-password" : "new-password"} value={f.password} onChange={set("password")} />
          <button type="button" className="btn btn-ghost btn-icon" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"}><Icon name={show ? "eye-off" : "eye"} size={16} /></button>
        </span>
        {mode === "signup" && <small className="muted">At least 8 characters.</small>}
      </label>
      {mode === "signin" && <button type="button" className="link small bs-forgot" onClick={forgot}>Forgot password?</button>}
      {err && <p className="bs-error" role="alert">{err}</p>}
      {note && <p className="small muted" role="status">{note}</p>}
      <button className="btn btn-primary btn-lg btn-block" disabled={busy}>{busy ? "Please wait…" : mode === "signin" ? "Continue" : "Create account and continue"}</button>
      <p className="tiny muted bs-safe"><Icon name="shield-check" size={13} /> For your safety we email you a 6-digit code at each sign-in. You stay signed in on this device until you go a week without opening it.</p>
    </form>
  );
}
