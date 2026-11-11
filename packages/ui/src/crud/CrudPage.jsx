// CrudPage: a whole list page (filters, table or cards, view drawer, add / change form, delete, actions, CSV) from one description.
// Where it fits: "a list of one kind of record" screens. Business → Expenses (apps/expenses/frontend) is the first; Reviews follows.
// How it works: `resource` is data (docs/architecture/FRONTEND-KIT.md section 7): path, perms, versioned, list (params, filters, columns, note, csv),
// form (fields, toForm, toBody), view, modes, rowActions, remove, empty, titles, afterSave. The list loads with useApiList, so it reloads on
// branch change. Saving maps the server's 422 errors onto the fields and toasts the server's message. With `versioned: true` every change to an
// existing record sends the version it loaded; a 409 shows "Someone changed this. Reload to see the latest." and reloads the list (saveFlow.js).
// Layout "cards": `renderCard(row, { open, edit, remove, reload, meta, api })` draws each record (Reviews); `list.gridClass` sets the wrapper class.
// Rules: buttons the person may not use are not shown (the server checks again); `can(perm)` is passed in because the permission helper
// lives outside this package. No business data is kept in the browser store. Branch choices are read from the store only to fill the
// branch drop-down (as the old Live pages did), and only shown when "All branches" is picked and the business has several.

import React, { useMemo, useState } from "react";
import { bizApi } from "@sheetal/sdk/client";
import { invalidate, useApiList } from "@sheetal/sdk/hooks";
import { useBranch } from "@sheetal/shared/core/branch";
import { useStore } from "@sheetal/shared/core/store";
import { useT } from "@sheetal/shared/core/i18n";
import { TODAY } from "@sheetal/shared/core/format";
import { Button, Confirm, Empty, PageHead, Select, Stat, useToast } from "../primitives.jsx";
import { Icon } from "@sheetal/shared/core/icons";
import { DataTable } from "./DataTable.jsx";
import { Drawer } from "./Drawer.jsx";
import { FormBuilder, optionsOf } from "./FormBuilder.jsx";
import { ViewDrawer } from "./ViewDrawer.jsx";
import { useUndo } from "./useUndo.jsx";
import { exportCsv } from "./exportCsv.js";
import { buildBody, defaultValues, validateFields, visibleFields } from "./formRules.js";
import { reactToFailure, removeRecord, runRowAction, submitRecord } from "./saveFlow.js";

/** The last `n` months, newest first, as [{ id: "2026-11", label: "Nov 2026" }]. */
export function lastMonths(n = 12) {
  const out = [];
  let y = Number(TODAY.slice(0, 4)), m = Number(TODAY.slice(5, 7));
  for (let i = 0; i < n; i++) {
    out.push({ id: `${y}-${String(m).padStart(2, "0")}`, label: new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }) });
    if (--m < 1) { m = 12; y--; }
  }
  return out;
}

/** Branches to choose from when "All branches" is picked and the business has several open ones; otherwise null (the server picks). */
function useBranchChoices(tenant) {
  const br = useBranch();
  const { db } = useStore();
  const open = (db.branches?.[tenant?.id] || []).filter((b) => b.status === "open");
  return br?.branch === "all" && open.length > 1 ? open.map((b) => ({ id: b.id, label: b.name })) : null;
}

const allowed = (can, perm) => !perm || can(perm);
const text = (v, row) => (typeof v === "function" ? v(row) : v);

export function CrudPage({
  resource, title, sub, tenant, stats, banner, layout = "table", renderCard, can = () => true, api = bizApi, onChanged, extraRowActions = [], actions, extraContext,
}) {
  const t = useT();
  const toast = useToast();
  const undo = useUndo();
  const { list = {}, form, view = {}, modes = {}, remove, perms = {}, afterSave } = resource;
  const branches = useBranchChoices(tenant);

  // ── list state: filters, sort, page ──
  const [filters, setFilters] = useState(() => Object.fromEntries((list.filters || []).map((f) => [f.id, f.default ?? (f.type === "chips" ? f.options?.[0]?.id ?? "" : "")])));
  const [sort, setSort] = useState(list.defaultSort || null);
  const [pg, setPg] = useState({ page: 1, per: list.per || 50 });
  const params = { ...(list.params ? list.params({ ...filters, sort }) : filters), ...(list.paged ? { page: pg.page, per: pg.per } : {}), ...(sort && list.sortParams ? list.sortParams(sort) : {}) };
  const { rows, meta, error, loading, refresh } = useApiList(resource.path, params, { api, tenantId: tenant?.id });
  const context = useMemo(() => ({ ...(meta || {}), ...(extraContext || {}), branches }), [meta, extraContext, branches]);
  const done = () => { refresh(); invalidate([resource.path]); onChanged?.(); };

  // ── drawers ──
  const [viewing, setViewing] = useState(null);
  const [editor, setEditor] = useState(null); // { row, mode, values, original }
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [asking, setAsking] = useState(null); // { a, row }

  const canCreate = !!form && allowed(can, perms.create);
  const canUpdate = !!form && allowed(can, perms.update);
  const canDelete = !!remove && allowed(can, perms.delete);
  const fieldsFor = (e) => (e?.row ? form.fields.filter((f) => !(form.edit?.omit || []).includes(f.key)) : form.fields);

  const openCreate = () => { setErrors({}); setConflict(false); const values = defaultValues(form.fields, form.create?.defaults); setEditor({ row: null, mode: null, values, original: values }); };
  const openEdit = (row, mode = null) => {
    setErrors({}); setConflict(false); setViewing(null);
    const values = { ...defaultValues(form.fields), ...(form.toForm ? form.toForm(row) : row) };
    setEditor({ row, mode, values, original: values });
  };
  const closeEditor = () => { setEditor(null); setErrors({}); setConflict(false); };
  // Unsaved changes? A chosen File is compared by name and size.
  const sig = (v) => JSON.stringify(v, (k, x) => (typeof File !== "undefined" && x instanceof File ? `file:${x.name}:${x.size}` : x));
  const dirty = !!editor && sig(editor.values) !== sig(editor.original);

  // A failed request: a stale version reloads the list and says so; nothing is retried by itself.
  const fail = (e) => reactToFailure(e, { conflict: () => toast(t("kit.conflict")), reload: done, fields: (_errors, message) => toast(message), message: toast });

  const save = async () => {
    const fields = visibleFields(fieldsFor(editor), editor.values, context);
    const found = validateFields(fields, editor.values, { t });
    if (Object.keys(found).length) { setErrors(found); return; }
    setBusy(true); setErrors({});
    const body = form.toBody ? form.toBody(editor.values, { row: editor.row, mode: editor.mode }) : buildBody(fields, editor.values);
    try {
      const res = await submitRecord(resource, editor, body, api);
      const id = res?.data?.id ?? editor.row?.id;
      const fileDef = afterSave?.file;
      if (fileDef && id) {
        const v = editor.values[fileDef.field];
        const failText = (e) => (fileDef.failText ? fileDef.failText(e.message) : t("kit.fileNotSaved", { why: e.message }));
        try {
          if (typeof File !== "undefined" && v instanceof File) await fileDef.upload(id, v, api);
          else if (v === null && editor.original?.[fileDef.field]?.existing && fileDef.remove) { const r = await fileDef.remove(id, api); if (r?.message) toast(r.message); }
        } catch (e) { toast(failText(e)); }
      }
      if (res?.message) toast(res.message);
      closeEditor(); done();
    } catch (e) {
      reactToFailure(e, { conflict: () => setConflict(true), reload: refresh, fields: (errs, message) => { setErrors(errs); if (message) toast(message); }, message: toast });
    } finally { setBusy(false); }
  };

  const doRemove = async (row) => {
    try {
      const res = await removeRecord(resource, row, api);
      if (remove.undo && remove.restore) undo(res?.message || t("kit.deleted"), () => remove.restore(row, api).then(done).catch((e) => toast(e.message)));
      else if (res?.message) toast(res.message);
      setViewing(null); done();
    } catch (e) { fail(e); }
  };
  const runAction = async (a, row) => {
    try {
      const res = await runRowAction(resource, a, row, api);
      if (res?.message) toast(res.message);
      if (a.refresh !== false) done();
    } catch (e) { fail(e); }
  };
  // One click on a row action: change opens the form, delete asks first, others ask if they have a `confirm`.
  const fire = (a, row) => {
    if (a.edit) openEdit(row);
    else if (a.remove) setDeleting(row);
    else if (a.confirm) setAsking({ a, row });
    else runAction(a, row);
  };

  // ── what each row offers ──
  const visibleActions = (row) => [...(resource.rowActions || []), ...extraRowActions].filter((a) => allowed(can, a.perm) && (!a.when || a.when(row)));
  const modeButtons = (row) => Object.entries(modes).filter(([, m]) => canUpdate && (!m.when || m.when(row)));
  const rowTools = (row) => (
    <div className="pf-row-actions">
      {visibleActions(row).filter((a) => a.first).map((a) => <Button key={a.id} size="sm" variant="ghost" icon={a.icon} onClick={() => fire(a, row)}>{text(a.label, row)}</Button>)}
      {modeButtons(row).map(([id, m]) => <Button key={id} size="sm" icon="check" onClick={() => openEdit(row, id)}>{m.submitLabel}</Button>)}
      {visibleActions(row).filter((a) => !a.first).map((a) => <Button key={a.id} size="sm" variant="ghost" icon={a.icon} onClick={() => fire(a, row)}>{text(a.label, row)}</Button>)}
    </div>
  );

  const baseColumns = typeof list.columns === "function" ? list.columns(rows || [], meta || {}, context) : list.columns || [];
  const hasTools = !!(resource.rowActions?.length || extraRowActions.length || Object.keys(modes).length);
  const columns = [...baseColumns, ...(hasTools ? [{ key: "_tools", label: "", align: "right", render: rowTools }] : [])];
  const filterBar = ((list.filters || []).length > 0 || list.note || canCreate || list.csv) && (
    <div className="pf-toolbar">
      {list.note && <p className="small muted pf-toolbar-note">{list.note}</p>}
      {(list.filters || []).map((f) => {
        const opts = f.type === "month" ? [{ id: "", label: t("kit.allMonths") }, ...lastMonths(f.months || 12)] : f.type === "select" ? [{ id: "", label: f.allLabel || t("common.all") }, ...(Array.isArray(f.options) ? f.options : optionsOf(f, context))] : f.options || [];
        if (f.type === "chips") return <div className="pf-chip-row" key={f.id}>{opts.map((o) => <button key={o.id} type="button" className={`chip ${filters[f.id] === o.id ? "active" : ""}`} aria-pressed={filters[f.id] === o.id} onClick={() => { setFilters({ ...filters, [f.id]: o.id }); setPg({ ...pg, page: 1 }); }}>{o.label}</button>)}</div>;
        return <Select key={f.id} value={filters[f.id]} aria-label={f.label || f.id} style={{ width: f.width || 180 }} options={opts} onChange={(v) => { setFilters({ ...filters, [f.id]: v }); setPg({ ...pg, page: 1 }); }} />;
      })}
      {list.csv && rows && <Button variant="outline" icon="download" onClick={() => exportCsv(list.csv.name, list.csv.head, rows.map(list.csv.row))}>{t("common.exportCsv")}</Button>}
      {canCreate && <Button icon="plus" onClick={openCreate}>{resource.titles?.create || t("kit.add", { what: resource.label?.one || "" })}</Button>}
    </div>
  );

  if (perms.read && !can(perms.read)) return <Empty icon="lock" title={t("noaccess.title")}>{t("noaccess.text")}</Empty>;

  // `empty` may be a function of the filters (Reviews: "No reviews yet" for All, "Nothing here" for the others).
  const emptyDef = typeof resource.empty === "function" ? resource.empty(filters) : resource.empty;
  const emptyNode = emptyDef ? <Empty icon={emptyDef.icon} title={emptyDef.title}>{emptyDef.sub}</Empty> : <Empty icon="search" title={t("kit.nothing")} />;
  const openRow = (row) => setViewing(row);
  const rowActionsFor = (row) => ({ open: () => openRow(row), edit: () => canUpdate && openEdit(row), remove: () => canDelete && setDeleting(row), reload: done, meta, api });
  const editorFields = editor ? fieldsFor(editor) : [];
  const modeDef = editor?.mode ? modes[editor.mode] : null;
  const labelOne = resource.label?.one || "";
  const drawerTitle = modeDef ? modeDef.title : editor?.row ? resource.titles?.edit || t("kit.edit", { what: labelOne }) : resource.titles?.create || t("kit.add", { what: labelOne });

  return (
    <>
      {title && <PageHead title={title} sub={sub} actions={actions} />}
      {stats && meta && <div className="pf-stats">{stats(meta, rows || []).map((s) => <Stat key={s.label} {...s} />)}</div>}
      {banner && meta && banner(meta)}
      <section className="card pf-panel">
        {filterBar}
        {layout === "cards"
          ? (rows === null && !error ? <p className="muted pf-pad">{resource.loadingText || t("kit.loading")}</p> : error ? <DataTable columns={[]} rows={null} error={error} onRetry={refresh} />
            : rows.length === 0 ? emptyNode : <div className={list.gridClass || "pf-card-grid"}>{rows.map((r) => <React.Fragment key={r.id}>{renderCard(r, rowActionsFor(r))}</React.Fragment>)}</div>)
          : <DataTable columns={columns} rows={rows} loading={loading} error={error} onRetry={refresh} empty={emptyNode} mobile="cards" primary={list.primary || columns[0]?.key}
              secondary={list.secondary || []} onRowClick={view.facts || canUpdate ? openRow : undefined} minWidth={list.minWidth || 720}
              sort={sort} onSort={list.sortable === false ? undefined : (field, dir) => { setSort({ field, dir }); setPg({ ...pg, page: 1 }); }}
              page={list.paged && meta?.total != null ? { page: pg.page, per: pg.per, total: meta.total } : undefined} onPage={(page, per) => setPg({ page, per })}
              rowClassName={list.rowClassName} />}
      </section>

      {viewing && (
        <ViewDrawer open onClose={() => setViewing(null)} title={view.title ? view.title(viewing) : labelOne} sub={view.sub?.(viewing)} facts={view.facts ? view.facts(viewing, context) : []}
          onEdit={canUpdate && form && (!view.canEdit || view.canEdit(viewing)) ? () => openEdit(viewing) : undefined}
          onDelete={canDelete && (!remove.when || remove.when(viewing)) ? () => setDeleting(viewing) : undefined} deleteLabel={remove?.confirmLabel ? text(remove.confirmLabel, viewing) : "Delete"}
          actions={<>{modeButtons(viewing).map(([id, m]) => <Button key={id} icon="check" onClick={() => openEdit(viewing, id)}>{m.submitLabel}</Button>)}
            {visibleActions(viewing).filter((a) => !a.edit && !a.remove).map((a) => <Button key={a.id} variant="ghost" icon={a.icon} onClick={() => { fire(a, viewing); setViewing(null); }}>{text(a.label, viewing)}</Button>)}</>}>
          {view.extra?.(viewing)}
        </ViewDrawer>
      )}

      {editor && (
        <Drawer open onClose={closeEditor} title={drawerTitle} dirty={dirty} busy={busy}
          footer={<><Button variant="ghost" onClick={closeEditor} disabled={busy}>{t("common.cancel")}</Button><Button disabled={busy || conflict} onClick={save}>{modeDef?.submitLabel || t("kit.save")}</Button></>}>
          {conflict && <div className="pf-note" role="alert"><Icon name="circle-alert" size={16} /><span>{t("kit.conflict")} <Button size="sm" variant="outline" onClick={() => { closeEditor(); done(); }}>{t("kit.reload")}</Button></span></div>}
          {modeDef?.note && <div className="pf-note"><Icon name="clock" size={16} />{modeDef.note}</div>}
          <FormBuilder fields={editorFields} values={editor.values} errors={errors} context={context} disabled={busy}
            onChange={(patch) => setEditor((e) => ({ ...e, values: { ...e.values, ...patch } }))} />
        </Drawer>
      )}

      <Confirm open={!!deleting} onClose={() => setDeleting(null)} danger confirmLabel={deleting && remove?.confirmLabel ? text(remove.confirmLabel, deleting) : t("common.delete")}
        title={deleting ? (remove?.title ? remove.title(deleting) : t("kit.deleteTitle", { name: remove?.label ? remove.label(deleting) : labelOne })) : ""} onConfirm={() => doRemove(deleting)}>
        {deleting ? (text(remove?.text, deleting) || t("kit.deleteText")) : null}
      </Confirm>
      <Confirm open={!!asking} onClose={() => setAsking(null)} danger={!!asking?.a.danger} confirmLabel={asking ? text(asking.a.label, asking.row) : t("common.confirm")}
        title={asking ? text(asking.a.label, asking.row) : ""} onConfirm={() => runAction(asking.a, asking.row)}>
        {asking ? text(asking.a.confirm, asking.row) : null}
      </Confirm>
    </>
  );
}

