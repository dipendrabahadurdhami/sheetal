// FormBuilder: a form drawn from a list of field definitions.
// Where it fits: CrudPage's add / change drawer; later the admin field builder stores the same definitions as data (SETTINGS.md section 5).
// How it works: each field is { key, type, label, hint, required, requiredWhen, visibleWhen, readOnlyWhen, min, max, maxLength, options,
// accept, maxMB, columns } (docs/architecture/FRONTEND-KIT.md section 6). `values` / `onChange(patch)` hold the data; `errors` is
// { field: [message] } straight from ApiError.errors (422) and is also summarised at the top. mode "view" shows the values as a facts list.
// Rules: the rules themselves live in formRules.js (tested without a browser). Client checks are for speed only; the server is the judge.
// Every control has a <label for>, errors use aria-describedby, and the first invalid field gets focus after a failed save.

import React, { useEffect, useRef, useState } from "react";
import { Icon } from "@sheetal/shared/core/icons";
import { useLang, useT } from "@sheetal/shared/core/i18n";
import { fdate, rs } from "@sheetal/shared/core/format";
import { Input, Select, Seg, Textarea, ToggleRow } from "../primitives.jsx";
import { digits, fieldState, firstInvalidKey, visibleFields } from "./formRules.js";

/** A label that may be a string or { en, ne }. */
export const labelOf = (label, lang = "en") => (label && typeof label === "object" ? label[lang] || label.en || "" : label || "");

/** Options as [{ id, label }]: from the field's own list, or { from: "categories" } read out of `context`. Items may use label, en or name. */
export function optionsOf(field, context = {}, lang = "en") {
  const raw = Array.isArray(field.options) ? field.options : field.options?.from ? context[field.options.from] || [] : field.type === "branch" ? context.branches || [] : [];
  return raw.map((o) => ({ id: o.id, label: labelOf(o.label ?? (lang === "ne" ? o.ne : null) ?? o.en ?? o.name ?? o.id, lang) }));
}

const INPUT_MODE = { phone: "tel", email: "email", url: "url", int: "numeric", money: "numeric" };

function Control({ f, id, value, onChange, disabled, error, describedBy, options, t }) {
  const common = { id, disabled, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy };
  switch (f.type) {
    case "textarea":
      return <Textarea rows={f.rows || 3} {...common} maxLength={f.maxLength} placeholder={f.placeholder} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
    case "int":
      return <Input {...common} className="input tnum" inputMode="numeric" placeholder={f.placeholder} value={value ?? ""} onChange={(e) => onChange(digits(e.target.value).slice(0, f.maxLength || 15))} />;
    case "money":
      return (
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="muted" aria-hidden="true">Rs.</span>
          <Input {...common} className="input tnum" inputMode="numeric" placeholder={f.placeholder} value={value ?? ""} onChange={(e) => onChange(digits(e.target.value).slice(0, 12))} />
        </span>
      );
    case "date":
      return <Input {...common} type="date" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
    case "month":
      return <Input {...common} type="month" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
    case "select":
    case "branch":
      return <Select {...common} value={value ?? ""} onChange={onChange} options={[{ id: "", label: t("kit.choose") }, ...options]} />;
    case "seg":
      return <Seg label={labelOf(f.label)} options={options} value={value} onChange={onChange} />;
    case "phone": case "email": case "url": case "text": default:
      return <Input {...common} inputMode={INPUT_MODE[f.type]} maxLength={f.maxLength} placeholder={f.placeholder} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
  }
}

/** A file field: choose, replace or remove. Value: a File (new), { existing: true } (saved, untouched) or null (nothing / removed). */
function FileControl({ f, id, value, onChange, disabled, describedBy, t }) {
  const [local, setLocal] = useState("");
  const saved = value && value.existing;
  const pick = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (f.maxMB && file.size > f.maxMB * 1024 * 1024) { e.target.value = ""; setLocal(t("kit.fileTooBig", { n: f.maxMB })); return; }
    setLocal(""); onChange(file);
  };
  return (
    <>
      <input id={id} type="file" accept={f.accept} disabled={disabled} onChange={pick} aria-describedby={describedBy} />
      {local && <small style={{ color: "var(--problem, #b42318)" }} role="alert">{local}</small>}
      {saved && <small className="muted">{t("kit.fileSaved")} <button type="button" className="link" onClick={() => onChange(null)}>{t("kit.remove")}</button></small>}
      {value && !saved && <small className="muted">{value.name} <button type="button" className="link" onClick={() => onChange(null)}>{t("kit.remove")}</button></small>}
    </>
  );
}

function show(f, v, options) {
  if (v === null || v === undefined || v === "") return "";
  if (f.type === "money") return rs(Number(v));
  if (f.type === "date") return fdate(v);
  if (f.type === "toggle") return v ? "✓" : "–";
  if (f.type === "select" || f.type === "seg" || f.type === "branch") return options.find((o) => String(o.id) === String(v))?.label || v;
  if (f.type === "file") return v.existing ? "✓" : v.name || "";
  return String(v);
}

export function FormBuilder({ fields, values, onChange, errors = {}, mode = "edit", context = {}, disabled = false }) {
  const t = useT();
  const lang = useLang();
  const box = useRef(null);
  const shown = visibleFields(fields, values, context);

  // After a failed save, put the cursor on the first field with an error.
  useEffect(() => {
    const key = firstInvalidKey(shown, errors);
    if (key) box.current?.querySelector(`#fb-${typeof CSS !== "undefined" && CSS.escape ? CSS.escape(key) : key}`)?.focus?.();
  }, [errors]);

  if (mode === "view") {
    const rows = shown.map((f) => [labelOf(f.label, lang), show(f, values[f.key], optionsOf(f, context, lang))]).filter(([, v]) => v !== "");
    return <dl className="pf-kv">{rows.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}</dl>;
  }

  const summary = Object.entries(errors).filter(([, m]) => m?.length);
  const nodes = [];
  for (let i = 0; i < shown.length; i++) {
    const f = shown[i];
    const item = renderField(f);
    const next = shown[i + 1];
    if (f.columns === 2 && next && next.columns === 2) { nodes.push(<div className="pf-grid-2 tight" key={`${f.key}+${next.key}`}>{item}{renderField(next)}</div>); i++; }
    else nodes.push(item);
  }

  function renderField(f) {
    const st = fieldState(f, values);
    const id = `fb-${f.key}`;
    const err = errors[f.key]?.[0];
    const hintId = f.hint || err ? `${id}-note` : undefined;
    const label = labelOf(f.label, lang);
    const options = optionsOf(f, context, lang);
    const ro = disabled || st.readOnly;
    const hint = f.hint;
    const len = f.maxLength && typeof values[f.key] === "string" && values[f.key].length >= f.maxLength * 0.8 ? `${values[f.key].length}/${f.maxLength}` : null;
    if (f.type === "toggle") {
      return <div className="field" key={f.key}><ToggleRow title={label} sub={f.hint} checked={!!values[f.key]} onChange={(v) => onChange({ [f.key]: v })} disabled={ro} />{err && <span className="pf-error" id={hintId}><Icon name="circle-alert" size={14} />{err}</span>}</div>;
    }
    return (
      <div className="field" key={f.key}>
        <label htmlFor={id}>{label}{!st.required && <span className="muted" style={{ fontWeight: 400 }}> ({t("common.optional")})</span>}</label>
        {f.type === "file"
          ? <FileControl f={f} id={id} value={values[f.key]} onChange={(v) => onChange({ [f.key]: v })} disabled={ro} describedBy={hintId} t={t} />
          : <Control f={f} id={id} value={values[f.key]} onChange={(v) => onChange({ [f.key]: v })} disabled={ro} error={err} describedBy={hintId} options={options} t={t} />}
        {err ? <span className="pf-error" id={hintId}><Icon name="circle-alert" size={14} />{err}</span> : hint ? <span className="pf-hint" id={hintId}>{hint}</span> : null}
        {len && <span className="pf-hint tnum" aria-hidden="true">{len}</span>}
      </div>
    );
  }

  return (
    <div className="pf-stack" ref={box}>
      {summary.length > 0 && (
        <div className="pf-note" role="alert">
          <Icon name="circle-alert" size={16} />
          <span>{t("kit.fixErrors")}
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{summary.map(([k, m]) => { const f = fields.find((x) => x.key === k); return <li key={k}>{f ? `${labelOf(f.label, lang)}: ` : ""}{m[0]}</li>; })}</ul>
          </span>
        </div>
      )}
      {nodes}
    </div>
  );
}
