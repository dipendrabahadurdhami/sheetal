// "Try the demo": a visitor who is not signed in gets a real, throw-away business instead of the old sample screens (FRONTEND-KIT.md section 8; stage 1.2).
// Where it fits: BusinessApp.jsx shows <TryDemo> on the pages that are on the screen kit (Expenses, Reviews) when nobody is signed in and the business API
// is connected, and <DemoBar> at the top of every page while a demo visitor is signed in.
// How it works: the button calls POST /demo/session { type }; the answer's token is stored exactly like a normal sign-in (localStorage "sheetal_token") and the
// panel reloads on the same page, now showing the demo business from the server. "End the demo" removes the token. The server deletes the demo after 24 hours.
// Rules: offered only when nobody is signed in (it would replace their sign-in). The demo can add expenses and reply to reviews; everything that reaches
// outside (invitations, email, payments, uploads) is switched off by the server and says so.

import React, { useState } from "react";
import { bizApi } from "@sheetal/sdk/client";
import { Button, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";

const TOKEN_KEY = "sheetal_token";
export const DEMO_EMAIL_END = "@demo.sheetal.invalid";
/** Is the signed-in person a demo visitor? (The server uses the same rule.) */
export const isDemoEmail = (email) => !!email && String(email).toLowerCase().endsWith(DEMO_EMAIL_END);

export function TryDemo({ type = "agency", page = "this page", api = bizApi }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const start = () => {
    setBusy(true);
    api("POST", "/demo/session", { type })
      .then((r) => { try { localStorage.setItem(TOKEN_KEY, r.data.token); } catch { /* storage off */ } window.location.reload(); })
      .catch((e) => { toast(e.message); setBusy(false); });
  };
  return (
    <div className="card pf-empty-card">
      <div className="pf-empty"><Icon name="play" size={40} strokeWidth={1.4} />
        <h3>Try {page} with a demo business</h3>
        <p>You get your own practice business with sample data. Add, change and delete freely: nothing is real, and it is deleted after 24 hours. No account or card needed.</p>
        <Button icon="play" disabled={busy} onClick={start}>{busy ? "Making your demo…" : "Try the demo"}</Button>
        <a className="link small" href="/">I already have an account: sign in on the website</a>
      </div>
    </div>
  );
}

/** The bar at the top while a demo visitor is signed in. */
export function DemoBar({ email }) {
  if (!isDemoEmail(email)) return null;
  const end = () => { try { localStorage.removeItem(TOKEN_KEY); } catch { /* storage off */ } window.location.href = "/"; };
  return (
    <div className="pf-branchbar" role="status">
      <span>This is a demo business with sample data. It is deleted after 24 hours. Inviting people, email, payments and uploads are switched off here.</span>
      <button onClick={end}>End the demo</button>
    </div>
  );
}
