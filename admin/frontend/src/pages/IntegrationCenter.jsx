// The Integration Center: every outside service in one place (INTEGRATIONS.md section 7; roadmap stage 1.3).
// Where it fits: Admin → Setup center (/admin/integrations and /admin/integrations/:id) when the admin panel is signed in to the admin API. It replaces the
// old sample screen (AdminIntegrations.jsx, still shown when not signed in) and the three old live cards (LiveIntegrations.jsx).
// How it works: GET /admin/integrations lists every integration with its state, health and steps. One connection's page shows the steps, the details form
// (Test details and Live details apart when the provider has both), the buttons the state allows (Test, Go live, Pause, Resume, Apply, Disconnect), the last
// tests, and the help guide beside it. Everything is decided by the server; this screen only shows and asks.
// Rules: a secret field is write-only: it shows "Saved" and a box to replace it, never the value. A change to a live connection waits and is tested before it
// replaces what is live. A connection without its code yet ("Coming soon") can be filled in now.

import React, { useCallback, useEffect, useState } from "react";
import { fdatetime } from "@sheetal/shared/core/format";
import { Link } from "@sheetal/shared/core/router";
import { Badge, Button, Confirm, Empty, Field, Input, Modal, PageHead, Panel, Select, Tabs, Textarea, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { adminApi } from "../api";
import { GROUPS, actionsOf, badgeOf, countLive, hasSecret, saveBody, tabsOf } from "./integrationWords";

function useLoad(path, api) {
  const [state, setState] = useState({ loading: true });
  const load = useCallback(() => api("GET", path).then((r) => setState({ data: r.data, meta: r.meta })).catch((e) => setState({ error: e.message })), [api, path]);
  useEffect(() => { load(); }, [load]);
  return [state, load, setState];
}

export function IntegrationCenter({ id, api = adminApi }) {
  return id ? <Detail key={id} id={id} api={api} /> : <List api={api} />;
}

function List({ api }) {
  const [state, load] = useLoad("/admin/integrations", api);
  if (state.loading) return <><PageHead title="Setup center" sub="Every outside service Sheetal uses." /><Panel><p className="pf-pad small muted">Loading…</p></Panel></>;
  if (state.error) return <><PageHead title="Setup center" /><Panel><Empty icon="circle-alert" title="The connections could not be loaded" action={<Button size="sm" onClick={load}>Try again</Button>}>{state.error}</Empty></Panel></>;
  const rows = state.data;
  return (
    <>
      <PageHead title="Setup center" sub={`Every outside service in one place: enter the details, test, go live. ${countLive(rows)} of ${rows.length} are live.`} />
      {GROUPS.map(([group, title]) => {
        const mine = rows.filter((r) => r.spec.group === group);
        if (!mine.length) return null;
        return (
          <section key={group} className="pf-stack" aria-label={title}>
            <h2 className="pf-int-group">{title}</h2>
            <div className="pf-int-grid">
              {mine.map((r) => {
                const b = badgeOf(r.connection);
                return (
                  <Link key={r.spec.id} to={`/admin/integrations/${r.spec.id}`} className="card pf-int-card">
                    <div className="pf-int-top"><Icon name={r.spec.icon} size={18} /><b>{r.spec.name.en}</b><Badge tone={b.tone}>{b.label}</Badge></div>
                    <p className="small muted">{r.spec.note?.en || (!r.spec.built ? "Coming soon. Its details can be saved now." : r.connection.state === "live" ? (r.connection.health.message || "Working.") : "Enter the details, test, then go live.")}</p>
                    <ol className="pf-setup-steps">{r.steps.map((s, i) => <li key={s.id} className={s.done ? "done" : s.wait ? "wait" : ""}><span>{s.done ? <Icon name="check" size={12} /> : i + 1}</span>{s.label.en}</li>)}</ol>
                    <span className="pf-int-open">Open<Icon name="arrow-right" size={14} /></span>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </>
  );
}

function Detail({ id, api }) {
  const toast = useToast();
  const [state, load, setState] = useLoad(`/admin/integrations/${id}`, api);
  const [guide] = useLoad(`/admin/integrations/${id}/guide`, api);
  const [log, loadLog] = useLoad(`/admin/integrations/${id}/log`, api);
  const [tab, setTab] = useState(null);
  const [typed, setTyped] = useState({});
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(null);
  const [checks, setChecks] = useState(null);
  const [pausing, setPausing] = useState(false);
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(null);     // "golive" | "disconnect"
  const back = <Link to="/admin/integrations" className="btn btn-outline"><Icon name="arrow-left" size={16} />Setup center</Link>;

  if (state.loading) return <><PageHead title="Connection" actions={back} /><Panel><p className="pf-pad small muted">Loading…</p></Panel></>;
  if (state.error) return <><PageHead title="Connection" actions={back} /><Panel><Empty icon="circle-alert" title="This connection could not be loaded" action={<Button size="sm" onClick={load}>Try again</Button>}>{state.error}</Empty></Panel></>;

  const row = state.data;
  const { spec, connection: c } = row;
  const canManage = !!state.meta?.canManage;
  const can = actionsOf(row, canManage);
  const tabs = tabsOf(row);
  const active = tabs.find((t) => t.id === tab && t.open) || tabs.find((t) => t.open) || tabs[0];
  const liveNow = c.state === "live" || c.state === "paused";
  const shown = liveNow && c.stagedConfig ? c.stagedConfig : active.id === "live" && !liveNow && c.stagedConfig ? { ...c.config, ...c.stagedConfig } : c.config;
  const b = badgeOf(c);

  // One action = one call; the answer carries the fresh view, so the page never guesses.
  const run = (name, method, path, body, after) => {
    setBusy(name); setErrors({});
    return api(method, path, body)
      .then((r) => { toast(r.message); if (r.data?.checks) setChecks(r.data.checks); if (r.data?.connection) setState((s) => ({ ...s, data: { spec: r.data.spec, connection: r.data.connection, steps: r.data.steps, stagedTested: r.data.stagedTested } })); after?.(); loadLog(); })
      .catch((e) => { if (e.errors) setErrors(e.errors); toast(e.message); if (e.code === "version_conflict") load(); })
      .finally(() => setBusy(null));
  };
  const save = () => run("save", "PUT", `/admin/integrations/${id}`, saveBody(spec, typed, active.id, c.version), () => { setTyped({}); setChecks(null); });
  const dirty = Object.keys(saveBody(spec, typed, active.id).values).length > 0;

  return (
    <>
      <PageHead title={spec.name.en} sub={spec.note?.en || (spec.built ? "Enter the details, test them, then go live." : "Coming soon. You can save the details now; nothing needs typing again later.")} actions={back} />
      <div className="pf-int-detail">
        <div className="pf-stack">
          <section className="card pf-panel pf-pad">
            <div className="pf-int-top"><b>Progress</b><Badge tone={b.tone}>{b.label}</Badge></div>
            <ol className="pf-setup-steps">{row.steps.map((s, i) => <li key={s.id} className={s.done ? "done" : s.wait ? "wait" : ""}><span>{s.done ? <Icon name="check" size={12} /> : s.wait ? <Icon name="clock" size={12} /> : i + 1}</span>{s.label.en}</li>)}</ol>
            {c.state === "paused" && c.pauseReason && <p className="pf-hint"><Icon name="info" size={13} />Paused: {c.pauseReason}</p>}
            {c.state === "live" && c.health.status !== "healthy" && c.health.message && <p className="pf-hint"><Icon name="circle-alert" size={13} />{c.health.message}{c.health.checkedAt ? ` (checked ${fdatetime(c.health.checkedAt)})` : ""}</p>}
          </section>

          <Panel title="Details" sub={liveNow ? "This connection is live. A change here waits: test it, then apply it. What is live now is not touched until then." : undefined} pad>
            {tabs.length > 1 && <Tabs value={active.id} onChange={(v) => { setTab(v); setTyped({}); setErrors({}); }} tabs={tabs.map((t) => ({ id: t.id, label: t.open ? t.label : `${t.label} (after a passing test)` }))} />}
            <div className="pf-form-stack">
              {spec.fields.filter((f) => !f.secret || !f.modes || f.modes.includes(active.id)).map((f) => {
                const err = errors[f.key]?.[0];
                const value = typed[f.key] ?? (f.secret ? "" : shown[f.key] ?? "");
                const saved = f.secret && hasSecret(c, f.key, active.id);
                const set = (v) => setTyped((t) => ({ ...t, [f.key]: v }));
                return (
                  <Field key={f.key} label={f.label.en} optional={!f.required} error={err} hint={f.secret ? (saved ? "Saved. Type a new value to replace it. It is never shown again." : "Stored sealed. It is never shown again.") : f.help?.en}>
                    {f.options ? <Select value={value} disabled={!can.save || !active.open} onChange={set} options={f.options} />
                      : <Input type={f.secret ? "password" : "text"} autoComplete="off" value={value} disabled={!can.save || !active.open} placeholder={saved ? "••••••••••••" : ""} maxLength={f.maxLength || 500} onChange={(e) => set(e.target.value)} />}
                  </Field>
                );
              })}
            </div>
            {canManage ? (
              <div className="pf-row-actions" style={{ justifyContent: "flex-start", flexWrap: "wrap", marginTop: 14 }}>
                <Button disabled={!dirty || !can.save || !active.open || !!busy} onClick={save}>{liveNow ? "Save as a waiting change" : "Save"}</Button>
                {can.test && !can.testStaged && <Button variant="outline" icon="plug" disabled={!!busy || dirty} onClick={() => run("test", "POST", `/admin/integrations/${id}/test`)}>{busy === "test" ? "Testing…" : c.state === "live" ? "Check it now" : "Test"}</Button>}
                {can.testStaged && <Button variant="outline" icon="plug" disabled={!!busy || dirty} onClick={() => run("test", "POST", `/admin/integrations/${id}/test?staged=1`)}>{busy === "test" ? "Testing…" : "Test the waiting change"}</Button>}
                {can.apply && <Button disabled={!!busy} onClick={() => run("apply", "POST", `/admin/integrations/${id}/apply`)}>Apply the change</Button>}
                {can.goLive && <Button icon="check" disabled={!!busy || dirty} onClick={() => setConfirm("golive")}>Go live</Button>}
                {can.pause && <Button variant="outline" disabled={!!busy} onClick={() => setPausing(true)}>Pause</Button>}
                {can.resume && <Button disabled={!!busy} onClick={() => run("resume", "POST", `/admin/integrations/${id}/resume`)}>Resume</Button>}
                {can.disconnect && <Button variant="outline" className="pf-danger" disabled={!!busy} onClick={() => setConfirm("disconnect")}>Disconnect</Button>}
              </div>
            ) : <p className="pf-hint"><Icon name="lock" size={13} />Your staff role can see connections but not change them.</p>}
            {checks && <ul className="pf-list" style={{ marginTop: 12 }}>{checks.map((k, i) => <li key={i}><Badge tone={k.ok ? "ok" : "danger"}>{k.ok ? "Passed" : "Failed"}</Badge><span><b>{k.name}</b>: {k.message}</span></li>)}</ul>}
          </Panel>

          <Panel title="Last tests" sub="The newest first. Messages never contain a key.">
            {!log.data?.length ? <p className="pf-pad small muted">No test has run yet.</p> : (
              <ul className="pf-list">{log.data.slice(0, 10).map((l) => (
                <li key={l.id}><Badge tone={l.ok ? "ok" : "danger"}>{l.ok ? "Passed" : "Failed"}</Badge>
                  <span className="small">{fdatetime(l.at)} · {l.kind === "health" ? "health check" : l.kind === "go_live" ? "live check" : l.kind === "staged_test" ? "waiting change" : "test"} · {l.mode}{(l.checks || []).filter((k) => !k.ok).map((k) => ` · ${k.name}: ${k.message}`).join("")}</span></li>
              ))}</ul>
            )}
          </Panel>
        </div>

        <Panel title={guide.data?.title || "How to connect"} pad>
          {guide.loading ? <p className="small muted">Loading…</p> : !guide.data?.steps?.length ? <p className="small muted">No guide yet.</p> : (
            <ol className="pf-guide">{guide.data.steps.map((s, i) => (
              <li key={i}><b>{s.title}</b><p className="small">{s.body}</p>
                {(s.links || []).map((l) => <a key={l.url} className="link small" href={l.url} target="_blank" rel="noopener noreferrer">{l.label}<Icon name="external-link" size={12} /></a>)}</li>
            ))}</ol>
          )}
        </Panel>
      </div>

      <Modal open={pausing} onClose={() => setPausing(false)} title={`Pause ${spec.name.en}?`}
        footer={<><Button variant="outline" onClick={() => setPausing(false)}>Back</Button><Button disabled={reason.trim().length < 5 || !!busy} onClick={() => run("pause", "POST", `/admin/integrations/${id}/pause`, { reason: reason.trim() }, () => { setPausing(false); setReason(""); })}>Pause</Button></>}>
        <p className="small muted">It stops being used at once. The details are kept, and Resume switches it back on.</p>
        <Field label="Reason" hint="At least 5 characters. Saved in the audit log."><Textarea rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Modal>
      <Confirm open={confirm === "golive"} onClose={() => setConfirm(null)} onConfirm={() => run("golive", "POST", `/admin/integrations/${id}/go-live`)} title={`Switch ${spec.name.en} on?`} confirmLabel="Go live">
        {spec.modes.includes("test") ? "The live details are checked once more with the provider. If they pass, real use starts now." : "Real use starts now."}
      </Confirm>
      <Confirm open={confirm === "disconnect"} onClose={() => setConfirm(null)} onConfirm={() => run("disconnect", "DELETE", `/admin/integrations/${id}`, undefined, () => setTyped({}))} danger title={`Disconnect ${spec.name.en}?`} confirmLabel="Disconnect">
        Its keys are deleted and it stops being used. The test log is kept. This cannot be undone: to connect again you type the keys again.
      </Confirm>
    </>
  );
}
