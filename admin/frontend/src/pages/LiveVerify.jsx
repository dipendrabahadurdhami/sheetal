import React, { useEffect, useState } from "react";
import { fdatetime } from "@sheetal/shared/core/format";
import { Badge, Button, Empty, Textarea, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { adminApi } from "../api";
import { openPrivate } from "./LiveContent";

// Business verification on the admin API: businesses that sent documents; open each one, then verify the business
// (the Verified badge on the website), send it back with a reason, or reopen it so the business can change documents.

const KIND = { registration: "Company registration", pan: "PAN / VAT certificate", owner_id: "Owner's ID", other: "Other" };
const TONE = { pending: "action", verified: "done", rejected: "problem", none: "neutral" };
const WORD = { pending: "To check", verified: "Verified", rejected: "Sent back", none: "Reopened" };

export function LiveVerifications() {
  const toast = useToast();
  const [status, setStatus] = useState("pending");
  const [rows, setRows] = useState(null);
  const [notes, setNotes] = useState({});
  const [busy, setBusy] = useState(null);
  const load = () => adminApi("GET", `/admin/verifications?status=${status}`).then((r) => setRows(r.data)).catch((e) => { toast(e.message); setRows([]); });
  useEffect(() => { load(); }, [status]);
  const decide = (t, decision) => {
    setBusy(t.id);
    adminApi("POST", `/admin/verifications/${t.id}/review`, { decision, note: notes[t.id]?.trim() || undefined })
      .then((r) => { toast(r.message); load(); }).catch((e) => toast(e.message)).finally(() => setBusy(null));
  };
  return (
    <section className="card pf-panel"><div className="pf-pad">
      <div className="pf-chip-row" style={{ marginBottom: 12 }}>
        {[["pending", "To check"], ["verified", "Verified"], ["rejected", "Sent back"], ["all", "All"]].map(([id, label]) => (
          <button key={id} type="button" className={`chip ${status === id ? "active" : ""}`} aria-pressed={status === id} onClick={() => setStatus(id)}>{label}</button>
        ))}
      </div>
      {!rows ? <p className="muted">Loading…</p> : !rows.length ? <Empty icon="badge-check" title={status === "pending" ? "Nothing to check" : "None here"} sub={status === "pending" ? "Businesses that send documents appear here." : undefined} /> : (
        <div className="pf-stack">
          {rows.map((t) => (
            <div key={t.id} className="card pf-pad">
              <div className="pf-row-actions" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <div className="pf-two">
                  <b>{t.name}</b>
                  <small className="muted">{t.type} · {t.city || "—"}{t.pan ? ` · PAN ${t.pan}` : ""}{t.owner ? ` · ${t.owner.name} (${t.owner.email})` : ""}</small>
                  {t.sentAt && <small className="muted">Sent {fdatetime(t.sentAt)}</small>}
                </div>
                <Badge tone={TONE[t.status]}>{WORD[t.status] || t.status}</Badge>
              </div>
              <ul className="pf-doc-list" style={{ marginTop: 10 }}>{t.docs.map((d) => (
                <li key={d.id}><Icon name="file-text" size={16} /><span className="pf-two"><b>{KIND[d.kind] || d.kind}</b><small className="muted">{d.filename || "Document"}</small></span>
                  <Button size="sm" variant="ghost" onClick={() => openPrivate(`/admin/verifications/docs/${d.id}/file`, toast)}>Open</Button></li>
              ))}</ul>
              {t.note && <p className="small muted" style={{ margin: "8px 0 0" }}>Note: {t.note}</p>}
              <div className="pf-stack" style={{ marginTop: 10 }}>
                {t.status !== "verified" && <Textarea rows={2} value={notes[t.id] || ""} onChange={(e) => setNotes({ ...notes, [t.id]: e.target.value })} placeholder="Reason, if sending back: e.g. the PAN certificate is cut off." aria-label={`Note for ${t.name}`} />}
                <div className="pf-row-actions" style={{ justifyContent: "flex-start" }}>
                  {t.status === "pending" && <Button size="sm" icon="badge-check" disabled={busy === t.id} onClick={() => decide(t, "verify")}>Verify</Button>}
                  {t.status === "pending" && <Button size="sm" variant="outline" disabled={busy === t.id || !(notes[t.id] || "").trim()} onClick={() => decide(t, "reject")}>Send back</Button>}
                  {t.status !== "pending" && <Button size="sm" variant="ghost" disabled={busy === t.id} onClick={() => decide(t, "reopen")}>Reopen for changes</Button>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div></section>
  );
}
