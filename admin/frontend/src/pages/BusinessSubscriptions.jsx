// Admin → Businesses → one business → Subscriptions (MB 14.3, P3-FE-3): its app subscriptions with the access in force now, gifts and
// extensions, add-ons, the history and its app invoices; give a gift or extension (with an end date and a reason), take one back, extend a
// trial, gift Sheetal AI credits.
// Where it fits: /admin/tenants/:id/subscriptions (AdminApp.jsx), opened from the business page. Reading needs platform.business.read;
// gifts and trial extensions need platform.subscription.grant (the API checks and answers 403 otherwise).
// How it works: GET /admin/subscriptions/:tenantId; POST …/grants, …/grants/:id/revoke, …/:appId/extend-trial (with the subscription's version),
// …/ai-credits. Bodies come from pricingLogic.js and match the API's .strict() rules.
// Rules: every gift has a reason and an end date; nothing here charges or refunds money.

import React, { useEffect, useState } from "react";
import { fdate, fdatetime } from "@sheetal/shared/core/format";
import { Link } from "@sheetal/shared/core/router";
import { Badge, Button, Drawer, Empty, Field, Input, PageHead, Panel, Select, Table, Textarea, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { adminApi } from "../api";
import { aiCreditsBody, extendTrialBody, grantBody, reasonOk, revokeBody, rsPaisa, textOf } from "./pricingLogic";

const ACCESS_TONE = { full: "done", limited: "progress", read_only: "action", locked: "problem", none: "neutral" };
const inDays = (n) => { const d = new Date(Date.now() + n * 864e5); return d.toISOString().slice(0, 10); };

export function BusinessSubscriptions({ id }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null); // { type: "grant" | "trial" | "ai" | "revoke", ... }
  const [busy, setBusy] = useState(false);
  const load = () => adminApi("GET", `/admin/subscriptions/${id}`).then((r) => setData(r.data)).catch((e) => toast(e.message));
  useEffect(() => { load(); }, [id]);
  if (!data) return <p className="muted pf-pad">Loading subscriptions…</p>;
  const b = data.business;
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v?.target ? v.target.value : v }));
  const send = (path, body) => {
    setBusy(true);
    adminApi("POST", path, body).then((r) => { toast(r.message || "Done."); setForm(null); load(); }).catch((e) => toast(e.message)).finally(() => setBusy(false));
  };
  const submit = () => {
    if (form.type === "grant") send(`/admin/subscriptions/${id}/grants`, grantBody(form));
    else if (form.type === "trial") send(`/admin/subscriptions/${id}/${form.appId}/extend-trial`, extendTrialBody(form.days, form.reason, form.version));
    else if (form.type === "ai") send(`/admin/subscriptions/${id}/ai-credits`, aiCreditsBody(form.credits, form.days, form.reason));
    else if (form.type === "revoke") send(`/admin/subscriptions/${id}/grants/${form.grantId}/revoke`, revokeBody(form.reason));
  };
  const appIds = [...new Set(data.subscriptions.map((s) => s.appId))];

  return (
    <>
      <PageHead back={<Link to={`/admin/tenants/${id}`} className="pf-back"><Icon name="arrow-left" size={15} />{b.name}</Link>}
        title={`${b.name}: subscriptions`} sub={`Billing: ${b.billingMode === "apps" ? "per app" : b.billingMode === "shadow" ? "plan (new rules compared)" : "today's plan"} · ${b.status}`}
        actions={<>
          <Button variant="outline" icon="plus" onClick={() => setForm({ type: "grant", kind: "app", appId: appIds[0] || "", key: "", value: "", endsAt: inDays(30), reason: "" })}>Gift or extend</Button>
          <Button variant="outline" icon="sparkles" onClick={() => setForm({ type: "ai", credits: "100", days: "90", reason: "" })}>Gift AI credits</Button>
        </>} />
      {b.billingMode !== "apps" && <div className="pf-alert progress"><Icon name="info" size={18} /><div><b>This business is still on its plan</b><span>Its subscriptions below are for the move to apps; what it pays today is on the business page.</span></div></div>}

      <Panel title="Apps">
        <Table rows={data.subscriptions} minWidth={860} empty={<Empty icon="layout-grid" title="No app subscriptions" />} columns={[
          { key: "a", label: "App", render: (s) => <span className="pf-two"><b>{s.appId}</b><small>{s.editionId}{s.pendingEditionId ? ` → ${s.pendingEditionId} at period end` : ""}</small></span> },
          { key: "s", label: "Status now", render: (s) => <span className="pf-two"><Badge tone={ACCESS_TONE[s.now?.access] || "neutral"}>{s.now?.status || s.status} · {s.now?.access || "?"}</Badge>{s.uninstalledAt && <small>removed {fdate(s.uninstalledAt)}</small>}</span> },
          { key: "p", label: "Price", num: true, align: "right", render: (s) => (s.periodMonths ? `${rsPaisa(s.priceGrossPaisa)} / ${s.periodMonths === 12 ? "year" : "month"}${s.listPriceGrossPaisa !== s.priceGrossPaisa ? ` (list ${rsPaisa(s.listPriceGrossPaisa)})` : ""}` : "Free") },
          { key: "e", label: "Ends", num: true, render: (s) => (s.status === "trialing" ? `Trial to ${fdate(s.trialEndsAt)}` : s.currentPeriodEnd ? `${fdate(s.currentPeriodEnd)}${s.cancelAtPeriodEnd ? " (cancelled)" : ""}` : "—") },
          { key: "src", label: "From", render: (s) => s.source },
          { key: "x", label: "", align: "right", render: (s) => (s.status === "trialing" ? <Button size="sm" variant="outline" onClick={() => setForm({ type: "trial", appId: s.appId, version: s.version, days: "7", reason: "" })}>Extend trial</Button> : null) },
        ]} />
      </Panel>

      <Panel title="Gifts and extensions">
        <Table rows={data.grants} minWidth={760} empty={<Empty icon="plus" title="No gifts" />} columns={[
          { key: "k", label: "What", render: (g) => <span className="pf-two"><b>{g.kind}{g.appId ? ` · ${g.appId}` : ""}{g.key ? ` · ${g.key}` : ""}</b><small>{g.value == null ? (g.kind === "app" ? "whole app" : "unlimited") : g.value}</small></span> },
          { key: "r", label: "Reason", render: (g) => <span className="pf-two"><span>{g.reason}</span><small>{g.source}</small></span> },
          { key: "d", label: "Dates", num: true, render: (g) => `${fdate(g.startsAt)} – ${g.endsAt ? fdate(g.endsAt) : "no end"}` },
          { key: "s", label: "Status", render: (g) => <Badge tone={g.live ? "done" : "neutral"}>{g.revokedAt ? "Taken back" : g.live ? "In force" : "Not in force"}</Badge> },
          { key: "x", label: "", align: "right", render: (g) => (g.live && !g.revokedAt ? <Button size="sm" variant="ghost" onClick={() => setForm({ type: "revoke", grantId: g.id, reason: "" })}>Take back</Button> : null) },
        ]} />
      </Panel>

      <div className="pf-split">
        <Panel title="Add-ons" className="grow">
          <Table rows={data.addons} minWidth={420} empty={<Empty icon="puzzle" title="No add-ons" />} columns={[
            { key: "k", label: "Add-on", render: (a) => `${a.addonKey}${a.appId ? ` · ${a.appId}` : ""}` },
            { key: "q", label: "Qty", num: true, render: (a) => a.qty },
            { key: "p", label: "Unit price", num: true, align: "right", render: (a) => rsPaisa(a.unitPriceGrossPaisa) },
            { key: "e", label: "Until", num: true, render: (a) => fdate(a.currentPeriodEnd) },
          ]} />
        </Panel>
        <Panel title="History" className="side">
          {data.events.length ? <ul className="pf-list">{data.events.slice(0, 30).map((e) => <li key={e.id}><div className="pf-two" style={{ flex: 1 }}><b>{e.type.replace(/_/g, " ")} · {e.appId}</b><small>{fdatetime(e.at)}{e.amountPaisa != null ? ` · ${rsPaisa(e.amountPaisa)}` : ""}{e.reason ? ` · ${e.reason}` : ""}</small></div></li>)}</ul>
            : <Empty icon="history" title="Nothing yet" />}
        </Panel>
      </div>

      <Panel title="App invoices and credit notes">
        <Table rows={data.invoices} minWidth={680} empty={<Empty icon="receipt" title="No app invoices" />} columns={[
          { key: "n", label: "Number", render: (i) => <span className="pf-two"><b className="tnum">{i.number || (i.status === "open" ? "To pay" : "—")}</b><small>{i.lines.map((l) => textOf(l.description)).join(", ")}</small></span> },
          { key: "d", label: "Date", num: true, render: (i) => fdate(i.paidAt || i.createdAt) },
          { key: "t", label: "Total", num: true, align: "right", render: (i) => rsPaisa(i.totalPaisa) },
          { key: "s", label: "Status", render: (i) => <Badge tone={i.status === "paid" ? "done" : i.status === "open" ? "action" : "neutral"}>{i.kind === "credit" ? "credit note" : i.status}</Badge> },
        ]} />
      </Panel>

      <Drawer open={!!form} onClose={() => !busy && setForm(null)}
        title={form?.type === "grant" ? "Gift or extend" : form?.type === "trial" ? `Extend the ${form.appId} trial` : form?.type === "ai" ? "Gift Sheetal AI credits" : "Take the gift back"}
        footer={form && <><Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button><Button disabled={busy || !reasonOk(form.reason)} onClick={submit}>Save</Button></>}>
        {form && <div className="pf-stack">
          {form.type === "grant" && <>
            <Field label="What"><Select value={form.kind} onChange={set("kind")} options={[{ id: "app", label: "The whole app" }, { id: "limit", label: "A higher limit" }, { id: "feature", label: "A feature" }, { id: "seats", label: "Extra seats" }]} /></Field>
            {form.kind !== "seats" && <Field label="App (its id, e.g. hotel)"><Input value={form.appId} onChange={(e) => set("appId")(e.target.value.toLowerCase())} /></Field>}
            {(form.kind === "limit" || form.kind === "feature") && <Field label={form.kind === "limit" ? "Limit key (e.g. rooms)" : "Feature key"}><Input value={form.key} onChange={(e) => set("key")(e.target.value.toLowerCase())} /></Field>}
            {(form.kind === "limit" || form.kind === "seats") && <Field label={form.kind === "seats" ? "Seats" : "New limit (empty = unlimited)"}><Input type="number" min={0} value={form.value} onChange={set("value")} /></Field>}
            <Field label="Ends on (Nepal date)"><Input type="date" value={form.endsAt} onChange={set("endsAt")} /></Field>
          </>}
          {form.type === "trial" && <Field label="Extra days (1 to 30; at most 90 in all)"><Input type="number" min={1} max={30} value={form.days} onChange={set("days")} /></Field>}
          {form.type === "ai" && <>
            <Field label="Credits"><Input type="number" min={1} value={form.credits} onChange={set("credits")} /></Field>
            <Field label="Valid for (days)"><Input type="number" min={1} max={366} value={form.days} onChange={set("days")} /></Field>
          </>}
          <Field label="Reason (5 to 300 characters; the business's history and the audit keep it)"><Textarea rows={2} maxLength={300} value={form.reason} onChange={set("reason")} /></Field>
        </div>}
      </Drawer>
    </>
  );
}
