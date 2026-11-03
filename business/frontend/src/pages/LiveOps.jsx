import React, { useCallback, useEffect, useMemo, useState } from "react";
import { fdate, fdatetime, rs } from "@sheetal/shared/core/format";
import { can } from "@sheetal/shared/core/rbac";
import { Badge, Button, Drawer, Empty, Field, Input, PageHead, Panel, Select, Stat, Table, Tabs, Textarea, ToggleRow, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { bizApi } from "../api";
import { useBranch } from "@sheetal/shared/core/branch";

// Hotels, POS, developer projects and sponsor investments on the business API (shown instead of the sample
// screens when signed in). The API keeps the rules: no double bookings, ID before check-in, settle before
// check-out, menu prices, shifts, holds and reservations.

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const ROOM_TONE = { vacant: "done", arriving: "action", occupied: "progress", dirty: "problem", blocked: "neutral" };
const BK_TONE = { requested: "action", confirmed: "done", checked_in: "progress", completed: "neutral", cancelled: "problem" };
const BK_WORD = { requested: "Requested", confirmed: "Confirmed", checked_in: "In house", completed: "Checked out", cancelled: "Cancelled" };
const PAY = [["cash", "Cash"], ["fonepay", "Fonepay"], ["card", "Card"], ["esewa", "eSewa"], ["khalti", "Khalti"], ["bank", "Bank"]];

function useApi(path, deps = []) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { let gone = false; bizApi("GET", path).then((r) => !gone && setData(r.data)).catch((e) => { if (!gone) { setData(null); toast(e.message); } }); return () => { gone = true; }; }, [path, tick, ...deps]);
  return [data, useCallback(() => setTick((n) => n + 1), [])];
}
const run = (toast, p, after) => p.then((r) => { if (r?.message) toast(r.message); after?.(r); return r; }).catch((e) => { toast(e.message); throw e; });

// ───── Front desk and bookings ─────
export function LiveFrontDesk({ tenant, role }) {
  const toast = useToast();
  const [rooms, reloadRooms] = useApi("/rooms", [tenant.id]);
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState(null);
  const types = useMemo(() => [...new Set((rooms || []).map((r) => r.type))], [rooms]);
  if (!rooms) return <p className="muted pf-pad">Loading rooms…</p>;
  const count = (s) => rooms.filter((r) => r.status === s).length;
  return (
    <>
      <div className="pf-stats">
        <Stat label="Vacant" value={count("vacant")} /><Stat label="Arriving today" value={count("arriving")} /><Stat label="In house" value={count("occupied")} /><Stat label="To clean" value={count("dirty")} tone={count("dirty") ? "action" : undefined} />
      </div>
      <Panel title="Rooms" sub="Tap a room to check in, add to the bill, take payment or check out." actions={can(role, "settings.business") && <Button icon="plus" onClick={() => setAdding({ type: types[0] || "Deluxe", rate: 5000, nos: "", maxGuests: 2 })}>Add rooms</Button>}>
        {!rooms.length ? <Empty icon="bed-double" title="No rooms yet">Add your rooms with their type and nightly rate.</Empty> : (
          <div className="pf-room-grid pf-pad">{rooms.map((r) => (
            <button key={r.id} type="button" className={`card pf-room ${r.status}`} onClick={() => (r.bookingId ? setOpen(r.bookingId) : r.status === "dirty" ? run(toast, bizApi("PATCH", `/rooms/${r.id}`, { status: "vacant" }), reloadRooms) : null)}>
              <b className="tnum">{r.no}</b><Badge tone={ROOM_TONE[r.status]}>{r.status === "dirty" ? "Clean it" : r.status}</Badge>
              <span className="small muted">{r.type} · {rs(r.rate)}</span><span className="pf-room-guest">{r.guest || "—"}</span>
              {r.bill && r.bill.due > 0 && <span className="small pf-tone-action tnum">Due {rs(r.bill.due)}</span>}
            </button>))}</div>)}
      </Panel>
      <StayDrawer id={open} rooms={rooms} role={role} onClose={() => setOpen(null)} onChange={reloadRooms} />
      <Drawer open={!!adding} onClose={() => setAdding(null)} title="Add rooms" footer={adding && <><Button variant="ghost" onClick={() => setAdding(null)}>Cancel</Button><Button disabled={!adding.nos.trim()} onClick={() => run(toast, bizApi("POST", "/rooms", { type: adding.type, rate: Number(adding.rate), maxGuests: Number(adding.maxGuests), nos: adding.nos.split(/[\s,]+/).filter(Boolean) }), () => { setAdding(null); reloadRooms(); }).catch(() => {})}>Add</Button></>}>
        {adding && <div className="pf-stack">
          <Field label="Room type"><Input value={adding.type} onChange={(e) => setAdding({ ...adding, type: e.target.value })} /></Field>
          <div className="pf-grid-2 tight"><Field label="Rate a night (Rs.)"><Input className="input tnum" value={adding.rate} onChange={(e) => setAdding({ ...adding, rate: e.target.value.replace(/\D/g, "") })} /></Field>
            <Field label="Guests per room"><Input className="input tnum" value={adding.maxGuests} onChange={(e) => setAdding({ ...adding, maxGuests: e.target.value.replace(/\D/g, "") })} /></Field></div>
          <Field label="Room numbers" hint="Separate with commas or spaces, e.g. 101 102 103."><Input value={adding.nos} onChange={(e) => setAdding({ ...adding, nos: e.target.value })} /></Field>
        </div>}
      </Drawer>
    </>
  );
}

/** One stay: details, the room bill, and the front desk actions. */
function StayDrawer({ id, rooms, role, onClose, onChange }) {
  const toast = useToast();
  const [b, setB] = useState(null);
  const [extra, setExtra] = useState({ what: "", amount: "" });
  const [pay, setPay] = useState({ method: "cash", amount: "" });
  const [roomId, setRoomId] = useState("");
  const [idOk, setIdOk] = useState(false);
  useEffect(() => { setB(null); setIdOk(false); if (id) bizApi("GET", `/bookings/${id}`).then((r) => { setB(r.data); setRoomId(r.data.roomId || ""); setPay((p) => ({ ...p, amount: String(Math.max(0, r.data.bill.due)) })); }).catch((e) => toast(e.message)); }, [id]);
  const act = (p) => run(toast, p, (r) => { if (r.data) { setB(r.data); setPay((x) => ({ ...x, amount: String(Math.max(0, r.data.bill.due)) })); } onChange(); }).catch(() => {});
  const free = rooms.filter((r) => b && r.type === b.type && (r.status === "vacant" || r.id === b.roomId));
  return (
    <Drawer open={!!id} onClose={onClose} title={b ? `${b.code} · ${b.guest}` : "Loading…"} sub={b ? `${b.type}${b.room ? ` · room ${b.room}` : ""} · ${fdate(b.from)} – ${fdate(b.to)} (${b.nights} nights)` : ""}>
      {b && <div className="pf-stack">
        <dl className="pf-kv"><dt>Status</dt><dd><Badge tone={BK_TONE[b.status]}>{BK_WORD[b.status]}</Badge></dd><dt>Phone</dt><dd className="tnum">{b.phone || "—"}</dd><dt>Guests</dt><dd>{b.adults} adults{b.children ? `, ${b.children} children` : ""}</dd><dt>Came from</dt><dd>{b.source}</dd></dl>
        {(b.status === "confirmed" || b.status === "requested") && <Panel title="Check in" pad><div className="pf-stack">
          <Field label="Room"><Select value={roomId} onChange={setRoomId} options={[{ id: "", label: "Choose…" }, ...free.map((r) => ({ id: r.id, label: `${r.no} (${r.status})` }))]} /></Field>
          <ToggleRow title="I have seen the guest's ID" sub="Citizenship, passport or driving licence. Required by law." checked={idOk} onChange={setIdOk} />
          <Button icon="log-in" disabled={!roomId || !idOk} onClick={() => act(bizApi("POST", `/bookings/${b.id}/check-in`, { roomId, idChecked: true }))}>Check in</Button>
          {can(role, "bookings.cancel") && <Button variant="outline" className="pf-danger" onClick={() => window.confirm("Cancel this booking?") && act(bizApi("PATCH", `/bookings/${b.id}`, { status: "cancelled" }))}>Cancel booking</Button>}
        </div></Panel>}
        <Panel title="Room bill">
          <ul className="pf-list">{b.folio.map((l) => <li key={l.id}><span style={{ flex: 1 }}>{l.what}<small className="muted tnum"> · {fdatetime(l.at)}</small></span><b className="tnum">{rs(l.amount)}</b></li>)}
            {!b.folio.length && <li className="muted">Nothing yet. Room nights are added at check-in.</li>}</ul>
          <dl className="pf-kv pf-pad"><dt>Service 10%</dt><dd className="tnum">{rs(b.bill.service)}</dd><dt>VAT 13%</dt><dd className="tnum">{rs(b.bill.vat)}</dd><dt>Total</dt><dd className="tnum"><b>{rs(b.bill.total)}</b></dd><dt>Paid</dt><dd className="tnum">{rs(b.bill.paid)}</dd><dt>To pay</dt><dd className="tnum"><b>{rs(b.bill.due)}</b></dd></dl>
        </Panel>
        {b.status === "checked_in" && <>
          <div className="pf-row-actions"><Input placeholder="Extra, e.g. Laundry" value={extra.what} onChange={(e) => setExtra({ ...extra, what: e.target.value })} /><Input className="input tnum" placeholder="Rs." style={{ width: 110 }} value={extra.amount} onChange={(e) => setExtra({ ...extra, amount: e.target.value.replace(/\D/g, "") })} />
            <Button variant="outline" disabled={!extra.what || !extra.amount} onClick={() => act(bizApi("POST", `/bookings/${b.id}/folio`, { kind: "extra", what: extra.what, amount: Number(extra.amount) })).then(() => setExtra({ what: "", amount: "" }))}>Add</Button>
            {can(role, "pos.discount") && <Button variant="ghost" disabled={!extra.what || !extra.amount} onClick={() => act(bizApi("POST", `/bookings/${b.id}/folio`, { kind: "discount", what: extra.what, amount: Number(extra.amount) })).then(() => setExtra({ what: "", amount: "" }))}>As discount</Button>}</div>
          <div className="pf-row-actions"><Select value={pay.method} onChange={(v) => setPay({ ...pay, method: v })} options={PAY.map(([id, label]) => ({ id, label }))} style={{ width: 130 }} />
            <Input className="input tnum" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value.replace(/\D/g, "") })} style={{ width: 130 }} />
            <Button disabled={!Number(pay.amount)} onClick={() => act(bizApi("POST", `/bookings/${b.id}/payments`, { method: pay.method, amount: Number(pay.amount) }))}>Take payment</Button></div>
          <Button icon="log-out" disabled={b.bill.due > 0} title={b.bill.due > 0 ? "Settle the bill first" : undefined} onClick={() => act(bizApi("POST", `/bookings/${b.id}/check-out`)).then(onClose)}>Check out</Button>
        </>}
      </div>}
    </Drawer>
  );
}

export function LiveBookings({ tenant, role }) {
  const toast = useToast();
  const [rows, reload] = useApi("/bookings", [tenant.id]);
  const [rooms] = useApi("/rooms", [tenant.id]);
  const [tab, setTab] = useState("upcoming");
  const [open, setOpen] = useState(null);
  const [form, setForm] = useState(null);
  const [avail, setAvail] = useState(null);
  const groups = { upcoming: ["requested", "confirmed"], inhouse: ["checked_in"], past: ["completed"], cancelled: ["cancelled"] };
  const types = [...new Set((rooms || []).map((r) => r.type))];
  useEffect(() => { if (form?.from && form?.to && form.to > form.from) bizApi("GET", `/availability?from=${form.from}&to=${form.to}`).then((r) => setAvail(r.data)).catch(() => setAvail(null)); }, [form?.from, form?.to]);
  const list = (rows || []).filter((b) => groups[tab].includes(b.status));
  return (
    <>
      <PageHead title="Bookings" sub="Every stay, from the website, other sites, phone and walk-ins." actions={can(role, "bookings.create") && <Button icon="plus" onClick={() => setForm({ type: types[0] || "", guest: "", phone: "", from: today(), to: plusDays(1), adults: 2, source: "direct" })}>New booking</Button>} />
      <section className="card pf-panel">
        <div className="pf-pad-x"><Tabs value={tab} onChange={setTab} tabs={Object.keys(groups).map((g) => ({ id: g, label: { upcoming: "Upcoming", inhouse: "In house", past: "Past", cancelled: "Cancelled" }[g], count: (rows || []).filter((b) => groups[g].includes(b.status)).length }))} /></div>
        {!rows ? <p className="muted pf-pad">Loading…</p> : <Table rows={list} onRowClick={(b) => setOpen(b.id)} minWidth={820} empty={<Empty icon="clipboard-list" title="No bookings here" />} columns={[
          { key: "c", label: "Booking", render: (b) => <span className="pf-two"><b className="tnum">{b.code}</b><small>{b.source}</small></span> },
          { key: "g", label: "Guest", render: (b) => <span className="pf-two"><b>{b.guest}</b><small className="tnum">{b.phone}</small></span> },
          { key: "r", label: "Room", render: (b) => <span className="pf-two"><b className="tnum">{b.room || "—"}</b><small>{b.type}</small></span> },
          { key: "d", label: "Stay", num: true, render: (b) => `${fdate(b.from)} – ${fdate(b.to)}` },
          { key: "a", label: "Amount", num: true, align: "right", render: (b) => rs(b.bill.total || b.amount) },
          { key: "s", label: "Status", render: (b) => <Badge tone={BK_TONE[b.status]}>{BK_WORD[b.status]}</Badge> },
          { key: "x", label: "", align: "right", render: (b) => b.status === "requested" && can(role, "bookings.edit") && <Button size="sm" onClick={(e) => { e.stopPropagation(); run(toast, bizApi("PATCH", `/bookings/${b.id}`, { status: "confirmed" }), reload).catch(() => {}); }}>Confirm</Button> },
        ]} />}
      </section>
      <StayDrawer id={open} rooms={rooms || []} role={role} onClose={() => { setOpen(null); reload(); }} onChange={reload} />
      <Drawer open={!!form} onClose={() => setForm(null)} title="New booking" footer={form && <><Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button><Button disabled={!form.type || form.guest.trim().length < 2} onClick={() => run(toast, bizApi("POST", "/bookings", { ...form, adults: Number(form.adults) || 1, email: form.email || undefined, phone: form.phone || undefined }), () => { setForm(null); reload(); }).catch(() => {})}>Book</Button></>}>
        {form && <div className="pf-stack">
          <div className="pf-grid-2 tight"><Field label="Check-in"><Input type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} /></Field><Field label="Check-out"><Input type="date" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} /></Field></div>
          <Field label="Room type"><Select value={form.type} onChange={(v) => setForm({ ...form, type: v })} options={types.map((x) => { const a = avail?.find((y) => y.type === x); return { id: x, label: a ? `${x} · ${a.free} free · ${rs(a.rate)}` : x }; })} /></Field>
          <Field label="Guest name"><Input value={form.guest} onChange={(e) => setForm({ ...form, guest: e.target.value })} /></Field>
          <div className="pf-grid-2 tight"><Field label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field><Field label="Adults"><Input className="input tnum" value={form.adults} onChange={(e) => setForm({ ...form, adults: e.target.value.replace(/\D/g, "") })} /></Field></div>
          <Field label="Came from"><Select value={form.source} onChange={(v) => setForm({ ...form, source: v })} options={[["direct", "Phone or our website"], ["walkin", "Walk-in"], ["shetal", "Sheetal"], ["booking", "Booking.com"], ["airbnb", "Airbnb"], ["agoda", "Agoda"]].map(([id, label]) => ({ id, label }))} /></Field>
          <Field label="Notes"><Textarea rows={2} value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        </div>}
      </Drawer>
    </>
  );
}

// ───── POS ─────
export function LivePOS({ tenant, role }) {
  const toast = useToast();
  const [menu, reloadMenu] = useApi("/menu", [tenant.id]);
  const [shift, reloadShift] = useApi("/shifts/current", [tenant.id]);
  const [rooms] = useApi("/rooms", [tenant.id]);
  const [outlet, setOutlet] = useState("");
  const [cart, setCart] = useState([]);
  const [method, setMethod] = useState("cash");
  const [bookingId, setBookingId] = useState("");
  const [discount, setDiscount] = useState("");
  const [newItem, setNewItem] = useState(null);
  const outlets = [...new Set((menu || []).filter((m) => m.active).map((m) => m.outlet))];
  const here = outlet || outlets[0] || "Restaurant";
  const items = (menu || []).filter((m) => m.active && m.outlet === here);
  const sub = cart.reduce((s, l) => s + l.qty * l.price, 0);
  const base = Math.max(0, sub - (Number(discount) || 0));
  const svc = Math.round(base * 0.1), vat = Math.round((base + svc) * 0.13);
  const add = (m) => setCart((c) => { const i = c.findIndex((x) => x.itemId === m.id); if (i >= 0) { const n = [...c]; n[i] = { ...n[i], qty: n[i].qty + 1 }; return n; } return [...c, { itemId: m.id, name: m.name, qty: 1, price: m.price }]; });
  const inHouse = (rooms || []).filter((r) => r.status === "occupied" && r.bookingId);
  return (
    <>
      <PageHead title="Point of sale" sub={shift ? `Shift open since ${fdatetime(shift.openedAt)} · cash expected ${rs(shift.expectedCash)}` : "No shift open. Open one to take cash."}
        actions={<>{shift ? can(role, "shift.close") && <Button variant="outline" onClick={() => { const c = window.prompt(`Cash counted in the drawer? Expected ${shift.expectedCash}.`); if (c !== null) run(toast, bizApi("POST", "/shifts/close", { counted: Number(c.replace(/\D/g, "")) || 0 }), reloadShift).catch(() => {}); }}>Close shift</Button>
          : <Button onClick={() => { const f = window.prompt("Opening cash float (Rs.)", "0"); if (f !== null) run(toast, bizApi("POST", "/shifts/open", { float: Number(f.replace(/\D/g, "")) || 0 }), reloadShift).catch(() => {}); }}>Open shift</Button>}
          {can(role, "settings.business") && <Button variant="outline" icon="plus" onClick={() => setNewItem({ name: "", price: "", category: "Food", outlet: here })}>Menu item</Button>}</>} />
      <div className="pf-split">
        <Panel title={here} className="grow" actions={outlets.length > 1 && <Select value={here} onChange={setOutlet} options={outlets.map((o) => ({ id: o, label: o }))} style={{ width: 180 }} />}>
          {!menu ? <p className="muted pf-pad">Loading…</p> : !items.length ? <Empty icon="utensils" title="No menu items yet">Add items with “Menu item”.</Empty>
            : <div className="pf-menu-grid pf-pad">{items.map((m) => <button key={m.id} type="button" className="card pf-menu-item" onClick={() => add(m)}><b>{m.name}</b><span className="small muted">{m.category}</span><span className="tnum">{rs(m.price)}</span></button>)}</div>}
        </Panel>
        <Panel title="Bill" className="side" pad>
          <div className="pf-stack">
            {!cart.length ? <p className="muted">Tap items to add them.</p> : <ul className="pf-list">{cart.map((l, i) => <li key={i}><span style={{ flex: 1 }}>{l.name} × {l.qty}</span><b className="tnum">{rs(l.qty * l.price)}</b><button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Remove ${l.name}`} onClick={() => setCart((c) => c.filter((_, j) => j !== i))}><Icon name="x" size={14} /></button></li>)}</ul>}
            {can(role, "pos.discount") && <Field label="Discount (Rs.)"><Input className="input tnum" value={discount} onChange={(e) => setDiscount(e.target.value.replace(/\D/g, ""))} /></Field>}
            <dl className="pf-kv"><dt>Subtotal</dt><dd className="tnum">{rs(sub)}</dd><dt>Service 10%</dt><dd className="tnum">{rs(svc)}</dd><dt>VAT 13%</dt><dd className="tnum">{rs(vat)}</dd><dt>Total</dt><dd className="tnum"><b>{rs(base + svc + vat)}</b></dd></dl>
            <Field label="Paid by"><Select value={method} onChange={setMethod} options={[...PAY.filter(([id]) => id !== "bank"), ...(inHouse.length ? [["room", "Put on a room"]] : [])].map(([id, label]) => ({ id, label }))} /></Field>
            {method === "room" && <Field label="Room"><Select value={bookingId} onChange={setBookingId} options={[{ id: "", label: "Choose…" }, ...inHouse.map((r) => ({ id: r.bookingId, label: `${r.no} · ${r.guest}` }))]} /></Field>}
            <Button disabled={!cart.length || (method === "room" && !bookingId)} onClick={() => run(toast, bizApi("POST", "/pos/bills", { outlet: here, method, bookingId: method === "room" ? bookingId : undefined, discount: Number(discount) || 0, lines: cart }), () => { setCart([]); setDiscount(""); reloadShift(); }).catch(() => {})}>Charge {rs(base + svc + vat)}</Button>
          </div>
        </Panel>
      </div>
      <Drawer open={!!newItem} onClose={() => setNewItem(null)} title="Add a menu item" footer={newItem && <><Button variant="ghost" onClick={() => setNewItem(null)}>Cancel</Button><Button disabled={!newItem.name || !newItem.price} onClick={() => run(toast, bizApi("POST", "/menu", { items: [{ ...newItem, price: Number(newItem.price) }] }), () => { setNewItem(null); reloadMenu(); }).catch(() => {})}>Add</Button></>}>
        {newItem && <div className="pf-stack"><Field label="Name"><Input value={newItem.name} onChange={(e) => setNewItem({ ...newItem, name: e.target.value })} /></Field>
          <div className="pf-grid-2 tight"><Field label="Price (Rs.)"><Input className="input tnum" value={newItem.price} onChange={(e) => setNewItem({ ...newItem, price: e.target.value.replace(/\D/g, "") })} /></Field><Field label="Category"><Input value={newItem.category} onChange={(e) => setNewItem({ ...newItem, category: e.target.value })} /></Field></div>
          <Field label="Outlet"><Input value={newItem.outlet} onChange={(e) => setNewItem({ ...newItem, outlet: e.target.value })} /></Field></div>}
      </Drawer>
    </>
  );
}

// ───── Developer projects ─────
const UNIT_TONE = { available: "done", held: "action", reserved: "progress", sold: "neutral", blocked: "problem" };
export function LiveProjects({ tenant, role }) {
  const toast = useToast();
  const [projects, reload] = useApi("/projects", [tenant.id]);
  const [reservations, reloadRes] = useApi("/reservations", [tenant.id]);
  const [tab, setTab] = useState("units");
  const [adding, setAdding] = useState(null);
  const [reserve, setReserve] = useState(null);
  const [res, setRes] = useState(null);
  const [pay, setPay] = useState({ amount: "", method: "bank", ref: "" });
  const both = () => { reload(); reloadRes(); };
  if (!projects) return <p className="muted pf-pad">Loading projects…</p>;
  return (
    <>
      <PageHead title="Projects" sub="Units, holds, reservations and what each buyer has paid." />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "units", label: "Units", icon: "layout-grid" }, { id: "reservations", label: "Reservations and collections", icon: "wallet", count: reservations?.filter((r) => r.status === "reserved").length }]} />
      {tab === "units" && (!projects.length ? <Empty icon="building-2" title="No project listings yet">Post a project from Listings first; its units are managed here.</Empty> : projects.map((p) => (
        <Panel key={p.id} title={p.title} sub={`${p.code} · ${p.summary.available} free · ${p.summary.held} held · ${p.summary.reserved} reserved · ${p.summary.sold} sold`} actions={can(role, "projects.manage") && <Button size="sm" icon="plus" onClick={() => setAdding({ projectId: p.id, block: "A", type: "2BHK", price: "", nos: "" })}>Add units</Button>}>
          {!p.units.length ? <p className="muted pf-pad">No units yet.</p> : <div className="pf-room-grid pf-pad">{p.units.map((u) => (
            <button key={u.id} type="button" className={`card pf-room ${u.status}`} onClick={() => (u.status === "available" || u.status === "held") && can(role, "reservations.manage") && setReserve({ unit: u, buyer: "", phone: "", plan: "" })}>
              <b className="tnum">{u.block}{u.no}</b><Badge tone={UNIT_TONE[u.status]}>{u.status}</Badge><span className="small muted">{u.type}{u.sizeSqft ? ` · ${u.sizeSqft} sq ft` : ""}</span><span className="tnum small">{rs(u.price)}</span>
              {u.status === "available" && <span className="small pf-tone-action" onClick={(e) => { e.stopPropagation(); run(toast, bizApi("POST", `/units/${u.id}/hold`, { days: 3 }), reload).catch(() => {}); }}>Hold 3 days</span>}
            </button>))}</div>}
        </Panel>)))}
      {tab === "reservations" && <section className="card pf-panel">
        <Table rows={reservations || []} onRowClick={(r) => setRes(r)} minWidth={760} empty={<Empty icon="wallet" title="No reservations yet" />} columns={[
          { key: "c", label: "Reservation", render: (r) => <span className="pf-two"><b className="tnum">{r.code} · {r.unit.block}{r.unit.no}</b><small>{r.buyer}{r.phone ? ` · ${r.phone}` : ""}</small></span> },
          { key: "p", label: "Price", num: true, align: "right", render: (r) => rs(r.price) },
          { key: "d", label: "Paid", num: true, align: "right", render: (r) => rs(r.paid) },
          { key: "o", label: "Next due", render: (r) => { const n = r.plan.find((s) => !s.done); return n ? <span className={n.overdue ? "pf-tone-action" : ""}>{n.label} · {fdate(n.due)} · {rs(n.amount - n.paid)}</span> : "—"; } },
          { key: "s", label: "Status", render: (r) => <Badge tone={{ reserved: "progress", sold: "done", cancelled: "neutral" }[r.status]}>{r.status}</Badge> },
        ]} />
      </section>}
      <Drawer open={!!adding} onClose={() => setAdding(null)} title="Add units" footer={adding && <><Button variant="ghost" onClick={() => setAdding(null)}>Cancel</Button><Button disabled={!adding.nos || !adding.price} onClick={() => run(toast, bizApi("POST", `/projects/${adding.projectId}/units`, { block: adding.block, type: adding.type, sizeSqft: Number(adding.size) || undefined, price: Number(adding.price), nos: adding.nos.split(/[\s,]+/).filter(Boolean) }), () => { setAdding(null); reload(); }).catch(() => {})}>Add</Button></>}>
        {adding && <div className="pf-stack"><div className="pf-grid-2 tight"><Field label="Block"><Input value={adding.block} onChange={(e) => setAdding({ ...adding, block: e.target.value })} /></Field><Field label="Type"><Input value={adding.type} onChange={(e) => setAdding({ ...adding, type: e.target.value })} /></Field></div>
          <div className="pf-grid-2 tight"><Field label="Price (Rs.)"><Input className="input tnum" value={adding.price} onChange={(e) => setAdding({ ...adding, price: e.target.value.replace(/\D/g, "") })} /></Field><Field label="Size (sq ft)"><Input className="input tnum" value={adding.size || ""} onChange={(e) => setAdding({ ...adding, size: e.target.value.replace(/\D/g, "") })} /></Field></div>
          <Field label="Unit numbers" hint="e.g. 101 102 201 202"><Input value={adding.nos} onChange={(e) => setAdding({ ...adding, nos: e.target.value })} /></Field></div>}
      </Drawer>
      <Drawer open={!!reserve} onClose={() => setReserve(null)} title={reserve ? `Reserve ${reserve.unit.block}${reserve.unit.no}` : ""} sub={reserve ? rs(reserve.unit.price) : ""} footer={reserve && <><Button variant="ghost" onClick={() => setReserve(null)}>Cancel</Button><Button disabled={reserve.buyer.trim().length < 2} onClick={() => {
        const plan = reserve.plan.trim() ? reserve.plan.trim().split("\n").map((line) => { const [label, due, amount] = line.split(",").map((x) => x.trim()); return { label, due, amount: Number(String(amount).replace(/\D/g, "")) }; }) : [];
        run(toast, bizApi("POST", `/units/${reserve.unit.id}/reserve`, { buyer: reserve.buyer, phone: reserve.phone || undefined, plan }), () => { setReserve(null); both(); }).catch(() => {});
      }}>Reserve</Button></>}>
        {reserve && <div className="pf-stack"><Field label="Buyer"><Input value={reserve.buyer} onChange={(e) => setReserve({ ...reserve, buyer: e.target.value })} /></Field><Field label="Phone"><Input value={reserve.phone} onChange={(e) => setReserve({ ...reserve, phone: e.target.value })} /></Field>
          <Field label="Payment plan (optional)" hint="One instalment per line: label, date, amount — e.g. Booking, 2026-12-01, 2000000. They must add up to the price."><Textarea rows={4} value={reserve.plan} onChange={(e) => setReserve({ ...reserve, plan: e.target.value })} /></Field></div>}
      </Drawer>
      <Drawer open={!!res} onClose={() => setRes(null)} title={res ? `${res.code} · ${res.buyer}` : ""} sub={res ? `${res.unit.block}${res.unit.no} · ${rs(res.price)} · paid ${rs(res.paid)}` : ""}>
        {res && <div className="pf-stack">
          {res.plan.length > 0 && <ul className="pf-list">{res.plan.map((s, i) => <li key={i}><span style={{ flex: 1 }}>{s.label} · {fdate(s.due)}</span><span className="tnum">{rs(s.paid)} / {rs(s.amount)}</span><Badge tone={s.done ? "done" : s.overdue ? "problem" : "neutral"}>{s.done ? "Paid" : s.overdue ? "Overdue" : "Due"}</Badge></li>)}</ul>}
          <ul className="pf-list">{res.collections.map((c) => <li key={c.id}><span style={{ flex: 1 }}>{c.method}{c.ref ? ` · ${c.ref}` : ""}<small className="muted"> · {fdatetime(c.at)}</small></span><b className="tnum">{rs(c.amount)}</b></li>)}</ul>
          {res.status === "reserved" && can(role, "collect.payments") && <div className="pf-row-actions">
            <Select value={pay.method} onChange={(v) => setPay({ ...pay, method: v })} options={["bank", "cash", "cheque", "fonepay", "esewa", "khalti"].map((x) => ({ id: x, label: x }))} style={{ width: 120 }} />
            <Input className="input tnum" placeholder="Rs." value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value.replace(/\D/g, "") })} style={{ width: 140 }} />
            <Input placeholder="Reference" value={pay.ref} onChange={(e) => setPay({ ...pay, ref: e.target.value })} style={{ width: 140 }} />
            <Button disabled={!Number(pay.amount)} onClick={() => run(toast, bizApi("POST", `/reservations/${res.id}/collections`, { amount: Number(pay.amount), method: pay.method, ref: pay.ref || undefined }), (r) => { setRes(r.data); setPay({ amount: "", method: "bank", ref: "" }); both(); }).catch(() => {})}>Record payment</Button></div>}
          {res.status === "reserved" && can(role, "reservations.manage") && <Button variant="outline" className="pf-danger" onClick={() => { const note = window.prompt("Why is it cancelled?"); if (note?.trim()) run(toast, bizApi("POST", `/reservations/${res.id}/cancel`, { note }), () => { setRes(null); both(); }).catch(() => {}); }}>Cancel reservation</Button>}
        </div>}
      </Drawer>
    </>
  );
}

// ───── Investments ─────
export function LiveInvestors({ tenant, role }) {
  const toast = useToast();
  const [list, reload] = useApi("/investments", [tenant.id]);
  const [add, setAdd] = useState(null);
  const [post, setPost] = useState(null);
  if (!list) return <p className="muted pf-pad">Loading…</p>;
  return (
    <>
      <PageHead title="Investors" sub="Pledges, payments and updates for each investment." />
      {!list.length ? <Empty icon="hand-coins" title="No investment listings yet">Post an investment from Listings first.</Empty> : list.map((inv) => (
        <Panel key={inv.id} title={inv.title} sub={`${inv.code} · raised ${rs(inv.paid)} paid, ${rs(inv.pledged)} pledged${inv.target ? ` of ${rs(inv.target)}` : ""}`}
          actions={<>{can(role, "updates.post") && <Button size="sm" variant="outline" icon="send" onClick={() => setPost({ id: inv.id, title: "", body: "" })}>Post update</Button>}{can(role, "investments.manage") && <Button size="sm" icon="plus" onClick={() => setAdd({ id: inv.id, name: "", email: "", phone: "", amount: "" })}>Add investor</Button>}</>}>
          <Table rows={inv.investors} minWidth={600} empty={<Empty icon="users" title="No investors yet" />} columns={[
            { key: "n", label: "Investor", render: (c) => <span className="pf-two"><b>{c.name}</b><small>{[c.email, c.phone].filter(Boolean).join(" · ")}</small></span> },
            { key: "a", label: "Amount", num: true, align: "right", render: (c) => rs(c.amount) },
            { key: "s", label: "Status", render: (c) => <Badge tone={{ pledged: "action", paid: "done", refunded: "neutral" }[c.status]}>{c.status}</Badge> },
            { key: "x", label: "", align: "right", render: (c) => can(role, "investments.manage") && c.status === "pledged" && <Button size="sm" onClick={() => { const ref = window.prompt("Payment reference (optional)") ?? undefined; run(toast, bizApi("PATCH", `/commitments/${c.id}`, { status: "paid", ref: ref || undefined }), reload).catch(() => {}); }}>Mark paid</Button> },
          ]} />
          {inv.updates.length > 0 && <ul className="pf-list">{inv.updates.slice(0, 3).map((u) => <li key={u.id}><span className="pf-two"><b>{u.title}</b><small className="muted">{fdatetime(u.at)}</small></span></li>)}</ul>}
        </Panel>))}
      <Drawer open={!!add} onClose={() => setAdd(null)} title="Add investor" footer={add && <><Button variant="ghost" onClick={() => setAdd(null)}>Cancel</Button><Button disabled={!add.name || !add.amount} onClick={() => run(toast, bizApi("POST", `/investments/${add.id}/commitments`, { name: add.name, email: add.email || undefined, phone: add.phone || undefined, amount: Number(add.amount) }), () => { setAdd(null); reload(); }).catch(() => {})}>Add</Button></>}>
        {add && <div className="pf-stack"><Field label="Name"><Input value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} /></Field><Field label="Email"><Input value={add.email} onChange={(e) => setAdd({ ...add, email: e.target.value })} /></Field>
          <Field label="Phone"><Input value={add.phone} onChange={(e) => setAdd({ ...add, phone: e.target.value })} /></Field><Field label="Amount pledged (Rs.)"><Input className="input tnum" value={add.amount} onChange={(e) => setAdd({ ...add, amount: e.target.value.replace(/\D/g, "") })} /></Field></div>}
      </Drawer>
      <Drawer open={!!post} onClose={() => setPost(null)} title="Update for investors" sub="Emailed to every investor with an email address." footer={post && <><Button variant="ghost" onClick={() => setPost(null)}>Cancel</Button><Button disabled={post.title.length < 3 || post.body.length < 10} onClick={() => run(toast, bizApi("POST", `/investments/${post.id}/updates`, { title: post.title, body: post.body }), () => { setPost(null); reload(); }).catch(() => {})}>Send</Button></>}>
        {post && <div className="pf-stack"><Field label="Title"><Input value={post.title} onChange={(e) => setPost({ ...post, title: e.target.value })} /></Field><Field label="Update"><Textarea rows={8} value={post.body} onChange={(e) => setPost({ ...post, body: e.target.value })} /></Field></div>}
      </Drawer>
    </>
  );
}

// ───── Calendar: night prices, closed dates and rules (per room type, at the branch picked at the top) ─────
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function LiveCalendar(props) {
  // Prices and closed dates belong to one branch: with several branches, pick one at the top first.
  const br = useBranch();
  if (br.branch === "all" && br.allowed.length > 1) {
    return <><PageHead title="Calendar and prices" sub="Night prices, closed dates and stay rules for each branch." /><Empty icon="map-pin" title="Pick a branch" sub="Choose a branch at the top of the page to see and change its calendar." /></>;
  }
  return <BranchCalendar {...props} />;
}

function BranchCalendar({ tenant, role }) {
  const toast = useToast();
  const now = new Date();
  const [ym, setYm] = useState([now.getFullYear(), now.getMonth()]);
  const [type, setType] = useState(null);
  const [sel, setSel] = useState([]);
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const month = `${ym[0]}-${String(ym[1] + 1).padStart(2, "0")}`;
  const [cal, reload] = useApi(`/calendar?month=${month}${type ? `&type=${encodeURIComponent(type)}` : ""}`, [tenant.id]);
  const [rule, setRule] = useState(null);
  useEffect(() => { if (cal?.rule) setRule(cal.rule); }, [cal?.type, cal?.rule?.weekendPct, cal?.rule?.minNights]);
  const edit = can(role, "calendar.edit");
  const act = (p) => { setBusy(true); run(toast, p, () => { setSel([]); setPrice(""); reload(); }).catch(() => {}).finally(() => setBusy(false)); };
  const setDays = (body) => act(bizApi("PUT", "/calendar/days", { type: cal.type, days: sel, ...body }));
  const go = (d) => { const m = ym[1] + d; setYm([ym[0] + Math.floor(m / 12), ((m % 12) + 12) % 12]); setSel([]); };
  if (!cal) return <p className="muted pf-pad">Loading the calendar…</p>;
  const first = new Date(`${month}-01T00:00:00Z`).getUTCDay();
  const past = (d) => d < today();
  return (
    <>
      <PageHead title="Calendar and prices" sub="Set prices for any night, close dates, and the weekend and minimum-stay rules. Bookings, availability and Booking.com / Airbnb calendars follow them." />
      {!cal.type ? <Empty icon="calendar-days" title="No rooms at this branch yet" sub="Add rooms on the front desk first, then set their prices here." /> : <>
        <div className="pf-toolbar card" style={{ borderRadius: "var(--r)" }}>
          <Select value={cal.type} onChange={(v) => { setType(v); setSel([]); }} options={cal.types.map((x) => ({ id: x.type, label: `${x.type} · ${x.rooms} room${x.rooms > 1 ? "s" : ""}` }))} style={{ width: 240, height: 38 }} aria-label="Room type" />
          <span className="small muted">Normal price {rs(cal.base)} a night{rule?.weekendPct ? ` · weekends +${rule.weekendPct}%` : ""}{rule?.minNights > 1 ? ` · at least ${rule.minNights} nights` : ""}</span>
          <div className="pf-row-actions" style={{ marginLeft: "auto" }}>
            <button className="btn btn-ghost btn-icon" aria-label="Previous month" onClick={() => go(-1)}><Icon name="chevron-left" size={18} /></button>
            <b className="tnum" style={{ minWidth: 130, textAlign: "center" }}>{MONTHS[ym[1]]} {ym[0]}</b>
            <button className="btn btn-ghost btn-icon" aria-label="Next month" onClick={() => go(1)}><Icon name="chevron-right" size={18} /></button>
          </div>
        </div>
        <div className="pf-split">
          <section className="card pf-panel grow"><div className="pf-pad">
            <div className="pf-cal-head">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <span key={d}>{d}</span>)}</div>
            <div className="pf-cal">
              {Array.from({ length: first }, (_, i) => <span key={`e${i}`} />)}
              {cal.days.map((n) => {
                const on = sel.includes(n.day);
                return (
                  <button key={n.day} type="button" disabled={!edit || past(n.day)} aria-pressed={on}
                    className={`pf-cal-day ${n.closed ? "blocked" : ""} ${on ? "on" : ""} ${n.left === 0 ? "full" : ""} ${n.override != null ? "set" : ""}`}
                    aria-label={`${n.day}: ${n.closed ? "closed" : `${rs(n.price)}, ${n.left} left`}`}
                    onClick={() => setSel(on ? sel.filter((x) => x !== n.day) : [...sel, n.day])}>
                    <b className="tnum">{Number(n.day.slice(8))}</b>
                    {n.closed ? <small>Closed</small> : <><span className="tnum">{(n.price / 1000).toFixed(1)}k</span><small className="tnum">{n.left ? `${n.left} left` : "Full"}</small></>}
                  </button>
                );
              })}
            </div>
            <p className="small muted" style={{ marginTop: 10 }}>Tap nights to select them. A price you set is underlined; striped nights are closed.</p>
          </div></section>
          {edit && <div className="side pf-stack">
            <Panel title={sel.length ? `${sel.length} night${sel.length > 1 ? "s" : ""} selected` : "Change nights"} pad>
              {!sel.length ? <p className="small muted">Select nights in the calendar to set a price or close them.</p> : <div className="pf-stack">
                <Field label="Price a night (Rs.)"><Input className="input tnum" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))} placeholder={String(cal.base)} /></Field>
                <Button disabled={busy || !price} onClick={() => setDays({ rate: Number(price) })}>Set price</Button>
                <Button variant="outline" disabled={busy} onClick={() => setDays({ rate: null })}>Back to normal price</Button>
                <div className="pf-row-actions" style={{ justifyContent: "flex-start" }}>
                  <Button variant="outline" icon="ban" disabled={busy} onClick={() => setDays({ closed: true })}>Close</Button>
                  <Button variant="ghost" disabled={busy} onClick={() => setDays({ closed: false })}>Open</Button>
                  <Button variant="ghost" disabled={busy} onClick={() => setSel([])}>Clear</Button>
                </div>
              </div>}
            </Panel>
            {rule && <Panel title={`${cal.type} rules`} pad><div className="pf-stack">
              <Field label="Weekend markup (Friday and Saturday nights)">
                <div className="pf-chips">{[0, 10, 20, 30].map((x) => <button key={x} type="button" className={`chip ${rule.weekendPct === x ? "active" : ""}`} aria-pressed={rule.weekendPct === x} onClick={() => setRule({ ...rule, weekendPct: x })}>{x ? `+${x}%` : "None"}</button>)}</div>
              </Field>
              <Field label="Shortest stay (nights)"><Input className="input tnum" type="number" min={1} max={60} value={rule.minNights} onChange={(e) => setRule({ ...rule, minNights: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })} /></Field>
              <Button variant="outline" disabled={busy || (rule.weekendPct === cal.rule.weekendPct && rule.minNights === cal.rule.minNights)} onClick={() => act(bizApi("PUT", "/calendar/rules", { type: cal.type, ...rule }))}>Save rules</Button>
            </div></Panel>}
          </div>}
        </div>
      </>}
    </>
  );
}
