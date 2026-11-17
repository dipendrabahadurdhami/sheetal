// Settings → Domain and email: the business's own email domain and mailboxes (owners and managers).
// How it works: 1 add the domain, 2 add the DNS records shown at the domain provider, 3 check them, 4 create mailboxes
// for team members and shared addresses (info@, sales@). Mail is read and written on the Email page.

import React, { useCallback, useEffect, useState } from "react";
import { Link } from "@sheetal/shared/core/router";
import { fdatetime } from "@sheetal/shared/core/format";
import { Badge, Button, Drawer, Empty, Field, Input, PageHead, Panel, Select, Table, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { bizApi, bizApiReady, formatBytes, signedIn } from "../api";
import { shortName } from "./domainsLogic.js";

const STATUS = { ok: ["Found", "done"], missing: ["Not added yet", "action"], wrong: ["Different value", "problem"], unchecked: ["Not checked", "neutral"] };

export function Domains() {
  const toast = useToast();
  const [ov, setOv] = useState(null);
  const [err, setErr] = useState(null);
  const load = useCallback(() => bizApi("GET", "/mail").then((r) => { setOv(r.data); setErr(null); }).catch(setErr), []);
  useEffect(() => { if (bizApiReady() && signedIn()) load(); }, [load]);

  const head = <PageHead title="Domain and email" sub="Your own domain and a mailbox for everyone in your team" />;
  const notice = (icon, title, text, action) => <>{head}<section className="card pf-panel"><Empty icon={icon} title={title} action={action}>{text}</Empty></section></>;
  if (!bizApiReady()) return notice("plug", "Email isn't connected here yet", "The business API address is missing (VITE_BUSINESS_API_URL).");
  if (!signedIn() || err?.status === 401) return notice("log-in", "Sign in to set up email", "Email uses your Sheetal account. Sign in on the website, then come back.", <a className="btn btn-primary" href="/">Sign in on the website</a>);
  if (err) return notice("circle-alert", "Couldn't load your email setup", err.message, <Button variant="outline" onClick={load}>Try again</Button>);
  if (!ov) return <>{head}<div className="sk" style={{ height: 320, borderRadius: "var(--r)" }} /></>;
  if (!ov.paid) return notice("mail", "Team email is on Business and Pro", "A mailbox for everyone in your team on your own domain, shared addresses like info@, and 1 GB of storage.", <Link to="/business/billing" className="btn btn-primary">See plans</Link>);
  if (!ov.canManage) return notice("lock", "Only owners and managers can set up email", "Ask them to add your mailbox. You'll find it on the Email page.");

  const run = (p) => p.then((r) => { if (r?.message) toast(r.message); load(); return r; }).catch((e) => { toast(e.message); throw e; });
  const pct = ov.quota.limit ? Math.min(100, Math.round((ov.quota.used / ov.quota.limit) * 100)) : 0;

  return (
    <>
      {head}
      <div className="pf-stats">
        <div className="card pf-stat"><span>Domains</span><b className="tnum">{ov.domains.length}</b><small>{ov.domains.filter((d) => d.verified).length} ready</small></div>
        <div className="card pf-stat"><span>Mailboxes</span><b className="tnum">{ov.mailboxes.length}</b><small>{ov.mailboxes.filter((m) => m.kind === "shared").length} shared</small></div>
        <div className="card pf-stat"><span>Storage</span><b className="tnum">{formatBytes(ov.quota.used)}</b><small>of {formatBytes(ov.quota.limit)} · {pct}%</small></div>
      </div>
      {ov.domains.map((d) => <DomainPanel key={d.id} d={d} run={run} />)}
      <AddDomain run={run} first={!ov.domains.length} />
      {ov.domains.some((d) => d.verified) && <Mailboxes ov={ov} run={run} />}
    </>
  );
}

function AddDomain({ run, first }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const add = () => { setBusy(true); run(bizApi("POST", "/mail/domains", { name })).then(() => setName("")).catch(() => {}).finally(() => setBusy(false)); };
  return (
    <Panel title={first ? "Connect your domain" : "Add another domain"} sub="The domain your team's email will use, like yourbusiness.com" pad>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="yourbusiness.com" style={{ maxWidth: 320 }} onKeyDown={(e) => e.key === "Enter" && name && add()} />
        <Button icon="plus" disabled={!name || busy} onClick={add}>Add domain</Button>
      </div>
    </Panel>
  );
}

const ACTION = { ok: ["Already right", "done"], add: ["Will be added", "action"], replace: ["Will be replaced", "problem"] };

/** "Add the records for me": shows what Cloudflare will get, asks before replacing anything already there, then does it. */
function AutoDns({ d, run, onClose }) {
  const [plan, setPlan] = useState(null);
  const [needToken, setNeedToken] = useState(false);
  const [token, setToken] = useState("");   // lives only in this window: sent with the request, never saved
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const url = `/mail/domains/${d.id}/dns/auto`;
  const body = (more) => ({ ...(token.trim() ? { token: token.trim() } : {}), ...more });
  const look = () => {
    setBusy(true); setErr(null);
    bizApi("POST", url, body({})).then((r) => { setPlan(r.data.plan); setNeedToken(false); })
      .catch((e) => { if (e.code === "needs_token" && !token.trim()) setNeedToken(true); else setErr(e.message); })
      .finally(() => setBusy(false));
  };
  useEffect(() => { look(); }, [d.id]);
  const todo = plan ? plan.items.filter((i) => i.action !== "ok").length : 0;
  const go = () => { setBusy(true); run(bizApi("POST", url, body({ apply: true, replace: plan.needsConfirm && sure }))).then(onClose).catch(() => {}).finally(() => setBusy(false)); };
  const askToken = !plan && (needToken || (token && err));
  return (
    <Drawer open onClose={onClose} title={`Add the records for ${d.name}`}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button>
        {askToken
          ? <Button disabled={busy || token.trim().length < 20} onClick={look}>{busy ? "Looking…" : "Find my domain"}</Button>
          : <Button disabled={busy || !plan || (plan.needsConfirm && !sure) || !todo} onClick={go}>{busy ? "Working…" : todo ? "Add the records" : "Nothing to add"}</Button>}</>}>
      <div className="pf-stack">
        {err && <p className="small" role="alert">{err}</p>}
        {!plan && !err && !needToken && <p className="muted">Looking at your Cloudflare settings…</p>}
        {askToken && <>
          <p>If <b>{d.name}</b> is on <b>Cloudflare</b>, Sheetal can add the records for you. Make a Cloudflare <b>token</b> (2 minutes) and paste it here. Sheetal uses it <b>once</b> for this setup and <b>does not keep it</b>.</p>
          <ol className="small" style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 6 }}>
            <li>Open <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener noreferrer">Cloudflare → My Profile → API Tokens</a> and click <b>Create Token</b>.</li>
            <li>Next to <b>Edit zone DNS</b>, click <b>Use template</b>.</li>
            <li>Under <b>Zone Resources</b> choose <b>Include → Specific zone → {d.name}</b>.</li>
            <li>Click <b>Continue to summary</b>, then <b>Create Token</b>, then <b>Copy</b>. Paste it below.</li>
          </ol>
          <Field label="Cloudflare token" hint="Shown only once by Cloudflare. It is not saved by Sheetal.">
            <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" placeholder="Paste the token here" />
          </Field>
          <p className="small muted" style={{ margin: 0 }}>Not on Cloudflare? Close this window and follow the step-by-step guide under the records table.</p>
        </>}
        {plan && <>
          <p>Sheetal will set these up in Cloudflare for <b>{plan.zone}</b>. Nothing is changed until you press the button.</p>
          <div className="pf-stack" style={{ gap: 10 }}>
            {plan.items.map((i) => (
              <div key={i.id} className="card" style={{ padding: 12 }}>
                <div className="row" style={{ gap: 8, justifyContent: "space-between" }}>
                  <span><b>{i.type}</b> <code className="small">{i.host}</code></span>
                  <Badge tone={ACTION[i.action][1]}>{ACTION[i.action][0]}</Badge>
                </div>
                <small className="muted">{i.note}</small>
                {i.action === "replace" && i.current.length > 0 && <div className="small" style={{ marginTop: 6 }}>Removed or changed: {i.current.map((c) => <code key={c} className="small" style={{ marginRight: 6 }}>{c}</code>)}</div>}
              </div>
            ))}
          </div>
          {plan.needsConfirm && (
            <label className="row" style={{ gap: 8, alignItems: "flex-start" }}>
              <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />
              <span>I understand. Email for <b>{plan.zone}</b> will go to Sheetal from now on. Mail at the old provider stops arriving, and I have saved anything I still need there.</span>
            </label>
          )}
        </>}
      </div>
    </Drawer>
  );
}

/** A step-by-step guide for a business owner who has never edited DNS. Shown while the domain is not ready. */
function DnsGuide({ d }) {
  return (
    <details className="card" style={{ margin: "0 16px 14px", padding: "12px 16px" }}>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>How do I add these records? (step by step)</summary>
      <div className="pf-stack" style={{ marginTop: 10, gap: 10 }}>
        <p className="small" style={{ margin: 0 }}>The <b>domain provider</b> is the website where you bought or manage <b>{d.name}</b> (for example Cloudflare, GoDaddy, Namecheap or HimalayanHost). You need to sign in there. Not sure where? Ask the person who bought the domain.</p>
        <ol className="small" style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 6 }}>
          <li>Sign in to your domain provider and open the <b>DNS</b> settings of <b>{d.name}</b> (it may be called "DNS", "DNS zone", "Manage DNS" or "Advanced DNS").</li>
          <li>Click <b>Add record</b>. Do this once for <b>each row</b> in the table above.</li>
          <li>Fill in the boxes from the row:
            <ul style={{ paddingLeft: 18, margin: "4px 0 0" }}>
              <li><b>Type</b>: TXT or MX, as the row says.</li>
              <li><b>Name</b> (or "Host"): type what is under "Type in the Name box". <code>@</code> means the domain itself. If your provider asks for the full name, use the full name shown in the table.</li>
              <li><b>Value</b> (or "Content", "Text"): press the copy button and paste it. Don't retype it.</li>
              <li>For the <b>MX</b> row, set <b>Priority</b> to <code>10</code> and the mail server to <code>{d.records.find((r) => r.id === "mx")?.value ?? "mail.sheetalproperty.com"}</code>.</li>
              <li><b>TTL</b>: leave on Auto.</li>
            </ul></li>
          <li><b>Remove old email records.</b> If this domain already has other <b>MX</b> records (from an old email service), delete them: mail goes to the lowest number, and old ones send mail elsewhere. A domain may have only <b>one</b> SPF record (a TXT that starts with <code>v=spf1</code>): replace the old one with ours.</li>
          <li>If your provider is <b>Cloudflare</b>: set Proxy status to <b>DNS only</b> (grey cloud) where it asks.</li>
          <li>Come back here and press <b>Check records</b>. It can take a few minutes, sometimes up to an hour. When every row says <b>Found</b>, this domain is <b>Ready</b> and you can create mailboxes.</li>
        </ol>
        <p className="small muted" style={{ margin: 0 }}>Stuck? Send your domain provider's name to Sheetal support and we will tell you exactly where to click.</p>
      </div>
    </details>
  );
}

function DomainPanel({ d, run }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(false);
  const [removing, setRemoving] = useState(false);
  const check = () => { setBusy(true); run(bizApi("POST", `/mail/domains/${d.id}/check`)).catch(() => {}).finally(() => setBusy(false)); };
  const copy = (v) => navigator.clipboard?.writeText(v).then(() => toast("Copied"), () => toast("Couldn't copy"));
  const required = d.records.filter((r) => r.required);
  const ok = required.filter((r) => r.status === "ok").length;
  return (
    <Panel title={d.name} sub={d.verified ? "Ready: mailboxes can use this domain" : `Add these records at your domain provider (${ok} of ${required.length} found)`}
      actions={<>{d.verified ? <Badge tone="done" icon="check">Ready</Badge> : <Badge tone="action">Waiting for DNS</Badge>}
        {!d.verified && <Button size="sm" icon="wand-sparkles" onClick={() => setAuto(true)}>Add the records for me</Button>}
        <Button size="sm" variant="outline" icon="refresh-cw" disabled={busy} onClick={check}>{busy ? "Checking…" : "Check records"}</Button>
        <Button size="sm" variant="ghost" icon="trash-2" onClick={() => setRemoving(true)}>Remove</Button></>}>
      <Table rows={d.records} minWidth={760} columns={[
        { key: "t", label: "Type", render: (r) => <b className="tnum">{r.type}</b> },
        { key: "h", label: "Name / host", render: (r) => <span className="pf-two"><code className="small">{r.host}</code><small>{r.purpose}{r.required ? "" : " · optional"}</small>
          {!d.verified && <small className="row" style={{ gap: 4 }}>Type in the Name box: <code className="small">{shortName(r.host, d.name)}</code>
            <button type="button" className="btn btn-ghost btn-icon" aria-label="Copy name" onClick={() => copy(shortName(r.host, d.name))}><Icon name="copy" size={12} /></button></small>}</span> },
        { key: "v", label: "Value", render: (r) => <span className="row" style={{ gap: 6 }}><code className="small mail-dns-value">{r.priority ? `${r.priority} ` : ""}{r.value}</code><button type="button" className="btn btn-ghost btn-icon" aria-label="Copy value" onClick={() => copy(r.value)}><Icon name="copy" size={14} /></button></span> },
        { key: "s", label: "Status", render: (r) => <Badge tone={STATUS[r.status][1]}>{STATUS[r.status][0]}</Badge> },
      ]} />
      <p className="small muted" style={{ padding: "10px 16px 14px", margin: 0 }}>{d.checkedAt ? `Last checked ${fdatetime(d.checkedAt)}. ` : ""}DNS changes can take up to an hour to show. Keep any other MX records off this domain, or mail may go elsewhere.</p>
      {!d.verified && <DnsGuide d={d} />}
      {auto && <AutoDns d={d} run={run} onClose={() => setAuto(false)} />}
      {removing && <RemoveDomain d={d} run={run} onClose={() => setRemoving(false)} />}
    </Panel>
  );
}

/** Takes a domain off the business. The server refuses while the domain still has mailboxes (delete those first). DNS records at the provider are not touched. */
function RemoveDomain({ d, run, onClose }) {
  const [busy, setBusy] = useState(false);
  return (
    <Drawer open onClose={onClose} title={`Remove ${d.name}?`}
      footer={<><Button variant="outline" onClick={onClose}>Keep it</Button>
        <Button className="pf-danger" disabled={busy} onClick={() => { setBusy(true); run(bizApi("DELETE", `/mail/domains/${d.id}`)).then(onClose).catch(() => {}).finally(() => setBusy(false)); }}>{busy ? "Removing…" : "Remove domain"}</Button></>}>
      <div className="pf-stack">
        <p>This takes <b>{d.name}</b> out of Sheetal. Mailboxes on it must be deleted first; Sheetal tells you if there are any.</p>
        <p className="small muted">Nothing is changed at your domain provider (Cloudflare or other). You can add the domain again later.</p>
      </div>
    </Drawer>
  );
}

function Mailboxes({ ov, run }) {
  const [team, setTeam] = useState([]);
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  useEffect(() => { bizApi("GET", "/mail/team").then((r) => setTeam(r.data)).catch(() => {}); }, []);
  const ready = ov.domains.filter((d) => d.verified);
  const nameOf = (id) => team.find((m) => m.userId === id)?.name || "—";
  return (
    <Panel title="Mailboxes" sub="A mailbox for each person, and shared addresses several people answer"
      actions={<Button size="sm" icon="plus" onClick={() => setEdit({ domainId: ready[0].id, local: "", name: "", kind: "person", userId: "", accessUserIds: [] })}>New mailbox</Button>}>
      {!ov.mailboxes.length ? <Empty icon="mail-plus" title="No mailboxes yet">Create one for yourself first, then one for each team member.</Empty>
        : <Table rows={ov.mailboxes} minWidth={680} columns={[
          { key: "a", label: "Address", render: (m) => <span className="pf-two"><b>{m.address}</b><small>{m.name}</small></span> },
          { key: "k", label: "Type", render: (m) => <Badge tone={m.kind === "shared" ? "progress" : "neutral"}>{m.kind === "shared" ? "Shared" : "Personal"}</Badge> },
          { key: "w", label: "Who uses it", render: (m) => <span className="small">{m.kind === "shared" ? (m.accessUserIds.map(nameOf).join(", ") || "Owners and managers") : nameOf(m.userId)}</span> },
          { key: "s", label: "", render: (m) => (m.active ? null : <Badge tone="neutral">Off</Badge>) },
          { key: "x", label: "", align: "right", render: (m) => <span className="pf-row-actions">
            {m.kind === "shared" && <Button size="sm" variant="ghost" onClick={() => setEdit({ id: m.id, kind: "shared", name: m.name, accessUserIds: m.accessUserIds })}>People</Button>}
            <Button size="sm" variant="ghost" onClick={() => run(bizApi("PATCH", `/mail/mailboxes/${m.id}`, { active: !m.active })).catch(() => {})}>{m.active ? "Switch off" : "Switch on"}</Button>
            <Button size="sm" variant="ghost" onClick={() => setDel(m)}>Delete</Button></span> },
        ]} />}
      {edit && <MailboxForm init={edit} domains={ready} team={team} run={run} onClose={() => setEdit(null)} />}
      {del && <DeleteMailbox m={del} run={run} onClose={() => setDel(null)} />}
    </Panel>
  );
}

function MailboxForm({ init, domains, team, run, onClose }) {
  const [f, setF] = useState(init);
  const [busy, setBusy] = useState(false);
  const domain = domains.find((d) => d.id === f.domainId);
  const toggle = (id) => setF({ ...f, accessUserIds: f.accessUserIds.includes(id) ? f.accessUserIds.filter((x) => x !== id) : [...f.accessUserIds, id] });
  const save = () => {
    setBusy(true);
    const p = f.id ? bizApi("PATCH", `/mail/mailboxes/${f.id}`, { name: f.name, accessUserIds: f.accessUserIds }) : bizApi("POST", "/mail/mailboxes", f);
    run(p).then(onClose).catch(() => {}).finally(() => setBusy(false));
  };
  return (
    <Drawer open onClose={onClose} title={f.id ? `People on ${f.name}` : "New mailbox"}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={busy || (!f.id && (!f.local || !f.name || (f.kind === "person" && !f.userId)))} onClick={save}>{f.id ? "Save" : "Create mailbox"}</Button></>}>
      <div className="pf-stack">
        {!f.id && <>
          <Field label="Type"><Select value={f.kind} onChange={(v) => setF({ ...f, kind: v })} options={[{ id: "person", label: "Personal: one team member" }, { id: "shared", label: "Shared: info@, sales@, answered together" }]} /></Field>
          {f.kind === "person" && <Field label="Team member"><Select value={f.userId} onChange={(v) => { const m = team.find((x) => x.userId === v); setF({ ...f, userId: v, name: f.name || m?.name || "", local: f.local || (m?.name || "").toLowerCase().split(" ")[0].replace(/[^a-z0-9]/g, "") }); }}
            options={[{ id: "", label: "Choose…" }, ...team.map((m) => ({ id: m.userId, label: `${m.name} · ${m.role}` }))]} /></Field>}
          <Field label="Address"><div className="row" style={{ gap: 6 }}><Input value={f.local} onChange={(e) => setF({ ...f, local: e.target.value.toLowerCase() })} placeholder={f.kind === "shared" ? "info" : "ram"} style={{ maxWidth: 180 }} />
            <span>@</span>{domains.length > 1 ? <Select value={f.domainId} onChange={(v) => setF({ ...f, domainId: v })} options={domains.map((d) => ({ id: d.id, label: d.name }))} /> : <b>{domain?.name}</b>}</div></Field>
        </>}
        <Field label="Name people see"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={f.kind === "shared" ? "Your business name" : "Full name"} /></Field>
        {f.kind === "shared" && <Field label="Who answers it" hint="Owners and managers can always open every mailbox">
          <div className="pf-chips">{team.map((m) => <button key={m.userId} type="button" className={`chip ${f.accessUserIds.includes(m.userId) ? "active" : ""}`} onClick={() => toggle(m.userId)}>{m.name}</button>)}</div></Field>}
      </div>
    </Drawer>
  );
}

function DeleteMailbox({ m, run, onClose }) {
  const [typed, setTyped] = useState("");
  return (
    <Drawer open onClose={onClose} title={`Delete ${m.address}?`}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button className="pf-danger" disabled={typed.trim().toLowerCase() !== m.address} onClick={() => run(bizApi("DELETE", `/mail/mailboxes/${m.id}`, { confirm: typed })).then(onClose).catch(() => {})}>Delete mailbox and mail</Button></>}>
      <div className="pf-stack">
        <p>All mail in this mailbox is deleted and can't be brought back. Mail sent to it afterwards bounces. To keep the mail, switch the mailbox off instead.</p>
        <Field label={`Type ${m.address} to confirm`}><Input value={typed} onChange={(e) => setTyped(e.target.value)} /></Field>
      </div>
    </Drawer>
  );
}
