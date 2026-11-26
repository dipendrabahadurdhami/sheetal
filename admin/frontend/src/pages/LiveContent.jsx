// Blog, careers and buyer requirements on the admin API.
// How it works: shown instead of the sample screens when signed in as staff; private files (CVs, payment proofs,
// verification documents) open in a new tab with the staff sign-in.

import React, { useEffect, useState } from "react";
import { fdate, fdatetime, rs } from "@sheetal/shared/core/format";
import { Badge, Button, Drawer, Empty, Field, Input, Panel, Select, Table, Tabs, Textarea, ToggleRow, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { adminApi } from "../api";
import { ApplicationAnswers, JobFormFields } from "@sheetal/shared/components/JobApplicationBits";
import { defaultJobForm } from "@sheetal/shared/data/jobForm";

const API_FILES = (import.meta.env.VITE_ADMIN_API_URL || "").replace(/\/v1\/?$/, "");
/** Plain paragraphs become <p>…</p>; HTML is kept (the API cleans it). */
const toHtml = (s) => (/<[a-z][\s\S]*>/i.test(s) ? s : s.split(/\n{2,}/).map((p) => `<p>${p.trim().replace(/\n/g, "<br>")}</p>`).join(""));
const fileToBase64 = (file) => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] || ""); r.onerror = () => bad(r.error); r.readAsDataURL(file); });

function useApi(path, deps = []) {
  const [state, setState] = useState({ data: null, meta: null, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let gone = false;
    adminApi("GET", path).then((r) => !gone && setState({ data: r.data, meta: r.meta, error: null })).catch((e) => !gone && setState({ data: [], meta: null, error: e.message }));
    return () => { gone = true; };
  }, [path, tick, ...deps]);
  return { ...state, reload: () => setTick((n) => n + 1) };
}

/** Opens a private file (CV, payment proof, verification document) with the staff sign-in, in a new tab. */
export async function openPrivate(path, toast) {
  try {
    const t = localStorage.getItem("sheetal_token");
    const res = await fetch(`${API_FILES}/v1${path}`, { headers: { Authorization: `Bearer ${t}` } });
    if (!res.ok) throw new Error("File not found.");
    window.open(URL.createObjectURL(await res.blob()), "_blank", "noopener");
  } catch (e) { toast(e.message); }
}

// ───── Blog ─────
export function LiveBlog() {
  const toast = useToast();
  const [tab, setTab] = useState("posts");
  const posts = useApi("/admin/blog/posts");
  const cats = useApi("/admin/blog/categories");
  const comments = useApi("/admin/blog/comments?status=pending");
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  const [newCat, setNewCat] = useState("");

  const open = (id) => (id ? adminApi("GET", `/admin/blog/posts/${id}`).then((r) => setEdit({ ...r.data, tags: r.data.tags.join(", ") })).catch((e) => toast(e.message))
    : setEdit({ title: "", content: "", excerpt: "", categoryId: null, tags: "", image: null, imageUrl: null, metaTitle: "", metaDescription: "", allowComments: true, status: "draft" }));
  const save = (status) => {
    setBusy(true);
    const body = { title: edit.title, slug: edit.slug, content: toHtml(edit.content), excerpt: edit.excerpt, categoryId: edit.categoryId ? Number(edit.categoryId) : null, image: edit.image,
      metaTitle: edit.metaTitle, metaDescription: edit.metaDescription, tags: String(edit.tags || "").split(",").map((x) => x.trim()).filter(Boolean), allowComments: edit.allowComments, status, publishedAt: edit.publishedAt || null };
    adminApi(edit.id ? "PUT" : "POST", edit.id ? `/admin/blog/posts/${edit.id}` : "/admin/blog/posts", body)
      .then((r) => { toast(r.message); setEdit(null); posts.reload(); }).catch((e) => toast(e.message)).finally(() => setBusy(false));
  };
  const upload = async (file) => {
    try { const r = await adminApi("POST", "/admin/blog/images", { data: await fileToBase64(file) }); setEdit((x) => ({ ...x, image: r.data.file, imageUrl: r.data.url })); } catch (e) { toast(e.message); }
  };
  const remove = (p) => { if (!window.confirm(`Delete “${p.title}”? This can't be undone.`)) return; adminApi("DELETE", `/admin/blog/posts/${p.id}`).then((r) => { toast(r.message); posts.reload(); }).catch((e) => toast(e.message)); };
  const moderate = (c, status) => adminApi("PATCH", `/admin/blog/comments/${c.id}`, { status }).then((r) => { toast(r.message); comments.reload(); posts.reload(); }).catch((e) => toast(e.message));
  const addCat = () => adminApi("POST", "/admin/blog/categories", { name: newCat }).then((r) => { toast(r.message); setNewCat(""); cats.reload(); }).catch((e) => toast(e.message));

  return (
    <>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "posts", label: "Posts", icon: "newspaper", count: posts.data?.length }, { id: "comments", label: "Comments to check", icon: "message-circle", count: comments.data?.length }, { id: "categories", label: "Categories", icon: "list" }]} />
      {tab === "posts" && <Panel title="Blog posts" sub="Drafts stay private. Published posts show on the website's blog." actions={<Button icon="plus" onClick={() => open(null)}>New post</Button>}>
        {!posts.data ? <p className="muted pf-pad">Loading…</p> : <Table rows={posts.data} onRowClick={(r) => open(r.id)} minWidth={720} empty={<Empty icon="newspaper" title="No posts yet">Write the first one with “New post”.</Empty>} columns={[
          { key: "title", label: "Post", render: (r) => <span className="pf-two"><b>{r.title}</b><small>{r.category?.name || "No category"} · {r.words} words{r.pendingComments ? ` · ${r.pendingComments} comments to check` : ""}</small></span> },
          { key: "status", label: "Status", render: (r) => (r.status === "published" ? (new Date(r.publishedAt) > new Date() ? <Badge tone="progress" icon="clock">Scheduled · {fdate(r.publishedAt)}</Badge> : <Badge tone="done">Published</Badge>) : <Badge tone="neutral">Draft</Badge>) },
          { key: "views", label: "Views", num: true, align: "right", render: (r) => r.views.toLocaleString("en-IN") },
          { key: "upd", label: "Updated", num: true, render: (r) => fdate(r.updatedAt) },
          { key: "act", label: "", align: "right", render: (r) => <div className="pf-row-actions" style={{ justifyContent: "flex-end" }}>{r.status === "published" && <a className="btn btn-ghost btn-sm" href={`/blog/${r.slug}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>View</a>}<Button size="sm" variant="ghost" className="pf-danger" onClick={(e) => { e.stopPropagation(); remove(r); }}>Delete</Button></div> },
        ]} />}
      </Panel>}
      {tab === "comments" && <Panel title="Comments to check" sub="Comments show on the article only after you approve them. Emails are never shown.">
        {!comments.data?.length ? <Empty icon="circle-check" title="Nothing to check" /> : <ul className="pf-list">{comments.data.map((c) => (
          <li key={c.id}><div className="pf-two" style={{ flex: 1 }}><b>{c.name} on “{c.post.title}”</b><span className="small">{c.comment}</span><small className="muted">{c.email || "No email"} · {fdatetime(c.createdAt)}</small></div>
            <Button size="sm" variant="outline" onClick={() => moderate(c, "rejected")}>Hide</Button><Button size="sm" icon="check" onClick={() => moderate(c, "approved")}>Approve</Button></li>))}</ul>}
      </Panel>}
      {tab === "categories" && <Panel title="Categories" pad>
        <div className="pf-stack">
          <div className="pf-row-actions"><Input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="New category, e.g. Buying guides" /><Button disabled={newCat.trim().length < 2} onClick={addCat}>Add</Button></div>
          <ul className="pf-list">{(cats.data || []).map((c) => <li key={c.id}><span className="pf-two" style={{ flex: 1 }}><b>{c.name}</b><small>{c.posts} posts · /blog/category/{c.slug}</small></span>
            <ToggleRowInline on={c.active} onChange={(v) => adminApi("PATCH", `/admin/blog/categories/${c.id}`, { active: v }).then(cats.reload)} label={`Show ${c.name}`} /></li>)}</ul>
        </div>
      </Panel>}
      <Drawer open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Edit post" : "New post"} sub={edit?.slug ? `/blog/${edit.slug}` : ""}
        footer={edit && <><Button variant="outline" disabled={busy} onClick={() => save("draft")}>{edit.status === "published" ? "Unpublish (draft)" : "Save draft"}</Button><Button icon="send" disabled={busy || !edit.title.trim()} onClick={() => save("published")}>{edit.status === "published" ? "Update" : "Publish"}</Button></>}>
        {edit && <div className="pf-stack">
          <Field label="Title"><Input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
          <Field label="Category"><Select value={edit.categoryId || ""} onChange={(v) => setEdit({ ...edit, categoryId: v || null })} options={[{ id: "", label: "No category" }, ...(cats.data || []).map((c) => ({ id: c.id, label: c.name }))]} /></Field>
          <Field label="Cover picture">
            <div className="pf-row-actions">{edit.imageUrl && <img src={edit.imageUrl} alt="" style={{ height: 64, borderRadius: 8 }} />}<label className="btn btn-outline btn-sm"><input type="file" accept="image/*" hidden onChange={(e) => e.target.files[0] && upload(e.target.files[0])} /><Icon name="upload" size={14} />{edit.imageUrl ? "Change" : "Upload"}</label></div>
          </Field>
          <Field label="Article" hint="Write paragraphs with a blank line between them, or paste HTML. Scripts and styles are removed."><Textarea rows={14} value={edit.content} onChange={(e) => setEdit({ ...edit, content: e.target.value })} /></Field>
          <Field label="Short summary" hint="Shown on blog cards and in Google. Leave empty to use the first lines."><Textarea rows={2} value={edit.excerpt || ""} onChange={(e) => setEdit({ ...edit, excerpt: e.target.value })} /></Field>
          <Field label="Tags" hint="Separate with commas."><Input value={edit.tags} onChange={(e) => setEdit({ ...edit, tags: e.target.value })} /></Field>
          <Field label="Publish date" hint="A future date schedules the post."><Input type="datetime-local" value={edit.publishedAt ? String(edit.publishedAt).slice(0, 16) : ""} onChange={(e) => setEdit({ ...edit, publishedAt: e.target.value ? new Date(e.target.value).toISOString() : null })} /></Field>
          <Field label="Search title (SEO)"><Input value={edit.metaTitle || ""} onChange={(e) => setEdit({ ...edit, metaTitle: e.target.value })} /></Field>
          <Field label="Search description (SEO)"><Textarea rows={2} value={edit.metaDescription || ""} onChange={(e) => setEdit({ ...edit, metaDescription: e.target.value })} /></Field>
          <ToggleRow title="Allow comments" sub="Comments wait for approval." checked={edit.allowComments} onChange={(v) => setEdit({ ...edit, allowComments: v })} />
        </div>}
      </Drawer>
    </>
  );
}

function ToggleRowInline({ on, onChange, label }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`pf-switch ${on ? "on" : ""}`} onClick={() => onChange(!on)}><span /></button>;
}

// ───── Careers ─────
const JOB_TYPES = [["full_time", "Full time"], ["part_time", "Part time"], ["contract", "Contract"], ["internship", "Internship"]];
const APP_STATUS = [["new", "New"], ["shortlisted", "Shortlisted"], ["rejected", "Not a fit"], ["hired", "Hired"]];

export function LiveCareers() {
  const toast = useToast();
  const jobs = useApi("/admin/jobs");
  const [edit, setEdit] = useState(null);
  const [appsOf, setAppsOf] = useState(null);
  const [apps, setApps] = useState(null);
  const loadApps = (j) => { setAppsOf(j); setApps(null); adminApi("GET", `/admin/jobs/${j.id}/applications`).then((r) => setApps(r.data)).catch((e) => toast(e.message)); };
  const save = () => {
    const body = { ...edit, description: toHtml(edit.description || ""), responsibilities: edit.responsibilities ? toHtml(edit.responsibilities) : null, requirements: edit.requirements ? toHtml(edit.requirements) : null,
      benefits: edit.benefits ? toHtml(edit.benefits) : null, salaryMin: edit.salaryMin ? Number(edit.salaryMin) : null, salaryMax: edit.salaryMax ? Number(edit.salaryMax) : null, vacancies: Number(edit.vacancies) || 1, deadline: edit.deadline || null };
    delete body.id; delete body.slug; delete body.views; delete body.createdAt; delete body.updatedAt; delete body.applications; delete body.newApplications; delete body.tenantId; delete body.review; delete body.reviewNote;
    adminApi(edit.id ? "PUT" : "POST", edit.id ? `/admin/jobs/${edit.id}` : "/admin/jobs", body).then((r) => { toast(r.message); setEdit(null); jobs.reload(); }).catch((e) => toast(e.message));
  };
  const setStatus = (a, status) => adminApi("PATCH", `/admin/applications/${a.id}`, { status }).then(() => { setApps((l) => l.map((x) => (x.id === a.id ? { ...x, status } : x))); jobs.reload(); }).catch((e) => toast(e.message));
  return (
    <>
      <Panel title="Jobs" sub="Open jobs show on the website's careers page until their deadline." actions={<Button icon="plus" onClick={() => setEdit({ title: "", jobType: "full_time", location: "Kathmandu", remote: false, description: "", vacancies: 1, showSalary: false, status: "draft", form: defaultJobForm() })}>New job</Button>}>
        {!jobs.data ? <p className="muted pf-pad">Loading…</p> : <Table rows={jobs.data} onRowClick={(r) => setEdit({ ...r, deadline: r.deadline ? String(r.deadline).slice(0, 10) : "" })} minWidth={720} empty={<Empty icon="briefcase" title="No jobs yet" />} columns={[
          { key: "t", label: "Job", render: (r) => <span className="pf-two"><b>{r.title}</b><small>{[r.department, JOB_TYPES.find((x) => x[0] === r.jobType)?.[1], r.location].filter(Boolean).join(" · ")}</small></span> },
          { key: "s", label: "Status", render: (r) => <Badge tone={r.status === "open" ? "done" : "neutral"}>{r.status === "open" ? "Open" : r.status === "closed" ? "Closed" : "Draft"}</Badge> },
          { key: "d", label: "Deadline", num: true, render: (r) => (r.deadline ? fdate(r.deadline) : "—") },
          { key: "a", label: "Applications", num: true, align: "right", render: (r) => <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); loadApps(r); }}>{r.applications}{r.newApplications ? ` (${r.newApplications} new)` : ""}</Button> },
        ]} />}
      </Panel>
      <BusinessJobs />
      <Drawer open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Edit job" : "New job"} footer={edit && <><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button disabled={!edit.title?.trim() || !edit.description?.trim()} onClick={save}>Save</Button></>}>
        {edit && <div className="pf-stack">
          <Field label="Title"><Input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
          <div className="pf-grid-2 tight"><Field label="Department"><Input value={edit.department || ""} onChange={(e) => setEdit({ ...edit, department: e.target.value })} /></Field>
            <Field label="Type"><Select value={edit.jobType} onChange={(v) => setEdit({ ...edit, jobType: v })} options={JOB_TYPES.map(([id, label]) => ({ id, label }))} /></Field></div>
          <div className="pf-grid-2 tight"><Field label="Location"><Input value={edit.location || ""} onChange={(e) => setEdit({ ...edit, location: e.target.value })} /></Field>
            <Field label="Experience"><Input value={edit.experience || ""} onChange={(e) => setEdit({ ...edit, experience: e.target.value })} placeholder="e.g. 1–3 years" /></Field></div>
          <div className="pf-grid-2 tight"><Field label="Salary from (Rs. a month)"><Input className="input tnum" value={edit.salaryMin || ""} onChange={(e) => setEdit({ ...edit, salaryMin: e.target.value.replace(/\D/g, "") })} /></Field>
            <Field label="Salary to"><Input className="input tnum" value={edit.salaryMax || ""} onChange={(e) => setEdit({ ...edit, salaryMax: e.target.value.replace(/\D/g, "") })} /></Field></div>
          <ToggleRow title="Show the salary" checked={edit.showSalary} onChange={(v) => setEdit({ ...edit, showSalary: v })} />
          <ToggleRow title="Remote possible" checked={edit.remote} onChange={(v) => setEdit({ ...edit, remote: v })} />
          <div className="pf-grid-2 tight"><Field label="Vacancies"><Input className="input tnum" value={edit.vacancies} onChange={(e) => setEdit({ ...edit, vacancies: e.target.value.replace(/\D/g, "") })} /></Field>
            <Field label="Apply by"><Input type="date" value={edit.deadline || ""} onChange={(e) => setEdit({ ...edit, deadline: e.target.value })} /></Field></div>
          <Field label="About the job"><Textarea rows={6} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
          <Field label="What you'll do"><Textarea rows={4} value={edit.responsibilities || ""} onChange={(e) => setEdit({ ...edit, responsibilities: e.target.value })} /></Field>
          <Field label="What we look for"><Textarea rows={4} value={edit.requirements || ""} onChange={(e) => setEdit({ ...edit, requirements: e.target.value })} /></Field>
          <Field label="Benefits"><Textarea rows={3} value={edit.benefits || ""} onChange={(e) => setEdit({ ...edit, benefits: e.target.value })} /></Field>
          <Field label="Application questions"><JobFormFields form={edit.form} onChange={(form) => setEdit({ ...edit, form })} /></Field>
          <Field label="Status"><Select value={edit.status} onChange={(v) => setEdit({ ...edit, status: v })} options={[{ id: "draft", label: "Draft (hidden)" }, { id: "open", label: "Open (on the website)" }, { id: "closed", label: "Closed" }]} /></Field>
        </div>}
      </Drawer>
      <Drawer open={!!appsOf} onClose={() => setAppsOf(null)} title={appsOf ? `Applications: ${appsOf.title}` : ""}>
        {!apps ? <p className="muted">Loading…</p> : !apps.length ? <Empty icon="inbox" title="No applications yet" /> : <ul className="pf-list">{apps.map((a) => (
          <li key={a.id}><div className="pf-two" style={{ flex: 1 }}><b>{a.name}</b><small>{a.email}{a.phone ? ` · ${a.phone}` : ""} · {fdatetime(a.createdAt)}</small>{a.coverLetter && <span className="small">{a.coverLetter.slice(0, 300)}</span>}<ApplicationAnswers app={a} form={appsOf?.form} /></div>
            {a.cv && <Button size="sm" variant="outline" icon="file-text" onClick={() => openPrivate(a.cv, toast)}>CV</Button>}
            <Select value={a.status} onChange={(v) => setStatus(a, v)} options={APP_STATUS.map(([id, label]) => ({ id, label }))} style={{ width: 150 }} aria-label="Status" /></li>))}</ul>}
      </Drawer>
    </>
  );
}

/** Jobs businesses posted from their panel. Open jobs of businesses that aren't verified wait here; verified businesses' jobs go live at once. */
const REVIEW = { approved: ["done", "On the website"], pending: ["progress", "To check"], rejected: ["action", "Sent back"] };
function BusinessJobs() {
  const toast = useToast();
  const [show, setShow] = useState("pending");
  const list = useApi(`/admin/business-jobs?show=${show}`, [show]);
  const [look, setLook] = useState(null);
  const decide = (j, review) => {
    const note = review === "rejected" ? window.prompt("What should the business change? They see this note.") : "";
    if (review === "rejected" && !note?.trim()) return;
    adminApi("PATCH", `/admin/business-jobs/${j.id}`, { review, note: note?.trim() || undefined }).then((r) => { toast(r.message); setLook(null); list.reload(); }).catch((e) => toast(e.message));
  };
  if (list.error && !list.data?.length) return null;   // nothing to show when the list cannot load
  return (
    <>
      <Panel title="Jobs from businesses" sub="Businesses post jobs from their panel. Verified businesses go live at once; others wait here for your check."
        actions={<Select value={show} onChange={setShow} options={[{ id: "pending", label: `To check${list.meta?.waiting ? ` (${list.meta.waiting})` : ""}` }, { id: "all", label: "All business jobs" }]} style={{ width: 200 }} aria-label="Show" />}>
        {!list.data ? <p className="muted pf-pad">Loading…</p> : <Table rows={list.data} onRowClick={setLook} minWidth={720} empty={<Empty icon="circle-check" title={show === "pending" ? "Nothing to check" : "No business jobs yet"} />} columns={[
          { key: "t", label: "Job", render: (r) => <span className="pf-two"><b>{r.title}</b><small>{r.tenant?.name}{r.tenant?.verification === "verified" ? " · Verified" : ""} · {[JOB_TYPES.find((x) => x[0] === r.jobType)?.[1], r.location].filter(Boolean).join(" · ")}</small></span> },
          { key: "s", label: "Status", render: (r) => r.status !== "open" ? <Badge tone="neutral">{r.status === "closed" ? "Closed" : "Draft"}</Badge> : <Badge tone={REVIEW[r.review]?.[0]}>{REVIEW[r.review]?.[1]}</Badge> },
          { key: "u", label: "Updated", num: true, render: (r) => fdate(r.updatedAt) },
          { key: "act", label: "", align: "right", render: (r) => r.status === "open" && r.review === "pending" ? <div className="pf-row-actions" style={{ justifyContent: "flex-end" }}><Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); decide(r, "rejected"); }}>Send back</Button><Button size="sm" icon="check" onClick={(e) => { e.stopPropagation(); decide(r, "approved"); }}>Approve</Button></div> : null },
        ]} />}
      </Panel>
      <Drawer open={!!look} onClose={() => setLook(null)} title={look?.title || ""} sub={look ? `${look.tenant?.name} · ${JOB_TYPES.find((x) => x[0] === look.jobType)?.[1] || ""}` : ""}
        footer={look?.status === "open" && look.review !== "approved" ? <><Button variant="outline" onClick={() => decide(look, "rejected")}>Send back</Button><Button icon="check" onClick={() => decide(look, "approved")}>Approve</Button></>
          : look?.review === "approved" ? <Button variant="outline" onClick={() => decide(look, "rejected")}>Take off the website</Button> : null}>
        {look && <div className="pf-stack">
          {look.reviewNote && <div className="pf-alert action"><Icon name="circle-alert" size={18} /><div><b>Your last note</b><span>{look.reviewNote}</span></div></div>}
          <p className="small muted">{[look.location, look.experience, look.vacancies > 1 ? `${look.vacancies} vacancies` : null, look.deadline ? `Apply by ${fdate(look.deadline)}` : null, look.salaryMin || look.salaryMax ? `Rs. ${[look.salaryMin, look.salaryMax].filter(Boolean).map((n) => n.toLocaleString("en-IN")).join(" – ")}${look.showSalary ? "" : " (hidden)"}` : null].filter(Boolean).join(" · ")}</p>
          {[["About the job", look.description], ["What you'll do", look.responsibilities], ["What we look for", look.requirements], ["Benefits", look.benefits]].filter(([, h]) => h).map(([t, h]) => (
            <div key={t}><b>{t}</b><div className="small" style={{ whiteSpace: "pre-wrap" }}>{h.replace(/<br\s*\/?>/g, "\n").replace(/<\/p>\s*<p>/g, "\n\n").replace(/<[^>]*>/g, "")}</div></div>
          ))}
        </div>}
      </Drawer>
    </>
  );
}

// ───── Buyer requirements ─────
export function LiveRequirements() {
  const toast = useToast();
  const [show, setShow] = useState("fee_pending");
  const list = useApi(`/admin/requirements?show=${show}`, [show]);
  const fee = useApi("/admin/settings/requirement-fee");
  const [f, setF] = useState(null);
  useEffect(() => { if (fee.data) setF(fee.data); }, [fee.data]);
  const act = (l, body) => adminApi("PATCH", `/admin/requirements/${l.id}`, body).then((r) => { toast(r.message); list.reload(); }).catch((e) => toast(e.message));
  const reject = (l) => { const note = window.prompt("Why can't the payment be confirmed? The buyer gets this by email."); if (note?.trim()) act(l, { fee: "rejected", note: note.trim() }); };
  const saveFee = () => adminApi("PUT", "/admin/settings/requirement-fee", { enabled: f.enabled, amount: Number(f.amount) || 0, note: f.note || "" }).then((r) => { toast(r.message); fee.reload(); }).catch((e) => toast(e.message));
  return (
    <div className="pf-split">
      <div className="grow pf-stack">
        <Tabs value={show} onChange={setShow} tabs={[{ id: "fee_pending", label: "Payments to check", count: list.meta?.waiting }, { id: "public", label: "On the board" }, { id: "hidden", label: "Hidden" }, { id: "all", label: "All" }]} />
        <section className="card pf-panel">
          {!list.data ? <p className="muted pf-pad">Loading…</p> : <Table rows={list.data} minWidth={760} empty={<Empty icon="circle-check" title="Nothing here" />} columns={[
            { key: "c", label: "Requirement", render: (r) => <span className="pf-two"><b>{r.code} · {r.details?.property_type || "Property"}{r.details?.location ? ` in ${r.details.location}` : ""}</b><small>{r.name} · {r.phone || ""} {r.email || ""}</small></span> },
            { key: "b", label: "Budget", render: (r) => [r.details?.min_budget, r.details?.max_budget].filter(Boolean).map((x) => rs(Number(x) || 0)).join(" – ") || "—" },
            { key: "f", label: "Fee", render: (r) => (r.feeStatus ? <span className="pf-two"><Badge tone={r.feeStatus === "confirmed" ? "done" : r.feeStatus === "rejected" ? "problem" : "action"}>{r.feeStatus}</Badge><small>{r.feeAmount ? rs(r.feeAmount) : ""}{r.feeRef ? ` · ${r.feeRef}` : ""}</small></span> : "—") },
            { key: "o", label: "Offers", num: true, align: "right", render: (r) => r.offers },
            { key: "a", label: "", align: "right", render: (r) => <div className="pf-row-actions" style={{ justifyContent: "flex-end" }}>
              {r.proof && <Button size="sm" variant="ghost" icon="image" onClick={() => openPrivate(r.proof, toast)}>Proof</Button>}
              {r.feeStatus === "pending" ? <><Button size="sm" variant="outline" onClick={() => reject(r)}>Reject</Button><Button size="sm" icon="check" onClick={() => act(r, { fee: "confirmed" })}>Confirm</Button></>
                : <Button size="sm" variant="outline" onClick={() => act(r, { public: !r.public })}>{r.public ? "Hide" : "Show on board"}</Button>}
            </div> },
          ]} />}
        </section>
      </div>
      <div className="side">
        <Panel title="Requirement fee" sub="Buyers pay this to post a requirement on the board. Off means it's free." pad>
          {!f ? <p className="muted">Loading…</p> : <div className="pf-stack">
            <ToggleRow title="Charge a fee" checked={!!f.enabled} onChange={(v) => setF({ ...f, enabled: v })} />
            <Field label="Amount (Rs.)"><Input className="input tnum" value={f.amount || ""} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/\D/g, "") })} /></Field>
            <Field label="How to pay" hint="Shown on the requirement form, e.g. the eSewa number."><Textarea rows={3} value={f.note || ""} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
            <Button onClick={saveFee}>Save</Button>
          </div>}
        </Panel>
      </div>
    </div>
  );
}
