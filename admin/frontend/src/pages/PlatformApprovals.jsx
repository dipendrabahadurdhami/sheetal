// Admin → Approvals (P3-FE-3; maker-checker from P3-BE-7): requests a staff member made that another one must approve — a price rise with paying
// customers, a refund. The maker never decides their own; each request lasts 72 hours.
// Where it fits: /admin/approvals (AdminApp.jsx), linked from Pricing. The API only lists the kinds the person may decide.
// How it works: GET /admin/approvals?status=pending|done, POST /admin/approvals/:id/decide { decision, note } (pricingLogic.decideBody).
// Rules: a note of 3 or more characters is required either way; a request decided twice answers 409.

import React, { useEffect, useState } from "react";
import { fdate, fdatetime } from "@sheetal/shared/core/format";
import { Badge, Button, Drawer, Empty, Field, PageHead, Panel, Seg, Table, Textarea, useToast } from "@sheetal/shared/core/ui";
import { adminApi } from "../api";
import { decideBody, rsPaisa } from "./pricingLogic";

export function PlatformApprovals() {
  const toast = useToast();
  const [status, setStatus] = useState("pending");
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => adminApi("GET", `/admin/approvals?status=${status}`).then((r) => setRows(r.data)).catch((e) => { setRows([]); toast(e.message); });
  useEffect(() => { setRows(null); load(); }, [status]);
  const decide = (decision) => {
    setBusy(true);
    adminApi("POST", `/admin/approvals/${open.id}/decide`, decideBody(decision, note)).then((r) => { toast(r.message || "Done."); setOpen(null); setNote(""); load(); })
      .catch((e) => { toast(e.message); if (e.status === 409) { setOpen(null); load(); } }).finally(() => setBusy(false));
  };
  return (
    <>
      <PageHead title="Approvals" sub="A second staff member checks price rises with paying customers and refunds. You can't approve your own request."
        actions={<Seg label="Show" value={status} onChange={setStatus} options={[{ id: "pending", label: "Waiting" }, { id: "done", label: "Decided" }]} />} />
      <Panel>
        {!rows ? <p className="muted pf-pad">Loading…</p> : (
          <Table rows={rows} minWidth={760} empty={<Empty icon="shield-check" title={status === "pending" ? "Nothing waiting" : "Nothing decided yet"} />} columns={[
            { key: "w", label: "Request", render: (r) => <span className="pf-two"><b>{r.label}</b><small>{r.makerNote}</small></span> },
            { key: "m", label: "Asked by", render: (r) => `${r.maker || "—"} · ${fdate(r.createdAt)}` },
            { key: "a", label: "Amount", num: true, align: "right", render: (r) => (r.amountPaisa != null ? rsPaisa(r.amountPaisa) : "—") },
            { key: "s", label: "Status", render: (r) => <Badge tone={r.status === "pending" ? "action" : r.status === "approved" || r.status === "executed" ? "done" : "neutral"}>{r.status}</Badge> },
            { key: "x", label: "", align: "right", render: (r) => (r.mayDecide ? <Button size="sm" onClick={() => setOpen(r)}>Decide</Button> : r.status === "pending" ? <span className="small muted">Yours: another person decides</span> : <span className="small muted">{r.checker ? `by ${r.checker}` : ""}</span>) },
          ]} />
        )}
      </Panel>
      <Drawer open={!!open} onClose={() => !busy && setOpen(null)} title={open?.label || ""} sub={open ? `Asked by ${open.maker} · ends ${fdatetime(open.expiresAt)}` : ""}
        footer={open && <><Button variant="outline" disabled={busy || note.trim().length < 3} onClick={() => decide("reject")}>Reject</Button><Button disabled={busy || note.trim().length < 3} onClick={() => decide("approve")}>Approve</Button></>}>
        {open && <div className="pf-stack">
          <p style={{ margin: 0 }}>{open.makerNote}</p>
          {open.payload?.reason && <p className="small muted" style={{ margin: 0 }}>Reason given: {open.payload.reason}</p>}
          <Field label="Your note (3 characters or more)"><Textarea rows={3} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>}
      </Drawer>
    </>
  );
}
