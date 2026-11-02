import React, { useState } from "react";
import { useT } from "@sheetal/shared/core/i18n";
import { useStore } from "@sheetal/shared/core/store";
import { Badge, Button, Confirm, Drawer, Empty, Field, Input, PageHead, Panel, Select, Table, Tabs, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { emailDnsRecords } from "@sheetal/shared/data/integrations";

// Custom domain + business email on Sheetal's own mail system (Cloudflare Email Routing):
// 1 add domain → 2 detect DNS host from NS records → 3 one-click connect (Cloudflare API) or copy records by hand
// → 4 verify TXT → 5 MX/SPF/DKIM/DMARC checks → 6 add addresses (info@, sales@…) that arrive in Inbox.
// There are no mailboxes to log in to: mail is stored in the database and answered from the dashboard.
const PROVIDERS = {
  cloudflare: { name: "Cloudflare", ns: "ns1.cloudflare.com", auto: true },
  godaddy: { name: "GoDaddy", ns: "ns51.domaincontrol.com", auto: true },
  namecheap: { name: "Namecheap", ns: "dns1.registrar-servers.com", auto: false },
  mercantile: { name: "Mercantile (.com.np)", ns: "ns1.mos.com.np", auto: false },
  other: { name: "Other DNS host", ns: "", auto: false },
};

const PURPOSE = { mx1: "mail", mx2: "mail", mx3: "mail", spf: "spf", dkim: "dkim", dmarc: "dmarc" };
const recordsFor = (domain, code) => [
  { id: "txt", type: "TXT", host: "@", value: `sheetal-verify=${code}`, purpose: "verify" },
  ...emailDnsRecords(domain).map((r) => ({ id: r.id, type: r.type, host: r.host, value: r.prio ? `${r.prio} ${r.value}` : r.value, purpose: PURPOSE[r.id] })),
  { id: "site", type: "CNAME", host: "book", value: "sites.sheetalproperty.com", purpose: "site" },
];

const seedDomain = (tenant) => ({
  name: tenant.email.split("@")[1], provider: "cloudflare", step: "done", code: "8f3k2q",
  checks: { txt: "ok", mx1: "ok", mx2: "ok", mx3: "ok", spf: "ok", dkim: "ok", dmarc: "pending", site: "ok" },
  addresses: [
    { id: "ad1", address: `info@${tenant.email.split("@")[1]}`, name: tenant.name, deliver: "all", forward: "" },
    { id: "ad2", address: `reservations@${tenant.email.split("@")[1]}`, name: "Reservations", deliver: "m3", forward: "" },
    { id: "ad3", address: `accounts@${tenant.email.split("@")[1]}`, name: "Accounts", deliver: "m7", forward: "kiran@ledgerworks.com.np" },
  ],
});

export function Domains({ tenant }) {
  const t = useT();
  const { db, update } = useStore();
  const toast = useToast();
  const saved = db.domains?.[tenant.id];
  // Older saved data used `mailboxes`; read either.
  const raw = saved === undefined ? (tenant.id === "t1" ? seedDomain(tenant) : null) : saved;
  const dom = raw && !raw.addresses ? { ...raw, addresses: (raw.mailboxes || []).map((m) => ({ id: m.id, address: m.address, name: m.name, deliver: "all", forward: m.forward || "" })) } : raw;
  const save = (v) => update((d) => { d.domains = d.domains || {}; d.domains[tenant.id] = v; });
  const [tab, setTab] = useState("domain");
  const [adding, setAdding] = useState(false);

  if (!dom || dom.step !== "done") return (
    <>
      <PageHead title={t("dom.title")} sub={t("dom.sub")} />
      {!dom && !adding ? (
        <section className="card pf-empty-card"><Empty icon="globe" title={t("dom.emptyTitle")} action={<Button icon="plus" onClick={() => setAdding(true)}>{t("dom.add")}</Button>}>{t("dom.emptyText")}</Empty></section>
      ) : <ConnectFlow dom={dom} onChange={save} onCancel={() => { save(null); setAdding(false); }} />}
    </>
  );

  const recs = recordsFor(dom.name, dom.code);
  const okCount = Object.values(dom.checks).filter((c) => c === "ok").length;
  return (
    <>
      <PageHead title={t("dom.title")} sub={dom.name} actions={<Button variant="outline" icon="refresh-cw" onClick={() => { save({ ...dom, checks: { ...dom.checks, dmarc: "ok" } }); toast(t("dom.toastChecked")); }}>{t("dom.recheck")}</Button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "domain", label: t("dom.tabDomain"), icon: "globe" }, { id: "mail", label: "Email addresses", icon: "mail", count: dom.addresses.length }]} />
      {tab === "domain" && <>
        <div className="pf-stats">
          <div className="card pf-stat"><span>{t("dom.status")}</span><b style={{ fontSize: 18 }}><Badge tone="done">{t("dom.verified")}</Badge></b><small>{PROVIDERS[dom.provider].name}</small></div>
          <div className="card pf-stat"><span>{t("dom.records")}</span><b className="tnum">{okCount} / {recs.length}</b><small>{okCount === recs.length ? t("dom.allGood") : t("dom.someWaiting")}</small></div>
          <div className="card pf-stat"><span>{t("dom.bookingSite")}</span><b style={{ fontSize: 16 }} className="tnum">book.{dom.name}</b><small>{t("dom.sslOn")}</small></div>
        </div>
        <RecordTable recs={recs} checks={dom.checks} t={t} />
        <div className="pf-danger-zone"><div><b>{t("dom.remove")}</b><span className="small muted">{t("dom.removeText")}</span></div><Button variant="outline" className="pf-danger" onClick={() => save(null)}>{t("dom.remove")}</Button></div>
      </>}
      {tab === "mail" && <Addresses dom={dom} onChange={save} members={db.members?.[tenant.id] || []} />}
    </>
  );
}

function ConnectFlow({ dom, onChange, onCancel }) {
  const t = useT();
  const [name, setName] = useState(dom?.name || "");
  const [checking, setChecking] = useState(false);
  const d = dom || { step: "enter" };
  const detect = () => {
    const n = name.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(n)) return;
    const provider = n.endsWith(".np") ? "mercantile" : n.length % 2 ? "cloudflare" : "godaddy";
    onChange({ name: n, provider, step: "connect", code: Math.random().toString(36).slice(2, 8), checks: {}, addresses: [] });
  };
  const recs = dom ? recordsFor(dom.name, dom.code) : [];
  const verify = () => { setChecking(true); setTimeout(() => { setChecking(false); onChange({ ...d, step: "done", checks: Object.fromEntries(recs.map((r) => [r.id, r.id === "dmarc" ? "pending" : "ok"])) }); }, 1200); };
  const steps = ["enter", "connect", "verify"];
  const at = steps.indexOf(d.step);
  return (
    <section className="card pf-panel">
      <ol className="pf-steps-h pf-pad">{steps.map((s, i) => <li key={s} className={i <= at ? "done" : ""}><span>{i < at ? <Icon name="check" size={12} /> : i + 1}</span>{t(`dom.step_${s}`)}</li>)}</ol>
      <div className="pf-pad pf-stack">
        {d.step === "enter" && <>
          <Field label={t("dom.yourDomain")} hint={t("dom.yourDomainHint")}><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="lakesideretreat.com.np" /></Field>
          <div className="pf-row-actions" style={{ justifyContent: "flex-start" }}><Button onClick={detect}>{t("dom.detect")}</Button><Button variant="ghost" onClick={onCancel}>{t("common.cancel")}</Button><a className="link small" href="#" onClick={(e) => e.preventDefault()}>{t("dom.buy")}</a></div>
        </>}
        {d.step === "connect" && <>
          <div className="pf-note"><Icon name="radar" size={16} />{t("dom.detected", { provider: PROVIDERS[d.provider].name, ns: PROVIDERS[d.provider].ns || "—" })}</div>
          <div className="pf-mode-pick">
            <button type="button" className="on" disabled={!PROVIDERS[d.provider].auto} onClick={() => onChange({ ...d, step: "verify", auto: true })}>
              <Icon name="zap" size={22} /><b>{t("dom.auto", { provider: PROVIDERS[d.provider].name })}</b><span>{PROVIDERS[d.provider].auto ? t("dom.autoSub") : t("dom.autoNo")}</span>
            </button>
            <button type="button" onClick={() => onChange({ ...d, step: "verify", auto: false })}><Icon name="clipboard-copy" size={22} /><b>{t("dom.manual")}</b><span>{t("dom.manualSub")}</span></button>
          </div>
          <Field label={t("dom.wrongHost")}><Select value={d.provider} onChange={(v) => onChange({ ...d, provider: v })} options={Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.name }))} /></Field>
        </>}
        {d.step === "verify" && <>
          <div className="pf-note"><Icon name={d.auto ? "zap" : "info"} size={16} />{d.auto ? t("dom.autoDone", { provider: PROVIDERS[d.provider].name }) : t("dom.manualHelp", { provider: PROVIDERS[d.provider].name })}</div>
          <RecordTable recs={recs} checks={{}} t={t} copy={!d.auto} />
          <div className="pf-row-actions" style={{ justifyContent: "flex-start" }}><Button icon="shield-check" onClick={verify} disabled={checking}>{checking ? t("dom.checking") : t("dom.verify")}</Button><Button variant="ghost" onClick={() => onChange({ ...d, step: "connect" })}>{t("common.back")}</Button></div>
          <p className="pf-hint"><Icon name="clock" size={13} />{t("dom.propagation")}</p>
        </>}
      </div>
    </section>
  );
}

function RecordTable({ recs, checks, t, copy }) {
  const toast = useToast();
  return (
    <section className="card pf-panel">
      <Table rows={recs} minWidth={760} columns={[
        { key: "purpose", label: t("dom.for"), render: (r) => <b className="pf-strong">{t(`dom.p_${r.purpose}`)}</b> },
        { key: "type", label: t("dom.type"), render: (r) => <code>{r.type}</code> },
        { key: "host", label: t("dom.host"), render: (r) => <code>{r.host}</code> },
        { key: "value", label: t("dom.value"), render: (r) => <span className="pf-dns-val"><code>{r.value}</code>{copy && <button className="btn btn-ghost btn-icon" aria-label={t("dom.copy")} onClick={() => { navigator.clipboard?.writeText(r.value); toast(t("dom.copied")); }}><Icon name="copy" size={14} /></button>}</span> },
        { key: "st", label: t("common.status"), render: (r) => !checks[r.id] ? <Badge tone="neutral">{t("dom.notChecked")}</Badge> : checks[r.id] === "ok" ? <Badge tone="done">{t("dom.found")}</Badge> : <Badge tone="progress">{t("dom.waiting")}</Badge> },
      ]} />
    </section>
  );
}

function Addresses({ dom, onChange, members }) {
  const toast = useToast();
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  const deliverLabel = (d) => (d === "all" ? "Inbox (everyone)" : members.find((m) => m.id === d)?.name || "Inbox (everyone)");
  const saveAddress = () => {
    const list = dom.addresses.some((a) => a.id === edit.id) ? dom.addresses.map((a) => (a.id === edit.id ? edit : a)) : [...dom.addresses, edit];
    onChange({ ...dom, addresses: list }); setEdit(null); toast("Address saved");
  };
  return (
    <>
      <div className="pf-note"><Icon name="inbox" size={16} /><span>Mail to these addresses arrives in <b>Inbox → Email</b>. Reply from the dashboard and it goes out from the same address. No separate mailbox or password needed.</span></div>
      <Panel title="Email addresses" sub={`${dom.addresses.length} on ${dom.name}`}
        actions={<Button icon="plus" onClick={() => setEdit({ id: `ad${Date.now()}`, address: "", name: "", deliver: "all", forward: "" })}>Add address</Button>}>
        {dom.addresses.length ? <Table rows={dom.addresses} minWidth={680} onRowClick={(a) => setEdit({ ...a })} columns={[
          { key: "address", label: "Address", render: (a) => <span className="pf-two"><b>{a.address}</b><small>{a.name}</small></span> },
          { key: "deliver", label: "Arrives with", render: (a) => <span className="small">{deliverLabel(a.deliver)}</span> },
          { key: "forward", label: "Also send a copy to", render: (a) => <span className="small">{a.forward || "—"}</span> },
          { key: "act", label: "", align: "right", render: (a) => <button className="btn btn-ghost btn-icon" aria-label="Delete" onClick={(e) => { e.stopPropagation(); setDel(a); }}><Icon name="trash-2" size={15} /></button> },
        ]} /> : <Empty icon="mail" title="No addresses yet">Add info@, sales@ or any address you like.</Empty>}
      </Panel>
      <Drawer open={!!edit} onClose={() => setEdit(null)} title={edit?.address || "Add address"}
        footer={<><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={saveAddress} disabled={!edit?.address || edit.address.startsWith("@")}>Save</Button></>}>
        {edit && <div className="pf-stack">
          <Field label="Address"><div className="pf-unit"><input className="input" value={edit.address.split("@")[0]} onChange={(e) => setEdit({ ...edit, address: `${e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, "")}@${dom.name}` })} placeholder="info" /><span>@{dom.name}</span></div></Field>
          <Field label="Name shown on replies"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. Sales team" /></Field>
          <Field label="Arrives with"><Select value={edit.deliver} onChange={(v) => setEdit({ ...edit, deliver: v })} options={[{ id: "all", label: "Inbox (everyone who answers messages)" }, ...members.map((m) => ({ id: m.id, label: m.name }))]} /></Field>
          <Field label="Also send a copy to" optional hint="For example your personal Gmail. Replies should still be sent from the dashboard."><Input value={edit.forward} onChange={(e) => setEdit({ ...edit, forward: e.target.value })} placeholder="name@gmail.com" /></Field>
        </div>}
      </Drawer>
      <Confirm open={!!del} onClose={() => setDel(null)} danger onConfirm={() => { onChange({ ...dom, addresses: dom.addresses.filter((a) => a.id !== del.id) }); toast("Address deleted"); }}
        title={`Delete ${del?.address}?`} confirmLabel="Delete">Mail sent to this address will bounce. Past messages stay in Inbox.</Confirm>
    </>
  );
}
