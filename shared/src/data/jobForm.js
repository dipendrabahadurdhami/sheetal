// The job application questions: the website's apply form, and the answers shown in the admin and business panels.
// Where it fits: website/frontend Careers (JobDetail), admin LiveContent (Careers), business Jobs. The website API checks the
// same keys and required fields (website/backend/src/modules/content/application.ts); change both together.
// How it works: every job asks the standard questions; a job's `form` adds portfolio and references (off, optional or
// required) and the two-wheeler and on-camera questions (on or off).

export const NOTICE = [["now", "I can join now"], ["2w", "1–2 weeks"], ["1m", "1 month"], ["2m", "2 months"], ["3m", "3 months or more"]];
export const PERF_PAY = [["yes", "Yes"], ["depends", "Depends on the structure"], ["no", "No, fixed salary only"]];
export const YES_NO = [["yes", "Yes"], ["no", "No"]];
export const ASK_LEVELS = [["off", "Don't ask"], ["optional", "Ask (optional)"], ["required", "Ask (required)"]];

/** The extra questions a job can turn on, with their defaults. */
export const defaultJobForm = () => ({ portfolio: "optional", references: "optional", vehicle: false, camera: false });
export const jobFormOf = (f) => ({ ...defaultJobForm(), ...(f && typeof f === "object" ? f : {}) });

/**
 * The application form for one job, in steps. Each question: key, label, kind (text, email, tel, url, number, money, date,
 * textarea, choice, file, check), required, and an optional hint, placeholder or options.
 */
export function applicationSteps(form) {
  const f = jobFormOf(form);
  const extra = (level) => level !== "off";
  return [
    { id: "you", title: "About you", questions: [
      { key: "name", label: "Full name", kind: "text", required: true, autoComplete: "name" },
      { key: "email", label: "Email", kind: "email", required: true, autoComplete: "email" },
      { key: "phone", label: "Mobile number", kind: "tel", required: true, autoComplete: "tel", placeholder: "98XXXXXXXX" },
      { key: "city", label: "Where do you live now?", kind: "text", required: true, placeholder: "e.g. Kathmandu" },
      { key: "linkedin", label: "LinkedIn profile", kind: "url", required: false, placeholder: "https://linkedin.com/in/…" },
    ] },
    { id: "work", title: "Your experience", questions: [
      { key: "current_company", label: "Current or last organisation", kind: "text", required: false },
      { key: "current_role", label: "Your designation there", kind: "text", required: false, placeholder: "e.g. Senior Sales Officer" },
      { key: "total_experience", label: "Total work experience (years)", kind: "number", required: true },
      { key: "relevant_experience", label: "Experience relevant to this role (years)", kind: "number", required: true },
      { key: "employers_5y", label: "How many employers in the last 5 years?", kind: "number", required: false },
      { key: "achievements", label: "Your biggest measurable achievements", kind: "textarea", required: true, hint: "Numbers help: targets met, deals closed, growth, awards." },
      { key: "results", label: "Targets, revenue, campaign or team results", kind: "textarea", required: false, hint: "For example: sold NPR 4 crore in 2025 against a target of 3 crore." },
      { key: "reason_change", label: "Why are you considering a change?", kind: "textarea", required: false },
    ] },
    { id: "pay", title: "Pay and joining", questions: [
      { key: "current_salary", label: "Current fixed salary (NPR a month)", kind: "money", required: false },
      { key: "current_total", label: "Current total pay with incentives (NPR a month)", kind: "money", required: false },
      { key: "expected_salary", label: "Expected fixed salary (NPR a month)", kind: "money", required: true },
      { key: "performance_pay", label: "Open to performance-linked pay (commission, incentives)?", kind: "choice", options: PERF_PAY, required: true },
      { key: "notice_period", label: "Notice period", kind: "choice", options: NOTICE, required: true },
      { key: "joining_date", label: "Earliest joining date", kind: "date", required: false },
      { key: "commitments", label: "Any business, freelance or other work that could affect a full-time role?", kind: "textarea", required: false },
      ...(f.vehicle ? [{ key: "vehicle", label: "Do you have your own two-wheeler and a valid driving licence?", kind: "choice", options: YES_NO, required: true }] : []),
      ...(f.camera ? [{ key: "camera", label: "Are you comfortable appearing in company videos?", kind: "choice", options: YES_NO, required: true }] : []),
    ] },
    { id: "docs", title: "CV and documents", questions: [
      { key: "cv", label: "Your CV", kind: "file", required: true, hint: "PDF, DOC or DOCX, up to 8 MB." },
      ...(extra(f.portfolio) ? [{ key: "portfolio", label: "Portfolio or work samples (link)", kind: "url", required: f.portfolio === "required", placeholder: "Google Drive, YouTube, website…", hint: "Make sure the link opens without asking for access." }] : []),
      ...(extra(f.references) ? [{ key: "references", label: "Professional references", kind: "textarea", required: f.references === "required", hint: "Two people: name, organisation, phone, and how they know you. We contact them only with your consent." }] : []),
      { key: "cover_letter", label: "Why this role, and why you?", kind: "textarea", required: false },
      { key: "consent", label: "The information I gave is true, and Sheetal may verify it and contact my references.", kind: "check", required: true },
    ] },
  ];
}

/** Every question of one job, in order (for showing answers). */
export const applicationQuestions = (form) => applicationSteps(form).flatMap((s) => s.questions);

/** An answer as words: choices by their label, money with NPR. */
export function answerText(q, v) {
  if (v == null || v === "") return "";
  if (q.kind === "choice") return q.options.find(([id]) => id === v)?.[1] || String(v);
  if (q.kind === "money") return `NPR ${Number(v).toLocaleString("en-IN")}`;
  if (q.kind === "check") return v === true || v === "true" ? "Yes" : "No";
  return String(v);
}
