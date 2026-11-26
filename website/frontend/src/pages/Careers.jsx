// Open jobs (at Sheetal Property and at property businesses on Sheetal) and a job's page with the application form (CV kept private).

import { clean } from "../utils/sanitize";
import { useSEO } from "../utils/seo";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { MapPin, Briefcase, Clock, Upload, ArrowLeft, Building2, BadgeCheck } from "lucide-react";
import { api } from "../api/endpoints";
import { toItem, toList } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { useApp } from "../context/AppContext";
import { PageHead, Empty, usePaged, Paged } from "../components/ui";
import { fmtDate } from "../utils/format";

const tabStyle = (on) => ({
  padding: "14px 4px", marginBottom: -1, fontSize: 15, fontWeight: 500, background: "none", border: 0, cursor: "pointer",
  color: on ? "var(--text-strong)" : "var(--muted)",
  borderBottom: `2px solid ${on ? "var(--accent-ink)" : "transparent"}`,
});

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
          <div className="card" style={{ padding: "8px 32px" }} ref={pg.top}>
            {pg.items.map((j, i) => (
              <Link key={j.id} to={`/careers/${j.slug}`} className="row between" style={{ padding: "28px 0", borderBottom: i === pg.items.length - 1 ? 0 : "1px solid var(--line)", color: "var(--text)", flexWrap: "wrap", gap: 16 }}>
                <div className="stack" style={{ gap: 8 }}>
                  <Company c={j.company} />
                  <h3 style={{ fontSize: 20 }}>{j.title}</h3>
                  {j.department && <span className="tier">{j.department}</span>}
                  <div className="row-wrap small muted" style={{ gap: 18 }}><span className="row" style={{ gap: 6 }}><MapPin size={14} />{j.location}</span><span className="row" style={{ gap: 6 }}><Clock size={14} />{j.type || j.job_type}</span>{j.salary && <span>{j.salary}</span>}</div>
                </div>
                <span className="btn btn-outline">View role</span>
              </Link>
            ))}
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
  const { toast } = useApp();
  const { data: j, loading, error } = useAsync(() => api.job(slug).then(toItem), [slug]);
  useSEO(j?.title || "Job", j?.title ? `Apply for ${j.title} at ${j.company?.name || "Sheetal Property"}.` : undefined);
  const [f, setF] = useState({ name: "", email: "", phone: "", cover_letter: "" });
  const [cv, setCv] = useState(null);
  if (loading) return <div className="container section"><div className="sk" style={{ height: 300 }} /></div>;
  if (error || !j) return <div className="container"><Empty title="Role not found"><Link to="/careers">See open roles</Link></Empty></div>;
  const apply = async (e) => {
    e.preventDefault();
    const fd = new FormData(); Object.entries(f).forEach(([k, v]) => fd.append(k, v)); if (cv) fd.append("cv", cv);
    try { const r = await api.applyJob(slug, fd); toast(r?.message || "Application sent"); setF({ name: "", email: "", phone: "", cover_letter: "" }); setCv(null); } catch (x) { toast(x.message); }
  };
  return (
    <div className="container detail-layout" style={{ paddingTop: 24 }}>
      <div className="stack" style={{ gap: 20 }}>
        <Link to="/careers" className="link small"><ArrowLeft size={14} /> All roles</Link>
        <Company c={j.company} big />
        {j.department && <span className="tier">{j.department}</span>}
        <h1 style={{ fontSize: "clamp(30px, 4vw, 44px)" }}>{j.title}</h1>
        <div className="row-wrap muted" style={{ gap: 20 }}><span className="row" style={{ gap: 6 }}><MapPin size={15} />{j.location}</span><span>{j.type || j.job_type}</span>{j.experience && <span>{j.experience}</span>}{j.deadline && <span>Apply by {fmtDate(j.deadline)}</span>}</div>
        <div className="hr" />
        <div className="prose" dangerouslySetInnerHTML={{ __html: clean(j.description || "") }} />
        {[["What you'll do", j.responsibilities], ["What they look for", j.requirements], ["Benefits", j.benefits]].filter(([, h]) => h).map(([t, h]) => (
          <div key={t} className="stack" style={{ gap: 8 }}><h3 style={{ fontSize: 18 }}>{t}</h3><div className="prose" dangerouslySetInnerHTML={{ __html: clean(h) }} /></div>
        ))}
        {j.company && !j.company.own && <p className="small muted">This job is posted by {j.company.name}. Your application and CV go straight to them.</p>}
      </div>
      <aside style={{ alignSelf: "stretch" }}>
        <form className="card card-pad sticky-card stack" onSubmit={apply}>
          <h3>Apply for this role</h3>
          <input className="input" placeholder="Full name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <input className="input" type="email" placeholder="Email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <input className="input" type="tel" placeholder="Phone" required value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          <label className="drop" style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, padding: 18, textAlign: "center", cursor: "pointer" }}>
            <Upload size={20} />
            <span style={{ display: "block", fontWeight: 500, color: "var(--text-strong)" }}>{cv ? cv.name : "Upload your CV"}</span>
            <span className="small muted" style={{ display: "block" }}>PDF, DOC or DOCX</span>
            <input type="file" accept=".pdf,.doc,.docx" onChange={(e) => setCv(e.target.files[0])} style={{ position: "absolute", opacity: 0, width: 1, height: 1 }} />
          </label>
          <textarea className="textarea" placeholder="Why do you want to join?" value={f.cover_letter} onChange={(e) => setF({ ...f, cover_letter: e.target.value })} style={{ minHeight: 90 }} />
          <button className="btn btn-primary btn-block">Send application</button>
        </form>
      </aside>
    </div>
  );
}