// Rentals for agencies that manage homes and shops for owners: units, tenants, leases, rent, repairs and owner
// statements (sample data in db.pm[tenantId], marked Preview).

import React, { useMemo, useState } from "react";
import { useStore } from "@sheetal/shared/core/store";
import { useRouter } from "@sheetal/shared/core/router";
import { TODAY as NOW, fdate, rs } from "@sheetal/shared/core/format";
import { Badge, Button, Drawer, Empty, Field, Input, PageHead, Panel, Select, Stat, Table, Tabs, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { DataActions } from "@sheetal/shared/components/DataIO";
import { DeleteConfirm, restoreAt } from "@sheetal/shared/components/Crud";

const TODAY = NOW.slice(0, 10);
const MONTH = TODAY.slice(0, 7);
const D = (s) => new Date(s + "T00:00:00Z");
const addDays = (s, n) => { const x = D(s); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const addMonths = (s, n) => { const x = D(s); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
const daysTo = (s) => Math.round((D(s) - D(TODAY)) / 864e5);
const monthName = (m) => D(m + "-01").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const nextId = (list, prefix) => prefix + (Math.max(100, ...list.map((x) => Number(String(x.id).replace(/\D/g, "")) || 0)) + 1);
const LATE_FEE = 0.02;
const METHODS = [["esewa", "eSewa"], ["khalti", "Khalti"], ["fonepay", "Fonepay QR"], ["bank", "Bank transfer"], ["cash", "Cash"]];

// Every business starts with no owners, units or leases.
export function seedPm() {
  return { owners: [], props: [], units: [], leases: [], invoices: [], work: [] };
}

function derive(pm) {
  const unit = Object.fromEntries(pm.units.map((x) => [x.id, x]));
  const prop = Object.fromEntries(pm.props.map((x) => [x.id, x]));
  const owner = Object.fromEntries(pm.owners.map((x) => [x.id, x]));
  const lease = Object.fromEntries(pm.leases.map((x) => [x.id, x]));
  const leaseStatus = (x) => (daysTo(x.end) < 0 ? "ended" : daysTo(x.end) <= 60 ? "ending" : "active");
  const live = pm.leases.filter((x) => leaseStatus(x) !== "ended");
  const leaseOfUnit = Object.fromEntries(live.map((x) => [x.unitId, x]));
  const invStatus = (i) => (i.paid >= i.amount ? "paid" : daysTo(i.due) < 0 ? "overdue" : i.paid > 0 ? "partial" : "due");
  const bills = pm.invoices.map((i) => {
    const ls = lease[i.leaseId] || {}; const un = unit[ls.unitId] || {}; const st = invStatus(i);
    return { ...i, lease: ls, unit: un, prop: prop[un.propId] || {}, status: st, left: Math.max(0, i.amount - i.paid), late: st === "overdue" ? Math.round((i.amount - i.paid) * LATE_FEE) : 0 };
  }).sort((a, b) => b.month.localeCompare(a.month) || a.id.localeCompare(b.id));
  const month = bills.filter((b) => b.month === MONTH);
  const let_ = pm.units.filter((x) => x.status === "occupied" || x.status === "notice").length;
  return {
    unit, prop, owner, lease, leaseStatus, leaseOfUnit, bills,
    occupancy: pm.units.length ? Math.round((let_ / pm.units.length) * 100) : 0, let_,
    due: month.reduce((s, b) => s + b.amount, 0), collected: month.reduce((s, b) => s + b.paid, 0),
    overdue: bills.filter((b) => b.status === "overdue"),
    ending: pm.leases.filter((x) => leaseStatus(x) === "ending").sort((a, b) => a.end.localeCompare(b.end)),
    missing: live.filter((x) => x.start.slice(0, 7) <= MONTH && !pm.invoices.some((i) => i.leaseId === x.id && i.month === MONTH)),
  };
}

const UNIT_TONE = { occupied: ["done", "Let"], notice: ["action", "On notice"], vacant: ["neutral", "Vacant"], repair: ["problem", "Under repair"] };
const BILL_TONE = { paid: ["done", "Paid"], partial: ["progress", "Part paid"], due: ["neutral", "Due"], overdue: ["action", "Overdue"] };
const WORK_TONE = { open: ["action", "Open"], assigned: ["progress", "Assigned"], done: ["done", "Done"] };
const PRI_TONE = { urgent: ["problem", "Urgent"], normal: ["neutral", "Normal"], low: ["neutral", "Low"] };
const Tone = ({ map, k }) => <Badge tone={(map[k] || ["neutral"])[0]}>{(map[k] || [null, k])[1]}</Badge>;
const Two = ({ a, b }) => <span className="pf-two"><b>{a}</b>{b && <small>{b}</small>}</span>;

export function Rentals({ tenant, tab = "overview" }) {
  const { db, update } = useStore();
  const { navigate } = useRouter();
  const toast = useToast();
  const pm = db.pm?.[tenant.id] || seedPm();
  const v = useMemo(() => derive(pm), [pm]);
  const save = (fn) => update((d) => { d.pm = d.pm || {}; if (!d.pm[tenant.id]) d.pm[tenant.id] = seedPm(); fn(d.pm[tenant.id]); });
  const [dr, setDr] = useState(null);
  const [f, setF] = useState({});
  const open = (kind, init = {}) => { setF(init); setDr(kind); };
  const close = () => setDr(null);
  const set = (k) => (e) => setF({ ...f, [k]: e && e.target ? e.target.value : e });
  const go = (id) => navigate(id === "overview" ? "/business/rentals" : "/business/rentals/" + id);
  const unitLabel = (u) => (u && u.id ? (v.prop[u.propId] || {}).name + " · " + u.name : "—");
  const openWork = pm.work.filter((w) => w.status !== "done");

  const tabs = [
    { id: "overview", label: "Overview", icon: "layout-grid" },
    { id: "units", label: "Properties and units", icon: "building-2", count: pm.units.length },
    { id: "leases", label: "Tenants and leases", icon: "users", count: v.ending.length || undefined },
    { id: "rent", label: "Rent", icon: "receipt", count: v.overdue.length || undefined },
    { id: "repairs", label: "Repairs", icon: "wrench", count: openWork.length || undefined },
    { id: "owners", label: "Owner statements", icon: "wallet" },
  ];
  const T = tabs.some((x) => x.id === tab) ? tab : "overview";

  // ── actions ──
  const createBills = () => {
    const n = v.missing.length;
    save((x) => { v.missing.forEach((ls) => x.invoices.push({ id: nextId(x.invoices, "RB-"), leaseId: ls.id, month: MONTH, due: MONTH + "-07", amount: ls.rent, paid: 0, method: null, paidOn: null })); });
    toast(n + " rent bills created and sent by SMS");
  };
  const recordPay = () => {
    const amt = Number(f.amount) || 0;
    save((x) => { const i = x.invoices.find((y) => y.id === f.id); i.paid = Math.min(i.amount, i.paid + amt); i.method = f.method; i.paidOn = TODAY; });
    toast("Payment recorded. Receipt sent to the tenant."); close();
  };
  const addLease = () => {
    const u = v.unit[f.unitId]; const rent = Number(f.rent) || u.rent; const months = Number(f.months) || 12;
    save((x) => {
      const id = nextId(x.leases, "LS-");
      x.leases.push({ id, unitId: u.id, tenant: f.tenant.trim(), phone: f.phone || "", kyc: false, start: f.start, end: addDays(addMonths(f.start, months), -1), rent, deposit: Number(f.deposit) || rent * 2, escalation: 10 });
      x.units.find((y) => y.id === u.id).status = "occupied";
      if (f.start.slice(0, 7) <= MONTH) x.invoices.push({ id: nextId(x.invoices, "RB-"), leaseId: id, month: MONTH, due: MONTH + "-07", amount: rent, paid: 0, method: null, paidOn: null });
    });
    toast("Lease created. Send it for e-signing from Agreements."); close();
  };
  const renew = (ls) => {
    const rent = Math.round((ls.rent * (100 + ls.escalation)) / 100 / 100) * 100;
    save((x) => { const y = x.leases.find((z) => z.id === ls.id); y.end = addDays(addMonths(addDays(y.end, 1), 12), -1); y.rent = rent; });
    toast("Renewed for 12 months at " + rs(rent) + " a month");
  };
  const endLease = (ls) => {
    save((x) => { const y = x.leases.find((z) => z.id === ls.id); y.end = addDays(TODAY, -1); x.units.find((z) => z.id === ls.unitId).status = "vacant"; });
    toast("Lease ended. The unit is now vacant. Do the move-out inspection before returning the deposit.");
  };
  const addWork = () => {
    save((x) => { x.work.unshift({ id: nextId(x.work, "WO-"), unitId: f.unitId, title: f.title.trim(), priority: f.priority || "normal", vendor: "", cost: 0, status: "open", created: TODAY }); });
    toast("Repair request logged"); close();
  };
  const saveWork = () => {
    save((x) => { const w = x.work.find((y) => y.id === f.id); w.vendor = f.vendor || ""; w.cost = Number(f.cost) || 0; w.status = f.status; });
    toast(f.status === "done" ? "Marked done. The owner sees the cost on the statement." : "Repair updated"); close();
  };
  const addUnit = () => {
    if (f.id) save((x) => { Object.assign(x.units.find((u) => u.id === f.id), { name: f.name.trim(), kind: f.kind || "Flat", rent: Number(f.rent) || 0, ...(f.status ? { status: f.status } : {}) }); });
    else save((x) => { x.units.push({ id: "u" + (x.units.length + 1) + "-" + Date.now().toString(36).slice(-3), propId: f.propId, name: f.name.trim(), kind: f.kind || "Flat", rent: Number(f.rent) || 0, status: "vacant" }); });
    toast(f.id ? "Unit saved" : "Unit added"); close();
  };
  const addProp = () => {
    if (f.id) save((x) => { Object.assign(x.props.find((p) => p.id === f.id), { name: f.name.trim(), area: f.area || "", ownerId: f.ownerId }); });
    else save((x) => { x.props.push({ id: "p" + (x.props.length + 1) + "-" + Date.now().toString(36).slice(-3), name: f.name.trim(), area: f.area || "", ownerId: f.ownerId }); });
    toast(f.id ? "Property saved" : "Property added. Now add its units."); close();
  };
  const saveOwner = () => {
    const rec = { name: f.name.trim(), phone: f.phone || "", fee: Number(f.fee) || 0, bank: f.bank || "" };
    if (f.id) save((x) => { Object.assign(x.owners.find((o) => o.id === f.id), rec); });
    else save((x) => { x.owners.push({ id: "o" + Date.now().toString(36), ...rec }); });
    toast("Owner saved"); close();
  };
  // delete: units only when no lease ever used them; properties only when empty; owners only when they own nothing
  const [del, setDel] = useState(null);
  const unitUsed = (u) => pm.leases.some((l) => l.unitId === u.id) || pm.work.some((w) => w.unitId === u.id);
  const KEY = { unit: "units", prop: "props", owner: "owners" };
  const askDel = (kind) => { const l = pm[KEY[kind]]; const at = l.findIndex((x) => x.id === f.id); setDel({ kind, item: l[at], at }); };
  const doDelete = ({ kind, item }) => { save((x) => { x[KEY[kind]].splice(x[KEY[kind]].findIndex((y) => y.id === item.id), 1); }); close(); };
  const leaseRows = pm.leases.map((ls) => ({ ...ls, unit: (v.unit[ls.unitId] || {}).name || "" }));
  const importLeases = (rows) => {
    const miss = rows.filter((r) => !pm.units.some((u) => u.name.toLowerCase() === r.unit.toLowerCase()));
    save((x) => { rows.forEach((r, i) => { const u = x.units.find((y) => y.name.toLowerCase() === r.unit.toLowerCase()); if (!u) return; x.leases.push({ id: "L" + Date.now().toString(36) + i, unitId: u.id, tenant: r.tenant, phone: r.phone, kyc: false, start: r.start, end: r.end, rent: r.rent, deposit: r.deposit || r.rent * 2, escalation: 10 }); if (r.end >= TODAY) u.status = "occupied"; }); });
    if (miss.length) toast(miss.length + " rows skipped: unit not found (" + [...new Set(miss.map((r) => r.unit))].slice(0, 3).join(", ") + ")");
  };

  const statements = pm.owners.map((o) => {
    const props = pm.props.filter((p) => p.ownerId === o.id);
    const unitIds = new Set(pm.units.filter((u) => props.some((p) => p.id === u.propId)).map((u) => u.id));
    const collected = v.bills.filter((b) => b.month === MONTH && unitIds.has(b.unit.id)).reduce((s, b) => s + b.paid, 0);
    const repairs = pm.work.filter((w) => w.status === "done" && unitIds.has(w.unitId) && w.created >= addDays(TODAY, -30)).reduce((s, w) => s + w.cost, 0);
    const feeAmt = Math.round((collected * o.fee) / 100);
    return { ...o, props: props.map((p) => p.name).join(", "), units: unitIds.size, collected, feeAmt, repairs, net: collected - feeAmt - repairs };
  });

  return (
    <>
      <PageHead title="Rentals" sub="Homes and shops you manage for owners: units, tenants, rent and repairs."
        actions={<>
          <Button variant="outline" icon="wrench" onClick={() => open("work", { unitId: pm.units[0]?.id, priority: "normal", title: "" })}>Log a repair</Button>
          <Button icon="plus" onClick={() => open("lease", { unitId: pm.units.find((u) => u.status === "vacant")?.id || "", tenant: "", phone: "", start: TODAY, months: "12" })}>New lease</Button>
        </>} />
      <Tabs tabs={tabs} value={T} onChange={go} />

      {T === "overview" && <>
        <div className="pf-stats">
          <Stat label="Occupancy" value={v.occupancy + "%"} note={v.let_ + " of " + pm.units.length + " units let"} to="/business/rentals/units" />
          <Stat label={"Rent for " + monthName(MONTH)} value={rs(v.due)} note={rs(v.collected) + " collected"} to="/business/rentals/rent" />
          <Stat label="Overdue" value={rs(v.overdue.reduce((s, b) => s + b.left, 0))} note={v.overdue.length + " bills past due"} noteIcon="circle-alert" tone={v.overdue.length ? "action" : undefined} to="/business/rentals/rent" />
          <Stat label="Leases ending" value={v.ending.length} note="In the next 60 days" to="/business/rentals/leases" />
        </div>
        <div className="pf-split">
          <Panel title="Needs you" sub="Overdue rent, urgent repairs and leases about to end" className="grow">
            {v.overdue.length + v.ending.length + openWork.length ? <ul className="pf-list">
              {v.overdue.map((b) => <li key={b.id}><span className="pf-li-ico"><Icon name="receipt" size={17} /></span><div><b>{b.lease.tenant} owes {rs(b.left)}</b><span className="small muted">{unitLabel(b.unit)} · {monthName(b.month)} · due {fdate(b.due)}</span></div><Button variant="outline" size="sm" onClick={() => toast("Reminder sent to " + b.lease.tenant + " by SMS and WhatsApp")}>Send reminder</Button></li>)}
              {openWork.filter((w) => w.priority === "urgent" || w.status === "open").map((w) => <li key={w.id}><span className="pf-li-ico"><Icon name="wrench" size={17} /></span><div><b>{w.title}</b><span className="small muted">{unitLabel(v.unit[w.unitId])} · {w.vendor || "No vendor yet"}</span></div><Button variant="outline" size="sm" onClick={() => open("workEdit", { ...w })}>{w.vendor ? "Update" : "Assign"}</Button></li>)}
              {v.ending.map((ls) => <li key={ls.id}><span className="pf-li-ico"><Icon name="calendar-days" size={17} /></span><div><b>{ls.tenant}: lease ends in {daysTo(ls.end)} days</b><span className="small muted">{unitLabel(v.unit[ls.unitId])} · {fdate(ls.end)}</span></div><Button variant="outline" size="sm" onClick={() => go("leases")}>Renew or end</Button></li>)}
            </ul> : <p className="pf-pad small muted">Nothing waiting. Rent is in and repairs are done.</p>}
          </Panel>
          <Panel title="Vacant units" className="side">
            {pm.units.filter((u) => u.status === "vacant").length ? <ul className="pf-list">{pm.units.filter((u) => u.status === "vacant").map((u) => (
              <li key={u.id}><div><b>{unitLabel(u)}</b><span className="small muted">{u.kind} · {rs(u.rent)} a month</span></div><Button variant="ghost" size="sm" onClick={() => navigate("/business/listings/new")}>List it</Button></li>
            ))}</ul> : <p className="pf-pad small muted">Every unit is let.</p>}
          </Panel>
        </div>
      </>}

      {T === "units" && <>
        <div className="pf-row-actions" style={{ justifyContent: "flex-end" }}><DataActions kind="units" rows={pm.units.map((u) => ({ no: u.name, type: u.kind, beds: "", pax: "", rate: u.rent, floor: "" }))} onlyExport /><Button variant="outline" icon="plus" onClick={() => open("prop", { name: "", area: "", ownerId: pm.owners[0]?.id })}>Add property</Button></div>
        {!pm.props.length && <Empty icon="building-2" title="No properties yet" action={<Button icon="plus" onClick={() => open("prop", { name: "", area: "", ownerId: pm.owners[0]?.id })}>Add property</Button>}>Add a building or house you manage, then its flats or shops.</Empty>}
        {pm.props.map((p) => (
          <Panel key={p.id} title={p.name} sub={p.area + " · Owner: " + ((v.owner[p.ownerId] || {}).name || "—")} actions={<><Button variant="ghost" size="sm" icon="pencil" onClick={() => open("prop", { ...p })}>Edit</Button><Button variant="ghost" size="sm" icon="plus" onClick={() => open("unit", { propId: p.id, name: "", kind: "Flat", rent: "" })}>Add unit</Button></>}>
            <Table rows={pm.units.filter((u) => u.propId === p.id)} onRowClick={(u) => open("unit", { ...u, rent: String(u.rent) })} empty={<p className="pf-pad small muted">No units yet.</p>} minWidth={640} columns={[
              { key: "name", label: "Unit", render: (u) => <Two a={u.name} b={u.kind} /> },
              { key: "rent", label: "Rent", num: true, render: (u) => rs(u.rent) },
              { key: "status", label: "Status", render: (u) => <Tone map={UNIT_TONE} k={u.status} /> },
              { key: "tenant", label: "Tenant", render: (u) => (v.leaseOfUnit[u.id] ? <Two a={v.leaseOfUnit[u.id].tenant} b={"Until " + fdate(v.leaseOfUnit[u.id].end)} /> : <span className="muted">—</span>) },
              { key: "x", label: "", align: "right", render: (u) => (u.status === "vacant" ? <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); open("lease", { unitId: u.id, tenant: "", phone: "", start: TODAY, months: "12", rent: String(u.rent) }); }}>Add tenant</Button> : null) },
            ]} />
          </Panel>
        ))}
      </>}

      {T === "leases" && <Panel title="Tenants and leases" sub="Rent goes up by the agreed % on renewal. Deposits are returned after the move-out inspection." actions={<DataActions kind="rentals" size="sm" rows={leaseRows} onImport={importLeases} />}>
        <Table rows={[...pm.leases].sort((a, b) => a.end.localeCompare(b.end))} minWidth={860} columns={[
          { key: "tenant", label: "Tenant", render: (ls) => <Two a={ls.tenant} b={ls.phone + (ls.kyc ? " · KYC done" : " · KYC pending")} /> },
          { key: "unit", label: "Unit", render: (ls) => unitLabel(v.unit[ls.unitId]) },
          { key: "period", label: "Period", num: true, render: (ls) => fdate(ls.start) + " – " + fdate(ls.end) },
          { key: "rent", label: "Rent", num: true, render: (ls) => rs(ls.rent) },
          { key: "deposit", label: "Deposit", num: true, render: (ls) => rs(ls.deposit) },
          { key: "status", label: "Status", render: (ls) => { const s = v.leaseStatus(ls); return s === "ending" ? <Badge tone="action">Ends in {daysTo(ls.end)} days</Badge> : s === "ended" ? <Badge tone="neutral">Ended</Badge> : <Badge tone="done">Active</Badge>; } },
          { key: "x", label: "", align: "right", render: (ls) => v.leaseStatus(ls) === "ended" ? null : <div className="pf-row-actions" style={{ justifyContent: "flex-end" }}>
            {v.leaseStatus(ls) === "ending" && <Button variant="outline" size="sm" onClick={() => renew(ls)}>Renew +{ls.escalation}%</Button>}
            <Button variant="ghost" size="sm" onClick={() => endLease(ls)}>End</Button>
          </div> },
        ]} />
      </Panel>}

      {T === "rent" && <Panel title="Rent bills" sub={"Due on the 7th. A " + LATE_FEE * 100 + "% late fee is added after the due date."}
        actions={<Button size="sm" icon="receipt" disabled={!v.missing.length} onClick={createBills}>{v.missing.length ? "Create " + v.missing.length + " bills for " + monthName(MONTH) : monthName(MONTH) + " bills created"}</Button>}>
        <Table rows={v.bills} minWidth={920} empty={<Empty icon="receipt" title="No rent bills yet" />} columns={[
          { key: "id", label: "Bill", render: (b) => <Two a={b.id} b={monthName(b.month)} /> },
          { key: "tenant", label: "Tenant", render: (b) => <Two a={b.lease.tenant} b={unitLabel(b.unit)} /> },
          { key: "due", label: "Due", num: true, render: (b) => fdate(b.due) },
          { key: "amount", label: "Amount", num: true, render: (b) => rs(b.amount) },
          { key: "paid", label: "Paid", num: true, render: (b) => (b.paid ? rs(b.paid) : "—") },
          { key: "late", label: "Late fee", num: true, render: (b) => (b.late ? rs(b.late) : "—") },
          { key: "status", label: "Status", render: (b) => <Tone map={BILL_TONE} k={b.status} /> },
          { key: "x", label: "", align: "right", render: (b) => b.status === "paid" ? <Button variant="ghost" size="sm" icon="download" onClick={() => toast("Receipt " + b.id + " downloaded")}>Receipt</Button> : <div className="pf-row-actions" style={{ justifyContent: "flex-end" }}>
            <Button variant="ghost" size="sm" onClick={() => toast("Payment link for " + rs(b.left + b.late) + " sent to " + b.lease.tenant)}>Send link</Button>
            <Button variant="outline" size="sm" onClick={() => open("pay", { id: b.id, amount: String(b.left + b.late), method: "esewa", max: b.left + b.late, who: b.lease.tenant })}>Record payment</Button>
          </div> },
        ]} />
      </Panel>}

      {T === "repairs" && <Panel title="Repairs" sub="Requests from tenants and inspections. Done repairs appear on the owner's statement.">
        <Table rows={pm.work} minWidth={860} empty={<Empty icon="wrench" title="No repairs logged" />} columns={[
          { key: "title", label: "Issue", render: (w) => <Two a={w.title} b={w.id + " · " + fdate(w.created)} /> },
          { key: "unit", label: "Unit", render: (w) => unitLabel(v.unit[w.unitId]) },
          { key: "priority", label: "Priority", render: (w) => <Tone map={PRI_TONE} k={w.priority} /> },
          { key: "vendor", label: "Vendor", render: (w) => w.vendor || <span className="muted">—</span> },
          { key: "cost", label: "Cost", num: true, render: (w) => (w.cost ? rs(w.cost) : "—") },
          { key: "status", label: "Status", render: (w) => <Tone map={WORK_TONE} k={w.status} /> },
          { key: "x", label: "", align: "right", render: (w) => w.status === "done" ? null : <Button variant="outline" size="sm" onClick={() => open("workEdit", { ...w, status: w.status === "open" ? "assigned" : "done", cost: String(w.cost || "") })}>{w.status === "open" ? "Assign" : "Mark done"}</Button> },
        ]} />
      </Panel>}

      {T === "owners" && <Panel title={"Owner statements · " + monthName(MONTH)} sub="Rent collected, minus your management fee and repair costs, is paid to the owner's bank. Click an owner to edit their details." actions={<Button variant="outline" size="sm" icon="user-plus" onClick={() => open("owner", { name: "", phone: "", fee: "8", bank: "" })}>Add owner</Button>}>
        <Table rows={statements} minWidth={900} onRowClick={(o) => open("owner", { id: o.id, name: o.name, phone: o.phone, fee: String(o.fee), bank: o.bank })} columns={[
          { key: "name", label: "Owner", render: (o) => <Two a={o.name} b={o.props} /> },
          { key: "collected", label: "Collected", num: true, render: (o) => rs(o.collected) },
          { key: "fee", label: "Fee", num: true, render: (o) => rs(o.feeAmt) + " (" + o.fee + "%)" },
          { key: "repairs", label: "Repairs", num: true, render: (o) => (o.repairs ? "− " + rs(o.repairs) : "—") },
          { key: "net", label: "Net payout", num: true, render: (o) => <b>{rs(o.net)}</b> },
          { key: "bank", label: "Paid to", render: (o) => <span className="small">{o.bank}</span> },
          { key: "x", label: "", align: "right", render: (o) => <div className="pf-row-actions" style={{ justifyContent: "flex-end" }}>
            <Button variant="ghost" size="sm" onClick={() => toast("Statement emailed to " + o.name)}>Send statement</Button>
            <Button variant="outline" size="sm" disabled={o.net <= 0} onClick={() => toast(rs(o.net) + " payout queued to " + o.bank)}>Pay out</Button>
          </div> },
        ]} />
      </Panel>}

      <Drawer open={dr === "pay"} onClose={close} title="Record payment" sub={f.who}
        footer={<><Button variant="outline" onClick={close}>Cancel</Button><Button disabled={!(Number(f.amount) > 0)} onClick={recordPay}>Save and send receipt</Button></>}>
        <div className="pf-stack">
          <Field label="Amount" hint={"Up to " + rs(f.max || 0) + " including any late fee"}><Input className="input tnum" inputMode="numeric" value={f.amount || ""} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/\D/g, "") })} /></Field>
          <Field label="Paid by"><Select value={f.method || "esewa"} onChange={set("method")} options={METHODS.map(([id, label]) => ({ id, label }))} /></Field>
        </div>
      </Drawer>

      <Drawer open={dr === "lease"} onClose={close} title="New lease" sub="The tenant gets the lease to sign by SMS from Agreements."
        footer={<><Button variant="outline" onClick={close}>Cancel</Button><Button disabled={!f.unitId || !(f.tenant || "").trim() || !f.start} onClick={addLease}>Create lease</Button></>}>
        <div className="pf-stack">
          <Field label="Unit"><Select value={f.unitId || ""} onChange={(id) => setF({ ...f, unitId: id, rent: String((v.unit[id] || {}).rent || "") })} options={[{ id: "", label: "Choose a unit" }, ...pm.units.filter((u) => u.status === "vacant" || u.id === f.unitId).map((u) => ({ id: u.id, label: unitLabel(u) + " · " + u.kind }))]} /></Field>
          <div className="pf-grid-2 tight"><Field label="Tenant name"><Input value={f.tenant || ""} onChange={set("tenant")} /></Field><Field label="Mobile"><Input className="input tnum" inputMode="tel" value={f.phone || ""} onChange={set("phone")} /></Field></div>
          <div className="pf-grid-2 tight"><Field label="Start date"><Input type="date" value={f.start || ""} onChange={set("start")} /></Field><Field label="Length"><Select value={f.months || "12"} onChange={set("months")} options={[["6", "6 months"], ["12", "1 year"], ["24", "2 years"], ["36", "3 years"]].map(([id, label]) => ({ id, label }))} /></Field></div>
          <div className="pf-grid-2 tight"><Field label="Monthly rent"><Input className="input tnum" inputMode="numeric" value={f.rent || ""} onChange={(e) => setF({ ...f, rent: e.target.value.replace(/\D/g, "") })} /></Field><Field label="Deposit" hint="Default: 2 months' rent" optional><Input className="input tnum" inputMode="numeric" value={f.deposit || ""} placeholder={f.rent ? String(Number(f.rent) * 2) : ""} onChange={(e) => setF({ ...f, deposit: e.target.value.replace(/\D/g, "") })} /></Field></div>
          <Button variant="ghost" size="sm" icon="file-pen-line" onClick={() => navigate("/business/agreements")}>Open Agreements to send for signing</Button>
        </div>
      </Drawer>

      <Drawer open={dr === "work"} onClose={close} title="Log a repair"
        footer={<><Button variant="outline" onClick={close}>Cancel</Button><Button disabled={!f.unitId || !(f.title || "").trim()} onClick={addWork}>Log repair</Button></>}>
        <div className="pf-stack">
          <Field label="Unit"><Select value={f.unitId || ""} onChange={set("unitId")} options={pm.units.map((u) => ({ id: u.id, label: unitLabel(u) }))} /></Field>
          <Field label="What needs fixing"><Input value={f.title || ""} onChange={set("title")} placeholder="Water heater not working" /></Field>
          <Field label="Priority"><Select value={f.priority || "normal"} onChange={set("priority")} options={[["urgent", "Urgent (today)"], ["normal", "Normal (this week)"], ["low", "Low"]].map(([id, label]) => ({ id, label }))} /></Field>
        </div>
      </Drawer>

      <Drawer open={dr === "workEdit"} onClose={close} title={f.title} sub={f.id}
        footer={<><Button variant="outline" onClick={close}>Cancel</Button><Button onClick={saveWork}>Save</Button></>}>
        <div className="pf-stack">
          <Field label="Vendor"><Input value={f.vendor || ""} onChange={set("vendor")} placeholder="Plumber, electrician or painter" /></Field>
          <Field label="Cost" hint="Charged to the owner when done" optional><Input className="input tnum" inputMode="numeric" value={f.cost || ""} onChange={(e) => setF({ ...f, cost: e.target.value.replace(/\D/g, "") })} /></Field>
          <Field label="Status"><Select value={f.status || "open"} onChange={set("status")} options={[["open", "Open"], ["assigned", "Assigned"], ["done", "Done"]].map(([id, label]) => ({ id, label }))} /></Field>
        </div>
      </Drawer>

      <Drawer open={dr === "unit"} onClose={close} title={f.id ? "Edit " + (f.name || "unit") : "Add unit"} sub={(v.prop[f.propId] || {}).name}
        footer={<>{f.id && <Button variant="ghost" className="pf-danger pf-foot-left" icon="trash-2" disabled={unitUsed(f)} title={unitUsed(f) ? "Has leases or repairs on record, so it can't be deleted" : undefined} onClick={() => askDel("unit")}>Delete</Button>}<Button variant="outline" onClick={close}>Cancel</Button><Button disabled={!(f.name || "").trim()} onClick={addUnit}>{f.id ? "Save" : "Add unit"}</Button></>}>
        <div className="pf-stack">
          <div className="pf-grid-2 tight"><Field label="Unit name"><Input value={f.name || ""} onChange={set("name")} placeholder="Flat 3A" /></Field><Field label="Type"><Select value={f.kind || "Flat"} onChange={set("kind")} options={["1 BHK", "2 BHK", "3 BHK", "Flat", "Room", "Shop", "Office", "House"].map((x) => ({ id: x, label: x }))} /></Field></div>
          <Field label="Monthly rent"><Input className="input tnum" inputMode="numeric" value={f.rent || ""} onChange={(e) => setF({ ...f, rent: e.target.value.replace(/\D/g, "") })} /></Field>
          {f.id && f.status !== "occupied" && f.status !== "notice" && <Field label="Status"><Select value={f.status || "vacant"} onChange={set("status")} options={[["vacant", "Vacant"], ["repair", "Under repair"]].map(([id, label]) => ({ id, label }))} /></Field>}
        </div>
      </Drawer>

      <Drawer open={dr === "prop"} onClose={close} title={f.id ? "Edit property" : "Add property"}
        footer={<>{f.id && <Button variant="ghost" className="pf-danger pf-foot-left" icon="trash-2" disabled={pm.units.some((u) => u.propId === f.id)} title={pm.units.some((u) => u.propId === f.id) ? "Delete or move its units first" : undefined} onClick={() => askDel("prop")}>Delete</Button>}<Button variant="outline" onClick={close}>Cancel</Button><Button disabled={!(f.name || "").trim() || !f.ownerId} onClick={addProp}>{f.id ? "Save" : "Add property"}</Button></>}>
        <div className="pf-stack">
          <Field label="Property name"><Input value={f.name || ""} onChange={set("name")} placeholder="Sanepa Apartments" /></Field>
          <Field label="Area"><Input value={f.area || ""} onChange={set("area")} placeholder="Sanepa, Lalitpur" /></Field>
          <Field label="Owner"><Select value={f.ownerId || ""} onChange={set("ownerId")} options={pm.owners.map((o) => ({ id: o.id, label: o.name + " · " + o.fee + "% fee" }))} /></Field>
          <Button variant="ghost" size="sm" icon="user-plus" onClick={() => open("owner", { name: "", phone: "", fee: "8", bank: "" })}>Add a new owner</Button>
        </div>
      </Drawer>

      <Drawer open={dr === "owner"} onClose={close} title={f.id ? "Edit owner" : "Add owner"} sub="Owner statements and payouts use these details"
        footer={<>{f.id && <Button variant="ghost" className="pf-danger pf-foot-left" icon="trash-2" disabled={pm.props.some((p) => p.ownerId === f.id)} title={pm.props.some((p) => p.ownerId === f.id) ? "Owns properties you manage, so it can't be deleted" : undefined} onClick={() => askDel("owner")}>Delete</Button>}<Button variant="outline" onClick={close}>Cancel</Button><Button disabled={!(f.name || "").trim()} onClick={saveOwner}>Save</Button></>}>
        <div className="pf-stack">
          <Field label="Owner name"><Input value={f.name || ""} onChange={set("name")} /></Field>
          <div className="pf-grid-2 tight"><Field label="Mobile"><Input className="input tnum" inputMode="tel" value={f.phone || ""} onChange={set("phone")} /></Field>
            <Field label="Management fee" hint="Taken from rent collected"><div className="pf-unit"><input className="input tnum" inputMode="decimal" value={f.fee || ""} onChange={(e) => setF({ ...f, fee: e.target.value.replace(/[^\d.]/g, "") })} /><span>%</span></div></Field></div>
          <Field label="Payout bank" optional><Input value={f.bank || ""} onChange={set("bank")} placeholder="NIC Asia •••• 2210" /></Field>
        </div>
      </Drawer>

      <DeleteConfirm item={del} name={del?.item?.name} what={del ? { unit: "unit", prop: "property", owner: "owner" }[del.kind] : "item"} onClose={() => setDel(null)}
        onDelete={(x) => doDelete(x)} onRestore={(x) => { const key = { unit: "units", prop: "props", owner: "owners" }[x.kind]; save((y) => { restoreAt(y[key], x.item, x.at); }); }} />
    </>
  );
}
