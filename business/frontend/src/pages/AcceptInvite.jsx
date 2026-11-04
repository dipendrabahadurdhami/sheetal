// The page a team invitation link opens (/business/accept-invite?token=…).
// How it works: shows which business and role the invitation is for; the invited person signs in on the website
// with that email, then accepts here.
// Rules: the link only works for the invited email, once, within 7 days.

import React, { useEffect, useState } from "react";
import { Button, Empty } from "@sheetal/shared/core/ui";
import { config } from "@sheetal/shared/core/config";
import { bizApi, bizApiReady, signedIn } from "../api";

export function AcceptInvite() {
  const token = new URLSearchParams(window.location.search).get("token") || "";
  const [inv, setInv] = useState(null);
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!bizApiReady()) { setErr("Invitations can't be opened here yet."); return; }
    bizApi("GET", `/invites/preview?token=${encodeURIComponent(token)}`).then((r) => setInv(r.data)).catch((e) => setErr(e.message));
  }, [token]);

  const accept = () => {
    setBusy(true);
    bizApi("POST", "/invites/accept", { token }).then((r) => setDone(r.message)).catch((e) => setErr(e.message)).finally(() => setBusy(false));
  };
  const role = inv?.role ? inv.role.replace(/_/g, " ") : "";

  return (
    <main className="pf-accept">
      <div className="card pf-pad pf-stack" style={{ maxWidth: 480, margin: "10vh auto", textAlign: "center" }}>
        <img src={config.logo} alt="Sheetal Property" style={{ height: 34, margin: "0 auto" }} />
        {err ? <Empty icon="circle-alert" title="This invitation can't be used">{err}</Empty>
          : !inv ? <p className="muted">Opening your invitation…</p>
          : done ? <Empty icon="party-popper" title={done} action={<a className="btn btn-primary" href="/business">Open {inv.business}</a>}>You're now part of the team.</Empty>
          : <>
            <h1 style={{ fontSize: 22, margin: 0 }}>Join {inv.business}</h1>
            <p className="muted" style={{ margin: 0 }}>You've been invited as <b>{role}</b>. The invitation is for <b>{inv.email}</b>.</p>
            {signedIn()
              ? <Button disabled={busy} onClick={accept}>{busy ? "Joining…" : `Join ${inv.business}`}</Button>
              : <><a className="btn btn-primary" href="/">Sign in or create an account</a><p className="small muted" style={{ margin: 0 }}>Use {inv.email}, then open this link again.</p></>}
          </>}
      </div>
    </main>
  );
}
