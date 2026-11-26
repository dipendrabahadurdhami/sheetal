// Jobs: the business posts jobs on the website's Careers page and handles the applications it gets.
// How it works: a job saved as Open is on the website at once for a verified business; otherwise Sheetal checks it first
// (usually within a working day). Applications arrive here and by email; CVs are private and open with the sign-in.
// Rules: owners and managers ("workspace.team.invite"); the API only ever returns this business's own jobs.

import React, { useEffect, useState } from "react";
import { fdate, fdatetime } from "@sheetal/shared/core/format";
import { Badge, Button, Drawer, Empty, Field, Input, PageHead, Panel, Select, Table, Textarea, ToggleRow, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { Link } from "@sheetal/shared/core/router";
import { bizApi } from "../api";
import { ApplicationAnswers, JobFormFields } from "@sheetal/shared/components/JobApplicationBits";
import { defaultJobForm } from "@sheetal/shared/data/jobForm";

export const JOB_TYPES = [["full_time", "Full time"], ["part_time", "Part time"], ["contract", "Contract"], ["internship", "Internship"]];
const APP_STATUS = [["new", "New"], ["shortlisted", "Shortlisted"], ["rejected", "Not a fit"], ["hired", "Hired"]];
const typeName = (id) => JOB_TYPES.find(([k]) => k === id)?.[1] || id;

/** Plain paragraphs become <p>…</p> for the website; HTML that the API keeps is turned back into plain text for editing. */
export const toHtml = (s) => (!s?.trim() ? null : s.trim().split(/\n{2,}/).map((p) => `<p>${p.trim().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</p>`).join(""));
export const toText = (h) => (h || "").replace(/<br\s*\/?>/g, "\n").replace(/<\/p>\s*<p>/g, "\n\n").replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();

/** Where the job stands, in one badge: draft, closed, waiting for Sheetal, sent back, or on the website. */
export function jobState(j) {
  if (j.status === "draft") return ["neutral", "Draft"];
  if (j.status === "closed") return ["neutral", "Closed"];
  if (j.deadline && new Date(j.deadline) < new Date(Date.now() - 864e5)) return ["neutral", "Deadline passed"];
  if (j.review === "pending") return ["progress", "Sheetal is checking"];
  if (j.review === "rejected") return ["action", "Needs changes"];
  return ["done", "On the website"];
}

const blank = () => ({ title: "", department: "", jobType: "full_time", location: "", remote: false, experience: "", salaryMin: "", salaryMax: "", showSalary: false, vacancies: "1", deadline: "", description: "", responsibilities: "", requirements: "", benefits: "", status: "open", form: defaultJobForm() });

export function Jobs({ tenant }) {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [verified, setVerified] = useState(false);
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  const [appsOf, setAppsOf] = useState(null);
  const [apps, setApps] = useState(null);
  const load = () => bizApi("GET", "/jobs").then((r) => { setRows(r.data); setVerified(!!r.meta?.verified); }).catch((e) => { setRows([]); toast(e.message); });
  useEffect(() => { load(); }, [tenant.id]);

  const open = (j) => setEdit(j ? {
    ...j, department: j.department || "", location: j.location || "", experience: j.experience || "", salaryMin: j.salaryMin ?? "", salaryMax: j.salaryMax ?? "",
    vacancies: String(j.vacancies), deadline: j.deadline ? String(j.deadline).slice(0, 10) : "", description: toText(j.description),
    responsibilities: toText(j.responsibilities), requirements: toText(j.requirements), benefits: toText(j.benefits),
  } : { ...blank(), location: tenant.city || "" });
  const save = (status) => {
    setBusy(true);
    const e = edit;
    const body = {
      title: e.title, department: e.department, jobType: e.jobType, location: e.location, remote: e.remote, experience: e.experience,
      salaryMin: e.salaryMin === "" ? null : Number(e.salaryMin), salaryMax: e.salaryMax === "" ? null : Number(e.salaryMax), showSalary: e.showSalary,
      vacancies: Number(e.vacancies) || 1, deadline: e.deadline || null, description: toHtml(e.description) || "",
      responsibilities: toHtml(e.responsibilities), requirements: toHtml(e.requirements), benefits: toHtml(e.benefits), status, form: e.form || defaultJobForm(),
    };
    bizApi(e.id ? "PUT" : "POST", e.id ? `/jobs/${e.id}` : "/jobs", body).then((r) => { toast(r.message); setEdit(null); load(); }).catch((x) => toast(x.message)).finally(() => setBusy(false));
  };
  const remove = (j) => {
    if (!window.confirm(`Delete “${j.title}”${j.applications ? ` and its ${j.applications} application${j.applications > 1 ? "s" : ""}` : ""}? This can't be undone.`)) return;
    bizApi("DELETE", `/jobs/${j.id}`).then((r) => { toast(r.message); setEdit(null); load(); }).catch((x) => toast(x.message));
  };
  const loadApps = (j) => { setAppsOf(j); setApps(null); bizApi("GET", `/jobs/${j.id}/applications`).then((r) => setApps(r.data)).catch((x) => toast(x.message)); };
  const setStatus = (a, status) => bizApi("PATCH", `/job-applications/${a.id}`, { status }).then(() => { setApps((l) => l.map((x) => (x.id === a.id ? { ...x, status } : x))); load(); }).catch((x) => toast(x.message));
  const openCv = async (a) => {
    try { const blob = await bizApi("GET", `/job-applications/${a.id}/cv`); window.open(URL.createObjectURL(blob), "_blank", "noopener"); } catch (x) { toast(x.message); }
  };

  const set = (k) => (v) => setEdit((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const digits = (k) => (ev) => setEdit((x) => ({ ...x, [k]: ev.target.value.replace(/\D/g, "") }));
  const ready = edit && edit.title.trim().length >= 3 && edit.description.trim().length >= 20;

  return (
    <>
      <PageHead title="Jobs" sub="Post jobs on the Sheetal Property Careers page. People apply with their CV, and you get every application here and by email."
        actions={<Button icon="plus" onClick={() => open(null)}>Post a job</Button>} />
      {!verified && <div className="pf-alert progress">
        <Icon name="shield-check" size={18} />
        <div><b>Sheetal checks each job first</b><span>Your jobs go on the website after a quick check, usually within a working day. Verified businesses' jobs go live at once.</span></div>
        <Link to="/business/settings/verification" className="btn btn-outline btn-sm">Get verified</Link>
      </div>}
      <Panel title="Your jobs">
        {!rows ? <p className="muted pf-pad">Loading…</p> : <Table rows={rows} onRowClick={open} minWidth={720}
          empty={<Empty icon="briefcase" title="No jobs yet" action={<Button icon="plus" onClick={() => open(null)}>Post a job</Button>}>Hiring? Post the job here and it shows on the website's Careers page.</Empty>}
          columns={[
            { key: "t", label: "Job", render: (r) => <span className="pf-two"><b>{r.title}</b><small>{[r.department, typeName(r.jobType), r.location].filter(Boolean).join(" · ")}</small></span> },
            { key: "s", label: "Status", render: (r) => { const [tone, word] = jobState(r); return <Badge tone={tone}>{word}</Badge>; } },
            { key: "d", label: "Apply by", num: true, render: (r) => (r.deadline ? fdate(r.deadline) : "No deadline") },
            { key: "v", label: "Views", num: true, align: "right", render: (r) => r.views.toLocaleString("en-IN") },
            { key: "a", label: "Applications", align: "right", render: (r) => <Button size="sm" variant="outline" onClick={(ev) => { ev.stopPropagation(); loadApps(r); }}>{r.applications}{r.newApplications ? ` (${r.newApplications} new)` : ""}</Button> },
          ]} />}
      </Panel>

      <Drawer open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Edit job" : "Post a job"}
        footer={edit && <>
          {edit.id && <Button variant="ghost" className="pf-danger" disabled={busy} onClick={() => remove(edit)}>Delete</Button>}
          <Button variant="outline" disabled={busy || !ready} onClick={() => save(edit.id && edit.status === "open" ? "closed" : "draft")}>{edit.id && edit.status === "open" ? "Close the job" : "Save draft"}</Button>
          <Button icon="send" disabled={busy || !ready} onClick={() => save("open")}>{edit.id && edit.status === "open" ? "Save" : verified ? "Post on the website" : "Send to post"}</Button>
        </>}>
        {edit && <div className="pf-stack">
          {edit.review === "rejected" && edit.reviewNote && <div className="pf-alert action"><Icon name="circle-alert" size={18} /><div><b>Sheetal asks for changes</b><span>{edit.reviewNote}</span></div></div>}
          {edit.id && edit.status === "open" && edit.review === "approved" && !verified && <p className="small muted">Changing the text sends the job to Sheetal for a quick check again.</p>}
          <Field label="Job title"><Input value={edit.title} onChange={set("title")} placeholder="e.g. Sales agent" /></Field>
          <div className="pf-grid-2 tight">
            <Field label="Department" hint="Optional"><Input value={edit.department} onChange={set("department")} placeholder="e.g. Sales" /></Field>
            <Field label="Type"><Select value={edit.jobType} onChange={set("jobType")} options={JOB_TYPES.map(([id, label]) => ({ id, label }))} /></Field>
          </div>
          <div className="pf-grid-2 tight">
            <Field label="Location"><Input value={edit.location} onChange={set("location")} placeholder="e.g. Kathmandu" /></Field>
            <Field label="Experience" hint="Optional"><Input value={edit.experience} onChange={set("experience")} placeholder="e.g. 1–3 years" /></Field>
          </div>
          <ToggleRow title="Remote work possible" checked={edit.remote} onChange={set("remote")} />
          <div className="pf-grid-2 tight">
            <Field label="Salary from (Rs. a month)" hint="Optional"><Input className="input tnum" inputMode="numeric" value={edit.salaryMin} onChange={digits("salaryMin")} /></Field>
            <Field label="Salary to"><Input className="input tnum" inputMode="numeric" value={edit.salaryMax} onChange={digits("salaryMax")} /></Field>
          </div>
          <ToggleRow title="Show the salary on the website" checked={edit.showSalary} onChange={set("showSalary")} />
          <div className="pf-grid-2 tight">
            <Field label="Vacancies"><Input className="input tnum" inputMode="numeric" value={edit.vacancies} onChange={digits("vacancies")} /></Field>
            <Field label="Apply by" hint="Optional. The job leaves the website after this day."><Input type="date" value={edit.deadline} onChange={set("deadline")} /></Field>
          </div>
          <Field label="About the job" hint="At least a few lines. Leave a blank line between paragraphs."><Textarea rows={6} value={edit.description} onChange={set("description")} /></Field>
          <Field label="What the person will do" hint="Optional"><Textarea rows={4} value={edit.responsibilities} onChange={set("responsibilities")} /></Field>
          <Field label="Who you are looking for" hint="Optional"><Textarea rows={4} value={edit.requirements} onChange={set("requirements")} /></Field>
          <Field label="Benefits" hint="Optional"><Textarea rows={3} value={edit.benefits} onChange={set("benefits")} /></Field>
          <Field label="Application questions"><JobFormFields form={edit.form} onChange={set("form")} /></Field>
          {edit.status === "open" && edit.review === "approved" && edit.slug && <a className="link small" href={`/careers/${edit.slug}`} target="_blank" rel="noreferrer"><Icon name="external-link" size={14} /> See it on the website</a>}
        </div>}
      </Drawer>

      <Drawer open={!!appsOf} onClose={() => setAppsOf(null)} title={appsOf ? `Applications: ${appsOf.title}` : ""}>
        {!apps ? <p className="muted">Loading…</p> : !apps.length ? <Empty icon="inbox" title="No applications yet">They show here as soon as someone applies.</Empty> : <ul className="pf-list">{apps.map((a) => (
          <li key={a.id}><div className="pf-two" style={{ flex: 1 }}><b>{a.name}</b><small><a href={`mailto:${a.email}`}>{a.email}</a>{a.phone ? <> · <a href={`tel:${a.phone}`}>{a.phone}</a></> : ""} · {fdatetime(a.createdAt)}</small>{a.coverLetter && <span className="small">{a.coverLetter.slice(0, 400)}</span>}<ApplicationAnswers app={a} form={appsOf?.form} /></div>
            {a.cv && <Button size="sm" variant="outline" icon="file-text" onClick={() => openCv(a)}>CV</Button>}
            <Select value={a.status} onChange={(v) => setStatus(a, v)} options={APP_STATUS.map(([id, label]) => ({ id, label }))} style={{ width: 150 }} aria-label="Status" /></li>))}</ul>}
      </Drawer>
    </>
  );
}
