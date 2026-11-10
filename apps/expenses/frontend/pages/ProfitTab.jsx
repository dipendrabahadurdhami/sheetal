// The Profit tab: money in minus confirmed expenses, by month and branch, with a CSV download.
// Where it fits: ExpensesPage (third tab). Not a CrudPage: it is a report with a month range, not a list of records.
// How it works: reads /expenses/profit?from=&to= with useApiList (reloads on branch change), shows three stats, the VAT / commission note and a DataTable.
// The CSV has the same columns and file name as before (sheetal-profit-<day>.csv). A failed load shows an error panel with Try again.
// Rules: nothing is worked out in the browser; the server decides what counts. VAT and commission are shown for information only.

import React, { useMemo, useState } from "react";
import { bizApi } from "@sheetal/sdk/client";
import { useApiList } from "@sheetal/sdk/hooks";
import { Icon } from "@sheetal/shared/core/icons";
import { Button, Empty, Select, Stat } from "@sheetal/ui/primitives";
import { DataTable, exportCsv, lastMonths } from "@sheetal/ui/crud";
import { PROFIT_CSV_HEAD, PROFIT_CSV_NAME, profitColumns, profitCsvRow, profitStats, vatNote } from "../resources/profit.jsx";

export function ProfitTab({ tenant, api = bizApi }) {
  const months = useMemo(() => lastMonths(12), []);
  const [from, setFrom] = useState(months[5].id);
  const [to, setTo] = useState(months[0].id);
  const { rows, meta, error, loading, refresh } = useApiList("/expenses/profit", { from, to }, { api, tenantId: tenant?.id });
  const opts = useMemo(() => [...months].reverse(), [months]);
  const totals = meta?.totals;
  return (
    <>
      <div className="pf-toolbar">
        <Select value={from} onChange={(v) => { setFrom(v); if (v > to) setTo(v); }} style={{ width: 170 }} aria-label="From" options={opts} />
        <Select value={to} onChange={(v) => { setTo(v); if (v < from) setFrom(v); }} style={{ width: 170 }} aria-label="To" options={opts} />
        <Button variant="outline" icon="download" disabled={!rows?.length} onClick={() => exportCsv(PROFIT_CSV_NAME, PROFIT_CSV_HEAD, rows.map(profitCsvRow))}>Download CSV</Button>
      </div>
      {!error && <div className="pf-stats">{profitStats(totals).map((s) => <Stat key={s.label} {...s} />)}</div>}
      {!error && <div className="pf-note"><Icon name="circle-alert" size={16} /><span>{vatNote(totals)}</span></div>}
      <section className="card pf-panel">
        <DataTable columns={profitColumns(rows)} rows={rows} loading={loading} error={error} onRetry={refresh} minWidth={860} mobile="cards" primary="m" secondary={["d", "p", "e", "r"]}
          empty={<Empty icon="wallet" title="Nothing in these months" />} />
      </section>
    </>
  );
}
