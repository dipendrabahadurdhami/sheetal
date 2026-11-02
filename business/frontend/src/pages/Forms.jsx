import React, { useEffect, useRef, useState } from "react";
import { useStore } from "@sheetal/shared/core/store";
import { useRouter, Link } from "@sheetal/shared/core/router";
import { fdatetime, initials, rs } from "@sheetal/shared/core/format";
import { Badge, Button, Checkbox, Drawer, Empty, Field, IconButton, Input, Modal, PageHead, Panel, Seg, Table, Tabs, Textarea, ToggleRow, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import {
  CHOICE, DESTS, DEST_LABEL, FIELD_TYPES, FONTS, PALETTE, PLACES, SWATCHES, formFromTemplate, formLimits, formLink, formsOf, makeField, monthResponses,
  placeLabels, responsesOf, sampleForms, sampleResponses, slugify, templatesFor,
} from "@sheetal/shared/core/forms";
import { defaultTenantSettings } from "./BusinessSettings";

// Online forms: list + templates, drag-and-drop builder, publish, responses, and the public form page (/business/f/:slug).
const TYPE_WORD = { hotel: "hotels", host: "hosts", developer: "developers", agency: "agencies", sponsor: "investment sponsors" };
const uniqueSlug = (list, slug, selfId) => { const b = slug || "form"; let s = b, i = 2; while (list.some((x) => x.id !== selfId && x.slug === s)) s = `${b}-${i++}`; return s; };
const RANGE = ["number", "money"];
const CHARS = ["short", "long"];
const INPUTS = { short: "text", phone: "tel", email: "email", number: "number", money: "text", date: "date", time: "time" };
const nowIso = () => new Date().toISOString().slice(0, 16);
const fontCss = (k) => (FONTS.find((x) => x[0] === k) || FONTS[0])[2];

function ensure(d, tenant) {
  d.forms = d.forms || {}; d.formResponses = d.formResponses || {};
  if (!d.forms[tenant.id]) d.forms[tenant.id] = sampleForms(tenant, d.tenantSettings?.[tenant.id]);
  if (!d.formResponses[tenant.id]) d.formResponses[tenant.id] = sampleResponses(tenant, d.forms[tenant.id]);
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

export function Forms({ tenant, view = "list", id, dest }) {
  if (view === "build") return <Builder key={id} tenant={tenant} id={id} />;
  if (view === "responses") return <Responses tenant={tenant} dest={dest || "all"} />;
  return <FormsList tenant={tenant} />;
}

function LimitNote({ lim, forms, responses }) {
  if (lim.forms === -1 && lim.responses === -1) return null;
  return <span className="small muted tnum">{lim.free ? "Free plan · " : ""}{forms.length} of {lim.forms} forms · {monthResponses(responses)} of {lim.responses} responses this month</span>;
}

function FormsList({ tenant }) {
  const { db, forms, responses, lim } = useFormsData(tenant);
  const { navigate } = useRouter();
  const create = useCreateForm(tenant);
  const [share, setShare] = useState(null);
  const tpls = templatesFor(tenant.type);
  const count = (f) => responses.filter((r) => r.formId === f.id).length;
  return (
    <>
      <PageHead title="Forms" sub={`Start from a template made for ${TYPE_WORD[tenant.type] || "your business"}, or build your own by dragging fields in.`}
        actions={<><LimitNote lim={lim} forms={forms} responses={responses} /><Button variant="outline" icon="inbox" onClick={() => navigate("/business/forms/responses")}>Responses</Button><Button icon="plus" onClick={() => create(null)}>Blank form</Button></>} />
      <div className="pf-stack">
        <section className="pf-stack tight">
          <h2 className="fb-h2">Start from a template</h2>
          <div className="fb-tpls">{tpls.map(([k, icon, name, desc, d, , mk]) => (
            <button key={k} type="button" className="card fb-tpl" onClick={() => create(k)}>
              <span className="fb-tpl-ico"><Icon name={icon} size={22} /></span><b>{name}</b><span className="small muted">{desc}</span>
              <span className="fb-tpl-foot small"><span className="muted tnum">{mk(tenant.type).filter((x) => !FIELD_TYPES[x.type].noAnswer).length} fields</span><span className="fb-accent">Goes to {DEST_LABEL[d]}</span></span>
            </button>
          ))}</div>
        </section>
        <Panel title="Your forms">
          <Table rows={forms} minWidth={760} onRowClick={(f) => navigate(`/business/forms/${f.id}`)}
            empty={<div className="pf-pad"><Empty icon="file-text" title="No forms yet">Pick a template above or start with a blank form.</Empty></div>}
            columns={[
              { key: "title", label: "Form", render: (f) => { const tp = tpls.find((x) => x[0] === f.tpl); return <span className="pf-person"><span className="fb-row-ico"><Icon name={tp?.[1] || "file-text"} size={17} /></span><span className="pf-two"><b>{f.title}</b><small className="pf-ellipsis">{formLink(db, tenant, f).url.replace("https://", "")}</small></span></span>; } },
              { key: "n", label: "Responses", num: true, render: (f) => count(f) },
              { key: "where", label: "Shows on", render: (f) => <span className="small muted">{placeLabels(f) || "Nowhere yet"}</span> },
              { key: "status", label: "Status", render: (f) => f.status === "live" ? <Badge tone="done">Live</Badge> : <Badge tone="neutral">Draft</Badge> },
              { key: "act", label: "", align: "right", render: (f) => <div className="pf-row-actions" onClick={(e) => e.stopPropagation()}><Button size="sm" variant="outline" onClick={() => navigate(`/business/forms/${f.id}`)}>Edit</Button><Button size="sm" variant="light" icon="send" onClick={() => setShare(f.id)}>Share</Button></div> },
            ]} />
        </Panel>
      </div>
      {share && <PublishModal tenant={tenant} id={share} onClose={() => setShare(null)} />}
    </>
  );
}

function PublishModal({ tenant, id, onClose }) {
  const { db, forms, setForms } = useFormsData(tenant);
  const toast = useToast();
  const form = forms.find((x) => x.id === id);
  const [copied, setCopied] = useState("");
  useEffect(() => { if (form && form.status !== "live") setForms((list) => { const f = list.find((x) => x.id === id); if (f) f.status = "live"; }); }, [id]);
  if (!form) return null;
  const link = formLink(db, tenant, form);
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=480x480&margin=12&data=${encodeURIComponent(link.url)}`;
  const embed = `<iframe src="${link.url}" width="100%" height="900" style="border:0" title="${form.title.replace(/"/g, "")}"></iframe>`;
  const copy = (text, what) => { try { navigator.clipboard.writeText(text); } catch (e) { /* clipboard off */ } setCopied(what); toast(what === "embed" ? "Embed code copied" : "Link copied"); };
  return (
    <Modal open onClose={onClose} title="Your form is live">
      <div className="pf-stack">
        <Field label="Link" hint={link.host === (db.platformSettings?.businessDomain || "business.sheetalproperty.com") ? "Connect your own domain in Settings → Domain to use it here." : `On your own domain, ${link.host}`}>
          <div className="fb-copy"><Input readOnly value={link.url} onFocus={(e) => e.target.select()} /><Button onClick={() => copy(link.url, "link")}>{copied === "link" ? "Copied" : "Copy"}</Button></div>
        </Field>
        <div className="fb-qr">
          <img src={qr} alt={`QR code for ${form.title}`} width="132" height="132" />
          <div className="pf-stack tight"><span className="small muted">Print it on a flyer or show it at the front desk.</span>
            <a className="btn btn-outline btn-sm" href={qr} target="_blank" rel="noreferrer" download={`${form.slug}-qr.png`}><Icon name="download" size={15} />Download QR</a>
            <a href={link.local} className="btn btn-ghost btn-sm" target="_blank" rel="noreferrer"><Icon name="external-link" size={15} />Open form</a></div>
        </div>
        <div className="fb-share">
          <a className="btn fb-fb" href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link.url)}`} target="_blank" rel="noreferrer"><Icon name="facebook" size={16} />Facebook</a>
          <a className="btn fb-wa" href={`https://wa.me/?text=${encodeURIComponent(`${form.title}: ${link.url}`)}`} target="_blank" rel="noreferrer"><Icon name="message-circle" size={16} />WhatsApp</a>
          <Button variant="outline" icon="code" onClick={() => copy(embed, "embed")}>{copied === "embed" ? "Copied" : "Embed"}</Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Builder ----------
function Builder({ tenant, id }) {
  const { db, forms, setForms, ts } = useFormsData(tenant);
  const { navigate } = useRouter();
  const toast = useToast();
  const form = forms.find((x) => x.id === id);
  const [f, setF] = useState(() => (form ? structuredClone(form) : null));
  const [sel, setSel] = useState(null);
  const [panel, setPanel] = useState(false);
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  const [tplOpen, setTplOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const [share, setShare] = useState(false);
  const [saved, setSaved] = useState(true);
  const latest = useRef(f); const dirty = useRef(false); const first = useRef(true);
  const save = (v) => setForms((list) => { const i = list.findIndex((x) => x.id === v.id); if (i >= 0) list[i] = { ...v, slug: uniqueSlug(list, slugify(v.slug), v.id) }; });
  useEffect(() => {
    latest.current = f;
    if (first.current) { first.current = false; return undefined; }
    dirty.current = true; setSaved(false);
    const tm = setTimeout(() => { save(latest.current); dirty.current = false; setSaved(true); }, 400);
    return () => clearTimeout(tm);
  }, [f]);
  useEffect(() => () => { if (dirty.current && latest.current) save(latest.current); }, []);
  if (!f) return <section className="card pf-empty-card"><Empty icon="file-text" title="This form was deleted" action={<Button onClick={() => navigate("/business/forms")}>All forms</Button>} /></section>;

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
  const link = formLink(db, tenant, f);
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
          <span className="small muted">{asked.length} fields · {saved ? "saved" : "saving…"} · answers go to {DEST_LABEL[f.dest]}</span>
          <div className="pf-row-actions">
            <Button variant="outline" size="sm" icon="layout-grid" onClick={() => setTplOpen((o) => !o)}>Templates</Button>
            <Button variant="outline" size="sm" icon="eye" onClick={() => setPreview(true)}>Preview</Button>
            <Button size="sm" icon="send" onClick={() => { save(latest.current); setShare(true); patch({ status: "live" }); }}>Publish and share</Button>
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
        {selF ? <FieldSettings x={selF} set={(p) => updField(selF.id, p)} /> : <FormSettings f={f} patch={patch} link={link} hasPay={f.fields.some((x) => x.type === "payment")} toast={toast} />}
      </aside>

      {preview && <div className="fb-preview" role="dialog" aria-modal="true" aria-label="Preview">
        <PreviewFrame form={f} tenant={tenant} host={link.url.replace("https://", "")} onClose={() => setPreview(false)} districts={db.catalog?.districts || []} />
      </div>}
      {share && <PublishModal tenant={tenant} id={f.id} onClose={() => setShare(false)} />}
    </div>
  );
}

function FieldPreview({ x }) {
  if (INPUTS[x.type]) return <div className="fb-pv-line">{x.ph || FIELD_TYPES[x.type].label}</div>;
  if (x.type === "long") return <div className="fb-pv-box">{x.ph}</div>;
  if (CHOICE.includes(x.type)) return <div className="fb-pv-opts">{x.opts.map((o, i) => <span key={i}><i className={x.type === "multi" ? "sq" : x.type === "single" ? "ci" : "dd"} />{o}</span>)}</div>;
  if (x.type === "rating") return <div className="fb-pv-stars">{[1, 2, 3, 4, 5].map((s) => <Icon key={s} name="star" size={22} />)}</div>;
  if (x.type === "file") return <div className="fb-pv-file"><Icon name="upload" size={18} />Upload a file · up to 10 MB</div>;
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

function FormSettings({ f, patch, link, hasPay, toast }) {
  const st = f.style || {};
  const sty = (p) => patch({ style: { ...st, ...p } });
  const pay = f.pay || {};
  return (
    <div className="pf-stack">
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

// ---------- The form people fill in (public page and preview) ----------
const blank = (v) => v == null || v === "" || (Array.isArray(v) && !v.length) || (typeof v === "object" && !Array.isArray(v) && !Object.values(v).some(Boolean));
function check(x, v) {
  const T = FIELD_TYPES[x.type];
  if (T.noAnswer) return null;
  if (x.type === "payment") return x.required && !v?.shot ? "Upload the payment screenshot" : null;
  if (blank(v)) return x.required ? (x.type === "file" ? "Upload a file" : CHOICE.includes(x.type) || x.type === "rating" ? "Pick an answer" : "This question is required") : null;
  if (x.type === "location" && x.required && !v.district) return "Pick a district";
  if (x.type === "phone" && String(v).replace(/\D/g, "").length < 10) return "Enter a 10-digit mobile number";
  if (x.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return "Enter an email like you@example.com";
  if (RANGE.includes(x.type)) { const n = Number(String(v).replace(/[^\d.]/g, "")); if (x.min && n < Number(x.min)) return `Minimum is ${x.type === "money" ? rs(x.min) : x.min}`; if (x.max && n > Number(x.max)) return `Maximum is ${x.type === "money" ? rs(x.max) : x.max}`; }
  return null;
}
const show = (x, v, districts) => {
  if (blank(v)) return "";
  if (Array.isArray(v)) return v.join(", ");
  if (x.type === "location") return [v.area, (districts.find((d) => d.id === v.district) || {}).en].filter(Boolean).join(", ");
  if (x.type === "payment") return `${rs(x.amount)} · screenshot ${v.shot}`;
  if (x.type === "rating") return `${v} of 5`;
  if (x.type === "money") return rs(String(v).replace(/\D/g, ""));
  return String(v);
};

export function FormView({ form, tenant, preview, mobile, districts = [], onSubmit }) {
  const st = form.style || {};
  const pages = form.fields.reduce((acc, x) => { if (x.type === "page") acc.push([]); else acc[acc.length - 1].push(x); return acc; }, [[]]).filter((p, i, a) => p.length || a.length === 1);
  const [step, setStep] = useState(0);
  const [vals, setVals] = useState({});
  const [errs, setErrs] = useState({});
  const [sent, setSent] = useState(false);
  const top = useRef(null);
  const cur = pages[Math.min(step, pages.length - 1)] || [];
  const last = step >= pages.length - 1;
  const setV = (fid, v) => { setVals((o) => ({ ...o, [fid]: v })); if (errs[fid]) setErrs((o) => ({ ...o, [fid]: null })); };
  const go = (s) => { setStep(s); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const next = (e) => {
    e.preventDefault();
    const er = {}; cur.forEach((x) => { const m = check(x, vals[x.id]); if (m) er[x.id] = m; });
    setErrs(er);
    if (Object.keys(er).length) { const el = document.getElementById(`q-${Object.keys(er)[0]}-wrap`); if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 24, behavior: "smooth" }); return; }
    if (!last) { go(step + 1); return; }
    if (!preview && onSubmit) onSubmit(form.fields.filter((x) => !FIELD_TYPES[x.type].noAnswer).map((x) => ({ x, v: vals[x.id], text: show(x, vals[x.id], districts) })));
    setSent(true); window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const anyReq = form.fields.some((x) => x.required);
  const vars = { "--fa": st.accent || SWATCHES[0], "--fr": st.corners === "square" ? "4px" : "16px", fontFamily: fontCss(st.font) };
  return (
    <div className={`pform ${mobile ? "is-mobile" : ""}`} style={vars} ref={top}>
      <div className="pform-card pform-top">
        <div className="pform-head">
          <div className="pform-head-row">
            <span className="pform-logo">{st.logoUrl ? <img src={st.logoUrl} alt="" /> : st.logo || initials(tenant?.name || "")}</span>
            <div className="pform-head-text">
              {tenant?.name && <span className="pform-biz">{tenant.name}</span>}
              <h1>{form.title}</h1>{form.desc && <p>{form.desc}</p>}
              {!sent && (pages.length > 1 || anyReq) && <div className="pform-meta">{pages.length > 1 && <span>Step {step + 1} of {pages.length}</span>}{anyReq && <span className="pform-req">* Required</span>}</div>}
            </div>
          </div>
          {!sent && pages.length > 1 && <div className="pform-progress" aria-hidden="true"><i style={{ width: `${((step + 1) / pages.length) * 100}%` }} /></div>}
        </div>
      </div>
      {sent ? (
        <div className="pform-card pform-done">
          <span className="pform-done-ico"><Icon name="circle-check" size={40} /></span>
          <h2>Thank you</h2><p>{form.thanks}</p>
          <button type="button" className="pform-link" onClick={() => { setSent(false); setVals({}); setErrs({}); setStep(0); }}>Submit another response</button>
        </div>
      ) : (
        <form className="pform-card pform-body" onSubmit={next} noValidate>
          <div className="pform-grid">{cur.map((x) => <Question key={x.id} x={x} v={vals[x.id]} set={(v) => setV(x.id, v)} err={errs[x.id]} form={form} districts={districts} />)}</div>
          <div className="pform-actions">
            {step > 0 && <button type="button" className="pform-btn ghost" onClick={() => go(step - 1)}><Icon name="arrow-left" size={16} />Back</button>}
            <button type="submit" className="pform-btn">{last ? st.button || "Submit" : "Next"}{!last && <Icon name="arrow-right" size={16} />}</button>
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
  else if (x.type === "file") input = <label className="pform-file"><Icon name="upload" size={22} />{v ? <b>{v}</b> : "Click to upload"}<small>PDF, Word or image · up to 10 MB</small><input type="file" onChange={(e) => set(e.target.files[0]?.name || "")} /></label>;
  else if (x.type === "location") { const o = v || {}; input = <div className="pform-two"><select className="pform-in" value={o.district || ""} aria-label="District" onChange={(e) => set({ ...o, district: e.target.value })}><option value="">District</option>{districts.map((d) => <option key={d.id} value={d.id}>{d.en}</option>)}</select><input className="pform-in" placeholder="Area or tole" aria-label="Area" value={o.area || ""} onChange={(e) => set({ ...o, area: e.target.value })} /></div>; }
  else if (x.type === "payment") { const p = form.pay || {}; input = (
    <div className="pform-pay">
      {p.qrUrl ? <img src={p.qrUrl} alt="Payment QR" /> : <span className="pform-qr">Fonepay QR</span>}
      <div className="pform-pay-text"><span>Scan and pay <b>{rs(x.amount)}</b>, then upload the screenshot.</span>
        {p.esewa && <span>eSewa: <b>{p.esewa}</b></span>}{p.bank && <span className="pform-bank">{p.bank}</span>}
        <label className="pform-file sm"><Icon name="upload" size={18} />{v?.shot ? <b>{v.shot}</b> : "Payment screenshot"}<input type="file" accept="image/*" onChange={(e) => set({ shot: e.target.files[0]?.name || "" })} /></label></div>
    </div>); }
  return <div className={cls} id={id + "-wrap"}>{label}{desc}{input}{err && <span className="pform-err" role="alert"><Icon name="circle-alert" size={14} />{err}</span>}</div>;
}

// /business/f/:slug?b=tenantId — no Shell, no Sheetal branding.
export function PublicForm({ slug }) {
  const { db, update } = useStore();
  const b = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("b") : null;
  const tenants = b ? db.tenants.filter((t) => t.id === b) : db.tenants;
  let tenant = null, form = null;
  for (const t of tenants) { const f = formsOf(db, t).find((x) => x.slug === slug); if (f) { tenant = t; form = f; break; } }
  useEffect(() => { if (form) document.title = form.title; }, [form?.title]);
  const closed = (title, text) => <div className="pform-page"><div className="pform"><div className="pform-card pform-done"><span className="pform-done-ico muted"><Icon name="info" size={36} /></span><h2>{title}</h2><p>{text}</p></div></div></div>;
  if (!form) return closed("Form not found", "This link may be wrong or the form was removed.");
  if (form.status !== "live") return closed("This form isn't open yet", "The business hasn't published it. Please check back later.");
  const lim = formLimits(db, tenant);
  if (lim.responses !== -1 && monthResponses(responsesOf(db, tenant)) >= lim.responses) return closed("This form is closed for now", `${tenant.name} isn't taking new answers this month. Please contact them directly.`);
  const districts = db.catalog?.districts || [];
  const submit = (ans) => {
    const nameA = ans.find((a) => a.x.type === "short" && /name/i.test(a.x.label) && a.text);
    const phoneA = ans.find((a) => a.x.type === "phone" && a.text);
    const payA = ans.find((a) => a.x.type === "payment" && a.v?.shot);
    const rest = ans.filter((a) => a.text && a !== nameA && a !== phoneA && a !== payA);
    const at = nowIso();
    const r = { id: `fr-${Math.random().toString(36).slice(2, 9)}`, formId: form.id, formTitle: form.title, dest: form.dest, at, name: nameA?.text || "Form visitor", phone: phoneA?.text || "",
      answers: ans.filter((a) => a.text).map((a) => [a.x.label, a.text]), summary: rest.slice(0, 3).map((a) => a.text).join(" · ") || form.title,
      pay: payA ? { amount: payA.x.amount, shot: payA.v.shot, status: "to_confirm" } : null };
    update((d) => {
      ensure(d, tenant);
      d.formResponses[tenant.id].unshift(r);
      if (form.dest === "leads") {
        if (!d.ops[tenant.id]) d.ops[tenant.id] = structuredClone(d.ops.t1);
        d.ops[tenant.id].conversations.unshift({ id: `c-${r.id}`, channel: "web", name: r.name, phone: r.phone, unread: 1, last: `${form.title}: ${r.summary}`, at, stage: "new", value: r.pay?.amount || 0, listing: null, assignee: null,
          tags: ["Lead", form.title], formResponse: r.id, msgs: [["in", `${form.title}: ${r.answers.map(([q, a]) => `${q}: ${a}`).join(" · ")}`, at.slice(11, 16)]] });
      }
    });
  };
  return <div className="pform-page" style={{ "--fa": form.style?.accent || SWATCHES[0] }}><FormView form={form} tenant={tenant} districts={districts} onSubmit={submit} /></div>;
}

// ---------- Responses ----------
const PAY_TONE = { to_confirm: ["action", "To confirm"], confirmed: ["done", "Confirmed"], rejected: ["problem", "Rejected"] };
function Responses({ tenant, dest }) {
  const { forms, responses, setResponses, lim } = useFormsData(tenant);
  const { navigate } = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(null);
  const tab = ["leads", "jobs", "requirements"].includes(dest) ? dest : "all";
  const rows = responses.filter((r) => tab === "all" || r.dest === tab);
  const setPay = (rid, status) => { setResponses((list) => { const r = list.find((x) => x.id === rid); if (r?.pay) r.pay.status = status; }); toast(status === "confirmed" ? "Payment confirmed" : "Payment rejected"); };
  const cur = responses.find((r) => r.id === open);
  const tone = { leads: "progress", jobs: "neutral", requirements: "action" };
  return (
    <>
      <PageHead title="Responses" sub="Each form sends answers to one place. Leads also show in Inbox, applications under Job applicants, requirements under Requirements."
        back={<Link to="/business/forms" className="fb-back"><Icon name="arrow-left" size={16} />Forms</Link>}
        actions={<><LimitNote lim={lim} forms={forms} responses={responses} />{(tab === "jobs" || tab === "requirements") && <CreateFormButton tenant={tenant} tpl={tab === "jobs" ? "job" : "req"} />}</>} />
      <Tabs value={tab} onChange={(v) => navigate(v === "all" ? "/business/forms/responses" : `/business/forms/responses/${v}`)}
        tabs={[{ id: "all", label: "All" }, ...DESTS.map(([id]) => ({ id, label: DEST_LABEL[id] }))].map((x) => ({ ...x, count: responses.filter((r) => x.id === "all" || r.dest === x.id).length }))} />
      <Panel>
        <Table rows={rows} minWidth={820} onRowClick={(r) => setOpen(r.id)}
          empty={<div className="pf-pad"><Empty icon="inbox" title="No responses yet" action={tab === "jobs" || tab === "requirements" ? <CreateFormButton tenant={tenant} tpl={tab === "jobs" ? "job" : "req"} variant="primary" /> : null}>Share a form to start getting answers here.</Empty></div>}
          columns={[
            { key: "who", label: "From", render: (r) => <span className="pf-two"><b>{r.name}</b><small className="tnum">{[r.phone, fdatetime(r.at)].filter(Boolean).join(" · ")}</small></span> },
            { key: "sum", label: "Answers", render: (r) => <span className="pf-two"><span className="small">{r.summary}</span><small className="muted">{r.formTitle}</small></span> },
            { key: "dest", label: "Goes to", render: (r) => <Badge tone={tone[r.dest]} icon={r.dest === "jobs" ? "briefcase" : r.dest === "requirements" ? "house" : "messages-square"}>{r.dest === "leads" ? "Lead" : r.dest === "jobs" ? "Job application" : "Requirement"}</Badge> },
            { key: "pay", label: "Payment", render: (r) => r.pay ? <span className="pf-two"><Badge tone={PAY_TONE[r.pay.status][0]}>{PAY_TONE[r.pay.status][1]}</Badge><small className="tnum">{rs(r.pay.amount)}</small></span> : <span className="small muted">No payment</span> },
            { key: "act", label: "", align: "right", render: (r) => <div className="pf-row-actions" onClick={(e) => e.stopPropagation()}>
              {r.pay?.status === "to_confirm" ? <><Button size="sm" icon="check" onClick={() => setPay(r.id, "confirmed")}>Confirm</Button><Button size="sm" variant="outline" onClick={() => setPay(r.id, "rejected")}>Reject</Button></>
                : <Button size="sm" variant="outline" onClick={() => setOpen(r.id)}>Open</Button>}</div> },
          ]} />
      </Panel>
      <Drawer open={!!cur} onClose={() => setOpen(null)} title={cur?.name || ""} sub={cur ? `${cur.formTitle} · ${fdatetime(cur.at)}` : ""}
        footer={cur && <>{cur.dest === "leads" && <Button variant="outline" icon="messages-square" onClick={() => navigate("/business/inbox")}>Open in Inbox</Button>}
          {cur.phone && <a className="btn btn-outline" href={`tel:${cur.phone}`}><Icon name="phone" size={16} />Call</a>}
          {cur.pay?.status === "to_confirm" && <><Button variant="outline" onClick={() => setPay(cur.id, "rejected")}>Reject</Button><Button icon="check" onClick={() => setPay(cur.id, "confirmed")}>Confirm payment</Button></>}</>}>
        {cur && <div className="pf-stack">
          <dl className="pf-kv fb-answers">{cur.answers.map(([q, a], i) => <React.Fragment key={i}><dt>{q}</dt><dd>{a}</dd></React.Fragment>)}</dl>
          {cur.pay && <div className="pf-note"><Icon name="qr-code" size={16} /><span>{rs(cur.pay.amount)} paid by QR or bank. Screenshot: <b>{cur.pay.shot}</b>. Status: {PAY_TONE[cur.pay.status][1]}.</span></div>}
        </div>}
      </Drawer>
    </>
  );
}
