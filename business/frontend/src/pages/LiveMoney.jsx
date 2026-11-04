// Customer invoices on the business API (instead of the sample screen).
// Where it fits: Business → Customer invoices when signed in; the screen itself is InvoicesView in Money.jsx.
// How it works: loads the invoices of the open business and branch from the server, and every change (save, send,
// payment, cancel, credit note, delete, import, invoice a booking) is a call to the server, which numbers the
// documents, works out VAT and totals, and checks the branch and role. The list loads again after each change.
// Rules: nothing is kept in the browser; a failed change shows the server's reason and leaves the form open.

import React, { useCallback, useEffect, useState } from "react";
import { useBranch } from "@sheetal/shared/core/branch";
import { useStore } from "@sheetal/shared/core/store";
import { TODAY } from "@sheetal/shared/core/format";
import { useToast } from "@sheetal/shared/core/ui";
import { bizApi } from "../api";
import { InvoicesView } from "./Money";

// The payment methods as the screen words them, and as the server keeps them.
const METHOD_KEY = { Cash: "cash", Fonepay: "fonepay", eSewa: "esewa", Khalti: "khalti", Card: "card", "Bank transfer": "bank", Other: "other" };
const METHOD_LABEL = Object.fromEntries(Object.entries(METHOD_KEY).map(([label, key]) => [key, label]));

/** A server invoice in the shape the screen uses: its number (or "DRAFT-0007") is the id shown, uid is the server's id. */
const toInv = (x) => ({ ...x, uid: x.id, id: x.label, receipts: x.receipts.map((r) => ({ id: r.no, uid: r.id, at: r.at, amount: r.amount, method: METHOD_LABEL[r.method] || r.method })) });
/** The fields the server takes for a draft; it works out the totals itself. */
const draftBody = (f) => ({
  to: f.to.trim(), phone: f.phone || null, pan: f.pan || null, order: f.order || null, date: f.date, due: f.due, vatPct: f.vatPct, notes: f.notes || null,
  lines: f.lines.map((l) => ({ what: l.what.trim(), qty: Number(l.qty), rate: Number(l.rate) })),
});

export function LiveInvoices({ tenant }) {
  const toast = useToast();
  const br = useBranch();
  const { db } = useStore();
  const [list, setList] = useState(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  const today = TODAY.slice(0, 10);

  // The branch picked at the top decides which invoices the server sends (the api sends it with every call).
  useEffect(() => {
    let gone = false;
    bizApi("GET", "/invoices")
      .then(({ data }) => { if (!gone) setList(data.map(toInv)); })
      .catch((e) => { if (!gone) { setList((l) => l || []); toast(e.message); } });
    return () => { gone = true; };
  }, [tenant.id, br?.branch, tick]);

  /** Runs one call: shows the server's message, loads the list again, and passes on a failure so the form stays open. */
  const run = (call, after) => call.then((r) => { if (r?.message) toast(r.message); reload(); return after ? after(r) : r; }).catch((e) => { toast(e.message); throw e; });

  const actions = {
    live: true,
    save: (f, send) => run(f.isNew ? bizApi("POST", "/invoices", { ...draftBody(f), send, branchId: f.branchId || undefined }) : bizApi("PUT", `/invoices/${f.uid}`, { ...draftBody(f), send }), (r) => r.data.label),
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
  const open = (db.branches?.[tenant.id] || []).filter((b) => b.status === "open");
  const branches = br?.branch === "all" && open.length > 1 ? open.map((b) => ({ id: b.id, label: b.name })) : null;

  if (!list) return <p className="muted pf-pad">Loading invoices…</p>;
  return <InvoicesView tenant={tenant} list={list} actions={actions} branches={branches} />;
}
