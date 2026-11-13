// Attendance and leave on the business API (Business → Team → Attendance).
// Where it fits: moved from business/frontend/src/pages/LivePeople.jsx (P2-W2); shown in the Attendance tab of TeamHub (BusinessPages.jsx) through the shim left there. On the kit (@sheetal/ui, @sheetal/sdk).
// How it works: four tabs. Today: check in and out, your leave balances and your leave requests. Board: who is in, late, on
// leave or absent on a day, with fixing and adding records (with a reason). Leave: requests to approve or decline. Month:
// days present, late and leave per person, with a CSV download. Leave types and the start time are under Month → Settings.
// Rules: nothing is worked out in the browser; the server decides late, days and balances. Only people with the manage
// permission see the buttons that change records, and only people with the view permission see Board, Leave and Month.

import React, { useEffect, useState } from "react";
import { fdate, TODAY } from "@sheetal/shared/core/format";
import { Badge, Button, Drawer, Empty, Field, Input, PageHead, Select, Stat, Table, Tabs, Textarea, useToast } from "@sheetal/ui/primitives";
import { bizApi } from "@sheetal/sdk/client";
import { useApiGet } from "@sheetal/sdk/hooks";
import { exportCsv } from "@sheetal/ui/crud";

const TODAY_DAY = TODAY.slice(0, 10);
const STATUS = { in: ["done", "In"], out: ["neutral", "Left"], late: ["action", "Late"], leave: ["neutral", "On leave"], absent: ["problem", "Absent"], off: ["neutral", "Day off"], none: ["neutral", "—"] };
const LEAVE = { pending: ["action", "Waiting"], approved: ["done", "Approved"], rejected: ["problem", "Declined"], cancelled: ["neutral", "Cancelled"] };

/** Where the phone is, if it will say; never blocks checking in. */
const where = () => new Promise((ok) => {
  if (!navigator.geolocation) return ok({});
  navigator.geolocation.getCurrentPosition((p) => ok({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) }), () => ok({}), { timeout: 4000, maximumAge: 60000 });
});

/** One GET on the kit (useApiGet): loads again when the business, the branch picked at the top or reload() change. [data, reload]; data is null while the
 *  first answer is on its way and false if it failed (the error is shown as a toast, as before). */
function useLoad(path, tenantId, enabled = true) {
  const toast = useToast();
  const { data, error, refresh } = useApiGet(enabled ? path : null, { tenantId });
  useEffect(() => { if (error) toast(error.message); }, [error, toast]);
  return [data ?? (error ? false : null), refresh];
}
const monthsBack = () => {
  const out = []; let y = Number(TODAY_DAY.slice(0, 4)), m = Number(TODAY_DAY.slice(5, 7));
  for (let i = 0; i < 12; i++) { out.push({ id: `${y}-${String(m).padStart(2, "0")}`, label: new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }) }); if (--m < 1) { m = 12; y--; } }
  return out;
};
const MONTHS = monthsBack();

export function PeoplePage({ tenant, embedded }) {
  const [tab, setTab] = useState("today");
  const [me, reloadMe] = useLoad("/people/me", tenant.id);
  const canSee = !!me?.canSee, canManage = !!me?.canManage;
  const tabs = [{ id: "today", label: "Today", icon: "clock" }, ...(canSee ? [{ id: "board", label: "Board", icon: "users" }, { id: "leave", label: "Leave requests", icon: "calendar" }, { id: "month", label: "Month", icon: "receipt" }] : [])];
  return (
    <>
      {!embedded && <PageHead title="People" sub="Who is in today, and who is away." />}
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === "today" && <TodayTab tenant={tenant} me={me} reload={reloadMe} />}
      {tab === "board" && canSee && <BoardTab tenant={tenant} canManage={canManage} />}
      {tab === "leave" && canSee && <LeaveTab tenant={tenant} canManage={canManage} onChanged={reloadMe} />}
      {tab === "month" && canSee && <MonthTab tenant={tenant} canManage={canManage} />}
    </>
  );
}

// ───── Today ─────
function TodayTab({ tenant, me, reload }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(null);
  const [types] = useLoad("/people/leave-types", tenant.id);
  if (me === null) return <p className="muted">Loading…</p>;
  if (me === false) return <Empty icon="clock" title="Couldn't load this" />;
  const go = async (what) => {
    setBusy(true);
    try { const r = await bizApi("POST", `/people/${what}`, await where()); toast(r.message); reload(); } catch (e) { toast(e.message); } finally { setBusy(false); }
  };
  const send = async () => {
    setBusy(true);
    try {
      const r = await bizApi("POST", "/people/leave", { typeId: form.typeId, from: form.from, to: form.halfDay ? form.from : form.to, halfDay: form.halfDay, reason: form.reason.trim() || undefined });
      toast(r.message); setForm(null); reload();
    } catch (e) { toast(e.message); if (e.status === 409) { setForm(null); reload(); } } finally { setBusy(false); }
  };
  const cancel = (l) => { if (!window.confirm("Cancel this leave request?")) return; bizApi("POST", `/people/leave/${l.id}/cancel`).then((r) => { toast(r.message); reload(); }).catch((e) => toast(e.message)); };
  const typeName = (id) => (types || []).find((t) => t.id === id)?.name || "Leave";
  return (
    <>
      <div className="pf-grid-3">
        <div className="pf-card" style={{ padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>{me.open ? `Checked in at ${me.open.inAt}` : "Not checked in"}</h3>
          <p className="muted small">{me.open?.late ? "You were late today." : `The day starts at ${me.workStart}.`}</p>
          {me.open ? <Button disabled={busy} onClick={() => go("check-out")}>Check out</Button> : <Button disabled={busy} onClick={() => go("check-in")}>Check in</Button>}
          {me.records.length > 0 && <p className="small muted" style={{ marginTop: 12 }}>Today: {me.records.map((r) => `${r.inAt}–${r.outAt || "now"}`).join(", ")}</p>}
        </div>
        {me.balances.map((b) => (
          <Stat key={b.typeId} label={b.name} value={b.perYear ? `${b.perYear - b.used - b.pending} left` : `${b.used} taken`} note={b.perYear ? `${b.used} taken${b.pending ? ` · ${b.pending} waiting` : ""} of ${b.perYear} this year` : b.paid ? "Paid" : "Unpaid"} />
        ))}
      </div>
      <div className="pf-row-actions" style={{ margin: "20px 0 8px", display: "flex", justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>My leave</h3>
        <Button icon="plus" onClick={() => setForm({ typeId: me.balances[0]?.typeId || "", from: TODAY_DAY, to: TODAY_DAY, halfDay: false, reason: "" })}>Ask for leave</Button>
      </div>
      <Table rows={me.leaves} minWidth={640} empty={<Empty icon="calendar" title="No leave requests" />} columns={[
        { key: "t", label: "Type", render: (l) => typeName(l.typeId) },
        { key: "d", label: "Dates", render: (l) => l.from === l.to ? fdate(l.from) : `${fdate(l.from)} – ${fdate(l.to)}` },
        { key: "n", label: "Days", render: (l) => l.days },
        { key: "s", label: "Status", render: (l) => <Badge tone={LEAVE[l.status][0]}>{LEAVE[l.status][1]}</Badge> },
        { key: "x", label: "", render: (l) => (l.status === "pending" || (l.status === "approved" && l.to >= TODAY_DAY)) ? <Button size="sm" variant="ghost" onClick={() => cancel(l)}>Cancel</Button> : (l.note || "") },
      ]} />
      <Drawer open={!!form} onClose={() => setForm(null)} title="Ask for leave" footer={form && <><Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button><Button disabled={busy || !form.typeId || !form.from || (!form.halfDay && form.to < form.from)} onClick={send}>Send</Button></>}>
        {form && (
          <div className="pf-stack">
            <Field label="Type"><Select value={form.typeId} onChange={(v) => setForm({ ...form, typeId: v })} options={me.balances.map((b) => ({ id: b.typeId, label: b.name }))} /></Field>
            <div className="pf-grid-2 tight">
              <Field label={form.halfDay ? "Day" : "From"}><Input type="date" value={form.from} min={TODAY_DAY} onChange={(e) => setForm({ ...form, from: e.target.value, to: form.to < e.target.value ? e.target.value : form.to })} /></Field>
              {!form.halfDay && <Field label="To"><Input type="date" value={form.to} min={form.from} onChange={(e) => setForm({ ...form, to: e.target.value })} /></Field>}
            </div>
            <label className="small"><input type="checkbox" checked={form.halfDay} onChange={(e) => setForm({ ...form, halfDay: e.target.checked })} /> Half day</label>
            <Field label="Reason" optional><Textarea value={form.reason} maxLength={300} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
            <p className="small muted">Saturday is the weekly day off and isn't counted.</p>
          </div>
        )}
      </Drawer>
    </>
  );
}

// ───── Board ─────
function BoardTab({ tenant, canManage }) {
  const toast = useToast();
  const [day, setDay] = useState(TODAY_DAY);
  const [data, reload] = useLoad(`/people/board?day=${day}`, tenant.id);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const f = form;
      const r = f.id
        ? await bizApi("PATCH", `/people/attendance/${f.id}`, { inTime: f.inTime, outTime: f.outTime || null, reason: f.reason.trim(), version: f.version })
        : await bizApi("POST", "/people/attendance", { userId: f.userId, day, inTime: f.inTime, outTime: f.outTime || undefined, reason: f.reason.trim() });
      toast(r.message); setForm(null); reload();
    } catch (e) { toast(e.message); if (e.status === 409) { setForm(null); reload(); } } finally { setBusy(false); }
  };
  const rows = data?.rows || [];
  return (
    <>
      <div className="pf-grid-4" style={{ marginBottom: 12 }}>
        <Stat label="In today" value={data?.counts.present ?? "—"} note={`of ${data?.counts.total ?? "—"} people`} />
        <Stat label="Late" value={data?.counts.late ?? "—"} tone={data?.counts.late ? "action" : undefined} />
        <Stat label="On leave" value={data?.counts.leave ?? "—"} />
        <Stat label="Absent" value={data?.counts.absent ?? "—"} tone={data?.counts.absent ? "problem" : undefined} />
      </div>
      <div style={{ maxWidth: 220, marginBottom: 12 }}><Field label="Day"><Input type="date" value={day} max={TODAY_DAY} onChange={(e) => e.target.value && setDay(e.target.value)} /></Field></div>
      <Table rows={rows} rowKey="userId" minWidth={760} empty={<Empty icon="users" title="Nobody here" />} columns={[
        { key: "n", label: "Person", render: (r) => r.name },
        { key: "s", label: "Status", render: (r) => <Badge tone={STATUS[r.status][0]}>{r.status === "leave" && r.leave ? r.leave : STATUS[r.status][1]}</Badge> },
        { key: "t", label: "Times", render: (r) => r.records.length ? r.records.map((x) => (
          <div key={x.id}>{x.inAt}–{x.outAt || "now"}{x.source === "manual" ? " · fixed" : ""}{canManage && <button type="button" className="link" style={{ marginLeft: 8 }} onClick={() => setForm({ id: x.id, version: x.version, inTime: x.inAt, outTime: x.outAt || "", reason: "" })}>Fix</button>}</div>
        )) : "—" },
        { key: "a", label: "", render: (r) => canManage && day <= TODAY_DAY ? <Button size="sm" variant="ghost" onClick={() => setForm({ userId: r.userId, inTime: "10:00", outTime: "", reason: "" })}>Add time</Button> : null },
      ]} />
      <Drawer open={!!form} onClose={() => setForm(null)} title={form?.id ? "Fix a record" : "Add a record"} footer={form && <><Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button><Button disabled={busy || !form.inTime || form.reason.trim().length < 3} onClick={save}>Save</Button></>}>
        {form && (
          <div className="pf-stack">
            <div className="pf-grid-2 tight">
              <Field label="In"><Input type="time" value={form.inTime} onChange={(e) => setForm({ ...form, inTime: e.target.value })} /></Field>
              <Field label="Out" optional><Input type="time" value={form.outTime} onChange={(e) => setForm({ ...form, outTime: e.target.value })} /></Field>
            </div>
            <Field label="Why?" hint="Kept with the change so anyone can see what happened."><Textarea value={form.reason} maxLength={300} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
          </div>
        )}
      </Drawer>
    </>
  );
}

// ───── Leave requests ─────
function LeaveTab({ tenant, canManage, onChanged }) {
  const toast = useToast();
  const [status, setStatus] = useState("pending");
  const [rows, reload] = useLoad(`/people/leave?status=${status}`, tenant.id);
  const decide = async (l, s) => {
    const note = s === "rejected" ? window.prompt("Why? (the person will see this)", "") : "";
    if (note === null) return;
    try { const r = await bizApi("POST", `/people/leave/${l.id}/decide`, { status: s, note: note?.trim() || undefined, version: l.version }); toast(r.message); reload(); onChanged(); } catch (e) { toast(e.message); }
  };
  return (
    <>
      <div style={{ maxWidth: 220, marginBottom: 12 }}><Field label="Show"><Select value={status} onChange={setStatus} options={[{ id: "pending", label: "Waiting" }, { id: "approved", label: "Approved" }, { id: "rejected", label: "Declined" }, { id: "cancelled", label: "Cancelled" }]} /></Field></div>
      <Table rows={rows || []} minWidth={760} empty={<Empty icon="calendar" title="No leave requests" />} columns={[
        { key: "n", label: "Person", render: (l) => l.name },
        { key: "t", label: "Type", render: (l) => l.type },
        { key: "d", label: "Dates", render: (l) => `${l.from === l.to ? fdate(l.from) : `${fdate(l.from)} – ${fdate(l.to)}`} · ${l.days} day${l.days === 1 ? "" : "s"}` },
        { key: "r", label: "Reason", render: (l) => l.reason || "—" },
        { key: "a", label: "", render: (l) => canManage && l.status === "pending" ? <><Button size="sm" onClick={() => decide(l, "approved")}>Approve</Button> <Button size="sm" variant="ghost" onClick={() => decide(l, "rejected")}>Decline</Button></> : <Badge tone={LEAVE[l.status][0]}>{LEAVE[l.status][1]}</Badge> },
      ]} />
    </>
  );
}

// ───── Month ─────
function MonthTab({ tenant, canManage }) {
  const toast = useToast();
  const [month, setMonth] = useState(MONTHS[0].id);
  const [data] = useLoad(`/people/summary?month=${month}`, tenant.id);
  const [settings, reloadSettings] = useLoad("/people/settings", tenant.id);
  const [types, reloadTypes] = useLoad("/people/leave-types", tenant.id);
  const [start, setStart] = useState(null);
  const [form, setForm] = useState(null);
  const rows = data?.rows || [];
  const cols = data?.types || [];
  const csv = () => exportCsv(`attendance-${month}`, ["Person", "Days present", "Late", ...cols, "Leave total"], rows.map((r) => [r.name, r.daysPresent, r.late, ...cols.map((c) => r.leave[c] || 0), r.leaveTotal]));
  const saveStart = () => bizApi("PUT", "/people/settings", { workStart: start }).then((r) => { toast(r.message); setStart(null); reloadSettings(); }).catch((e) => toast(e.message));
  const saveType = async () => {
    try {
      const b = { name: form.name.trim(), daysPerYear: Number(form.daysPerYear) || 0, paid: form.paid };
      const r = form.id ? await bizApi("PATCH", `/people/leave-types/${form.id}`, { ...b, active: form.active, version: form.version }) : await bizApi("POST", "/people/leave-types", b);
      toast(r.message); setForm(null); reloadTypes();
    } catch (e) { toast(e.message); }
  };
  return (
    <>
      <div style={{ display: "flex", gap: 12, alignItems: "end", marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 180 }}><Field label="Month"><Select value={month} onChange={setMonth} options={MONTHS.map((m) => ({ id: m.id, label: m.label }))} /></Field></div>
        <Button variant="outline" icon="download" disabled={!rows.length} onClick={csv}>Download CSV</Button>
      </div>
      <Table rows={rows} rowKey="userId" minWidth={720} empty={<Empty icon="users" title="Nothing this month" />} columns={[
        { key: "n", label: "Person", render: (r) => r.name },
        { key: "p", label: "Days present", render: (r) => r.daysPresent },
        { key: "l", label: "Late", render: (r) => r.late },
        { key: "v", label: "Leave", render: (r) => r.leaveTotal ? Object.entries(r.leave).map(([k, v]) => `${k} ${v}`).join(", ") : "—" },
      ]} />
      {canManage && (
        <>
          <h3 style={{ margin: "24px 0 8px" }}>Settings</h3>
          <div style={{ display: "flex", gap: 12, alignItems: "end", marginBottom: 16 }}>
            <div style={{ maxWidth: 180 }}><Field label="Day starts at" hint="Check in after this is late."><Input type="time" value={start ?? settings?.workStart ?? "10:00"} onChange={(e) => setStart(e.target.value)} /></Field></div>
            <Button disabled={start === null} onClick={saveStart}>Save</Button>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", margin: "8px 0" }}><h4 style={{ margin: 0 }}>Leave types</h4><Button size="sm" icon="plus" onClick={() => setForm({ name: "", daysPerYear: "0", paid: true, active: true })}>Add</Button></div>
          <Table rows={types || []} minWidth={560} empty={<Empty icon="calendar" title="No leave types" />} columns={[
            { key: "n", label: "Name", render: (t) => t.name },
            { key: "d", label: "Days a year", render: (t) => t.daysPerYear || "No limit" },
            { key: "p", label: "Paid", render: (t) => t.paid ? "Yes" : "No" },
            { key: "s", label: "", render: (t) => <>{!t.active && <Badge tone="neutral">Off</Badge>} <Button size="sm" variant="ghost" onClick={() => setForm({ ...t, daysPerYear: String(t.daysPerYear) })}>Change</Button></> },
          ]} />
          <Drawer open={!!form} onClose={() => setForm(null)} title={form?.id ? "Change leave type" : "New leave type"} footer={form && <><Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button><Button disabled={form.name.trim().length < 2} onClick={saveType}>Save</Button></>}>
            {form && (
              <div className="pf-stack">
                <Field label="Name"><Input value={form.name} maxLength={40} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
                <Field label="Days a year" hint="0 means no limit."><Input className="input tnum" inputMode="numeric" value={form.daysPerYear} onChange={(e) => setForm({ ...form, daysPerYear: e.target.value.replace(/\D/g, "") })} /></Field>
                <label className="small"><input type="checkbox" checked={form.paid} onChange={(e) => setForm({ ...form, paid: e.target.checked })} /> Paid leave</label>
                {form.id && <label className="small"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> In use</label>}
              </div>
            )}
          </Drawer>
        </>
      )}
    </>
  );
}
