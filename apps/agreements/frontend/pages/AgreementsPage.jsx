// Agreements on the business API (Business → Agreements, when signed in): make from a template, fill in, send for
// e-signing, follow the signatures, print the signed copy.
// Where it fits: moved from business/frontend/src/pages/LiveAgreements.jsx (P2-W2); shown at /business/agreements by BusinessApp.jsx through the shim left there. On the kit (@sheetal/ui, @sheetal/sdk). A draft saves itself a moment after each change without a version (last save wins, as before), so typing never meets a 409.
// in Rentals or a lead in the Inbox). The sample screens are Agreements.jsx. People sign on the website (/sign/<token>).
// How it works: a draft saves a moment after each change and the server sends back the filled texts, shown as the
// printable page (English and Nepali are separate copies; pick one to look at). Send freezes it and emails each person
// their link; their code comes by email. Once everyone has signed, Print makes the signed copy with its signing record
// (the print dialog can save it as a PDF).
// Rules: the server checks everything; a sent agreement can't change (cancel it and make a copy instead).

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "@sheetal/shared/core/router";
import { fdate, fdatetime } from "@sheetal/shared/core/format";
import { Badge, Button, Empty, Field, Input, Modal, PageHead, Panel, Seg, Table, Tabs, Textarea, useToast } from "@sheetal/ui/primitives";
import { Icon } from "@sheetal/shared/core/icons";
import { AgreementFrame } from "@sheetal/shared/components/AgreementFrame";
import { docLangs, printAgreement } from "@sheetal/shared/core/agreementDoc";
import { bizApi } from "@sheetal/sdk/client";
import { useApiGet } from "@sheetal/sdk/hooks";

const STATUS = { draft: ["neutral", "Draft"], sent: ["action", "Waiting for signatures"], signed: ["done", "Signed"], cancelled: ["problem", "Cancelled"] };
const KIND_ICON = { rent: "key-round", sale: "hand-coins", management: "building-2", booking: "bed-double", blank: "file-text" };
const LANG_OPTS = [{ id: "en", label: "English" }, { id: "ne", label: "नेपाली" }, { id: "both", label: "Both (two copies)" }];
const Status = ({ s }) => <Badge tone={STATUS[s]?.[0] || "neutral"}>{STATUS[s]?.[1] || s}</Badge>;
const Two = ({ a, b }) => <span className="pf-two"><b>{a}</b>{b ? <small>{b}</small> : null}</span>;
const num = (s) => String(s ?? "").replace(/\D/g, "");
const dec = (s) => String(s ?? "").replace(/[^\d.]/g, "");

/** One GET on the kit (useApiGet): loads again when the business, the branch picked at the top or reload() change. [data, reload]; data is null while the
 *  first answer is on its way and false if it failed (the error is shown as a toast, as before). */
function useLoad(path, tenantId, enabled = true) {
  const toast = useToast();
  const { data, error, refresh } = useApiGet(enabled ? path : null, { tenantId });
  useEffect(() => { if (error) toast(error.message); }, [error, toast]);
  return [data ?? (error ? false : null), refresh];
}

export function AgreementsPage({ tenant, id, from, fromId }) {
  if (id) return <Editor key={id} tenant={tenant} id={id} />;
  return <List tenant={tenant} from={from} fromId={fromId} />;
}

function List({ tenant, from, fromId }) {
  const { navigate } = useRouter();
  const toast = useToast();
  const [d] = useLoad("/agreements", tenant.id);
  const [tab, setTab] = useState("all");
  const defaultKind = from === "lease" ? "rent" : ["hotel", "host"].includes(tenant.type) ? "booking" : tenant.type === "agency" ? "rent" : "sale";
  const [make, setMake] = useState(from ? { kind: defaultKind, lang: "both" } : null);
  const [busy, setBusy] = useState(false);
  if (d === null) return <><PageHead title="Agreements" /><p className="muted pf-pad">Loading…</p></>;
  if (d === false) return <><PageHead title="Agreements" /><Empty icon="circle-alert" title="Agreements couldn't load">Your plan or role may not include them.</Empty></>;
  const rows = d.rows.filter((a) => tab === "all" || a.status === tab);
  const create = () => {
    setBusy(true);
    bizApi("POST", "/agreements", { kind: make.kind, lang: make.lang, ...(from === "lease" ? { leaseId: fromId } : from === "lead" ? { leadId: fromId } : {}) })
      .then((r) => { toast(r.message); navigate(`/business/agreements/${r.data.id}`); }).catch((e) => toast(e.message)).finally(() => setBusy(false));
  };
  return (
    <>
      <PageHead title="Agreements" sub="Make an agreement from a template, send it, and each person signs with a code sent to their email."
        actions={<Button icon="file-plus" onClick={() => setMake({ kind: defaultKind, lang: "both" })}>New agreement</Button>} />
      <div className="pf-template-row">
        {d.templates.map((t) => (
          <button key={t.kind} type="button" className="card pf-template" onClick={() => setMake({ kind: t.kind, lang: "both" })}>
            <Icon name={KIND_ICON[t.kind]} size={20} /><b>{t.label.en}</b><span className="small muted">{t.label.ne}</span>
          </button>
        ))}
      </div>
      <Panel>
        <div className="pf-pad-x"><Tabs value={tab} onChange={setTab} tabs={["all", "draft", "sent", "signed", "cancelled"].map((s) => ({ id: s, label: s === "all" ? "All" : STATUS[s][1], count: s === "all" ? d.rows.length || undefined : d.rows.filter((a) => a.status === s).length || undefined }))} /></div>
        <Table rows={rows} minWidth={760} onRowClick={(a) => navigate(`/business/agreements/${a.id}`)}
          empty={<div className="pf-pad"><Empty icon="file-pen-line" title="No agreements here yet">Pick a template above to make one.</Empty></div>}
          columns={[
            { key: "t", label: "Agreement", render: (a) => <Two a={a.title} b={`${a.ref} · ${d.templates.find((t) => t.kind === a.kind)?.label.en || a.kind}`} /> },
            { key: "p", label: "People", render: (a) => <span className="small">{a.signers.map((s) => <span key={s.id} style={{ marginRight: 10, whiteSpace: "nowrap" }}>{s.status === "signed" && <Icon name="check" size={13} />} {s.name || s.roleLabel.en}</span>)}</span> },
            { key: "s", label: "Status", render: (a) => <Status s={a.status} /> },
            { key: "d", label: "Date", num: true, render: (a) => fdate(String(a.signedAt || a.sentAt || a.createdAt).slice(0, 10)) },
          ]} />
      </Panel>
      {make && <Modal open onClose={() => setMake(null)} title="New agreement"
        footer={<><Button variant="outline" onClick={() => setMake(null)}>Cancel</Button><Button icon="file-plus" disabled={busy} onClick={create}>Make draft</Button></>}>
        <div className="pf-stack">
          {from && <p className="pf-hint" style={{ margin: 0 }}><Icon name="link" size={13} />The people and terms are filled from the {from === "lease" ? "lease" : "lead"}. Check them before sending.</p>}
          <Field label="Template"><div className="pf-tiles">{d.templates.map((t) => (
            <button key={t.kind} type="button" className={make.kind === t.kind ? "on" : ""} onClick={() => setMake({ ...make, kind: t.kind })}><Icon name={KIND_ICON[t.kind]} size={20} /><span>{t.label.en}</span></button>
          ))}</div></Field>
          <Field label="Language" hint="With both, the English and the Nepali copy are separate, each complete in its own language."><Seg value={make.lang} onChange={(v) => setMake({ ...make, lang: v })} options={LANG_OPTS} /></Field>
        </div>
      </Modal>}
    </>
  );
}

const blankSigner = (role) => ({ role, name: "", nameNe: "", email: "", phone: "", address: "", addressNe: "", idNo: "" });
const editable = (a) => ({ title: a.title, lang: a.lang, values: a.values || {}, bodyEn: a.bodyEn, bodyNe: a.bodyNe, signers: a.signers.map(({ id, role, name, nameNe, email, phone, address, addressNe, idNo }) => ({ id, role, name, nameNe, email, phone, address, addressNe, idNo })) });

function Editor({ tenant, id }) {
  const { navigate } = useRouter();
  const toast = useToast();
  const [a, setA] = useState(null);
  const [f, setF] = useState(null);
  const [tpl, setTpl] = useState(null);
  const [view, setView] = useState("en");
  const [saved, setSaved] = useState("saved");
  const [wording, setWording] = useState(false);
  const [ask, setAsk] = useState(null);
  const [busy, setBusy] = useState(false);
  const first = useRef(true);

  const load = useCallback(() => Promise.all([bizApi("GET", `/agreements/${id}`), tpl ? null : bizApi("GET", "/agreements")]).then(([r, l]) => {
    setA(r.data); setF(editable(r.data)); first.current = true;
    if (l) setTpl(l.data.templates.find((t) => t.kind === r.data.kind));
    setView((v) => (r.data.texts[v] != null ? v : docLangs(r.data)[0] || "en"));
  }).catch((e) => { toast(e.message); setA(false); }), [id, tpl]);
  useEffect(() => { load(); }, [id]);

  // Drafts save a moment after each change; the server sends back the filled texts for the preview.
  useEffect(() => {
    if (!f || !a || a.status !== "draft") return undefined;
    if (first.current) { first.current = false; return undefined; }
    setSaved("saving");
    const tm = setTimeout(() => {
      bizApi("PUT", `/agreements/${id}`, f).then((r) => {
        setA(r.data); setSaved("saved");
        setF((cur) => ({ ...cur, signers: cur.signers.map((s, i) => (s.id ? s : { ...s, id: r.data.signers.find((x) => x.role === s.role)?.id ?? r.data.signers[i]?.id })) }));
        setView((v) => (r.data.texts[v] != null ? v : docLangs(r.data)[0] || "en"));
      }).catch((e) => setSaved(e.message || "Not saved"));
    }, 600);
    return () => clearTimeout(tm);
  }, [f]);

  if (a === null || (a && !tpl)) return <><PageHead title="Agreement" /><p className="muted pf-pad">Loading…</p></>;
  if (a === false) return <><PageHead title="Agreement" /><Empty icon="file-pen-line" title="Agreement not found" action={<Button onClick={() => navigate("/business/agreements")}>All agreements</Button>} /></>;

  const draft = a.status === "draft";
  const langs = f.lang === "both" ? ["en", "ne"] : [f.lang];
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const setVal = (k, v) => setF((x) => ({ ...x, values: { ...x.values, [k]: v } }));
  const setSigner = (role, patch) => setF((x) => ({ ...x, signers: x.signers.some((s) => s.role === role) ? x.signers.map((s) => (s.role === role ? { ...s, ...patch } : s)) : [...x.signers, { ...blankSigner(role), ...patch }] }));
  const act = (method, path, body, after) => {
    setBusy(true);
    return bizApi(method, path, body).then((r) => { toast(r.message); setAsk(null); after ? after(r) : load(); }).catch((e) => toast(e.message)).finally(() => setBusy(false));
  };
  const missing = [...new Set([...(a.missing?.en || []), ...(a.missing?.ne || [])])];

  const fieldInput = (fd) => {
    const v = f.values[fd.key];
    const label = fd.label.en;
    if (fd.type === "text") return langs.map((l) => (
      <Field key={fd.key + l} label={langs.length > 1 ? `${label} (${l === "en" ? "in English" : "नेपालीमा"})` : l === "ne" ? fd.label.ne : label}>
        <Input value={v?.[l] ?? ""} lang={l} onChange={(e) => setVal(fd.key, { en: "", ne: "", ...(v || {}), [l]: e.target.value })} /></Field>));
    const type = fd.type === "date" ? "date" : fd.type === "time" ? "time" : "text";
    const clean = fd.type === "pct" ? dec : num;
    return <Field key={fd.key} label={fd.type === "money" ? `${label} (Rs.)` : label}>
      <Input className={type === "text" ? "input tnum" : undefined} type={type} inputMode={type === "text" ? "decimal" : undefined} value={v ?? ""}
        onChange={(e) => { const s = type === "text" ? clean(e.target.value) : e.target.value; setVal(fd.key, s === "" ? undefined : type === "text" ? Number(s) : s); }} /></Field>;
  };
  const person = (role, label, optional) => {
    const s = f.signers.find((x) => x.role === role);
    if (!s && optional) return <Button key={role} variant="outline" size="sm" icon="user-plus" onClick={() => setSigner(role, {})}>Add a witness</Button>;
    const x = s || blankSigner(role);
    const inp = (k, lab, extra = {}) => <Field label={lab} optional={!["name", "email", "nameNe"].includes(k)}><Input value={x[k] || ""} {...extra} onChange={(e) => setSigner(role, { [k]: e.target.value })} /></Field>;
    return (
      <div key={role} className="pf-stack tight" style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
        <div className="pf-row-actions" style={{ justifyContent: "space-between" }}><b>{label}</b>{optional && <Button variant="ghost" size="sm" icon="x" onClick={() => set({ signers: f.signers.filter((y) => y.role !== role) })}>Remove</Button>}</div>
        <div className="pf-grid-2 tight">{f.lang !== "ne" && inp("name", "Full name")}{f.lang !== "en" && inp("nameNe", "पूरा नाम (नेपालीमा)", { lang: "ne" })}</div>
        <div className="pf-grid-2 tight">{inp("email", "Email (the signing code goes here)", { type: "email" })}{inp("phone", "Mobile", { inputMode: "tel" })}</div>
        {role !== "witness" && <>
          <div className="pf-grid-2 tight">{f.lang !== "ne" && inp("address", "Address")}{f.lang !== "en" && inp("addressNe", "ठेगाना (नेपालीमा)", { lang: "ne" })}</div>
          {inp("idNo", "Citizenship or passport no.")}
        </>}
      </div>
    );
  };

  return (
    <>
      <PageHead title={a.title} sub={`${a.ref} · ${tpl.label.en}`}
        back={<a href="#" className="fb-back" onClick={(e) => { e.preventDefault(); navigate("/business/agreements"); }}><Icon name="arrow-left" size={16} />Agreements</a>}
        actions={<>
          <Status s={a.status} />
          {draft && <span className="small muted">{saved === "saved" ? "Saved" : saved === "saving" ? "Saving…" : `Not saved: ${saved}`}</span>}
          {draft && <Button variant="ghost" icon="trash-2" onClick={() => window.confirm("Remove this draft?") && act("DELETE", `/agreements/${id}`, undefined, () => navigate("/business/agreements"))}>Remove</Button>}
          {(a.status === "sent" || a.status === "cancelled" || a.status === "signed") && <Button variant="outline" icon="copy" disabled={busy} onClick={() => act("POST", `/agreements/${id}/copy`, undefined, (r) => navigate(`/business/agreements/${r.data.id}`))}>Make a copy</Button>}
          {a.status === "sent" && <Button variant="outline" icon="ban" onClick={() => setAsk({ kind: "cancel", note: "" })}>Cancel</Button>}
          {a.status === "signed" && <Button icon="printer" onClick={() => printAgreement(a)}>Print or save as PDF</Button>}
          {draft && <Button icon="send" disabled={!!a.problem || saved !== "saved"} title={a.problem || undefined} onClick={() => setAsk({ kind: "send" })}>Send for signing</Button>}
        </>} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))", gap: 20, alignItems: "start" }}>
        <div className="pf-stack">
          {draft ? <>
            {a.problem && <div className="pf-note"><Icon name="info" size={16} /><span>{a.problem}</span></div>}
            <Panel title="Agreement" pad>
              <div className="pf-stack">
                <Field label="Title"><Input value={f.title} onChange={(e) => set({ title: e.target.value })} /></Field>
                <Field label="Language" hint="With both, each copy is complete in its own language. Write names and text in each."><Seg value={f.lang} onChange={(v) => set({ lang: v })} options={LANG_OPTS} /></Field>
                {tpl.fields.map(fieldInput)}
                {a.kind === "sale" && f.values.price != null && f.values.token != null && <p className="small muted" style={{ margin: 0 }}>Balance on registration: Rs. {(Number(f.values.price) - Number(f.values.token)).toLocaleString("en-IN")}</p>}
              </div>
            </Panel>
            <Panel title="People signing" sub="Each gets their own link by email and signs with a code sent to that email." pad>
              <div className="pf-stack">
                {person("p1", tpl.roles.p1.en)}
                {person("p2", tpl.roles.p2.en)}
                {person("witness", "Witness", true)}
              </div>
            </Panel>
            <Panel title="Wording" sub="The template is a starting point. Have a lawyer check it before you first use it." pad
              actions={<Button variant="outline" size="sm" icon={wording ? "chevron-up" : "pencil"} onClick={() => setWording(!wording)}>{wording ? "Close" : "Edit the wording"}</Button>}>
              {wording ? <div className="pf-stack">
                {langs.map((l) => <Field key={l} label={l === "en" ? "English text" : "नेपाली पाठ"} hint={l === "en" ? "Start the heading with # . Leave a blank line between clauses." : "शीर्षक # बाट सुरु गर्नुहोस्। दफाहरूबीच एक खाली लाइन छोड्नुहोस्।"}>
                  <Textarea rows={16} lang={l} value={l === "en" ? f.bodyEn : f.bodyNe} onChange={(e) => set(l === "en" ? { bodyEn: e.target.value } : { bodyNe: e.target.value })} /></Field>)}
                <p className="small muted" style={{ margin: 0 }}>Values you can use: {[...tpl.fields.map((x) => x.key), ...(a.kind === "sale" ? ["balance"] : []), "p1", "p1_address", "p1_id", "p2", "p2_address", "p2_id"].map((k) => `{{${k}}}`).join(" ")}</p>
                <Button variant="ghost" size="sm" icon="rotate-ccw" onClick={() => window.confirm("Put the template's wording back? Your changes to the text are lost.") && set({ bodyEn: tpl.bodyEn, bodyNe: tpl.bodyNe })}>Back to the template's wording</Button>
              </div> : missing.length ? <p className="small" style={{ margin: 0 }}>Still to fill in: {missing.join(", ")}.</p> : <p className="small muted" style={{ margin: 0 }}>Everything is filled in.</p>}
            </Panel>
          </> : <>
            <Panel title="Signatures" pad>
              <ul className="pf-list">{a.signers.map((s) => (
                <li key={s.id}><span className="pf-li-ico"><Icon name={s.status === "signed" ? "circle-check" : "clock"} size={17} /></span>
                  <div><b>{s.name}</b><span className="small muted">{s.roleLabel.en} · {s.email}{s.status === "signed" ? ` · signed ${s.signedTime}` : s.codeSent ? " · code sent" : ""}</span></div>
                  {a.status === "sent" && s.status !== "signed" && <Button variant="outline" size="sm" icon="send" disabled={busy} onClick={() => act("POST", `/agreements/${id}/signers/${s.id}/remind`)}>Send link again</Button>}</li>))}</ul>
              {a.hash && <p className="small muted" style={{ margin: "12px 0 0", wordBreak: "break-all" }}>Fingerprint of the sent text (SHA-256): <span className="tnum">{a.hash}</span></p>}
              {a.status === "cancelled" && <p className="small" style={{ margin: "12px 0 0" }}>Cancelled {a.cancelledAt ? fdatetime(a.cancelledAt) : ""}{a.cancelNote ? `: ${a.cancelNote}` : ""}</p>}
            </Panel>
            <div className="pf-note"><Icon name="info" size={16} /><span>Signing by email code records who agreed and when. For land registration, the Land Revenue Office still needs signatures on paper.</span></div>
          </>}
        </div>

        <div className="pf-stack tight" style={{ position: "sticky", top: 12 }}>
          {docLangs(a).length > 1 && <div className="pf-chips">{docLangs(a).map((l) => <button key={l} type="button" className={`chip ${view === l ? "active" : ""}`} onClick={() => setView(l)}>{l === "en" ? "English copy" : "नेपाली प्रति"}</button>)}</div>}
          {a.texts[view] != null ? <AgreementFrame doc={{ ...a, business: { name: tenant.name } }} lang={view} title={a.title} /> : <Empty icon="file-text" title="Nothing to show yet" />}
        </div>
      </div>

      {ask?.kind === "send" && <Modal open onClose={() => setAsk(null)} title="Send for signing?"
        footer={<><Button variant="outline" onClick={() => setAsk(null)}>Not yet</Button><Button icon="send" disabled={busy} onClick={() => act("POST", `/agreements/${id}/send`)}>Send</Button></>}>
        <div className="pf-stack"><p style={{ margin: 0 }}>Each person gets a link by email: {a.signers.map((s) => `${s.name} (${s.email})`).join(", ")}.</p>
          <p className="small muted" style={{ margin: 0 }}>After sending, the text can't change. To fix something, cancel it and make a copy.</p></div>
      </Modal>}
      {ask?.kind === "cancel" && <Modal open onClose={() => setAsk(null)} title="Cancel this agreement?"
        footer={<><Button variant="outline" onClick={() => setAsk(null)}>Keep it</Button><Button icon="ban" disabled={busy} onClick={() => act("POST", `/agreements/${id}/cancel`, { note: ask.note })}>Cancel agreement</Button></>}>
        <div className="pf-stack"><p style={{ margin: 0 }}>The signing links stop working and everyone gets an email saying it was cancelled.</p>
          <Field label="Note to them" optional><Textarea rows={2} value={ask.note} onChange={(e) => setAsk({ ...ask, note: e.target.value })} /></Field></div>
      </Modal>}
    </>
  );
}
