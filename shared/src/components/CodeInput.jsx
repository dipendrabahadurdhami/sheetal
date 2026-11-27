// The 6-digit sign-in code box, used by the website's login window and the business panel's sign-in page.
// How it works: one real input (so the phone keyboard can offer the code from Gmail, Mail or an SMS: autocomplete="one-time-code"),
// drawn as six boxes. Typing, pasting or a keyboard suggestion fills it; at 6 digits it calls onComplete by itself. When the browser
// supports reading the code from an SMS (WebOTP, Android Chrome) it fills that too, ready for when codes also go by SMS.

import React, { useEffect, useRef } from "react";

export function CodeInput({ value, onChange, onComplete, disabled, autoFocus = true, label = "6-digit code" }) {
  const ref = useRef(null);
  const done = useRef("");
  const set = (raw) => {
    const v = String(raw || "").replace(/\D/g, "").slice(0, 6);
    onChange(v);
    if (v.length === 6 && done.current !== v) { done.current = v; onComplete?.(v); }
    if (v.length < 6) done.current = "";
  };
  useEffect(() => {
    if (!("OTPCredential" in window) || disabled) return undefined;
    const ac = new AbortController();
    navigator.credentials.get({ otp: { transport: ["sms"] }, signal: ac.signal }).then((o) => o?.code && set(o.code)).catch(() => {});
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);
  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);

  return (
    <label className="code-in" onClick={() => ref.current?.focus()}>
      <span className="sr-only">{label}</span>
      <input ref={ref} className="code-in-real" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6}
        value={value} disabled={disabled} onChange={(e) => set(e.target.value)} onPaste={(e) => { e.preventDefault(); set(e.clipboardData.getData("text")); }} aria-label={label} />
      <span className="code-in-boxes" aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => <i key={i} className={i === value.length ? "cur" : value[i] ? "full" : ""}>{value[i] || ""}</i>)}
      </span>
    </label>
  );
}
