// Settings → Verification: send the company registration and PAN/VAT certificate to Sheetal for the Verified badge.
// Rules: the files stay private (only settings people here and Sheetal staff open them) and lock while checked.

import React, { useEffect, useState } from "react";
import { fdate, fdatetime } from "@sheetal/shared/core/format";
import { Badge, Button, Empty, PageHead, Panel, Select, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { bizApi, fileToBase64, formatBytes } from "../api";
import { workspacesReload } from "../live";

const KINDS = [["registration", "Company registration certificate"], ["pan", "PAN / VAT certificate"], ["owner_id", "Owner's ID (citizenship or passport)"], ["other", "Other document"]];
const kindName = (k) => KINDS.find(([id]) => id === k)?.[1] || k;
const STATUS = {
  none: ["neutral", "Not sent yet", "Add the documents below and send them to Sheetal."],
  pending: ["progress", "Being checked", "Sheetal usually checks documents within a working day. You'll get a notification."],
  verified: ["done", "Verified", "Your business is verified. A Verified badge shows on your agency page on the website."],
  rejected: ["action", "Needs changes", ""],
};

export function Verification({ tenant }) {
  const toast = useToast();
  const [v, setV] = useState(null);
  const [kind, setKind] = useState("registration");
  const [busy, setBusy] = useState(false);
  const load = () => bizApi("GET", "/verification").then((r) => setV(r.data)).catch((e) => toast(e.message));
  useEffect(() => { load(); }, [tenant.id]);
  if (!v) return <p className="muted pf-pad">Loading…</p>;
  const locked = v.status === "pending" || v.status === "verified";
  const have = new Set(v.docs.map((d) => d.kind));
  const missing = v.required.filter((k) => !have.has(k));
  const act = (p, after) => { setBusy(true); return p.then((r) => { if (r?.message) toast(r.message); after?.(); return load(); }).catch((e) => toast(e.message)).finally(() => setBusy(false)); };
  const upload = async (file) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return toast("Each document can be up to 10 MB.");
    act(bizApi("POST", "/verification/docs", { kind, filename: file.name, data: await fileToBase64(file) }));
  };
  // Opens a private document (the API needs the sign-in, so it is fetched, then shown).
  const open = async (d) => {
    try {
      const blob = await bizApi("GET", `/verification/docs/${d.id}/file`);
      window.open(URL.createObjectURL(blob), "_blank", "noopener");
    } catch (e) { toast(e.message); }
  };
  const [tone, word, text] = STATUS[v.status] || STATUS.none;
  return (
    <>
      <PageHead title="Verification" sub="Get the Verified badge on the website by sending your business documents to Sheetal. They stay private." />
      <div className={`pf-alert ${tone === "done" ? "done" : tone === "action" ? "action" : "progress"}`}>
        <Icon name={v.status === "verified" ? "badge-check" : v.status === "rejected" ? "circle-alert" : "shield-check"} size={18} />
        <div><b>{word}{v.status === "verified" && v.verifiedAt ? ` since ${fdate(v.verifiedAt)}` : ""}</b><span>{v.status === "rejected" ? `Sheetal says: ${v.note}` : text}</span></div>
        <Badge tone={tone}>{word}</Badge>
      </div>
      <Panel title="Documents" sub="A clear photo or PDF of each. Company registration and PAN/VAT certificate are needed; the owner's ID helps." pad>
        {!v.docs.length ? <Empty icon="file-text" title="No documents yet" sub="Add the company registration certificate and the PAN/VAT certificate." /> : (
          <ul className="pf-doc-list">{v.docs.map((d) => (
            <li key={d.id}>
              <Icon name="file-text" size={18} />
              <span className="pf-two"><b>{kindName(d.kind)}</b><small className="muted">{d.filename || "Document"} · {formatBytes(d.size)} · {fdatetime(d.at)}</small></span>
              <Button size="sm" variant="ghost" onClick={() => open(d)}>Open</Button>
              {!locked && <Button size="sm" variant="ghost" icon="trash-2" disabled={busy} onClick={() => act(bizApi("DELETE", `/verification/docs/${d.id}`))}>Remove</Button>}
            </li>
          ))}</ul>
        )}
        {!locked && <div className="pf-row-actions" style={{ justifyContent: "flex-start", marginTop: 12, flexWrap: "wrap" }}>
          <Select value={kind} onChange={setKind} options={KINDS.map(([id, label]) => ({ id, label }))} style={{ width: 300 }} aria-label="Document type" />
          <label className={`btn btn-outline ${busy ? "disabled" : ""}`}><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" hidden disabled={busy} onChange={(e) => { upload(e.target.files[0]); e.target.value = ""; }} /><Icon name="upload" size={16} />Add document</label>
        </div>}
      </Panel>
      {!locked && <div className="pf-row-actions" style={{ justifyContent: "flex-start" }}>
        <Button icon="send" disabled={busy || missing.length > 0} onClick={() => act(bizApi("POST", "/verification/submit"), workspacesReload)}>Send for verification</Button>
        {missing.length > 0 && <span className="small muted">Still needed: {missing.map(kindName).join(" and ")}.</span>}
      </div>}
    </>
  );
}
