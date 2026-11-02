import React, { useState } from "react";
import { useStore } from "@sheetal/shared/core/store";
import { Link } from "@sheetal/shared/core/router";
import { Badge, Button, Field, Input, PageHead, Panel, Seg, Select, Table, ToggleRow, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { otaOf, OTAS } from "@sheetal/shared/data/ota";
import { AI_PROVIDERS, API_BASE, INTEGRATIONS, STATUS_LABEL, STATUS_TONE, emailDnsRecords, integrationsOf, makeSecret, statusOf, stepsOf } from "@sheetal/shared/data/integrations";

// Setup center: every outside service Sheetal connects to, with its setup steps and status.
// Demo note: "Test", "Check" and "Deploy" buttons simulate the result here; the backend makes the real calls
// (Cloudflare API, Meta Graph API, Google APIs) and stores the outcome in the same fields.

const later = (fn, ms = 900) => setTimeout(fn, ms);

function useIntegrations() {
  const { db, update } = useStore();
  const all = integrationsOf(db);
  const patch = (id, fn) => update((d) => { d.integrations = d.integrations || integrationsOf(d); fn(d.integrations[id]); });
  return { db, all, patch };
}

function statusFor(id, all, db) {
  if (id === "channels") {
    const acc = otaOf(db).accounts || {};
    const vals = OTAS.map((o) => acc[o.id]);
    return vals.every((v) => v === "connected") ? "done" : vals.some((v) => v === "connected" || v === "pending") ? "review" : "off";
  }
  return statusOf(stepsOf(id, all[id] || {}, db));
}

export function AdminIntegrations({ id }) {
  const { db, all } = useIntegrations();
  if (id && INTEGRATIONS.some((x) => x.id === id && !x.to)) return <Detail id={id} />;
  const counts = { done: 0, review: 0, off: 0 };
  INTEGRATIONS.forEach((x) => { counts[statusFor(x.id, all, db)]++; });
  return (
    <>
      <PageHead title="Setup center" sub="Connect every outside service from here. Each one shows what is done, what is waiting and what is left." />
      <div className="pf-stats">
        <div className="card pf-stat"><span>Setup complete</span><b className="tnum">{counts.done}</b></div>
        <div className="card pf-stat"><span>In review</span><b className="tnum">{counts.review}</b><small>Started or waiting on DNS, Meta or Google</small></div>
        <div className="card pf-stat"><span>Not set up</span><b className="tnum">{counts.off}</b></div>
      </div>
      <div className="pf-int-grid">
        {INTEGRATIONS.map((x) => {
          const st = statusFor(x.id, all, db);
          const steps = x.id === "channels" ? [] : stepsOf(x.id, all[x.id] || {}, db);
          return (
            <Link key={x.id} to={x.to || `/admin/integrations/${x.id}`} className="card pf-int-card">
              <div className="pf-int-top"><span className="pf-li-ico"><Icon name={x.icon} size={18} /></span><b>{x.name}</b><Badge tone={x.id === "sms" ? "neutral" : STATUS_TONE[st]}>{x.id === "sms" ? "Not used" : STATUS_LABEL[st]}</Badge></div>
              <p className="small muted">{x.sub}</p>
              {steps.length > 0 && <div className="pf-meter"><div className="pf-meter-top"><span className="small tnum">{steps.filter((s) => s.done).length} of {steps.length} steps</span></div><div className="bar"><i style={{ width: `${(steps.filter((s) => s.done).length / steps.length) * 100}%` }} /></div></div>}
              <span className="small pf-int-open">{st === "done" ? "View setup" : "Open setup"}<Icon name="chevron-right" size={14} /></span>
            </Link>
          );
        })}
      </div>
    </>
  );
}

function Detail({ id }) {
  const { db, all } = useIntegrations();
  const meta = INTEGRATIONS.find((x) => x.id === id);
  const steps = stepsOf(id, all[id], db);
  const st = statusOf(steps);
  return (
    <>
      <PageHead title={meta.name} sub={meta.sub} actions={<Link to="/admin/integrations" className="btn btn-outline"><Icon name="arrow-left" size={16} />Setup center</Link>} />
      <section className="card pf-panel pf-pad">
        <div className="pf-int-top"><b>Progress</b><Badge tone={STATUS_TONE[st]}>{STATUS_LABEL[st]}</Badge></div>
        <ol className="pf-setup-steps">{steps.map((s, i) => (
          <li key={s.id} className={s.done ? "done" : s.wait ? "wait" : ""}><span>{s.done ? <Icon name="check" size={12} /> : s.wait ? <Icon name="clock" size={12} /> : i + 1}</span>{s.label}{s.wait && <em> · waiting</em>}</li>
        ))}</ol>
      </section>
      {id === "email" && <EmailSetup />}
      {id === "whatsapp" && <WhatsAppSetup />}
      {id === "meta" && <MetaSetup />}
      {id === "google" && <GoogleSetup />}
      {id === "ai" && <AiSetup />}
      {id === "sms" && <Panel title="SMS" pad><div className="pf-note"><Icon name="info" size={16} /><span>No SMS service is bought for now. Every message that would go by SMS goes by WhatsApp (and email) instead. An SMS provider can be added here later without changing anything else.</span></div></Panel>}
    </>
  );
}

// ── shared bits ──
function Secret({ label, value, onSave, hint }) {
  const [v, setV] = useState("");
  return (
    <Field label={label} hint={value ? "Saved. Enter a new value to replace it." : hint}>
      <div className="pf-row-actions" style={{ justifyContent: "flex-start", flexWrap: "nowrap" }}>
        <Input type="password" autoComplete="off" value={v} placeholder={value ? "••••••••••••" : ""} onChange={(e) => setV(e.target.value)} style={{ flex: 1 }} />
        <Button variant="outline" disabled={!v.trim()} onClick={() => { onSave(v.trim()); setV(""); }}>Save</Button>
      </div>
    </Field>
  );
}
function CopyRow({ label, value }) {
  const toast = useToast();
  return <Field label={label}><span className="pf-dns-val"><code>{value}</code><button type="button" className="btn btn-ghost btn-icon" aria-label={`Copy ${label}`} onClick={() => { navigator.clipboard?.writeText(value); toast("Copied"); }}><Icon name="copy" size={14} /></button></span></Field>;
}
const Ok = ({ on, yes = "Done", no = "Not done", wait }) => (on ? <Badge tone="done">{yes}</Badge> : wait ? <Badge tone="progress">{wait}</Badge> : <Badge tone="neutral">{no}</Badge>);
function Text({ label, value, onChange, placeholder, hint }) { return <Field label={label} hint={hint}><Input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} /></Field>; }

// ── Email: own system on Cloudflare ──
function EmailSetup() {
  const { db, all, patch } = useIntegrations();
  const toast = useToast();
  const x = all.email;
  const set = (fn) => patch("email", fn);
  const recs = emailDnsRecords(x.domain, x.outbound.dkimSelector);
  const [busy, setBusy] = useState("");
  const staff = db.platformStaff || [];
  const deliverOptions = [{ id: "none", label: "Nobody (sends only)" }, { id: "inbox:support", label: "Support inbox (all support staff)" }, ...staff.map((m) => ({ id: `staff:${m.id}`, label: `${m.name} · ${m.email}` }))];
  const [newLocal, setNewLocal] = useState("");
  return (
    <>
      <div className="pf-note"><Icon name="info" size={16} /><span>How it works: mail sent to an address on <b>{x.domain}</b> arrives at Cloudflare, an Email Worker turns it into JSON and posts it to <code>{API_BASE}/webhooks/email/inbound</code>, and it appears in the dashboard inbox. Replies are sent from the same address. No Zoho or other mail provider.</span></div>

      <Panel title="1. Connect Cloudflare" sub="An API token lets the backend add mail records and deploy the Email Worker for you." pad actions={<Ok on={x.cfTokenOk} yes="Connected" />}>
        <div className="pf-stack">
          <Text label="Cloudflare account ID" value={x.cfAccountId} onChange={(v) => set((e) => { e.cfAccountId = v; e.cfTokenOk = false; })} placeholder="e.g. 3f9a…" />
          <Secret label="API token" value={x.cfToken} hint="Create it in Cloudflare → My profile → API tokens with: Zone DNS Edit, Email Routing Edit, Workers Scripts Edit." onSave={(v) => set((e) => { e.cfToken = v; e.cfTokenOk = false; })} />
          <div><Button icon="plug" disabled={!x.cfAccountId || !x.cfToken || busy === "cf"} onClick={() => { setBusy("cf"); later(() => { set((e) => { e.cfTokenOk = true; }); setBusy(""); toast("Cloudflare connected"); }); }}>{busy === "cf" ? "Testing…" : "Test connection"}</Button></div>
        </div>
      </Panel>

      <Panel title={`2. Mail records on ${x.domain}`} sub="The backend adds these through Cloudflare, then keeps checking until they are live." actions={<Button variant="outline" icon="refresh-cw" disabled={!x.cfTokenOk || busy === "dns"} onClick={() => { setBusy("dns"); set((e) => { recs.forEach((r) => { e.dns[r.id] = e.dns[r.id] === "pending" ? "ok" : e.dns[r.id] || "pending"; }); }); later(() => setBusy("")); toast("Checked. Records can take a few minutes to go live."); }}>{busy === "dns" ? "Checking…" : x.dnsAuto ? "Add records and check" : "Check records"}</Button>}>
        <div className="pf-pad" style={{ paddingBottom: 0 }}><ToggleRow title="Add records automatically" sub="Off: copy the records into your DNS host yourself." checked={x.dnsAuto} onChange={(v) => set((e) => { e.dnsAuto = v; })} /></div>
        <Table rows={recs} minWidth={760} columns={[
          { key: "purpose", label: "For", render: (r) => <b className="pf-strong">{r.purpose}</b> },
          { key: "type", label: "Type", render: (r) => <code>{r.type}{r.prio ? ` ${r.prio}` : ""}</code> },
          { key: "host", label: "Name", render: (r) => <code>{r.host}</code> },
          { key: "value", label: "Value", render: (r) => <code className="pf-break">{r.value}</code> },
          { key: "st", label: "Status", render: (r) => <Ok on={x.dns[r.id] === "ok"} yes="Live" no="Not added" wait={x.dns[r.id] === "pending" && "Waiting for DNS"} /> },
        ]} />
      </Panel>

      <Panel title="3. Inbound Email Worker" sub="Receives every mail at Cloudflare's edge and posts it to the backend, signed with a secret." pad actions={<Ok on={x.worker.deployed} yes="Deployed" />}>
        <div className="pf-stack">
          <div className="pf-grid-2 tight"><Text label="Worker name" value={x.worker.name} onChange={(v) => set((e) => { e.worker.name = v; })} /><CopyRow label="Webhook it posts to" value={`${API_BASE}/webhooks/email/inbound`} /></div>
          <Field label="Signing secret" hint="The worker signs each post with this; the backend rejects anything unsigned.">
            <div className="pf-row-actions" style={{ justifyContent: "flex-start" }}><code>{x.worker.secret ? `${x.worker.secret.slice(0, 6)}••••••••` : "Not made yet"}</code><Button variant="outline" size="sm" icon="key-round" onClick={() => set((e) => { e.worker.secret = makeSecret(); e.worker.deployed = false; })}>{x.worker.secret ? "Make a new one" : "Make secret"}</Button></div>
          </Field>
          <div><Button icon="send" disabled={!x.cfTokenOk || !x.worker.secret || busy === "worker"} onClick={() => { setBusy("worker"); later(() => { set((e) => { e.worker.deployed = true; }); setBusy(""); toast("Worker deployed and catch-all route set"); }); }}>{busy === "worker" ? "Deploying…" : x.worker.deployed ? "Deploy again" : "Deploy worker"}</Button></div>
        </div>
      </Panel>

      <Panel title="4. Sending replies" sub="How mail written in the dashboard goes out. Signed with DKIM on your own domain." pad actions={<Ok on={x.outbound.tested} yes="Tested" />}>
        <div className="pf-stack">
          <Field label="Send with"><Seg value={x.outbound.method} onChange={(v) => set((e) => { e.outbound.method = v; e.outbound.tested = false; })} options={[{ id: "cloudflare", label: "Cloudflare Email Service" }, { id: "smtp", label: "Our own mail server (VPS)" }]} /></Field>
          {x.outbound.method === "smtp" && <div className="pf-grid-2 tight">
            <Text label="Server host" value={x.outbound.smtpHost} onChange={(v) => set((e) => { e.outbound.smtpHost = v; })} placeholder="mail.sheetalproperty.com" />
            <Text label="Port" value={String(x.outbound.smtpPort)} onChange={(v) => set((e) => { e.outbound.smtpPort = Number(v.replace(/\D/g, "")) || 587; })} />
            <Text label="Username" value={x.outbound.smtpUser} onChange={(v) => set((e) => { e.outbound.smtpUser = v; })} />
          </div>}
          <div className="pf-grid-2 tight"><Text label="Default sender" value={x.outbound.from} onChange={(v) => set((e) => { e.outbound.from = v; })} /><Text label="DKIM selector" value={x.outbound.dkimSelector} onChange={(v) => set((e) => { e.outbound.dkimSelector = v; })} hint="Used in the DKIM record above." /></div>
          <div><Button icon="send" disabled={!x.cfTokenOk || busy === "out"} onClick={() => { setBusy("out"); later(() => { set((e) => { e.outbound.tested = true; }); setBusy(""); toast("Test mail sent to admin@" + x.domain); }); }}>{busy === "out" ? "Sending…" : "Send a test mail"}</Button></div>
        </div>
      </Panel>

      <Panel title="5. Platform addresses" sub={`Addresses on ${x.domain} and who receives them. Mail lands in that person's dashboard inbox.`}>
        <Table rows={x.addresses} minWidth={680} columns={[
          { key: "a", label: "Address", render: (a) => <span className="pf-two"><b>{a.local}@{x.domain}</b><small>{a.note}</small></span> },
          { key: "d", label: "Delivered to", render: (a) => <Select value={a.deliver} onChange={(v) => set((e) => { e.addresses.find((y) => y.id === a.id).deliver = v; })} options={deliverOptions} /> },
          { key: "x", label: "", align: "right", render: (a) => !a.system && <button type="button" className="btn btn-ghost btn-icon" aria-label="Remove" onClick={() => set((e) => { e.addresses = e.addresses.filter((y) => y.id !== a.id); })}><Icon name="trash-2" size={15} /></button> },
        ]} />
        <div className="pf-panel-foot">
          <div className="pf-unit" style={{ flex: 1 }}><input className="input" value={newLocal} placeholder="e.g. sales" onChange={(e) => setNewLocal(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ""))} /><span>@{x.domain}</span></div>
          <Button icon="plus" disabled={!newLocal || x.addresses.some((a) => a.local === newLocal)} onClick={() => { set((e) => { e.addresses.push({ id: `a${Date.now()}`, local: newLocal, deliver: "inbox:support", note: "" }); }); setNewLocal(""); }}>Add address</Button>
        </div>
      </Panel>
    </>
  );
}

// ── WhatsApp ──
function WhatsAppSetup() {
  const { all, patch } = useIntegrations();
  const toast = useToast();
  const x = all.whatsapp;
  const set = (fn) => patch("whatsapp", fn);
  const [busy, setBusy] = useState("");
  return (
    <>
      <Panel title="How to connect" pad>
        <div className="pf-mode-pick">
          <button type="button" className={x.mode === "cloud" ? "on" : ""} onClick={() => set((w) => { w.mode = "cloud"; })}><Icon name="shield-check" size={22} /><b>Official WhatsApp Cloud API</b><span>Recommended. Run by Meta: templates, many agents, no ban risk. Free to set up; Meta charges per conversation.</span></button>
          <button type="button" className={x.mode === "qr" ? "on" : ""} onClick={() => set((w) => { w.mode = "qr"; })}><Icon name="qr-code" size={22} /><b>Link a phone by QR</b><span>Like the old site: scan a code with WhatsApp on a phone. Free, but unofficial; WhatsApp may block the number.</span></button>
        </div>
        <ToggleRow title="Businesses can connect their own WhatsApp number" sub="Off: every business uses Sheetal's number, with messages routed to their inbox." checked={x.businessesOwnNumber} onChange={(v) => set((w) => { w.businessesOwnNumber = v; })} />
      </Panel>

      {x.mode === "qr" ? (
        <Panel title="Link a phone" sub="On the phone: WhatsApp → Settings → Linked devices → Link a device, then scan." pad actions={<Ok on={x.qr.state === "linked"} yes="Linked" wait={x.qr.state === "waiting" && "Waiting for scan"} />}>
          <div className="pf-stack">
            {x.qr.state === "linked" ? <div className="pf-note"><Icon name="smartphone" size={16} /><span>Linked to <b>{x.qr.device}</b>. Keep the phone online with internet.</span></div>
              : x.qr.state === "waiting" ? <div className="pf-qr-box"><Icon name="qr-code" size={120} strokeWidth={1} /><span className="small muted">The backend shows the live QR code here.</span></div> : null}
            <div className="pf-row-actions" style={{ justifyContent: "flex-start" }}>
              {x.qr.state !== "linked" && <Button icon="qr-code" onClick={() => { set((w) => { w.qr.state = "waiting"; }); later(() => { set((w) => { w.qr = { state: "linked", device: "+977 980-1136817 (Android)" }; }); toast("Phone linked"); }, 2500); }}>{x.qr.state === "waiting" ? "Waiting…" : "Show QR code"}</Button>}
              {x.qr.state === "linked" && <Button variant="outline" onClick={() => set((w) => { w.qr = { state: "idle", device: "" }; w.testSent = false; })}>Unlink</Button>}
              <Button variant="outline" icon="send" disabled={x.qr.state !== "linked"} onClick={() => { set((w) => { w.testSent = true; }); toast("Test message sent"); }}>Send a test message</Button>
            </div>
          </div>
        </Panel>
      ) : <>
        <Panel title="1. Meta app" sub="Create an app at developers.facebook.com (type: Business) and add the WhatsApp product." pad actions={<Ok on={!!(x.appId && x.appSecret)} />}>
          <div className="pf-grid-2 tight"><Text label="App ID" value={x.appId} onChange={(v) => set((w) => { w.appId = v; })} /><Secret label="App secret" value={x.appSecret} onSave={(v) => set((w) => { w.appSecret = v; })} /></div>
        </Panel>
        <Panel title="2. Business account and number" sub="From WhatsApp → API setup in the Meta app." pad actions={<Ok on={!!(x.wabaId && x.phoneNumberId && x.number)} />}>
          <div className="pf-grid-2 tight">
            <Text label="WhatsApp Business Account ID" value={x.wabaId} onChange={(v) => set((w) => { w.wabaId = v; })} />
            <Text label="Phone number ID" value={x.phoneNumberId} onChange={(v) => set((w) => { w.phoneNumberId = v; })} />
            <Text label="Phone number" value={x.number} onChange={(v) => set((w) => { w.number = v; })} placeholder="+977 98…" />
            <Text label="Display name" value={x.displayName} onChange={(v) => set((w) => { w.displayName = v; })} />
          </div>
        </Panel>
        <Panel title="3. Access token" sub="Use a permanent token from a System User in Meta Business Settings (not the 24-hour test token)." pad actions={<Ok on={!!x.token} />}>
          <Secret label="Permanent access token" value={x.token} onSave={(v) => set((w) => { w.token = v; })} />
        </Panel>
        <Panel title="4. Webhook" sub="Paste these in the Meta app → WhatsApp → Configuration, then subscribe to messages." pad actions={<Ok on={x.webhookOk} yes="Verified" />}>
          <div className="pf-stack">
            <CopyRow label="Callback URL" value={`${API_BASE}/webhooks/whatsapp`} />
            <Field label="Verify token"><div className="pf-row-actions" style={{ justifyContent: "flex-start" }}><code>{x.verifyToken || "Not made yet"}</code><Button variant="outline" size="sm" icon="key-round" onClick={() => set((w) => { w.verifyToken = makeSecret(24); w.webhookOk = false; })}>{x.verifyToken ? "Make a new one" : "Make token"}</Button></div></Field>
            <div><Button icon="webhook" disabled={!x.verifyToken || !x.token || busy === "wh"} onClick={() => { setBusy("wh"); later(() => { set((w) => { w.webhookOk = true; }); setBusy(""); toast("Webhook verified by Meta"); }); }}>{busy === "wh" ? "Waiting for Meta…" : "I added it, check now"}</Button></div>
          </div>
        </Panel>
        <Panel title="5. Display name review" sub="Meta checks the business name shown to customers. Usually 1–3 days." pad actions={<Ok on={x.nameStatus === "approved"} yes="Approved" no="Not sent" wait={x.nameStatus === "in_review" && "In review"} />}>
          <div className="pf-row-actions" style={{ justifyContent: "flex-start" }}>
            {x.nameStatus === "not_sent" && <Button disabled={!x.webhookOk} onClick={() => set((w) => { w.nameStatus = "in_review"; })}>Send “{x.displayName}” for review</Button>}
            {x.nameStatus === "in_review" && <Button variant="outline" icon="refresh-cw" onClick={() => { set((w) => { w.nameStatus = "approved"; }); toast("Display name approved"); }}>Check status</Button>}
          </div>
        </Panel>
        <Panel title="6. Message templates" sub="Messages sent outside a 24-hour chat window must use an approved template.">
          <Table rows={x.templates} minWidth={720} columns={[
            { key: "n", label: "Template", render: (tp) => <span className="pf-two"><b>{tp.name}</b><small>{tp.category} · {tp.lang}</small></span> },
            { key: "b", label: "Text", render: (tp) => <span className="small">{tp.body}</span> },
            { key: "s", label: "Status", render: (tp) => <span className="pf-two"><Ok on={tp.status === "approved"} yes="Approved" no={tp.status === "draft" ? "Draft" : "Rejected"} wait={tp.status === "in_review" && "In review"} />{tp.reason && <small className="muted">{tp.reason}</small>}</span> },
          ]} />
          <div className="pf-panel-foot"><span className="small muted">Meta usually reviews templates within a day.</span>
            {x.templates.some((tp) => tp.status === "draft") && <Button disabled={!x.webhookOk} onClick={() => { set((w) => { w.templates.forEach((tp) => { if (tp.status === "draft") tp.status = "in_review"; }); }); toast("Templates sent to Meta for approval"); }}>Send drafts to Meta for approval</Button>}
            {x.templates.some((tp) => tp.status === "in_review") && <Button variant="outline" icon="refresh-cw" onClick={() => { set((w) => { w.templates.forEach((tp) => { if (tp.status === "in_review") tp.status = "approved"; }); }); toast("Template status updated"); }}>Check status</Button>}</div>
        </Panel>
        <Panel title="7. Test" pad actions={<Ok on={x.testSent} yes="Sent" />}>
          <Button icon="send" disabled={!x.webhookOk} onClick={() => { set((w) => { w.testSent = true; }); toast("Test sent with lead_reply template"); }}>Send a test message to the admin phone</Button>
        </Panel>
      </>}
    </>
  );
}

// ── Facebook / Instagram ──
function MetaSetup() {
  const { all, patch } = useIntegrations();
  const toast = useToast();
  const x = all.meta;
  const set = (fn) => patch("meta", fn);
  return (
    <>
      <Panel title="1. Meta app" sub="Can be the same app as WhatsApp. Add Messenger, Instagram and Facebook Login products." pad actions={<Ok on={!!(x.appId && x.appSecret)} />}>
        <div className="pf-grid-2 tight"><Text label="App ID" value={x.appId} onChange={(v) => set((m) => { m.appId = v; })} /><Secret label="App secret" value={x.appSecret} onSave={(v) => set((m) => { m.appSecret = v; })} /></div>
      </Panel>
      <Panel title="2. Facebook page and Instagram" pad actions={<Ok on={!!x.pageId} yes="Connected" />}>
        <div className="pf-stack">
          {x.pageId ? <div className="pf-note"><Icon name="facebook" size={16} /><span>Page <b>{x.pageName}</b>{x.instagram ? <> · Instagram <b>{x.instagram}</b></> : null}</span></div> : null}
          <div><Button icon="facebook" disabled={!x.appId || !x.appSecret} onClick={() => { set((m) => { m.pageId = "1029384756"; m.pageName = "Sheetal Property"; m.instagram = "@sheetalproperty"; }); toast("Page connected"); }}>{x.pageId ? "Reconnect page" : "Connect page with Facebook"}</Button></div>
        </div>
      </Panel>
      <Panel title="3. Webhook" sub="Messenger and Instagram messages arrive in the inbox through this." pad actions={<Ok on={x.webhookOk} yes="Verified" />}>
        <div className="pf-stack"><CopyRow label="Callback URL" value={`${API_BASE}/webhooks/meta`} /><div><Button icon="webhook" disabled={!x.pageId} onClick={() => { set((m) => { m.webhookOk = true; }); toast("Webhook verified"); }}>Check webhook</Button></div></div>
      </Panel>
      <Panel title="4. Meta app review" sub="Needed before customers outside your team can message through the app." pad actions={<Ok on={x.review === "approved"} yes="Approved" no="Not sent" wait={x.review === "in_review" && "In review"} />}>
        <div className="pf-stack">
          <ToggleRow title="Log in with Facebook" sub="Show Facebook on the sign-in screen" checked={x.login} onChange={(v) => set((m) => { m.login = v; })} />
          <div>{x.review === "not_sent" ? <Button disabled={!x.webhookOk} onClick={() => set((m) => { m.review = "in_review"; })}>Send for review</Button> : x.review === "in_review" ? <Button variant="outline" icon="refresh-cw" onClick={() => set((m) => { m.review = "approved"; })}>Check status</Button> : null}</div>
        </div>
      </Panel>
    </>
  );
}

// ── Google ──
function GoogleSetup() {
  const { all, patch } = useIntegrations();
  const toast = useToast();
  const x = all.google;
  const set = (fn) => patch("google", fn);
  return (
    <>
      <Panel title="1. Sign in with Google" sub="Google Cloud Console → APIs and services → Credentials → OAuth client ID (Web application)." pad actions={<Ok on={x.signIn && !!x.clientId && !!x.clientSecret} yes="On" />}>
        <div className="pf-stack">
          <div className="pf-grid-2 tight"><Text label="Client ID" value={x.clientId} onChange={(v) => set((g) => { g.clientId = v; })} placeholder="…apps.googleusercontent.com" /><Secret label="Client secret" value={x.clientSecret} onSave={(v) => set((g) => { g.clientSecret = v; })} /></div>
          <CopyRow label="Authorised redirect URI" value={`${API_BASE}/auth/google/callback`} />
          <ToggleRow title="Show “Continue with Google”" sub="On the website, business and admin sign-in screens" checked={x.signIn} onChange={(v) => set((g) => { g.signIn = v; })} />
        </div>
      </Panel>
      <Panel title="2. Google Analytics" pad actions={<Ok on={!!x.ga4} />}>
        <Text label="GA4 measurement ID" value={x.ga4} onChange={(v) => set((g) => { g.ga4 = v.trim(); })} placeholder="G-XXXXXXXXXX" hint="The website loads Analytics only when this is set." />
      </Panel>
      <Panel title="3. Search Console and sitemap" pad actions={<Ok on={!!x.searchConsole && x.sitemapSent} yes="Done" wait={!!x.searchConsole && !x.sitemapSent && "Sitemap not sent"} />}>
        <div className="pf-stack">
          <Text label="Verification code" value={x.searchConsole} onChange={(v) => set((g) => { g.searchConsole = v.trim(); })} placeholder="google-site-verification=…" hint="Added as a DNS TXT record on sheetalproperty.com through Cloudflare." />
          <CopyRow label="Sitemap" value="https://sheetalproperty.com/sitemap.xml" />
          <div><Button icon="send" disabled={!x.searchConsole} onClick={() => { set((g) => { g.sitemapSent = true; }); toast("Sitemap sent to Google"); }}>{x.sitemapSent ? "Send sitemap again" : "Send sitemap to Google"}</Button></div>
        </div>
      </Panel>
      <Panel title="4. Google Business Profile" pad actions={<Ok on={!!x.business} />}>
        <div className="pf-stack">
          <Text label="Profile link" value={x.business} onChange={(v) => set((g) => { g.business = v.trim(); })} placeholder="https://g.page/…" />
          <Text label="Maps API key (optional)" value={x.mapsKey} onChange={(v) => set((g) => { g.mapsKey = v.trim(); })} hint="Not needed: maps use OpenStreetMap, and directions open Google Maps without a key." />
        </div>
      </Panel>
    </>
  );
}

// ── AI models and voice: Sheetal's own paid subscription ──
function AiSetup() {
  const { all, patch } = useIntegrations();
  const toast = useToast();
  const x = all.ai;
  const set = (fn) => patch("ai", fn);
  const prov = AI_PROVIDERS.find((p) => p.id === x.provider) || AI_PROVIDERS[0];
  const [busy, setBusy] = useState("");
  return (
    <>
      <div className="pf-note"><Icon name="info" size={16} /><span>These keys run every AI feature for the website, admin and all businesses, counted against each plan's AI credits. Keys stay on the backend; browsers never see them.</span></div>
      <Panel title="1. AI model subscription" sub="Writes listings, finds leads in chats, answers questions and powers the voice assistant's thinking." pad actions={<Ok on={!!x.key && x.tested} yes="Working" />}>
        <div className="pf-stack">
          <Field label="Provider"><Select value={x.provider} onChange={(v) => set((a) => { a.provider = v; a.tested = false; a.model = (AI_PROVIDERS.find((p) => p.id === v)?.models[0]) || ""; })} options={AI_PROVIDERS.map((p) => ({ id: p.id, label: p.name }))} /></Field>
          <p className="small muted">{prov.note}</p>
          <div className="pf-grid-2 tight">
            {prov.models.length ? <Field label="Model"><Select value={x.model} onChange={(v) => set((a) => { a.model = v; })} options={prov.models.map((m) => ({ id: m, label: m }))} /></Field>
              : <Text label="Model" value={x.model} onChange={(v) => set((a) => { a.model = v; })} placeholder="Model name from the provider" />}
            <Secret label="API key" value={x.key} onSave={(v) => set((a) => { a.key = v; a.tested = false; })} />
          </div>
          <div><Button icon="sparkles" disabled={!x.key || busy === "ai"} onClick={() => { setBusy("ai"); later(() => { set((a) => { a.tested = true; }); setBusy(""); toast("AI model answered the test"); }); }}>{busy === "ai" ? "Testing…" : "Test the model"}</Button></div>
        </div>
      </Panel>
      <Panel title="2. Voice (ElevenLabs)" sub="Clear, natural voices for the AI voice assistant, including Nepali." pad actions={<Ok on={x.voiceOk} yes="Connected" />}>
        <div className="pf-stack">
          <Secret label="ElevenLabs API key" value={x.voiceKey} hint="A paid plan for Sheetal's included voices. Businesses can also connect their own free account." onSave={(v) => set((a) => { a.voiceKey = v; a.voiceOk = false; })} />
          <div><Button icon="phone-call" disabled={!x.voiceKey} onClick={() => { set((a) => { a.voiceOk = true; }); toast("Voice connected: 3 voices ready (Sita, Ram, Maya)"); }}>Connect and load voices</Button></div>
        </div>
      </Panel>
      <Panel title="3. Speech to text" sub="Turns what the caller says into text the AI understands." pad actions={<Ok on={!!x.sttKey || (x.sttProvider === "elevenlabs" && x.voiceOk)} />}>
        <div className="pf-stack">
          <Field label="Provider"><Seg value={x.sttProvider} onChange={(v) => set((a) => { a.sttProvider = v; })} options={[{ id: "elevenlabs", label: "ElevenLabs (same key)" }, { id: "openai", label: "OpenAI Whisper" }, { id: "deepgram", label: "Deepgram" }]} /></Field>
          {x.sttProvider !== "elevenlabs" && <Secret label="API key" value={x.sttKey} onSave={(v) => set((a) => { a.sttKey = v; })} />}
        </div>
      </Panel>
      <Panel title="4. Voice call server" sub="The service that runs live calls (the old site's Python voice worker, rebuilt)." pad actions={<Ok on={x.workerOk} yes="Online" />}>
        <div className="pf-stack">
          <Text label="Server address" value={x.workerUrl} onChange={(v) => set((a) => { a.workerUrl = v; a.workerOk = false; })} placeholder="https://voice.sheetalproperty.com" />
          <div><Button icon="phone-call" disabled={!x.workerUrl} onClick={() => { set((a) => { a.workerOk = true; }); toast("Voice server online. Test call finished."); }}>Make a test call</Button></div>
        </div>
      </Panel>
      <Panel title="Free option for businesses" pad>
        <ToggleRow title="Businesses can use their own AI and voice accounts" sub="They connect their own Gemini, OpenAI, Claude or ElevenLabs keys (free tiers work). Their AI then runs on their accounts, not Sheetal's credits." checked={x.allowOwnKeys} onChange={(v) => set((a) => { a.allowOwnKeys = v; })} />
      </Panel>
    </>
  );
}
