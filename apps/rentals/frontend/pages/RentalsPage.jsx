// Rentals on the business API (Business → Rentals): homes and shops the agency manages for owners.
// Where it fits: moved from business/frontend/src/pages/LiveRentals.jsx (P2-W2); shown at /business/rentals by BusinessApp.jsx through the shim left there. On the kit (@sheetal/ui, @sheetal/sdk). Every change (PUT) sends the row's version; a stale page (409) closes the form and reloads.
// How it works: one load of owners, units, leases, bills and repairs; each tab works on it and every change goes to the
// server, then the page loads again. Rent bills are made by the server every month; staff record payments, waive late
// fees, log repairs and save owner statements (saving one counts the agency's fee in its profit).
// "Agreement" on a lease starts a rent agreement filled from it (Business → Agreements).
// Rules: nothing about money is worked out here; the server decides. Only people who can manage rentals see the buttons
// that change things.

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "@sheetal/shared/core/router";
import { fdate, rs } from "@sheetal/shared/core/format";
import { Badge, Button, Drawer, Empty, Field, Input, PageHead, Panel, Select, Stat, Table, Tabs, Textarea, useToast } from "@sheetal/ui/primitives";
import { Icon } from "@sheetal/shared/core/icons";
import { bizApi } from "@sheetal/sdk/client";
import { useApiGet } from "@sheetal/sdk/hooks";
import { exportCsv } from "@sheetal/ui/crud";

const METHOD = { cash: "Cash", bank: "Bank transfer", esewa: "eSewa", khalti: "Khalti", fonepay: "Fonepay", cheque: "Cheque", other: "Other" };
const UNIT_TONE = { let: ["done", "Let"], vacant: ["neutral", "Vacant"], repair: ["problem", "Under repair"] };
const BILL_TONE = { paid: ["done", "Paid"], partial: ["progress", "Part paid"], due: ["neutral", "Due"], overdue: ["action", "Overdue"] };
const WORK_TONE = { open: ["action", "Open"], assigned: ["progress", "Assigned"], done: ["done", "Done"] };
const PRI_TONE = { urgent: ["problem", "Urgent"], normal: ["neutral", "Normal"], low: ["neutral", "Low"] };
const Tone = ({ map, k }) => <Badge tone={(map[k] || ["neutral"])[0]}>{(map[k] || [null, k])[1]}</Badge>;
const Two = ({ a, b }) => <span className="pf-two"><b>{a}</b>{b ? <small>{b}</small> : null}</span>;
const D = (s) => new Date(s + "T00:00:00Z");
const daysBetween = (a, b) => Math.round((D(b) - D(a)) / 864e5);
const addMonths = (s, n) => { const x = D(s); x.setUTCMonth(x.getUTCMonth() + n); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };
const monthName = (m) => (m ? D(m + "-01").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) : "");
const num = (s) => String(s ?? "").replace(/\D/g, "");
const dec = (s) => String(s ?? "").replace(/[^\d.]/g, "");

/** One GET on the kit (useApiGet): loads again when the business, the branch picked at the top or reload() change. [data, reload]; data is null while the
 *  first answer is on its way and false if it failed (the error is shown as a toast, as before). */
function useLoad(path, tenantId, enabled = true) {
  const toast = useToast();
  const { data, error, refresh } = useApiGet(enabled ? path : null, { tenantId });
  useEffect(() => { if (error) toast(error.message); }, [error, toast]);
  return [data ?? (error ? false : null), refresh];
}

const TABS = [
  { id: "overview", label: "Overview", icon: "layout-grid" },
  { id: "units", label: "Owners and units", icon: "building-2" },
  { id: "leases", label: "Tenants and leases", icon: "users" },
  { id: "rent", label: "Rent", icon: "receipt" },
  { id: "repairs", label: "Repairs", icon: "wrench" },
  { id: "owners", label: "Owner statements", icon: "wallet" },
];

export function RentalsPage({ tenant, tab = "overview" }) {
  const toast = useToast();
  const { navigate } = useRouter();
  const [d, reload] = useLoad("/rentals", tenant.id);
  const [dr, setDr] = useState(null); // { kind, f }
  const [busy, setBusy] = useState(false);
  const T = TABS.some((x) => x.id === tab) ? tab : "overview";
  const go = (id) => navigate(id === "overview" ? "/business/rentals" : "/business/rentals/" + id);
  const open = (kind, f = {}) => setDr({ kind, f });
  const close = () => setDr(null);
  const setF = (patch) => setDr((x) => x && { ...x, f: { ...x.f, ...patch } });
  const f = dr?.f || {};
  const send = (method, path, body, after) => {
    setBusy(true);
    // A change to a saved row carries the version it was loaded with; a stale one (409) closes the form and reloads the latest.
    const version = method === "PUT" && body && body.version === undefined ? (f.version ?? f.bill?.version ?? f.lease?.version) : undefined;
    const sent = version !== undefined ? { ...body, version } : body;
    return bizApi(method, path, sent).then((r) => { toast(r.message); close(); reload(); after?.(r); })
      .catch((e) => { toast(e.message); if (e.status === 409) { close(); reload(); } }).finally(() => setBusy(false));
  };

  const v = useMemo(() => {
    if (!d) return null;
    const today = d.today, month = today.slice(0, 7);
    const thisMonth = d.bills.filter((b) => b.month === month);
    const overdue = d.bills.filter((b) => b.status === "overdue");
    const active = d.leases.filter((l) => l.status === "active");
    const ending = active.filter((l) => daysBetween(today, l.end) <= 60).sort((a, b) => a.end.localeCompare(b.end));
    const let_ = d.units.filter((u) => u.status === "let").length;
    return { today, month, thisMonth, overdue, active, ending, let_, openWork: d.repairs.filter((r) => r.status !== "done"),
      byProperty: d.units.reduce((m, u) => { (m[u.property] = m[u.property] || []).push(u); return m; }, {}) };
  }, [d]);

  if (d === null) return <><PageHead title="Rentals" /><p className="muted pf-pad">Loading…</p></>;
  if (d === false) return <><PageHead title="Rentals" /><Empty icon="circle-alert" title="Rentals couldn't load">Try again in a moment.</Empty></>;
  const can = d.canManage;
  const ownerOpts = d.owners.map((o) => ({ id: o.id, label: `${o.name} · ${o.feePct}% fee${o.branch ? " · " + o.branch : ""}` }));
  const tabs = TABS.map((x) => ({ ...x, count: x.id === "rent" ? v.overdue.length || undefined : x.id === "repairs" ? v.openWork.length || undefined : x.id === "leases" ? v.ending.length || undefined : undefined }));
  const newLease = (unit) => open("lease", { unitId: unit?.id || "", renter: "", phone: "", email: "", start: v.today, months: "12", rent: String(unit?.rent || ""), deposit: unit ? String(unit.rent * 2) : "", dueDay: "7", lateFeePct: "2", lateAfterDays: "5" });

  return (
    <>
      <PageHead title="Rentals" sub="Homes and shops you manage for owners: units, tenants, rent, repairs and owner statements."
        actions={can && <>
          <Button variant="outline" icon="wrench" disabled={!d.units.length} onClick={() => open("repair", { unitId: d.units[0]?.id || "", title: "", priority: "normal", vendor: "", cost: "", status: "open" })}>Log a repair</Button>
          <Button icon="plus" disabled={!d.units.some((u) => u.status !== "let")} onClick={() => newLease(d.units.find((u) => u.status === "vacant"))}>New lease</Button>
        </>} />
      <Tabs tabs={tabs} value={T} onChange={go} />

      {T === "overview" && <>
        <div className="pf-stats">
          <Stat label="Occupancy" value={d.units.length ? Math.round((v.let_ / d.units.length) * 100) + "%" : "—"} note={`${v.let_} of ${d.units.length} units let`} to="/business/rentals/units" />
          <Stat label={"Rent for " + monthName(v.month)} value={rs(v.thisMonth.reduce((s, b) => s + b.amount + b.lateFee, 0))} note={rs(v.thisMonth.reduce((s, b) => s + b.paid, 0)) + " collected"} to="/business/rentals/rent" />
          <Stat label="Overdue" value={rs(v.overdue.reduce((s, b) => s + b.balance, 0))} note={`${v.overdue.length} bills past due`} tone={v.overdue.length ? "action" : undefined} to="/business/rentals/rent" />
          <Stat label="Leases ending" value={v.ending.length} note="In the next 60 days" to="/business/rentals/leases" />
        </div>
        <Panel title="Needs you" sub="Overdue rent, open repairs and leases about to end">
          {v.overdue.length + v.ending.length + v.openWork.length ? <ul className="pf-list">
            {v.overdue.map((b) => <li key={b.id}><span className="pf-li-ico"><Icon name="receipt" size={17} /></span><div><b>{b.renter} owes {rs(b.balance)}</b><span className="small muted">{b.unit} · {monthName(b.month)} · due {fdate(b.due)}</span></div>{can && <Button variant="outline" size="sm" onClick={() => open("pay", { bill: b, amount: String(b.balance), method: "cash", paidOn: v.today, ref: "", note: "" })}>Record payment</Button>}</li>)}
            {v.openWork.map((r) => <li key={r.id}><span className="pf-li-ico"><Icon name="wrench" size={17} /></span><div><b>{r.title}</b><span className="small muted">{r.unit} · {r.vendor || "No vendor yet"}</span></div>{can && <Button variant="outline" size="sm" onClick={() => open("repair", { ...r, cost: String(r.cost || ""), doneOn: r.doneOn || "" })}>Update</Button>}</li>)}
            {v.ending.map((l) => <li key={l.id}><span className="pf-li-ico"><Icon name="calendar-days" size={17} /></span><div><b>{l.renter}: lease ends {daysBetween(v.today, l.end) < 0 ? "has passed" : `in ${daysBetween(v.today, l.end)} days`}</b><span className="small muted">{l.unit} · {fdate(l.end)}</span></div><Button variant="outline" size="sm" onClick={() => go("leases")}>Renew or end</Button></li>)}
          </ul> : <p className="pf-pad small muted">Nothing waiting. Rent is in and repairs are done.</p>}
        </Panel>
      </>}

      {T === "units" && <>
        <Panel title="Owners" sub="The landlords whose homes and shops you manage. The fee is taken from the rent you collect for them."
          actions={can && <Button variant="outline" size="sm" icon="user-plus" onClick={() => open("owner", { name: "", phone: "", email: "", feePct: "8", bank: "", note: "" })}>Add owner</Button>}>
          <Table rows={d.owners} minWidth={720} onRowClick={can ? (o) => open("owner", { ...o, feePct: String(o.feePct) }) : undefined} empty={<Empty icon="user-plus" title="No owners yet">Add an owner first, then their units.</Empty>} columns={[
            { key: "n", label: "Owner", render: (o) => <Two a={o.name} b={[o.phone, o.email].filter(Boolean).join(" · ")} /> },
            { key: "f", label: "Fee", num: true, render: (o) => `${o.feePct}%` },
            { key: "u", label: "Units", num: true, render: (o) => o.units },
            { key: "b", label: "Paid to", render: (o) => <span className="small">{o.bank || "—"}</span> },
            { key: "x", label: "", align: "right", render: (o) => can && <Button size="sm" variant="ghost" icon="plus" onClick={(e) => { e.stopPropagation(); open("unit", { ownerId: o.id, property: "", name: "", kind: "Flat", rent: "" }); }}>Add unit</Button> },
          ]} />
        </Panel>
        {Object.entries(v.byProperty).map(([prop, units]) => (
          <Panel key={prop} title={prop} sub={"Owner: " + [...new Set(units.map((u) => u.owner))].join(", ")}>
            <Table rows={units} minWidth={680} onRowClick={can ? (u) => open("unit", { ...u, rent: String(u.rent) }) : undefined} columns={[
              { key: "n", label: "Unit", render: (u) => <Two a={u.name} b={[u.kind, u.listing].filter(Boolean).join(" · ")} /> },
              { key: "r", label: "Rent", num: true, render: (u) => rs(u.rent) },
              { key: "s", label: "Status", render: (u) => <Tone map={UNIT_TONE} k={u.status} /> },
              { key: "t", label: "Tenant", render: (u) => (u.lease ? <Two a={u.lease.renter} b={`${u.lease.no} · until ${fdate(u.lease.end)}`} /> : <span className="muted">—</span>) },
              { key: "x", label: "", align: "right", render: (u) => (can && u.status !== "let" ? <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); newLease(u); }}>Add tenant</Button> : null) },
            ]} />
          </Panel>
        ))}
      </>}

      {T === "leases" && <Panel title="Tenants and leases" sub="The deposit is held and returned at the end; it is never income.">
        <Table rows={d.leases} minWidth={940} empty={<Empty icon="users" title="No leases yet" />} columns={[
          { key: "t", label: "Tenant", render: (l) => <Two a={l.renter} b={`${l.no}${l.phone ? " · " + l.phone : ""}`} /> },
          { key: "u", label: "Unit", render: (l) => l.unit },
          { key: "p", label: "Period", num: true, render: (l) => `${fdate(l.start)} – ${fdate(l.end)}` },
          { key: "r", label: "Rent", num: true, render: (l) => <Two a={rs(l.rent)} b={`Due day ${l.dueDay}`} /> },
          { key: "d", label: "Deposit", num: true, render: (l) => <Two a={rs(l.deposit)} b={l.depositStatus === "returned" ? `Returned ${rs(l.depositReturned || 0)}` : "Held"} /> },
          { key: "s", label: "Status", render: (l) => l.status === "ended" ? <Badge tone="neutral">Ended</Badge> : daysBetween(v.today, l.end) <= 60 ? <Badge tone="action">Ends {fdate(l.end)}</Badge> : <Badge tone="done">Active</Badge> },
          { key: "x", label: "", align: "right", render: (l) => can && <div className="pf-row-actions" style={{ justifyContent: "flex-end" }}>
            {l.status === "active" && <Button variant="ghost" size="sm" onClick={() => open("leaseEdit", { ...l, rent: String(l.rent), dueDay: String(l.dueDay), lateFeePct: String(l.lateFeePct), lateAfterDays: String(l.lateAfterDays) })}>Change or renew</Button>}
            {l.status === "active" && <Button variant="ghost" size="sm" icon="file-pen-line" onClick={() => navigate(`/business/agreements/new/lease/${l.id}`)}>Agreement</Button>}
            {l.status === "active" && <Button variant="outline" size="sm" onClick={() => open("end", { lease: l, endedOn: v.today, depositReturned: String(l.deposit), depositNote: "" })}>End</Button>}
            {l.status === "ended" && l.depositStatus !== "returned" && l.deposit > 0 && <Button variant="outline" size="sm" onClick={() => open("deposit", { lease: l, returned: String(l.deposit), note: "" })}>Return deposit</Button>}
          </div> },
        ]} />
      </Panel>}

      {T === "rent" && d.pending.length > 0 && <Panel title="Online payments to check" sub="Tenants paid these on the website. Check the money arrived in your account, then confirm. Payments to Sheetal Property are checked by Sheetal.">
        <Table rows={d.pending} minWidth={900} columns={[
          { key: "t", label: "Tenant", render: (p) => <Two a={p.renter} b={p.unit} /> },
          { key: "b", label: "Bill", render: (p) => <Two a={p.bill} b={monthName(p.month)} /> },
          { key: "m", label: "Paid by", render: (p) => <Two a={METHOD[p.method] || p.method} b={p.ref} /> },
          { key: "a", label: "Amount", num: true, render: (p) => rs(p.amount) },
          { key: "d", label: "Paid on", num: true, render: (p) => fdate(p.paidOn) },
          { key: "x", label: "", align: "right", render: (p) => <div className="pf-row-actions" style={{ justifyContent: "flex-end" }}>
            {p.hasProof && <Button variant="ghost" size="sm" icon="image" onClick={() => bizApi("GET", `/rentals/payments/${p.id}/proof`).then((r) => { const bin = atob(r.data.data); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); window.open(URL.createObjectURL(new Blob([bytes], { type: r.data.type })), "_blank", "noopener"); }).catch((e) => toast(e.message))}>Screenshot</Button>}
            {p.to === "sheetal" ? <Badge tone="neutral">Sheetal checks</Badge> : can && <>
              <Button variant="ghost" size="sm" onClick={() => { const note = window.prompt("Why can't this payment be accepted? The tenant sees this."); if (note && note.trim().length >= 3) send("POST", `/rentals/payments/${p.id}/reject`, { note: note.trim() }); }}>Reject</Button>
              <Button size="sm" icon="check" onClick={() => window.confirm(`Confirm ${rs(p.amount)} from ${p.renter}? Check the money is in your account first.`) && send("POST", `/rentals/payments/${p.id}/confirm`)}>Confirm</Button>
            </>}
          </div> },
        ]} />
      </Panel>}

      {T === "rent" && <Panel title="Rent bills" sub="A bill is made for every active lease each month. A late fee is added once, on what is unpaid, after the lease's grace days."
        actions={<Button variant="ghost" size="sm" icon="download" disabled={!d.bills.length} onClick={() => exportCsv(`rent-bills-${v.today}`, ["Bill", "Month", "Tenant", "Unit", "Lease", "Due", "Rent", "Late fee", "Paid", "Owed", "Status"], d.bills.map((b) => [b.no, b.month, b.renter, b.unit, b.leaseNo, b.due, b.amount, b.lateFee, b.paid, b.balance, b.status]))}>CSV</Button>}>
        <Table rows={d.bills} minWidth={980} empty={<Empty icon="receipt" title="No rent bills yet">Bills appear when a lease is running.</Empty>} columns={[
          { key: "n", label: "Bill", render: (b) => <Two a={b.no} b={monthName(b.month)} /> },
          { key: "t", label: "Tenant", render: (b) => <Two a={b.renter} b={b.unit} /> },
          { key: "d", label: "Due", num: true, render: (b) => fdate(b.due) },
          { key: "a", label: "Rent", num: true, render: (b) => rs(b.amount) },
          { key: "l", label: "Late fee", num: true, render: (b) => (b.lateFee ? rs(b.lateFee) : b.lateWaived ? <span className="small muted">Waived</span> : "—") },
          { key: "p", label: "Paid", num: true, render: (b) => (b.paid ? rs(b.paid) : "—") },
          { key: "s", label: "Status", render: (b) => <Tone map={BILL_TONE} k={b.status} /> },
          { key: "x", label: "", align: "right", render: (b) => <div className="pf-row-actions" style={{ justifyContent: "flex-end" }}>
            {b.paid > 0 && <Button variant="ghost" size="sm" onClick={() => bizApi("GET", `/rentals/bills/${b.id}`).then((r) => open("payments", { bill: b, list: r.data.payments })).catch((e) => toast(e.message))}>Payments</Button>}
            {can && b.status !== "paid" && b.lateFee > 0 && b.paid <= b.amount && <Button variant="ghost" size="sm" onClick={() => window.confirm(`Waive the late fee of ${rs(b.lateFee)} on ${b.no}?`) && send("POST", `/rentals/bills/${b.id}/waive`)}>Waive fee</Button>}
            {can && b.paid === 0 && <Button variant="ghost" size="sm" onClick={() => open("bill", { bill: b, amount: String(b.amount) })}>Change</Button>}
            {can && b.status !== "paid" && <Button variant="outline" size="sm" onClick={() => open("pay", { bill: b, amount: String(b.balance), method: "cash", paidOn: v.today, ref: "", note: "" })}>Record payment</Button>}
          </div> },
        ]} />
      </Panel>}

      {T === "repairs" && <Panel title="Repairs" sub="Done repairs come off the owner's statement for the month they were done.">
        <Table rows={d.repairs} minWidth={900} empty={<Empty icon="wrench" title="No repairs logged" />} onRowClick={can ? (r) => open("repair", { ...r, cost: String(r.cost || ""), doneOn: r.doneOn || "" }) : undefined} columns={[
          { key: "t", label: "Issue", render: (r) => <Two a={r.title} b={`${r.no} · ${fdate(r.created)}`} /> },
          { key: "u", label: "Unit", render: (r) => <Two a={r.unit} b={r.owner} /> },
          { key: "p", label: "Priority", render: (r) => <Tone map={PRI_TONE} k={r.priority} /> },
          { key: "v", label: "Vendor", render: (r) => r.vendor || <span className="muted">—</span> },
          { key: "c", label: "Cost", num: true, render: (r) => (r.cost ? rs(r.cost) : "—") },
          { key: "s", label: "Status", render: (r) => <span className="pf-two"><Tone map={WORK_TONE} k={r.status} />{r.doneOn && <small>{fdate(r.doneOn)}</small>}</span> },
        ]} />
      </Panel>}

      {T === "owners" && <Statements tenant={tenant} today={v.today} />}

      <Drawers dr={dr} f={f} setF={setF} close={close} send={send} busy={busy} d={d} ownerOpts={ownerOpts} />
    </>
  );
}

function Statements({ tenant, today }) {
  const toast = useToast();
  const months = useMemo(() => { const out = []; let y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)); for (let i = 0; i < 12; i++) { out.push(`${y}-${String(m).padStart(2, "0")}`); if (--m < 1) { m = 12; y--; } } return out; }, [today]);
  const [month, setMonth] = useState(months[0]);
  const [s, reload] = useLoad(`/rentals/statements?month=${month}`, tenant.id);
  const act = (method, path, body) => bizApi(method, path, body).then((r) => { toast(r.message); reload(); }).catch((e) => toast(e.message));
  const rows = s?.rows || [];
  return (
    <Panel title={"Owner statements · " + monthName(month)} sub="Rent collected that month, minus your management fee and the repairs done, is what you owe each owner. Save a statement to count your fee in your profit."
      actions={<div className="pf-row-actions">
        <Select value={month} onChange={setMonth} style={{ width: 180 }} aria-label="Month" options={months.map((m) => ({ id: m, label: monthName(m) }))} />
        <Button variant="ghost" size="sm" icon="download" disabled={!rows.length} onClick={() => exportCsv(`owner-statements-${month}`, ["Owner", "Month", "Rent collected", "Fee %", "Fee", "Repairs", "Owed to owner", "Paid to", "Saved"], rows.map((r) => [r.owner, month, r.collected, r.feePct, r.fee, r.repairs, r.payable, r.bank, r.saved ? "yes" : "no"]))}>CSV</Button>
      </div>}>
      {!s ? <p className="muted pf-pad">Loading…</p> : <Table rows={rows} minWidth={920} empty={<Empty icon="wallet" title="No owners yet" />} columns={[
        { key: "o", label: "Owner", render: (r) => <Two a={r.owner} b={r.bank} /> },
        { key: "c", label: "Collected", num: true, render: (r) => rs(r.collected) },
        { key: "f", label: "Your fee", num: true, render: (r) => `${rs(r.fee)} (${r.feePct}%)` },
        { key: "r", label: "Repairs", num: true, render: (r) => (r.repairs ? "− " + rs(r.repairs) : "—") },
        { key: "p", label: "Owed to owner", num: true, render: (r) => <b>{rs(r.payable)}</b> },
        { key: "s", label: "Saved", render: (r) => (r.saved ? (r.saved.current ? <Badge tone="done">Saved</Badge> : <Badge tone="action">Changed since saved</Badge>) : <span className="muted small">Not saved</span>) },
        { key: "x", label: "", align: "right", render: (r) => s.canManage && <div className="pf-row-actions" style={{ justifyContent: "flex-end" }}>
          {r.saved && <Button variant="ghost" size="sm" onClick={() => window.confirm("Remove this saved statement? Its fee stops counting in your profit.") && act("DELETE", `/rentals/statements/${r.saved.id}`)}>Remove</Button>}
          {(!r.saved || !r.saved.current) && <Button variant="outline" size="sm" onClick={() => act("POST", "/rentals/statements", { ownerId: r.ownerId, month })}>{r.saved ? "Save again" : "Save statement"}</Button>}
        </div> },
      ]} />}
    </Panel>
  );
}

function Drawers({ dr, f, setF, close, send, busy, d, ownerOpts }) {
  const kind = dr?.kind;
  const foot = (label, ok, onSave, extra) => <>{extra}<Button variant="outline" onClick={close}>Cancel</Button><Button disabled={!ok || busy} onClick={onSave}>{label}</Button></>;
  const unitOpts = d.units.map((u) => ({ id: u.id, label: `${u.property} · ${u.name}` }));
  const N = (x) => Number(x) || 0;
  const leaseTerms = () => ({ renter: f.renter.trim(), phone: f.phone?.trim() || null, email: f.email?.trim() || null, rent: N(f.rent), dueDay: N(f.dueDay) || 7, lateFeePct: Number(f.lateFeePct) || 0, lateAfterDays: N(f.lateAfterDays) });
  const remove = (path, what) => window.confirm(`Remove ${what}?`) && send("DELETE", path);
  return (
    <>
      <Drawer open={kind === "owner"} onClose={close} title={f.id ? "Edit owner" : "Add owner"} sub="Statements and the fee use these details"
        footer={foot("Save", (f.name || "").trim(), () => { const body = { name: f.name.trim(), phone: f.phone || null, email: f.email || null, feePct: Number(f.feePct) || 0, bank: f.bank || null, note: f.note || null }; return f.id ? send("PUT", `/rentals/owners/${f.id}`, body) : send("POST", "/rentals/owners", body); },
          f.id && <Button variant="ghost" className="pf-danger pf-foot-left" icon="trash-2" disabled={f.units > 0} title={f.units > 0 ? "Owns units you manage" : undefined} onClick={() => remove(`/rentals/owners/${f.id}`, f.name)}>Delete</Button>)}>
        {kind === "owner" && <div className="pf-stack">
          <Field label="Owner name"><Input value={f.name || ""} onChange={(e) => setF({ name: e.target.value })} /></Field>
          <div className="pf-grid-2 tight"><Field label="Mobile" optional><Input className="input tnum" inputMode="tel" value={f.phone || ""} onChange={(e) => setF({ phone: e.target.value })} /></Field>
            <Field label="Email" optional><Input type="email" value={f.email || ""} onChange={(e) => setF({ email: e.target.value })} /></Field></div>
          <Field label="Management fee (%)" hint="Taken from the rent you collect for this owner"><Input className="input tnum" inputMode="decimal" value={f.feePct || ""} onChange={(e) => setF({ feePct: dec(e.target.value) })} /></Field>
          <Field label="Paid to" hint="Bank and account, as printed on the statement" optional><Input value={f.bank || ""} onChange={(e) => setF({ bank: e.target.value })} placeholder="NIC Asia · 0012…" /></Field>
          <Field label="Note" optional><Textarea rows={2} value={f.note || ""} onChange={(e) => setF({ note: e.target.value })} /></Field>
        </div>}
      </Drawer>

      <Drawer open={kind === "unit"} onClose={close} title={f.id ? "Edit unit" : "Add unit"}
        footer={foot(f.id ? "Save" : "Add unit", f.ownerId && (f.property || "").trim() && (f.name || "").trim() && N(f.rent) > 0, () => { const body = { ownerId: f.ownerId, property: f.property.trim(), name: f.name.trim(), kind: f.kind || "Flat", rent: N(f.rent), listingId: f.listingId || null, ...(f.status && f.status !== "let" ? { status: f.status } : {}) }; return f.id ? send("PUT", `/rentals/units/${f.id}`, body) : send("POST", "/rentals/units", body); },
          f.id && <Button variant="ghost" className="pf-danger pf-foot-left" icon="trash-2" disabled={f.used} title={f.used ? "Has leases or repairs on record" : undefined} onClick={() => remove(`/rentals/units/${f.id}`, f.name)}>Delete</Button>)}>
        {kind === "unit" && <div className="pf-stack">
          <Field label="Owner"><Select value={f.ownerId || ""} onChange={(x) => setF({ ownerId: x })} options={[{ id: "", label: "Choose…" }, ...ownerOpts]} /></Field>
          <Field label="Listing on the website" hint="Tenants pay rent online with its property code" optional><Select value={String(f.listingId || "")} onChange={(x) => setF({ listingId: x ? Number(x) : null })} options={[{ id: "", label: "None" }, ...d.listings.map((l) => ({ id: String(l.id), label: `${l.code} · ${l.title}` }))]} /></Field>
          <Field label="Building or house" hint="Units with the same name are shown together"><Input value={f.property || ""} onChange={(e) => setF({ property: e.target.value })} placeholder="Sanepa Apartments" /></Field>
          <div className="pf-grid-2 tight"><Field label="Unit"><Input value={f.name || ""} onChange={(e) => setF({ name: e.target.value })} placeholder="Flat 3A" /></Field>
            <Field label="Type"><Select value={f.kind || "Flat"} onChange={(x) => setF({ kind: x })} options={d.kinds.map((k) => ({ id: k, label: k }))} /></Field></div>
          <Field label="Monthly rent (Rs.)"><Input className="input tnum" inputMode="numeric" value={f.rent || ""} onChange={(e) => setF({ rent: num(e.target.value) })} /></Field>
          {f.id && f.status !== "let" && <Field label="Status"><Select value={f.status || "vacant"} onChange={(x) => setF({ status: x })} options={[{ id: "vacant", label: "Vacant" }, { id: "repair", label: "Under repair" }]} /></Field>}
        </div>}
      </Drawer>

      <Drawer open={kind === "lease"} onClose={close} title="New lease" sub="Rent bills are made every month while the lease runs."
        footer={foot("Make lease", f.unitId && (f.renter || "").trim() && f.start && N(f.rent) > 0, () => send("POST", "/rentals/leases", { unitId: f.unitId, start: f.start, end: addMonths(f.start, N(f.months) || 12), deposit: N(f.deposit), ...leaseTerms() }))}>
        {kind === "lease" && <div className="pf-stack">
          <Field label="Unit"><Select value={f.unitId || ""} onChange={(x) => { const u = d.units.find((y) => y.id === x); setF({ unitId: x, rent: String(u?.rent || ""), deposit: u ? String(u.rent * 2) : "" }); }} options={[{ id: "", label: "Choose…" }, ...unitOpts.filter((o) => d.units.find((u) => u.id === o.id)?.status !== "let")]} /></Field>
          <div className="pf-grid-2 tight"><Field label="Tenant name"><Input value={f.renter || ""} onChange={(e) => setF({ renter: e.target.value })} /></Field>
            <Field label="Mobile" optional><Input className="input tnum" inputMode="tel" value={f.phone || ""} onChange={(e) => setF({ phone: e.target.value })} /></Field></div>
          <div className="pf-grid-2 tight"><Field label="Starts on"><Input type="date" value={f.start || ""} onChange={(e) => setF({ start: e.target.value })} /></Field>
            <Field label="Length"><Select value={f.months || "12"} onChange={(x) => setF({ months: x })} options={[["6", "6 months"], ["11", "11 months"], ["12", "1 year"], ["24", "2 years"], ["36", "3 years"]].map(([id, label]) => ({ id, label }))} /></Field></div>
          <div className="pf-grid-2 tight"><Field label="Monthly rent (Rs.)"><Input className="input tnum" inputMode="numeric" value={f.rent || ""} onChange={(e) => setF({ rent: num(e.target.value) })} /></Field>
            <Field label="Deposit (Rs.)" hint="Held and returned at the end"><Input className="input tnum" inputMode="numeric" value={f.deposit || ""} onChange={(e) => setF({ deposit: num(e.target.value) })} /></Field></div>
          <div className="pf-grid-2 tight"><Field label="Rent due on day" hint="1 to 28"><Input className="input tnum" inputMode="numeric" value={f.dueDay || ""} onChange={(e) => setF({ dueDay: num(e.target.value) })} /></Field>
            <Field label="Late fee (%)" hint={`Added once, ${f.lateAfterDays || 0} days after the due day`}><Input className="input tnum" inputMode="decimal" value={f.lateFeePct || ""} onChange={(e) => setF({ lateFeePct: dec(e.target.value) })} /></Field></div>
          <Field label="Grace days before the late fee"><Input className="input tnum" inputMode="numeric" value={f.lateAfterDays || ""} onChange={(e) => setF({ lateAfterDays: num(e.target.value) })} /></Field>
        </div>}
      </Drawer>

      <Drawer open={kind === "leaseEdit"} onClose={close} title={`Lease ${f.no || ""}`} sub={f.unit}
        footer={foot("Save", (f.renter || "").trim() && f.end && N(f.rent) > 0, () => send("PUT", `/rentals/leases/${f.id}`, { end: f.end, ...leaseTerms() }))}>
        {kind === "leaseEdit" && <div className="pf-stack">
          <p className="small muted" style={{ margin: 0 }}>To renew, move the end date and set the new rent. Bills already made keep their amount.</p>
          <div className="pf-grid-2 tight"><Field label="Tenant name"><Input value={f.renter || ""} onChange={(e) => setF({ renter: e.target.value })} /></Field>
            <Field label="Mobile" optional><Input className="input tnum" inputMode="tel" value={f.phone || ""} onChange={(e) => setF({ phone: e.target.value })} /></Field></div>
          <div className="pf-grid-2 tight"><Field label="Ends on"><Input type="date" value={f.end || ""} onChange={(e) => setF({ end: e.target.value })} /></Field>
            <Field label="Monthly rent (Rs.)"><Input className="input tnum" inputMode="numeric" value={f.rent || ""} onChange={(e) => setF({ rent: num(e.target.value) })} /></Field></div>
          <div className="pf-grid-2 tight"><Field label="Rent due on day"><Input className="input tnum" inputMode="numeric" value={f.dueDay || ""} onChange={(e) => setF({ dueDay: num(e.target.value) })} /></Field>
            <Field label="Late fee (%)"><Input className="input tnum" inputMode="decimal" value={f.lateFeePct || ""} onChange={(e) => setF({ lateFeePct: dec(e.target.value) })} /></Field></div>
          <Field label="Grace days before the late fee"><Input className="input tnum" inputMode="numeric" value={f.lateAfterDays || ""} onChange={(e) => setF({ lateAfterDays: num(e.target.value) })} /></Field>
        </div>}
      </Drawer>

      <Drawer open={kind === "end"} onClose={close} title={`End lease ${f.lease?.no || ""}`} sub={f.lease ? `${f.lease.renter} · ${f.lease.unit}` : ""}
        footer={foot("End lease", f.endedOn, () => send("POST", `/rentals/leases/${f.lease.id}/end`, { endedOn: f.endedOn, ...(f.depositReturned !== "" ? { depositReturned: N(f.depositReturned), depositNote: f.depositNote || null } : {}) }))}>
        {kind === "end" && <div className="pf-stack">
          <Field label="Last day"><Input type="date" value={f.endedOn || ""} onChange={(e) => setF({ endedOn: e.target.value })} /></Field>
          <Field label="Deposit returned (Rs.)" hint={`Held: ${rs(f.lease?.deposit || 0)}. Leave empty to return it later.`} optional><Input className="input tnum" inputMode="numeric" value={f.depositReturned ?? ""} onChange={(e) => setF({ depositReturned: num(e.target.value) })} /></Field>
          <Field label="Deposit note" hint="What was kept back, and why" optional><Textarea rows={2} value={f.depositNote || ""} onChange={(e) => setF({ depositNote: e.target.value })} /></Field>
        </div>}
      </Drawer>

      <Drawer open={kind === "deposit"} onClose={close} title="Return deposit" sub={f.lease ? `${f.lease.no} · held ${rs(f.lease.deposit)}` : ""}
        footer={foot("Save", f.returned !== "", () => send("POST", `/rentals/leases/${f.lease.id}/deposit`, { returned: N(f.returned), note: f.note || null }))}>
        {kind === "deposit" && <div className="pf-stack">
          <Field label="Returned (Rs.)"><Input className="input tnum" inputMode="numeric" value={f.returned ?? ""} onChange={(e) => setF({ returned: num(e.target.value) })} /></Field>
          <Field label="Note" optional><Textarea rows={2} value={f.note || ""} onChange={(e) => setF({ note: e.target.value })} /></Field>
        </div>}
      </Drawer>

      <Drawer open={kind === "pay"} onClose={close} title="Record payment" sub={f.bill ? `${f.bill.no} · ${f.bill.renter} · owes ${rs(f.bill.balance)}` : ""}
        footer={foot("Save payment", N(f.amount) > 0 && f.paidOn, () => send("POST", `/rentals/bills/${f.bill.id}/payments`, { amount: N(f.amount), method: f.method, paidOn: f.paidOn, ref: f.ref || null, note: f.note || null }))}>
        {kind === "pay" && <div className="pf-stack">
          <div className="pf-grid-2 tight"><Field label="Amount (Rs.)" hint={`Up to ${rs(f.bill?.balance || 0)}`}><Input className="input tnum" inputMode="numeric" value={f.amount || ""} onChange={(e) => setF({ amount: num(e.target.value) })} /></Field>
            <Field label="Paid on"><Input type="date" value={f.paidOn || ""} onChange={(e) => setF({ paidOn: e.target.value })} /></Field></div>
          <Field label="Paid by"><Select value={f.method || "cash"} onChange={(x) => setF({ method: x })} options={d.methods.map((m) => ({ id: m, label: METHOD[m] || m }))} /></Field>
          <Field label="Reference" hint="Cheque or transaction number" optional><Input value={f.ref || ""} onChange={(e) => setF({ ref: e.target.value })} /></Field>
          <Field label="Note" optional><Input value={f.note || ""} onChange={(e) => setF({ note: e.target.value })} /></Field>
        </div>}
      </Drawer>

      <Drawer open={kind === "payments"} onClose={close} title={`Payments on ${f.bill?.no || ""}`} sub={f.bill ? `${f.bill.renter} · ${monthName(f.bill.month)}` : ""} footer={<Button variant="outline" onClick={close}>Close</Button>}>
        {kind === "payments" && <Table rows={f.list || []} minWidth={420} columns={[
          { key: "d", label: "Date", num: true, render: (p) => fdate(p.paidOn) },
          { key: "m", label: "Paid by", render: (p) => <Two a={METHOD[p.method] || p.method} b={[p.online ? (p.status === "pending" ? "Online, waiting" : p.status === "rejected" ? "Online, rejected" : "Online") : "", p.ref, p.note].filter(Boolean).join(" · ")} /> },
          { key: "a", label: "Amount", num: true, align: "right", render: (p) => rs(p.amount) },
          { key: "x", label: "", align: "right", render: (p) => d.canManage && p.status === "confirmed" && p.to !== "sheetal" && <Button variant="ghost" size="sm" onClick={() => window.confirm(`Remove the payment of ${rs(p.amount)}? Use this only for a mistake.`) && send("DELETE", `/rentals/payments/${p.id}`)}>Remove</Button> },
        ]} />}
      </Drawer>

      <Drawer open={kind === "bill"} onClose={close} title={`Change ${f.bill?.no || ""}`} sub="Only before anything is paid, for example a first month that starts mid-month."
        footer={foot("Save", N(f.amount) > 0, () => send("PUT", `/rentals/bills/${f.bill.id}`, { amount: N(f.amount) }))}>
        {kind === "bill" && <Field label="Rent for this month (Rs.)"><Input className="input tnum" inputMode="numeric" value={f.amount || ""} onChange={(e) => setF({ amount: num(e.target.value) })} /></Field>}
      </Drawer>

      <Drawer open={kind === "repair"} onClose={close} title={f.id ? f.no || "Repair" : "Log a repair"} sub={f.id ? f.unit : ""}
        footer={foot("Save", (f.unitId || f.id) && (f.title || "").trim(), () => { const body = { title: f.title.trim(), priority: f.priority || "normal", vendor: f.vendor || null, cost: N(f.cost), status: f.status || "open", doneOn: f.status === "done" ? f.doneOn || null : null }; return f.id ? send("PUT", `/rentals/repairs/${f.id}`, body) : send("POST", "/rentals/repairs", { ...body, unitId: f.unitId }); })}>
        {kind === "repair" && <div className="pf-stack">
          {!f.id && <Field label="Unit"><Select value={f.unitId || ""} onChange={(x) => setF({ unitId: x })} options={unitOpts} /></Field>}
          <Field label="What needs fixing"><Input value={f.title || ""} onChange={(e) => setF({ title: e.target.value })} placeholder="Water heater not working" /></Field>
          <div className="pf-grid-2 tight"><Field label="Priority"><Select value={f.priority || "normal"} onChange={(x) => setF({ priority: x })} options={[["urgent", "Urgent"], ["normal", "Normal"], ["low", "Low"]].map(([id, label]) => ({ id, label }))} /></Field>
            <Field label="Status"><Select value={f.status || "open"} onChange={(x) => setF({ status: x })} options={[["open", "Open"], ["assigned", "Assigned"], ["done", "Done"]].map(([id, label]) => ({ id, label }))} /></Field></div>
          <div className="pf-grid-2 tight"><Field label="Vendor" optional><Input value={f.vendor || ""} onChange={(e) => setF({ vendor: e.target.value })} placeholder="Plumber, electrician…" /></Field>
            <Field label="Cost (Rs.)" hint="Comes off the owner's statement" optional><Input className="input tnum" inputMode="numeric" value={f.cost || ""} onChange={(e) => setF({ cost: num(e.target.value) })} /></Field></div>
          {f.status === "done" && <Field label="Done on" hint="Empty = today"><Input type="date" value={f.doneOn || ""} onChange={(e) => setF({ doneOn: e.target.value })} /></Field>}
        </div>}
      </Drawer>
    </>
  );
}
