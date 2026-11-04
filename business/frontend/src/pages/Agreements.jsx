// Paperless agreements (sample data for now, marked Preview).
// How it works: templates follow how deals are done on paper in Nepal; the legal wording is a slot the company's
// lawyer fills (see the legal note on every document).

import React, { useState } from "react";
import { useLang, useT } from "@sheetal/shared/core/i18n";
import { useStore } from "@sheetal/shared/core/store";
import { fdate, fdatetime, rs, rsShort, daysFromToday, TODAY } from "@sheetal/shared/core/format";
import { Badge, Button, Drawer, Empty, Field, Input, PageHead, Seg, Select, StatusBadge, Table, Tabs, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { Counter } from "./ListingWizard";
import { toBS } from "@sheetal/shared/core/bs";
import { LinkChip } from "@sheetal/shared/layout/Links";
import { DataActions } from "@sheetal/shared/components/DataIO";
import { DeleteConfirm, restoreAt } from "@sheetal/shared/components/Crud";

export const TEMPLATES = {
  baina: { icon: "hand-coins", types: ["agency", "developer", "owner"], parties: ["seller", "buyer"], docs: ["lalpurja", "citizenship", "charkilla", "trace", "tiro", "naksa"] },
  rent: { icon: "key-round", types: ["agency", "host", "owner"], parties: ["landlord", "tenant"], docs: ["citizenship", "lalpurja", "rent_tax"] },
  lease: { icon: "sprout", types: ["agency", "owner"], parties: ["lessor", "lessee"], docs: ["lalpurja", "citizenship", "charkilla"] },
  commission: { icon: "percent", types: ["agency"], parties: ["owner"], docs: ["citizenship", "lalpurja"] },
  reservation: { icon: "building-2", types: ["developer"], parties: ["buyer"], docs: ["citizenship", "pan"] },
  voucher: { icon: "ticket", types: ["hotel", "host"], parties: ["guest"], docs: ["passport"] },
  invest: { icon: "chart-pie", types: ["sponsor"], parties: ["investor"], docs: ["citizenship", "pan", "bank"] },
};

const STATUS_FLOW = ["draft", "sent", "signed", "completed"];

export function Agreements({ tenant }) {
  const t = useT();
  const { db, update } = useStore();
  const toast = useToast();
  const [tab, setTab] = useState("all");
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(false);
  const list = db.agreements[tenant.id] || [];
  const contacts = db.contacts[tenant.id] || [];
  const who = (id) => contacts.find((c) => c.id === id)?.name || "—";
  const rows = list.filter((a) => tab === "all" || a.status === tab);
  const open = list.find((a) => a.id === openId);
  const available = Object.keys(TEMPLATES).filter((k) => TEMPLATES[k].types.includes(tenant.type));
  const [view, setView] = useState("agreements");
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  const cap = (x) => (x ? x[0].toUpperCase() + x.slice(1) : "");
  const setList = (fn) => update((d) => { fn((d.agreements[tenant.id] = d.agreements[tenant.id] || [])); });
  const nextAg = (l) => { const y = TODAY.slice(0, 4); return `AG-${y}-${String(Math.max(0, ...l.filter((a) => a.id.startsWith(`AG-${y}-`)).map((a) => Number(a.id.slice(8)) || 0)) + 1).padStart(4, "0")}`; };
  const agRows = list.map((a) => ({ ...a, template: cap(a.template), first: who(a.parties.first), second: a.parties.second ? who(a.parties.second) : "", status: cap(a.status) }));
  const importAgs = (rows) => update((d) => {
    const l = (d.agreements[tenant.id] = d.agreements[tenant.id] || []); const cs = (d.contacts[tenant.id] = d.contacts[tenant.id] || []);
    const idOf = (name) => { if (!name) return undefined; let c = cs.find((x) => x.name.toLowerCase() === name.toLowerCase()); if (!c) { c = { id: `c${Date.now().toString(36)}${cs.length}`, name, role: "", phone: "" }; cs.push(c); } return c.id; };
    rows.forEach((r) => l.unshift({ id: nextAg(l), template: r.template.toLowerCase(), title: r.title, parties: { first: idOf(r.first), ...(r.second ? { second: idOf(r.second) } : {}) }, amount: r.amount, deadline: r.deadline, status: String(r.status || "Draft").toLowerCase(), created: TODAY.slice(0, 10), signed: {}, docs: {} }));
  });

  return (
    <>
      <PageHead title={t("ag.title")} sub={t("ag.sub")} actions={<>{view === "agreements" && <DataActions kind="agreements" rows={agRows} onImport={importAgs} />}<Button icon="file-plus" onClick={() => setCreating(true)}>{t("ag.new")}</Button></>} />
      <Tabs value={view} onChange={setView} tabs={[{ id: "agreements", label: t("ag.title"), icon: "file-pen-line", count: list.length || undefined }, { id: "customers", label: "Customers", icon: "users", count: contacts.length || undefined }]} />
      {view === "customers" && <Customers tenant={tenant} contacts={contacts} agreements={list} />}
      {view === "agreements" && <>
      <div className="pf-template-row">
        {available.map((k) => (
          <button key={k} className="card pf-template" onClick={() => setCreating(k)}>
            <Icon name={TEMPLATES[k].icon} size={20} /><b>{t(`ag.t_${k}`)}</b><span className="small muted">{t(`ag.t_${k}Sub`)}</span>
          </button>
        ))}
      </div>
      <section className="card pf-panel">
        <div className="pf-pad-x"><Tabs value={tab} onChange={setTab} tabs={["all", ...STATUS_FLOW].map((s) => ({ id: s, label: s === "all" ? t("common.all") : t(`status.${s}`), count: s === "all" ? list.length : list.filter((a) => a.status === s).length }))} /></div>
        <Table rows={rows} onRowClick={(a) => setOpenId(a.id)} minWidth={820} empty={<Empty icon="file-pen-line" title={t("ag.none")} action={tab === "all" ? <Button icon="file-plus" onClick={() => setCreating(true)}>{t("ag.new")}</Button> : <Button variant="outline" onClick={() => setTab("all")}>{t("common.all")}</Button>}>{t("ag.noneText")}</Empty>} columns={[
          { key: "id", label: t("ag.agreement"), render: (a) => <span className="pf-two"><b>{a.title}</b><small className="tnum">{a.id} · {t(`ag.t_${a.template}`)}</small></span> },
          { key: "parties", label: t("ag.parties"), render: (a) => <span className="small">{[who(a.parties.first), a.parties.second && who(a.parties.second)].filter(Boolean).join(" · ")}</span> },
          { key: "amount", label: t("ag.amount"), num: true, align: "right", render: (a) => (a.template === "commission" ? `${a.amount}%` : rsShort(a.amount)) },
          { key: "deadline", label: t("ag.deadline"), num: true, render: (a) => <Deadline d={a.deadline} /> },
          { key: "status", label: t("common.status"), render: (a) => <StatusBadge status={a.status} /> },
        ]} />
      </section>
      </>}

      <Drawer open={!!open} onClose={() => setOpenId(null)} title={open?.title} sub={open && `${open.id} · ${t(`ag.t_${open.template}`)}`}
        footer={open && <>
          {open.status === "draft" && <Button variant="ghost" className="pf-danger pf-foot-left" icon="trash-2" onClick={() => setDel(open)}>{t("common.delete")}</Button>}
          {open.status === "draft" && <Button variant="outline" icon="pencil" onClick={() => setEdit({ id: open.id, title: open.title, amount: String(open.amount), deadline: open.deadline, template: open.template })}>{t("common.edit")}</Button>}
          <Button variant="outline" icon="printer" onClick={() => window.print()}>{t("ag.print")}</Button>
          {open.status === "draft" && <Button icon="send" onClick={() => { update((d) => { Object.assign(d.agreements[tenant.id].find((a) => a.id === open.id), { status: "sent" }); }); toast(t("ag.toastSent")); }}>{t("ag.sendSign")}</Button>}
          {open.status === "signed" && <Button icon="badge-check" onClick={() => { update((d) => { d.agreements[tenant.id].find((a) => a.id === open.id).status = "completed"; }); toast(t("ag.toastDone")); }}>{t("ag.markDone")}</Button>}
        </>}>
        {open && <AgreementDetail a={open} tenant={tenant} who={who} contacts={contacts} onDoc={(k) => update((d) => { d.agreements[tenant.id].find((a) => a.id === open.id).docs[k] = true; })} />}
      </Drawer>
      <Drawer open={!!edit} onClose={() => setEdit(null)} title={edit && `Edit ${edit.id}`} sub="Drafts can be changed until they are sent for signing"
        footer={edit && <><Button variant="outline" onClick={() => setEdit(null)}>{t("common.cancel")}</Button><Button disabled={!edit.title.trim() || !(Number(edit.amount) > 0) || !edit.deadline} onClick={() => { setList((l) => { Object.assign(l.find((a) => a.id === edit.id), { title: edit.title.trim(), amount: Number(edit.amount), deadline: edit.deadline }); }); setEdit(null); toast("Draft saved"); }}>{t("common.save")}</Button></>}>
        {edit && <div className="pf-stack">
          <Field label="Title"><Input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
          <div className="pf-grid-2 tight">
            <Field label={t("ag.amount")}>{edit.template === "commission" ? <div className="pf-unit"><input className="input tnum" inputMode="decimal" value={edit.amount} onChange={(e) => setEdit({ ...edit, amount: e.target.value.replace(/[^\d.]/g, "") })} /><span>%</span></div> : <div className="pf-unit"><span>Rs.</span><input className="input tnum" inputMode="numeric" value={edit.amount} onChange={(e) => setEdit({ ...edit, amount: e.target.value.replace(/\D/g, "") })} /></div>}</Field>
            <Field label={t("ag.deadline")}><Input type="date" value={edit.deadline} onChange={(e) => setEdit({ ...edit, deadline: e.target.value })} /></Field>
          </div>
        </div>}
      </Drawer>
      <DeleteConfirm item={del} name={del?.title} what="draft" onClose={() => setDel(null)}
        onDelete={(x) => { setList((l) => { l.splice(l.findIndex((a) => a.id === x.id), 1); }); setOpenId(null); }} onRestore={(x) => setList((l) => { restoreAt(l, x, 0); })}>Drafts were never sent, so no one else has a copy.</DeleteConfirm>
      {creating && <AgreementCreate tenant={tenant} start={typeof creating === "string" ? creating : null} available={available} onClose={() => setCreating(false)}
        onCreate={(a) => { update((d) => { (d.agreements[tenant.id] = d.agreements[tenant.id] || []).unshift(a); }); setCreating(false); setOpenId(a.id); toast(t("ag.toastCreated")); }} />}
    </>
  );
}

const ROLES = ["buyer", "seller", "landlord", "tenant", "owner", "lessor", "lessee", "guest", "investor"];
function Customers({ tenant, contacts, agreements }) {
  const { update } = useStore();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [ed, setEd] = useState(null);
  const [del, setDel] = useState(null);
  const cap = (x) => (x ? x[0].toUpperCase() + x.slice(1) : "");
  const setC = (fn) => update((d) => { fn((d.contacts[tenant.id] = d.contacts[tenant.id] || [])); });
  const uses = (id) => agreements.filter((a) => a.parties.first === id || a.parties.second === id).length;
  const rows = contacts.filter((c) => !q.trim() || [c.name, c.phone, c.citizenship].join(" ").toLowerCase().includes(q.trim().toLowerCase()));
  const blank = () => ({ name: "", role: "buyer", phone: "", citizenship: "", district: "", father: "", grandfather: "", address: "" });
  const save = () => { const rec = { ...ed, name: ed.name.trim() }; setC((l) => { const i = l.findIndex((c) => c.id === rec.id); if (i >= 0) l[i] = rec; else l.unshift({ ...rec, id: `c${Date.now().toString(36)}` }); }); setEd(null); toast("Customer saved"); };
  const importC = (r) => setC((l) => { r.forEach((x, i) => { const same = l.find((c) => c.phone && c.phone.replace(/\D/g, "") === x.phone.replace(/\D/g, "")); const rec = { ...x, role: x.role.toLowerCase() }; if (same) Object.assign(same, rec); else l.unshift({ ...rec, id: `c${Date.now().toString(36)}${i}` }); }); });
  const F = (k, label, ph) => <Field label={label} optional={!["name", "phone"].includes(k)}><Input value={ed[k] || ""} placeholder={ph} onChange={(e) => setEd({ ...ed, [k]: e.target.value })} /></Field>;
  return (
    <section className="card pf-panel">
      <div className="pf-panel-head"><div className="pf-panel-title"><h2>Customers</h2><span>People named in your agreements. Details fill in when you pick them in a new agreement.</span></div>
        <div className="pf-panel-actions"><DataActions kind="customers" size="sm" rows={contacts.map((c) => ({ ...c, role: cap(c.role) }))} onImport={importC} /><Button size="sm" icon="user-plus" onClick={() => setEd(blank())}>Add customer</Button></div></div>
      {contacts.length > 0 && <div className="pf-pad-x" style={{ paddingBottom: 12 }}><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone or citizenship no" /></div>}
      <Table rows={rows} onRowClick={(c) => setEd({ ...c })} minWidth={720}
        empty={contacts.length ? <Empty title="No customer matches"><Button variant="outline" onClick={() => setQ("")}>Clear search</Button></Empty> : <Empty icon="users" title="No customers yet" action={<Button icon="user-plus" onClick={() => setEd(blank())}>Add customer</Button>}>Add buyers, sellers, landlords and tenants once, then reuse them in every agreement.</Empty>}
        columns={[
          { key: "name", label: "Name", render: (c) => <span className="pf-two"><b>{c.name}</b><small>{cap(c.role) || "No role"}</small></span> },
          { key: "phone", label: "Phone", num: true, render: (c) => c.phone || "—" },
          { key: "cz", label: "Citizenship no", num: true, render: (c) => c.citizenship || "—" },
          { key: "addr", label: "Address", render: (c) => <span className="small">{c.address || "—"}</span> },
          { key: "n", label: "Agreements", num: true, align: "right", render: (c) => uses(c.id) || "—" },
        ]} />
      <Drawer open={!!ed} onClose={() => setEd(null)} title={ed?.id ? ed.name || "Customer" : "Add customer"} sub={ed?.id ? `In ${uses(ed.id)} agreements` : "Saved for use in agreements"}
        footer={ed && <>{ed.id && <Button variant="ghost" className="pf-danger pf-foot-left" icon="trash-2" disabled={uses(ed.id) > 0} title={uses(ed.id) ? "Named in an agreement, so it can't be deleted" : undefined} onClick={() => setDel(ed)}>Delete</Button>}<Button variant="outline" onClick={() => setEd(null)}>Cancel</Button><Button disabled={!ed.name.trim() || !ed.phone.trim()} onClick={save}>Save</Button></>}>
        {ed && <div className="pf-stack">
          {F("name", "Full name", "As on the citizenship")}
          <Field label="Role"><div className="pf-chips">{ROLES.map((r) => <button key={r} type="button" className={`chip ${ed.role === r ? "active" : ""}`} onClick={() => setEd({ ...ed, role: r })}>{cap(r)}</button>)}</div></Field>
          <div className="pf-grid-2 tight">{F("phone", "Phone", "98XXXXXXXX")}{F("citizenship", "Citizenship no", "27-01-74-01234")}</div>
          <div className="pf-grid-2 tight">{F("father", "Father's name")}{F("grandfather", "Grandfather's name")}</div>
          <div className="pf-grid-2 tight">{F("district", "District")}{F("address", "Address", "Ward and municipality")}</div>
          {ed.id && uses(ed.id) > 0 && <p className="pf-hint">Named in {uses(ed.id)} agreements. Changes show on drafts; signed agreements keep the details they were signed with.</p>}
        </div>}
      </Drawer>
      <DeleteConfirm item={del} name={del?.name} what="customer" onClose={() => setDel(null)}
        onDelete={(x) => { setC((l) => { l.splice(l.findIndex((c) => c.id === x.id), 1); }); setEd(null); }} onRestore={(x) => setC((l) => { restoreAt(l, x, 0); })} />
    </section>
  );
}

function Deadline({ d }) {
  const t = useT();
  const n = daysFromToday(d);
  return <span className={n < 0 ? "pf-tone-action" : n <= 14 ? "pf-tone-action" : undefined}>{fdate(d)}<small className="pf-sub-line">{n < 0 ? t("ag.overdue", { n: -n }) : t("ag.inDays", { n })}</small></span>;
}

function AgreementDetail({ a, tenant, who, contacts, onDoc }) {
  const t = useT();
  const T = TEMPLATES[a.template];
  const steps = STATUS_FLOW.map((s, i) => ({ s, done: STATUS_FLOW.indexOf(a.status) >= i }));
  return (
    <div className="pf-stack">
      <ol className="pf-steps-h">{steps.map(({ s, done }) => <li key={s} className={done ? "done" : ""}><span>{done ? <Icon name="check" size={12} /> : null}</span>{t(`status.${s}`)}</li>)}</ol>
      <div className="pf-sign-list">
        {T.parties.map((p, i) => {
          const key = i === 0 ? "first" : "second";
          const signed = a.signed?.[key];
          return (
            <div key={p}><span className="pf-two"><b>{who(a.parties[key])}</b><small>{t(`ag.p_${p}`)}</small></span>
              {signed ? <Badge tone="done" icon="pen-line">{t("ag.signedAt", { at: fdatetime(signed) })}</Badge> : <Badge tone="action">{t("ag.waiting")}</Badge>}</div>
          );
        })}
      </div>
      <div className="pf-chips"><LinkChip to="/business/listings" icon="house">{a.listingId || "—"}</LinkChip><LinkChip to="/business/inbox" icon="message-circle">{t("ag.messageParties")}</LinkChip><LinkChip to="/business/invoices" icon="receipt">{t("ag.invoiceIt")}</LinkChip></div>
      <DocPreview a={a} tenant={tenant} contacts={contacts} />
      <div className="pf-fb">
        <div className="pf-fb-label"><b>{t("ag.checklist")}</b><span className="small muted tnum">{Object.values(a.docs).filter(Boolean).length}/{T.docs.length}</span></div>
        <div className="pf-docs">
          {T.docs.map((k) => (
            <div key={k} className={a.docs[k] ? "on" : ""}><Icon name={a.docs[k] ? "file-check" : "file-text"} size={18} /><span>{t(`doc.${k}`)}</span>
              {a.docs[k] ? <Badge tone="done">{t("wiz.uploaded")}</Badge> : <label className="btn btn-outline btn-sm"><input type="file" hidden onChange={() => onDoc(k)} /><Icon name="upload" size={14} />{t("wiz.upload")}</label>}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Bilingual document preview built from the filled values.
function DocPreview({ a, tenant, contacts }) {
  const t = useT();
  const lang = useLang();
  const c = (id) => contacts.find((x) => x.id === id) || {};
  const p1 = c(a.parties.first), p2 = c(a.parties.second);
  const bs = toBS(a.deadline);
  const person = (p) => p.name ? `${p.address} निवासी, ${p.grandfather} को नाति, ${p.father} को छोरा/छोरी, ना.प्र.नं. ${p.citizenship} (${p.district}) भएका ${p.name}` : "—";
  return (
    <article className="pf-doc" lang={lang === "ne" ? "ne" : "en"}>
      <header><b>{t(`ag.t_${a.template}`)}</b><span className="tnum">{a.id}</span></header>
      {a.template === "baina" && <>
        <p className="ne">लिखितम् {person(p1)} (पहिलो पक्ष, बिक्रेता) र {person(p2)} (दोस्रो पक्ष, खरिदकर्ता) बीच तपसिलको जग्गा/घर खरिद बिक्री गर्न मञ्जुर भई बैनाबापत {rs(a.amount)} बुझिलिएको।</p>
        <ul>
          <li>{t("ag.doc_total")}: <b className="tnum">{rs(a.total)}</b></li>
          <li>{t("ag.doc_baina")}: <b className="tnum">{rs(a.amount)}</b></li>
          <li>{t("ag.doc_regBy")}: <b className="tnum">{fdate(a.deadline)}{bs ? ` (वि.सं. ${bs})` : ""}</b></li>
          <li>{t("ag.doc_rule")}</li>
        </ul>
      </>}
      {a.template === "rent" && <>
        <p className="ne">घरधनी {p1.name || "—"} र भाडावाल {p2.name || "—"} बीच मासिक भाडा {rs(a.amount)} र धरौटी {rs(a.deadline ? a.deposit || 0 : 0)} मा घर भाडा सम्झौता गरिएको।</p>
        <ul><li>{t("ag.doc_rent")}: <b className="tnum">{rs(a.amount)}</b></li><li>{t("ag.doc_deposit")}: <b className="tnum">{rs(a.deposit || 0)}</b></li><li>{t("ag.doc_until")}: <b className="tnum">{fdate(a.deadline)}{bs ? ` (वि.सं. ${bs})` : ""}</b></li><li>{t("ag.doc_rentTax")}</li></ul>
      </>}
      {!["baina", "rent"].includes(a.template) && <p>{t("ag.doc_generic", { party: p1.name || "—", amount: a.template === "commission" ? `${a.amount}%` : rs(a.amount), date: fdate(a.deadline) })}</p>}
      <div className="pf-doc-sign">
        <span>{t("ag.firstParty")}<i>{a.signed?.first ? "✓" : ""}</i></span><span>{t("ag.secondParty")}<i>{a.signed?.second ? "✓" : ""}</i></span><span>{t("ag.witness")} 1</span><span>{t("ag.witness")} 2</span>
      </div>
      <footer className="pf-legal-slot"><b>{t("ag.legalSlot")}</b> {t("ag.legalSlotText")}</footer>
    </article>
  );
}

function AgreementCreate({ tenant, start, available, onClose, onCreate }) {
  const t = useT();
  const { db } = useStore();
  const contacts = db.contacts[tenant.id] || [];
  const listings = db.listings.filter((l) => l.tenantId === tenant.id);
  const [step, setStep] = useState(start ? 1 : 0);
  const [f, setF] = useState({ template: start || available[0], first: contacts[0]?.id, second: contacts[1]?.id, listingId: listings[0]?.id, amount: 1500000, total: 32000000, deposit: 90000, days: 30, rule: "double", increase: "5", lang: "both" });
  const T = TEMPLATES[f.template];
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const deadline = new Date(new Date(TODAY).getTime() + f.days * 864e5).toISOString().slice(0, 10);
  const steps = ["template", "parties", "terms"];
  const create = () => onCreate({
    id: `AG-2027-${String(30 + Math.floor(Math.random() * 60)).padStart(4, "0")}`, template: f.template,
    title: `${t(`ag.t_${f.template}`)} · ${listings.find((l) => l.id === f.listingId)?.title || tenant.name}`, listingId: f.listingId,
    parties: { first: f.first, second: T.parties.length > 1 ? f.second : undefined }, amount: f.amount, total: f.total, deposit: f.deposit,
    deadline, status: "draft", created: TODAY.slice(0, 10), signed: {}, docs: {},
  });
  return (
    <Drawer open onClose={onClose} title={t("ag.new")} sub={t("wiz.stepOf", { a: step + 1, b: steps.length })}
      footer={<><Button variant="outline" disabled={step === 0} onClick={() => setStep(step - 1)}>{t("common.back")}</Button>
        {step < steps.length - 1 ? <Button onClick={() => setStep(step + 1)}>{t("common.continue")}</Button> : <Button icon="file-check" onClick={create}>{t("ag.createDraft")}</Button>}</>}>
      {step === 0 && <div className="pf-tiles big">{available.map((k) => (
        <button key={k} type="button" className={f.template === k ? "on" : ""} onClick={() => set("template", k)}><Icon name={TEMPLATES[k].icon} size={22} /><span>{t(`ag.t_${k}`)}</span></button>
      ))}</div>}
      {step === 1 && <div className="pf-stack">
        {T.parties.map((p, i) => (
          <Field key={p} label={t(`ag.p_${p}`)}>
            <div className="pf-chips">{contacts.map((c) => { const k = i === 0 ? "first" : "second"; return (
              <button key={c.id} type="button" className={`chip ${f[k] === c.id ? "active" : ""}`} onClick={() => set(k, c.id)}><Icon name="user" size={14} />{c.name}</button>
            ); })}<button type="button" className="chip"><Icon name="user-plus" size={14} />{t("ag.addPerson")}</button></div>
          </Field>
        ))}
        <Field label={t("ag.property")}>
          <Select value={f.listingId || ""} onChange={(v) => set("listingId", v)} options={[...listings.map((l) => ({ id: l.id, label: `${l.id} · ${l.title}` })), { id: "", label: t("ag.noListing") }]} />
        </Field>
        <p className="pf-hint"><Icon name="info" size={13} />{t("ag.partiesHint")}</p>
      </div>}
      {step === 2 && <div className="pf-stack">
        {f.template === "baina" && <>
          <Field label={t("ag.doc_total")}><Input className="input tnum" value={f.total.toLocaleString("en-IN")} onChange={(e) => set("total", Number(e.target.value.replace(/\D/g, "")))} /></Field>
          <Field label={t("ag.doc_baina")} hint={rsShort(f.amount)}>
            <div className="pf-chips">{[0.05, 0.1, 0.2].map((p) => <button key={p} type="button" className={`chip ${f.amount === Math.round(f.total * p) ? "active" : ""}`} onClick={() => set("amount", Math.round(f.total * p))}>{p * 100}% · {rsShort(f.total * p)}</button>)}</div>
          </Field>
          <Field label={t("ag.ruleField")}><Seg value={f.rule} onChange={(v) => set("rule", v)} options={[{ id: "double", label: t("ag.rule_double") }, { id: "same", label: t("ag.rule_same") }, { id: "custom", label: t("ag.rule_custom") }]} /></Field>
        </>}
        {f.template === "rent" && <>
          <Field label={t("ag.doc_rent")}><Input className="input tnum" value={f.amount.toLocaleString("en-IN")} onChange={(e) => set("amount", Number(e.target.value.replace(/\D/g, "")))} /></Field>
          <Field label={t("ag.doc_deposit")}><div className="pf-chips">{[1, 2, 3].map((m) => <button key={m} type="button" className={`chip ${f.deposit === f.amount * m ? "active" : ""}`} onClick={() => set("deposit", f.amount * m)}>{t("ag.months", { n: m })}</button>)}</div></Field>
          <Field label={t("ag.increase")}><Seg value={f.increase} onChange={(v) => set("increase", v)} options={["0", "5", "10"].map((x) => ({ id: x, label: `${x}%` }))} /></Field>
        </>}
        {!["baina", "rent"].includes(f.template) && <Field label={t("ag.amount")}><Input className="input tnum" value={f.amount.toLocaleString("en-IN")} onChange={(e) => set("amount", Number(e.target.value.replace(/\D/g, "")))} /></Field>}
        <Field label={f.template === "rent" ? t("ag.termDays") : t("ag.deadline")} hint={`${fdate(deadline)}${toBS(deadline) ? ` · वि.सं. ${toBS(deadline)}` : ""}`}>
          <Counter value={f.days} min={1} max={1095} onChange={(v) => set("days", v)} label={t("ag.deadline")} />
          <div className="pf-chips">{[15, 30, 45, 90, 365].map((d) => <button key={d} type="button" className={`chip ${f.days === d ? "active" : ""}`} onClick={() => set("days", d)}>{t("ag.days", { n: d })}</button>)}</div>
        </Field>
        <Field label={t("ag.langField")}><Seg value={f.lang} onChange={(v) => set("lang", v)} options={[{ id: "ne", label: "नेपाली" }, { id: "en", label: "English" }, { id: "both", label: t("ag.both") }]} /></Field>
      </div>}
    </Drawer>
  );
}
