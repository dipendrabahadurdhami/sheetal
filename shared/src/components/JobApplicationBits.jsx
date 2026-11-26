// Job application pieces used by both panels (admin Careers and business Jobs): which extra questions a job asks, and an
// applicant's answers. The questions themselves are in shared/src/data/jobForm.js.

import React from "react";
import { Field, Select, ToggleRow } from "../core/ui";
import { ASK_LEVELS, answerText, applicationQuestions, jobFormOf } from "../data/jobForm";

/** The extra questions for one job: portfolio and references (off, optional, required), two-wheeler and on-camera. */
export function JobFormFields({ form, onChange }) {
  const f = jobFormOf(form);
  const set = (k) => (v) => onChange({ ...f, [k]: v });
  return (
    <div className="pf-stack">
      <p className="small muted" style={{ margin: 0 }}>Every application asks for experience, current and expected salary, notice period, achievements and a CV. Add these when the role needs them:</p>
      <div className="pf-grid-2 tight">
        <Field label="Portfolio or work samples"><Select value={f.portfolio} onChange={set("portfolio")} options={ASK_LEVELS.map(([id, label]) => ({ id, label }))} /></Field>
        <Field label="Professional references"><Select value={f.references} onChange={set("references")} options={ASK_LEVELS.map(([id, label]) => ({ id, label }))} /></Field>
      </div>
      <ToggleRow title="Ask about own two-wheeler and licence" sub="For field roles." checked={f.vehicle} onChange={set("vehicle")} />
      <ToggleRow title="Ask about appearing in company videos" sub="For roles that present properties on camera." checked={f.camera} onChange={set("camera")} />
    </div>
  );
}

/** An applicant's answers, question by question (empty answers are left out). */
export function ApplicationAnswers({ app, form }) {
  const a = app.answers || {};
  const rows = applicationQuestions(form)
    .filter((q) => !["name", "email", "phone", "cv", "consent", "cover_letter"].includes(q.key))
    .map((q) => [q, answerText(q, a[q.key])]).filter(([, t]) => t);
  if (!rows.length) return null;
  return (
    <dl className="small" style={{ display: "grid", gridTemplateColumns: "minmax(120px, 40%) 1fr", gap: "4px 12px", margin: "8px 0 0" }}>
      {rows.map(([q, t]) => (
        <React.Fragment key={q.key}>
          <dt className="muted">{q.label}</dt>
          <dd style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{q.kind === "url" ? <a href={t} target="_blank" rel="noreferrer noopener">{t}</a> : t}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}
