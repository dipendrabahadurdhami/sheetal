// DataTable: today's Table plus loading, error, sorting, paging, row selection and phone cards.
// Where it fits: CrudPage's list; any screen that wants more than the plain Table. No screen uses it yet (P1-FE-2 is the first).
// How it works: columns, rows, onRowClick, empty, rowKey and minWidth work as in Table. New: loading / error (skeleton rows, an error
// panel with Retry), sort + onSort (server-side, header buttons, aria-sort), page + onPage (server-side paging, hidden when total <= per),
// selection (checkboxes), and mobile="cards" (under 640 px each row becomes a card: the `primary` column is the title, `secondary`
// columns follow, a column with no label, such as row actions, goes last). hideBelow hides a column on narrower screens.
// Rules: all looks come from platform.css (pf-cards, pf-card-row, pf-skel, pf-pager, pf-bulk); only a column's own width / align stay inline. Money columns use `num` and rs() (tabular figures); dates use fdate(); nothing renders raw HTML; header buttons are real
// <button>s; a click on a button, link or field inside a row does not also open the row.

import React, { useEffect, useState } from "react";
import { Icon } from "@sheetal/shared/core/icons";
import { useT } from "@sheetal/shared/core/i18n";
import { Button } from "../primitives.jsx";

/** The window width, kept up to date; 1024 when there is no window (server rendering, tests). */
export function useWidth() {
  const get = () => (typeof window === "undefined" ? 1024 : window.innerWidth);
  const [w, setW] = useState(get);
  useEffect(() => {
    const h = () => setW(get());
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return w;
}

const interactive = (e) => !!e.target.closest?.("button,a,input,select,textarea,label,[role=button]");
const cx = (...a) => a.filter(Boolean).join(" ");
const cell = (c, r) => (c.render ? c.render(r) : r[c.key]);

export function DataTable({
  columns, rows, rowKey = "id", loading = false, error = null, onRetry, empty, onRowClick, sort, onSort, page, onPage, selection,
  bulk, mobile, primary, secondary = [], minWidth = 720, rowClassName,
}) {
  const t = useT();
  const width = useWidth();
  const cards = mobile === "cards" && width < 640;
  const cols = columns.filter((c) => !c.hideBelow || width >= c.hideBelow);
  const idsOf = () => (selection ? [...(selection.ids || [])] : []);
  const selected = new Set(idsOf());

  if (error) {
    return (
      <div className="pf-empty" role="alert">
        <Icon name="circle-alert" size={40} strokeWidth={1.4} />
        <h3>{t("kit.loadError")}</h3>
        <p>{error.message}</p>
        {onRetry && <Button variant="outline" icon="refresh-cw" onClick={onRetry}>{t("kit.retry")}</Button>}
      </div>
    );
  }
  const waiting = rows === null || rows === undefined;
  if (!waiting && !loading && rows.length === 0) return empty || null;

  const toggle = (id) => { const next = new Set(selected); if (next.has(id)) next.delete(id); else next.add(id); selection.onChange([...next]); };
  const allOnPage = !waiting && rows.length > 0 && rows.every((r) => selected.has(r[rowKey]));
  const toggleAll = () => selection.onChange(allOnPage ? [...selected].filter((id) => !rows.some((r) => r[rowKey] === id)) : [...new Set([...selected, ...rows.map((r) => r[rowKey])])]);
  const open = onRowClick ? (r) => (e) => { if (!interactive(e)) onRowClick(r); } : undefined;

  const pages = page ? Math.max(1, Math.ceil(page.total / page.per)) : 1;
  const pager = page && page.total > page.per && (
    <nav className="pf-pager" aria-label={t("kit.pageOf", { page: page.page, pages })}>
      <span className="small muted tnum">{t("kit.pageOf", { page: page.page, pages })} · {t("kit.rows", { n: page.total })}</span>
      <span className="pf-row-actions">
        <Button size="sm" variant="outline" disabled={page.page <= 1} onClick={() => onPage(page.page - 1, page.per)}>{t("kit.prev")}</Button>
        <Button size="sm" variant="outline" disabled={page.page >= pages} onClick={() => onPage(page.page + 1, page.per)}>{t("kit.next")}</Button>
      </span>
    </nav>
  );
  const bar = selection && selected.size > 0 && (
    <div className="pf-note pf-bulk" role="status">
      <b className="tnum">{t("kit.selected", { n: selected.size })}</b>
      {bulk}
      <Button size="sm" variant="ghost" onClick={() => selection.onChange([])}>{t("kit.clearSel")}</Button>
    </div>
  );

  if (cards) {
    const main = cols.find((c) => c.key === primary) || cols[0];
    const extra = secondary.map((k) => cols.find((c) => c.key === k)).filter(Boolean);
    const actions = cols.filter((c) => !c.label && c !== main);
    return (
      <div aria-busy={loading || waiting || undefined}>
        {bar}
        <ul className="pf-cards">
          {waiting ? [0, 1, 2].map((i) => <li key={i} className="card pf-card-row pf-card-skel" aria-hidden="true" />) : rows.map((r) => (
            <li key={r[rowKey]} className={cx("card pf-card-row", onRowClick && "click", rowClassName?.(r))} onClick={open?.(r)}
              tabIndex={onRowClick ? 0 : undefined} onKeyDown={onRowClick ? (e) => e.key === "Enter" && !interactive(e) && onRowClick(r) : undefined}>
              {selection && <input type="checkbox" checked={selected.has(r[rowKey])} onChange={() => toggle(r[rowKey])} aria-label={t("kit.selectRow")} />}
              <b className="pf-card-title">{cell(main, r)}</b>
              {extra.map((c) => <div key={c.key} className="small pf-card-line"><span className="muted">{c.label}</span><span className={c.num ? "tnum" : undefined}>{cell(c, r)}</span></div>)}
              {actions.length > 0 && <div className="pf-row-actions pf-card-actions">{actions.map((c) => <React.Fragment key={c.key}>{cell(c, r)}</React.Fragment>)}</div>}
            </li>
          ))}
        </ul>
        {pager}
      </div>
    );
  }

  return (
    <div aria-busy={loading || waiting || undefined}>
      {bar}
      <div className="pf-table-wrap">
        <table className="table pf-table" style={{ minWidth }}>
          <thead>
            <tr>
              {selection && <th style={{ width: 36 }}><input type="checkbox" checked={allOnPage} onChange={toggleAll} aria-label={t("kit.selectAll")} /></th>}
              {cols.map((c) => {
                const on = sort && sort.field === c.key;
                const next = on && sort.dir === "asc" ? "desc" : "asc";
                return (
                  <th key={c.key} style={{ width: c.width, textAlign: c.align }} aria-sort={c.sortable && onSort ? (on ? (sort.dir === "asc" ? "ascending" : "descending") : "none") : undefined}>
                    {c.sortable && onSort
                      ? <button type="button" className="btn btn-ghost btn-sm" aria-label={t("kit.sortBy", { label: c.label })} onClick={() => onSort(c.key, next)}>{c.label}{on && <Icon name={sort.dir === "asc" ? "arrow-up" : "arrow-down"} size={13} />}</button>
                      : c.label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {waiting ? [0, 1, 2, 3, 4].map((i) => (
              <tr key={i} aria-hidden="true">
                {selection && <td />}
                {cols.map((c) => <td key={c.key}><span className="pf-skel" /></td>)}
              </tr>
            )) : rows.map((r) => (
              <tr key={r[rowKey]} className={cx(onRowClick && "click", rowClassName?.(r))} onClick={open?.(r)}
                tabIndex={onRowClick ? 0 : undefined} onKeyDown={onRowClick ? (e) => e.key === "Enter" && !interactive(e) && onRowClick(r) : undefined}>
                {selection && <td><input type="checkbox" checked={selected.has(r[rowKey])} onChange={() => toggle(r[rowKey])} aria-label={t("kit.selectRow")} /></td>}
                {cols.map((c) => <td key={c.key} style={{ textAlign: c.align }} className={c.num ? "tnum" : undefined}>{cell(c, r)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pager}
    </div>
  );
}
