// Point of sale and bookings in the sample workspace (the sample hotel), and the useOps() data helper.
// Where it fits: signed-in businesses use LivePOS and LiveBookings (LiveOps.jsx) instead.

import React, { useMemo, useState } from "react";
import { DataActions } from "@sheetal/shared/components/DataIO";
import { OTA_RES, isOta, otaName, otaSplit } from "@sheetal/shared/data/ota";
import { useT } from "@sheetal/shared/core/i18n";
import { useStore } from "@sheetal/shared/core/store";
import { useRouter } from "@sheetal/shared/core/router";
import { can } from "@sheetal/shared/core/rbac";
import { TODAY, fdate, fdatetime, inDays, rs } from "@sheetal/shared/core/format";
import { Badge, Button, Drawer, Empty, Field, Input, PageHead, Seg, StatusBadge, Table, Tabs, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { Counter } from "./ListingWizard";
import { IconLink } from "@sheetal/shared/layout/Links";
import { BookingForm } from "./Branches";
import { inBranch, useBranch } from "@sheetal/shared/core/branch";
import { defaultTenantSettings } from "./BusinessSettings";
import { emptyOps, opsOf } from "@sheetal/shared/demo/ops";

// Ops data lives per tenant; workspaces without their own data show the sample hotel.
export function useOps(tenant) {
  const { db, update } = useStore();
  const ops = opsOf(db, tenant.id);
  const set = (fn) => update((d) => { if (!d.ops[tenant.id]) d.ops[tenant.id] = emptyOps(); fn(d.ops[tenant.id], d); });
  return [ops, set];
}

const METHODS = [["cash", "banknote"], ["fonepay", "qr-code"], ["card", "credit-card"], ["esewa", "wallet"], ["khalti", "wallet"], ["room", "bed-double"]];
const VAT = 0.13, SVC = 0.1;
const bill = (sub, disc = 0) => { const s = sub - disc; const svc = Math.round(s * SVC); const vat = Math.round((s + svc) * VAT); return { sub, disc, svc, vat, total: s + svc + vat }; };

export function POS({ tenant, role }) {
  const t = useT();
  const tabs = [
    can(role, "pos.frontdesk.use") && { id: "front", label: t("pos.front"), icon: "concierge-bell" },
    can(role, "pos.restaurant.use") && { id: "rest", label: t("pos.restaurant"), icon: "utensils" },
    can(role, "pos.extra.create") && { id: "extras", label: t("pos.extras"), icon: "sparkles" },
    can(role, "pos.shift.close") && { id: "shift", label: t("pos.shift"), icon: "calculator" },
  ].filter(Boolean);
  const [tab, setTab] = useState(tabs[0]?.id);
  const [ops] = useOps(tenant);
  const { db } = useStore();
  const ts = db.tenantSettings[tenant.id] || defaultTenantSettings(tenant);
  if (!tabs.length) return <Empty icon="lock" title={t("noaccess.title")} />;
  return (
    <>
      <PageHead title={t("nav.pos")} sub={`${ts.profile.displayName} · ${ops.shift.open ? t("pos.shiftOpenBy", { name: ops.shift.by, at: fdatetime(ops.shift.since) }) : t("pos.shiftClosed")}`}
        actions={<Badge tone={ops.shift.open ? "done" : "action"} icon={ops.shift.open ? "lock-open" : "lock"}>{ops.shift.open ? t("pos.shiftOpen") : t("pos.shiftClosed")}</Badge>} />
      <div className="pf-pos-tabs"><Tabs value={tab} onChange={(v) => { setTab(v); window.scrollTo(0, 0); }} tabs={tabs} /></div>
      {tab === "front" && <FrontDesk tenant={tenant} role={role} />}
      {tab === "rest" && <Restaurant tenant={tenant} role={role} />}
      {tab === "extras" && <Extras tenant={tenant} />}
      {tab === "shift" && <Shift tenant={tenant} />}
    </>
  );
}

const ROOM_TONE = { vacant: "done", occupied: "progress", arriving: "action", departing: "action", dirty: "neutral", blocked: "problem" };
function FrontDesk({ tenant, role }) {
  const t = useT();
  const toast = useToast();
  const [ops, set] = useOps(tenant);
  const [f, setF] = useState("all");
  const [open, setOpen] = useState(null);
  const { branch, first } = useBranch();
  const branchRooms = ops.rooms.filter((r) => inBranch(branch, r.branch || first));
  const counts = branchRooms.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] || 0) + 1 }), {});
  const rooms = branchRooms.filter((r) => f === "all" || r.status === f);
  if (!branchRooms.length) return <Empty icon="bed-double" title={t("br.noRooms", { b: branch })}>{t("br.noRoomsText")}</Empty>;
  const room = ops.rooms.find((r) => r.no === open);
  return (
    <>
      <div className="pf-chips">
        {["all", "arriving", "departing", "occupied", "vacant", "dirty", "blocked"].map((s) => (
          <button key={s} className={`chip ${f === s ? "active" : ""}`} onClick={() => setF(s)}>{t(`room.${s}`)} <span className="tnum muted">{s === "all" ? ops.rooms.length : counts[s] || 0}</span></button>
        ))}
      </div>
      <div className="pf-rooms">
        {rooms.map((r) => (
          <button key={r.no} className={`card pf-room ${r.status}`} onClick={() => setOpen(r.no)}>
            <div className="pf-room-top"><b className="tnum">{r.no}</b><Badge tone={ROOM_TONE[r.status]}>{t(`room.${r.status}`)}</Badge></div>
            <span className="small muted">{r.type}</span>
            <span className="pf-room-guest">{r.guest || "—"}</span>
            {(r.status === "arriving" && !r.idOk) && <span className="pf-hint pf-tone-action"><Icon name="id-card" size={13} />{t("room.idMissing")}</span>}
          </button>
        ))}
      </div>
      <Drawer open={!!room} onClose={() => setOpen(null)} title={room && `${t("room.room")} ${room.no} · ${room.type}`} sub={room?.guest}
        footer={room && <FolioActions room={room} set={set} t={t} toast={toast} close={() => setOpen(null)} canDiscount={can(role, "pos.bill.discount")} />}>
        {room && <Folio room={room} set={set} ops={ops} t={t} />}
      </Drawer>
    </>
  );
}

function Folio({ room, set, ops, t }) {
  const sub = room.folio.reduce((s, x) => s + x.amount, 0);
  const b = bill(sub);
  const add = (what, amount) => set((o) => { o.rooms.find((r) => r.no === room.no).folio.push({ id: Math.random().toString(36).slice(2), what, qty: 1, amount, at: new Date().toISOString() }); });
  return (
    <div className="pf-stack">
      <dl className="pf-kv">
        <dt>{t("room.stay")}</dt><dd className="tnum">{fdate(room.from)} – {fdate(room.to)}</dd>
        <dt>{t("room.guests")}</dt><dd className="tnum">{room.pax}</dd>
        <dt>{t("room.rate")}</dt><dd className="tnum">{rs(room.rate)} / {t("room.night")}</dd>
        <dt>{t("room.id")}</dt><dd>{room.idOk ? <Badge tone="done">{t("room.idOk")}</Badge> : <Badge tone="action">{t("room.idMissing")}</Badge>}</dd>
      </dl>
      {room.guest && <>
        <div className="pf-fb-label"><b>{t("pos.addCharge")}</b></div>
        <div className="pf-chips">
          {[["Breakfast", 800, "coffee"], ["Room service", 1200, "bell-ring"], ["Minibar", 450, "wine"], ["Laundry", 650, "shirt"], ...ops.extras.slice(0, 3).map((x) => [x.name, x.price, x.icon])].map(([n, p, ic]) => (
            <button key={n} className="chip" onClick={() => add(n, p)}><Icon name={ic} size={14} />{n} <span className="tnum muted">{rs(p)}</span></button>
          ))}
        </div>
        <div className="pf-ticket">
          {room.folio.length ? room.folio.map((x) => <div key={x.id} className="pf-ticket-line"><span>{x.what}{x.qty > 1 ? ` × ${x.qty}` : ""}<small className="pf-sub-line tnum">{fdatetime(x.at)}</small></span><b className="tnum">{rs(x.amount)}</b></div>)
            : <p className="small muted">{t("pos.noCharges")}</p>}
        </div>
        <Totals b={b} paid={room.paid} t={t} />
      </>}
    </div>
  );
}

function FolioActions({ room, set, t, toast, close }) {
  const [pay, setPay] = useState(null);
  const st = room.status;
  const setStatus = (s, patch = {}) => { set((o) => { Object.assign(o.rooms.find((r) => r.no === room.no), { status: s, ...patch }); }); };
  if (pay) return <PayBox amount={pay} onCancel={() => setPay(null)} onPaid={(m) => { set((o) => { const r = o.rooms.find((x) => x.no === room.no); r.paid += pay; o.shift.sales[m] = (o.shift.sales[m] || 0) + pay; }); toast(t("pos.toastPaid", { v: rs(pay) })); setPay(null); }} t={t} noRoom />;
  const b = bill(room.folio.reduce((s, x) => s + x.amount, 0));
  const due = Math.max(0, b.total - room.paid);
  return <>
    {st === "arriving" && <Button icon="log-in" onClick={() => { setStatus("occupied"); toast(t("pos.toastIn", { no: room.no })); close(); }}>{t("pos.checkIn")}</Button>}
    {(st === "occupied" || st === "departing") && <>
      <Button variant="outline" icon="printer">{t("pos.printBill")}</Button>
      <Button variant="outline" icon="send">{t("pos.smsBill")}</Button>
      {due > 0 && <Button variant="outline" icon="wallet" onClick={() => setPay(due)}>{t("pos.collect", { v: rs(due) })}</Button>}
      <Button icon="log-out" disabled={due > 0} title={due > 0 ? t("pos.settleFirst") : undefined} onClick={() => { setStatus("dirty", { guest: null, folio: [], paid: 0 }); toast(t("pos.toastOut", { no: room.no })); close(); }}>{t("pos.checkOut")}</Button>
    </>}
    {st === "dirty" && <Button icon="sparkles" onClick={() => { setStatus("vacant"); close(); }}>{t("pos.markClean")}</Button>}
    {st === "vacant" && <Button icon="plus" onClick={() => { setStatus("occupied", { guest: "Walk-in guest", folio: [{ id: "w1", what: "Room night", qty: 1, amount: room.rate, at: new Date().toISOString() }], paid: 0, from: TODAY.slice(0, 10), to: inDays(1), idOk: false }); toast(t("pos.toastWalkin")); }}>{t("pos.walkIn")}</Button>}
  </>;
}

function Totals({ b, paid = 0, t }) {
  return (
    <div className="pf-totals">
      <div><span>{t("pos.subtotal")}</span><span className="tnum">{rs(b.sub)}</span></div>
      {b.disc > 0 && <div><span>{t("pos.discount")}</span><span className="tnum">− {rs(b.disc)}</span></div>}
      <div><span>{t("pos.service")}</span><span className="tnum">{rs(b.svc)}</span></div>
      <div><span>{t("pos.vat")}</span><span className="tnum">{rs(b.vat)}</span></div>
      <div className="total"><span>{t("pos.total")}</span><span className="tnum">{rs(b.total)}</span></div>
      {paid > 0 && <><div><span>{t("pos.paid")}</span><span className="tnum">− {rs(paid)}</span></div><div className="total"><span>{t("pos.balance")}</span><span className="tnum">{rs(Math.max(0, b.total - paid))}</span></div></>}
    </div>
  );
}

function PayBox({ amount, onCancel, onPaid, t, noRoom, rooms = [] }) {
  const [m, setM] = useState("cash");
  const [given, setGiven] = useState(amount);
  const [room, setRoom] = useState(rooms[0]?.no);
  return (
    <div className="pf-paybox">
      <div className="pf-paybox-amt"><span className="small muted">{t("pos.toPay")}</span><b className="tnum">{rs(amount)}</b></div>
      <div className="pf-tiles">{METHODS.filter(([k]) => !(noRoom && k === "room")).map(([k, ic]) => <button key={k} className={m === k ? "on" : ""} onClick={() => setM(k)}><Icon name={ic} size={18} /><span>{t(`pay.m_${k}`)}</span></button>)}</div>
      {m === "cash" && <div className="pf-chips">{[amount, Math.ceil(amount / 500) * 500, Math.ceil(amount / 1000) * 1000, Math.ceil(amount / 5000) * 5000].filter((v, i, a) => a.indexOf(v) === i).map((v) => <button key={v} className={`chip ${given === v ? "active" : ""}`} onClick={() => setGiven(v)}>{rs(v)}</button>)}
        <span className="pf-hint tnum">{t("pos.change", { v: rs(Math.max(0, given - amount)) })}</span></div>}
      {m === "fonepay" && <div className="pf-qr"><Icon name="qr-code" size={84} strokeWidth={1.2} /><span className="small muted">{t("pos.scan")}</span></div>}
      {m === "room" && <Field label={t("pos.chargeTo")}><select className="select" value={room} onChange={(e) => setRoom(e.target.value)}>{rooms.map((r) => <option key={r.no} value={r.no}>{r.no} · {r.guest}</option>)}</select></Field>}
      <div className="pf-row-actions"><Button variant="outline" onClick={onCancel}>{t("common.cancel")}</Button><Button icon="check" onClick={() => onPaid(m, room)}>{m === "room" ? t("pos.postToRoom") : t("pos.confirmPaid")}</Button></div>
    </div>
  );
}

function Restaurant({ tenant, role }) {
  const t = useT();
  const toast = useToast();
  const [ops, set] = useOps(tenant);
  const { branch } = useBranch();
  const allOutlets = [...new Set(ops.tables.map((x) => x.outlet))];
  const outlets = allOutlets.includes(branch) ? [branch] : allOutlets;
  const [outlet, setOutlet] = useState(outlets[0]);
  const [table, setTable] = useState(null);
  const [cat, setCat] = useState(ops.menu[0].cat);
  const [lines, setLines] = useState([]);
  const [disc, setDisc] = useState(0);
  const [paying, setPaying] = useState(false);
  const [q, setQ] = useState("");
  const items = ops.menu.find((c) => c.cat === cat).items.filter((i) => i.name.toLowerCase().includes(q.toLowerCase()));
  const addItem = (it) => setLines((l) => { const e = l.find((x) => x.id === it.id); return e ? l.map((x) => (x.id === it.id ? { ...x, qty: x.qty + 1 } : x)) : [...l, { ...it, qty: 1 }]; });
  const sub = lines.reduce((s, x) => s + x.price * x.qty, 0);
  const b = bill(sub, Math.round((sub * disc) / 100));
  const occupied = ops.rooms.filter((r) => r.guest);
  const done = (m, roomNo) => {
    set((o) => {
      if (m === "room") o.rooms.find((r) => r.no === roomNo).folio.push({ id: Math.random().toString(36).slice(2), what: `${outlet} bill`, qty: 1, amount: b.total, at: new Date().toISOString() });
      o.shift.sales[m] = (o.shift.sales[m] || 0) + b.total;
      if (table) o.tables.find((x) => x.id === table).state = "free";
    });
    toast(m === "room" ? t("pos.toastPosted", { no: roomNo }) : t("pos.toastPaid", { v: rs(b.total) }));
    setLines([]); setDisc(0); setPaying(false); setTable(null);
  };
  return (
    <div className="pf-pos">
      <section className="card pf-pos-menu">
        <div className="pf-toolbar">
          <Seg value={outlet} onChange={(v) => { setOutlet(v); setTable(null); }} options={outlets.map((o) => ({ id: o, label: o }))} />
          <div className="pf-search" style={{ marginLeft: "auto" }}><Icon name="search" size={15} /><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("pos.searchMenu")} aria-label={t("pos.searchMenu")} /></div>
        </div>
        <div className="pf-pos-tables">
          {ops.tables.filter((x) => x.outlet === outlet).map((x) => (
            <button key={x.id} className={`${table === x.id ? "on" : ""} ${x.state}`} onClick={() => setTable(x.id)} aria-pressed={table === x.id}><b>{x.id}</b><small>{t(`table.${x.state}`)}</small></button>
          ))}
          <button className={table === "takeaway" ? "on" : ""} onClick={() => setTable("takeaway")}><Icon name="shopping-bag" size={16} /><small>{t("pos.takeaway")}</small></button>
        </div>
        <div className="pf-pad-x"><div className="pf-chips">{ops.menu.map((c) => <button key={c.cat} className={`chip ${cat === c.cat ? "active" : ""}`} onClick={() => setCat(c.cat)}>{t(`menu.${c.cat}`)}</button>)}</div></div>
        <div className="pf-items">
          {items.map((it) => (
            <button key={it.id} onClick={() => addItem(it)}><b>{it.name}</b><span className="tnum">{rs(it.price)}</span></button>
          ))}
        </div>
      </section>
      <aside className="card pf-pos-ticket">
        <div className="pf-panel-head"><div className="pf-panel-title"><h2>{table ? (table === "takeaway" ? t("pos.takeaway") : `${t("pos.table")} ${table}`) : t("pos.pickTable")}</h2><span>{outlet}</span></div>
          {lines.length > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setLines([])}>{t("pos.clear")}</button>}</div>
        <div className="pf-ticket grow">
          {lines.length ? lines.map((l) => (
            <div key={l.id} className="pf-ticket-line">
              <span>{l.name}<small className="pf-sub-line tnum">{rs(l.price)}</small></span>
              <Counter value={l.qty} min={0} max={50} label={l.name} onChange={(n) => setLines((x) => (n ? x.map((y) => (y.id === l.id ? { ...y, qty: n } : y)) : x.filter((y) => y.id !== l.id)))} />
              <b className="tnum">{rs(l.price * l.qty)}</b>
            </div>
          )) : <Empty icon="utensils" title={t("pos.emptyTicket")}>{t("pos.emptyTicketText")}</Empty>}
        </div>
        {lines.length > 0 && <div className="pf-pad pf-stack tight">
          {can(role, "pos.bill.discount") && <div className="pf-row-actions" style={{ justifyContent: "space-between" }}><span className="small">{t("pos.discount")}</span><Seg value={String(disc)} onChange={(v) => setDisc(Number(v))} options={["0", "5", "10", "15"].map((x) => ({ id: x, label: `${x}%` }))} /></div>}
          <Totals b={b} t={t} />
          {paying ? <PayBox amount={b.total} rooms={occupied} onCancel={() => setPaying(false)} onPaid={done} t={t} /> : (
            <div className="pf-grid-2 tight">
              <Button variant="outline" icon="chef-hat" onClick={() => { set((o) => { if (table && table !== "takeaway") o.tables.find((x) => x.id === table).state = "busy"; }); toast(t("pos.toastKot")); }}>{t("pos.kot")}</Button>
              <Button icon="wallet" onClick={() => setPaying(true)} disabled={!table}>{t("pos.payBill")}</Button>
            </div>
          )}
        </div>}
      </aside>
    </div>
  );
}

function Extras({ tenant }) {
  const t = useT();
  const toast = useToast();
  const [ops, set] = useOps(tenant);
  const [cart, setCart] = useState({});
  const [paying, setPaying] = useState(false);
  const lines = ops.extras.filter((x) => cart[x.id]);
  const sub = lines.reduce((s, x) => s + x.price * cart[x.id], 0);
  const b = bill(sub);
  return (
    <div className="pf-pos">
      <section className="card pf-pos-menu"><div className="pf-items big">
        {ops.extras.map((x) => <button key={x.id} onClick={() => setCart((c) => ({ ...c, [x.id]: (c[x.id] || 0) + 1 }))}><Icon name={x.icon} size={22} /><b>{x.name}</b><span className="tnum">{rs(x.price)}</span>{cart[x.id] ? <span className="pf-count solid">{cart[x.id]}</span> : null}</button>)}
      </div></section>
      <aside className="card pf-pos-ticket">
        <div className="pf-panel-head"><div className="pf-panel-title"><h2>{t("pos.extras")}</h2></div></div>
        <div className="pf-ticket grow">{lines.length ? lines.map((x) => <div key={x.id} className="pf-ticket-line"><span>{x.name}</span><Counter value={cart[x.id]} min={0} max={50} label={x.name} onChange={(n) => setCart((c) => ({ ...c, [x.id]: n }))} /><b className="tnum">{rs(x.price * cart[x.id])}</b></div>) : <Empty icon="sparkles" title={t("pos.emptyTicket")} />}</div>
        {lines.length > 0 && <div className="pf-pad pf-stack tight"><Totals b={b} t={t} />
          {paying ? <PayBox amount={b.total} rooms={ops.rooms.filter((r) => r.guest)} t={t} onCancel={() => setPaying(false)} onPaid={(m, no) => { set((o) => { if (m === "room") o.rooms.find((r) => r.no === no).folio.push({ id: Math.random().toString(36).slice(2), what: "Extras", qty: 1, amount: b.total, at: new Date().toISOString() }); o.shift.sales[m] = (o.shift.sales[m] || 0) + b.total; }); setCart({}); setPaying(false); toast(t("pos.toastPaid", { v: rs(b.total) })); }} />
            : <Button block icon="wallet" onClick={() => setPaying(true)}>{t("pos.payBill")}</Button>}
        </div>}
      </aside>
    </div>
  );
}

function Shift({ tenant }) {
  const t = useT();
  const toast = useToast();
  const [ops, set] = useOps(tenant);
  const s = ops.shift;
  const [counted, setCounted] = useState("");
  const expected = s.float + (s.sales.cash || 0);
  const total = Object.values(s.sales).reduce((a, b) => a + b, 0);
  const diff = counted === "" ? null : Number(counted) - expected;
  return (
    <div className="pf-split">
      <section className="card pf-panel grow">
        <div className="pf-panel-head"><div className="pf-panel-title"><h2>{t("pos.salesByMethod")}</h2><span className="tnum">{t("pos.since", { at: fdatetime(s.since), by: s.by })}</span></div></div>
        <Table minWidth={420} rows={Object.entries(s.sales).map(([k, v]) => ({ id: k, k, v }))} columns={[
          { key: "k", label: t("pos.method"), render: (r) => <span className="pf-person"><Icon name={(METHODS.find((m) => m[0] === r.k) || [])[1] || "wallet"} size={16} />{t(`pay.m_${r.k}`)}</span> },
          { key: "v", label: t("billing.amount"), num: true, align: "right", render: (r) => rs(r.v) },
        ]} />
        <div className="pf-panel-foot"><b>{t("pos.total")}</b><b className="tnum">{rs(total)}</b></div>
      </section>
      <section className="card pf-panel side">
        <div className="pf-panel-head"><div className="pf-panel-title"><h2>{t("pos.cashDrawer")}</h2></div></div>
        <div className="pf-pad pf-stack">
          <dl className="pf-kv tnum"><dt>{t("pos.float")}</dt><dd>{rs(s.float)}</dd><dt>{t("pos.cashSales")}</dt><dd>{rs(s.sales.cash || 0)}</dd><dt>{t("pos.expected")}</dt><dd><b>{rs(expected)}</b></dd></dl>
          <Field label={t("pos.counted")}><Input className="input tnum" inputMode="numeric" value={counted} onChange={(e) => setCounted(e.target.value.replace(/\D/g, ""))} placeholder={String(expected)} /></Field>
          {diff !== null && <Badge tone={diff === 0 ? "done" : "action"}>{diff === 0 ? t("pos.balanced") : t(diff > 0 ? "pos.over" : "pos.short", { v: rs(Math.abs(diff)) })}</Badge>}
          {s.open
            ? <Button icon="lock" disabled={counted === ""} onClick={() => { set((o) => { o.shift.open = false; }); toast(t("pos.toastClosed")); }}>{t("pos.closeShift")}</Button>
            : <Button icon="lock-open" onClick={() => { set((o, d) => { o.shift = { open: true, by: d.session.userName, since: new Date().toISOString(), float: 5000, sales: { cash: 0, fonepay: 0, card: 0, esewa: 0, room: 0 } }; }); setCounted(""); toast(t("pos.toastOpened")); }}>{t("pos.openShift")}</Button>}
          <Button variant="outline" icon="printer">{t("pos.zReport")}</Button>
        </div>
      </section>
    </div>
  );
}

const BK_TONE = { confirmed: "done", requested: "action", checked_in: "progress", completed: "neutral", cancelled: "problem" };
export function Bookings({ tenant, role }) {
  const t = useT();
  const [ops, set] = useOps(tenant);
  const toast = useToast();
  const [tab, setTab] = useState("upcoming");
  const [form, setForm] = useState(false);
  const { navigate } = useRouter();
  const [q, setQ] = useState("");
  const groups = { upcoming: ["confirmed", "requested"], inhouse: ["checked_in"], past: ["completed"], cancelled: ["cancelled"] };
  const { branch, first } = useBranch();
  const { db } = useStore();
  const [src, setSrc] = useState("all");
  // New reservations from Booking.com, Airbnb … wait here as "requested" until the business confirms them
  const fromSites = (ops.channelRes || (tenant.id === "t1" ? OTA_RES : [])).filter((r) => r.status === "new").map((r) => ({ id: r.id, guest: r.guest, phone: r.country, room: "—", type: r.room, from: r.from, to: r.to, amount: r.amount, paid: r.pay === "hotel" ? 0 : r.amount, status: "requested", source: r.ch, ota: r }));
  const all = [...fromSites, ...ops.bookings];
  const srcOf = (b) => (isOta(b.source) ? "sites" : b.source === "shetal" ? "shetal" : "own");
  const rows = useMemo(() => all.filter((b) => inBranch(branch, b.branch || first) && groups[tab].includes(b.status) && (src === "all" || srcOf(b) === src) && `${b.id} ${b.guest} ${b.phone}`.toLowerCase().includes(q.toLowerCase())), [ops.bookings, ops.channelRes, tab, q, branch, first, src]);
  const confirmSite = (r) => { set((o) => { o.channelRes = o.channelRes || structuredClone(tenant.id === "t1" ? OTA_RES : []); const x = o.channelRes.find((y) => y.id === r.id); if (x) x.status = "confirmed"; o.bookings.unshift({ id: r.id, guest: r.guest, phone: r.country, room: o.rooms.find((y) => y.type === r.room)?.no || "—", type: r.room, from: r.from, to: r.to, amount: r.amount, paid: r.pay === "hotel" ? 0 : r.amount, status: "confirmed", source: r.ch }); }); toast(`Confirmed. ${otaName(r.ch)} has been told.`); };
  const declineSite = (r) => set((o) => { o.channelRes = o.channelRes || structuredClone(tenant.id === "t1" ? OTA_RES : []); const x = o.channelRes.find((y) => y.id === r.id); if (x) x.status = "cancelled"; });
  return (
    <>
      <PageHead title={t("nav.bookings")} sub={t("bk.sub")} actions={<><Button variant="outline" icon="calendar-days" onClick={() => navigate("/business/calendar")}>{t("nav.calendar")}</Button><Button variant="outline" icon="store" onClick={() => navigate("/business/pos")}>{t("pos.front")}</Button>{can(role, "hotel.booking.create") && <Button icon="plus" onClick={() => setForm(true)}>{t("bk.manual")}</Button>}</>} />
      <BookingForm tenant={tenant} open={form} onClose={() => setForm(false)} />
      <section className="card pf-panel">
        <div className="pf-pad-x"><Tabs value={tab} onChange={setTab} tabs={Object.keys(groups).map((g) => ({ id: g, label: t(`bk.${g}`), count: all.filter((b) => groups[g].includes(b.status)).length }))} /></div>
        <div className="pf-toolbar"><Seg label="Where the booking came from" value={src} onChange={setSrc} options={[{ id: "all", label: "All" }, { id: "shetal", label: "Sheetal" }, { id: "sites", label: "Other sites" }, { id: "own", label: "Website and walk-in" }]} /><div className="pf-search"><Icon name="search" size={15} /><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("bk.search")} aria-label={t("bk.search")} /></div><span className="pf-row-actions" style={{ marginLeft: "auto" }}><DataActions kind="bookings" size="sm" /></span></div>
        <Table rows={rows} minWidth={900} empty={<Empty icon="clipboard-list" title={t("bk.none")} />} columns={[
          { key: "id", label: t("bk.code"), render: (b) => <b className="tnum">{b.id}</b> },
          { key: "src", label: "Came from", render: (b) => <SourceTag s={b.source} /> },
          { key: "guest", label: t("bk.guest"), render: (b) => <span className="pf-two"><b>{b.guest}</b><small className="tnum">{b.phone}</small></span> },
          { key: "room", label: t("room.room"), render: (b) => <span className="pf-two"><b className="tnum">{b.room}</b><small>{b.type}</small></span> },
          { key: "dates", label: t("room.stay"), num: true, render: (b) => `${fdate(b.from)} – ${fdate(b.to)}` },
          { key: "amt", label: t("billing.amount"), num: true, align: "right", render: (b) => <span className="pf-two" style={{ alignItems: "flex-end" }}><b>{rs(b.amount)}</b><small>{isOta(b.source) ? `You get ${rs(otaSplit(db, b.source, b.amount).net)}` : b.paid >= b.amount ? t("bk.paidFull") : t("bk.paidPart", { v: rs(b.paid) })}</small></span> },
          { key: "st", label: t("common.status"), render: (b) => <Badge tone={BK_TONE[b.status]}>{t(`bk.s_${b.status}`)}</Badge> },
          { key: "go", label: "", align: "right", render: (b) => <div className="pf-row-actions pf-row-links">
            {b.status === "checked_in" && <IconLink to="/business/pos" icon="concierge-bell" label={t("bk.openFolio")} />}
            <IconLink to="/business/inbox" icon="message-circle" label={t("bk.message")} />
            <IconLink to="/business/invoices" icon="receipt" label={t("bk.invoice")} />
          </div> },
          { key: "act", label: "", align: "right", render: (b) => b.ota ? can(role, "hotel.booking.update") && <div className="pf-row-actions"><Button variant="outline" size="sm" onClick={() => declineSite(b.ota)}>{t("bk.decline")}</Button><Button size="sm" onClick={() => confirmSite(b.ota)}>{t("chm.confirm")}</Button></div> : b.status === "requested" && can(role, "hotel.booking.update") && <div className="pf-row-actions">
            <Button variant="outline" size="sm" onClick={() => set((o) => { o.bookings.find((x) => x.id === b.id).status = "cancelled"; })}>{t("bk.decline")}</Button>
            <Button size="sm" onClick={() => { set((o) => { o.bookings.find((x) => x.id === b.id).status = "confirmed"; }); toast(t("bk.toastAccepted")); }}>{t("bk.accept")}</Button></div> },
        ]} />
      </section>
    </>
  );
}

// Where a booking came from, with the site's initial so it reads at a glance
const SRC = { shetal: ["Sheetal", "S"], direct: ["Your website", "W"], walkin: ["Walk-in", "→"] };
export function SourceTag({ s }) {
  const [label, mark] = isOta(s) ? [otaName(s), otaName(s)[0]] : SRC[s] || [s, "•"];
  return <span className={`pf-src ${isOta(s) ? "site" : s}`}><i aria-hidden="true">{mark}</i>{label}</span>;
}

export { StatusBadge };
