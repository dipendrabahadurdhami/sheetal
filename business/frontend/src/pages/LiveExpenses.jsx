// Expenses, recurring expenses and profit on the business API (Business → Expenses).
// Where it fits: the /business/expenses route when signed in (the sample screen is Expenses in Sector.jsx).
// How it works: three tabs. Expenses: what was spent (add, change, delete, a receipt photo or PDF), and the drafts that
// recurring expenses made, to confirm with the amount changed if needed. Recurring: monthly templates that can be paused
// or stopped. Profit: money in (invoice payments without VAT, and payouts from Sheetal) minus confirmed expenses, by
// month and branch, with a CSV download. VAT collected and Sheetal's commission are shown for information only.
// Rules: nothing is worked out or kept in the browser; the server decides what counts. Only people with the manage
// permission see the buttons that change things.

import React, { useCallback, useEffect, useState } from "react";
import { useBranch } from "@sheetal/shared/core/branch";
import { useStore } from "@sheetal/shared/core/store";
import { fdate, rs, TODAY } from "@sheetal/shared/core/format";
import { Badge, Button, Drawer, Empty, Field, Input, PageHead, Select, Stat, Table, Tabs, Textarea, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { bizApi } from "../api";

const TODAY_DAY = TODAY.slice(0, 10);
const METHOD = { cash: "Cash", bank: "Bank transfer", fonepay: "Fonepay", esewa: "eSewa", khalti: "Khalti", card: "Card", other: "Other" };
const MAX_FILE = 8 * 1024 * 1024;

/** The last 12 months, newest first, as { id: "2026-11", label: "Nov 2026" }. */
function lastMonths() {
  const out = [];
  let y = Number(TODAY_DAY.slice(0, 4)), m = Number(TODAY_DAY.slice(5, 7));
  for (let i = 0; i < 12; i++) {
    out.push({ id: `${y}-${String(m).padStart(2, "0")}`, label: new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }) });
    if (--m < 1) { m = 12; y--; }
  }
  return out;
}
const MONTHS = lastMonths();
const monthLabel = (id) => MONTHS.find((x) => x.id === id)?.label || id;

// A cell that starts with = + - @ would run as a formula in Excel, so it gets a leading quote mark.
const cell = (v) => { let x = v == null ? "" : String(v); if (/^[=+@-]/.test(x) && Number.isNaN(Number(x))) x = `'${x}`; return /[",\r\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
function downloadCsv(name, head, rows) {
  const body = [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" }));
  a.download = `${name}-${TODAY_DAY}.csv`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const readBase64 = (file) => new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] || ""); r.onerror = () => fail(new Error("Couldn't read that file.")); r.readAsDataURL(file); });

/** One GET that loads again when the branch picked at the top changes, or after a change. */
function useLoad(path, tenantId) {
  const br = useBranch();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let gone = false;
    bizApi("GET", path).then((r) => { if (!gone) setData(r.data); }).catch((e) => { if (!gone) { setData((d) => d || false); toast(e.message); } });
    return () => { gone = true; };
  }, [path, tenantId, br?.branch, tick]);
  return [data, useCallback(() => setTick((n) => n + 1), [])];
}

export function LiveExpenses({ tenant }) {
  const [tab, setTab] = useState("expenses");
  const [list, reloadList] = useLoad("/expenses", tenant.id);
  const drafts = list?.drafts || 0;
  const canManage = !!list?.canManage;
  return (
    <>
      <PageHead title="Expenses" sub="What your business spent, and what is left of what it received." />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "expenses", label: "Expenses", icon: "receipt", count: drafts || undefined }, { id: "recurring", label: "Recurring", icon: "clock" }, { id: "profit", label: "Profit", icon: "wallet" }]} />
      {tab === "expenses" && <ExpensesTab tenant={tenant} canManage={canManage} onChanged={reloadList} />}
      {tab === "recurring" && <RecurringTab tenant={tenant} canManage={canManage} categories={list?.categories || []} />}
      {tab === "profit" && <ProfitTab tenant={tenant} />}
    </>
  );
}

// ───── The form shared by an expense, a draft to confirm, and a recurring expense ─────
function ExpenseDrawer({ form, setForm, categories, branches, recurring, onClose, onSave, onRemoveReceipt, busy }) {
  if (!form) return <Drawer open={false} onClose={onClose} title="" />;
  const set = (patch) => setForm({ ...form, ...patch });
  const title = recurring ? (form.id ? "Change recurring expense" : "New recurring expense") : form.mode === "confirm" ? "Confirm expense" : form.id ? "Change expense" : "Add expense";
  const need = form.category === "other" && form.note.trim().length < 3;
  const ok = form.category && Number(form.amount) > 0 && !need && (recurring ? Number(form.dayOfMonth) >= 1 : !!form.date) && (!branches || form.id || form.branchId);
  return (
    <Drawer open onClose={onClose} title={title} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={!ok || busy} onClick={onSave}>{form.mode === "confirm" ? "Confirm" : "Save"}</Button></>}>
      <div className="pf-stack">
        {form.mode === "confirm" && <div className="pf-note"><Icon name="clock" size={16} />Made by a recurring expense. Check the amount, then confirm: only confirmed expenses count in your profit.</div>}
        {branches && !form.id && <Field label="Branch"><Select value={form.branchId} onChange={(v) => set({ branchId: v })} options={[{ id: "", label: "Choose…" }, ...branches]} /></Field>}
        <div className="pf-grid-2 tight">
          <Field label="Category"><Select value={form.category} onChange={(v) => set({ category: v })} options={[{ id: "", label: "Choose…" }, ...categories.map((c) => ({ id: c.id, label: c.en }))]} /></Field>
          <Field label="Amount (Rs.)"><Input className="input tnum" inputMode="numeric" value={form.amount} onChange={(e) => set({ amount: e.target.value.replace(/\D/g, "") })} /></Field>
        </div>
        <div className="pf-grid-2 tight">
          {recurring
            ? <Field label="Day of the month" hint="1 to 28. A draft is made on this day."><Input className="input tnum" inputMode="numeric" value={form.dayOfMonth} onChange={(e) => set({ dayOfMonth: e.target.value.replace(/\D/g, "").slice(0, 2) })} /></Field>
            : <Field label="Date"><Input type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} /></Field>}
          <Field label="Paid by"><Select value={form.method} onChange={(v) => set({ method: v })} options={Object.entries(METHOD).map(([id, label]) => ({ id, label }))} /></Field>
        </div>
        <Field label="Vendor" optional><Input value={form.vendor} onChange={(e) => set({ vendor: e.target.value })} placeholder="Who was paid" /></Field>
        <Field label={form.category === "other" ? "What is it for?" : "Note"} optional={form.category !== "other"}><Textarea rows={2} value={form.note} onChange={(e) => set({ note: e.target.value })} /></Field>
        {!recurring && <Field label="Receipt" optional hint="A photo or PDF, up to 8 MB. Only your team can open it.">
          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => { const f = e.target.files?.[0]; if (f && f.size > MAX_FILE) { e.target.value = ""; set({ file: null, fileError: "That file is over 8 MB." }); } else set({ file: f || null, fileError: "" }); }} />
          {form.fileError && <small style={{ color: "var(--problem, #b42318)" }}>{form.fileError}</small>}
          {form.hasReceipt && !form.file && <small className="muted">A receipt is saved. Choose a file to replace it, or <button type="button" className="link" onClick={onRemoveReceipt}>remove it</button>.</small>}
        </Field>}
      </div>
    </Drawer>
  );
}

const blank = (extra = {}) => ({ category: "", amount: "", date: TODAY_DAY, dayOfMonth: "1", method: "cash", vendor: "", note: "", branchId: "", file: null, fileError: "", ...extra });
const fromRow = (r, extra = {}) => ({ id: r.id, category: r.category, amount: String(r.amount), date: r.date, dayOfMonth: String(r.dayOfMonth || 1), method: r.method, vendor: r.vendor, note: r.note, branchId: r.branchId, hasReceipt: r.hasReceipt, file: null, fileError: "", ...extra });
const body = (f) => ({ category: f.category, amount: Number(f.amount), date: f.date, method: f.method, vendor: f.vendor.trim() || null, note: f.note.trim() || null });

/** Branches to choose from when "All branches" is picked and the business has several; otherwise the server picks. */
function useBranchChoices(tenant) {
  const br = useBranch();
  const { db } = useStore();
  const open = (db.branches?.[tenant.id] || []).filter((b) => b.status === "open");
  return br?.branch === "all" && open.length > 1 ? open.map((b) => ({ id: b.id, label: b.name })) : null;
}

// ───── Expenses ─────
function ExpensesTab({ tenant, canManage, onChanged }) {
  const toast = useToast();
  const [month, setMonth] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("all");
  const qs = `/expenses?status=${status}${month ? `&month=${month}` : ""}${category ? `&category=${category}` : ""}`;
  const [data, reload] = useLoad(qs, tenant.id);
  const branches = useBranchChoices(tenant);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const done = () => { reload(); onChanged(); };
  const cats = data?.categories || [];
  const catName = (id) => cats.find((c) => c.id === id)?.en || id;
  const rows = data?.rows || [];
  const total = rows.filter((r) => r.status === "confirmed").reduce((s, r) => s + r.amount, 0);
  const waiting = rows.filter((r) => r.status === "draft");
  const manyBranches = new Set(rows.map((r) => r.branchId)).size > 1;

  const save = async () => {
    setBusy(true);
    try {
      let r;
      if (form.mode === "confirm") r = await bizApi("POST", `/expenses/${form.id}/confirm`, body(form));
      else if (form.id) r = await bizApi("PUT", `/expenses/${form.id}`, body(form));
      else r = await bizApi("POST", "/expenses", { ...body(form), branchId: form.branchId || undefined });
      if (form.file) {
        try { await bizApi("POST", `/expenses/${r.data.id}/receipt`, { data: await readBase64(form.file) }); }
        catch (e) { toast(`Saved, but the receipt wasn't: ${e.message}`); }
      }
      toast(r.message); setForm(null); done();
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  };
  const remove = (r) => {
    if (!window.confirm(r.recurringId ? `Skip ${r.no}? It won't be added again this month.` : `Delete ${r.no}? This can't be undone.`)) return;
    bizApi("DELETE", `/expenses/${r.id}`).then((x) => { toast(x.message); done(); }).catch((e) => toast(e.message));
  };
  const openReceipt = (r) => bizApi("GET", `/expenses/${r.id}/receipt`).then(({ data: f }) => {
    const bin = atob(f.data), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    window.open(URL.createObjectURL(new Blob([bytes], { type: f.type })), "_blank", "noopener");
  }).catch((e) => toast(e.message));
  const removeReceipt = () => bizApi("DELETE", `/expenses/${form.id}/receipt`).then((x) => { toast(x.message); setForm({ ...form, hasReceipt: false }); done(); }).catch((e) => toast(e.message));

  if (data === null) return <p className="muted pf-pad">Loading expenses…</p>;
  return (
    <>
      <div className="pf-stats">
        <Stat label="Confirmed in this list" value={rs(total)} note={`${rows.filter((r) => r.status === "confirmed").length} expenses`} />
        <Stat label="To confirm" value={rs(waiting.reduce((s, r) => s + r.amount, 0))} note={waiting.length ? `${waiting.length} from recurring expenses` : "Nothing waiting"} tone={waiting.length ? "action" : undefined} />
      </div>
      <section className="card pf-panel">
        <div className="pf-toolbar" style={{ flexWrap: "wrap" }}>
          <Select value={month} onChange={setMonth} style={{ width: 170 }} aria-label="Month" options={[{ id: "", label: "All months" }, ...MONTHS]} />
          <Select value={category} onChange={setCategory} style={{ width: 200 }} aria-label="Category" options={[{ id: "", label: "All categories" }, ...cats.map((c) => ({ id: c.id, label: c.en }))]} />
          <Select value={status} onChange={setStatus} style={{ width: 170 }} aria-label="Show" options={[{ id: "all", label: "All" }, { id: "confirmed", label: "Confirmed" }, { id: "draft", label: "To confirm" }]} />
          {canManage && <Button icon="plus" onClick={() => setForm(blank())}>Add expense</Button>}
        </div>
        <Table rows={rows} minWidth={860} empty={<Empty icon="receipt" title="No expenses here" />} columns={[
          { key: "d", label: "Date", num: true, render: (r) => fdate(r.date) },
          { key: "c", label: "Expense", render: (r) => <span className="pf-two"><b>{catName(r.category)}</b><small>{[r.vendor, r.note].filter(Boolean).join(" · ") || r.no}</small></span> },
          { key: "b", label: manyBranches ? "Branch" : "Paid by", render: (r) => manyBranches ? <span className="pf-two"><b>{r.branch}</b><small>{METHOD[r.method]}</small></span> : METHOD[r.method] },
          { key: "a", label: "Amount", num: true, align: "right", render: (r) => <b className="pf-strong">{rs(r.amount)}</b> },
          { key: "s", label: "Status", render: (r) => r.status === "draft" ? <Badge tone="action">To confirm</Badge> : <Badge tone="done">Confirmed</Badge> },
          { key: "x", label: "", align: "right", render: (r) => <div className="pf-row-actions" style={{ justifyContent: "flex-end" }}>
            {r.hasReceipt && <Button size="sm" variant="ghost" icon="image" onClick={() => openReceipt(r)}>Receipt</Button>}
            {canManage && r.status === "draft" && <Button size="sm" icon="check" onClick={() => setForm(fromRow(r, { mode: "confirm" }))}>Confirm</Button>}
            {canManage && r.status === "confirmed" && <Button size="sm" variant="ghost" onClick={() => setForm(fromRow(r))}>Change</Button>}
            {canManage && <Button size="sm" variant="ghost" onClick={() => remove(r)}>{r.recurringId ? "Skip" : "Delete"}</Button>}
          </div> },
        ]} />
      </section>
      <ExpenseDrawer form={form} setForm={setForm} categories={cats} branches={branches} busy={busy} onClose={() => setForm(null)} onSave={save} onRemoveReceipt={removeReceipt} />
    </>
  );
}

// ───── Recurring ─────
function RecurringTab({ tenant, canManage, categories }) {
  const toast = useToast();
  const [rows, reload] = useLoad("/expenses/recurring", tenant.id);
  const branches = useBranchChoices(tenant);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const catName = (id) => categories.find((c) => c.id === id)?.en || id;
  const save = () => {
    setBusy(true);
    const b = { category: form.category, amount: Number(form.amount), dayOfMonth: Number(form.dayOfMonth), method: form.method, vendor: form.vendor.trim() || null, note: form.note.trim() || null };
    (form.id ? bizApi("PUT", `/expenses/recurring/${form.id}`, b) : bizApi("POST", "/expenses/recurring", { ...b, branchId: form.branchId || undefined }))
      .then((r) => { toast(r.message); setForm(null); reload(); }).catch((e) => toast(e.message)).finally(() => setBusy(false));
  };
  const act = (r, what, ask) => { if (ask && !window.confirm(ask)) return; bizApi("POST", `/expenses/recurring/${r.id}/${what}`).then((x) => { toast(x.message); reload(); }).catch((e) => toast(e.message)); };
  if (rows === null) return <p className="muted pf-pad">Loading…</p>;
  const tone = { active: ["done", "Active"], paused: ["neutral", "Paused"], stopped: ["problem", "Stopped"] };
  return (
    <section className="card pf-panel">
      <div className="pf-toolbar">
        <p className="small muted" style={{ margin: 0, flex: 1 }}>A draft is added on the chosen day of each month. You confirm it, and can change the amount first.</p>
        {canManage && <Button icon="plus" onClick={() => setForm(blank())}>New recurring expense</Button>}
      </div>
      <Table rows={rows || []} minWidth={760} empty={<Empty icon="clock" title="No recurring expenses" />} columns={[
        { key: "c", label: "Expense", render: (r) => <span className="pf-two"><b>{catName(r.category)}</b><small>{[r.vendor, r.note].filter(Boolean).join(" · ") || r.branch}</small></span> },
        { key: "d", label: "Day", num: true, render: (r) => `Day ${r.dayOfMonth} · from ${monthLabel(r.startMonth)}` },
        { key: "a", label: "Amount", num: true, align: "right", render: (r) => <b className="pf-strong">{rs(r.amount)}</b> },
        { key: "s", label: "Status", render: (r) => <Badge tone={tone[r.status][0]}>{tone[r.status][1]}</Badge> },
        { key: "x", label: "", align: "right", render: (r) => canManage && r.status !== "stopped" && <div className="pf-row-actions" style={{ justifyContent: "flex-end" }}>
          <Button size="sm" variant="ghost" onClick={() => setForm(fromRow(r))}>Change</Button>
          {r.status === "active" ? <Button size="sm" variant="ghost" onClick={() => act(r, "pause")}>Pause</Button> : <Button size="sm" variant="ghost" onClick={() => act(r, "resume")}>Resume</Button>}
          <Button size="sm" variant="ghost" onClick={() => act(r, "stop", "Stop this recurring expense for good? Its past expenses stay in your records.")}>Stop</Button>
        </div> },
      ]} />
      <ExpenseDrawer form={form} setForm={setForm} categories={categories} branches={branches} recurring busy={busy} onClose={() => setForm(null)} onSave={save} />
    </section>
  );
}

// ───── Profit ─────
function ProfitTab({ tenant }) {
  const [from, setFrom] = useState(MONTHS[5].id);
  const [to, setTo] = useState(MONTHS[0].id);
  const [data] = useLoad(`/expenses/profit?from=${from}&to=${to}`, tenant.id);
  const opts = [...MONTHS].reverse();
  const rows = data?.rows || [];
  const t = data?.totals;
  const manyBranches = new Set(rows.map((r) => r.branchId)).size > 1;
  const csv = () => downloadCsv("sheetal-profit", ["Month", "Branch", "Received directly, without VAT (Rs.)", "Payouts from Sheetal (Rs.)", "Expenses (Rs.)", "Profit (Rs.)", "VAT collected, info (Rs.)", "Sheetal commission, info (Rs.)"], rows.map((r) => [r.month, r.branch, r.direct, r.payouts, r.expenses, r.profit, r.vat, r.commission]));
  return (
    <>
      <div className="pf-toolbar" style={{ flexWrap: "wrap" }}>
        <Select value={from} onChange={(v) => { setFrom(v); if (v > to) setTo(v); }} style={{ width: 170 }} aria-label="From" options={opts} />
        <Select value={to} onChange={(v) => { setTo(v); if (v < from) setFrom(v); }} style={{ width: 170 }} aria-label="To" options={opts} />
        <Button variant="outline" icon="download" disabled={!rows.length} onClick={csv}>Download CSV</Button>
      </div>
      {data === null ? <p className="muted pf-pad">Loading profit…</p> : <>
        <div className="pf-stats">
          <Stat label="Money in" value={rs((t?.direct || 0) + (t?.payouts || 0))} note={`${rs(t?.direct || 0)} received by you · ${rs(t?.payouts || 0)} paid out by Sheetal`} />
          <Stat label="Expenses" value={rs(t?.expenses || 0)} note="Confirmed only" />
          <Stat label="Profit" value={rs(t?.profit || 0)} note="Money in minus expenses" />
        </div>
        <div className="pf-note"><Icon name="circle-alert" size={16} />
          VAT collected ({rs(t?.vat || 0)}) is owed to the government, so it is not counted as money in. Sheetal's commission ({rs(t?.commission || 0)}) is already taken off your payouts, so it is not an expense. Both are for information.
        </div>
        <section className="card pf-panel">
          <Table rows={rows} minWidth={860} empty={<Empty icon="wallet" title="Nothing in these months" />} columns={[
            { key: "m", label: "Month", render: (r) => <span className="pf-two"><b>{monthLabel(r.month)}</b>{manyBranches && <small>{r.branch}</small>}</span> },
            { key: "d", label: "Received by you", num: true, align: "right", render: (r) => rs(r.direct) },
            { key: "p", label: "Payouts from Sheetal", num: true, align: "right", render: (r) => rs(r.payouts) },
            { key: "e", label: "Expenses", num: true, align: "right", render: (r) => `− ${rs(r.expenses)}` },
            { key: "r", label: "Profit", num: true, align: "right", render: (r) => <b className="pf-strong">{rs(r.profit)}</b> },
            { key: "v", label: "VAT (info)", num: true, align: "right", render: (r) => <span className="muted">{rs(r.vat)}</span> },
            { key: "c", label: "Commission (info)", num: true, align: "right", render: (r) => <span className="muted">{rs(r.commission)}</span> },
          ]} />
        </section>
      </>}
    </>
  );
}
