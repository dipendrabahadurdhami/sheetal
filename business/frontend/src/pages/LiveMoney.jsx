// Customer invoices and payouts on the business API.
// Where it fits: Business → Customer invoices and Payouts; the screens themselves are InvoicesView and PayoutsView in apps/invoicing/frontend (P2-W6),
// given the business's settings (receipt texts, payment set-up) from the panel's settings copy.
// How it works: Customer invoices are the Invoicing app's page (apps/invoicing/frontend, P2-W3) given InvoicesView; every change is a call to the server,
// which numbers the documents, works out VAT and totals, and checks the branch and role. Payouts load here, read only.
// Rules: nothing is kept in the browser; a failed change shows the server's reason and leaves the form open.

import React, { useEffect, useState } from "react";
import { useBranch } from "@sheetal/shared/core/branch";
import { useToast } from "@sheetal/shared/core/ui";
import { bizApi } from "../api";
import { InvoicesView as InvoicesScreen, PayoutsView as PayoutsScreen } from "@sheetal/app-invoicing/frontend";
import { useStore } from "@sheetal/shared/core/store";
import { defaultTenantSettings, mergeSettings } from "./BusinessSettings";
import { InvoicesPage } from "@sheetal/app-invoicing/frontend";

/** The business's settings as the panel loaded them (liveSettings.js), over the defaults. */
const useSettings = (tenant) => { const { db } = useStore(); return mergeSettings(defaultTenantSettings(tenant), db.tenantSettings?.[tenant.id]); };
/** The invoice screen given the business's settings. */
const InvoicesView = (props) => <InvoicesScreen {...props} settings={useSettings(props.tenant)} />;
const PayoutsView = (props) => <PayoutsScreen {...props} settings={useSettings(props.tenant)} />;

/** Customer invoices on the business API: the Invoicing app's page (P2-W3) given its screen (P2-W6). */
export function LiveInvoices(props) { return <InvoicesPage {...props} View={InvoicesView} />; }

// The statement lists every payment Sheetal collected (not the fixed payouts template of the import/export buttons).
const STATEMENT = [["Date", "date"], ["Branch", "branch"], ["Source", "source"], ["Reference", "reference"], ["Description", "description"], ["Collected (Rs.)", "collected"], ["Commission (Rs.)", "commission"], ["Paid to you (Rs.)", "net"], ["Payout", "payout"]];
// A cell that starts with = + - @ would run as a formula in Excel, so it gets a leading quote mark.
const cell = (v) => { let x = v == null ? "" : String(v); if (/^[=+@-]/.test(x) && Number.isNaN(Number(x))) x = `'${x}`; return /[",\r\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
function downloadStatement(rows) {
  const body = [STATEMENT.map(([h]) => h), ...rows.map((r) => STATEMENT.map(([, k]) => r[k]))].map((r) => r.map(cell).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["\uFEFF" + body], { type: "text/csv;charset=utf-8" }));
  a.download = `sheetal-payouts-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const NO_PAYOUTS = { mode: "sheetal", bank: { bank: "", holder: "", last4: "" }, schedule: { day: "friday", holdDays: 2, nextOn: null }, payouts: [], waiting: { count: 0, gross: 0, fee: 0, net: 0 }, onTheWay: { count: 0, net: 0 }, last30: { net: 0, fee: 0 } };

/** Payouts from the server: read-only. The branch picked at the top decides which branches' money is shown. */
export function LivePayouts({ tenant }) {
  const toast = useToast();
  const br = useBranch();
  const [data, setData] = useState(null);

  useEffect(() => {
    let gone = false;
    setData(null);
    bizApi("GET", "/payouts")
      .then((r) => { if (!gone) setData(r.data); })
      .catch((e) => { if (!gone) { setData(NO_PAYOUTS); toast(e.message); } });
    return () => { gone = true; };
  }, [tenant.id, br?.branch]);

  const actions = {
    lines: (p) => bizApi("GET", `/payouts/${p.id}`).then((r) => r.data.lines),
    statement: () => bizApi("GET", "/payouts/statement").then((r) => { downloadStatement(r.data); toast("Statement downloaded"); }).catch((e) => toast(e.message)),
  };

  if (!data) return <p className="muted pf-pad">Loading payouts…</p>;
  return <PayoutsView tenant={tenant} data={data} actions={actions} />;
}
