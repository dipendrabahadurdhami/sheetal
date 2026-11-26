// Open jobs (at Sheetal Property and at property businesses on Sheetal) and a job's page with a step-by-step application.
// How it works: the job page shows the key facts, the role in sections and the application in five short steps (about
// you, experience, pay and joining, CV and documents, check and send). The questions come from shared/src/data/jobForm.js;
// the job turns portfolio, references, two-wheeler and on-camera questions on or off. A draft of the answers (not the CV)
// stays in this browser until it is sent. The CV is kept private.

import { clean } from "../utils/sanitize";
import { useSEO } from "../utils/seo";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { MapPin, Briefcase, Clock, Upload, ArrowLeft, Building2, BadgeCheck, Users, Wallet, CalendarDays, GraduationCap, Check, ChevronLeft, ChevronRight, FileText, Send } from "lucide-react";
import { api } from "../api/endpoints";
import { toItem, toList } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { PageHead, Empty, usePaged, Paged } from "../components/ui";
import { fmtDate } from "../utils/format";
import { answerText, applicationSteps } from "@sheetal/shared/data/jobForm";

const tabStyle = (on) => ({
  padding: "14px 4px", marginBottom: -1, fontSize: 15, fontWeight: 500, background: "none", border: 0, cursor: "pointer",
  color: on ? "var(--text-strong)" : "var(--muted)",
  borderBottom: `2px solid ${on ? "var(--accent-ink)" : "transparent"}`,
});
const TYPE = { full_time: "Full time", part_time: "Part time", contract: "Contract", internship: "Internship" };
const typeOf = (j) => TYPE[j.job_type] || j.type;
const npr = (n) => Number(n).toLocaleString("en-IN");
const payOf = (j) => (j.salary_min || j.salary_max ? `NPR ${[j.salary_min, j.salary_max].filter(Boolean).map(npr).join("–")} a month` : null);
const daysLeft = (d) => (d ? Math.ceil((new Date(`${d}T23:59:59`) - Date.now()) / 864e5) : null);

/** The company a job is at: its logo (or an icon), name and the Verified tick. */
function Company({ c, big }) {
  if (!c) return null;
  const size = big ? 40 : 28;
  return (
    <span className="row" style={{ gap: 8, alignItems: "center" }}>
      {c.logo ? <img src={c.logo} alt="" width={size} height={size} style={{ borderRadius: 8, objectFit: "contain", background: "var(--card)", border: "1px solid var(--line)" }} />
        : <span style={{ width: size, height: size, borderRadius: 8, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "var(--accent-soft)" }}><Building2 size={big ? 20 : 15} /></span>}
      <span style={{ fontWeight: 500, color: "var(--text-strong)" }}>{c.name}</span>
      {c.verified && <BadgeCheck size={15} aria-label="Verified" />}
    </span>
  );
}

export function Careers() {
  useSEO("Careers", "Jobs in real estate in Nepal: sales, marketing and property management at Sheetal Property and property businesses.");
  const { data, loading } = useAsync(() => api.jobs().then(toList), []);
  const all = data?.items || [];
  const [dept, setDept] = useState("All");
  const [who, setWho] = useState("all");
  const others = all.some((j) => j.company && !j.company.own);
  const mine = who === "all" ? all : all.filter((j) => !!j.company?.own === (who === "sheetal"));
  const depts = useMemo(() => ["All", ...Array.from(new Set(mine.map((j) => j.department).filter(Boolean)))], [mine]);
  const items = dept === "All" || !depts.includes(dept) ? mine : mine.filter((j) => j.department === dept);
  const pg = usePaged(items, 10);
  return (
    <>
      <div className="tools-hero careers-hero">
        <PageHead title="Careers">Open jobs at Sheetal Property and at property businesses across Nepal.</PageHead>
      </div>

      <div className="container" style={{ paddingTop: 24 }}>
        {others && (
          <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            {[["all", "All jobs"], ["sheetal", "At Sheetal Property"], ["others", "At other companies"]].map(([id, label]) => (
              <button key={id} type="button" className={`btn btn-sm ${who === id ? "btn-primary" : "btn-outline"}`} onClick={() => { setWho(id); setDept("All"); }}>{label}</button>
            ))}
          </div>
        )}
        {depts.length > 2 && (
          <div className="row" style={{ gap: 28, flexWrap: "wrap", borderBottom: "1px solid var(--line)", marginBottom: 24 }}>
            {depts.map((d) => (
              <button key={d} type="button" style={tabStyle(d === dept)} onClick={() => setDept(d)}>{d === "All" ? "All roles" : d}</button>
            ))}
          </div>
        )}

        {loading ? <div className="sk" style={{ height: 300 }} /> : !items.length ? <Empty icon={Briefcase} title="No open roles right now">Send your CV to careers@sheetalproperty.com.</Empty> : (
          <div className="card" style={{ padding: "0 32px" }} ref={pg.top}>
            {pg.items.map((j) => {
              const left = daysLeft(j.deadline);
              return (
                <Link key={j.id} to={`/careers/${j.slug}`} className="job-row">
                  <div className="stack" style={{ gap: 8, minWidth: 0 }}>
                    <div className="row" style={{ gap: 10, flexWrap: "wrap" }}><Company c={j.company} />{j.department && <span className="tier">{j.department}</span>}</div>
                    <h3 style={{ fontSize: 20 }}>{j.title}</h3>
                    <div className="job-meta">
                      <span><MapPin size={14} />{j.location}</span>
                      <span><Clock size={14} />{typeOf(j)}</span>
                      <span><Users size={14} />{j.vacancies_text}</span>
                      {payOf(j) && <span><Wallet size={14} />{payOf(j)}</span>}
                      {j.deadline && <span><CalendarDays size={14} />{left != null && left <= 7 ? `${left} day${left === 1 ? "" : "s"} left` : `Apply by ${fmtDate(j.deadline)}`}</span>}
                    </div>
                  </div>
                  <span className="btn btn-outline">View role <ChevronRight size={15} /></span>
                </Link>
              );
            })}
            <Paged pg={pg} />
          </div>
        )}

        <div className="card card-pad row between" style={{ marginTop: 32, flexWrap: "wrap", gap: 16, background: "var(--accent-soft)" }}>
          <div className="stack" style={{ gap: 6 }}>
            <h3 style={{ fontSize: 18 }}>Do not see your role?</h3>
            <p className="small">Send your CV to careers@sheetalproperty.com and we will keep it on file.</p>
          </div>
          <a className="btn btn-primary" href="mailto:careers@sheetalproperty.com">Send your CV</a>
        </div>
      </div>
    </>
  );
}

export function JobDetail() {
  const { slug } = useParams();
  const { data: j, loading, error } = useAsync(() => api.job(slug).then(toItem), [slug]);
  useSEO(j?.title || "Job", j?.title ? `Apply for ${j.title} at ${j.company?.name || "Sheetal Property"}.` : undefined);
  if (loading) return <div className="container section"><div className="sk" style={{ height: 300 }} /></div>;
  if (error || !j) return <div className="container"><Empty title="This role isn't open any more"><Link to="/careers">See open roles</Link></Empty></div>;
  const left = daysLeft(j.deadline);
  const toApply = () => document.getElementById("apply")?.scrollIntoView({ behavior: "smooth", block: "start" });
  const sections = [["About the role", j.description], ["What you'll do", j.responsibilities], ["What we look for", j.requirements], ["What we offer", j.benefits]].filter(([, h]) => h);
  return (
    <div className="container detail-layout" style={{ paddingTop: 24, paddingBottom: 72 }}>
      <div className="stack" style={{ gap: 24 }}>
        <Link to="/careers" className="link small"><ArrowLeft size={14} /> All roles</Link>
        <div className="stack" style={{ gap: 14 }}>
          <Company c={j.company} big />
          {j.department && <span className="tier">{j.department}</span>}
          <h1 style={{ fontSize: "clamp(30px, 4vw, 44px)" }}>{j.title}</h1>
        </div>
        <div className="job-facts">
          <div><small>Location</small><b>{j.location}</b></div>
          <div><small>Job type</small><b>{typeOf(j)}</b></div>
          <div><small>Openings</small><b>{j.vacancies}</b></div>
          {j.experience && <div><small>Experience</small><b>{j.experience}</b></div>}
          {payOf(j) && <div><small>Fixed salary</small><b>{payOf(j)}</b></div>}
          {j.deadline && <div><small>Apply by</small><b>{fmtDate(j.deadline)}</b></div>}
        </div>
        {sections.map(([t, h]) => (
          <section key={t} className="job-section"><h2>{t}</h2><div className="prose" dangerouslySetInnerHTML={{ __html: clean(h) }} /></section>
        ))}
        <section className="job-section">
          <h2>How hiring works</h2>
          <ol className="prose" style={{ paddingLeft: "1.2em", margin: 0 }}>
            <li>Apply below. It takes about 10 minutes; your answers are saved in this browser until you send them.</li>
            <li>We read every application. If your profile fits, we call you to talk about the role.</li>
            <li>Interviews with the team, and for senior roles a reference check with your consent.</li>
            <li>An offer with a clear role, targets and 30, 60 and 90-day reviews.</li>
          </ol>
          {j.company && !j.company.own && <p className="small muted">This job is posted by {j.company.name}. Your application and CV go straight to them.</p>}
        </section>
        <section id="apply" className="job-section" style={{ scrollMarginTop: 90 }}>
          <h2>Apply for this role</h2>
          <ApplyForm job={j} slug={slug} />
        </section>
      </div>
      <aside style={{ alignSelf: "stretch" }}>
        <div className="card card-pad sticky-card stack" style={{ gap: 14 }}>
          <h3 style={{ fontSize: 18 }}>{j.title}</h3>
          <div className="job-meta" style={{ flexDirection: "column", gap: 8 }}>
            <span><MapPin size={14} />{j.location}</span>
            <span><Briefcase size={14} />{typeOf(j)} · {j.vacancies_text}</span>
            {j.experience && <span><GraduationCap size={14} />{j.experience}</span>}
            {payOf(j) && <span><Wallet size={14} />{payOf(j)}</span>}
            {j.deadline && <span><CalendarDays size={14} />Apply by {fmtDate(j.deadline)}{left != null && left >= 0 && left <= 14 ? ` · ${left} day${left === 1 ? "" : "s"} left` : ""}</span>}
          </div>
          <button type="button" className="btn btn-primary btn-block" onClick={toApply}>Apply now</button>
        </div>
      </aside>
    </div>
  );
}

/** The application in five steps; checks each step before moving on and sends everything with the CV at the end. */
function ApplyForm({ job, slug }) {
  const steps = useMemo(() => applicationSteps(job.form), [job.form]);
  const key = `sheetal_apply_${slug}`;
  const [v, setV] = useState(() => { try { return JSON.parse(localStorage.getItem(key) || "{}"); } catch { return {}; } });
  const [cv, setCv] = useState(null);
  const [step, setStep] = useState(0);
  const [errs, setErrs] = useState({});
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState("");
  const top = useRef(null);
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage off */ } }, [v, key]);
  const last = steps.length; // the review step
  const go = (n) => { setStep(n); setProblem(""); top.current?.scrollIntoView({ behavior: "smooth", block: "start" }); };

  const check = (q) => {
    const val = q.kind === "file" ? cv : v[q.key];
    const empty = q.kind === "check" ? !val : val == null || String(val).trim() === "";
    if (empty) return q.required ? (q.kind === "check" ? "Please confirm." : "This is required.") : null;
    if (q.kind === "email" && !/^\S+@\S+\.\S+$/.test(val)) return "Enter a valid email.";
    if (q.kind === "url" && !/^https?:\/\/\S+\.\S+/i.test(val)) return "Enter a full link starting with https://";
    if (q.kind === "tel" && String(val).replace(/\D/g, "").length < 7) return "Enter your mobile number.";
    if (q.kind === "number" && !(Number(val) >= 0 && Number(val) <= 60)) return "Enter a number of years.";
    if (q.kind === "file" && val.size > 8 * 1024 * 1024) return "The CV can be up to 8 MB.";
    return null;
  };
  const checkStep = (i) => {
    const found = {};
    for (const q of steps[i].questions) { const e = check(q); if (e) found[q.key] = e; }
    setErrs((x) => ({ ...Object.fromEntries(Object.entries(x).filter(([k]) => !steps[i].questions.some((q) => q.key === k))), ...found }));
    return !Object.keys(found).length;
  };
  // On a phone the error is far from the button: bring the first marked answer into view.
  const showFirstError = () => setTimeout(() => top.current?.querySelector(".bad, .err")?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
  const next = () => { if (checkStep(step)) go(step + 1); else { setProblem("Please fix the marked answers."); showFirstError(); } };
  const send = async () => {
    for (let i = 0; i < steps.length; i++) if (!checkStep(i)) { go(i); setProblem("Please fix the marked answers."); return; }
    setBusy(true);
    const fd = new FormData();
    for (const q of steps.flatMap((s) => s.questions)) {
      if (q.kind === "file") continue;
      const val = v[q.key];
      if (val != null && val !== "" && val !== false) fd.append(q.key, q.kind === "check" ? "true" : String(val));
    }
    fd.append("cv", cv);
    try {
      await api.applyJob(slug, fd);
      try { localStorage.removeItem(key); } catch { /* storage off */ }
      setSent(true);
      top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (x) {
      const fields = Object.fromEntries(Object.entries(x.errors || {}).map(([k, m]) => [k, Array.isArray(m) ? m[0] : String(m)]));
      setErrs(fields);
      const at = steps.findIndex((s) => s.questions.some((q) => fields[q.key]));
      if (at >= 0) go(at);
      setProblem(x.message || "Your application couldn't be sent. Please try again.");
    } finally { setBusy(false); }
  };

  if (sent) return (
    <div ref={top} className="card card-pad job-done">
      <span style={{ width: 48, height: 48, borderRadius: 24, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "var(--accent-soft)" }}><Check size={24} /></span>
      <h3>Application sent</h3>
      <p className="small muted" style={{ maxWidth: 440 }}>Thank you{v.name ? `, ${String(v.name).split(" ")[0]}` : ""}. {job.company?.own ? "We" : job.company?.name} will read it and contact you at {v.email} if your profile fits the role of {job.title}.</p>
      <Link to="/careers" className="btn btn-outline">See other roles</Link>
    </div>
  );

  const set = (k, val) => { setV((x) => ({ ...x, [k]: val })); if (errs[k]) setErrs((x) => { const n = { ...x }; delete n[k]; return n; }); };
  const field = (q) => {
    const bad = errs[q.key] ? " bad" : "";
    const id = `apply-${q.key}`;
    const mark = q.required ? <span className="req" aria-hidden>*</span> : <span className="muted" style={{ fontWeight: 400 }}> (optional)</span>;
    if (q.kind === "check") return (
      <div key={q.key} className="job-q">
        <label className="check"><input id={id} type="checkbox" checked={!!v[q.key]} onChange={(e) => set(q.key, e.target.checked)} /><span>{q.label}<span className="req" aria-hidden>*</span></span></label>
        {errs[q.key] && <span className="err">{errs[q.key]}</span>}
      </div>
    );
    let input;
    if (q.kind === "textarea") input = <textarea id={id} className={`textarea${bad}`} rows={4} value={v[q.key] || ""} onChange={(e) => set(q.key, e.target.value)} placeholder={q.placeholder} />;
    else if (q.kind === "choice") input = (
      <div className="job-choices" role="radiogroup" aria-label={q.label}>
        {q.options.map(([oid, ol]) => <button key={oid} type="button" role="radio" aria-checked={v[q.key] === oid} className={`chip${v[q.key] === oid ? " active" : ""}`} onClick={() => set(q.key, oid)}>{ol}</button>)}
      </div>
    );
    else if (q.kind === "file") input = (
      <label htmlFor={id} className="drop" style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: 20, borderColor: bad ? "var(--c-crimson)" : undefined }}>
        {cv ? <FileText size={20} /> : <Upload size={20} />}
        <span style={{ fontWeight: 500, color: "var(--text-strong)" }}>{cv ? cv.name : "Upload your CV"}</span>
        <span className="small muted">{cv ? "Click to change" : "PDF, DOC or DOCX"}</span>
        <input id={id} type="file" accept=".pdf,.doc,.docx" onChange={(e) => { setCv(e.target.files[0] || null); setErrs((x) => { const n = { ...x }; delete n.cv; return n; }); }} style={{ position: "absolute", opacity: 0, width: 1, height: 1 }} />
      </label>
    );
    else {
      const type = { email: "email", tel: "tel", url: "url", date: "date", number: "number" }[q.kind] || "text";
      input = <input id={id} className={`input${bad}`} type={type} inputMode={q.kind === "money" ? "numeric" : q.kind === "number" ? "decimal" : undefined} min={q.kind === "number" ? 0 : undefined} step={q.kind === "number" ? 0.5 : undefined}
        autoComplete={q.autoComplete} placeholder={q.placeholder} value={q.kind === "money" && v[q.key] ? npr(v[q.key]) : v[q.key] || ""}
        onChange={(e) => set(q.key, q.kind === "money" ? e.target.value.replace(/\D/g, "") : e.target.value)} />;
    }
    return (
      <div key={q.key} className="job-q">
        {q.kind === "choice" || q.kind === "file" ? <span className="job-q-label">{q.label}{mark}</span> : <label htmlFor={id}>{q.label}{mark}</label>}
        {input}
        {errs[q.key] ? <span className="err">{errs[q.key]}</span> : q.hint && <small>{q.hint}</small>}
      </div>
    );
  };

  const title = step < last ? steps[step].title : "Check and send";
  return (
    <div ref={top} className="card card-pad job-apply" style={{ scrollMarginTop: 90 }}>
      <div className="job-steps" aria-hidden>{[...steps, null].map((_, i) => <span key={i} className={i <= step ? "on" : ""} />)}</div>
      <div className="row between" style={{ gap: 8 }}><h3 style={{ fontSize: 18 }}>{title}</h3><span className="small muted">Step {step + 1} of {last + 1}</span></div>
      {problem && <p className="small" role="alert" style={{ color: "var(--c-crimson)", margin: 0 }}>{problem}</p>}
      {step < last ? steps[step].questions.map(field) : (
        <dl className="job-review">
          {steps.flatMap((s) => s.questions).filter((q) => q.kind !== "check").map((q) => {
            const text = q.kind === "file" ? cv?.name : answerText(q, v[q.key]);
            return text ? <div key={q.key}><dt>{q.label}</dt><dd>{text}</dd></div> : null;
          })}
        </dl>
      )}
      <div className="row between" style={{ gap: 12, marginTop: 4 }}>
        {step > 0 ? <button type="button" className="btn btn-outline" onClick={() => go(step - 1)}><ChevronLeft size={15} /> Back</button> : <span />}
        {step < last ? <button type="button" className="btn btn-primary" onClick={next}>Continue <ChevronRight size={15} /></button>
          : <button type="button" className="btn btn-primary" disabled={busy} onClick={send}>{busy ? "Sending…" : <>Send application <Send size={15} /></>}</button>}
      </div>
    </div>
  );
}
