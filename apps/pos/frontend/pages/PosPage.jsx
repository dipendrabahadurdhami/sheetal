// Point of sale page: the till (shift), menu buttons, bills paid on the spot or put on a guest's room, and today's bills.
// Where it fits: Business → Point of sale (the "Restaurant" tab of LivePOSHub in BusinessApp.jsx), through LiveOps.jsx which re-exports it as LivePOS.
// How it works: moved from business/frontend/src/pages/LiveOps.jsx (P2-W4) onto the kit (@sheetal/ui, @sheetal/sdk); the server keeps every rule (prices
// from the menu, cash needs an open shift, discounts and voids need their own permissions).
// Rules: buttons show only for roles that may use them (the server checks again).

import React, { useEffect, useState } from "react";
import { fdatetime, rs } from "@sheetal/shared/core/format";
import { can } from "@sheetal/shared/core/rbac";
import { Button, Drawer, Empty, Field, Input, PageHead, Panel, Select, useToast } from "@sheetal/ui/primitives";
import { Icon } from "@sheetal/shared/core/icons";
import { bizApi } from "@sheetal/sdk/client";
import { useApiGet } from "@sheetal/sdk/hooks";

const PAY = [["cash", "Cash"], ["fonepay", "Fonepay"], ["card", "Card"], ["esewa", "eSewa"], ["khalti", "Khalti"], ["bank", "Bank"]];
/** One GET on the kit: [data, reload]; loads again when the business, the branch picked at the top or reload() change (null while loading or after an error). */
function useApi(path) {
  const toast = useToast();
  const { data, error, refresh } = useApiGet(path);
  useEffect(() => { if (error) toast(error.message); }, [error, toast]);
  return [error ? null : data, refresh];
}
const run = (toast, p, after) => p.then((r) => { if (r?.message) toast(r.message); after?.(r); return r; }).catch((e) => { toast(e.message); throw e; });

export function PosPage({ tenant, role }) {
  const toast = useToast();
  const [menu, reloadMenu] = useApi("/menu");
  const [shift, reloadShift] = useApi("/shifts/current");
  const [rooms] = useApi("/rooms");
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
        actions={<>{shift ? can(role, "pos.shift.close") && <Button variant="outline" onClick={() => { const c = window.prompt(`Cash counted in the drawer? Expected ${shift.expectedCash}.`); if (c !== null) run(toast, bizApi("POST", "/shifts/close", { counted: Number(c.replace(/\D/g, "")) || 0 }), reloadShift).catch(() => {}); }}>Close shift</Button>
          : <Button onClick={() => { const f = window.prompt("Opening cash float (Rs.)", "0"); if (f !== null) run(toast, bizApi("POST", "/shifts/open", { float: Number(f.replace(/\D/g, "")) || 0 }), reloadShift).catch(() => {}); }}>Open shift</Button>}
          {can(role, "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete") && <Button variant="outline" icon="plus" onClick={() => setNewItem({ name: "", price: "", category: "Food", outlet: here })}>Menu item</Button>}</>} />
      <div className="pf-split">
        <Panel title={here} className="grow" actions={outlets.length > 1 && <Select value={here} onChange={setOutlet} options={outlets.map((o) => ({ id: o, label: o }))} style={{ width: 180 }} />}>
          {!menu ? <p className="muted pf-pad">Loading…</p> : !items.length ? <Empty icon="utensils" title="No menu items yet">Add items with “Menu item”.</Empty>
            : <div className="pf-menu-grid pf-pad">{items.map((m) => <button key={m.id} type="button" className="card pf-menu-item" onClick={() => add(m)}><b>{m.name}</b><span className="small muted">{m.category}</span><span className="tnum">{rs(m.price)}</span></button>)}</div>}
        </Panel>
        <Panel title="Bill" className="side" pad>
          <div className="pf-stack">
            {!cart.length ? <p className="muted">Tap items to add them.</p> : <ul className="pf-list">{cart.map((l, i) => <li key={i}><span style={{ flex: 1 }}>{l.name} × {l.qty}</span><b className="tnum">{rs(l.qty * l.price)}</b><button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Remove ${l.name}`} onClick={() => setCart((c) => c.filter((_, j) => j !== i))}><Icon name="x" size={14} /></button></li>)}</ul>}
            {can(role, "pos.bill.discount") && <Field label="Discount (Rs.)"><Input className="input tnum" value={discount} onChange={(e) => setDiscount(e.target.value.replace(/\D/g, ""))} /></Field>}
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
