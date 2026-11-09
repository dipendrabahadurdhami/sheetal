// Signing an agreement a business sent (/sign/<token>): read it, get a code by email, type it and your name to sign.
// Where it fits: the link comes in the email from Business → Agreements; the website API is
// website/backend/src/modules/sign. The agreement itself is the shared printable page (AgreementFrame).
// How it works: an agreement in both languages shows one copy at a time (English or Nepali, each complete on its
// own); the page's own words follow the copy picked. Once everyone has signed, the page shows the signing record
// and a button to print it or save it as a PDF.
// Rules: no site header or footer; the person signs the agreement as a whole (both copies say the same thing).

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { AgreementFrame } from "@sheetal/shared/components/AgreementFrame";
import { docLangs, printAgreement } from "@sheetal/shared/core/agreementDoc";
import { Icon } from "@sheetal/shared/core/icons";
import "@sheetal/shared/styles/platform.css";
import { api } from "../api/endpoints";
import { useSEO } from "../utils/seo";

const W = {
  en: {
    loading: "Loading…", wrong: "This link doesn't work", wrongSub: "It may be old: a newer link replaces it. Check your latest email from the business.",
    from: "Sent by", waiting: "Waiting for", signedAll: "Everyone has signed", cancelled: "Cancelled", youSigned: "You have signed",
    print: "Print or save as PDF", sign: "Sign this agreement", step1: "We'll email a 6-digit code to", send: "Email me the code", resend: "Send a new code",
    code: "Code from the email", name: "Your full name", agree: "I have read this agreement and I agree to it.", submit: "Sign", sending: "Signing…",
    after: "You'll get an email when everyone has signed.", cancelledSub: "The business cancelled this agreement. You don't need to sign it.", tab: "English",
    note: "Signing here records that you agreed, with the time and your device. Keep a copy of the signed agreement.",
  },
  ne: {
    loading: "लोड हुँदैछ…", wrong: "यो लिंक चलेन", wrongSub: "यो पुरानो हुन सक्छ: नयाँ लिंक पठाइएपछि पुरानो चल्दैन। व्यवसायबाट आएको पछिल्लो इमेल हेर्नुहोस्।",
    from: "पठाउने", waiting: "हस्ताक्षर बाँकी", signedAll: "सबैले हस्ताक्षर गर्नुभयो", cancelled: "रद्द गरिएको", youSigned: "तपाईंले हस्ताक्षर गर्नुभयो",
    print: "प्रिन्ट गर्नुहोस् वा PDF बनाउनुहोस्", sign: "यो सम्झौतामा हस्ताक्षर गर्नुहोस्", step1: "६ अङ्कको कोड यो इमेलमा पठाइनेछ:", send: "कोड पठाउनुहोस्", resend: "नयाँ कोड पठाउनुहोस्",
    code: "इमेलमा आएको कोड", name: "तपाईंको पूरा नाम", agree: "मैले यो सम्झौता पढेँ र म यसमा सहमत छु।", submit: "हस्ताक्षर गर्नुहोस्", sending: "हस्ताक्षर हुँदैछ…",
    after: "सबैले हस्ताक्षर गरेपछि तपाईंलाई इमेल आउनेछ।", cancelledSub: "व्यवसायले यो सम्झौता रद्द गरेको छ। हस्ताक्षर गर्नुपर्दैन।", tab: "नेपाली",
    note: "यहाँ हस्ताक्षर गर्दा तपाईं सहमत भएको कुरा समय र उपकरणसहित अभिलेख हुन्छ। हस्ताक्षर भएको प्रति सुरक्षित राख्नुहोस्।",
  },
};

export default function SignAgreement() {
  const { token } = useParams();
  const [doc, setDoc] = useState(null);
  const [err, setErr] = useState(null);
  const [lang, setLang] = useState("en");
  const [f, setF] = useState({ code: "", name: "", agree: false });
  const [fe, setFe] = useState({});
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const w = W[lang];
  useSEO(doc?.title || "Sign agreement", "");

  const load = () => api.signDoc(token).then((r) => { setDoc(r.data); setLang((l) => (r.data.texts[l] != null ? l : docLangs(r.data)[0] || "en")); }).catch((e) => setErr(e));
  useEffect(() => { load(); }, [token]);

  const sendCode = () => {
    setBusy(true); setMsg(""); setFe({});
    api.signCode(token).then((r) => { setMsg(r.message); load(); }).catch((e) => setMsg(e.message)).finally(() => setBusy(false));
  };
  const sign = (e) => {
    e.preventDefault();
    setBusy(true); setMsg(""); setFe({});
    api.sign(token, { code: f.code.trim(), name: f.name.trim(), agree: f.agree }).then((r) => { setMsg(r.message); load(); })
      .catch((x) => { setFe(x.errors || {}); setMsg(x.message); }).finally(() => setBusy(false));
  };

  const page = (body) => <div className="pf-root"><div className="pform-page" style={{ minHeight: "100vh" }}><div className="pform" style={{ maxWidth: 860 }}>{body}</div></div></div>;
  if (err) return page(<div className="pform-card pform-done"><span className="pform-done-ico muted"><Icon name="info" size={36} /></span><h2>{err.status === 410 ? w.cancelled : w.wrong}</h2><p>{err.status === 410 ? err.message : w.wrongSub}</p></div>);
  if (!doc) return page(<div className="pform-card pform-done"><p className="muted">{w.loading}</p></div>);

  const langs = docLangs(doc);
  const waiting = doc.signers.filter((s) => s.status !== "signed").map((s) => (lang === "ne" ? s.nameNe || s.name : s.name));
  const err1 = (k) => fe[k] && <span className="pform-err" role="alert"><Icon name="circle-alert" size={14} />{fe[k][0]}</span>;
  return page(<>
    <div className="pform-card pform-top">
      <div className="pform-head">
        <div className="pform-head-text">
          <span className="pform-biz">{w.from}: {doc.business.name} · {doc.ref}</span>
          <h1>{doc.title}</h1>
          <div className="pform-meta">
            {doc.status === "signed" ? <span>{w.signedAll}</span> : doc.status === "cancelled" ? <span>{w.cancelled}</span> : waiting.length ? <span>{w.waiting}: {waiting.join(", ")}</span> : null}
          </div>
        </div>
        {langs.length > 1 && <div className="pf-chips" role="tablist" style={{ marginTop: 12 }}>
          {langs.map((l) => <button key={l} type="button" role="tab" aria-selected={lang === l} className={`chip ${lang === l ? "active" : ""}`} onClick={() => setLang(l)}>{W[l].tab}</button>)}
        </div>}
      </div>
    </div>

    <AgreementFrame doc={doc} lang={lang} title={doc.title} />

    {doc.status === "signed" && <div className="pform-card pform-done">
      <span className="pform-done-ico"><Icon name="circle-check" size={36} /></span><h2>{w.signedAll}</h2>
      <button type="button" className="pform-btn" onClick={() => printAgreement(doc)}><Icon name="printer" size={16} />{w.print}</button>
    </div>}
    {doc.status === "cancelled" && <div className="pform-card pform-done"><h2>{w.cancelled}</h2><p>{doc.cancelNote || w.cancelledSub}</p></div>}
    {doc.status === "sent" && doc.me.signed && <div className="pform-card pform-done"><span className="pform-done-ico"><Icon name="circle-check" size={36} /></span><h2>{w.youSigned}</h2><p>{w.after}</p></div>}
    {doc.status === "sent" && !doc.me.signed && (
      <form className="pform-card pform-body" onSubmit={sign} noValidate>
        <h2 style={{ margin: 0 }}>{w.sign}</h2>
        <p className="pform-help" style={{ margin: 0 }}>{w.step1} <b>{doc.me.email}</b></p>
        <div className="pform-actions" style={{ justifyContent: "flex-start" }}>
          <button type="button" className="pform-btn ghost" disabled={busy || doc.me.codesLeft < 1} onClick={sendCode}><Icon name="mail" size={16} />{doc.me.codeSent ? w.resend : w.send}</button>
        </div>
        <div className="pform-grid">
          <div className="pform-q half"><label className="pform-label" htmlFor="code">{w.code}</label>
            <input id="code" className="pform-in" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.replace(/\D/g, "") })} />{err1("code")}</div>
          <div className="pform-q half"><label className="pform-label" htmlFor="name">{w.name}</label>
            <input id="name" className="pform-in" autoComplete="name" value={f.name} placeholder={doc.me.name} onChange={(e) => setF({ ...f, name: e.target.value })} />{err1("name")}</div>
          <label className="pform-opt" style={{ gridColumn: "1 / -1" }}><input type="checkbox" checked={f.agree} onChange={(e) => setF({ ...f, agree: e.target.checked })} />{w.agree}</label>
          {err1("agree")}
        </div>
        {msg && <span className="pform-help" role="status">{msg}</span>}
        <div className="pform-actions"><button type="submit" className="pform-btn" disabled={busy || f.code.length !== 6 || f.name.trim().length < 2 || !f.agree}><Icon name="pen-line" size={16} />{busy ? w.sending : w.submit}</button></div>
        <span className="pform-note">{w.note}</span>
      </form>
    )}
    {doc.status !== "sent" || doc.me.signed ? (msg && <p className="pform-help" role="status" style={{ textAlign: "center" }}>{msg}</p>) : null}
  </>);
}
