// The Email page: each person's mailbox and the shared ones they answer.
// How it works: owners and managers can open every team mailbox; reading an email lowers the unread count in the top
// bar. Mail between Sheetal mailboxes arrives at once; other mail goes through Sheetal's mail server.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@sheetal/shared/core/router";
import { fdatetime } from "@sheetal/shared/core/format";
import { Badge, Button, Drawer, Empty, Field, Input, PageHead, Select, Textarea, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { bizApi, bizApiReady, fileToBase64, formatBytes, signedIn } from "../api";
import { mailCountRefresh } from "../live";

const FOLDERS = [["inbox", "Inbox", "inbox"], ["sent", "Sent", "send"], ["drafts", "Drafts", "file-pen-line"], ["archive", "Archive", "archive"], ["spam", "Spam", "shield-alert"], ["trash", "Trash", "trash-2"]];
const MAX_ATTACH = 20 * 1024 * 1024;
const splitList = (s) => s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);

export function Mail() {
  const [ov, setOv] = useState(null);
  const [err, setErr] = useState(null);
  const load = useCallback(() => bizApi("GET", "/mail").then((r) => { setOv(r.data); setErr(null); }).catch(setErr), []);
  useEffect(() => { if (bizApiReady() && signedIn()) load(); }, [load]);

  const head = <PageHead title="Email" sub="Your team's mailboxes on your own domain" />;
  if (!bizApiReady()) return <>{head}<Notice icon="plug" title="Email isn't connected here yet">The business API address is missing (VITE_BUSINESS_API_URL).</Notice></>;
  if (!signedIn() || err?.status === 401) return <>{head}<Notice icon="log-in" title="Sign in to use email" action={<a className="btn btn-primary" href="/">Sign in on the website</a>}>Email uses your Sheetal account. Sign in on the website, then come back.</Notice></>;
  if (err) return <>{head}<Notice icon="circle-alert" title="Email couldn't load" action={<Button variant="outline" onClick={load}>Try again</Button>}>{err.message}</Notice></>;
  if (!ov) return <>{head}<div className="sk" style={{ height: 420, borderRadius: "var(--r)" }} /></>;
  if (!ov.paid) return <>{head}<Notice icon="mail" title="Team email is on Business and Pro" action={<Link to="/business/billing" className="btn btn-primary">See plans</Link>}>A mailbox for everyone in your team on your own domain, shared addresses like info@, and 1 GB of storage.</Notice></>;
  if (!ov.mailboxes.length) return <>{head}<Notice icon="mail-plus" title="No mailboxes yet"
    action={ov.canManage ? <Link to="/business/domains" className="btn btn-primary">Set up email</Link> : null}>
    {ov.canManage ? "Connect your domain and create a mailbox for each team member." : "Ask your manager to give you a mailbox."}</Notice></>;
  return <>{head}<MailApp ov={ov} reload={load} /></>;
}

function Notice({ icon, title, children, action }) {
  return <section className="card pf-panel"><Empty icon={icon} title={title} action={action}>{children}</Empty></section>;
}

function MailApp({ ov, reload }) {
  const toast = useToast();
  const mine = ov.mailboxes.find((m) => m.mine) || ov.mailboxes[0];
  const [boxId, setBoxId] = useState(mine.id);
  const [folder, setFolder] = useState("inbox");
  const [q, setQ] = useState("");
  const [list, setList] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [compose, setCompose] = useState(null);
  const box = ov.mailboxes.find((m) => m.id === boxId) || mine;

  const loadList = useCallback(() => {
    setList(null);
    bizApi("GET", `/mail/mailboxes/${box.id}/messages?folder=${folder}${q ? `&q=${encodeURIComponent(q)}` : ""}`).then(setList).catch((e) => { toast(e.message); setList({ data: [], unread: {}, meta: { total: 0 } }); });
  }, [box.id, folder, q]);
  useEffect(() => { loadList(); setOpenId(null); }, [loadList]);

  const refresh = () => { loadList(); reload(); };
  // Opening an unread email lowers the counts at once, without reloading the list.
  const markRead = (id) => setList((l) => {
    const row = l?.data.find((x) => x.id === id);
    if (!row || row.seen) return l;
    // The Email button in the top bar counts down too (once the server has marked it read).
    setTimeout(mailCountRefresh, 800);
    return { ...l, data: l.data.map((x) => (x.id === id ? { ...x, seen: true } : x)), unread: { ...l.unread, [folder]: Math.max(0, (l.unread[folder] || 0) - 1) } };
  });
  const groups = [["Your mailbox", ov.mailboxes.filter((m) => m.mine)], ["Shared", ov.mailboxes.filter((m) => m.kind === "shared")], ["Team", ov.mailboxes.filter((m) => !m.mine && m.kind !== "shared")]].filter(([, l]) => l.length);
  const pct = ov.quota.limit ? Math.min(100, Math.round((ov.quota.used / ov.quota.limit) * 100)) : 0;

  return (
    <div className="mail-shell card">
      <aside className="mail-side">
        <Button icon="pen-line" block onClick={() => setCompose({ mailboxId: box.id })}>Write</Button>
        <Field label="Mailbox">
          <Select value={box.id} onChange={(v) => { setBoxId(v); setFolder("inbox"); }}
            options={groups.flatMap(([g, l]) => l.map((m) => ({ id: m.id, label: `${g === "Team" ? "Team · " : g === "Shared" ? "Shared · " : ""}${m.address}${m.unread ? ` (${m.unread})` : ""}` })))} />
        </Field>
        <nav className="mail-folders" aria-label="Folders">
          {FOLDERS.map(([id, label, icon]) => (
            <button key={id} type="button" className={folder === id ? "on" : ""} onClick={() => setFolder(id)}>
              <Icon name={icon} size={16} /><span>{label}</span>{list?.unread?.[id] && id !== "sent" ? <b className="tnum">{list.unread[id]}</b> : null}
            </button>
          ))}
        </nav>
        <div className="mail-quota">
          <div className="row between small"><span>Storage</span><span className="tnum muted">{formatBytes(ov.quota.used)} of {formatBytes(ov.quota.limit)}</span></div>
          <div className="bar" style={{ height: 6 }}><i style={{ width: `${pct}%`, background: pct > 90 ? "var(--c-red)" : undefined }} /></div>
          {pct > 90 && <span className="small" style={{ color: "var(--c-red)" }}>Almost full: empty Trash or delete large mail.</span>}
        </div>
      </aside>

      <section className="mail-list">
        <div className="mail-search"><Icon name="search" size={16} /><input className="input" placeholder={`Search ${FOLDERS.find((f) => f[0] === folder)[1].toLowerCase()}`} defaultValue={q}
          onKeyDown={(e) => e.key === "Enter" && setQ(e.currentTarget.value.trim())} onBlur={(e) => e.currentTarget.value.trim() !== q && setQ(e.currentTarget.value.trim())} /></div>
        {!list ? <div className="mail-empty muted small">Loading…</div>
          : !list.data.length ? <div className="mail-empty"><Empty icon="inbox" title={q ? "Nothing matches" : `${FOLDERS.find((f) => f[0] === folder)[1]} is empty`} /></div>
          : <ul>{list.data.map((m) => (
            <li key={m.id}>
              <button type="button" className={`mail-row ${openId === m.id ? "on" : ""} ${m.seen ? "" : "unread"}`}
                onClick={() => (folder === "drafts"
                  ? bizApi("GET", `/mail/messages/${m.id}`).then(({ data: d }) => setCompose({ mailboxId: box.id, draftId: d.id, to: d.to.join(", "), cc: d.cc.join(", "), subject: d.subject, text: d.text })).catch((e) => toast(e.message))
                  : setOpenId(m.id))}>
                <span className="mail-row-top"><b>{folder === "sent" || folder === "drafts" ? `To: ${m.to.join(", ") || "—"}` : m.fromName || m.fromAddress}</b><small className="tnum">{fdatetime(m.sentAt || m.createdAt)}</small></span>
                <span className="mail-row-subject">{m.starred && <Icon name="star" size={13} />}{m.subject || "(no subject)"}{m.attachments ? <Icon name="paperclip" size={13} /> : null}</span>
                <span className="small muted mail-row-snippet">{m.snippet}</span>
                {m.status === "queued" && <Badge tone="progress">Sending</Badge>}{m.status === "failed" && <Badge tone="problem">Not delivered</Badge>}
              </button>
            </li>))}</ul>}
      </section>

      <section className="mail-read">
        {openId ? <Reader id={openId} box={box} folder={folder} onChanged={() => { setOpenId(null); refresh(); }} onWrite={setCompose} onOpened={markRead} />
          : <div className="mail-empty"><Empty icon="mail-open" title="Choose an email to read" /></div>}
      </section>

      {compose && <Compose init={compose} mailboxes={ov.mailboxes} onClose={() => setCompose(null)} onSent={() => { setCompose(null); refresh(); }} />}
    </div>
  );
}

function Reader({ id, box, folder, onChanged, onWrite, onOpened }) {
  const toast = useToast();
  const [m, setM] = useState(null);
  useEffect(() => { setM(null); bizApi("GET", `/mail/messages/${id}`).then((r) => { setM(r.data); onOpened(id); }).catch((e) => toast(e.message)); }, [id]);
  if (!m) return <div className="mail-empty muted small">Loading…</div>;

  const act = (fn, msg) => fn.then((r) => { toast(r?.message || msg); onChanged(); }).catch((e) => toast(e.message));
  const move = (to) => act(bizApi("PATCH", `/mail/messages/${m.id}`, { folder: to }));
  const quoted = `\n\nOn ${fdatetime(m.sentAt || m.createdAt)}, ${m.fromName || m.fromAddress} wrote:\n${m.text.split("\n").map((l) => `> ${l}`).join("\n")}`;
  const re = (s) => (/^re:/i.test(s) ? s : `Re: ${s}`);
  const download = (a) => bizApi("GET", `/mail/attachments/${a.id}`).then((blob) => { const u = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = u; link.download = a.filename; link.click(); URL.revokeObjectURL(u); }).catch((e) => toast(e.message));

  return (
    <article className="mail-message">
      <div className="mail-actions">
        <Button size="sm" icon="reply" onClick={() => onWrite({ mailboxId: box.id, replyTo: m.id, to: m.fromAddress === box.address ? m.to.join(", ") : m.fromAddress, subject: re(m.subject), text: quoted })}>Reply</Button>
        <Button size="sm" variant="outline" icon="reply-all" onClick={() => onWrite({ mailboxId: box.id, replyTo: m.id, to: [m.fromAddress, ...m.to].filter((a) => a !== box.address).join(", "), cc: m.cc.join(", "), subject: re(m.subject), text: quoted })}>Reply all</Button>
        <Button size="sm" variant="outline" icon="forward" onClick={() => onWrite({ mailboxId: box.id, subject: `Fwd: ${m.subject}`, text: `\n\n---------- Forwarded message ----------\nFrom: ${m.fromName || ""} <${m.fromAddress}>\nSubject: ${m.subject}\n\n${m.text}` })}>Forward</Button>
        <span className="grow" />
        <button className="btn btn-ghost btn-icon" title={m.starred ? "Unstar" : "Star"} aria-label="Star" onClick={() => act(bizApi("PATCH", `/mail/messages/${m.id}`, { starred: !m.starred }), "Saved")}><Icon name="star" size={16} /></button>
        <button className="btn btn-ghost btn-icon" title="Mark unread" aria-label="Mark unread" onClick={() => act(bizApi("PATCH", `/mail/messages/${m.id}`, { seen: false }), "Marked unread")}><Icon name="mail" size={16} /></button>
        {folder !== "archive" && folder !== "sent" && <button className="btn btn-ghost btn-icon" title="Archive" aria-label="Archive" onClick={() => move("archive")}><Icon name="archive" size={16} /></button>}
        {folder === "spam" ? <button className="btn btn-ghost btn-icon" title="Not spam" aria-label="Not spam" onClick={() => move("inbox")}><Icon name="inbox" size={16} /></button>
          : folder === "inbox" && <button className="btn btn-ghost btn-icon" title="Spam" aria-label="Spam" onClick={() => move("spam")}><Icon name="shield-alert" size={16} /></button>}
        {(folder === "trash" || folder === "archive") && <button className="btn btn-ghost btn-icon" title="Back to Inbox" aria-label="Back to Inbox" onClick={() => move("inbox")}><Icon name="undo-2" size={16} /></button>}
        <button className="btn btn-ghost btn-icon" title={folder === "trash" ? "Delete for good" : "Delete"} aria-label="Delete" onClick={() => act(bizApi("DELETE", `/mail/messages/${m.id}`))}><Icon name="trash-2" size={16} /></button>
      </div>
      <h2 className="mail-subject">{m.subject || "(no subject)"}</h2>
      <div className="mail-meta">
        <b>{m.fromName || m.fromAddress}</b> <span className="muted small">&lt;{m.fromAddress}&gt;</span>
        <div className="small muted">To {m.to.join(", ")}{m.cc.length ? ` · Cc ${m.cc.join(", ")}` : ""} · {fdatetime(m.sentAt || m.createdAt)}</div>
      </div>
      {/* HTML is cleaned on the server; it's shown in a sandboxed frame so it can't run anything. */}
      {m.html ? <iframe className="mail-body-frame" title="Email" sandbox="" srcDoc={`<base target="_blank"><style>body{font-family:system-ui,sans-serif;font-size:14px;line-height:1.55;color:#333;margin:0;word-wrap:break-word}img{max-width:100%}</style>${m.html}`} />
        : <pre className="mail-body">{m.text}</pre>}
      {m.attachments.length > 0 && <div className="pf-chips">{m.attachments.map((a) => <button key={a.id} type="button" className="chip" onClick={() => download(a)}><Icon name="paperclip" size={14} />{a.filename} · {formatBytes(a.size)}</button>)}</div>}
      {m.thread.length > 1 && <div className="mail-thread"><b className="small">In this conversation</b>{m.thread.map((t) => <div key={t.id} className={`small ${t.id === m.id ? "" : "muted"}`}>{fdatetime(t.createdAt)} · {t.fromName || t.fromAddress}: {t.snippet}</div>)}</div>}
    </article>
  );
}

function Compose({ init, mailboxes, onClose, onSent }) {
  const toast = useToast();
  const [f, setF] = useState({ mailboxId: init.mailboxId, to: init.to || "", cc: init.cc || "", bcc: "", subject: init.subject || "", text: init.text || "" });
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const draftId = useRef(init.draftId);
  const set = (k) => (e) => setF({ ...f, [k]: e.target ? e.target.value : e });
  const total = files.reduce((s, x) => s + x.size, 0);

  const payload = () => ({ mailboxId: f.mailboxId, to: splitList(f.to), cc: splitList(f.cc), bcc: splitList(f.bcc), subject: f.subject, text: f.text });
  const send = async () => {
    setBusy(true); setErrors({});
    try {
      const attachments = await Promise.all(files.map(async (x) => ({ filename: x.name, contentType: x.type || "application/octet-stream", data: await fileToBase64(x) })));
      const r = await bizApi("POST", "/mail/send", { ...payload(), replyTo: init.replyTo, draftId: draftId.current, attachments });
      toast(r.message); onSent();
    } catch (e) { setErrors(e.errors || {}); toast(e.message); }
    setBusy(false);
  };
  const saveDraft = async () => {
    try { const r = await bizApi("POST", "/mail/drafts", { ...payload(), id: draftId.current }); draftId.current = r.data.id; toast("Draft saved"); onSent(); }
    catch (e) { toast(e.message); }
  };
  const addFiles = (list) => {
    const next = [...files, ...list];
    if (next.reduce((s, x) => s + x.size, 0) > MAX_ATTACH) { toast("Attachments can be up to 20 MB in one email."); return; }
    setFiles(next);
  };

  return (
    <Drawer open onClose={onClose} title={init.replyTo ? "Reply" : init.draftId ? "Draft" : "New email"}
      footer={<><Button variant="ghost" onClick={saveDraft}>Save draft</Button><span className="grow" /><Button variant="outline" onClick={onClose}>Cancel</Button><Button icon="send" disabled={busy} onClick={send}>{busy ? "Sending…" : "Send"}</Button></>}>
      <div className="pf-stack">
        <Field label="From"><Select value={f.mailboxId} onChange={set("mailboxId")} options={mailboxes.filter((m) => m.active).map((m) => ({ id: m.id, label: `${m.name} <${m.address}>` }))} /></Field>
        <Field label="To" hint="Separate addresses with commas" error={errors.to?.[0]}><Input value={f.to} onChange={set("to")} placeholder="name@example.com" autoFocus /></Field>
        <div className="pf-grid-2 tight"><Field label="Cc" optional><Input value={f.cc} onChange={set("cc")} /></Field><Field label="Bcc" optional><Input value={f.bcc} onChange={set("bcc")} /></Field></div>
        <Field label="Subject"><Input value={f.subject} onChange={set("subject")} /></Field>
        <Field label="Message"><Textarea rows={12} value={f.text} onChange={set("text")} style={{ minHeight: 220 }} /></Field>
        <div className="pf-chips">
          {files.map((x, i) => <span key={i} className="chip">{x.name} · {formatBytes(x.size)}<button type="button" className="btn btn-ghost btn-icon" aria-label={`Remove ${x.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}><Icon name="x" size={12} /></button></span>)}
          <label className="btn btn-outline btn-sm"><input type="file" multiple hidden onChange={(e) => { addFiles([...e.target.files]); e.target.value = ""; }} /><Icon name="paperclip" size={14} />Attach</label>
          {files.length > 0 && <span className="small muted tnum">{formatBytes(total)} of 20 MB</span>}
        </div>
      </div>
    </Drawer>
  );
}
