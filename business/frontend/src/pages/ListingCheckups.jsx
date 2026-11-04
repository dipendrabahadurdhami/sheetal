// Listing check-ups: a few listings a day per person, one card at a time, so the information stays correct.

import React, { useState } from "react";
import { useStore } from "@sheetal/shared/core/store";
import { useRouter } from "@sheetal/shared/core/router";
import { can, roleName } from "@sheetal/shared/core/rbac";
import { useT } from "@sheetal/shared/core/i18n";
import { TODAY, fdate, fdatetime } from "@sheetal/shared/core/format";
import { Badge, Checkbox, Empty, Field, PageHead, Panel, Seg, Stat, Table, Tabs, ToggleRow, useToast, Button } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { isLive, saveSettings } from "../live";
import { CheckupCard, dueLabel, useCheckups } from "@sheetal/shared/components/CheckupCard";
import { ACTIONS, checkupQueue, daysBetween, todaysList } from "@sheetal/shared/data/checkups";

const today = TODAY.slice(0, 10);

export function ListingCheckups({ tenant, role }) {
  const t = useT();
  const toast = useToast();
  const { db, update } = useStore();
  const { navigate } = useRouter();
  const { settings, log, act } = useCheckups(tenant.id);
  const listings = db.listings.filter((l) => l.tenantId === tenant.id);
  const manager = can(role, "team.manage") || role.perms.includes("*");
  const [tab, setTab] = useState("today");
  const [extra, setExtra] = useState(0);
  const list = todaysList(listings, settings, log, today, extra);
  const doneToday = log.filter((e) => e.at.slice(0, 10) === today && e.by === db.session.userName);
  const dueSoon = checkupQueue(listings, settings, today).filter((l) => !l.checkDue || daysBetween(today, l.checkDue) <= settings.askBeforeDays);
  const edit = (l) => { update((d) => { d.drafts[tenant.id] = { kind: l.kind, values: { ...(l.values || {}), title: l.title }, editId: l.id }; }); navigate("/business/listings/new"); };
  const onDone = (a) => toast(ACTIONS[a][0]);
  const total = settings.perDay + extra;
  const step = Math.min(doneToday.length + 1, total);

  return (
    <>
      <PageHead title="Listing check-ups" sub="A few listings a day, so every price, size and status on the website stays correct." />
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: "today", label: "Today", icon: "list-checks", count: list.length || undefined },
        { id: "due", label: "Due soon", icon: "clock", count: dueSoon.length || undefined },
        ...(manager ? [{ id: "team", label: "Team activity", icon: "users" }, { id: "settings", label: "Settings", icon: "settings" }] : []),
      ]} />

      {tab === "today" && <div className="cu-phone">
        {list.length ? <CheckupCard key={list[0].id} listing={list[0]} step={step} total={total} act={act} onDone={onDone} onEdit={edit} />
          : <section className="card cu-card cu-empty">
              <Icon name="check" size={36} />
              <b>All done for today</b>
              <span className="small muted">{doneToday.length ? `You checked ${doneToday.length} listing${doneToday.length > 1 ? "s" : ""} today.` : "Nothing needs checking right now."}</span>
              {checkupQueue(listings, settings, today).some((l) => !log.some((e) => e.listingId === l.id && e.at.slice(0, 10) === today)) && <Button variant="outline" icon="plus" onClick={() => setExtra(extra + settings.perDay)}>Check {settings.perDay} more</Button>}
            </section>}
      </div>}

      {tab === "due" && <Panel title="Due soon" sub={`Listings never checked, overdue, or due in the next ${settings.askBeforeDays} days. They are asked about automatically.`}>
        {dueSoon.length ? <Table rows={dueSoon} minWidth={640} columns={[
          { key: "l", label: "Listing", render: (l) => <span className="pf-two"><b>{l.title}</b><small className="tnum">{l.id}</small></span> },
          { key: "d", label: "Check", render: (l) => { const [txt, tone] = dueLabel(l); return <Badge tone={tone}>{txt}</Badge>; } },
          { key: "s", label: "Fixes found", render: (l) => (l.suggest?.length ? <span className="small">{l.suggest.length}</span> : <span className="small muted">—</span>) },
          { key: "c", label: "Last checked", num: true, render: (l) => (l.lastChecked ? fdate(l.lastChecked) : "Never") },
        ]} /> : <Empty icon="check" title="Nothing due">Every listing was checked recently.</Empty>}
      </Panel>}

      {tab === "team" && manager && <TeamActivity tenant={tenant} listings={listings} log={log} settings={settings} db={db} />}
      {tab === "settings" && manager && <CheckupSettings tenant={tenant} settings={settings} t={t} />}
    </>
  );
}

function TeamActivity({ tenant, listings, log, settings, db }) {
  const members = db.members[tenant.id] || [];
  const live = listings.filter((l) => l.status === "published");
  const fresh = live.filter((l) => l.lastChecked && daysBetween(l.lastChecked, today) <= 90).length;
  const week = log.filter((e) => daysBetween(e.at, today) <= 7);
  const people = [...new Set([...members.map((m) => m.name), ...log.map((e) => e.by)])].map((name) => {
    const mine = log.filter((e) => e.by === name);
    const count = (a) => mine.filter((e) => e.action === a).length;
    return { id: name, name, checked: mine.filter((e) => e.action !== "skip").length, fixed: count("edit") + mine.filter((e) => e.detail?.startsWith("Fixed")).length, sold: count("sold"), removed: count("remove") + count("expire"), skipped: count("skip"), last: mine[0]?.at };
  });
  return (
    <>
      <div className="pf-stats">
        <Stat label="Checked in the last 90 days" value={`${live.length ? Math.round((fresh / live.length) * 100) : 0}%`} note={`${fresh} of ${live.length} live listings`} />
        <Stat label="Checks this week" value={week.filter((e) => e.action !== "skip").length} note={`${week.filter((e) => e.action === "skip").length} skipped`} />
        <Stat label="Per person per day" value={settings.perDay} note={settings.reviewers === "all" ? "Everyone who manages listings" : `${settings.reviewers.length} chosen people`} />
      </div>
      <Panel title="Who checked what">
        <Table rows={people} minWidth={720} columns={[
          { key: "n", label: "Team member", render: (p) => <b>{p.name}</b> },
          { key: "c", label: "Checked", num: true, align: "right", render: (p) => p.checked },
          { key: "f", label: "Fixed info", num: true, align: "right", render: (p) => p.fixed },
          { key: "s", label: "Sold / rented", num: true, align: "right", render: (p) => p.sold },
          { key: "r", label: "Expired / removed", num: true, align: "right", render: (p) => p.removed },
          { key: "k", label: "Skipped", num: true, align: "right", render: (p) => p.skipped },
          { key: "l", label: "Last check", num: true, render: (p) => (p.last ? fdatetime(p.last) : "—") },
        ]} />
      </Panel>
      <Panel title="Recent check-ups">
        {log.length ? <Table rows={log.slice(0, 30)} minWidth={720} columns={[
          { key: "a", label: "When", num: true, render: (e) => fdatetime(e.at) },
          { key: "b", label: "Who", render: (e) => e.by },
          { key: "l", label: "Listing", render: (e) => <span className="pf-two"><b>{e.title}</b><small className="tnum">{e.listingId}</small></span> },
          { key: "x", label: "What", render: (e) => <span className="pf-two"><Badge tone={ACTIONS[e.action][1]}>{ACTIONS[e.action][0]}</Badge>{e.detail && <small className="muted">{e.detail}</small>}</span> },
        ]} /> : <Empty icon="list-checks" title="No check-ups yet">They appear here as your team checks listings.</Empty>}
      </Panel>
    </>
  );
}

function CheckupSettings({ tenant, settings, t }) {
  const { db, update } = useStore();
  const toast = useToast();
  const members = db.members[tenant.id] || [];
  const roles = db.tenantRoles[tenant.id] || [];
  const set = (patch) => {
    const next = { ...settings, ...patch };
    update((d) => { d.checkups = d.checkups || {}; d.checkups[tenant.id] = d.checkups[tenant.id] || { log: [] }; d.checkups[tenant.id].settings = next; });
    // Signed in, the settings are saved on the server (the same on every device and for the whole team).
    if (isLive(tenant.id)) saveSettings("checkups", next).then((r) => toast(r.message)).catch((e) => toast(e.message));
    else toast("Saved");
  };
  const chosen = settings.reviewers === "all" ? members.map((m) => m.id) : settings.reviewers;
  return (
    <Panel title="Check-up settings" sub="Only owners and managers can change these." pad>
      <div className="pf-stack">
        <Field label="Who checks listings">
          <div className="pf-stack tight">
            <ToggleRow title="Everyone who manages listings" sub="Turn off to choose people" checked={settings.reviewers === "all"} onChange={(v) => set({ reviewers: v ? "all" : members.map((m) => m.id) })} />
            {settings.reviewers !== "all" && <div className="pf-check-grid">{members.map((m) => <Checkbox key={m.id} label={`${m.name} · ${roleName(roles.find((r) => r.id === m.roleId), t)}`} checked={chosen.includes(m.id)} onChange={(v) => set({ reviewers: v ? [...chosen, m.id] : chosen.filter((x) => x !== m.id) })} />)}</div>}
          </div>
        </Field>
        <Field label="Listings per person per day"><Seg value={String(settings.perDay)} onChange={(v) => set({ perDay: Number(v) })} options={["3", "4", "5"].map((x) => ({ id: x, label: x }))} /></Field>
        <Field label="Ask before a listing's check date"><Seg value={String(settings.askBeforeDays)} onChange={(v) => set({ askBeforeDays: Number(v) })} options={["3", "5", "7"].map((x) => ({ id: x, label: `${x} days` }))} /></Field>
        <Field label="“All correct” keeps it live for"><Seg value={String(settings.extendMonths)} onChange={(v) => set({ extendMonths: Number(v) })} options={[["3", "3 months"], ["6", "6 months"], ["12", "1 year"]].map(([id, label]) => ({ id, label }))} /></Field>
        <Field label="If nobody checks it in time"><Seg value={settings.overdue} onChange={(v) => set({ overdue: v })} options={[{ id: "keep", label: "Keep it live and keep asking" }, { id: "hide", label: "Hide it until checked" }]} /></Field>
      </div>
    </Panel>
  );
}
