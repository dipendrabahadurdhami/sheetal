// Online forms on the business API (Business → Forms, when signed in).
// Where it fits: the /business/forms routes for a live business (the sample screens are Forms.jsx). The public page
// people fill in is on the website (/f/<slug>, website/frontend/src/pages/PublicForm.jsx).
// How it works: the list shows templates for the business type and the business's forms with their response counts;
// a new form is made from a template and saved on the server straight away. The builder (BuilderCore in Forms.jsx)
// saves a moment after each change; Publish makes the link work, Unpublish closes it. Responses come from the server
// with their files and payment screenshots; payments are confirmed or rejected here; CSV comes from the server.
// Rules: the server checks everything (limits, fields, who gets the leads); nothing is kept in the browser.

import React, { useCallback, useEffect, useState } from "react";
import { useBranch } from "@sheetal/shared/core/branch";
import { useStore } from "@sheetal/shared/core/store";
import { useRouter, Link } from "@sheetal/shared/core/router";
import { fdatetime, rs } from "@sheetal/shared/core/format";
import { Badge, Button, Drawer, Empty, Field, Input, Modal, PageHead, Panel, Select, Table, Tabs, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { CATALOG } from "@sheetal/shared/data/catalog";
import { DESTS, DEST_LABEL, FIELD_TYPES, formFromTemplate, templatesFor } from "@sheetal/shared/core/forms";
import { BuilderCore } from "./Forms";
import { defaultTenantSettings } from "./BusinessSettings";
import { bizApi } from "../api";

const TYPE_WORD = { hotel: "hotels", host: "hosts", developer: "developers", agency: "agencies", sponsor: "investment sponsors" };
const PAY_TONE = { to_confirm: ["action", "To confirm"], confirmed: ["done", "Confirmed"], rejected: ["problem", "Rejected"] };
const DEST_TONE = { leads: "progress", jobs: "neutral", requirements: "action" };
const DEST_ICON = { leads: "messages-square", jobs: "briefcase", requirements: "house" };
const bodyOf = (f) => ({ title: f.title || "Untitled form", desc: f.desc || "", tpl: f.tpl ?? null, slug: f.slug, fields: f.fields, dest: f.dest, thanks: f.thanks || "", style: f.style || {}, places: f.places || {}, pay: f.pay || {} });
const openBlob = (blob) => window.open(URL.createObjectURL(blob), "_blank", "noopener");
const saveBlob = (blob, name) => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };

function useLoad(path, tenantId) {
  const br = useBranch();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let gone = false;
    bizApi("GET", path).then((r) => { if (!gone) setData(r); }).catch((e) => { if (!gone) { setData((d) => d || false); toast(e.message); } });
    return () => { gone = true; };
  }, [path, tenantId, br?.branch, tick]);
  return [data, useCallback(() => setTick((n) => n + 1), [])];
}

export function LiveForms({ tenant, view = "list", id, dest }) {
  if (view === "build") return <LiveBuilder key={id} tenant={tenant} id={id} />;
  if (view === "responses") return <LiveResponses tenant={tenant} dest={dest || "all"} />;
  return <LiveList tenant={tenant} />;
}

function LimitNote({ limits }) {
  if (!limits || (limits.forms === -1 && limits.responses === -1)) return null;
  return <span className="small muted tnum">{limits.free ? "Free plan · " : ""}{limits.used} of {limits.forms === -1 ? "unlimited" : limits.forms} forms · {limits.monthResponses} of {limits.responses === -1 ? "unlimited" : limits.responses} responses this month</span>;
}

function LiveList({ tenant }) {
  const { db } = useStore();
  const { navigate } = useRouter();
  const toast = useToast();
  const [res, reload] = useLoad("/forms", tenant.id);
  const [share, setShare] = useState(null);
  const [busy, setBusy] = useState(false);
  const tpls = templatesFor(tenant.type);
  const d = res?.data;
  const ts = db.tenantSettings[tenant.id] || defaultTenantSettings(tenant);
  const create = (key) => {
    const f = formFromTemplate(key, tenant, ts);
    setBusy(true);
    bizApi("POST", "/forms", bodyOf(f)).then((r) => navigate(`/business/forms/${r.data.id}`)).catch((e) => { toast(e.message); if (/plan/i.test(e.message)) navigate("/business/billing"); }).finally(() => setBusy(false));
  };
  const act = (f, what) => {
    if (what === "delete" && !window.confirm(`Remove ${f.title}${f.responses ? ` and its ${f.responses} responses` : ""}? Its leads stay in the Inbox.`)) return;
    bizApi(what === "delete" ? "DELETE" : "POST", what === "delete" ? `/forms/${f.id}` : `/forms/${f.id}/${what}`).then((r) => { toast(r.message); if (what === "publish") setShare(f); reload(); }).catch((e) => toast(e.message));
  };
  return (
    <>
      <PageHead title="Forms" sub={`Start from a template made for ${TYPE_WORD[tenant.type] || "your business"}, or build your own by dragging fields in. Every answer comes into your Inbox as a lead.`}
        actions={<><LimitNote limits={d?.limits} /><Button variant="outline" icon="inbox" onClick={() => navigate("/business/forms/responses")}>Responses</Button><Button icon="plus" disabled={busy} onClick={() => create(null)}>Blank form</Button></>} />
      <div className="pf-stack">
        <section className="pf-stack tight">
          <h2 className="fb-h2">Start from a template</h2>
          <div className="fb-tpls">{tpls.map(([k, icon, name, desc, dst, , mk]) => (
            <button key={k} type="button" className="card fb-tpl" disabled={busy} onClick={() => create(k)}>
              <span className="fb-tpl-ico"><Icon name={icon} size={22} /></span><b>{name}</b><span className="small muted">{desc}</span>
              <span className="fb-tpl-foot small"><span className="muted tnum">{mk(tenant.type).filter((x) => !FIELD_TYPES[x.type].noAnswer).length} fields</span><span className="fb-accent">Goes to {DEST_LABEL[dst]}</span></span>
            </button>
          ))}</div>
        </section>
        <Panel title="Your forms">
          <Table rows={d?.forms || []} minWidth={820} onRowClick={(f) => navigate(`/business/forms/${f.id}`)}
            empty={<div className="pf-pad"><Empty icon="file-text" title={res === null ? "Loading…" : "No forms yet"}>{res === null ? null : "Pick a template above or start with a blank form."}</Empty></div>}
            columns={[
              { key: "title", label: "Form", render: (f) => { const tp = tpls.find((x) => x[0] === f.tpl); return <span className="pf-person"><span className="fb-row-ico"><Icon name={tp?.[1] || "file-text"} size={17} /></span><span className="pf-two"><b>{f.title}</b><small className="pf-ellipsis">{f.url.replace(/^https?:\/\//, "")}</small></span></span>; } },
              { key: "n", label: "Responses", num: true, render: (f) => f.responses },
              { key: "dest", label: "Goes to", render: (f) => <span className="small">{DEST_LABEL[f.dest]}{f.assigneeName ? ` · ${f.assigneeName}` : ""}</span> },
              { key: "status", label: "Status", render: (f) => f.status === "live" ? <Badge tone="done">Live</Badge> : <Badge tone="neutral">Draft</Badge> },
              { key: "act", label: "", align: "right", render: (f) => <div className="pf-row-actions" onClick={(e) => e.stopPropagation()}>
                <Button size="sm" variant="outline" onClick={() => navigate(`/business/forms/${f.id}`)}>Edit</Button>
                {f.status === "live" ? <Button size="sm" variant="light" icon="send" onClick={() => setShare(f)}>Share</Button> : <Button size="sm" variant="light" icon="send" onClick={() => act(f, "publish")}>Publish</Button>}
                <Button size="sm" variant="ghost" icon="trash-2" aria-label={`Remove ${f.title}`} onClick={() => act(f, "delete")} />
              </div> },
            ]} />
        </Panel>
      </div>
      {share && <ShareModal form={share} onClose={() => setShare(null)} />}
    </>
  );
}

function ShareModal({ form, onClose }) {
  const toast = useToast();
  const [copied, setCopied] = useState("");
  const url = form.url;
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=480x480&margin=12&data=${encodeURIComponent(url)}`;
  const embed = `<iframe src="${url}" width="100%" height="900" style="border:0" title="${form.title.replace(/"/g, "")}"></iframe>`;
  const copy = (text, what) => { try { navigator.clipboard.writeText(text); } catch { /* clipboard off */ } setCopied(what); toast(what === "embed" ? "Embed code copied" : "Link copied"); };
  return (
    <Modal open onClose={onClose} title="Your form is live">
      <div className="pf-stack">
        <Field label="Link" hint="Anyone with the link can answer. Answers come into your Inbox.">
          <div className="fb-copy"><Input readOnly value={url} onFocus={(e) => e.target.select()} /><Button onClick={() => copy(url, "link")}>{copied === "link" ? "Copied" : "Copy"}</Button></div>
        </Field>
        <div className="fb-qr">
          <img src={qr} alt={`QR code for ${form.title}`} width="132" height="132" />
          <div className="pf-stack tight"><span className="small muted">Print it on a flyer or show it at the front desk.</span>
            <a className="btn btn-outline btn-sm" href={qr} target="_blank" rel="noreferrer" download={`${form.slug}-qr.png`}><Icon name="download" size={15} />Download QR</a>
            <a href={url} className="btn btn-ghost btn-sm" target="_blank" rel="noreferrer"><Icon name="external-link" size={15} />Open form</a></div>
        </div>
        <div className="fb-share">
          <a className="btn fb-fb" href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`} target="_blank" rel="noreferrer"><Icon name="facebook" size={16} />Facebook</a>
          <a className="btn fb-wa" href={`https://wa.me/?text=${encodeURIComponent(`${form.title}: ${url}`)}`} target="_blank" rel="noreferrer"><Icon name="message-circle" size={16} />WhatsApp</a>
          <Button variant="outline" icon="code" onClick={() => copy(embed, "embed")}>{copied === "embed" ? "Copied" : "Embed"}</Button>
        </div>
      </div>
    </Modal>
  );
}

function LiveBuilder({ tenant, id }) {
  const { db } = useStore();
  const { navigate } = useRouter();
  const toast = useToast();
  const [res] = useLoad(`/forms/${id}`, tenant.id);
  const [share, setShare] = useState(null);
  const [status, setStatus] = useState(null);
  if (res === null) return <p className="muted pf-pad">Loading…</p>;
  if (!res) return <section className="card pf-empty-card"><Empty icon="file-text" title="Form not found" action={<Button onClick={() => navigate("/business/forms")}>All forms</Button>} /></section>;
  const form = res.data;
  const site = form.url.slice(0, form.url.length - `/f/${form.slug}`.length);
  const team = (db.members[tenant.id] || []).filter((m) => m.id);
  const ts = db.tenantSettings[tenant.id] || defaultTenantSettings(tenant);
  const live = (status ?? form.status) === "live";
  return (
    <>
      <BuilderCore tenant={tenant} initial={form} ts={ts} districts={CATALOG.districts}
        linkOf={(f) => ({ url: `${site}/f/${f.slug}`, local: `${site}/f/${f.slug}`, host: site.replace(/^https?:\/\//, "") })}
        onSave={(f) => bizApi("PUT", `/forms/${id}`, bodyOf(f)).then((r) => r.data)}
        onPublish={(f) => bizApi("POST", `/forms/${id}/publish`).then((r) => { setStatus("live"); setShare({ ...f, url: r.data.url }); return true; }).catch((e) => { toast(e.message); return false; })}
        barExtra={live ? <Button variant="outline" size="sm" icon="circle-pause" onClick={() => bizApi("POST", `/forms/${id}/unpublish`).then((r) => { toast(r.message); setStatus("draft"); }).catch((e) => toast(e.message))}>Unpublish</Button> : null}
        settingsExtra={<AssigneeField form={form} team={team} />} />
      {share && <ShareModal form={share} onClose={() => setShare(null)} />}
    </>
  );
}

// Who gets the leads. Saved on its own, straight away.
function AssigneeField({ form, team }) {
  const toast = useToast();
  const [v, setV] = useState(form.assignee || "");
  const pick = (next) => {
    const prev = v; setV(next);
    bizApi("PATCH", `/forms/${form.id}/assignee`, { assignee: next || null })
      .then(() => toast(next ? "New leads go to them." : "New leads stay unassigned."))
      .catch((e) => { setV(prev); toast(e.message); });
  };
  return (
    <Field label="New leads go to" hint="They get a notification and an email for each answer. Without anyone picked, leads wait unassigned in the Inbox.">
      <Select value={v} onChange={pick} options={[{ id: "", label: "Unassigned" }, ...team.map((m) => ({ id: m.id, label: m.name }))]} aria-label="New leads go to" />
    </Field>
  );
}

function LiveResponses({ tenant, dest }) {
  const { navigate } = useRouter();
  const toast = useToast();
  const tab = DESTS.some(([d]) => d === dest) ? dest : "all";
  const [formId, setFormId] = useState("");
  const [forms] = useLoad("/forms", tenant.id);
  const [res, reload] = useLoad(`/forms/responses?dest=${tab}${formId ? `&formId=${formId}` : ""}`, tenant.id);
  const [open, setOpen] = useState(null);
  const rows = res?.data || [];
  const cur = rows.find((r) => r.id === open);
  const list = (forms?.data?.forms || []).filter((f) => tab === "all" || f.dest === tab);
  const setPay = (r, pay) => {
    if (pay === "confirmed" && !window.confirm(`Confirm ${rs(r.pay.amount)} from ${r.name}? Check the money is in your account first.`)) return;
    bizApi("PATCH", `/forms/responses/${r.id}`, { pay }).then((x) => { toast(x.message); reload(); }).catch((e) => toast(e.message));
  };
  const file = (r, f) => bizApi("GET", `/forms/responses/${r.id}/files/${f.file}`).then(openBlob).catch((e) => toast(e.message));
  const csv = () => bizApi("GET", `/forms/responses.csv?dest=${tab}${formId ? `&formId=${formId}` : ""}`).then((b) => saveBlob(b, `form-responses-${new Date().toISOString().slice(0, 10)}.csv`)).catch((e) => toast(e.message));
  return (
    <>
      <PageHead title="Responses" sub="Every answer is also a lead in your Inbox. Requirement answers show the listings that match."
        back={<Link to="/business/forms" className="fb-back"><Icon name="arrow-left" size={16} />Forms</Link>}
        actions={<><LimitNote limits={forms?.data?.limits} /><Button variant="outline" icon="download" disabled={!rows.length} onClick={csv}>CSV</Button></>} />
      <Tabs value={tab} onChange={(v) => { setFormId(""); navigate(v === "all" ? "/business/forms/responses" : `/business/forms/responses/${v}`); }}
        tabs={[{ id: "all", label: "All" }, ...DESTS.map(([id]) => ({ id, label: DEST_LABEL[id] }))]} />
      {list.length > 1 && <div className="pf-row-actions" style={{ justifyContent: "flex-start", marginBottom: 12 }}>
        <Select value={formId} onChange={setFormId} options={[{ id: "", label: "All forms" }, ...list.map((f) => ({ id: f.id, label: f.title }))]} aria-label="Form" />
      </div>}
      <Panel>
        <Table rows={rows} minWidth={860} onRowClick={(r) => setOpen(r.id)}
          empty={<div className="pf-pad"><Empty icon="inbox" title={res === null ? "Loading…" : "No responses yet"}>{res === null ? null : "Share a form to start getting answers here."}</Empty></div>}
          columns={[
            { key: "who", label: "From", render: (r) => <span className="pf-two"><b>{r.name}</b><small className="tnum">{[r.phone, fdatetime(r.at)].filter(Boolean).join(" · ")}</small></span> },
            { key: "sum", label: "Answers", render: (r) => <span className="pf-two"><span className="small">{r.summary}</span><small className="muted">{r.formTitle}</small></span> },
            { key: "dest", label: "Goes to", render: (r) => <Badge tone={DEST_TONE[r.dest]} icon={DEST_ICON[r.dest]}>{r.dest === "leads" ? "Lead" : r.dest === "jobs" ? "Job application" : "Requirement"}</Badge> },
            { key: "pay", label: "Payment", render: (r) => r.pay ? <span className="pf-two"><Badge tone={PAY_TONE[r.pay.status][0]}>{PAY_TONE[r.pay.status][1]}</Badge><small className="tnum">{rs(r.pay.amount)}</small></span> : <span className="small muted">No payment</span> },
            { key: "act", label: "", align: "right", render: (r) => <div className="pf-row-actions" onClick={(e) => e.stopPropagation()}>
              {r.pay?.status === "to_confirm" ? <><Button size="sm" icon="check" onClick={() => setPay(r, "confirmed")}>Confirm</Button><Button size="sm" variant="outline" onClick={() => setPay(r, "rejected")}>Reject</Button></>
                : <Button size="sm" variant="outline" onClick={() => setOpen(r.id)}>Open</Button>}</div> },
          ]} />
      </Panel>
      <Drawer open={!!cur} onClose={() => setOpen(null)} title={cur?.name || ""} sub={cur ? `${cur.formTitle} · ${fdatetime(cur.at)}` : ""}
        footer={cur && <>{cur.leadId && <Button variant="outline" icon="messages-square" onClick={() => navigate("/business/inbox")}>Open in Inbox</Button>}
          {cur.phone && <a className="btn btn-outline" href={`tel:${cur.phone}`}><Icon name="phone" size={16} />Call</a>}
          {cur.pay?.status === "to_confirm" && <><Button variant="outline" onClick={() => setPay(cur, "rejected")}>Reject</Button><Button icon="check" onClick={() => setPay(cur, "confirmed")}>Confirm payment</Button></>}</>}>
        {cur && <div className="pf-stack">
          <dl className="pf-kv fb-answers">{cur.answers.map(([q, a], i) => <React.Fragment key={i}><dt>{q}</dt><dd>{a}</dd></React.Fragment>)}</dl>
          {cur.files.length > 0 && <div className="pf-stack tight">{cur.files.map((f) => <Button key={f.file} variant="outline" icon="paperclip" onClick={() => file(cur, f)}>{f.label}: {f.name}</Button>)}</div>}
          {cur.pay && <div className="pf-note"><Icon name="qr-code" size={16} /><span>{rs(cur.pay.amount)} by QR, eSewa or bank. Status: {PAY_TONE[cur.pay.status][1]}. Open the screenshot above and check the money arrived before confirming.</span></div>}
        </div>}
      </Drawer>
    </>
  );
}
