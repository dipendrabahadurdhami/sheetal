// Admin → Inbox → Requests: upgrade requests from businesses, on the admin API (GET /admin/upgrades, PATCH /admin/upgrades/:id).
// Where it fits: AdminRequests (AdminGrowth.jsx) shows it when isStaffLive().
// How it works: lists pending, approved or declined requests; Approve starts the new plan today for the months asked
// (only after the payment is confirmed), Decline can carry a reason; the server tells the business either way.
// Rules: the server checks the staff role (plans.manage decides); the list refreshes after every decision.

import React, { useCallback, useEffect, useState } from "react";
import { fdate, rs } from "@sheetal/shared/core/format";
import { Badge, Button, Confirm, Empty, Field, Modal, PageHead, Seg, Table, Textarea, useToast } from "@sheetal/shared/core/ui";
import { adminApi } from "../api";
import { adminRefresh } from "../live";

const TYPE = { hotel: "Hotel", host: "Host", developer: "Developer", agency: "Agency", sponsor: "Sponsor" };
const TONE = { pending: "action", done: "done", declined: "neutral" };
const LABEL = { pending: "Waiting", done: "Approved", declined: "Declined" };

export function LiveUpgrades() {
  const toast = useToast();
  const [status, setStatus] = useState("pending");
  const [rows, setRows] = useState(null);
  const [approve, setApprove] = useState(null);
  const [decline, setDecline] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { setRows(null); adminApi("GET", `/admin/upgrades?status=${status}`).then((r) => setRows(r.data)).catch((e) => { setRows([]); toast(e.message); }); }, [status]);
  useEffect(() => { load(); }, [load]);

  const decide = async (r, body) => {
    setBusy(true);
    try { const res = await adminApi("PATCH", `/admin/upgrades/${r.id}`, body); toast(res.message); adminRefresh(); setApprove(null); setDecline(null); setNote(""); load(); }
    catch (e) { toast(e.message); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHead title="Upgrade requests" sub="Businesses asking for a bigger plan" actions={<Seg value={status} onChange={setStatus} options={[{ id: "pending", label: "Waiting" }, { id: "done", label: "Approved" }, { id: "declined", label: "Declined" }]} />} />
      {rows === null ? <p className="muted pf-pad">Loading…</p> : (
        <section className="card pf-panel"><Table rows={rows} minWidth={860}
          empty={<Empty icon="calendar-check" title={status === "pending" ? "No requests waiting" : "Nothing here"}>{status === "pending" ? "New requests show up here when a business asks to upgrade." : "Requests you handle are kept here."}</Empty>}
          columns={[
            { key: "b", label: "Business", render: (r) => <span className="pf-two"><b>{r.tenant?.name ?? "Removed business"}</b><small>{TYPE[r.tenant?.type] || r.tenant?.type || ""}</small></span> },
            { key: "w", label: "Asked by", render: (r) => <span className="pf-two"><b>{r.user?.userName ?? "—"}</b><small className="tnum">{r.user?.phone || r.user?.email || ""}</small></span> },
            { key: "p", label: "Plan asked for", render: (r) => <span className="pf-two"><b>{r.plan?.name ?? r.planId}</b><small className="tnum">{r.months} {r.months === 1 ? "month" : "months"}{r.plan?.price ? ` · ${rs(r.plan.price)} a month` : ""}</small></span> },
            { key: "d", label: "Asked on", num: true, render: (r) => fdate(r.createdAt) },
            { key: "s", label: "Status", render: (r) => <Badge tone={TONE[r.status] || "neutral"}>{LABEL[r.status] || r.status}</Badge> },
            { key: "a", label: "", align: "right", render: (r) => r.status === "pending" ? <span className="pf-row-actions"><Button size="sm" onClick={() => setApprove(r)}>Approve</Button><Button size="sm" variant="outline" onClick={() => { setNote(""); setDecline(r); }}>Decline</Button></span> : null },
          ]} /></section>
      )}
      <Confirm open={!!approve} onClose={() => setApprove(null)} onConfirm={() => decide(approve, { status: "done", apply: true })} title="Approve this upgrade?" confirmLabel={busy ? "Working…" : "Approve and change plan"}>
        {approve && <p>{approve.tenant?.name} moves to {approve.plan?.name ?? approve.planId} today for {approve.months} {approve.months === 1 ? "month" : "months"}. Only approve once the payment is confirmed. The business is told.</p>}
      </Confirm>
      <Modal open={!!decline} onClose={() => setDecline(null)} title="Decline this request" footer={<><Button variant="outline" onClick={() => setDecline(null)}>Cancel</Button><Button disabled={busy} onClick={() => decide(decline, { status: "declined", ...(note.trim() ? { note: note.trim() } : {}) })}>{busy ? "Working…" : "Decline"}</Button></>}>
        {decline && <Field label="Reason (the business sees it)" optional><Textarea rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: we haven't received the payment." /></Field>}
      </Modal>
    </>
  );
}
