// The online-form builder (BuilderCore) and its field preview, used by LiveForms.jsx on the business API; the public form page is the website's /f/:slug.
// Where it fits: Business → Forms. The sample forms list, responses and public page that were here went with the sample workspace (P2-W6).

import React, { useEffect, useRef, useState } from "react";
import { useStore } from "@sheetal/shared/core/store";
import { useRouter, Link } from "@sheetal/shared/core/router";
import { initials, rs } from "@sheetal/shared/core/format";
import { Button, Checkbox, Field, IconButton, Input, Seg, Textarea, ToggleRow, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import {
  CHOICE, DESTS, DEST_LABEL, FIELD_TYPES, FONTS, PALETTE, PLACES, SWATCHES, formFromTemplate, formLimits, formsOf, makeField,
  responsesOf, slugify, templatesFor,
} from "@sheetal/shared/core/forms";
import { FormView } from "@sheetal/shared/components/FormView";
import { defaultTenantSettings } from "./BusinessSettings";

const uniqueSlug = (list, slug, selfId) => { const b = slug || "form"; let s = b, i = 2; while (list.some((x) => x.id !== selfId && x.slug === s)) s = `${b}-${i++}`; return s; };
const RANGE = ["number", "money"];
const CHARS = ["short", "long"];
const INPUTS = { short: "text", phone: "tel", email: "email", number: "number", money: "text", date: "date", time: "time" };
export { FormView };

function ensure(d, tenant) {
  d.forms = d.forms || {}; d.formResponses = d.formResponses || {};
  if (!d.forms[tenant.id]) d.forms[tenant.id] = [];
  if (!d.formResponses[tenant.id]) d.formResponses[tenant.id] = [];
}
function useFormsData(tenant) {
  const { db, update } = useStore();
  useEffect(() => { if (!db.forms?.[tenant.id]) update((d) => ensure(d, tenant)); }, [tenant.id]);
  const forms = formsOf(db, tenant);
  const responses = responsesOf(db, tenant);
  const setForms = (fn) => update((d) => { ensure(d, tenant); fn(d.forms[tenant.id], d); });
  const setResponses = (fn) => update((d) => { ensure(d, tenant); fn(d.formResponses[tenant.id], d); });
  return { db, forms, responses, setForms, setResponses, lim: formLimits(db, tenant), ts: db.tenantSettings[tenant.id] || defaultTenantSettings(tenant) };
}

// Create a form from a template (or blank) and open the builder. Also used by "Create online form" buttons elsewhere.
export function useCreateForm(tenant) {
  const { forms, setForms, lim, ts } = useFormsData(tenant);
  const { navigate } = useRouter();
  const toast = useToast();
  return (key) => {
    if (lim.forms !== -1 && forms.length >= lim.forms) { toast(`Your plan includes ${lim.forms} forms. Upgrade to add more.`); navigate("/business/billing"); return; }
    const f = formFromTemplate(key, tenant, ts);
    setForms((list) => { f.slug = uniqueSlug(list, f.slug); list.unshift(f); });
    navigate(`/business/forms/${f.id}`);
  };
}
export function CreateFormButton({ tenant, tpl, variant = "outline" }) {
  const create = useCreateForm(tenant);
  return <Button variant={variant} icon="file-plus" onClick={() => create(tpl)}>Create online form</Button>;
}






/** The drag-and-drop builder. It keeps its own copy of the form and calls onSave(form) a moment after each change
 *  (onSave may return a promise with the saved { slug }); onPublish(form) publishes (return false if it didn't). */
export function BuilderCore({ tenant, initial, ts, districts, linkOf, onSave, onPublish, settingsExtra, barExtra }) {
  const toast = useToast();
  const [f, setF] = useState(() => structuredClone(initial));
  const [sel, setSel] = useState(null);
  const [panel, setPanel] = useState(false);
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  const [tplOpen, setTplOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const [saved, setSaved] = useState(true);
  const [saveErr, setSaveErr] = useState("");
  const latest = useRef(f); const dirty = useRef(false); const first = useRef(true);
  const save = (v) => Promise.resolve(onSave(v)).then((r) => { setSaveErr(""); if (r?.slug && r.slug !== latest.current.slug) setF((x) => ({ ...x, slug: r.slug })); return true; }).catch((e) => { setSaveErr(e?.message || "Not saved"); return false; });
  useEffect(() => {
    latest.current = f;
    if (first.current) { first.current = false; return undefined; }
    dirty.current = true; setSaved(false);
    const tm = setTimeout(() => { dirty.current = false; save(latest.current).then(() => setSaved(true)); }, 400);
    return () => clearTimeout(tm);
  }, [f]);
  useEffect(() => () => { if (dirty.current && latest.current) save(latest.current); }, []);
  const publish = async () => { dirty.current = false; if (!(await save(latest.current))) { toast("Fix the form first: it isn't saved."); return; } const ok = await onPublish(latest.current); if (ok !== false) patch({ status: "live" }); };

  const patch = (p) => setF((x) => ({ ...x, ...p }));
  const setFields = (fn) => setF((x) => ({ ...x, fields: fn(x.fields.slice()) }));
  const updField = (fid, p) => setFields((a) => a.map((x) => (x.id === fid ? { ...x, ...p } : x)));
  const addAt = (type, idx) => { const nf = makeField(type); setFields((a) => { a.splice(idx == null ? a.length : idx, 0, nf); return a; }); setSel(nf.id); };
  const moveTo = (fid, idx) => setFields((a) => { const from = a.findIndex((x) => x.id === fid); const [it] = a.splice(from, 1); a.splice(idx > from ? idx - 1 : idx, 0, it); return a; });
  const endDrag = () => { setDrag(null); setOver(null); };
  const dropAt = (idx) => { if (!drag) return; if (drag.kind === "new") addAt(drag.type, idx); else moveTo(drag.id, idx); endDrag(); };
  const cardOver = (i) => (e) => { if (!drag) return; e.preventDefault(); e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); const idx = e.clientY < r.top + r.height / 2 ? i : i + 1; if (over !== idx) setOver(idx); };
  const pick = (fid) => { setSel(fid); setPanel(true); };
  const applyTpl = (key) => { const t = formFromTemplate(key, tenant, ts); setF((x) => ({ ...x, tpl: key, title: t.title, desc: t.desc, fields: t.fields, dest: t.dest, places: t.places, thanks: t.thanks, slug: x.status === "draft" ? t.slug : x.slug })); setSel(null); setTplOpen(false); toast(key ? `${t.title} template applied` : "Started a blank form"); };
  const selF = f.fields.find((x) => x.id === sel);
  const asked = f.fields.filter((x) => !FIELD_TYPES[x.type].noAnswer);
  const link = linkOf(f);
  const st = f.style || {};

  return (
    <div className="fb-build">
      <aside className="fb-palette" aria-label="Fields">
        <div><b className="small">Fields</b><p className="tiny muted">Drag onto the form, or click to add at the end.</p></div>
        {PALETTE.map(([title, keys]) => (
          <div key={title} className="fb-pgroup"><span className="pf-subhead">{title}</span>
            <div className="fb-pgrid">{keys.map((k) => (
              <button key={k} type="button" draggable className="fb-pitem" onClick={() => addAt(k, null)}
                onDragStart={(e) => { e.dataTransfer.effectAllowed = "copy"; e.dataTransfer.setData("text/plain", k); setDrag({ kind: "new", type: k }); }} onDragEnd={endDrag}>
                <Icon name={FIELD_TYPES[k].icon} size={18} />{FIELD_TYPES[k].label}
              </button>
            ))}</div>
          </div>
        ))}
      </aside>

      <section className="fb-canvas" onDragOver={(e) => { if (drag) { e.preventDefault(); if (over == null) setOver(f.fields.length); } }} onDrop={(e) => { e.preventDefault(); dropAt(over ?? f.fields.length); }}>
        <div className="fb-bar">
          <Link to="/business/forms" className="fb-back"><Icon name="arrow-left" size={16} />All forms</Link>
          <span className="small muted">{asked.length} fields · {saveErr ? <span className="fb-accent">not saved: {saveErr}</span> : saved ? "saved" : "saving…"} · answers go to {DEST_LABEL[f.dest]}</span>
          <div className="pf-row-actions">
            <Button variant="outline" size="sm" icon="layout-grid" onClick={() => setTplOpen((o) => !o)}>Templates</Button>
            <Button variant="outline" size="sm" icon="eye" onClick={() => setPreview(true)}>Preview</Button>
            {barExtra}
            <Button size="sm" icon="send" onClick={publish}>{f.status === "live" ? "Share" : "Publish and share"}</Button>
          </div>
        </div>
        {tplOpen && <div className="card fb-tplbox">
          <div className="fb-tplbox-head"><b>Switch template</b><span className="small muted">Replaces the fields below. You can edit everything after.</span><IconButton icon="x" label="Close" onClick={() => setTplOpen(false)} /></div>
          <div className="fb-tplmini">
            <button type="button" className="fb-mini dashed" onClick={() => applyTpl(null)}><Icon name="plus" size={18} />Blank form</button>
            {templatesFor(tenant.type).map(([k, icon, name, , d]) => <button key={k} type="button" className={`fb-mini ${f.tpl === k ? "on" : ""}`} onClick={() => applyTpl(k)}><Icon name={icon} size={18} />{name}<small className="muted">{DEST_LABEL[d]}</small></button>)}
          </div>
        </div>}

        <div className={`card fb-head ${sel ? "" : "on"}`} onClick={() => pick(null)} style={{ "--fa": st.accent }}>
          <div className="fb-head-body">
            <span className="fb-logo">{st.logoUrl ? <img src={st.logoUrl} alt="" /> : st.logo || initials(tenant.name)}</span>
            <div className="fb-head-text">
            <input className="fb-title" value={f.title} aria-label="Form title" onChange={(e) => patch({ title: e.target.value, ...(f.status === "draft" ? { slug: slugify(e.target.value) } : {}) })} />
            <textarea className="fb-desc" rows={2} value={f.desc} aria-label="Form description" onChange={(e) => patch({ desc: e.target.value })} />
            </div>
          </div>
        </div>

        {!f.fields.length && <div className="fb-empty"><Icon name="grip-vertical" size={30} /><p>Drag a field here to start, or click one on the left.</p></div>}
        {f.fields.map((x, i) => {
          const T = FIELD_TYPES[x.type];
          const rule = CHARS.includes(x.type) ? (x.max ? `Up to ${x.max} characters` : "") : RANGE.includes(x.type) ? [x.min && `Min ${x.min}`, x.max && `Max ${x.max}`].filter(Boolean).join(" · ") : "";
          return (
            <React.Fragment key={x.id}>
              <div className={`fb-drop ${drag && over === i ? "on" : ""}`} />
              <div className={`card fb-field ${sel === x.id ? "on" : ""} ${drag?.id === x.id ? "dragging" : ""} ${x.type === "page" ? "is-break" : ""}`} draggable
                onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", x.id); setDrag({ kind: "move", id: x.id }); }} onDragEnd={endDrag}
                onDragOver={cardOver(i)} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); dropAt(over ?? i); }} onClick={() => pick(x.id)}>
                <span className="fb-grip" aria-hidden="true"><Icon name="grip-vertical" size={18} /></span>
                <div className="fb-field-main">
                  <div className="fb-field-top"><b>{x.type === "page" ? "Next page" : x.label}</b>{x.required && <span className="fb-star">*</span>}<span className="fb-type">{T.label}</span></div>
                  <FieldPreview x={x} />
                  {x.help && <span className="small muted">{x.help}</span>}
                  {!T.noAnswer && <div className="fb-field-foot" onClick={(e) => e.stopPropagation()}>
                    <label className="fb-req"><input type="checkbox" checked={x.required} onChange={(e) => updField(x.id, { required: e.target.checked })} />Required</label>
                    {rule && <span className="small muted">{rule}</span>}{x.half && <span className="small muted fb-push">Half width</span>}
                  </div>}
                </div>
                <div className="fb-field-act" onClick={(e) => e.stopPropagation()}>
                  <IconButton icon="arrow-up" size={16} label="Move up" disabled={i === 0} onClick={() => moveTo(x.id, i - 1)} />
                  <IconButton icon="arrow-down" size={16} label="Move down" disabled={i === f.fields.length - 1} onClick={() => moveTo(x.id, i + 2)} />
                  <IconButton icon="copy" size={16} label="Duplicate" onClick={() => { const c = { ...structuredClone(x), id: makeField(x.type).id }; setFields((a) => { a.splice(i + 1, 0, c); return a; }); setSel(c.id); }} />
                  <IconButton icon="trash-2" size={16} label="Delete" onClick={() => { setFields((a) => a.filter((y) => y.id !== x.id)); if (sel === x.id) setSel(null); }} />
                </div>
              </div>
            </React.Fragment>
          );
        })}
        <div className={`fb-drop end ${drag && over === f.fields.length ? "on" : ""}`} onDragOver={(e) => { if (drag) { e.preventDefault(); e.stopPropagation(); setOver(f.fields.length); } }} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); dropAt(f.fields.length); }} />
      </section>

      {panel && <div className="fb-scrim" onClick={() => setPanel(false)} />}
      <aside className={`fb-props ${panel ? "open" : ""}`} aria-label={selF ? "Field settings" : "Form settings"}>
        <div className="fb-props-head"><b>{selF ? FIELD_TYPES[selF.type].label : "Form settings"}</b>{selF && <button type="button" className="link small" onClick={() => setSel(null)}>Form settings</button>}<IconButton icon="x" label="Close" className="fb-props-x" onClick={() => setPanel(false)} /></div>
        {selF ? <FieldSettings x={selF} set={(p) => updField(selF.id, p)} /> : <FormSettings f={f} patch={patch} link={link} hasPay={f.fields.some((x) => x.type === "payment")} toast={toast} extra={settingsExtra} />}
      </aside>

      {preview && <div className="fb-preview" role="dialog" aria-modal="true" aria-label="Preview">
        <PreviewFrame form={f} tenant={tenant} host={link.url.replace(/^https?:\/\//, "")} onClose={() => setPreview(false)} districts={districts} />
      </div>}
    </div>
  );
}

export function FieldPreview({ x }) {
  if (INPUTS[x.type]) return <div className="fb-pv-line">{x.ph || FIELD_TYPES[x.type].label}</div>;
  if (x.type === "long") return <div className="fb-pv-box">{x.ph}</div>;
  if (CHOICE.includes(x.type)) return <div className="fb-pv-opts">{x.opts.map((o, i) => <span key={i}><i className={x.type === "multi" ? "sq" : x.type === "single" ? "ci" : "dd"} />{o}</span>)}</div>;
  if (x.type === "rating") return <div className="fb-pv-stars">{[1, 2, 3, 4, 5].map((s) => <Icon key={s} name="star" size={22} />)}</div>;
  if (x.type === "file") return <div className="fb-pv-file"><Icon name="upload" size={18} />Upload a file · PDF or photo, up to 5 MB</div>;
  if (x.type === "location") return <div className="fb-pv-2"><div className="fb-pv-line">District</div><div className="fb-pv-line">Area</div></div>;
  if (x.type === "payment") return <div className="fb-pv-pay"><span className="fb-ph">your QR</span><span className="small muted">Pay {rs(x.amount)} by Fonepay, eSewa or bank, then upload the screenshot. You confirm it in Responses.</span></div>;
  if (x.type === "section") return <span className="small muted">Groups the questions below under this heading.</span>;
  if (x.type === "page") return <div className="fb-pv-break"><span />Questions below show on the next page<span /></div>;
  return null;
}

function FieldSettings({ x, set }) {
  const T = FIELD_TYPES[x.type];
  if (x.type === "page") return <p className="small muted">Questions after this break show on a new page, with Back and Next buttons. Use it to keep long forms short on phones.</p>;
  const num = (v) => v.replace(/\D/g, "");
  return (
    <div className="pf-stack">
      <Field label={x.type === "section" ? "Heading" : "Question"}><Input value={x.label} onChange={(e) => set({ label: e.target.value })} /></Field>
      <Field label="Help text" optional><Input value={x.help} placeholder="Shown under the question" onChange={(e) => set({ help: e.target.value })} /></Field>
      {T.ph !== undefined && <Field label="Placeholder"><Input value={x.ph} onChange={(e) => set({ ph: e.target.value })} /></Field>}
      {CHOICE.includes(x.type) && <Field label="Options">
        <div className="fb-opts">{x.opts.map((o, i) => <div key={i} className="fb-opt"><Input value={o} aria-label={`Option ${i + 1}`} onChange={(e) => set({ opts: x.opts.map((y, j) => (j === i ? e.target.value : y)) })} />
          <IconButton icon="x" size={16} label="Remove option" disabled={x.opts.length < 2} onClick={() => set({ opts: x.opts.filter((_, j) => j !== i) })} /></div>)}</div>
        <button type="button" className="link small fb-addopt" onClick={() => set({ opts: [...x.opts, `Option ${x.opts.length + 1}`] })}><Icon name="plus" size={14} />Add option</button>
      </Field>}
      {RANGE.includes(x.type) && <div className="pf-grid-2 tight fb-two"><Field label={x.type === "money" ? "Min (Rs.)" : "Min"}><Input inputMode="numeric" value={x.min} onChange={(e) => set({ min: num(e.target.value) })} /></Field>
        <Field label={x.type === "money" ? "Max (Rs.)" : "Max"}><Input inputMode="numeric" value={x.max} onChange={(e) => set({ max: num(e.target.value) })} /></Field></div>}
      {CHARS.includes(x.type) && <Field label="Character limit" optional><Input inputMode="numeric" value={x.max} placeholder="No limit" onChange={(e) => set({ max: num(e.target.value) })} /></Field>}
      {x.type === "payment" && <Field label="Amount (Rs.)" hint="Add your QR, eSewa or bank details in Form settings."><Input inputMode="numeric" value={x.amount ? x.amount.toLocaleString("en-IN") : ""} onChange={(e) => set({ amount: Number(num(e.target.value)) || 0 })} /></Field>}
      {x.type !== "section" && <Field label="Width"><Seg value={x.half ? "half" : "full"} onChange={(v) => set({ half: v === "half" })} options={[{ id: "full", label: "Full width" }, { id: "half", label: "Half width" }]} label="Width" /></Field>}
      {!T.noAnswer && <ToggleRow title="Required" sub={x.required ? "People must answer this" : "People can skip this"} checked={x.required} onChange={(v) => set({ required: v })} />}
    </div>
  );
}

function readImage(file, toast, cb) {
  if (!file) return;
  if (file.size > 400 * 1024) { toast("Pick an image under 400 KB"); return; }
  const r = new FileReader(); r.onload = () => cb(r.result); r.readAsDataURL(file);
}

function FormSettings({ f, patch, link, hasPay, toast, extra }) {
  const st = f.style || {};
  const sty = (p) => patch({ style: { ...st, ...p } });
  const pay = f.pay || {};
  return (
    <div className="pf-stack">
      {extra}
      <Field label="Answers go to"><Seg value={f.dest} onChange={(v) => patch({ dest: v })} options={DESTS.map(([id, label]) => ({ id, label }))} label="Answers go to" /></Field>
      <Field label="Show this form on"><div className="pf-stack tight">{PLACES.map(([k, label, sub]) => <Checkbox key={k} checked={!!f.places?.[k]} label={label} sub={sub} onChange={(v) => patch({ places: { ...f.places, [k]: v } })} />)}</div></Field>
      <Field label="Link" hint={link.url}><div className="fb-slug"><span className="small muted">/f/</span><Input value={f.slug} onChange={(e) => patch({ slug: slugify(e.target.value) })} /></div></Field>
      <span className="pf-subhead">Look</span>
      <div className="fb-logo-row">
        <Field label="Logo"><Input value={st.logo || ""} maxLength={3} className="input fb-logo-in" onChange={(e) => sty({ logo: e.target.value.toUpperCase() })} /></Field>
        <label className="fb-upload"><Icon name="image" size={16} />{st.logoUrl ? "Change logo image" : "Upload logo image"}<input type="file" accept="image/*" onChange={(e) => readImage(e.target.files[0], toast, (u) => sty({ logoUrl: u }))} /></label>
        {st.logoUrl && <IconButton icon="trash-2" size={15} label="Remove logo image" onClick={() => sty({ logoUrl: "" })} />}
      </div>
      <Field label="Accent colour"><div className="fb-swatches">{SWATCHES.map((c) => <button key={c} type="button" aria-label={c} aria-pressed={st.accent === c} className={st.accent === c ? "on" : ""} style={{ background: c }} onClick={() => sty({ accent: c })} />)}
        <label className="fb-swatch-custom" title="Custom colour"><input type="color" value={st.accent || SWATCHES[0]} onChange={(e) => sty({ accent: e.target.value })} aria-label="Custom colour" /></label></div></Field>
      <Field label="Font"><Seg value={st.font || "brand"} onChange={(v) => sty({ font: v })} options={FONTS.map(([id, label]) => ({ id, label }))} label="Font" /></Field>
      <Field label="Corners"><Seg value={st.corners || "rounded"} onChange={(v) => sty({ corners: v })} options={[{ id: "rounded", label: "Rounded" }, { id: "square", label: "Square" }]} label="Corners" /></Field>
      <Field label="Button text"><Input value={st.button || ""} placeholder="Submit" onChange={(e) => sty({ button: e.target.value })} /></Field>
      <Field label="Thank-you message"><Textarea rows={3} value={f.thanks} onChange={(e) => patch({ thanks: e.target.value })} /></Field>
      <span className="pf-subhead">Payment details</span>
      <span className="small muted">{hasPay ? "Shown on Payment fields. People pay, then upload a screenshot for you to confirm." : "Add a Payment field to take a fee or advance with this form."}</span>
      <div className="fb-logo-row">
        {pay.qrUrl ? <img src={pay.qrUrl} alt="Your payment QR" className="fb-qr-thumb" /> : <span className="fb-ph sm">QR</span>}
        <label className="fb-upload"><Icon name="qr-code" size={16} />{pay.qrUrl ? "Change Fonepay QR" : "Upload Fonepay QR"}<input type="file" accept="image/*" onChange={(e) => readImage(e.target.files[0], toast, (u) => patch({ pay: { ...pay, qrUrl: u } }))} /></label>
      </div>
      <Field label="eSewa ID" optional><Input value={pay.esewa || ""} placeholder="98XXXXXXXX" onChange={(e) => patch({ pay: { ...pay, esewa: e.target.value } })} /></Field>
      <Field label="Bank details" optional><Textarea rows={3} value={pay.bank || ""} placeholder="Bank, account name, account number" onChange={(e) => patch({ pay: { ...pay, bank: e.target.value } })} /></Field>
    </div>
  );
}

function PreviewFrame({ form, tenant, host, onClose, districts }) {
  const [mobile, setMobile] = useState(false);
  return (
    <>
      <div className="fb-preview-bar">
        <Seg value={mobile ? "m" : "d"} onChange={(v) => setMobile(v === "m")} options={[{ id: "d", label: "Desktop", icon: "laptop" }, { id: "m", label: "Mobile", icon: "smartphone" }]} label="Device" />
        <span className="small muted pf-ellipsis">{host}</span>
        <Button variant="outline" size="sm" icon="x" onClick={onClose}>Close preview</Button>
      </div>
      <div className={`fb-device ${mobile ? "mobile" : ""}`}><FormView key={mobile ? "m" : "d"} form={form} tenant={tenant} preview mobile={mobile} districts={districts} /></div>
    </>
  );
}


