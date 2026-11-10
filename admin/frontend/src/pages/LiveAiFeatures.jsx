// AI tools by plan on the admin API (Admin → AI): switches, monthly credits, and who is using them.
// Where it fits: the first tab of the AI hub in AdminApp when isStaffLive(); keys and model are in the Setup center.
// How it works: loads GET /admin/ai/features and /admin/ai/usage; one switch per tool and plan, credits per plan
// (-1 means unlimited), one switch for Ask AI on the website (visitors have no plan). Save sends only what changed.
// Rules: the server refuses unknown plans and tools; every change is audited.

import React, { useEffect, useState } from "react";
import { Badge, Button, Input, PageHead, Panel, Table, ToggleRow, useToast } from "@sheetal/shared/core/ui";
import { adminApi } from "../api";

const firstError = (e) => Object.values(e.errors || {}).flat()[0] || e.message;

export function LiveAiFeatures({ embedded }) {
  const toast = useToast();
  const [saved, setSaved] = useState(null);
  const [s, setS] = useState(null);
  const [usage, setUsage] = useState([]);
  const load = () => {
    adminApi("GET", "/admin/ai/features").then(({ data }) => { setSaved(data); setS(JSON.parse(JSON.stringify(data))); }).catch((e) => toast(firstError(e)));
    adminApi("GET", "/admin/ai/usage").then((r) => setUsage(r.data)).catch(() => {});
  };
  useEffect(load, []);
  if (!s) return <PageHead title="AI tools" sub="Loading…" />;
  const plans = Object.keys(s.plans);
  const dirty = JSON.stringify(s) !== JSON.stringify(saved);
  const setFeature = (p, f, v) => setS((x) => ({ ...x, plans: { ...x.plans, [p]: { ...x.plans[p], features: { ...x.plans[p].features, [f]: v } } } }));
  const setCredits = (p, v) => setS((x) => ({ ...x, plans: { ...x.plans, [p]: { ...x.plans[p], credits: v } } }));
  const save = () => {
    const body = { askAi: s.askAi, plans: Object.fromEntries(plans.map((p) => [p, { credits: s.plans[p].credits === "" || s.plans[p].credits === "-" ? null : Number(s.plans[p].credits), features: s.plans[p].features }])) };
    adminApi("PUT", "/admin/ai/features", body).then((r) => { toast(r.message); load(); }).catch((e) => toast(firstError(e)));
  };
  return (
    <>
      {!embedded && <PageHead title="AI tools" sub="Which AI tools each plan gets and how many credits it has each month." />}
      <Panel title="Tools by plan" sub="A tool that is off is refused with a message that suggests upgrading. 1 credit is about 1,000 tokens." pad
        >
        <div className="pf-stack">
          <Table rows={s.features} minWidth={560} columns={[
            { key: "n", label: "Tool", render: (f) => <b>{f.name}</b> },
            ...plans.map((p) => ({ key: p, label: p, render: (f) => <ToggleRow title="" checked={!!s.plans[p].features[f.id]} onChange={(v) => setFeature(p, f.id, v)} /> })),
          ]} />
          <Table rows={[{ id: "credits" }]} minWidth={560} columns={[
            { key: "n", label: "Credits a month", render: () => <b>Credits a month</b> },
            ...plans.map((p) => ({ key: p, label: p, render: () => <Input className="input tnum" style={{ width: 110 }} inputMode="numeric" value={s.plans[p].credits} onChange={(e) => setCredits(p, e.target.value.replace(/[^\d-]/g, ""))} /> })),
          ]} />
          <p className="small muted" style={{ margin: 0 }}>Use -1 for unlimited.</p>
          <ToggleRow title="Ask AI on the website" sub="Visitors compare listings with AI. It has no plan, so this is one switch for everyone." checked={s.askAi} onChange={(v) => setS({ ...s, askAi: v })} />
          <div><Button disabled={!dirty} onClick={save}>Save</Button></div>
        </div>
      </Panel>
      <Panel title="Use this month" sub="Credits used by each business since the 1st." pad>
        <Table rows={usage} minWidth={560} empty={<p className="muted">No AI use yet this month.</p>} columns={[
          { key: "n", label: "Business", render: (u) => <b>{u.name}</b> },
          { key: "p", label: "Plan", render: (u) => u.plan },
          { key: "u", label: "Used", num: true, render: (u) => u.used.toLocaleString("en-IN") },
          { key: "l", label: "Limit", num: true, render: (u) => (u.limit === -1 ? "Unlimited" : u.limit.toLocaleString("en-IN")) },
          { key: "s", label: "", render: (u) => (u.limit !== -1 && u.used >= u.limit ? <Badge tone="problem">Used up</Badge> : u.limit !== -1 && u.used >= u.limit * 0.8 ? <Badge tone="action">Almost</Badge> : null) },
        ]} />
      </Panel>
    </>
  );
}
