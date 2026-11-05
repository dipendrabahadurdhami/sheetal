// Settings → Listings: the property code prefix (ER-0123). Shown only when signed in; sample workspaces don't have it.
// Where it fits: inside the Listings tab of BusinessSettings.jsx. The server gives all listings the new code at once.

import React, { useEffect, useState } from "react";
import { Button, Field, Input, useToast } from "@sheetal/shared/core/ui";
import { bizApi } from "../api";

export function CodePrefix({ tenantId }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [v, setV] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => bizApi("GET", "/listings/code-prefix").then((r) => { setD(r.data); setV(r.data.prefix); }).catch(() => setD(false));
  useEffect(() => { load(); }, [tenantId]);
  if (!d) return null;
  const next = v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
  const ok = /^[A-Z][A-Z0-9]{1,4}$/.test(next) && next !== d.prefix;
  const save = () => {
    if (!window.confirm(`Change every listing code to start with ${next}-? Old codes keep working on the website.`)) return;
    setBusy(true);
    bizApi("PUT", "/listings/code-prefix", { prefix: next }).then((r) => { toast(r.message); load(); }).catch((e) => toast(e.message)).finally(() => setBusy(false));
  };
  return (
    <Field label="Property code" hint={`Your listings' codes look like ${next && /^[A-Z]/.test(next) ? `${next}-0123` : d.sample}. ${d.custom ? "" : `Made from your business name (${d.suggested}). `}Tenants and buyers use it to find a property.`}>
      <div className="pf-row-actions">
        <Input className="input" style={{ width: 120, textTransform: "uppercase" }} value={v} disabled={!d.canChange} maxLength={5} onChange={(e) => setV(e.target.value)} aria-label="Code prefix" />
        {d.canChange && <Button variant="outline" disabled={!ok || busy} onClick={save}>Save prefix</Button>}
      </div>
    </Field>
  );
}
