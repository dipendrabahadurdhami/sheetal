// The Profit tab's pieces: the table columns and the CSV download.
// Where it fits: ProfitTab.jsx. Profit is money in (invoice payments without VAT, plus Sheetal payouts) minus confirmed expenses, by month and branch.
// How it works: the server works everything out; these only name the columns and lay the rows out. VAT collected and Sheetal's commission are for information.
// Rules: the CSV columns and the file name ("sheetal-profit-<day>.csv") are the ones the old page had; amounts are whole rupees.

import React from "react";
import { rs } from "@sheetal/shared/core/format";
import { monthLabel } from "./common.js";

export const PROFIT_CSV_NAME = "sheetal-profit";
export const PROFIT_CSV_HEAD = ["Month", "Branch", "Received directly, without VAT (Rs.)", "Payouts from Sheetal (Rs.)", "Expenses (Rs.)", "Profit (Rs.)", "VAT collected, info (Rs.)", "Sheetal commission, info (Rs.)"];
export const profitCsvRow = (r) => [r.month, r.branch, r.direct, r.payouts, r.expenses, r.profit, r.vat, r.commission];

export function profitColumns(rows) {
  const many = new Set((rows || []).map((r) => r.branchId)).size > 1;
  return [
    { key: "m", label: "Month", render: (r) => <span className="pf-two"><b>{monthLabel(r.month)}</b>{many && <small>{r.branch}</small>}</span> },
    { key: "d", label: "Received by you", num: true, align: "right", render: (r) => rs(r.direct) },
    { key: "p", label: "Payouts from Sheetal", num: true, align: "right", render: (r) => rs(r.payouts) },
    { key: "e", label: "Expenses", num: true, align: "right", render: (r) => `− ${rs(r.expenses)}` },
    { key: "r", label: "Profit", num: true, align: "right", render: (r) => <b className="pf-strong">{rs(r.profit)}</b> },
    { key: "v", label: "VAT (info)", num: true, align: "right", render: (r) => <span className="muted">{rs(r.vat)}</span> },
    { key: "c", label: "Commission (info)", num: true, align: "right", render: (r) => <span className="muted">{rs(r.commission)}</span> },
  ];
}

export function profitStats(t) {
  return [
    { label: "Money in", value: rs((t?.direct || 0) + (t?.payouts || 0)), note: `${rs(t?.direct || 0)} received by you · ${rs(t?.payouts || 0)} paid out by Sheetal` },
    { label: "Expenses", value: rs(t?.expenses || 0), note: "Confirmed only" },
    { label: "Profit", value: rs(t?.profit || 0), note: "Money in minus expenses" },
  ];
}

export const vatNote = (t) => `VAT collected (${rs(t?.vat || 0)}) is owed to the government, so it is not counted as money in. Sheetal's commission (${rs(t?.commission || 0)}) is already taken off your payouts, so it is not an expense. Both are for information.`;
