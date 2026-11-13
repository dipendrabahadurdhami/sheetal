// The listing wizard (every listing kind), on the business API.
// Where it fits: Business → Listings → New / Edit. Moved here from business/frontend/src/pages/ListingWizard.jsx in P2-W6 (that file is the shim, which
// passes in the AI fill (`Ai`, a Business page an app may not import) and the panel's reload (`onChanged`)).
// How it works: one wizard renders every kind from the listing forms (shared/src/data/listingForms.js), mostly with taps (chips, counters, quick
// prices); photos upload as they are picked; a new listing goes to the branch picked at the top, or asks which one (GET /branches).
// Rules: the server checks and keeps the listing; only the edit in progress (`drafts`, UI state) stays in the panel until it is sent.

import React, { useRef, useState } from "react";
import { useLang, useT } from "@sheetal/shared/core/i18n";
import { useStore } from "@sheetal/shared/core/store";
import { Link, useRouter } from "@sheetal/shared/core/router";
import { rs, rsShort } from "@sheetal/shared/core/format";
import { Badge, Button, Drawer, PageHead, Toggle, useToast } from "@sheetal/ui/primitives";
import { Icon } from "@sheetal/shared/core/icons";
import { AREA, areaToSqft, sqftToHill } from "@sheetal/shared/data/catalog";
import { FORMS, HIGHLIGHTS, suggestTitle, summaryOf } from "@sheetal/shared/data/listingForms";
import { formFor } from "@sheetal/shared/data/formSetup";
import { PinPicker } from "./PinPicker.jsx";
import { kindsFor, planOf } from "@sheetal/shared/core/plans";
import { listingActions, uploadListingPhoto } from "../api.js";
import { useApiGet } from "@sheetal/sdk/hooks";
import { useBranch } from "@sheetal/shared/core/branch";

export function ListingWizard({ tenant, Ai, onChanged }) {
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
  const [busy, setBusy] = useState(false);
  // Photos upload as they are picked and the listing is sent to Sheetal for review.
  const live = listingActions(toast, onChanged);
  const editId = draft?.editId;
  // Which branch a new listing is for: the one picked at the top, or (with "All branches") chosen here.
  const br = useBranch();
  const branchList = useApiGet("/branches").data?.branches || [];
  const choices = branchList.filter((b) => b.status === "open" && br.allowed.includes(b.name));
  const mustPick = !editId && br.branch === "all" && choices.length > 1;
  const [branchId, setBranchId] = useState(null);
  const pickedBranch = branchId || choices[0]?.id;
  React.useEffect(() => { if (!fillTick) return; const d2 = db.drafts[tenant.id]; if (d2 && FORMS[d2.kind]) { setKind(d2.kind); setStep(0); setV(d2.values || {}); } }, [fillTick, db.drafts, tenant.id]);
  const aiDrawer = <Drawer open={aiOpen} onClose={() => setAiOpen(false)} title={t("ai.listingTitle")} sub={t("ai.listingSub")}><Ai tenant={tenant} only="listing" onFill={() => { setAiOpen(false); setFillTick((n) => n + 1); }} /></Drawer>;

  // The form as Sheetal staff arranged it in Listing setup → Listing forms (built-in form when nothing changed).
  const steps = React.useMemo(() => (kind ? formFor(kind, C) : []), [kind, C]);
  const visible = (f) => !f.when || f.when(v);
  const val = (f) => (v[f.name] !== undefined ? v[f.name] : f.def);
  const set = (name, x) => { setV((o) => ({ ...o, [name]: typeof x === "function" ? x(o[name]) : x })); setErr((e) => ({ ...e, [name]: null })); };
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
    steps[i].fields.filter(visible).forEach((f) => {
      const x = val(f);
      if (f.req && !filled(f)) e[f.name] = f.type === "photos" ? t("wiz.errPhotos", { n: f.min }) : t("wiz.errRequired");
      else if (f.name === "title" && x && String(x).trim().length < 8) e[f.name] = "Write a title of at least 8 characters.";
      else if (f.type === "price" && f.req && !(Number(x) > 0)) e[f.name] = "Enter an amount above 0.";
      else if ((f.type === "number" || f.type === "price") && x !== undefined && x !== "" && (!Number.isFinite(Number(x)) || Number(x) < 0)) e[f.name] = "Enter a number.";
      else if (f.type === "text" && f.name === "video" && x && !/^https?:\/\//.test(String(x))) e[f.name] = "Paste the full link, starting with https://";
    });
    setErr(e);
    return !Object.keys(e).length;
  };
  // Editing a listing: move between steps freely; only a new listing is checked step by step.
  const go = (i) => { if (!editId && i > step && !validate(step)) { toast("Fix the marked fields first."); return; } setStep(i); window.scrollTo(0, 0); };
  // A missing or wrong answer: scroll to the first one and put the cursor in it.
  React.useEffect(() => {
    if (!Object.values(err).some(Boolean)) return undefined;
    const id = requestAnimationFrame(() => {
      const el = document.querySelector(".pf-wiz-fields .pf-fb.has-err");
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.querySelector("input, textarea, select, button")?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, [err, step]);
  const send = (submit) => {
    const title = v.title || suggestTitle(kind, v, label);
    setBusy(true);
    live.save(editId, { kind, values: { ...v, title }, summary: summaryOf(kind, { ...v, title }, C), submit, ...(mustPick ? { branchId: pickedBranch } : {}) })
      .then(() => { update((d) => { delete d.drafts[tenant.id]; }); navigate("/business/listings"); })
      .catch((e) => { if (e.errors) setErr(Object.fromEntries(Object.entries(e.errors).map(([k, m]) => [k, [].concat(m)[0]]))); })
      .finally(() => setBusy(false));
  };
  // A new listing is saved on the server as a draft; an edit in progress is kept in the panel until it is sent.
  const saveDraft = () => { if (!editId) { send(false); return; } update((d) => { d.drafts[tenant.id] = { kind, step, values: v }; }); toast(t("wiz.toastDraft")); };
  const publish = () => {
    if (!editId) for (let i = 0; i < steps.length; i++) if (!validate(i)) { setStep(i); toast("Fix the marked fields first."); return; }
    send(true);
  };

  if (!kind) {
    return (
      <>
        <PageHead title={t("wiz.title")} sub={t("wiz.pickSub")} back={<Link to="/business/listings" className="pf-back"><Icon name="arrow-left" size={15} />{t("nav.listings")}</Link>} />
        {mustPick && <label className="card pf-branch-ask"><Icon name="map-pin" size={18} /><span className="pf-two"><b>Which branch is this listing for?</b><small className="muted">Only that branch's team will see it and its enquiries.</small></span>
          <select className="select" value={pickedBranch} onChange={(e) => setBranchId(e.target.value)} aria-label="Branch">{choices.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
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
                <Control f={f} value={val(f)} set={(x) => set(f.name, x)} opts={optsOf(f)} it={it} L={L} t={t} C={C} kind={kind} v={v} titleSuggest={title} upload={uploadListingPhoto} />
              </FieldBlock>
            ))}
          </div>
          <div className="pf-wiz-foot">
            <Button variant="outline" icon="arrow-left" disabled={step === 0} onClick={() => go(step - 1)}>{t("common.back")}</Button>
            {step < steps.length - 1
              ? <Button onClick={() => go(step + 1)}>{t("common.continue")}<Icon name="arrow-right" size={16} /></Button>
              : <Button icon="send" disabled={busy} onClick={publish}>{busy ? "Sending…" : t("wiz.submit")}</Button>}
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

function Control({ f, value, set, opts, it, L, t, C, kind, v, titleSuggest, upload }) {
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
      return <Photos value={value || []} onChange={set} min={f.min} t={t} upload={upload} />;
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
  // One search over all of Nepal: type an area or a district and pick it; or pick a district, then its area.
  // A district or area that isn't listed can still be typed (Sheetal adds it to Listing setup).
  const [q, setQ] = React.useState("");
  const [all, setAll] = React.useState(false);
  const known = C.districts.find((d) => d.id === value.district);
  const areas = known ? C.areas[value.district] || [] : [];
  const ql = q.trim().toLowerCase();
  const has = (s) => String(s || "").toLowerCase().includes(ql);
  const starts = (s) => String(s || "").toLowerCase().startsWith(ql);
  const hits = ql.length < 2 ? [] : [
    ...C.districts.filter((d) => has(d.en) || has(d.ne)).map((d) => ({ d, a: null, rank: starts(d.en) ? 0 : 2 })),
    ...C.districts.flatMap((d) => (C.areas[d.id] || []).filter(has).map((a) => ({ d, a, rank: starts(a) ? 1 : 3 }))),
  ].sort((x, y) => x.rank - y.rank).slice(0, 14);
  const exact = C.districts.some((d) => (d.en || "").toLowerCase() === ql) || hits.some((h) => h.a && h.a.toLowerCase() === ql);
  const popular = C.districts.slice(0, 8);
  const districts = all ? C.districts : known && !popular.includes(known) ? [...popular, known] : popular;
  const typed = areas.includes(value.area) ? "" : value.area || "";
  const shownAreas = typed ? areas.filter((a) => a.toLowerCase().includes(typed.toLowerCase())).slice(0, 30) : areas.slice(0, 18);
  return (
    <div className="pf-stack tight">
      <label className="loc-find"><Icon name="search" size={16} /><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type an area or district, e.g. Dhapasi, Lakeside or Pokhara" aria-label="Find an area or district" /></label>
      {ql.length >= 2 ? (
        <div className="pf-chips">
          {hits.map((h) => { const on = value.district === h.d.id && (h.a ? value.area === h.a : !value.area); return (
            <button key={h.d.id + (h.a || "")} type="button" className={`chip ${on ? "active" : ""}`} onClick={() => { onChange(h.a ? { district: h.d.id, area: h.a } : { district: h.d.id }); setQ(""); }}>
              <Icon name="map-pin" size={14} />{h.a ? `${h.a}, ${it(h.d)}` : it(h.d)}
            </button>); })}
          {!exact && <button type="button" className={`chip ${value.custom && value.district === q.trim() ? "active" : ""}`} onClick={() => { onChange({ district: q.trim(), custom: true }); setQ(""); }}><Icon name="plus" size={14} />Use “{q.trim()}” as the district</button>}
          {!hits.length && <span className="small muted">Not in the list yet. Pick the district, then type the area.</span>}
        </div>
      ) : (
        <div className="pf-chips">
          {districts.map((d) => <button key={d.id} type="button" className={`chip ${value.district === d.id ? "active" : ""}`} aria-pressed={value.district === d.id} onClick={() => onChange({ district: d.id })}>{it(d)}</button>)}
          {C.districts.length > popular.length && <button type="button" className="chip" onClick={() => setAll(!all)}><Icon name={all ? "minus" : "plus"} size={14} />{all ? "Fewer districts" : `All ${C.districts.length} districts`}</button>}
        </div>
      )}
      {value.custom && value.district && <span className="pf-hint"><Icon name="info" size={13} />“{value.district}” will be checked by the Sheetal team and added to the list.</span>}
      {value.district && (
        <div className="pf-chips sub">
          {shownAreas.map((a) => <button key={a} type="button" className={`chip ${value.area === a ? "active" : ""}`} aria-pressed={value.area === a} onClick={() => onChange({ ...value, area: a })}><Icon name="map-pin" size={14} />{a}</button>)}
          {!typed && areas.length > shownAreas.length && <span className="small muted">+{areas.length - shownAreas.length} more: type to find</span>}
          <input className="input pf-chip-input" placeholder={t("wiz.otherArea")} value={typed} onChange={(e) => onChange({ ...value, area: e.target.value })} />
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

function Photos({ value, onChange, min, t, upload }) {
  const ref = useRef(null);
  const toast = useToast();
  const [sending, setSending] = useState(0);
  const add = async (list) => {
    const files = [...list].filter((f) => f.type.startsWith("image/"));
    if (!upload) { onChange([...value, ...files.map((f) => ({ id: Math.random().toString(36).slice(2), url: URL.createObjectURL(f), name: f.name }))]); return; }
    setSending((n) => n + files.length);
    const done = await Promise.all(files.map((f) => upload(f).then((r) => ({ id: r.file, file: r.file, url: r.url, name: f.name })).catch((e) => { toast(`${f.name}: ${e.message}`); return null; }).finally(() => setSending((n) => n - 1))));
    onChange((prev) => [...(prev || []), ...done.filter(Boolean)]);
  };
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
      <span className="pf-hint tnum">{t("wiz.photoCount", { n: value.length, min })}{sending > 0 ? ` · uploading ${sending}…` : ""}</span>
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
              ) : sf.type === "multi" ? (
                <div className="pf-chips">{(C[sf.src] || []).map((o) => { const cur = row[sf.name] || []; const on = cur.includes(o.id); return <button key={o.id} type="button" aria-pressed={on} className={`chip ${on ? "active" : ""}`} onClick={() => setRow(i, sf.name, on ? cur.filter((x) => x !== o.id) : [...cur, o.id])}><Icon name={on ? "check" : o.icon} size={14} />{it(o)}</button>; })}</div>
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
