// Expenses page: Business → Expenses, with the Expenses, Recurring and Profit tabs, built on the shared list-page kit.
// Where it fits: shown at /business/expenses by business/frontend/src/pages/BusinessApp.jsx (LiveExpenses.jsx is a one-line re-export of this).
// How it works: the page loads the plain /expenses list once for the facts every tab needs: whether the person may change things (`canManage`), how many
// drafts wait, and the category list. The first two tabs are CrudPage screens described in resources/expense.jsx and resources/recurring.jsx; Profit is
// ProfitTab. Changes send the row's version; a stale one shows "Someone changed this. Reload to see the latest." and reloads (see the kit's saveFlow.js).
// Rules: every button that changes something is shown only when the server says canManage (the server checks again on every request); an agent sees the list
// and the receipts only. Nothing is kept in the browser; the branch picked at the top reloads each tab.

import React, { useMemo, useState } from "react";
import { bizApi } from "@sheetal/sdk/client";
import { useApiList } from "@sheetal/sdk/hooks";
import { PageHead, Tabs } from "@sheetal/ui/primitives";
import { CrudPage } from "@sheetal/ui/crud";
import { expenseResource, expenseStats } from "../resources/expense.jsx";
import { recurringResource } from "../resources/recurring.jsx";
import { ProfitTab } from "./ProfitTab.jsx";

export function ExpensesPage({ tenant, api = bizApi }) {
  const [tab, setTab] = useState("expenses");
  // Only the page facts (canManage, drafts, categories) are needed here: one row is enough, the facts come in `meta` (QA, P1-FE-2 fix 1).
  const { meta } = useApiList("/expenses", { per: 1 }, { api, tenantId: tenant?.id });
  const drafts = meta?.drafts || 0;
  const canManage = !!meta?.canManage;
  const can = useMemo(() => () => canManage, [canManage]);
  const categories = useMemo(() => meta?.categories || [], [meta]);
  const context = useMemo(() => ({ categories }), [categories]);
  return (
    <>
      <PageHead title="Expenses" sub="What your business spent, and what is left of what it received." />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "expenses", label: "Expenses", icon: "receipt", count: drafts || undefined }, { id: "recurring", label: "Recurring", icon: "clock" }, { id: "profit", label: "Profit", icon: "wallet" }]} />
      {tab === "expenses" && <CrudPage key={tenant?.id} resource={expenseResource} tenant={tenant} api={api} can={can} stats={expenseStats} />}
      {tab === "recurring" && <CrudPage key={tenant?.id} resource={recurringResource} tenant={tenant} api={api} can={can} extraContext={context} />}
      {tab === "profit" && <ProfitTab key={tenant?.id} tenant={tenant} api={api} />}
    </>
  );
}
