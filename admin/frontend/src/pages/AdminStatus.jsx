import React from "react";
import { useStore } from "@sheetal/shared/core/store";
import { Badge, PageHead, Panel, Stat, Table } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { integrationsOf } from "@sheetal/shared/data/integrations";

// System status: the super admin's view of every moving part. The backend fills this from
// GET /admin/system/status (health checks, metrics, job queue and error log); numbers here are demo values.

const STATE = { up: ["Working", "done"], slow: ["Slow", "progress"], down: ["Down", "problem"], off: ["Not set up", "neutral"] };

export function AdminStatus() {
  const { db } = useStore();
  const x = integrationsOf(db);
  const services = [
    { id: "api", name: "API", what: "Website, business and admin requests", state: "up", ms: 84, uptime: "99.98%" },
    { id: "db", name: "Database (PostgreSQL)", what: "Listings, accounts, leads, money", state: "up", ms: 6, uptime: "100%" },
    { id: "cache", name: "Cache (Redis)", what: "Fast pages, sessions, rate limits", state: "up", ms: 1, uptime: "100%" },
    { id: "jobs", name: "Background jobs", what: "Emails, alerts, renewals, sitemap", state: "up", ms: null, uptime: "99.95%" },
    { id: "files", name: "Photo storage and CDN", what: "16,900 property photos", state: "up", ms: 42, uptime: "100%" },
    { id: "mail", name: "Email worker (Cloudflare)", what: "Incoming mail to the inbox", state: x.email.worker.deployed ? "up" : "off", ms: null, uptime: x.email.worker.deployed ? "100%" : "—" },
    { id: "wa", name: "WhatsApp", what: x.whatsapp.mode === "qr" ? "Linked phone" : "Cloud API", state: x.whatsapp.webhookOk || x.whatsapp.qr.state === "linked" ? "up" : "off", ms: null, uptime: "—" },
    { id: "voice", name: "Voice call server", what: "AI voice assistant calls", state: x.ai.workerOk ? "up" : "off", ms: null, uptime: "—" },
    { id: "ai", name: "AI model", what: "Every AI feature", state: x.ai.tested ? "up" : "off", ms: x.ai.tested ? 1200 : null, uptime: "—" },
  ];
  const down = services.filter((s) => s.state === "down" || s.state === "slow").length;
  const jobs = [
    { id: "j1", name: "Rebuild sitemap", every: "Daily 02:00", last: "2027-03-02 02:00", result: "ok", note: "2,718 URLs" },
    { id: "j2", name: "Plan renewals and grace period", every: "Hourly", last: "2027-03-02 10:00", result: "ok", note: "0 due" },
    { id: "j3", name: "Check customer domain DNS", every: "Every 10 min", last: "2027-03-02 09:50", result: "ok", note: "1 waiting" },
    { id: "j4", name: "Scheduled social posts", every: "Every minute", last: "2027-03-02 09:59", result: "warn", note: "1 failed: photo too small" },
    { id: "j5", name: "WhatsApp alerts", every: "On each event", last: "2027-03-02 09:58", result: "ok", note: "214 sent today" },
    { id: "j6", name: "Database backup", every: "Daily 03:00", last: "2027-03-02 03:00", result: "ok", note: "Kept 30 days" },
  ];
  const errors = [
    { id: "e1", at: "2027-03-02 09:41", where: "POST /webhooks/whatsapp", what: "Signature check failed (wrong app secret?)", count: 3 },
    { id: "e2", at: "2027-03-02 08:12", where: "Social post job", what: "Instagram: image smaller than 320 px", count: 1 },
    { id: "e3", at: "2027-03-01 22:05", where: "GET /search", what: "Slow query (1.8 s) on price filter; index added", count: 1 },
  ];
  return (
    <>
      <PageHead title="System status" sub={down ? `${down} service needs attention` : "Everything is working"} />
      <div className="pf-stats">
        <Stat label="API speed (average)" value="84 ms" note="95% under 210 ms" />
        <Stat label="Cache hits" value="91%" note="Pages served from cache" />
        <Stat label="Errors (24 h)" value="5" note="0.02% of requests" />
        <Stat label="Bots filtered (24 h)" value="38%" note="Google and Bing allowed" />
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
            <dt>Real visitors</dt><dd>4,812</dd>
            <dt>Search engines (allowed)</dt><dd>1,204 · Google, Bing</dd>
            <dt>Bots blocked</dt><dd>1,736 · scrapers, fake browsers, too many requests</dd>
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
          { key: "r", label: "Result", render: (j) => <Badge tone={j.result === "ok" ? "done" : "progress"}>{j.result === "ok" ? "OK" : "Check"}</Badge> },
          { key: "x", label: "", render: (j) => <span className="small muted">{j.note}</span> },
        ]} />
      </Panel>
      <Panel title="Recent errors" sub="Grouped; each one is also in the audit log with full details.">
        <Table rows={errors} minWidth={720} columns={[
          { key: "a", label: "When", num: true, render: (e) => e.at },
          { key: "w", label: "Where", render: (e) => <code>{e.where}</code> },
          { key: "m", label: "What happened", render: (e) => <span className="small">{e.what}</span> },
          { key: "c", label: "Times", num: true, align: "right", render: (e) => e.count },
        ]} />
      </Panel>
    </>
  );
}
