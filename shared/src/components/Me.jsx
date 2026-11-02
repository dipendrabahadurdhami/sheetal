import React, { useMemo, useState } from "react";
import { useStore } from "../core/store";
import { useRouter } from "../core/router";
import { LANGS } from "../core/i18n";
import { fdatetime } from "../core/format";
import { Avatar, Badge, Button, Confirm, Field, Input, PageHead, Panel, SaveBar, Seg, Tabs, ToggleRow, useToast } from "../core/ui";
import { Icon } from "../core/icons";

/* ───────── Notifications: one store, one bell, one page, for admin and every workspace ───────── */
const KINDS = { booking: "Bookings", payment: "Payments", message: "Messages", team: "Team", system: "System" };
const ICON = { booking: "clipboard-list", payment: "wallet", message: "messages-square", team: "users", system: "shield-check" };

export function businessSeed(tenant) {
  return [
    { id: "n1", kind: "booking", title: "New booking BK-2027-0418 for 12–15 Mar", to: "/business/bookings", at: "2027-03-02T09:50", unread: true },
    { id: "n2", kind: "message", title: "3 new WhatsApp messages", to: "/business/inbox", at: "2027-03-02T09:28", unread: true },
    { id: "n3", kind: "payment", title: "Payment Rs. 14,916 received for BK-2027-0412", to: "/business/invoices", at: "2027-03-02T08:12", unread: false },
    { id: "n4", kind: "team", title: "Anjali Rai asked for 1 day of leave", to: "/business/team", at: "2027-03-01T18:40", unread: false },
    { id: "n5", kind: "system", title: `${tenant.name}: plan renews soon`, to: "/business/billing", at: "2027-03-01T09:00", unread: false },
    { id: "n6", kind: "payment", title: "Payout of Rs. 4,82,300 sent to NIC Asia", to: "/business/payouts", at: "2027-02-28T16:00", unread: false },
  ];
}

// Admin bell is built from what is actually waiting on the platform.
export function adminLive(db) {
  const out = [];
  db.tenants.filter((x) => x.status === "pending_verification").forEach((x) => out.push({ id: `kyc-${x.id}`, kind: "system", title: `${x.name} is waiting for verification`, to: `/admin/tenants/${x.id}`, at: `${x.since}T10:00`, unread: true }));
  db.tenants.filter((x) => x.status === "past_due").forEach((x) => out.push({ id: `due-${x.id}`, kind: "payment", title: `${x.name}: subscription payment overdue`, to: `/admin/tenants/${x.id}`, at: `${x.renews}T09:00`, unread: true }));
  db.tenants.filter((x) => x.status === "trial").forEach((x) => out.push({ id: `trial-${x.id}`, kind: "system", title: `${x.name}: trial ends ${x.renews}`, to: `/admin/tenants/${x.id}`, at: `${x.since}T09:00`, unread: false }));
  (db.customer?.orders || []).filter((o) => o.status === "refund_pending" || o.problem).forEach((o) => out.push({ id: `ord-${o.code}`, kind: "payment", title: o.problem ? `Problem reported on ${o.code}` : `Refund to approve for ${o.code}`, to: "/admin/billing", at: o.at || "2027-03-02T08:00", unread: true }));
  (db.campaigns || []).filter((c) => c.status === "review").forEach((c) => out.push({ id: `ad-${c.id}`, kind: "system", title: `Ad ${c.id} waiting for review: ${c.title}`, to: "/admin/ads", at: `${c.from}T08:00`, unread: true }));
  (db.platformActivity || []).slice(0, 3).forEach((a) => out.push({ id: `act-${a.id}`, kind: "team", title: `${a.who} ${a.what}`, to: "/admin/audit", at: a.at, unread: false }));
  if (!out.some((x) => x.kind === "payment")) out.push({ id: "ads-cpl", kind: "payment", title: "Ad AD-124 paid Rs. 17,500, waiting for review", to: "/admin/ads", at: "2027-03-02T08:30", unread: true });
  return out.sort((a, b) => (b.unread - a.unread) || String(b.at).localeCompare(String(a.at)));
}

export function useNotifs(scope, base) {
  const { db, update } = useStore();
  const state = db.notifState?.[scope] || {};
  const list = useMemo(() => base.filter((n) => !state.cleared?.includes(n.id)).map((n) => ({ ...n, icon: n.icon || ICON[n.kind], unread: state.read?.includes(n.id) ? false : n.unread, when: n.when || fdatetime(n.at) })), [base, state]);
  const patch = (fn) => update((d) => { d.notifState = d.notifState || {}; const s = (d.notifState[scope] = d.notifState[scope] || { read: [], cleared: [] }); fn(s); });
  return {
    list,
    unread: list.filter((n) => n.unread).length,
    read: (id) => patch((s) => { if (!s.read.includes(id)) s.read.push(id); }),
    readAll: () => patch((s) => { s.read = [...new Set([...s.read, ...list.map((n) => n.id)])]; }),
    clear: (id) => patch((s) => { s.cleared.push(id); }),
  };
}

export function NotificationsPage({ notifs, prefsTo }) {
  const { navigate } = useRouter();
  const [f, setF] = useState("all");
  const rows = notifs.list.filter((n) => (f === "all" ? true : f === "unread" ? n.unread : n.kind === f));
  return (
    <>
      <PageHead title="Notifications" sub={notifs.unread ? `${notifs.unread} unread` : "You're all caught up"}
        actions={<><Button variant="outline" icon="check-check" disabled={!notifs.unread} onClick={notifs.readAll}>Mark all read</Button>{prefsTo && <Button variant="ghost" icon="settings" onClick={() => navigate(prefsTo)}>Notification settings</Button>}</>} />
      <Tabs value={f} onChange={setF} tabs={[{ id: "all", label: "All", count: notifs.list.length }, { id: "unread", label: "Unread", count: notifs.unread }, ...Object.entries(KINDS).filter(([k]) => notifs.list.some((n) => n.kind === k)).map(([k, l]) => ({ id: k, label: l, icon: ICON[k] }))]} />
      <section className="card pf-panel">
        {rows.length ? <ul className="pf-notif-page">{rows.map((n) => (
          <li key={n.id} className={n.unread ? "unread" : undefined}>
            <button type="button" className="pf-notif-main" onClick={() => { notifs.read(n.id); navigate(n.to); }}>
              <span className="pf-li-ico"><Icon name={n.icon} size={16} /></span>
              <span className="pf-two"><b>{n.title}</b><small className="tnum">{KINDS[n.kind]} · {n.when}</small></span>
              {n.unread && <span className="pf-dot" aria-label="Unread" />}
            </button>
            <div className="pf-row-actions">
              {n.unread && <button type="button" className="btn btn-ghost btn-icon" aria-label="Mark read" title="Mark read" onClick={() => notifs.read(n.id)}><Icon name="check" size={16} /></button>}
              <button type="button" className="btn btn-ghost btn-icon" aria-label="Remove" title="Remove" onClick={() => notifs.clear(n.id)}><Icon name="x" size={16} /></button>
            </div>
          </li>
        ))}</ul> : <div className="pf-empty"><Icon name="bell" size={36} /><h3>Nothing here</h3><p>New bookings, payments, messages and team requests appear here.</p></div>}
      </section>
    </>
  );
}

/* ───────── Notification preferences: one layout for staff, businesses and customers ───────── */
export const PREF_EVENTS = [["booking", "New booking or enquiry"], ["payment", "Payment received or failed"], ["message", "New message or lead"], ["team", "Team requests (leave, invites)"], ["system", "Plan, security and account"]];
// No SMS service for now: WhatsApp carries those messages.
const CHANNELS = [["app", "App"], ["email", "Email"], ["wa", "WhatsApp"]];
export function NotifPrefs({ value, onChange, events = PREF_EVENTS }) {
  const v = value || {};
  const get = (e, c) => v[e]?.[c] ?? (c === "app" || c === "email");
  return (
    <div className="pf-stack">
      <div className="pf-notif-grid" role="table" aria-label="Notification settings">
        <div role="row" className="head"><span role="columnheader">What</span>{CHANNELS.map(([c, l]) => <span key={c} role="columnheader">{l}</span>)}</div>
        {events.map(([e, l]) => <div role="row" key={e}><span role="cell">{l}</span>{CHANNELS.map(([c, cl]) => <span role="cell" key={c}><input type="checkbox" checked={get(e, c)} aria-label={`${l}: ${cl}`} onChange={(ev) => onChange({ ...v, [e]: { ...(v[e] || {}), [c]: ev.target.checked } })} /></span>)}</div>)}
      </div>
      <ToggleRow title="Quiet hours" sub="No WhatsApp alerts from 22:00 to 07:00" checked={v.quiet ?? true} onChange={(x) => onChange({ ...v, quiet: x })} />
      <ToggleRow title="Daily summary" sub="One email at 08:00 with what needs you today" checked={v.daily ?? true} onChange={(x) => onChange({ ...v, daily: x })} />
    </div>
  );
}

/* ───────── My profile: the signed-in person, in admin or any workspace ───────── */
const DEVICES = [
  ["laptop", "Chrome on Windows", "Kathmandu · this device", "2027-03-02T10:00", true],
  ["smartphone", "Sheetal app on Android", "Pokhara", "2027-03-02T07:12", false],
  ["tablet", "Safari on iPad", "Lalitpur", "2027-02-26T19:40", false],
];
export function MyProfile({ scope, roleLabel, access, homeTo }) {
  const { db, update } = useStore();
  const toast = useToast();
  const s = db.session;
  const me = db.me?.[scope] || { name: s.userName, email: s.userEmail, phone: "980-1136817", title: roleLabel, photo: null, twofa: true, prefs: {} };
  const [f, setF] = useState(me);
  const [tab, setTab] = useState("profile");
  const [pw, setPw] = useState({ cur: "", next: "", again: "" });
  const [devices, setDevices] = useState(DEVICES);
  const [askDelete, setAskDelete] = useState(false);
  const dirty = JSON.stringify(f) !== JSON.stringify(me);
  const save = (next = f) => { update((d) => { d.me = d.me || {}; d.me[scope] = next; d.session.userName = next.name; d.session.userEmail = next.email; }); toast("Profile saved"); };
  const pwErr = pw.next && pw.next.length < 8 ? "At least 8 characters" : pw.again && pw.again !== pw.next ? "Passwords don't match" : null;
  return (
    <>
      <PageHead title="My profile" sub="Your own details. Business and platform settings are separate."
        actions={tab === "profile" && !dirty && <span className="small muted">All changes saved</span>} />
      <div className="pf-me-head card pf-pad">
        <label className="pf-me-photo" title="Change photo">
          {f.photo ? <img src={f.photo} alt="" /> : <Avatar name={f.name} size={72} />}
          <span><Icon name="camera" size={14} /></span>
          <input type="file" accept="image/*" hidden onChange={(e) => { const file = e.target.files[0]; if (file) setF({ ...f, photo: URL.createObjectURL(file) }); }} />
        </label>
        <div className="pf-two"><b style={{ fontSize: 18 }}>{f.name}</b><small>{f.email}</small><span className="pf-chips" style={{ marginTop: 6 }}><Badge tone="neutral" icon="key-round">{roleLabel}</Badge>{access && <Badge tone="neutral" icon="git-branch">{access}</Badge>}{me.twofa && <Badge tone="done" icon="shield-check">Two-step on</Badge>}</span></div>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "profile", label: "Profile", icon: "user" }, { id: "security", label: "Sign-in and security", icon: "shield-check" }, { id: "notifications", label: "Notifications", icon: "bell" }, { id: "prefs", label: "Language and display", icon: "languages" }, { id: "data", label: "Your data", icon: "database" }]} />
      {tab === "profile" && <Panel title="Your details" pad><div className="pf-stack">
        <div className="pf-grid-2 tight"><Field label="Full name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field><Field label="Job title" optional><Input value={f.title || ""} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field></div>
        <div className="pf-grid-2 tight"><Field label="Email" hint="Used to sign in"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field><Field label="Mobile" hint="For sign-in codes and urgent alerts"><Input className="input tnum" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field></div>
      </div></Panel>}
      {tab === "security" && <div className="pf-split">
        <Panel title="Change password" className="grow" pad><div className="pf-stack">
          <Field label="Current password"><Input type="password" value={pw.cur} onChange={(e) => setPw({ ...pw, cur: e.target.value })} autoComplete="current-password" /></Field>
          <div className="pf-grid-2 tight"><Field label="New password" error={pw.next && pw.next.length < 8 ? pwErr : null}><Input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" /></Field><Field label="Type it again" error={pw.again && pw.again !== pw.next ? pwErr : null}><Input type="password" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} autoComplete="new-password" /></Field></div>
          <div><Button disabled={!pw.cur || !pw.next || !!pwErr || pw.again !== pw.next} onClick={() => { setPw({ cur: "", next: "", again: "" }); toast("Password changed. Other devices are signed out."); }}>Change password</Button></div>
          <ToggleRow title="Two-step sign-in" sub="A code by SMS each time you sign in on a new device" checked={!!me.twofa} onChange={(v) => save({ ...f, twofa: v })} />
        </div></Panel>
        <Panel title="Where you're signed in" className="side"><ul className="pf-list">{devices.map(([ic, n, where, at, cur]) => (
          <li key={n}><span className="pf-li-ico"><Icon name={ic} size={16} /></span><div><b>{n}</b><span className="small muted tnum">{where} · {fdatetime(at)}</span></div>
            {cur ? <Badge tone="done">This device</Badge> : <Button variant="ghost" size="sm" onClick={() => { setDevices(devices.filter((d) => d[1] !== n)); toast("Signed out of that device"); }}>Sign out</Button>}</li>
        ))}</ul>{devices.length > 1 && <div className="pf-pad"><Button variant="outline" block icon="log-out" onClick={() => { setDevices(devices.filter((d) => d[4])); toast("Signed out of all other devices"); }}>Sign out of all other devices</Button></div>}</Panel>
      </div>}
      {tab === "notifications" && <Panel title="What you hear about" sub="Just for you. Your team members choose their own." pad>
        <NotifPrefs value={me.prefs} onChange={(p) => save({ ...f, prefs: p })} />
      </Panel>}
      {tab === "prefs" && <Panel title="Language and display" pad><div className="pf-stack">
        <Field label="Language"><Seg value={s.lang} onChange={(v) => update((d) => { d.session.lang = v; })} options={LANGS.map((l) => ({ id: l.id, label: l.label }))} /></Field>
        <Field label="Theme"><Seg value={s.theme} onChange={(v) => update((d) => { d.session.theme = v; })} options={[{ id: "light", label: "Light", icon: "sun" }, { id: "dark", label: "Dark", icon: "moon" }, { id: "red", label: "Red", icon: "droplet" }]} /></Field>
        <ToggleRow title="Show Bikram Sambat dates" sub="Next to every English date" checked={me.bs ?? true} onChange={(v) => save({ ...f, bs: v })} />
        {homeTo && <p className="pf-hint"><Icon name="info" size={13} />Business-wide settings (branding, payments, receipts) are in Settings.</p>}
      </div></Panel>}
      {tab === "data" && <Panel title="Your data" sub="Get a copy of what we hold about you, or close your account." pad><div className="pf-stack">
        <div className="pf-row-actions" style={{ justifyContent: "flex-start" }}>
          <Button variant="outline" icon="download" onClick={() => toast("We'll email you a copy of your data within 24 hours")}>Download my data</Button>
          <Button variant="outline" className="pf-danger" onClick={() => setAskDelete(true)}>Delete my account</Button>
        </div>
        <p className="pf-hint"><Icon name="info" size={13} />Records you created for a business stay with that business. Your personal details are removed.</p>
      </div></Panel>}
      {tab === "profile" && <SaveBar dirty={dirty} disabled={!f.name.trim()} onSave={() => save()} onDiscard={() => setF(me)} />}
      <Confirm open={askDelete} onClose={() => setAskDelete(false)} onConfirm={() => toast("Request sent. We'll confirm by email within 7 days.")} title="Delete your account?" confirmLabel="Delete account" danger>You will be signed out everywhere. This can't be undone.</Confirm>
    </>
  );
}
