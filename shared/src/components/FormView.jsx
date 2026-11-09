// The online form people fill in: one page or several (page breaks), every field type, checks as they go.
// Where it fits: the website's public form page (/f/:slug), the sample public page and the builder's preview in
// business/frontend (Forms.jsx).
// How it works: values are kept per field id; files stay File objects ({ name, file }) until sending. onSubmit gets the
// answers as [{ x, v, text }] and the raw values; if it throws, the server's field errors show next to the questions.
// Rules: the server checks everything again (backend-core/src/domain/forms.ts); keep both in step.

import React, { useRef, useState } from "react";
import { initials, rs } from "../core/format";
import { Icon } from "../core/icons";
import { CHOICE, FIELD_TYPES, FONTS, SWATCHES } from "../core/forms";

const RANGE = ["number", "money"];
const INPUTS = { short: "text", phone: "tel", email: "email", number: "number", money: "text", date: "date", time: "time" };
const MAX_FILE = 5 * 1024 * 1024;
const fontCss = (k) => (FONTS.find((x) => x[0] === k) || FONTS[0])[2];

const blank = (v) => v == null || v === "" || (Array.isArray(v) && !v.length) || (typeof v === "object" && !Array.isArray(v) && !Object.values(v).some(Boolean));
export function checkField(x, v) {
  const T = FIELD_TYPES[x.type];
  if (T.noAnswer) return null;
  if (x.type === "payment") return x.required && !v?.name ? "Upload the payment screenshot" : null;
  if (blank(v)) return x.required ? (x.type === "file" ? "Upload a file" : CHOICE.includes(x.type) || x.type === "rating" ? "Pick an answer" : "This question is required") : null;
  if (x.type === "location" && x.required && !v.district) return "Pick a district";
  if (x.type === "phone" && String(v).replace(/\D/g, "").length < 10) return "Enter a 10-digit mobile number";
  if (x.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return "Enter an email like you@example.com";
  if (RANGE.includes(x.type)) { const n = Number(String(v).replace(/[^\d.]/g, "")); if (x.min && n < Number(x.min)) return `Minimum is ${x.type === "money" ? rs(x.min) : x.min}`; if (x.max && n > Number(x.max)) return `Maximum is ${x.type === "money" ? rs(x.max) : x.max}`; }
  return null;
}
export const answerText = (x, v) => {
  if (blank(v)) return "";
  if (Array.isArray(v)) return v.join(", ");
  if (x.type === "location") return [v.area, v.district].filter(Boolean).join(", ");
  if (x.type === "payment") return `${rs(x.amount)} · screenshot ${v.name}`;
  if (x.type === "file") return v.name || "";
  if (x.type === "rating") return `${v} of 5`;
  if (x.type === "money") return rs(String(v).replace(/\D/g, ""));
  return String(v);
};

export function FormView({ form, tenant, business, preview, mobile, districts = [], onSubmit, footer, closed }) {
  const st = form.style || {};
  const bizName = business?.name ?? tenant?.name ?? "";
  const logoImg = st.logoUrl || business?.logoUrl;
  const pages = form.fields.reduce((acc, x) => { if (x.type === "page") acc.push([]); else acc[acc.length - 1].push(x); return acc; }, [[]]).filter((p, i, a) => p.length || a.length === 1);
  const [step, setStep] = useState(0);
  const [vals, setVals] = useState({});
  const [errs, setErrs] = useState({});
  const [sent, setSent] = useState(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const top = useRef(null);
  const cur = pages[Math.min(step, pages.length - 1)] || [];
  const last = step >= pages.length - 1;
  const setV = (fid, v) => { setVals((o) => ({ ...o, [fid]: v })); if (errs[fid]) setErrs((o) => ({ ...o, [fid]: null })); };
  const go = (s) => { setStep(s); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const jump = (id) => { const el = document.getElementById(`q-${id}-wrap`); if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 24, behavior: "smooth" }); };
  const next = async (e) => {
    e.preventDefault();
    const er = {}; cur.forEach((x) => { const m = checkField(x, vals[x.id]); if (m) er[x.id] = m; });
    setErrs(er); setProblem("");
    if (Object.keys(er).length) { jump(Object.keys(er)[0]); return; }
    if (!last) { go(step + 1); return; }
    let thanks = form.thanks;
    if (!preview && onSubmit) {
      setBusy(true);
      try {
        const r = await onSubmit(form.fields.filter((x) => !FIELD_TYPES[x.type].noAnswer).map((x) => ({ x, v: vals[x.id], text: answerText(x, vals[x.id]) })), vals);
        if (r?.message) thanks = r.message;
      } catch (x) {
        const fe = x?.errors || {};
        const mine = Object.fromEntries(Object.entries(fe).filter(([k]) => form.fields.some((f) => f.id === k)).map(([k, m]) => [k, Array.isArray(m) ? m[0] : String(m)]));
        if (Object.keys(mine).length) {
          setErrs(mine);
          const first = Object.keys(mine)[0];
          const pg = pages.findIndex((p) => p.some((f) => f.id === first));
          if (pg >= 0 && pg !== step) setStep(pg);
          setTimeout(() => jump(first), 50);
        }
        setProblem(x?.message || "Something went wrong. Please try again.");
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    setSent(thanks || "Thanks! We'll be in touch soon."); window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const anyReq = form.fields.some((x) => x.required);
  const vars = { "--fa": st.accent || SWATCHES[0], "--fr": st.corners === "square" ? "4px" : "16px", fontFamily: fontCss(st.font) };
  return (
    <div className={`pform ${mobile ? "is-mobile" : ""}`} style={vars} ref={top}>
      <div className="pform-card pform-top">
        <div className="pform-head">
          <div className="pform-head-row">
            <span className="pform-logo">{logoImg ? <img src={logoImg} alt="" /> : st.logo || initials(bizName)}</span>
            <div className="pform-head-text">
              {bizName && <span className="pform-biz">{bizName}</span>}
              <h1>{form.title}</h1>{form.desc && <p>{form.desc}</p>}
              {!sent && !closed && (pages.length > 1 || anyReq) && <div className="pform-meta">{pages.length > 1 && <span>Step {step + 1} of {pages.length}</span>}{anyReq && <span className="pform-req">* Required</span>}</div>}
            </div>
          </div>
          {!sent && !closed && pages.length > 1 && <div className="pform-progress" aria-hidden="true"><i style={{ width: `${((step + 1) / pages.length) * 100}%` }} /></div>}
        </div>
      </div>
      {closed ? (
        <div className="pform-card pform-done"><span className="pform-done-ico muted"><Icon name="info" size={36} /></span><h2>This form is closed for now</h2><p>{bizName ? `${bizName} isn't taking new answers this month. Please contact them directly.` : "Please check back later."}</p></div>
      ) : sent ? (
        <div className="pform-card pform-done">
          <span className="pform-done-ico"><Icon name="circle-check" size={40} /></span>
          <h2>Thank you</h2><p>{sent}</p>
          <button type="button" className="pform-link" onClick={() => { setSent(null); setVals({}); setErrs({}); setStep(0); }}>Submit another response</button>
        </div>
      ) : (
        <form className="pform-card pform-body" onSubmit={next} noValidate>
          <div className="pform-grid">{cur.map((x) => <Question key={x.id} x={x} v={vals[x.id]} set={(v) => setV(x.id, v)} err={errs[x.id]} form={form} districts={districts} />)}</div>
          {last && footer}
          {problem && <span className="pform-err" role="alert"><Icon name="circle-alert" size={14} />{problem}</span>}
          <div className="pform-actions">
            {step > 0 && <button type="button" className="pform-btn ghost" onClick={() => go(step - 1)}><Icon name="arrow-left" size={16} />Back</button>}
            <button type="submit" className="pform-btn" disabled={busy}>{busy ? "Sending…" : last ? st.button || "Submit" : "Next"}{!last && <Icon name="arrow-right" size={16} />}</button>
          </div>
          {preview && <span className="pform-note">Preview: answers are not saved.</span>}
        </form>
      )}
    </div>
  );
}

function Question({ x, v, set, err, form, districts }) {
  const id = `q-${x.id}`;
  const cls = `pform-q ${x.half ? "half" : ""} ${err ? "err" : ""}`;
  const [fileErr, setFileErr] = useState("");
  const pickFile = (f, images) => {
    setFileErr("");
    if (!f) { set(null); return; }
    if (f.size > MAX_FILE) { setFileErr("Files can be up to 5 MB."); return; }
    if (images ? !/^image\/(jpeg|png|webp)$/.test(f.type) : !/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(f.type)) { setFileErr(images ? "Use a JPG, PNG or WebP picture." : "Use a PDF or a photo (JPG, PNG or WebP)."); return; }
    set({ name: f.name, file: f });
  };
  if (x.type === "section") return <div className={`${cls} pform-section`}><h2>{x.label}</h2>{x.help && <span className="pform-help">{x.help}</span>}</div>;
  const label = <span className="pform-label" id={`${id}-l`}>{x.label}{x.required && <span className="pform-star"> *</span>}</span>;
  const desc = x.help ? <span className="pform-help">{x.help}</span> : null;
  let input = null;
  if (INPUTS[x.type]) input = <input id={id} className="pform-in" type={INPUTS[x.type]} inputMode={x.type === "money" ? "numeric" : undefined} placeholder={x.ph} value={v || ""} maxLength={x.type === "short" && x.max ? Number(x.max) : undefined}
    aria-labelledby={`${id}-l`} aria-invalid={!!err} onChange={(e) => { const t = e.target.value; if (x.type === "money") { const d = t.replace(/\D/g, ""); set(d ? Number(d).toLocaleString("en-IN") : ""); } else set(x.type === "phone" ? t.replace(/[^\d+ -]/g, "") : t); }} />;
  else if (x.type === "long") input = <><textarea id={id} className="pform-in area" rows={4} placeholder={x.ph} value={v || ""} maxLength={x.max ? Number(x.max) : undefined} aria-labelledby={`${id}-l`} aria-invalid={!!err} onChange={(e) => set(e.target.value)} />{x.max && <span className="pform-count">{(v || "").length} / {x.max}</span>}</>;
  else if (x.type === "single") input = <div className="pform-opts" role="radiogroup" aria-labelledby={`${id}-l`}>{x.opts.map((o) => <label key={o} className="pform-opt"><input type="radio" name={id} checked={v === o} onChange={() => set(o)} />{o}</label>)}</div>;
  else if (x.type === "multi") input = <div className="pform-opts" role="group" aria-labelledby={`${id}-l`}>{x.opts.map((o) => { const a = v || []; return <label key={o} className="pform-opt"><input type="checkbox" checked={a.includes(o)} onChange={(e) => set(e.target.checked ? [...a, o] : a.filter((y) => y !== o))} />{o}</label>; })}</div>;
  else if (x.type === "dropdown") input = <select id={id} className="pform-in" value={v || ""} aria-labelledby={`${id}-l`} onChange={(e) => set(e.target.value)}><option value="">Choose</option>{x.opts.map((o) => <option key={o} value={o}>{o}</option>)}</select>;
  else if (x.type === "rating") input = <div className="pform-stars" role="radiogroup" aria-labelledby={`${id}-l`}>{[1, 2, 3, 4, 5].map((s) => <button key={s} type="button" role="radio" aria-checked={v === s} aria-label={`${s} of 5`} className={v >= s ? "on" : ""} onClick={() => set(s)}><Icon name="star" size={30} /></button>)}</div>;
  else if (x.type === "file") input = <label className="pform-file"><Icon name="upload" size={22} />{v?.name ? <b>{v.name}</b> : "Click to upload"}<small>PDF or photo · up to 5 MB</small><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => pickFile(e.target.files[0], false)} /></label>;
  else if (x.type === "location") { const o = v || {}; input = <div className="pform-two"><select className="pform-in" value={o.district || ""} aria-label="District" onChange={(e) => set({ ...o, district: e.target.value })}><option value="">District</option>{districts.map((d) => <option key={d.id} value={d.en}>{d.en}</option>)}</select><input className="pform-in" placeholder="Area or tole" aria-label="Area" value={o.area || ""} onChange={(e) => set({ ...o, area: e.target.value })} /></div>; }
  else if (x.type === "payment") { const p = form.pay || {}; input = (
    <div className="pform-pay">
      {p.qrUrl ? <img src={p.qrUrl} alt="Payment QR" /> : <span className="pform-qr">Fonepay QR</span>}
      <div className="pform-pay-text"><span>Scan and pay <b>{rs(x.amount)}</b>, then upload the screenshot.</span>
        {p.esewa && <span>eSewa: <b>{p.esewa}</b></span>}{p.bank && <span className="pform-bank">{p.bank}</span>}
        <label className="pform-file sm"><Icon name="upload" size={18} />{v?.name ? <b>{v.name}</b> : "Payment screenshot"}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => pickFile(e.target.files[0], true)} /></label></div>
    </div>); }
  const shown = err || fileErr;
  return <div className={cls} id={id + "-wrap"}>{label}{desc}{input}{shown && <span className="pform-err" role="alert"><Icon name="circle-alert" size={14} />{shown}</span>}</div>;
}
