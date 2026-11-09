// A business's online form, opened from its link (/f/<slug>): the person fills it in and it goes to the business's Inbox.
// Where it fits: businesses build and share the forms in Business → Forms; the website API serves them
// (website/backend/src/modules/forms). The form itself is the shared FormView, the same as the builder's preview.
// How it works: loads the live form, shows the robot check when Sheetal has switched it on, reads any files and sends
// everything in one request. Field errors from the server show next to their questions.
// Rules: no site header or footer, so the business's own look leads; files up to 5 MB (PDF or photo).

import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { FormView } from "@sheetal/shared/components/FormView";
import { CATALOG } from "@sheetal/shared/data/catalog";
import { Icon } from "@sheetal/shared/core/icons";
import "@sheetal/shared/styles/platform.css";
import { api } from "../api/endpoints";
import { useSEO } from "../utils/seo";

const readBase64 = (file) => new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] || ""); r.onerror = () => fail(new Error("Couldn't read that file.")); r.readAsDataURL(file); });
const TURNSTILE = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  return new Promise((ok, fail) => {
    let s = document.querySelector(`script[src="${TURNSTILE}"]`);
    if (!s) { s = document.createElement("script"); s.src = TURNSTILE; s.async = true; document.head.appendChild(s); }
    s.addEventListener("load", () => ok(window.turnstile));
    s.addEventListener("error", () => fail(new Error("The robot check didn't load.")));
  });
}

/** Cloudflare's "I'm not a robot" box; tells the page its token (null when it expires). */
function RobotCheck({ siteKey, onToken, resetRef }) {
  const box = useRef(null);
  useEffect(() => {
    let id = null, gone = false;
    loadTurnstile().then((ts) => {
      if (gone || !box.current) return;
      id = ts.render(box.current, { sitekey: siteKey, callback: (t) => onToken(t), "expired-callback": () => onToken(null), "error-callback": () => onToken(null) });
      resetRef.current = () => { onToken(null); ts.reset(id); };
    }).catch(() => {});
    return () => { gone = true; if (id != null && window.turnstile) window.turnstile.remove(id); };
  }, [siteKey]);
  return <div ref={box} style={{ margin: "4px 0 12px" }} />;
}

export default function PublicForm() {
  const { slug } = useParams();
  const [form, setForm] = useState(null);
  const [missing, setMissing] = useState(false);
  const [token, setToken] = useState(null);
  const [trap, setTrap] = useState("");
  const reset = useRef(() => {});
  useSEO(form?.title || "Form", form?.desc || "");
  useEffect(() => {
    let gone = false;
    api.form(slug).then((r) => { if (!gone) setForm(r.data); }).catch(() => { if (!gone) setMissing(true); });
    return () => { gone = true; };
  }, [slug]);

  const submit = async (_ans, vals) => {
    const answers = {};
    for (const f of form.fields) {
      const v = vals[f.id];
      if (v == null || v === "") continue;
      if ((f.type === "file" || f.type === "payment") && v.file) answers[f.id] = { name: v.name, data: await readBase64(v.file) };
      else if (f.type === "money") answers[f.id] = String(v).replace(/\D/g, "");
      else answers[f.id] = v;
    }
    try {
      return await api.formSubmit(slug, { answers, captcha: token, website: trap });
    } catch (e) {
      reset.current();
      throw e;
    }
  };

  const page = (body) => <div className="pf-root"><div className="pform-page" style={{ "--fa": form?.style?.accent || undefined, minHeight: "100vh" }}>{body}</div></div>;
  if (missing) return page(<div className="pform"><div className="pform-card pform-done"><span className="pform-done-ico muted"><Icon name="info" size={36} /></span><h2>This form isn't open</h2><p>The link may be wrong, or the business closed the form.</p></div></div>);
  if (!form) return page(<div className="pform"><div className="pform-card pform-done"><p className="muted">Loading…</p></div></div>);
  return page(
    <FormView form={form} business={form.business} districts={CATALOG.districts} closed={form.closed} onSubmit={submit}
      footer={<>
        {/* Spam trap: hidden from people, filled by simple bots. */}
        <input type="text" name="website" tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }} />
        {form.captcha && <RobotCheck siteKey={form.captcha} onToken={setToken} resetRef={reset} />}
      </>} />
  );
}
