// Listing check-ups for signed-in businesses: today's few listings for each reviewer, the changes waiting for a
// decision, who reviewed what, and the owner's settings per branch.
// Where it fits: Business → Listing check-ups (ListingCheckups.jsx shows this when the business is on the server).
// How it works: everything comes from the business API (modules/reviews/checkups.ts) for the branch picked at the top.
// "All correct" and "Skip" keep the listing on the website; a change takes it off for the day until it is decided.

import React, { useEffect, useState } from "react";
import { useStore } from "@sheetal/shared/core/store";
import { Badge, Button, Checkbox, Drawer, Empty, Field, Input, PageHead, Panel, Seg, Tabs, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { bizApi } from "../api";

const FIELDS = [["price", "Price (Rs.)"], ["status", "Status"], ["title", "Title"], ["propertyType", "Property type"], ["bedrooms", "Bedrooms"], ["bathrooms", "Bathrooms"], ["area", "Area"], ["district", "District"],
  ["landArea", "Land area"], ["builtArea", "Built-up area"], ["roadAccess", "Road"], ["facing", "Facing"], ["furnishing", "Furnishing"], ["parking", "Parking"]];
const NAME = Object.fromEntries(FIELDS);
const rs = (n) => (n == null ? "—" : `Rs. ${Number(n).toLocaleString("en-IN")}`);
const GROUP_NAMES = { price: "Price", status: "Status (available, sold, rented)", details: "Details (title, type, rooms, land, built-up)", location: "Location (area, district, road, facing)", other: "Other (furnishing, parking)" };
const LEVEL_NAMES = [["high", "High"], ["medium", "Medium"], ["low", "Low"], ["custom", "Custom"]];
const ACT = { ok: ["All correct", "done"], change: ["Changed", "action"], skip: ["Skipped", "neutral"] };

export function LiveCheckups({ tenant }) {
  const { db } = useStore();
  const toast = useToast();
  const branch = db.session.branchOf?.[tenant.id] || "all";
  const [tab, setTab] = useState("today");
  const [setup, setSetup] = useState(null);
  const [today, setToday] = useState(null);
  const [tick, setTick] = useState(0);
  const reload = () => setTick((n) => n + 1);
  useEffect(() => { bizApi("GET", "/checkups/setup").then((r) => setSetup(r.data)).catch((e) => toast(e.message)); }, [tenant.id, branch, tick]);
  useEffect(() => { bizApi("GET", "/checkups/today").then((r) => setToday(r.data)).catch((e) => setToday({ error: e.message })); }, [tenant.id, branch, tick]);
  const manage = !!setup?.canManage;

  return (
    <>
      <PageHead title="Listing check-ups" sub="A few listings a day for each reviewer, so every listing stays correct. Changes are decided together at the end of the day." />
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: "today", label: "Today", icon: "list-checks", count: today?.listings?.length },
        ...(manage ? [{ id: "decide", label: "Decisions", icon: "git-merge" }] : []),
        { id: "history", label: "Who reviewed what", icon: "history" },
        ...(manage ? [{ id: "settings", label: "Settings", icon: "settings" }] : []),
      ]} />
      {tab === "today" && <Today data={today} onDone={reload} toast={toast} />}
      {tab === "decide" && manage && <Decisions toast={toast} branch={branch} />}
      {tab === "history" && <History branch={branch} />}
      {tab === "settings" && manage && setup && <Settings data={setup} toast={toast} onSaved={reload} />}
    </>
  );
}

function Today({ data, onDone, toast }) {
  const [edit, setEdit] = useState(null);
  if (!data) return <Panel pad><p className="muted small">Loading…</p></Panel>;
  if (data.error) return <Panel pad><p className="small">{data.error}</p></Panel>;
  const send = (l, action, changes = {}) => bizApi("POST", `/checkups/review/${encodeURIComponent(l.id)}`, { action, changes }).then((r) => { toast(r.message); setEdit(null); onDone(); }).catch((e) => toast(e.message));
  return (
    <>
      <Panel title={`${data.done} of ${data.perDay} done today`} sub="Your own listings for today. Other reviewers get different ones." pad>
        {!data.listings.length ? <Empty icon="circle-check" title="All done for today">Come back tomorrow for the next few.</Empty> : (
          <div className="pf-stack">{data.listings.map((l) => (
            <div key={l.id} className="card pf-pad" style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ width: 96, height: 72, borderRadius: 8, overflow: "hidden", background: "var(--surface)", flex: "none", display: "grid", placeItems: "center" }}>
                {l.photo ? <img src={l.photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Icon name="image" size={22} />}
              </div>
              <div className="pf-two" style={{ flex: "1 1 260px", minWidth: 0 }}>
                <b>{l.title} <span className="muted small">{l.id}</span></b>
                <small>{[rs(l.price), l.area || l.district, l.bedrooms && `${l.bedrooms} bed`, l.landArea, `check by ${l.checkDue || "now"}`, `added ${l.added}`].filter(Boolean).join(" · ")}</small>
                {l.held && <Badge tone="action">Off the website until today's changes are decided</Badge>}
              </div>
              <div className="pf-row-actions">
                <Button size="sm" icon="check" onClick={() => send(l, "ok")}>All correct</Button>
                {Object.keys(data.groups || {}).length > 0 && <Button size="sm" variant="outline" icon="pencil" onClick={() => setEdit({ l, v: {} })}>Change</Button>}
                <Button size="sm" variant="ghost" onClick={() => send(l, "skip")}>Skip</Button>
              </div>
            </div>
          ))}</div>
        )}
      </Panel>
      <Drawer open={!!edit} onClose={() => setEdit(null)} title="What is different now?" sub={edit?.l.title}
        footer={<><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button disabled={!edit || !Object.values(edit.v).some((x) => String(x).trim())} onClick={() => send(edit.l, "change", edit.v)}>Save changes</Button></>}>
        {edit && <div className="pf-stack">
          <p className="small muted">Fill only what changed. The listing is taken off the website for today; at the end of the day the value most reviewers chose is used, or the owner decides.</p>
          {!Object.keys(data.groups || {}).length && <p className="small">Your access lets you confirm or skip listings, not change them.</p>}
          {Object.entries(data.groups || {}).map(([g, keys]) => <div key={g} className="pf-stack tight"><h4 className="pf-subhead" style={{ margin: "6px 0 0" }}>{GROUP_NAMES[g] || g}</h4>
          {FIELDS.filter(([k]) => keys.includes(k)).map(([k, label]) => k === "status"
            ? <Field key={k} label="Status"><Seg value={edit.v.status || ""} onChange={(x) => setEdit({ ...edit, v: { ...edit.v, status: x } })} options={[{ id: "", label: "No change" }, { id: "published", label: "Available" }, { id: "sold", label: "Sold" }, { id: "rented", label: "Rented" }]} /></Field>
            : <Field key={k} label={label} hint={`Now: ${k === "price" ? rs(edit.l.price) : edit.l[k] ?? "—"}`}><Input value={edit.v[k] || ""} onChange={(e) => setEdit({ ...edit, v: { ...edit.v, [k]: e.target.value } })} /></Field>)}
          </div>)}
        </div>}
      </Drawer>
    </>
  );
}

function Decisions({ toast, branch }) {
  const [rows, setRows] = useState(null);
  const [pick, setPick] = useState({});
  const load = () => bizApi("GET", "/checkups/conflicts").then((r) => setRows(r.data)).catch((e) => toast(e.message));
  useEffect(() => { load(); }, [branch]);
  const decideNow = () => bizApi("POST", "/checkups/decide").then((r) => { toast(r.message); load(); }).catch((e) => toast(e.message));
  const save = (l) => bizApi("POST", `/checkups/conflicts/${encodeURIComponent(l.id)}`, pick[l.id] || {}).then((r) => { toast(r.message); load(); }).catch((e) => toast(e.message));
  return (
    <Panel title="Changes waiting for you" sub="Where reviewers chose different values, pick the right one. Changes most reviewers agreed on are applied on their own at the end of the day."
      actions={<Button size="sm" variant="outline" icon="git-merge" onClick={decideNow}>Decide today's changes now</Button>} pad>
      {!rows ? <p className="muted small">Loading…</p> : !rows.length ? <Empty icon="circle-check" title="Nothing to decide">Every change so far was agreed.</Empty> : (
        <div className="pf-stack">{rows.map((l) => (
          <div key={l.id} className="card pf-pad pf-stack">
            <b>{l.title} <span className="muted small">{l.id}</span></b>
            {Object.entries(l.choices).map(([k, opts]) => (
              <Field key={k} label={NAME[k] || k}>
                <div className="pf-stack tight">{opts.map((o) => (
                  <label key={o.value} className="row" style={{ gap: 8, cursor: "pointer" }}>
                    <input type="radio" name={`${l.id}-${k}`} checked={pick[l.id]?.[k] === o.value} onChange={() => setPick({ ...pick, [l.id]: { ...(pick[l.id] || {}), [k]: o.value } })} />
                    <span><b>{k === "price" ? rs(o.value) : o.value}</b> <span className="muted small">by {o.by.join(", ")}</span></span>
                  </label>))}
                  <Input placeholder="Or type the right value" value={pick[l.id]?.[k] && !opts.some((o) => o.value === pick[l.id][k]) ? pick[l.id][k] : ""} onChange={(e) => setPick({ ...pick, [l.id]: { ...(pick[l.id] || {}), [k]: e.target.value } })} />
                </div>
              </Field>
            ))}
            <div className="pf-row-actions"><Button size="sm" icon="send" onClick={() => save(l)}>Save and publish</Button></div>
          </div>
        ))}</div>
      )}
    </Panel>
  );
}

function History({ branch }) {
  const [days, setDays] = useState("7");
  const [rows, setRows] = useState(null);
  useEffect(() => { bizApi("GET", `/checkups/history?days=${days}`).then((r) => setRows(r.data)).catch(() => setRows([])); }, [days, branch]);
  return (
    <Panel title="Who reviewed what" sub="Every review in this branch: all correct, skipped or changed, and whether it was decided." actions={<Seg value={days} onChange={setDays} options={[["1", "Today"], ["7", "7 days"], ["30", "30 days"], ["365", "1 year"]].map(([id, label]) => ({ id, label }))} />}>
      {!rows ? <p className="pf-pad muted small">Loading…</p> : !rows.length ? <p className="pf-pad muted small">No reviews in this time.</p> : (
        <div className="pf-table-wrap"><table className="table pf-table"><thead><tr><th>Day</th><th>Who</th><th>Listing</th><th>What</th><th>Changes</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}><td className="tnum">{r.day}</td><td>{r.by}</td><td><span className="pf-two"><b>{r.title}</b><small>{r.listing}</small></span></td>
              <td><Badge tone={ACT[r.action]?.[1]}>{ACT[r.action]?.[0] || r.action}</Badge>{r.action === "change" && <span className="small muted"> {r.decided ? "decided" : "waiting"}</span>}</td>
              <td className="small">{Object.entries(r.changes || {}).map(([k, x]) => `${NAME[k] || k}: ${k === "price" ? rs(x) : x}`).join(" · ") || "—"}</td></tr>
          ))}</tbody></table></div>
      )}
    </Panel>
  );
}

function Settings({ data, toast, onSaved }) {
  const [s, setS] = useState(data.setup);
  const set = (patch) => setS((x) => ({ ...x, ...patch }));
  const save = () => bizApi("PUT", "/checkups/setup", s).then((r) => { toast(r.message); onSaved(); }).catch((e) => toast(e.message));
  return (
    <div className="pf-stack">
      <Panel title="What to review" pad>
        <div className="pf-stack">
          <Field label="Listings per person per day"><Seg value={String(s.perDay)} onChange={(v) => set({ perDay: Number(v) })} options={["3", "5", "8", "10", "15"].map((x) => ({ id: x, label: x }))} /></Field>
          <Field label="Newly added listings from the last"><Seg value={s.recent || ""} onChange={(v) => set({ recent: v })} options={[["", "None"], ["1m", "1 month"], ["3m", "3 months"], ["6m", "6 months"], ["1y", "1 year"], ["custom", "Custom"]].map(([id, label]) => ({ id, label }))} /></Field>
          {s.recent === "custom" && <div className="pf-grid-2 tight"><Field label="From"><Input type="date" value={s.from || ""} onChange={(e) => set({ from: e.target.value })} /></Field><Field label="To"><Input type="date" value={s.to || ""} onChange={(e) => set({ to: e.target.value })} /></Field></div>}
          <Field label="Listings whose check date is within" hint="Overdue listings are always included"><Seg value={s.expiring || ""} onChange={(v) => set({ expiring: v })} options={[["", "None"], ["1w", "1 week"], ["1m", "1 month"], ["2m", "2 months"], ["3m", "3 months"], ["4m", "4 months"]].map(([id, label]) => ({ id, label }))} /></Field>
          <Field label="“All correct” keeps it live for"><Seg value={String(s.extendMonths)} onChange={(v) => set({ extendMonths: Number(v) })} options={[["3", "3 months"], ["6", "6 months"], ["12", "1 year"]].map(([id, label]) => ({ id, label }))} /></Field>
        </div>
      </Panel>
      {data.branches.map((b) => {
        const cur = s.reviewers?.[b.id] ?? "all";
        const chosen = cur === "all" ? b.people.filter((p) => p.lists).map((p) => p.id) : cur;
        const acc = (p) => s.access?.[p.id] || { level: p.level, groups: p.groups };
        const setAcc = (p, a) => set({ access: { ...(s.access || {}), [p.id]: a } });
        return (
          <Panel key={b.id} title={`Who reviews at ${b.name}, and what they may change`} sub="Each reviewer gets different listings of this branch every day." pad>
            <div className="pf-table-wrap" style={{ marginTop: 12 }}><table className="table pf-table">
              <thead><tr><th>Person</th><th style={{ width: 90 }}>Reviews</th><th style={{ width: 300 }}>Access</th><th>Can change</th></tr></thead>
              <tbody>{b.people.map((p) => {
                const on = chosen.includes(p.id);
                const owner = p.level === "high" && /owner/i.test(p.role);
                const a = owner ? { level: "high" } : acc(p);
                const allowed = a.level === "custom" ? a.groups || [] : data.levels[a.level] || [];
                const flip = (g) => setAcc(p, { level: "custom", groups: allowed.includes(g) ? allowed.filter((x) => x !== g) : [...allowed, g] });
                return (
                  <tr key={p.id} style={on ? undefined : { opacity: 0.55 }}>
                    <td><span className="pf-two"><b>{p.name}</b><small>{p.role}{!p.lists && " · no listing role"}</small></span></td>
                    <td><Checkbox label="" checked={on} onChange={(v) => set({ reviewers: { ...(s.reviewers || {}), [b.id]: v ? [...new Set([...chosen, p.id])] : chosen.filter((x) => x !== p.id) } })} /></td>
                    <td>{owner ? <span className="small muted">Owner: always everything</span>
                      : <Seg value={a.level} onChange={(lv) => setAcc(p, { level: lv, groups: lv === "custom" ? allowed : undefined })} options={LEVEL_NAMES.map(([id, label]) => ({ id, label }))} />}</td>
                    <td><div className="pf-chips">{Object.keys(data.groups).map((g) => {
                      const yes = allowed.includes(g);
                      return <button key={g} type="button" disabled={owner} title={GROUP_NAMES[g]} aria-pressed={yes} className={`chip ${yes ? "active" : ""}`} onClick={() => flip(g)}><Icon name={yes ? "check" : "x"} size={13} />{{ price: "Price", status: "Status", details: "Details", location: "Location", other: "Other" }[g]}</button>;
                    })}</div></td>
                  </tr>
                );
              })}</tbody>
            </table></div>
            <p className="small muted" style={{ marginTop: 10 }}>High: everything. Medium: everything but the price. Low: details and other facts only. Tap a group to fine-tune (Custom). The server refuses any change outside a person's access.</p>
          </Panel>
        );
      })}
      <div className="pf-row-actions"><Button icon="save" onClick={save}>Save settings</Button></div>
    </div>
  );
}
