// System status in the sample workspace.
// Where it fits: signed in, LiveStatus and LiveOutbox (LiveSetup.jsx) show real data from the admin API instead.
// How it works: shows "Waiting for data" rather than made-up numbers.

import React from "react";
import { useStore } from "@sheetal/shared/core/store";
import { Badge, PageHead, Panel, Stat, Table } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { integrationsOf } from "@sheetal/shared/data/integrations";

const STATE = { up: ["Working", "done"], slow: ["Slow", "progress"], down: ["Down", "problem"], off: ["Not set up", "neutral"], wait: ["Waiting for data", "neutral"] };

export function AdminStatus() {
  const { db } = useStore();
  const x = integrationsOf(db);
  const services = [
    { id: "api", name: "API", what: "Website, business and admin requests", state: "wait", ms: null, uptime: "—" },
    { id: "db", name: "Database (PostgreSQL)", what: "Listings, accounts, leads, money", state: "wait", ms: null, uptime: "—" },
    { id: "cache", name: "Cache (Redis)", what: "Fast pages, sessions, rate limits", state: "wait", ms: null, uptime: "—" },
    { id: "jobs", name: "Background jobs", what: "Emails, alerts, renewals, sitemap", state: "wait", ms: null, uptime: "—" },
    { id: "files", name: "Photo storage and CDN", what: "Property photos", state: "wait", ms: null, uptime: "—" },
    { id: "mail", name: "Email worker (Cloudflare)", what: "Incoming mail to the inbox", state: x.email.worker.deployed ? "up" : "off", ms: null, uptime: x.email.worker.deployed ? "100%" : "—" },
    { id: "wa", name: "WhatsApp", what: x.whatsapp.mode === "qr" ? "Linked phone" : "Cloud API", state: x.whatsapp.webhookOk || x.whatsapp.qr.state === "linked" ? "up" : "off", ms: null, uptime: "—" },
    { id: "voice", name: "Voice call server", what: "AI voice assistant calls", state: x.ai.workerOk ? "up" : "off", ms: null, uptime: "—" },
    { id: "ai", name: "AI model", what: "Every AI feature", state: x.ai.tested ? "up" : "off", ms: null, uptime: "—" },
  ];
  const down = services.filter((s) => s.state === "down" || s.state === "slow").length;
  const jobs = [
    { id: "j1", name: "Rebuild sitemap", every: "Daily 02:00", last: "—", result: null, note: "" },
    { id: "j2", name: "Plan renewals and grace period", every: "Hourly", last: "—", result: null, note: "" },
    { id: "j3", name: "Check customer domain DNS", every: "Every 10 min", last: "—", result: null, note: "" },
    { id: "j4", name: "Scheduled social posts", every: "Every minute", last: "—", result: null, note: "" },
    { id: "j5", name: "WhatsApp alerts", every: "On each event", last: "—", result: null, note: "" },
    { id: "j6", name: "Database backup", every: "Daily 03:00", last: "—", result: null, note: "" },
  ];
  const errors = [];
  return (
    <>
      <PageHead title="System status" sub={down ? `${down} service needs attention` : "Everything is working"} />
      <div className="pf-stats">
        <Stat label="API speed (average)" value="—" note="Waiting for data" />
        <Stat label="Cache hits" value="—" note="Waiting for data" />
        <Stat label="Errors (24 h)" value="—" note="Waiting for data" />
        <Stat label="Bots filtered (24 h)" value="—" note="Google and Bing allowed" />
      </div>
      <Panel title="Services">
        <Table rows={services} minWidth={720} columns={[
          { key: "n", label: "Service", render: (s) => <span className="pf-two"><b>{s.name}</b><small>{s.what}</small></span> },
          { key: "s", label: "Status", render: (s) => <Badge tone={STATE[s.state][1]}>{STATE[s.state][0]}</Badge> },
          { key: "ms", label: "Response", num: true, align: "right", render: (s) => (s.ms == null ? "—" : `${s.ms} ms`) },
          { key: "u", label: "Uptime (30 days)", num: true, align: "right", render: (s) => s.uptime },
        ]} />
      </Panel>
      <div className="pf-split">
        <Panel title="Traffic quality" sub="Last 24 hours" className="grow" pad>
          <dl className="pf-kv tnum">
            <dt>Real visitors</dt><dd>—</dd>
            <dt>Search engines (allowed)</dt><dd>Google, Bing</dd>
            <dt>Bots blocked</dt><dd>Scrapers, fake browsers, too many requests</dd>
            <dt>Analytics</dt><dd>Counts real visitors only</dd>
          </dl>
        </Panel>
        <Panel title="Speed-ups on" className="side" pad>
          <ul className="pf-list">{[["zap", "Page and search cache", "Cleared when a listing changes"], ["image", "Resized photos (WebP)", "Cover, gallery and thumbnail sizes"], ["shield-check", "Rate limits", "Login, contact forms, search"]].map(([ic, a, b]) => <li key={a}><span className="pf-li-ico"><Icon name={ic} size={16} /></span><div><b>{a}</b><span className="small muted">{b}</span></div></li>)}</ul>
        </Panel>
      </div>
      <Panel title="Background jobs">
        <Table rows={jobs} minWidth={720} columns={[
          { key: "n", label: "Job", render: (j) => <span className="pf-two"><b>{j.name}</b><small>{j.every}</small></span> },
          { key: "l", label: "Last run", num: true, render: (j) => j.last },
          { key: "r", label: "Result", render: (j) => (j.result ? <Badge tone={j.result === "ok" ? "done" : "progress"}>{j.result === "ok" ? "OK" : "Check"}</Badge> : <span className="small muted">Not run yet</span>) },
          { key: "x", label: "", render: (j) => <span className="small muted">{j.note}</span> },
        ]} />
      </Panel>
      <Panel title="Recent errors" sub="Grouped; each one is also in the audit log with full details.">
        {!errors.length ? <p className="small muted" style={{ padding: "12px 16px" }}>No errors recorded.</p> : <Table rows={errors} minWidth={720} columns={[
          { key: "a", label: "When", num: true, render: (e) => e.at },
          { key: "w", label: "Where", render: (e) => <code>{e.where}</code> },
          { key: "m", label: "What happened", render: (e) => <span className="small">{e.what}</span> },
          { key: "c", label: "Times", num: true, align: "right", render: (e) => e.count },
        ]} />}
      </Panel>
    </>
  );
}
