// Setup, system status, analytics and system emails on the admin API.
// How it works: AI, Meta and robot-check (captcha) keys are entered here (write-only); LiveStatus checks every part of the system; LiveOutbox
// lists system emails with their outcome and can send failed ones again.
// Rules: keys are never shown again once saved; email text is only shown outside production.

import React, { useEffect, useState } from "react";
import { fdatetime } from "@sheetal/shared/core/format";
import { Badge, Button, Field, Input, Panel, Stat, ToggleRow, useToast } from "@sheetal/shared/core/ui";
import { adminApi } from "../api";

function useApi(path) {
  const [data, setData] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { adminApi("GET", path).then((r) => setData(r.data)).catch(() => setData(null)); }, [path, tick]);
  return [data, () => setTick((n) => n + 1)];
}

export function LiveSetup() {
  const toast = useToast();
  const [ai, reloadAi] = useApi("/admin/settings/ai");
  const [meta, reloadMeta] = useApi("/admin/settings/meta");
  const [a, setA] = useState(null);
  const [m, setM] = useState({ appSecret: "", verifyToken: "" });
  useEffect(() => { if (ai) setA({ enabled: ai.enabled, model: ai.model, apiKey: "", credits: ai.credits }); }, [ai]);
  const saveAi = () => adminApi("PUT", "/admin/settings/ai", { enabled: a.enabled, model: a.model, apiKey: a.apiKey || undefined, credits: Object.fromEntries(Object.entries(a.credits).map(([k, v]) => [k, Number(v)])) })
    .then((r) => { toast(r.message); reloadAi(); }).catch((e) => toast(e.message));
  const saveMeta = () => adminApi("PUT", "/admin/settings/meta", { appSecret: m.appSecret || undefined, verifyToken: m.verifyToken || undefined })
    .then((r) => { toast(r.message); setM({ appSecret: "", verifyToken: "" }); reloadMeta(); }).catch((e) => toast(e.message));
  return (
    <>
    <div className="pf-split">
      <Panel title="AI (Claude)" className="grow" sub="Ask AI on the website and the lead finder in /business. Only the super admin can change the key." pad>
        {!a ? <p className="muted">Loading…</p> : <div className="pf-stack">
          <ToggleRow title="AI switched on" checked={a.enabled} onChange={(v) => setA({ ...a, enabled: v })} />
          <Field label="Model" hint="claude-opus-5-5 is the default."><Input value={a.model} onChange={(e) => setA({ ...a, model: e.target.value })} /></Field>
          <Field label="Anthropic API key" hint={ai.hasKey ? "A key is saved. Leave empty to keep it." : ai.envKey ? "Using ANTHROPIC_API_KEY from the server's environment." : "From console.anthropic.com → API keys."}>
            <Input type="password" autoComplete="new-password" value={a.apiKey} onChange={(e) => setA({ ...a, apiKey: e.target.value })} /></Field>
          <div className="pf-grid-2 tight">{Object.entries(a.credits).map(([plan, n]) => <Field key={plan} label={`${plan} credits a month`}><Input className="input tnum" value={n} onChange={(e) => setA({ ...a, credits: { ...a.credits, [plan]: e.target.value.replace(/[^\d-]/g, "") } })} /></Field>)}</div>
          <p className="small muted" style={{ margin: 0 }}>1 credit is about 1,000 words read or written. -1 means no limit.</p>
          <Button onClick={saveAi}>Save AI settings</Button>
        </div>}
      </Panel>
      <Panel title="Meta (WhatsApp, Messenger, Instagram)" className="side" sub="From Sheetal's Meta app. Businesses then connect their own number or page in /business → Channels." pad>
        {!meta ? <p className="muted">Loading…</p> : <div className="pf-stack">
          <Field label="Webhook URL" hint="Paste this in the Meta app's webhook settings."><Input readOnly value={meta.webhookUrl} onFocus={(e) => e.target.select()} /></Field>
          <Field label="App secret" hint={meta.hasAppSecret ? "Saved. Leave empty to keep it." : "Meta app → Settings → Basic."}><Input type="password" autoComplete="new-password" value={m.appSecret} onChange={(e) => setM({ ...m, appSecret: e.target.value })} /></Field>
          <Field label="Verify token" hint={meta.hasVerifyToken ? "Saved. Leave empty to keep it." : "Any long random text; type the same in Meta."}><Input type="password" autoComplete="new-password" value={m.verifyToken} onChange={(e) => setM({ ...m, verifyToken: e.target.value })} /></Field>
          <Button disabled={!m.appSecret && !m.verifyToken} onClick={saveMeta}>Save Meta settings</Button>
        </div>}
      </Panel>
    </div>
    <CaptchaPanel />
    </>
  );
}

// The "I'm not a robot" box on businesses' online forms (Cloudflare Turnstile). Without keys forms still work, with
// the rate limit and the hidden spam field.
function CaptchaPanel() {
  const toast = useToast();
  const [c, reload] = useApi("/admin/settings/captcha");
  const [v, setV] = useState({ siteKey: "", secret: "" });
  useEffect(() => { if (c) setV({ siteKey: c.siteKey, secret: "" }); }, [c]);
  const save = (body) => adminApi("PUT", "/admin/settings/captcha", body).then((r) => { toast(r.message); reload(); }).catch((e) => toast(e.message));
  return (
    <Panel title="Robot check on online forms" sub="Cloudflare Turnstile (free): dash.cloudflare.com → Turnstile → Add site, with your website's domain. Only the super admin can change the keys." pad>
      {!c ? <p className="muted">Loading…</p> : <div className="pf-stack">
        <span>{c.on ? <Badge tone="done">On</Badge> : <Badge tone="neutral">Off</Badge>}</span>
        <div className="pf-grid-2 tight">
          <Field label="Site key" hint="Shown on the form page."><Input value={v.siteKey} onChange={(e) => setV({ ...v, siteKey: e.target.value })} /></Field>
          <Field label="Secret key" hint={c.hasSecret ? "Saved. Leave empty to keep it." : "Kept encrypted; never shown again."}><Input type="password" autoComplete="new-password" value={v.secret} onChange={(e) => setV({ ...v, secret: e.target.value })} /></Field>
        </div>
        <div className="pf-row-actions" style={{ justifyContent: "flex-start" }}>
          <Button disabled={!v.siteKey.trim() || (!v.secret && !c.hasSecret)} onClick={() => save({ siteKey: v.siteKey.trim(), secret: v.secret || undefined })}>Save robot-check keys</Button>
          {c.on && <Button variant="outline" onClick={() => window.confirm("Turn the robot check off? Forms keep working with the rate limit.") && save({ off: true })}>Turn off</Button>}
        </div>
      </div>}
    </Panel>
  );
}

export function LiveStatus() {
  const [s, reload] = useApi("/admin/system/status");
  if (!s) return <p className="muted pf-pad">Loading…</p>;
  const ok = (v, label) => <Badge tone={v ? "done" : "action"}>{label ?? (v ? "OK" : "Not set up")}</Badge>;
  return (
    <Panel title="System status" sub="Live from the server." actions={<Button variant="outline" size="sm" onClick={reload}>Refresh</Button>} pad>
      <dl className="pf-kv">
        <dt>API</dt><dd>{ok(true)} up {Math.round(s.api.uptimeSeconds / 60)} min · {s.api.memoryMb} MB · Node {s.api.node}</dd>
        <dt>Database</dt><dd>{ok(s.database.ok, s.database.ok ? `OK · ${s.database.ms} ms` : "Down")}</dd>
        <dt>Cache</dt><dd>{s.cache.kind === "redis" ? ok(true, "Redis") : <Badge tone="neutral">In memory (fine for one server)</Badge>}</dd>
        <dt>Email</dt><dd>{s.email.queued} waiting · {s.email.failedToday} failed today · {s.email.mailServerQueue} in the mail server queue</dd>
        <dt>AI</dt><dd>{ok(s.ai.configured)} {s.ai.requestsToday} requests today · {s.ai.tokensToday.toLocaleString("en-IN")} tokens</dd>
        <dt>Meta</dt><dd>{ok(s.meta.configured)}</dd>
        <dt>Calendar sync</dt><dd>{s.calendars.feeds} feeds{s.calendars.withErrors ? ` · ${s.calendars.withErrors} with errors` : ""}</dd>
        <dt>Bots today</dt><dd>{Object.entries(s.bots).map(([k, n]) => `${n} ${k.replace("_", " ")}`).join(" · ") || "None"}</dd>
        <dt>Photo storage</dt><dd>{ok(s.storage.media)}</dd>
        <dt>Billing cycle</dt><dd>{s.billingCycle.lastActivity ? `Last change ${fdatetime(s.billingCycle.lastActivity)}` : "Nothing due yet"}</dd>
      </dl>
    </Panel>
  );
}

export function LiveAnalytics() {
  const [days, setDays] = useState(30);
  const [d] = useApi(`/admin/analytics?days=${days}`);
  if (!d) return <p className="muted pf-pad">Loading…</p>;
  const change = d.visitorsBefore ? Math.round(((d.visitors - d.visitorsBefore) / d.visitorsBefore) * 100) : null;
  const max = Math.max(1, ...d.byDay.map((x) => x.visitors));
  return (
    <>
      <div className="pf-row-actions">{[7, 30, 90].map((n) => <Button key={n} size="sm" variant={days === n ? "primary" : "outline"} onClick={() => setDays(n)}>{n} days</Button>)}</div>
      <div className="pf-stats">
        <Stat label="Visitors" value={d.visitors.toLocaleString("en-IN")} note={change === null ? "People, not bots" : `${change >= 0 ? "+" : ""}${change}% on the period before`} />
        <Stat label="Pages seen" value={d.views.toLocaleString("en-IN")} />
        <Stat label="Sign-ups" value={d.signups} />
        <Stat label="Enquiries" value={d.enquiries} />
      </div>
      <Panel title="Visitors per day" pad>
        {!d.byDay.length ? <p className="muted">No visits recorded yet.</p> : <div className="pf-bars" style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 140 }}>{d.byDay.map((x) => <div key={x.day} title={`${x.day}: ${x.visitors} visitors`} style={{ flex: 1, height: `${(x.visitors / max) * 100}%`, minHeight: 2, background: "var(--accent)", borderRadius: 3 }} />)}</div>}
      </Panel>
      <div className="pf-split">
        <Panel title="Most viewed listings" className="grow"><ul className="pf-list">{d.topListings.map((l) => <li key={l.code}><span style={{ flex: 1 }}>{l.title} <small className="muted tnum">{l.code}</small></span><b className="tnum">{l.views}</b></li>)}{!d.topListings.length && <li className="muted">None yet.</li>}</ul></Panel>
        <Panel title="Where visitors come from" className="side"><ul className="pf-list">{d.referrers.map((r) => <li key={r.site}><span style={{ flex: 1 }}>{r.site}</span><b className="tnum">{r.views}</b></li>)}{!d.referrers.length && <li className="muted">Mostly direct.</li>}</ul>
          <p className="small muted pf-pad" style={{ margin: 0 }}>Bots left out: {Object.entries(d.bots).map(([k, n]) => `${n} ${k.replace("_", " ")}`).join(", ") || "none"}.</p></Panel>
      </div>
    </>
  );
}

/** System emails (verify, reset, invites, invoices, reminders) and what happened to each; failed ones can be sent again.
 *  On this computer they are saved instead of sent, and each one can be opened to click its link. */
export function LiveOutbox() {
  const toast = useToast();
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(null);
  const load = () => adminApi("GET", `/admin/email/outbox?status=${status}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`).then(setList).catch((e) => toast(e.message));
  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [status, q]);
  const view = (id) => adminApi("GET", `/admin/email/outbox/${id}`).then((r) => setOpen(r.data)).catch((e) => toast(e.message));
  const resend = (id) => adminApi("POST", `/admin/email/outbox/${id}/resend`).then((r) => { toast(r.message); load(); }).catch((e) => toast(e.message));
  const tone = { sent: "done", failed: "action", deferred: "progress", queued: "neutral", sending: "progress" };
  const c = list?.meta.counts || {};
  return (
    <Panel title="System emails" sub={list?.meta.showText ? "On this computer emails are saved, not sent. Open one to use its link." : "Sent by the mail server. Their text isn't shown, because it holds one-time links."}
      actions={<Button variant="outline" size="sm" onClick={load}>Refresh</Button>} pad>
      <div className="pf-row-actions" style={{ justifyContent: "flex-start", flexWrap: "wrap", marginBottom: 10 }}>
        {["all", "queued", "deferred", "sent", "failed"].map((s) => (
          <button key={s} type="button" className={`chip ${status === s ? "active" : ""}`} aria-pressed={status === s} onClick={() => setStatus(s)}>
            {s === "all" ? "All" : s === "deferred" ? "Trying again" : s[0].toUpperCase() + s.slice(1)}{s !== "all" && c[s] ? ` · ${c[s]}` : ""}
          </button>
        ))}
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by email or subject" style={{ maxWidth: 260 }} aria-label="Search system emails" />
      </div>
      {!list ? <p className="muted">Loading…</p> : !list.data.length ? <p className="muted">No emails here.</p> : (
        <div className="pf-table-wrap"><table className="table">
          <thead><tr><th>To</th><th>Subject</th><th>Status</th><th>When</th><th /></tr></thead>
          <tbody>{list.data.map((e) => (
            <tr key={e.id}>
              <td>{e.to}</td><td>{e.subject}</td>
              <td><Badge tone={tone[e.status] || "neutral"}>{e.status === "deferred" ? `Trying again (${e.attempts})` : e.status}</Badge>{e.error && <div className="small muted" style={{ maxWidth: 320 }}>{e.error}</div>}</td>
              <td className="tnum small">{fdatetime(e.sentAt || e.createdAt)}</td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                {list.meta.showText && <Button size="sm" variant="ghost" onClick={() => view(e.id)}>Open</Button>}
                {["failed", "deferred"].includes(e.status) && <Button size="sm" variant="outline" onClick={() => resend(e.id)}>Send again</Button>}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {open && (
        <div className="card pf-pad" style={{ marginTop: 12 }}>
          <div className="pf-row-actions" style={{ justifyContent: "space-between" }}><b>{open.subject}</b><Button size="sm" variant="ghost" onClick={() => setOpen(null)}>Close</Button></div>
          <p className="small muted">To {open.to} · {fdatetime(open.createdAt)}{open.response ? ` · ${open.response}` : ""}</p>
          {/* Links in the text are clickable, so a verify or reset link can be used while testing. */}
          <pre style={{ whiteSpace: "pre-wrap", font: "inherit", margin: 0 }}>{open.text.split(/(https?:\/\/\S+)/g).map((part, i) => (/^https?:\/\//.test(part) ? <a key={i} href={part} target="_blank" rel="noreferrer">{part}</a> : part))}</pre>
        </div>
      )}
    </Panel>
  );
}
