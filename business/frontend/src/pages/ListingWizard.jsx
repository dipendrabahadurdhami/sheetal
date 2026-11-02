import React, { useRef, useState } from "react";
import { DataActions } from "@sheetal/shared/components/DataIO";
import { useLang, useT } from "@sheetal/shared/core/i18n";
import { useStore } from "@sheetal/shared/core/store";
import { Link, useRouter } from "@sheetal/shared/core/router";
import { rs, rsShort } from "@sheetal/shared/core/format";
import { Badge, Button, Drawer, Empty, PageHead, Toggle, useToast } from "@sheetal/shared/core/ui";
import { AIStudio } from "./AI";
import { Icon } from "@sheetal/shared/core/icons";
import { AREA, areaToSqft, sqftToHill } from "@sheetal/shared/data/catalog";
import { FORMS, HIGHLIGHTS, suggestTitle } from "./listingForms";
import { PinPicker } from "./PinPicker";
import { kindsFor, planOf } from "@sheetal/shared/core/plans";

// One wizard renders every listing kind from listingForms.js.
// Almost everything is a tap: chips with icons, counters, segments, quick prices.
export function ListingWizard({ tenant }) {
  const t = useT();
  const lang = useLang();
  const { db, update } = useStore();
  const { navigate } = useRouter();
  const toast = useToast();
  const C = db.catalog;
  const L = (pair) => (Array.isArray(pair) ? (lang === "ne" ? pair[1] : pair[0]) : pair);
  const it = (o) => (lang === "ne" ? o.ne : o.en);
  const kinds = kindsFor(C, tenant, planOf(db, tenant));
  const draft = db.drafts[tenant.id];
  const [kind, setKind] = useState((draft && FORMS[draft.kind] && draft.kind) || (kinds.length === 1 ? kinds[0] : null));
  const [step, setStep] = useState(draft?.step || 0);
  const [v, setV] = useState(draft?.values || {});
  const [err, setErr] = useState({});
  const [preview, setPreview] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [fillTick, setFillTick] = useState(0);
  React.useEffect(() => { if (!fillTick) return; const d2 = db.drafts[tenant.id]; if (d2 && FORMS[d2.kind]) { setKind(d2.kind); setStep(0); setV(d2.values || {}); } }, [fillTick, db.drafts, tenant.id]);
  const aiDrawer = <Drawer open={aiOpen} onClose={() => setAiOpen(false)} title={t("ai.listingTitle")} sub={t("ai.listingSub")}><AIStudio tenant={tenant} only="listing" onFill={() => { setAiOpen(false); setFillTick((n) => n + 1); }} /></Drawer>;

  const steps = (kind && FORMS[kind]) || [];
  const visible = (f) => !f.when || f.when(v);
  const val = (f) => (v[f.name] !== undefined ? v[f.name] : f.def);
  const set = (name, x) => { setV((o) => ({ ...o, [name]: x })); setErr((e) => ({ ...e, [name]: null })); };
  const optsOf = (f) => (typeof f.src === "function" ? f.src(v, C) : typeof f.src === "string" ? C[f.src] || [] : []);
  const label = (id, key, sub) => { if (!id) return ""; const list = sub ? C[key]?.[sub] : C[key]; const o = list?.find?.((x) => x.id === id); return o ? it(o) : ""; };

  const filled = (f) => {
    const x = val(f);
    if (f.type === "multi" || f.type === "photos" || f.type === "repeat") return Array.isArray(x) && x.length >= (f.min || 1);
    if (f.type === "location") return !!x?.district;
    if (f.type === "land") return areaToSqft(x?.sys || "hill", x || {}) > 0;
    return x !== undefined && x !== "" && x !== null;
  };
  const allFields = steps.flatMap((s) => s.fields).filter(visible);
  const done = allFields.filter(filled).length;
  const pct = allFields.length ? Math.round((done / allFields.length) * 100) : 0;

  const validate = (i) => {
    const e = {};
    steps[i].fields.filter(visible).forEach((f) => { if (f.req && !filled(f)) e[f.name] = f.type === "photos" ? t("wiz.errPhotos", { n: f.min }) : t("wiz.errRequired"); });
    setErr(e);
    return !Object.keys(e).length;
  };
  const go = (i) => { if (i > step && !validate(step)) return; setStep(i); window.scrollTo(0, 0); };
  const saveDraft = () => { update((d) => { d.drafts[tenant.id] = { kind, step, values: v }; }); toast(t("wiz.toastDraft")); };
  const publish = () => {
    for (let i = 0; i < steps.length; i++) if (!validate(i)) { setStep(i); return; }
    const title = v.title || suggestTitle(kind, v, label);
    update((d) => {
      const _ed = d.drafts?.[tenant.id]?.editId; const _rec = { id: _ed || `L-${1100 + d.listings.length}`, tenantId: tenant.id, kind, title, values: v, status: "in_review", price: v.price || v.rent || v.nightly || v.target || v.rooms?.[0]?.price || v.units?.[0]?.price || 0, views: 0, leads: 0, updated: "2027-03-02" }; if (_ed) { const _k = d.listings.findIndex((x) => x.id === _ed); if (_k >= 0) d.listings[_k] = { ...d.listings[_k], ..._rec, views: d.listings[_k].views, leads: d.listings[_k].leads }; else d.listings.unshift(_rec); } else d.listings.unshift(_rec);
      delete d.drafts[tenant.id];
    });
    toast(t("wiz.toastSubmitted"));
    navigate("/business/listings");
  };

  if (!kind) {
    return (
      <>
        <PageHead title={t("wiz.title")} sub={t("wiz.pickSub")} back={<Link to="/business/listings" className="pf-back"><Icon name="arrow-left" size={15} />{t("nav.listings")}</Link>} />
        <button className="card pf-ai-card" onClick={() => setAiOpen(true)}><span className="pf-kind-ico"><Icon name="wand-sparkles" size={24} /></span><span className="pf-two"><b>{t("ai.fromText")}</b><small>{t("ai.fromTextSub")}</small></span><Icon name="arrow-right" size={18} /></button>
        {aiDrawer}
        <div className="pf-kind-grid">
          {kinds.map((k) => { const o = C.listingKinds.find((x) => x.id === k); return (
            <button key={k} className="card pf-kind" onClick={() => { setKind(k); setStep(0); setV({}); }}>
              <span className="pf-kind-ico"><Icon name={o.icon} size={26} /></span><b>{it(o)}</b><span className="small muted">{t(`wiz.kind_${k}`)}</span>
            </button>
          ); })}
        </div>
      </>
    );
  }

  const cur = steps[step];
  const title = v.title || suggestTitle(kind, v, label);
  const priceNow = v.price || v.rent || v.nightly || v.target || v.rooms?.[0]?.price || v.units?.[0]?.price;
  const cover = v.photos?.[0]?.url;

  return (
    <>
      <PageHead title={t("wiz.title")} sub={it(C.listingKinds.find((x) => x.id === kind))}
        back={<Link to="/business/listings" className="pf-back"><Icon name="arrow-left" size={15} />{t("nav.listings")}</Link>}
        actions={<><Button variant="outline" icon="wand-sparkles" onClick={() => setAiOpen(true)}>{t("ai.fromText")}</Button><Button variant="ghost" icon="eye" onClick={() => setPreview(!preview)}>{t("wiz.preview")}</Button><Button variant="outline" icon="save" onClick={saveDraft}>{t("wiz.saveDraft")}</Button></>} />
      {aiDrawer}
      <div className="pf-wiz">
        <ol className="pf-wiz-steps" aria-label={t("wiz.steps")}>
          {steps.map((s, i) => {
            const st = i < step ? "done" : i === step ? "cur" : "";
            return <li key={s.id}><button className={st} onClick={() => go(i)} aria-current={i === step ? "step" : undefined}>
              <span className="pf-wiz-dot">{i < step ? <Icon name="check" size={14} /> : <Icon name={s.icon} size={15} />}</span><span>{L(s.label)}</span></button></li>;
          })}
        </ol>

        <section className="card pf-wiz-body">
          <div className="pf-wiz-head"><span className="tiny muted tnum">{t("wiz.stepOf", { a: step + 1, b: steps.length })}</span><h2>{L(cur.label)}</h2></div>
          <div className="pf-wiz-fields">
            {cur.fields.filter(visible).map((f) => (
              <FieldBlock key={f.name} f={f} L={L} err={err[f.name]} optional={f.optional}>
                <Control f={f} value={val(f)} set={(x) => set(f.name, x)} opts={optsOf(f)} it={it} L={L} t={t} C={C} kind={kind} v={v} titleSuggest={title} />
              </FieldBlock>
            ))}
          </div>
          <div className="pf-wiz-foot">
            <Button variant="outline" icon="arrow-left" disabled={step === 0} onClick={() => go(step - 1)}>{t("common.back")}</Button>
            {step < steps.length - 1
              ? <Button onClick={() => go(step + 1)}>{t("common.continue")}<Icon name="arrow-right" size={16} /></Button>
              : <Button icon="send" onClick={publish}>{t("wiz.submit")}</Button>}
          </div>
        </section>

        <aside className="pf-wiz-side">
          <div className="card pf-wiz-preview">
            <div className="pf-wiz-cover">{cover ? <img src={cover} alt="" /> : <span><Icon name="image" size={28} />{t("wiz.noPhoto")}</span>}
              <span className="tag tag-white">{it(C.listingKinds.find((x) => x.id === kind))}</span></div>
            <div className="pf-wiz-pbody">
              <b>{title || t("wiz.titlePending")}</b>
              <span className="small muted"><Icon name="map-pin" size={13} />{[v.location?.area, label(v.location?.district, "districts")].filter(Boolean).join(", ") || t("wiz.locPending")}</span>
              <span className="pf-wiz-price tnum">{priceNow ? rsShort(priceNow) : "—"}</span>
            </div>
          </div>
          <div className="card pf-pad pf-stack">
            <div className="pf-meter-top"><span>{t("wiz.complete")}</span><b className="tnum">{pct}%</b></div>
            <div className="bar"><i style={{ width: `${pct}%` }} /></div>
            <p className="small muted">{pct < 100 ? t("wiz.tip") : t("wiz.tipDone")}</p>
          </div>
        </aside>
      </div>
    </>
  );
}

function FieldBlock({ f, L, err, optional, children }) {
  const t = useT();
  return (
    <div className={`pf-fb ${err ? "has-err" : ""}`}>
      <div className="pf-fb-label"><b>{L(f.label)}</b>{optional && <span className="muted small">{t("common.optional")}</span>}{f.req && <span className="pf-req" aria-label={t("wiz.required")}>*</span>}</div>
      {children}
      {f.note && <span className="pf-hint"><Icon name="info" size={13} />{L(f.note)}</span>}
      {err && <span className="pf-error"><Icon name="circle-alert" size={14} />{err}</span>}
    </div>
  );
}

const segOpts = (f, C) => (typeof f.options === "string" ? C[f.options].map((o) => [o.id, o.en, o.ne]) : f.options);

function Control({ f, value, set, opts, it, L, t, C, kind, v, titleSuggest }) {
  const lang = useLang();
  switch (f.type) {
    case "choice":
      return (
        <div className={`pf-tiles ${f.big ? "big" : ""}`} role="radiogroup">
          {opts.map((o) => (
            <button key={o.id} type="button" role="radio" aria-checked={value === o.id} className={value === o.id ? "on" : ""} onClick={() => set(value === o.id && f.optional ? undefined : o.id)}>
              <Icon name={o.icon} size={f.big ? 24 : 18} /><span>{it(o)}</span>
            </button>
          ))}
        </div>
      );
    case "multi": {
      const arr = value || [];
      return (
        <div className="pf-chips">
          {opts.map((o) => { const on = arr.includes(o.id); return (
            <button key={o.id} type="button" aria-pressed={on} className={`chip ${on ? "active" : ""}`} onClick={() => set(on ? arr.filter((x) => x !== o.id) : [...arr, o.id])}>
              <Icon name={on ? "check" : o.icon} size={15} />{it(o)}
            </button>
          ); })}
        </div>
      );
    }
    case "seg":
      return (
        <div className="seg pf-seg-wrap" role="radiogroup">
          {segOpts(f, C).map(([id, en, ne]) => <button key={id} type="button" role="radio" aria-checked={value === id} className={value === id ? "on" : ""} onClick={() => set(id)}>{lang === "ne" ? ne : en}</button>)}
        </div>
      );
    case "counter":
      return <Counter value={value ?? f.min} min={f.min} max={f.max} onChange={set} label={L(f.label)} />;
    case "text":
      return <input className="input" value={value || ""} onChange={(e) => set(e.target.value)} placeholder={f.placeholder} />;
    case "number":
      return <div className="pf-unit"><input className="input tnum" inputMode="numeric" value={value || ""} onChange={(e) => set(Number(e.target.value.replace(/\D/g, "")) || "")} /><span>{f.unit}</span></div>;
    case "price":
      return <PriceInput value={value} onChange={set} quick={f.quick} per={f.per && L(f.per)} />;
    case "toggle":
      return <div className="pf-toggle-row"><div><span>{L(f.sub)}</span></div><Toggle checked={value ?? false} onChange={set} label={L(f.label)} /></div>;
    case "location":
      return <LocationPick value={value || {}} onChange={set} C={C} it={it} t={t} />;
    case "map":
      return <PinPicker value={value} onChange={set} kind={kind} t={t} />;
    case "land":
      return <LandArea value={value || { sys: "hill" }} onChange={set} t={t} />;
    case "photos":
      return <Photos value={value || []} onChange={set} min={f.min} t={t} />;
    case "docs":
      return <Docs items={f.items} value={value || {}} onChange={set} t={t} lang={lang} />;
    case "repeat":
      return <Repeat f={f} value={value || []} onChange={set} C={C} it={it} L={L} t={t} />;
    case "story":
      return <Story value={value} set={set} suggest={titleSuggest} kind={kind} t={t} />;
    default:
      return null;
  }
}

export function Counter({ value, min = 0, max = 99, onChange, label }) {
  return (
    <div className="pf-counter" role="group" aria-label={label}>
      <button type="button" aria-label={`${label} −`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}><Icon name="minus" size={16} /></button>
      <b className="tnum" aria-live="polite">{value}</b>
      <button type="button" aria-label={`${label} +`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}><Icon name="plus" size={16} /></button>
    </div>
  );
}

function PriceInput({ value, onChange, quick = [], per }) {
  return (
    <div className="pf-stack tight">
      <div className="pf-unit pf-price-in"><span>Rs.</span><input className="input tnum" inputMode="numeric" value={value ? Number(value).toLocaleString("en-IN") : ""}
        onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, "")) || "")} placeholder="0" />{per && <span>{per}</span>}</div>
      <div className="pf-quick">
        {value ? <b className="tnum">{rsShort(value)}</b> : null}
        {quick.map((q) => <button key={q} type="button" className={`chip ${value === q ? "active" : ""}`} onClick={() => onChange(q)}>{q >= 1e5 ? rsShort(q) : rs(q)}</button>)}
      </div>
    </div>
  );
}

function LocationPick({ value, onChange, C, it, t }) {
  // Pick a district from the list, or type one that is not listed yet.
  const [q, setQ] = React.useState("");
  const known = C.districts.find((d) => d.id === value.district);
  const areas = known ? C.areas[value.district] || [] : [];
  const ql = q.trim().toLowerCase();
  const list = ql ? C.districts.filter((d) => ((d.en || "") + " " + (d.ne || "")).toLowerCase().includes(ql)) : C.districts;
  const exact = C.districts.some((d) => (d.en || "").toLowerCase() === ql);
  return (
    <div className="pf-stack tight">
      <label className="loc-find"><Icon name="search" size={16} /><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find or type a district, e.g. Kaski" aria-label="Find or type a district" /></label>
      <div className="pf-chips">
        {list.map((d) => <button key={d.id} type="button" className={`chip ${value.district === d.id ? "active" : ""}`} aria-pressed={value.district === d.id} onClick={() => { onChange({ district: d.id }); setQ(""); }}>{it(d)}</button>)}
        {ql && !exact && <button type="button" className={`chip ${value.custom && value.district === q.trim() ? "active" : ""}`} onClick={() => onChange({ district: q.trim(), custom: true })}><Icon name="plus" size={14} />Use “{q.trim()}”</button>}
        {!list.length && !ql && <span className="small muted">No districts in the list yet.</span>}
      </div>
      {value.custom && value.district && <span className="pf-hint"><Icon name="info" size={13} />“{value.district}” will be checked by the Sheetal team and added to the list.</span>}
      {value.district && (
        <div className="pf-chips sub">
          {areas.map((a) => <button key={a} type="button" className={`chip ${value.area === a ? "active" : ""}`} aria-pressed={value.area === a} onClick={() => onChange({ ...value, area: a })}><Icon name="map-pin" size={14} />{a}</button>)}
          <input className="input pf-chip-input" placeholder={t("wiz.otherArea")} value={areas.includes(value.area) ? "" : value.area || ""} onChange={(e) => onChange({ ...value, area: e.target.value })} />
        </div>
      )}
    </div>
  );
}
// Units shown for each land measuring system.
const SYS = { hill: ["ropani", "aana", "paisa", "daam"], terai: ["bigha", "kattha", "dhur"], sqft: ["sqft"] };
function LandArea({ value, onChange, t }) {
  const sys = value.sys || "hill";
  const sq = areaToSqft(sys, value);
  const hill = sqftToHill(sq);
  return (
    <div className="pf-stack tight">
      <div className="seg" role="radiogroup">
        {["hill", "terai", "sqft"].map((s) => <button key={s} type="button" className={sys === s ? "on" : ""} onClick={() => onChange({ sys: s })}>{t(`land.${s}`)}</button>)}
      </div>
      <div className="pf-land">
        {SYS[sys].map((u) => (
          <div key={u} className="pf-land-unit">
            <span>{t(`land.${u}`)}</span>
            {u === "sqft"
              ? <input className="input tnum" inputMode="numeric" value={value.sqft || ""} onChange={(e) => onChange({ ...value, sqft: Number(e.target.value.replace(/\D/g, "")) })} />
              : <Counter value={value[u] || 0} min={0} max={u === "ropani" || u === "bigha" ? 500 : u === "aana" ? 15 : u === "kattha" || u === "dhur" ? 19 : 3} onChange={(n) => onChange({ ...value, [u]: n })} label={t(`land.${u}`)} />}
          </div>
        ))}
      </div>
      {sq > 0 && <span className="pf-hint tnum"><Icon name="ruler" size={13} />{t("land.equals", { sqft: Math.round(sq).toLocaleString("en-IN"), sqm: Math.round(sq / AREA.sqm).toLocaleString("en-IN"), r: hill.ropani, a: hill.aana, p: hill.paisa, d: hill.daam })}</span>}
    </div>
  );
}

function Photos({ value, onChange, min, t }) {
  const ref = useRef(null);
  const add = (files) => onChange([...value, ...[...files].filter((f) => f.type.startsWith("image/")).map((f) => ({ id: Math.random().toString(36).slice(2), url: URL.createObjectURL(f), name: f.name }))]);
  const move = (i, d) => { const a = [...value]; [a[i], a[i + d]] = [a[i + d], a[i]]; onChange(a); };
  return (
    <div className="pf-stack tight">
      <label className="drop pf-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); add(e.dataTransfer.files); }}>
        <input ref={ref} type="file" accept="image/*" multiple hidden onChange={(e) => add(e.target.files)} />
        <Icon name="upload" size={24} /><b>{t("wiz.dropPhotos")}</b><span className="small muted">{t("wiz.photoHint", { n: min })}</span>
      </label>
      {value.length > 0 && (
        <div className="pf-thumbs">
          {value.map((p, i) => (
            <figure key={p.id}>
              <img src={p.url} alt={p.name} />
              {i === 0 && <span className="tag tag-white">{t("wiz.cover")}</span>}
              <div>
                <button type="button" aria-label={t("catalog.up")} disabled={i === 0} onClick={() => move(i, -1)}><Icon name="arrow-left" size={14} /></button>
                <button type="button" aria-label={t("common.delete")} onClick={() => onChange(value.filter((x) => x.id !== p.id))}><Icon name="trash-2" size={14} /></button>
                <button type="button" aria-label="→" disabled={i === value.length - 1} onClick={() => move(i, 1)}><Icon name="arrow-right" size={14} /></button>
              </div>
            </figure>
          ))}
        </div>
      )}
      <span className="pf-hint tnum">{t("wiz.photoCount", { n: value.length, min })}</span>
    </div>
  );
}

function Docs({ items, value, onChange, t, lang }) {
  return (
    <div className="pf-docs">
      {items.map(([id, en, ne]) => (
        <div key={id} className={value[id] ? "on" : ""}>
          <Icon name={value[id] ? "file-check" : "file-text"} size={18} />
          <span>{lang === "ne" ? ne : en}</span>
          {value[id] ? <Badge tone="done">{t("wiz.uploaded")}</Badge> : (
            <label className="btn btn-outline btn-sm"><input type="file" hidden onChange={(e) => e.target.files[0] && onChange({ ...value, [id]: e.target.files[0].name })} /><Icon name="upload" size={14} />{t("wiz.upload")}</label>
          )}
        </div>
      ))}
      <span className="pf-hint"><Icon name="lock" size={13} />{t("wiz.docsPrivate")}</span>
    </div>
  );
}

function Repeat({ f, value, onChange, C, it, L, t }) {
  const list = value.length ? value : f.def || [];
  const setRow = (i, k, x) => onChange(list.map((r, j) => (j === i ? { ...r, [k]: x } : r)));
  return (
    <div className="pf-stack tight">
      {list.map((row, i) => (
        <div key={i} className="pf-repeat">
          <div className="pf-repeat-head"><b>{it((C[f.fields[0].src] || []).find((o) => o.id === row.type) || { en: `#${i + 1}`, ne: `#${i + 1}` })}</b>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(list.filter((_, j) => j !== i))}><Icon name="trash-2" size={14} />{t("common.delete")}</button></div>
          {f.fields.map((sf) => (
            <div key={sf.name} className="pf-repeat-field">
              <span className="small">{L(sf.label)}</span>
              {sf.type === "choice" ? (
                <div className="pf-chips">{(C[sf.src] || []).map((o) => <button key={o.id} type="button" className={`chip ${row[sf.name] === o.id ? "active" : ""}`} onClick={() => setRow(i, sf.name, o.id)}><Icon name={o.icon} size={14} />{it(o)}</button>)}</div>
              ) : sf.type === "counter" ? <Counter value={row[sf.name] ?? sf.def ?? sf.min} min={sf.min} max={sf.max} onChange={(x) => setRow(i, sf.name, x)} label={L(sf.label)} />
                : sf.type === "price" ? <PriceInput value={row[sf.name]} onChange={(x) => setRow(i, sf.name, x)} quick={sf.quick} per={sf.per && L(sf.per)} />
                : <div className="pf-unit"><input className="input tnum" inputMode="numeric" value={row[sf.name] || ""} onChange={(e) => setRow(i, sf.name, Number(e.target.value.replace(/\D/g, "")) || "")} /><span>{sf.unit}</span></div>}
            </div>
          ))}
        </div>
      ))}
      <Button variant="outline" icon="plus" onClick={() => onChange([...list, { type: (C[f.fields[0].src] || [])[0]?.id }])}>{L(f.add)}</Button>
    </div>
  );
}

function Story({ value, set, suggest, kind, t }) {
  const [hl, setHl] = useState([]);
  return (
    <div className="pf-stack tight">
      <input className="input" value={value ?? suggest} onChange={(e) => set(e.target.value)} />
      <span className="pf-hint"><Icon name="sparkles" size={13} />{t("wiz.titleHint")}</span>
      <span className="small" style={{ marginTop: 8 }}>{t("wiz.highlights")}</span>
      <div className="pf-chips">
        {(HIGHLIGHTS[kind] || []).map((h) => { const on = hl.includes(h); return <button key={h} type="button" className={`chip ${on ? "active" : ""}`} onClick={() => setHl(on ? hl.filter((x) => x !== h) : [...hl, h])}>{on && <Icon name="check" size={14} />}{h}</button>; })}
      </div>
    </div>
  );
}

export function ListingsPage({ tenant, canEdit }) {
  const showRenew = tenant.type === "agency";
  const t = useT();
  const lang = useLang();
  const { db } = useStore();
  const { navigate } = useRouter();
  const rows = db.listings.filter((l) => l.tenantId === tenant.id);
  const draft = db.drafts[tenant.id];
  const kindName = (k) => { const o = db.catalog.listingKinds.find((x) => x.id === k); return o ? (lang === "ne" ? o.ne : o.en) : k; };
  const stays = (tenant.type === "hotel" || tenant.type === "host") && rows.some(isStayListing);
  const [ota, setOta] = useState(null);
  const waiting = otaOf(db).requests.filter((r) => r.tid === tenant.id && r.status === "needs_info");
  return (
    <>
      <PageHead title={t("nav.listings")} sub={t("listings.sub", { n: rows.length })} actions={<><DataActions kind="listings" onlyExport={!canEdit} />{canEdit && <Button icon="plus" onClick={() => navigate("/business/listings/new")}>{t("listings.new")}</Button>}</>} />
      {draft && (
        <div className="pf-alert progress"><Icon name="file-pen" size={18} /><div><b>{t("listings.draftTitle")}</b><span>{t("listings.draftText", { kind: kindName(draft.kind) })}</span></div><Button size="sm" onClick={() => navigate("/business/listings/new")}>{t("listings.resume")}</Button></div>
      )}
      {waiting.length > 0 && <div className="pf-alert action"><Icon name="message-circle" size={18} /><div><b>The Sheetal team needs a reply</b><span>{waiting.map((r) => `${otaName(r.ch)}: ${r.ask}`).join(" · ")}</span></div><Button size="sm" onClick={() => setOta(rows.find((l) => l.id === waiting[0].lid) || null)}>Reply</Button></div>}
      <section className="card pf-panel">
        {rows.length ? (
          <div className="pf-table-wrap"><table className="table pf-table" style={{ minWidth: 760 }}>
            <thead><tr><th>{t("listings.listing")}</th><th>{t("listings.kind")}</th><th>{t("common.status")}</th><th style={{ textAlign: "right" }}>{t("listings.price")}</th><th style={{ textAlign: "right" }}>{t("listings.views")}</th><th style={{ textAlign: "right" }}>{t("listings.leads")}</th>{stays && <th>Other sites</th>}<th></th></tr></thead>
            <tbody>{rows.map((l) => (
              <tr key={l.id}><td><span className="pf-two"><b>{l.title}</b><small className="tnum">{l.id} · {t("listings.updated")} {l.updated}</small></span></td>
                <td>{kindName(l.kind)}</td><td><StatusB s={l.status} /></td>
                <td className="tnum" style={{ textAlign: "right" }}>{rsShort(l.price)}</td><td className="tnum" style={{ textAlign: "right" }}>{l.views.toLocaleString("en-IN")}</td><td className="tnum" style={{ textAlign: "right" }}><a href="#" onClick={(e) => { e.preventDefault(); navigate("/business/inbox"); }}>{l.leads}</a></td>
                {stays && <td>{isStayListing(l) && l.status === "published" ? <OtaCell listing={l} onOpen={() => setOta(l)} /> : <span className="small muted">{isStayListing(l) ? "Publish first" : "—"}</span>}</td>}
                <td style={{ textAlign: "right" }}><div className="pf-row-actions pf-row-links"><IconLink to="/business/analytics" icon="chart-column" label={t("nav.analytics")} /><IconLink to="/business/agreements" icon="file-pen-line" label={t("ag.new")} />{stays && isStayListing(l) && l.status === "published" && <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Sell on other sites" aria-label="Sell on other sites" onClick={() => setOta(l)}><Icon name="globe" size={16} /></button>}</div></td></tr>
            ))}</tbody></table></div>
        ) : <Empty icon="house-plus" title={t("listings.none")} action={canEdit && <Button icon="plus" onClick={() => navigate("/business/listings/new")}>{t("listings.new")}</Button>}>{t("listings.noneText")}</Empty>}
      </section>
      {showRenew && <Renewals tenant={tenant} />}
      {stays && <OtaDrawer tenant={tenant} listing={ota} onClose={() => setOta(null)} />}
    </>
  );
}

import { Renewals } from "./Sector";
import { OtaCell, OtaDrawer, isStayListing } from "./OtaPanel";
import { otaName, otaOf } from "@sheetal/shared/data/ota";
import { StatusBadge as StatusB } from "@sheetal/shared/core/ui";
import { IconLink } from "@sheetal/shared/layout/Links";
