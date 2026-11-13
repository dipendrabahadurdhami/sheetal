// Stock (kitchen, bar, minibar, housekeeping, store) on the business API (Business → Stock).
// Where it fits: moved from business/frontend/src/pages/LiveStock.jsx (P2-W4); shown at /business/stock by BusinessApp.jsx through the shim left there. On the kit (@sheetal/ui, @sheetal/sdk). An item change sends its version; a stale page (409) reloads.
// How it works: three tabs. Items: what the branch keeps, with + and − to adjust by one, stock in (with supplier and
// cost), stock out and waste, a count, add and change, archive, a low-stock filter, stock value at cost, and CSV
// import and export (same columns as the sample). Moves: every change with who made it, filtered by kind and date.
// Recipes: what one sale of a menu item uses, so the point of sale takes stock out by itself and a voided bill puts it back.
// Rules: nothing is worked out or kept in the browser; the server decides what stock is left and never lets it go below
// 0 by hand. Only people who can change stock see the buttons that change things.

import React, { useEffect, useState } from "react";
import { useBranch } from "@sheetal/shared/core/branch";
import { DataActions } from "@sheetal/shared/components/DataIO";
import { rs } from "@sheetal/shared/core/format";
import { Badge, Button, Drawer, Empty, Field, Input, PageHead, Select, Stat, Table, Tabs, Textarea, useToast } from "@sheetal/ui/primitives";
import { Icon } from "@sheetal/shared/core/icons";
import { bizApi } from "@sheetal/sdk/client";
import { useApiGet } from "@sheetal/sdk/hooks";

const PLACES = ["kitchen", "bar", "minibar", "housekeeping", "store"];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const KIND = { in: "Stock in", out: "Stock out", sale: "Sale", waste: "Waste", count: "Count" };
const digits = (v) => v.replace(/\D/g, "");

/** One GET on the kit (useApiGet): loads again when the business, the branch picked at the top or reload() change. [data, reload]; data is null while the
 *  first answer is on its way and false if it failed (the error is shown as a toast, as before). */
function useLoad(path, tenantId, enabled = true) {
  const toast = useToast();
  const { data, error, refresh } = useApiGet(enabled ? path : null, { tenantId });
  useEffect(() => { if (error) toast(error.message); }, [error, toast]);
  return [data ?? (error ? false : null), refresh];
}

export function StockPage({ tenant }) {
  const [tab, setTab] = useState("items");
  const [head, reloadHead] = useLoad("/stock", tenant.id);
  const low = head?.summary?.low || 0;
  return (
    <>
      <PageHead title="Stock" sub="Kitchen, bar, minibar and housekeeping. POS sales take stock out automatically." actions={low > 0 ? <Badge tone="action" icon="circle-alert">{low} running low</Badge> : null} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "items", label: "Items", icon: "package", count: head?.summary?.items }, { id: "moves", label: "Moves", icon: "history" }, { id: "recipes", label: "Recipes", icon: "chef-hat" }]} />
      {tab === "items" && <ItemsTab tenant={tenant} head={head} onChanged={reloadHead} />}
      {tab === "moves" && <MovesTab tenant={tenant} />}
      {tab === "recipes" && <RecipesTab tenant={tenant} />}
    </>
  );
}

// ───── Items ─────
function ItemsTab({ tenant, head, onChanged }) {
  const toast = useToast();
  const br = useBranch();
  const [place, setPlace] = useState("");
  const [onlyLow, setOnlyLow] = useState(() => { try { return new URLSearchParams(window.location.search).get("low") === "1"; } catch { return false; } });
  const [archived, setArchived] = useState(false);
  const [q, setQ] = useState("");
  const qs = `/stock?${[place && `place=${place}`, onlyLow && "low=1", archived && "archived=1", q.trim() && `q=${encodeURIComponent(q.trim())}`].filter(Boolean).join("&")}`;
  const [data, reload] = useLoad(qs, tenant.id);
  const [ed, setEd] = useState(null);
  const [mv, setMv] = useState(null);
  const [busy, setBusy] = useState(false);
  const canManage = !!head?.canManage;
  const items = data?.items || [];
  const branches = head?.branches || [];
  const chooseBranch = br?.branch === "all" && branches.length > 1;
  const many = new Set(items.map((i) => i.branchId)).size > 1;
  const sum = head?.summary;
  const done = () => { reload(); onChanged(); };

  const run = async (call, after) => {
    setBusy(true);
    // A stale page (409: someone changed the item first) closes the form and reloads the latest.
    try { const r = await call(); toast(r.message); after?.(); done(); } catch (e) { toast(e.message); if (e.status === 409) { setEd(null); done(); } } finally { setBusy(false); }
  };
  const nudge = (x, n) => run(() => (n > 0 ? bizApi("POST", `/stock/${x.id}/in`, { qty: 1 }) : bizApi("POST", `/stock/${x.id}/out`, { qty: 1, kind: "out" })));
  const save = () => run(() => {
    const body = { name: ed.name.trim(), place: ed.place, unit: ed.unit.trim(), min: Number(ed.min) || 0, cost: Number(ed.cost) || 0 };
    return ed.id ? bizApi("PATCH", `/stock/${ed.id}`, { ...body, version: ed.version }) : bizApi("POST", "/stock", { ...body, qty: Number(ed.qty) || 0, branchId: ed.branchId || undefined });
  }, () => setEd(null));
  const archive = (x, active) => run(() => bizApi("PATCH", `/stock/${x.id}`, { active, version: x.version }), () => setEd(null));
  const move = () => run(() => {
    const n = Number(mv.qty) || 0;
    if (mv.mode === "in") return bizApi("POST", `/stock/${mv.item.id}/in`, { qty: n, cost: mv.cost ? Number(mv.cost) : undefined, supplier: mv.supplier.trim() || undefined, note: mv.note.trim() || undefined });
    if (mv.mode === "count") return bizApi("POST", `/stock/${mv.item.id}/count`, { counted: n, note: mv.note.trim() || undefined });
    return bizApi("POST", `/stock/${mv.item.id}/out`, { qty: n, kind: mv.mode, note: mv.note.trim() || undefined });
  }, () => setMv(null));
  const importRows = (rows) => bizApi("POST", "/stock/import", { rows }).then((r) => { toast(r.message); done(); }).catch((e) => toast(e.message));

  const blank = () => ({ name: "", place: place || "kitchen", unit: "piece", qty: "", min: "", cost: "", branchId: "" });
  const openMove = (mode, item) => setMv({ mode, item, qty: mode === "count" ? String(item.qty) : "", cost: "", supplier: "", note: "" });
  const mvOk = mv && (mv.mode === "count" ? mv.qty !== "" : Number(mv.qty) > 0) && (mv.mode !== "waste" || mv.note.trim().length >= 3);
  const exportRows = items.map((i) => ({ name: i.name, place: cap(i.place), unit: i.unit, qty: i.qty, min: i.min, cost: i.cost }));

  return (
    <>
      <div className="pf-stats">
        <Stat label="Items" value={sum?.items ?? "—"} note={sum ? `${sum.places} ${sum.places === 1 ? "place" : "places"}` : ""} />
        <Stat label="Running low" value={sum?.low ?? "—"} note={sum?.lowNames?.join(", ") || "—"} tone={sum?.low ? "action" : undefined} noteIcon={sum?.low ? "circle-alert" : undefined} />
        <Stat label="Stock value" value={sum ? rs(sum.value) : "—"} note="At cost" />
      </div>
      <section className="card pf-panel">
        <div className="pf-toolbar">
          <div className="pf-chips">
            <button type="button" className={`chip ${place === "" ? "active" : ""}`} onClick={() => setPlace("")}>All places</button>
            {PLACES.map((p) => <button key={p} type="button" className={`chip ${place === p ? "active" : ""}`} onClick={() => setPlace(p)}>{cap(p)}</button>)}
            <button type="button" className={`chip ${onlyLow ? "active" : ""}`} onClick={() => setOnlyLow(!onlyLow)}>Low only</button>
            <button type="button" className={`chip ${archived ? "active" : ""}`} onClick={() => setArchived(!archived)}>Archived{sum?.archived ? ` (${sum.archived})` : ""}</button>
          </div>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search items" aria-label="Search items" />
          <DataActions kind="stock" rows={exportRows} onImport={canManage ? importRows : undefined} onlyExport={!canManage} />
          {canManage && <Button icon="plus" onClick={() => setEd(blank())}>Add item</Button>}
        </div>
        {data === null ? <p className="muted small">Loading…</p> : <Table rows={items} minWidth={860} onRowClick={canManage ? (x) => setEd({ ...x, qty: "", cur: x.qty, min: String(x.min), cost: String(x.cost) }) : undefined}
          empty={<Empty icon="package" title={archived ? "No archived items" : onlyLow ? "Nothing is running low" : "No stock items yet"} action={canManage && !archived && !onlyLow ? <Button icon="plus" onClick={() => setEd(blank())}>Add item</Button> : undefined}>{archived || onlyLow ? "Try another filter." : "Add what you keep in the kitchen, bar and store, or import a list."}</Empty>}
          columns={[
            { key: "n", label: "Item", render: (x) => <span className="pf-two"><b>{x.name}</b><small>{cap(x.place)}{many ? ` · ${x.branch}` : ""}</small></span> },
            { key: "q", label: "In stock", render: (x) => (canManage && x.active
              ? <div className="pf-counter" onClick={(e) => e.stopPropagation()}><button disabled={busy || x.qty < 1} onClick={() => nudge(x, -1)} aria-label="Take one out"><Icon name="minus" size={15} /></button><b className="tnum">{x.qty}</b><button disabled={busy} onClick={() => nudge(x, 1)} aria-label="Add one"><Icon name="plus" size={15} /></button></div>
              : <b className="tnum">{x.qty}</b>) },
            { key: "u", label: "Unit", render: (x) => x.unit },
            { key: "m", label: "Reorder at", num: true, align: "right", render: (x) => x.min },
            { key: "c", label: "Cost", num: true, align: "right", render: (x) => rs(x.cost) },
            { key: "v", label: "Value", num: true, align: "right", render: (x) => rs(x.value) },
            { key: "s", label: "Status", render: (x) => (!x.active ? <Badge>Archived</Badge> : x.low ? <Badge tone="action">Low</Badge> : <Badge tone="done">OK</Badge>) },
            { key: "a", label: "", render: (x) => (canManage && x.active ? <span className="pf-row-actions" onClick={(e) => e.stopPropagation()}><Button size="sm" variant="outline" onClick={() => openMove("in", x)}>In</Button><Button size="sm" variant="outline" onClick={() => openMove("count", x)}>Count</Button><Button size="sm" variant="ghost" onClick={() => openMove("waste", x)}>Waste</Button></span> : null) },
          ]} />}
      </section>

      <Drawer open={!!ed} onClose={() => setEd(null)} title={ed?.id ? ed.name || "Change item" : "Add item"}
        footer={ed && <>{ed.id && <Button variant="ghost" className="pf-foot-left" disabled={busy} onClick={() => archive(ed, !ed.active)}>{ed.active ? "Archive" : "Restore"}</Button>}<Button variant="outline" onClick={() => setEd(null)}>Cancel</Button><Button disabled={busy || !ed.name.trim() || !ed.unit.trim() || (!ed.id && chooseBranch && !ed.branchId)} onClick={save}>Save</Button></>}>
        {ed && <div className="pf-stack">
          {!ed.id && chooseBranch && <Field label="Branch"><Select value={ed.branchId} onChange={(v) => setEd({ ...ed, branchId: v })} options={[{ id: "", label: "Choose…" }, ...branches.map((b) => ({ id: b.id, label: b.name }))]} /></Field>}
          <Field label="Item"><Input value={ed.name} onChange={(e) => setEd({ ...ed, name: e.target.value })} placeholder="Mineral water 1 L" /></Field>
          <Field label="Kept in"><div className="pf-chips">{PLACES.map((p) => <button key={p} type="button" className={`chip ${ed.place === p ? "active" : ""}`} onClick={() => setEd({ ...ed, place: p })}>{cap(p)}</button>)}</div></Field>
          <div className="pf-grid-2 tight">
            <Field label="Unit"><Input value={ed.unit} onChange={(e) => setEd({ ...ed, unit: e.target.value })} placeholder="bottle, kg, piece" /></Field>
            {ed.id
              ? <Field label="In stock" hint="Use Stock in, Count or Waste to change it."><Input className="input tnum" value={String(ed.cur ?? "")} disabled readOnly /></Field>
              : <Field label="In stock now"><Input className="input tnum" inputMode="numeric" value={ed.qty} onChange={(e) => setEd({ ...ed, qty: digits(e.target.value) })} /></Field>}
          </div>
          <div className="pf-grid-2 tight">
            <Field label="Reorder at" hint="Marked low below this. 0 = no alert."><Input className="input tnum" inputMode="numeric" value={ed.min} onChange={(e) => setEd({ ...ed, min: digits(e.target.value) })} /></Field>
            <Field label="Cost per unit"><div className="pf-unit"><span>Rs.</span><input className="input tnum" inputMode="numeric" value={ed.cost} onChange={(e) => setEd({ ...ed, cost: digits(e.target.value) })} /></div></Field>
          </div>
        </div>}
      </Drawer>

      <Drawer open={!!mv} onClose={() => setMv(null)} title={mv ? `${mv.mode === "count" ? "Count" : KIND[mv.mode]}: ${mv.item.name}` : ""}
        footer={mv && <><Button variant="outline" onClick={() => setMv(null)}>Cancel</Button><Button disabled={busy || !mvOk} onClick={move}>Save</Button></>}>
        {mv && <div className="pf-stack">
          <div className="pf-note"><Icon name="package" size={16} />Now {mv.item.qty} {mv.item.unit} in stock.</div>
          <Field label={mv.mode === "count" ? `Counted (${mv.item.unit})` : `How many (${mv.item.unit})`} hint={mv.mode === "count" ? "What is on the shelf. The difference is saved." : undefined}><Input className="input tnum" inputMode="numeric" value={mv.qty} onChange={(e) => setMv({ ...mv, qty: digits(e.target.value) })} autoFocus /></Field>
          {mv.mode === "in" && <>
            <div className="pf-grid-2 tight">
              <Field label="Cost per unit" optional><div className="pf-unit"><span>Rs.</span><input className="input tnum" inputMode="numeric" value={mv.cost} onChange={(e) => setMv({ ...mv, cost: digits(e.target.value) })} /></div></Field>
              <Field label="Supplier" optional><Input value={mv.supplier} onChange={(e) => setMv({ ...mv, supplier: e.target.value })} /></Field>
            </div>
          </>}
          {mv.mode !== "count" && mv.mode !== "in" && <Field label="Type"><Select value={mv.mode} onChange={(v) => setMv({ ...mv, mode: v })} options={[{ id: "out", label: "Used or given out" }, { id: "waste", label: "Waste or broken" }]} /></Field>}
          <Field label={mv.mode === "waste" ? "What happened?" : "Note"} optional={mv.mode !== "waste"}><Textarea rows={2} value={mv.note} onChange={(e) => setMv({ ...mv, note: e.target.value })} /></Field>
        </div>}
      </Drawer>
    </>
  );
}

// ───── Moves ─────
function MovesTab({ tenant }) {
  const [kind, setKind] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [limit, setLimit] = useState(100);
  const qs = `/stock/moves?limit=${limit}${kind ? `&kind=${kind}` : ""}${from ? `&from=${from}` : ""}${to ? `&to=${to}` : ""}`;
  const [data] = useLoad(qs, tenant.id);
  const rows = data?.rows || [];
  const many = new Set(rows.map((r) => r.branch)).size > 1;
  return (
    <section className="card pf-panel">
      <div className="pf-toolbar">
        <Select value={kind} onChange={(v) => { setKind(v); setLimit(100); }} options={[{ id: "", label: "All changes" }, ...Object.entries(KIND).map(([id, label]) => ({ id, label }))]} />
        <Field label="From" optional><Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setLimit(100); }} /></Field>
        <Field label="To" optional><Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setLimit(100); }} /></Field>
      </div>
      {data === null ? <p className="muted small">Loading…</p> : <Table rows={rows} minWidth={820} empty={<Empty icon="history" title="No moves yet">Stock in, out, waste, counts and sales show here.</Empty>} columns={[
        { key: "t", label: "When", render: (m) => new Date(m.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) },
        { key: "i", label: "Item", render: (m) => <span className="pf-two"><b>{m.item}</b><small>{cap(m.place)}{many ? ` · ${m.branch}` : ""}</small></span> },
        { key: "k", label: "Type", render: (m) => <Badge tone={m.kind === "in" ? "done" : m.kind === "waste" ? "action" : undefined}>{KIND[m.kind]}</Badge> },
        { key: "q", label: "Change", num: true, align: "right", render: (m) => <b className="tnum">{m.qty > 0 ? "+" : ""}{m.qty} {m.unit}</b> },
        { key: "a", label: "Left", num: true, align: "right", render: (m) => m.after },
        { key: "n", label: "Note", render: (m) => m.note || "" },
        { key: "b", label: "By", render: (m) => m.by || "" },
      ]} />}
      {data?.next && limit < 300 && <div className="pf-more"><Button variant="outline" onClick={() => setLimit((n) => n + 100)}>Show more</Button></div>}
    </section>
  );
}

// ───── Recipes ─────
function RecipesTab({ tenant }) {
  const toast = useToast();
  const [data, reload] = useLoad("/stock/recipes", tenant.id);
  const [stock] = useLoad("/stock", tenant.id);
  const [ed, setEd] = useState(null);
  const [busy, setBusy] = useState(false);
  const canManage = !!data?.canManage;
  const menu = data?.menu || [];
  const choices = (stock?.items || []).map((i) => ({ id: i.id, label: `${i.name} (${i.unit}, ${cap(i.place)})` }));
  const unitOf = (id) => stock?.items?.find((i) => i.id === id)?.unit || "";
  const save = async () => {
    setBusy(true);
    try {
      const lines = ed.lines.filter((l) => l.itemId && Number(l.qty) > 0).map((l) => ({ itemId: l.itemId, qty: Number(l.qty) }));
      const r = await bizApi("PUT", `/stock/recipes/${ed.id}`, { lines });
      toast(r.message); setEd(null); reload();
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  };
  const setLine = (i, patch) => setEd({ ...ed, lines: ed.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  return (
    <section className="card pf-panel">
      <p className="muted small">What one sale of a menu item takes out of stock. Menu items with no recipe don't touch stock.</p>
      {data === null ? <p className="muted small">Loading…</p> : <Table rows={menu} minWidth={640} onRowClick={canManage ? (m) => setEd({ id: m.id, name: m.name, lines: m.lines.map((l) => ({ itemId: l.itemId, qty: String(l.qty) })) }) : undefined}
        empty={<Empty icon="chef-hat" title="No menu items">Add items to the menu in Point of sale first.</Empty>} columns={[
          { key: "n", label: "Menu item", render: (m) => <span className="pf-two"><b>{m.name}</b><small>{m.outlet}</small></span> },
          { key: "u", label: "Uses per sale", render: (m) => (m.lines.length ? m.lines.map((l) => `${l.qty} ${l.unit} ${l.name}`).join(", ") : <span className="muted">Nothing</span>) },
        ]} />}
      <Drawer open={!!ed} onClose={() => setEd(null)} title={ed ? `Recipe: ${ed.name}` : ""}
        footer={ed && <><Button variant="outline" onClick={() => setEd(null)}>Cancel</Button><Button disabled={busy} onClick={save}>Save</Button></>}>
        {ed && <div className="pf-stack">
          {!choices.length && <div className="pf-note"><Icon name="package" size={16} />Add stock items first.</div>}
          {ed.lines.map((l, i) => (
            <div key={i} className="pf-grid-2 tight">
              <Field label={i === 0 ? "Stock item" : undefined}><Select value={l.itemId} onChange={(v) => setLine(i, { itemId: v })} options={[{ id: "", label: "Choose…" }, ...choices]} /></Field>
              <Field label={i === 0 ? `Uses (${unitOf(l.itemId) || "units"})` : undefined}><div className="pf-row"><Input className="input tnum" inputMode="numeric" value={l.qty} onChange={(e) => setLine(i, { qty: digits(e.target.value) })} /><Button variant="ghost" size="sm" icon="trash-2" aria-label="Remove" onClick={() => setEd({ ...ed, lines: ed.lines.filter((_, j) => j !== i) })} /></div></Field>
            </div>
          ))}
          <Button variant="outline" icon="plus" disabled={!choices.length} onClick={() => setEd({ ...ed, lines: [...ed.lines, { itemId: "", qty: "1" }] })}>Add a stock item</Button>
        </div>}
      </Drawer>
    </section>
  );
}
