// Business → Billing → Add-ons, on the business API: extra seats, listings, featured slots and POS outlets on top of the
// plan. Buying makes an invoice for the rest of the paid period; pay it in the invoices list above and it starts.
// Rules: the server decides prices and what can be bought; only people who manage billing see the buttons.

import React, { useEffect, useState } from "react";
import { rs } from "@sheetal/shared/core/format";
import { Badge, Button, Panel, Table, useToast } from "@sheetal/shared/core/ui";
import { bizApi } from "../api";

export function LiveAddons({ tenant, onChange }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => bizApi("GET", "/billing/addons").then((r) => setD(r.data)).catch(() => setD(false));
  useEffect(() => { load(); }, [tenant.id]);
  if (!d) return null;
  const act = (method, path, body) => { setBusy(true); bizApi(method, path, body).then((r) => { toast(r.message); load(); onChange?.(); }).catch((e) => toast(e.message)).finally(() => setBusy(false)); };
  const buy = (a) => { const n = Number(window.prompt(`How many? ${a.name}: ${rs(a.price)} a month per ${a.unit}. Now: ${rs(a.nowPrice)} each until your renewal.`, "1")); if (n > 0) act("POST", "/billing/addons", { addonId: a.id, qty: Math.floor(n) }); };
  const keep = (a) => { const n = window.prompt(`Keep how many at the next renewal? You have ${a.qty}. 0 stops it then.`, String(a.renewQty)); if (n !== null && /^\d+$/.test(n.trim())) act("POST", `/billing/addons/${a.id}/renew`, { renewQty: Number(n) }); };
  return (
    <Panel title="Add-ons" sub={d.paid ? `More room on top of your plan. Paid monthly, renewing with the plan. Bought now, it costs ${d.monthsLeft} month${d.monthsLeft > 1 ? "s" : ""} (to your renewal).` : "Add-ons are for paid plans. Upgrade to buy them."}>
      {d.openInvoices.length > 0 && <p className="small" style={{ margin: "0 0 12px" }}>To pay: {d.openInvoices.map((i) => `${i.number} (${rs(i.total)})`).join(", ")}. Find it in your invoices above.</p>}
      <Table rows={d.addons} minWidth={760} columns={[
        { key: "n", label: "Add-on", render: (a) => <span className="pf-two"><b>{a.name}</b><small>{a.sub}</small></span> },
        { key: "p", label: "Price", num: true, render: (a) => `${rs(a.price)} / ${a.unit} / month` },
        { key: "l", label: "Your limit", num: true, render: (a) => (a.unlimited ? "No limit" : <span className="pf-two"><b>{a.planLimit + a.extra}</b><small>{a.extra ? `plan ${a.planLimit} + ${a.extra}` : "from your plan"}</small></span>) },
        { key: "o", label: "You have", num: true, render: (a) => (a.qty ? <span className="pf-two"><b>{a.qty}</b>{a.renewQty !== a.qty && <small>{a.renewQty} at renewal</small>}</span> : "—") },
        { key: "x", label: "", align: "right", render: (a) => a.unlimited ? <Badge tone="done">In your plan</Badge> : d.canBuy && <div className="pf-row-actions" style={{ justifyContent: "flex-end" }}>
          {a.qty > 0 && <Button size="sm" variant="ghost" disabled={busy} onClick={() => keep(a)}>Keep fewer</Button>}
          <Button size="sm" variant="outline" icon="plus" disabled={busy} onClick={() => buy(a)}>Buy</Button>
        </div> },
      ]} />
    </Panel>
  );
}
