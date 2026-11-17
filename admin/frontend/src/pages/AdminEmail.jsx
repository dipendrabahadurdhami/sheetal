// Super Admin → Email: is Sheetal's email connected and working, and what happened to the latest system emails (password resets, invites, invoices).
// Where it fits: /admin/email (AdminApp.jsx). The data comes from GET /admin/email/overview; "Check again" and "Check now" re-read DNS; the test email goes
// through the real mail server. The list of system emails at the bottom (with "Send again") is the same one as in System status.
// Rules: staff with settings access only; no email text and no keys are shown; each action says in words what happened.

import React, { useCallback, useEffect, useState } from "react";
import { Badge, Button, Input, PageHead, Panel, useToast } from "@sheetal/shared/core/ui";
import { adminApi } from "../api";
import { LiveOutbox } from "./LiveSetup";
import { checkBadge, domainState, headline, since } from "./emailWords.js";

export function AdminEmail() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState("");
  const [to, setTo] = useState("");
  const load = useCallback(() => adminApi("GET", "/admin/email/overview").then((r) => { setD(r.data); setErr(null); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const head = <PageHead title="Email" sub="Is your email connected and working, and what happened to the latest password resets and invites" />;
  if (err) return <>{head}<section className="card pf-panel"><p role="alert">{err}</p><Button variant="outline" onClick={load}>Try again</Button></section></>;
  if (!d) return <>{head}<div className="sk" style={{ height: 240, borderRadius: "var(--r)" }} /></>;

  const h = headline(d);
  const run = (key, p) => { setBusy(key); return p.then((r) => { if (r?.message) toast(r.message); return load(); }).catch((e) => toast(e.message)).finally(() => setBusy("")); };
  const recheck = () => {
    const row = d.domains.find((x) => x.isPlatform);
    return row ? run("own", adminApi("POST", `/admin/email/domains/${row.id}/check`)) : run("own", load());
  };
  const sendTest = () => run("test", adminApi("POST", "/admin/email/test", { to })).then(() => setTo(""));
  const s = d.server;
  const tone = { sent: "done", failed: "action", deferred: "progress", queued: "neutral", sending: "progress" };

  return (
    <>
      {head}
      <section className="card pf-panel" style={{ padding: 18 }}>
        <div className="row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
          <div>
            <Badge tone={h.tone}>{h.title}</Badge>
            <p style={{ margin: "8px 0 0" }}>{h.text}</p>
          </div>
          <Button variant="outline" icon="refresh-cw" disabled={busy === "own"} onClick={recheck}>{busy === "own" ? "Checking…" : "Check again"}</Button>
        </div>
      </section>

      <Panel title="Your mailboxes: read and send" sub="Open a mailbox to read, reply or write a new email. It opens in the business Email page, with this same login." pad>
        {!d.mailboxes.length ? <p className="muted">No mailboxes yet. Create them in the business panel: Settings → Domain and email.</p> : (
          <div className="pf-table-wrap"><table className="table">
            <thead><tr><th>Address</th><th>Unread</th><th>In inbox</th><th /></tr></thead>
            <tbody>{d.mailboxes.map((b) => (
              <tr key={b.address}>
                <td><b>{b.address}</b><div className="small muted">{b.name}{b.kind === "shared" ? " · shared" : ""}{b.active ? "" : " · switched off"}</div></td>
                <td>{b.unread ? <Badge tone="action">{b.unread} new</Badge> : "0"}</td>
                <td className="tnum">{b.inbox}</td>
                <td style={{ textAlign: "right" }}><a className="btn btn-outline btn-sm" href="/business/mail">Open</a></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {d.mailboxAccess === false && <p className="small" role="note" style={{ marginTop: 10 }}><b>Your login is not a member of the Sheetal Property business yet</b>, so it cannot open these mailboxes. In the business panel go to Team → Invite, and add this login.</p>}
        <p style={{ marginTop: 12 }}><a className="btn btn-primary" href="/business/mail">Open my mailboxes</a></p>
      </Panel>

      <Panel title={`Your email domain: ${d.platformDomain}`} sub={`Mail host: ${d.mailHost}. Each row is read live from the internet's address book (DNS).`}>
        <div className="pf-table-wrap"><table className="table">
          <thead><tr><th>What</th><th>Status</th><th>What we found</th></tr></thead>
          <tbody>{d.checks.map((c) => {
            const b = checkBadge(c);
            return (
              <tr key={c.id}>
                <td><b>{c.label}</b></td>
                <td><Badge tone={b.tone}>{b.label}</Badge></td>
                <td className="small"><code className="small">{c.detail}</code>{c.status !== "ok" && !(c.optional && c.status === "missing") && <div className="small muted" style={{ marginTop: 4 }}>{c.fix}</div>}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      </Panel>

      <Panel title="Mail server" sub="The program on your server that sends and receives email." pad>
        <dl className="pf-kv">
          <dt>Answers on the mail port</dt><dd>{s.listening === null ? <Badge tone="neutral">Can't tell here</Badge> : <Badge tone={s.listening ? "done" : "action"}>{s.listening ? "Yes" : "No"}</Badge>}</dd>
          <dt>Last email sent</dt><dd>{since(s.lastSentAt)}</dd>
          <dt>Last email received</dt><dd>{since(s.lastReceivedAt)}</dd>
          <dt>Waiting to be sent</dt><dd>{s.waitingToSend}{s.deliveriesWaiting ? ` · ${s.deliveriesWaiting} business emails waiting` : ""}</dd>
          <dt>Failed in the last 24 hours</dt><dd>{s.failedLast24h || s.deliveriesFailedLast24h ? <Badge tone="action">{s.failedLast24h} system · {s.deliveriesFailedLast24h} business</Badge> : "None"}</dd>
          <dt>Mailboxes</dt><dd>{s.mailboxes}</dd>
        </dl>
      </Panel>

      <Panel title="Send a test email" sub="Sends a real email through your mail server. Use your own address, then check your inbox and spam." pad>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <Input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="you@gmail.com" style={{ maxWidth: 320 }} aria-label="Send the test email to" onKeyDown={(e) => e.key === "Enter" && to && sendTest()} />
          <Button icon="send" disabled={!to || busy === "test"} onClick={sendTest}>{busy === "test" ? "Sending…" : "Send test email"}</Button>
        </div>
      </Panel>

      <Panel title="Business domains" sub="Every domain a business connected for its own email." >
        {!d.domains.length ? <p className="muted pf-pad">No business has connected a domain yet.</p> : (
          <div className="pf-table-wrap"><table className="table">
            <thead><tr><th>Domain</th><th>Business</th><th>Status</th><th>Mailboxes</th><th>Last checked</th><th /></tr></thead>
            <tbody>{d.domains.map((x) => {
              const st = domainState(x);
              return (
                <tr key={x.id}>
                  <td><b>{x.name}</b>{x.isPlatform ? <span className="small muted"> · Sheetal's own</span> : null}</td>
                  <td>{x.business || "—"}</td>
                  <td><Badge tone={st.tone}>{st.label}</Badge></td>
                  <td className="tnum">{x.mailboxes}</td>
                  <td className="small">{x.checkedAt ? since(x.checkedAt) : "never"}</td>
                  <td style={{ textAlign: "right" }}><Button size="sm" variant="outline" disabled={busy === x.id} onClick={() => run(x.id, adminApi("POST", `/admin/email/domains/${x.id}/check`))}>{busy === x.id ? "Checking…" : "Check now"}</Button></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </Panel>

      <Panel title="Latest system emails" sub="Password resets, invites, sign-up confirmations. Open the full list below to search or send one again." pad>
        {!d.recent.length ? <p className="muted">Nothing has been sent yet.</p> : (
          <div className="pf-table-wrap"><table className="table">
            <thead><tr><th>To</th><th>Subject</th><th>Status</th><th>When</th></tr></thead>
            <tbody>{d.recent.map((e) => (
              <tr key={e.id}>
                <td>{e.to}</td><td>{e.subject}</td>
                <td><Badge tone={tone[e.status] || "neutral"}>{e.status === "deferred" ? `Trying again (${e.attempts})` : e.status}</Badge>{e.error && <div className="small muted" style={{ maxWidth: 320 }}>{e.error}</div>}</td>
                <td className="small">{since(e.sentAt || e.createdAt)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>

      <LiveOutbox />
    </>
  );
}
