// Approvals: the maker-checker inbox and the rules (ACCESS.md section 9; roadmap stage 1.2).
// Where it fits: /business/approvals (inbox) and /business/approvals/rules, opened from the person menu and from Settings → Approvals. Signed-in businesses only.
// How it works: GET /approvals?status=… answers the requests this person made or could decide, with `canDecide` / `canCancel` on each and `rulesOn`.
// Approve / Reject (with a note) / Cancel call the routes; the action then runs on the server as the person who asked. The Rules tab lists every action of
// the business's apps that can need a second person (GET /approvals/rules) with on/off and an amount limit (PUT /approvals/rules).
// Rules: nobody approves their own request (the server refuses; the buttons are not shown). In Phase 1 every rule starts off, and the empty inbox says so.
// A support session can look but not decide or change rules.

import React, { useCallback, useEffect, useState } from "react";
import { bizApi } from "@sheetal/sdk/client";
import { fdatetime } from "@sheetal/shared/core/format";
import { useRouter } from "@sheetal/shared/core/router";
import { Badge, Button, Empty, Field, Input, Modal, PageHead, Panel, Tabs, Textarea, Toggle, useToast } from "@sheetal/shared/core/ui";
import { STATUS_TONE, STATUS_WORDS, emptyInbox, ruleBody, ruleHint, rupees } from "../access/approvals";

export function Approvals({ tenant, tab = "pending", live = true, api = bizApi }) {
  const { navigate } = useRouter();
  const tabs = [{ id: "pending", label: "Waiting", icon: "clock" }, { id: "decided", label: "Decided", icon: "list-checks" }, { id: "rules", label: "Rules", icon: "settings" }];
  const go = (id) => navigate(id === "pending" ? "/business/approvals" : `/business/approvals/${id}`);
  return (
    <>
      <PageHead title="Approvals" sub="Actions that need a second person: one person asks, a different person approves, and only then it happens." />
      <Tabs value={tab} onChange={go} tabs={tabs} />
      {!live ? <Panel><Empty icon="shield-check" title="Sign in to use approvals">Approvals work on your real business, not on the sample workspace.</Empty></Panel>
        : tab === "rules" ? <Rules key={tenant?.id} api={api} /> : <Inbox key={`${tenant?.id}-${tab}`} status={tab} api={api} onRules={() => go("rules")} />}
    </>
  );
}

function Inbox({ status, api, onRules }) {
  const toast = useToast();
  const [state, setState] = useState({ loading: true });
  const [deciding, setDeciding] = useState(null);   // { row, kind: "approve" | "reject" }
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api("GET", `/approvals?status=${status}`).then(({ data }) => setState({ data })).catch((e) => setState({ error: e.message })), [api, status]);
  useEffect(() => { load(); }, [load]);

  const send = (row, kind, body) => {
    setBusy(true);
    return api("POST", `/approvals/${row.id}/${kind}`, body).then((r) => toast(r.message)).catch((e) => toast(e.message))
      .finally(() => { setBusy(false); setDeciding(null); setNote(""); load(); });
  };

  if (state.loading) return <Panel><p className="pf-pad small muted">Loading…</p></Panel>;
  if (state.error) return <Panel><Empty icon="circle-alert" title="Approvals could not be loaded" action={<Button size="sm" onClick={load}>Try again</Button>}>{state.error}</Empty></Panel>;
  const { rows, rulesOn } = state.data;
  if (!rows.length) {
    const e = emptyInbox({ rulesOn, status });
    return <Panel><Empty icon="shield-check" title={e.title} action={!rulesOn && status === "pending" ? <Button size="sm" variant="outline" onClick={onRules}>See the rules</Button> : null}>{e.text}</Empty></Panel>;
  }
  return (
    <>
      <Panel>
        <ul className="pf-list pf-approvals">
          {rows.map((r) => (
            <li key={r.id}>
              <div>
                <span><b>{r.label}</b>{r.amount !== null && <> · <span className="tnum">{rupees(r.amount)}</span></>} <Badge tone={STATUS_TONE[r.status] || "neutral"}>{STATUS_WORDS[r.status] || r.status}</Badge></span>
                <span className="small muted">Asked by {r.mine ? "you" : r.maker?.name || "someone"} · {fdatetime(r.createdAt)}{r.status === "pending" && r.expiresAt ? ` · waits until ${fdatetime(r.expiresAt)}` : ""}</span>
                {r.makerNote && <span className="small">Note: {r.makerNote}</span>}
                {r.checker && <span className="small muted">{STATUS_WORDS[r.status] || r.status} by {r.checker.name}{r.decidedAt ? ` · ${fdatetime(r.decidedAt)}` : ""}{r.checkerNote ? ` · "${r.checkerNote}"` : ""}</span>}
                {r.outcome && <span className="small muted">{r.outcome}</span>}
              </div>
              <div className="pf-row-actions">
                {r.canDecide && <><Button size="sm" disabled={busy} onClick={() => setDeciding({ row: r, kind: "approve" })}>Approve</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => setDeciding({ row: r, kind: "reject" })}>Reject</Button></>}
                {r.canCancel && <Button size="sm" variant="outline" disabled={busy} onClick={() => send(r, "cancel")}>Cancel my request</Button>}
                {r.status === "pending" && r.mine && !r.canCancel && <span className="small muted">Waiting for another person</span>}
              </div>
            </li>
          ))}
        </ul>
      </Panel>
      <Modal open={!!deciding} onClose={() => { setDeciding(null); setNote(""); }} title={deciding?.kind === "approve" ? "Approve this request?" : "Reject this request?"}
        footer={<><Button variant="outline" onClick={() => { setDeciding(null); setNote(""); }}>Back</Button><Button disabled={busy} className={deciding?.kind === "reject" ? "pf-danger" : undefined} onClick={() => send(deciding.row, deciding.kind, note.trim() ? { note: note.trim() } : {})}>{deciding?.kind === "approve" ? "Approve" : "Reject"}</Button></>}>
        {deciding && <>
          <p><b>{deciding.row.label}</b>{deciding.row.amount !== null ? ` · ${rupees(deciding.row.amount)}` : ""}, asked by {deciding.row.maker?.name || "someone"}.</p>
          <p className="small muted">{deciding.kind === "approve" ? "It will run straight away, in the name of the person who asked. Both of you are recorded." : "Nothing will happen, and the person who asked is told."}</p>
          <Field label="Note" optional><Textarea rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="A short reason (the other person sees it)" /></Field>
        </>}
      </Modal>
    </>
  );
}

function Rules({ api }) {
  const toast = useToast();
  const [state, setState] = useState({ loading: true });
  const [amounts, setAmounts] = useState({});
  const [busy, setBusy] = useState(null);
  const load = useCallback(() => api("GET", "/approvals/rules").then(({ data }) => { setState({ data }); setAmounts({}); }).catch((e) => setState({ error: e.message })), [api]);
  useEffect(() => { load(); }, [load]);
  const save = (rule, patch) => {
    setBusy(rule.action);
    return api("PUT", "/approvals/rules", ruleBody(rule, patch)).then((r) => toast(r.message)).catch((e) => toast(e.message)).finally(() => { setBusy(null); load(); });
  };

  if (state.loading) return <Panel><p className="pf-pad small muted">Loading…</p></Panel>;
  if (state.error) return <Panel><Empty icon="circle-alert" title="The rules could not be loaded" action={<Button size="sm" onClick={load}>Try again</Button>}>{state.error}</Empty></Panel>;
  const { rules, canEdit } = state.data;
  if (!rules.length) return <Panel><Empty icon="shield-check" title="No action needs approval yet">Your apps have no action that can ask for a second person. More arrive as apps are added.</Empty></Panel>;
  return (
    <Panel title="Which actions need a second person" sub={canEdit ? "Switch a rule on to hold that action until a different person approves it. Every rule is off until you switch it on." : "Only people who can change business settings can change these rules."}>
      <ul className="pf-list pf-approvals">
        {rules.map((r) => {
          const amount = amounts[r.action] ?? (r.thresholdRupees ?? "");
          const changed = String(amount) !== String(r.thresholdRupees ?? "");
          return (
            <li key={r.action}>
              <div>
                <span><b>{r.label}</b> {r.enabled ? <Badge tone="ok">On</Badge> : <Badge>Off</Badge>}</span>
                <span className="small muted">{ruleHint(r)}</span>
                <span className="small muted">{r.approvers} {r.approvers === 1 ? "person" : "people"} can approve this.</span>
              </div>
              <div className="pf-row-actions">
                {r.money && r.enabled && canEdit && <>
                  <Input type="number" min="0" step="1" inputMode="numeric" style={{ width: 130 }} aria-label={`From which amount (rupees): ${r.label}`} placeholder="Every time" value={amount} onChange={(e) => setAmounts((a) => ({ ...a, [r.action]: e.target.value }))} />
                  {changed && <Button size="sm" variant="outline" disabled={busy === r.action} onClick={() => save(r, { thresholdRupees: amount })}>Save amount</Button>}
                </>}
                <Toggle checked={r.enabled} disabled={!canEdit || r.required || busy === r.action} label={`${r.label}: approval ${r.enabled ? "on" : "off"}`} onChange={(v) => save(r, { enabled: v })} />
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
