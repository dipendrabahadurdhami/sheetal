// The bar shown on every page while Sheetal support has this business open (ACCESS.md section 12, point 4; roadmap stage 1.2).
// Where it fits: BusinessApp.jsx puts it in the Shell's banner slot. It shows only in a tab that holds a support-session token (@sheetal/sdk/support).
// How it works: GET /support/session every 30 seconds answers the business, the reason, read-only or not and the minutes left. "End session" calls
// POST /support/end, forgets the token and goes back to the admin panel. When the server says the session is over (401) the bar does the same by itself.
// Rules: the bar cannot be closed while the session is open. It never shows the token. The server enforces everything (read-only, the deny list, the time
// limit); this is only what the staff member sees.

import React, { useCallback, useEffect, useState } from "react";
import { bizApi } from "@sheetal/sdk/client";
import { clearSupportToken, supportToken } from "@sheetal/sdk/support";
import { Button, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";

/** Where the staff member lands when the session is over. */
const backToAdmin = (tenantId) => { window.location.href = tenantId ? `/admin/tenants/${tenantId}` : "/admin/tenants"; };

/** The words of the bar, kept apart so they can be tested. */
export function supportBannerText(s) {
  const left = s.minutesLeft <= 0 ? "ending now" : `${s.minutesLeft} min left`;
  return `You are viewing ${s.business || "this business"} as Sheetal support · ${s.reason} · ${s.readOnly ? "read-only" : "changes allowed and recorded"} · ${left}`;
}

export function SupportBanner({ tenantId, api = bizApi }) {
  const toast = useToast();
  const [session, setSession] = useState(null);
  const [busy, setBusy] = useState(false);
  const active = !!supportToken();

  const leave = useCallback((message) => {
    clearSupportToken();
    if (message) toast(message);
    backToAdmin(tenantId);
  }, [tenantId, toast]);

  const check = useCallback(() => {
    if (!supportToken()) return;
    api("GET", "/support/session").then(({ data }) => { if (data.active) setSession(data); else leave("The support session has ended."); })
      .catch((e) => { if (e.status === 401) leave("The support session has ended."); });
  }, [api, leave]);

  useEffect(() => {
    if (!active) return undefined;
    check();
    const every = setInterval(check, 30_000);
    return () => clearInterval(every);
  }, [active, check]);

  if (!active || !session) return null;
  const end = () => {
    setBusy(true);
    api("POST", "/support/end", {}).catch(() => { /* already over: leave anyway */ }).finally(() => leave("Support session ended."));
  };
  return (
    <div className="pf-imp" role="status">
      <Icon name="eye" size={16} /><span>{supportBannerText(session)}</span>
      <Button size="sm" variant="light" disabled={busy} onClick={end}>End session</Button>
    </div>
  );
}
