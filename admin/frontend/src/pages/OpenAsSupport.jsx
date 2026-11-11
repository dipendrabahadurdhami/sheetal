// "Open as support": a Sheetal staff member opens a business's panel to see what the business sees (ACCESS.md section 12; roadmap stage 1.2).
// Where it fits: the button on Admin → Businesses → one business (AdminTenants.jsx), when the admin panel is signed in to the admin API.
// How it works: the staff member types their password again, a reason (10 to 300 characters, saved in both audit logs and sent to the business's owners)
// and how long (5 to 30 minutes). POST /admin/businesses/:id/impersonate answers a session token; the screen then shows one link that opens the
// business panel in a new tab with the token in the address fragment (@sheetal/sdk/support), where a bar shows the session and "End session".
// Rules: read-only. Write mode is not offered on this screen. The password is sent once and never kept. The token is never shown or stored here.

import React, { useState } from "react";
import { supportLink } from "@sheetal/sdk/support";
import { Button, Field, Input, Modal, Select, Textarea } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { adminApi } from "../api";

const MINUTES = [5, 10, 15, 30].map((m) => ({ id: String(m), label: `${m} minutes` }));

/** The reason rule of the server (10 to 300 characters), so the button explains itself before the call. */
export const reasonProblem = (reason) => {
  const n = reason.trim().length;
  if (n < 10) return "Write at least 10 characters: why are you opening this business?";
  if (n > 300) return "Keep the reason under 300 characters.";
  return null;
};

export function OpenAsSupport({ business, open, onClose, api = adminApi }) {
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [minutes, setMinutes] = useState("15");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(null);   // { link, message }
  const close = () => { setPassword(""); setReason(""); setError(null); setReady(null); onClose(); };
  const problem = reasonProblem(reason);
  const start = () => {
    setBusy(true); setError(null);
    api("POST", `/admin/businesses/${business.id}/impersonate`, { password, reason: reason.trim(), minutes: Number(minutes) })
      .then((r) => { setPassword(""); setReady({ link: supportLink(r.data.token), message: r.message }); })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <Modal open={open} onClose={close} title={`Open ${business.name} as support`}
      footer={ready
        ? <><Button variant="outline" onClick={close}>Close</Button><a className="btn btn-primary" href={ready.link} target="_blank" rel="noopener noreferrer" onClick={close}><Icon name="external-link" size={15} />Open the business panel</a></>
        : <><Button variant="outline" onClick={close}>Cancel</Button><Button disabled={busy || !password || !!problem} onClick={start}>Start read-only session</Button></>}>
      {ready ? (
        <>
          <p><b>{ready.message}</b></p>
          <p className="small muted">The business panel opens in a new tab with a bar at the top. Press "End session" there when you are done. The owners of the business are told now.</p>
        </>
      ) : (
        <>
          <p className="small muted">You will see what this business sees, read-only. The reason is saved in the audit log and the owners of the business get a notice and an email.</p>
          <Field label="Reason" hint="For example a ticket number and what you need to check." error={reason && problem ? problem : undefined}>
            <Textarea rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Field label="How long"><Select value={minutes} onChange={setMinutes} options={MINUTES} /></Field>
          <Field label="Your password again" hint="A fresh check that it is you."><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          {error && <p className="pf-hint" role="alert"><Icon name="circle-alert" size={13} />{error}</p>}
        </>
      )}
    </Modal>
  );
}
