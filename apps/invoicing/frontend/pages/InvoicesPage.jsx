// Customer invoices on the business API: loads the list, and saves, sends, pays, cancels, credits, deletes and imports through the server.
// Where it fits: Business → Customer invoices. business/frontend/src/pages/LiveMoney.jsx renders it as LiveInvoices and passes in the screen itself (`View`:
// this app's InvoicesView (pages/InvoiceViews.jsx, since P2-W6) given the business's settings). Moved here in P2-W3, on the kit.
// How it works: useApiGet loads GET /invoices again when the business, the branch picked at the top, or a change happen. Every call shows the server's
// message; a failure keeps the form open. A draft save sends the version it was loaded with; a stale one (409) reloads the list.
// Rules: the server works out every total, number and balance; this page never does money sums of its own.

import React, { useEffect } from "react";
import { TODAY } from "@sheetal/shared/core/format";
import { useToast } from "@sheetal/ui/primitives";
import { bizApi } from "@sheetal/sdk/client";
import { useApiGet } from "@sheetal/sdk/hooks";
import { useBranch } from "@sheetal/shared/core/branch";

// The payment methods as the screen words them, and as the server keeps them.
const METHOD_KEY = { Cash: "cash", Fonepay: "fonepay", eSewa: "esewa", Khalti: "khalti", Card: "card", "Bank transfer": "bank", Other: "other" };
const METHOD_LABEL = Object.fromEntries(Object.entries(METHOD_KEY).map(([label, key]) => [key, label]));

/** A server invoice in the shape the screen uses: its number (or "DRAFT-0007") is the id shown, uid is the server's id. */
export const toInv = (x) => ({ ...x, uid: x.id, id: x.label, receipts: x.receipts.map((r) => ({ id: r.no, uid: r.id, at: r.at, amount: r.amount, method: METHOD_LABEL[r.method] || r.method })) });
/** The fields the server takes for a draft; it works out the totals itself. */
export const draftBody = (f) => ({
  to: f.to.trim(), phone: f.phone || null, pan: f.pan || null, order: f.order || null, date: f.date, due: f.due, vatPct: f.vatPct, notes: f.notes || null,
  lines: f.lines.map((l) => ({ what: l.what.trim(), qty: Number(l.qty), rate: Number(l.rate) })),
});

export function InvoicesPage({ tenant, View }) {
  const toast = useToast();
  const br = useBranch();
  const { data, error, refresh: reload } = useApiGet("/invoices");
  useEffect(() => { if (error) toast(error.message); }, [error, toast]);
  const today = TODAY.slice(0, 10);

  /** Runs one call: shows the server's message, loads the list again, and passes on a failure so the form stays open (a stale page reloads). */
  const run = (call, after) => call.then((r) => { if (r?.message) toast(r.message); reload(); return after ? after(r) : r; })
    .catch((e) => { toast(e.message); if (e.status === 409) reload(); throw e; });

  const actions = {
    live: true,
    save: (f, send) => run(f.isNew ? bizApi("POST", "/invoices", { ...draftBody(f), send, branchId: f.branchId || undefined }) : bizApi("PUT", `/invoices/${f.uid}`, { ...draftBody(f), send, version: f.version }), (r) => r.data.label),
    send: (inv) => run(bizApi("POST", `/invoices/${inv.uid}/send`)),
    pay: (inv, r) => run(bizApi("POST", `/invoices/${inv.uid}/receipts`, { amount: r.amount, method: METHOD_KEY[r.method] || "other", at: r.at })),
    cancel: (inv, reason) => run(bizApi("POST", `/invoices/${inv.uid}/cancel`, { reason })),
    credit: (inv, lines, reason, gross) => run(bizApi("POST", `/invoices/${inv.uid}/credit`, { amount: gross, reason, date: today }), (r) => r.data.label),
    remove: (x) => run(bizApi("DELETE", `/invoices/${x.uid}`)),
    restore: (x) => run(bizApi("POST", "/invoices", { ...draftBody(x), branchId: x.branchId, send: false })),
    importRows: (rows) => run(bizApi("POST", "/invoices/import", { rows })),
    // Hotels and hosts can make an invoice from a booking's room bill.
    fromBooking: tenant.type === "hotel" || tenant.type === "host" ? (code) => run(bizApi("POST", "/invoices/from-booking", { booking: code, date: today }), (r) => r.data.label) : null,
  };

  // With several branches and "All branches" picked, a new invoice asks which branch it is for.
  const open = (useApiGet("/branches").data?.branches || []).filter((b) => b.status === "open");
  const branches = br?.branch === "all" && open.length > 1 ? open.map((b) => ({ id: b.id, label: b.name })) : null;

  const list = data ? data.map(toInv) : error ? [] : null;
  if (!list) return <p className="muted pf-pad">Loading invoices…</p>;
  return <View tenant={tenant} list={list} actions={actions} branches={branches} />;
}
