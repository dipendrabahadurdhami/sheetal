// Branches of a business on the business API: its outlets, offices or sites.
// Where it fits: Business → Settings → Branches when signed in. Moved here from LiveBranches in business/frontend/src/pages/Branches.jsx in P2-W6 (that
// name is now a shim); the backend is apps/workspace/backend/workspace.* (GET/POST/PATCH/DELETE /branches).
// How it works: useApiGet loads GET /branches (with staff and room counts) and GET /team (the people a manager can be picked from) itself. An edit and
// closing or reopening send the version the branch was loaded with, so a stale page gets 409 and reloads. After every change `onChanged` lets the panel
// reload its branch picker and everyone's access.
// Rules: nothing is kept in the browser; the server refuses deleting a branch with rooms or someone's only branch, and the toast says why.

import React, { useEffect, useState } from "react";
import { useT } from "@sheetal/shared/core/i18n";
import { Icon } from "@sheetal/shared/core/icons";
import { LinkChip } from "@sheetal/shared/layout/Links";
import { Badge, Button, Confirm, Drawer, Field, Input, PageHead, Select, Stat, useToast } from "@sheetal/ui/primitives";
import { bizApi } from "@sheetal/sdk/client";
import { useApiGet } from "@sheetal/sdk/hooks";

/** The fields of a branch the server takes (empty text is sent as null). */
export const branchFields = (b) => ({ name: b.name?.trim(), address: b.address || null, phone: b.phone || null, manager: b.manager || null, receipt: b.receipt || null });

export function BranchesPage({ tenant, canManage, onChanged }) {
  const t = useT();
  const toast = useToast();
  const br = useApiGet("/branches");
  const team = useApiGet("/team");
  useEffect(() => { if (br.error) toast(br.error.message); }, [br.error, toast]);
  const list = br.data?.branches || [];
  /** One call: shows the server's message, reloads this page and the panel; a stale branch (409) reloads too. */
  const run = (p) => p.then((r) => { if (r?.message) toast(r.message); br.refresh(); onChanged?.(); return r; })
    .catch((e) => { toast(e.message); br.refresh(); throw e; });
  const api = {
    add: (b) => run(bizApi("POST", "/branches", branchFields(b))),
    save: (b) => run(bizApi("PATCH", `/branches/${b.id}`, { ...branchFields(b), version: b.version })),
    setOpen: (b, open) => run(bizApi("PATCH", `/branches/${b.id}`, { status: open ? "open" : "closed", version: b.version })),
    remove: (b) => run(bizApi("DELETE", `/branches/${b.id}`)),
  };
  const [edit, setEdit] = useState(null);
  const [close, setClose] = useState(null);
  const [del, setDel] = useState(null);
  const [busy, setBusy] = useState(false);
  const manage = !!canManage;
  const stays = tenant.type === "hotel" || tenant.type === "host";
  const people = (team.data?.members || []).filter((m) => m.status === "active");
  const act = async (p, done) => { setBusy(true); try { await p; done?.(); } catch { /* the toast says why */ } finally { setBusy(false); } };
  return (
    <>
      <PageHead title={t("br.title")} sub="Your outlets, offices or sites. On the Team page, give each person all branches or just theirs: they then see only those branches' work."
        actions={manage && <Button icon="plus" onClick={() => setEdit({ name: "", address: "", phone: tenant.phone || "", manager: "", receipt: tenant.name, isNew: true })}>{t("br.add")}</Button>} />
      <div className="pf-stats">
        <Stat label={t("br.count")} value={list.filter((b) => b.status === "open").length} note={t("br.closed", { n: list.filter((b) => b.status !== "open").length })} />
        <Stat label={t("br.staff")} value={people.length} note="People in the business" to="/business/team" />
        {stays && <Stat label="Rooms" value={list.reduce((n, b) => n + (b.rooms || 0), 0)} note={t("br.acrossAll")} to="/business/pos" />}
      </div>
      <div className="pf-branch-grid">
        {list.map((b) => (
          <section key={b.id} className={`card pf-branch ${b.status !== "open" ? "off" : ""}`}>
            <div className="pf-plan-top"><h3>{b.name}</h3>{b.status === "open" ? <Badge tone="done">{t("br.open")}</Badge> : <Badge tone="neutral">{t("br.closedOne")}</Badge>}</div>
            <span className="small muted"><Icon name="map-pin" size={13} /> {b.address || "No address yet"}</span>
            <div className="pf-branch-nums">
              <div><span className="small muted">{t("br.staff")}</span><b className="tnum">{b.staff}</b></div>
              {stays && <div><span className="small muted">Rooms</span><b className="tnum">{b.rooms}</b></div>}
            </div>
            <dl className="pf-kv"><dt>{t("br.manager")}</dt><dd>{b.manager || "—"}</dd><dt>{t("common.phone")}</dt><dd className="tnum">{b.phone || "—"}</dd><dt>{t("brand.receiptHeader")}</dt><dd>{b.receipt || tenant.name}</dd></dl>
            <div className="pf-chips"><LinkChip to="/business/team" icon="users">{t("nav.team")}</LinkChip>{stays && <LinkChip to="/business/pos" icon="store">{t("nav.pos")}</LinkChip>}</div>
            {manage && <div className="pf-plan-foot">
              {b.status !== "open" && list.length > 1 && <Button variant="ghost" size="sm" icon="trash-2" disabled={busy} onClick={() => setDel(b)}>{t("common.delete")}</Button>}
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setClose(b)}>{b.status === "open" ? t("br.close") : t("br.reopen")}</Button>
              <Button variant="outline" size="sm" icon="pencil" disabled={busy} onClick={() => setEdit({ ...b })}>{t("common.edit")}</Button>
            </div>}
          </section>
        ))}
      </div>
      <Drawer open={!!edit} onClose={() => setEdit(null)} title={edit?.isNew ? t("br.add") : edit?.name}
        footer={<><Button variant="outline" onClick={() => setEdit(null)}>{t("common.cancel")}</Button><Button disabled={busy || (edit?.name?.trim().length || 0) < 2} onClick={() => act(edit.isNew ? api.add(edit) : api.save(edit), () => setEdit(null))}>{t("common.save")}</Button></>}>
        {edit && <div className="pf-stack">
          <Field label={t("br.name")} hint={!edit.isNew ? "Renaming also renames it in everyone's access and on rooms." : undefined}><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. Pokhara Lakeside" /></Field>
          <Field label={t("bsettings.address")}><Input value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></Field>
          <Field label={t("common.phone")}><Input className="input tnum" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
          <Field label={t("br.manager")}><Select value={edit.manager} onChange={(v) => setEdit({ ...edit, manager: v })} options={[{ id: "", label: "Nobody yet" }, ...people.map((m) => ({ id: m.name, label: m.name }))]} /></Field>
          <Field label={t("brand.receiptHeader")}><Input value={edit.receipt} onChange={(e) => setEdit({ ...edit, receipt: e.target.value })} /></Field>
        </div>}
      </Drawer>
      <Confirm open={!!close} onClose={() => setClose(null)} danger={close?.status === "open"} onConfirm={() => act(api.setOpen(close, close.status !== "open"))}
        title={close ? t(close.status === "open" ? "br.closeTitle" : "br.reopenTitle", { name: close.name }) : ""} confirmLabel={close?.status === "open" ? t("br.close") : t("br.reopen")}>{t("br.closeText")}</Confirm>
      <Confirm open={!!del} onClose={() => setDel(null)} danger onConfirm={() => act(api.remove(del))} title={del ? `Delete ${del.name}?` : ""} confirmLabel={t("common.delete")}>
        People who also work at other branches keep those. A branch with rooms, or someone's only branch, can't be deleted.
      </Confirm>
    </>
  );
}
