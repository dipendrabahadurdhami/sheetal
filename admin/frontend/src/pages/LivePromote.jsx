// Admin → Promote on the admin API: the price a day, spots and on-sale switch of each boost place, the boost lengths
// on sale, every business's boosts (now, or all of them), and home page banners: check businesses' pictures
// (approve or ask for a change) and add Sheetal's own. Bank transfers for boosts are confirmed in Billing →
// Payments like any invoice; the boost then starts by itself.

import React, { useEffect, useState } from "react";
import { fdate, rs } from "@sheetal/shared/core/format";
import { Badge, Button, Drawer, Field, Input, PageHead, Panel, Seg, Stat, Table, ToggleRow, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { useRouter } from "@sheetal/shared/core/router";
import { adminApi } from "../api";

const fileToBase64 = (file) => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] || ""); r.onerror = () => bad(r.error); r.readAsDataURL(file); });

const TONE = { awaiting: "action", checking: "progress", scheduled: "progress", live: "done", listing_off: "problem", ended: "neutral", stopped: "neutral", cancelled: "neutral" };
const ICON = { home: "house", search: "arrow-up-to-line", city: "map-pin" };

export function LiveAdminPromote() {
  const toast = useToast();
  const { navigate } = useRouter();
  const [show, setShow] = useState("now");
  const [d, setD] = useState(null);
  const [edit, setEdit] = useState(null);
  const load = () => adminApi("GET", `/admin/promote?show=${show}`).then((r) => setD(r.data)).catch((e) => { setD(false); toast(e.message); });
  useEffect(() => { load(); }, [show]);
  if (d === null) return <><PageHead title="Promote" /><p className="muted pf-pad">Loading…</p></>;
  if (d === false) return <><PageHead title="Promote" /><p className="muted pf-pad">Promote couldn't load.</p></>;
  const save = () => {
    const body = { lengths: edit.lengths.split(/[ ,]+/).map(Number).filter((n) => n > 0) };
    for (const p of [...d.places, { id: "hero" }]) body[p.id] = { price: Number(edit[p.id].price) || 0, spots: Number(edit[p.id].spots) || 1, active: edit[p.id].active };
    adminApi("PUT", "/admin/promote/settings", body).then((r) => { toast(r.message); setEdit(null); load(); }).catch((e) => toast(e.message));
  };
  const stop = (b) => {
    const note = window.prompt(`Stop ${b.no} for ${b.tenant}? Say why (the business sees it in its audit log).`);
    if (!note) return;
    adminApi("POST", `/admin/promote/boosts/${b.id}/stop`, { note }).then((r) => { toast(r.message); load(); }).catch((e) => toast(e.message));
  };
  const waiting = d.boosts.filter((b) => b.phase === "checking").length;
  return (
    <>
      <PageHead title="Promote" sub="Boosts businesses buy to show listings first on the website. Prices include VAT."
        actions={<Button variant="outline" icon="settings" onClick={() => setEdit({ lengths: d.lengths.join(", "), ...Object.fromEntries(d.places.map((p) => [p.id, { price: String(p.price), spots: String(p.spots), active: p.active }])), hero: { price: String(d.hero.price), spots: String(d.hero.spots), active: d.hero.active } })}>Prices and spots</Button>} />
      {waiting > 0 && <div className="pf-alert action"><Icon name="landmark" size={18} /><div><b>{waiting} boost{waiting > 1 ? "s" : ""} waiting for a bank transfer check</b><span>Confirm the transfer in Billing → Payments; the boost starts by itself.</span></div><Button size="sm" onClick={() => navigate("/admin/billing")}>Open payments</Button></div>}
      <div className="pf-stats">{d.places.map((p) => <Stat key={p.id} label={p.label} value={`${p.takenToday} / ${p.id === "city" ? `${p.spots} a city` : p.spots}`} note={`${rs(p.price)} a day${p.active ? "" : " · not on sale"}`} />)}</div>
      <BannersPanel />
      <Panel title="Boosts" actions={<Seg value={show} onChange={setShow} options={[{ id: "now", label: "Running and booked" }, { id: "all", label: "All" }]} />}>
        <Table rows={d.boosts} minWidth={980} empty={<p className="pf-pad small muted">No boosts here.</p>} columns={[
          { key: "l", label: "Listing", render: (b) => <span className="pf-two"><b>{b.code} · {b.title}</b><small>{b.no} · {b.tenant}{b.source === "gift" ? " · gift" : ""}</small></span> },
          { key: "p", label: "Place", render: (b) => <span className="pf-person"><Icon name={ICON[b.place]} size={15} /><span className="small">{b.placeLabel}{b.place === "city" && b.city ? ` · ${b.city}` : ""}</span></span> },
          { key: "d", label: "Dates", num: true, render: (b) => <span className="small tnum">{fdate(b.startOn)} – {fdate(b.endOn)}</span> },
          { key: "t", label: "Paid", num: true, align: "right", render: (b) => <span className="pf-two"><b className="tnum">{b.source === "gift" ? "Free" : rs(b.total)}</b><small>{b.invoice || ""}</small></span> },
          { key: "s", label: "Status", render: (b) => <Badge tone={TONE[b.phase]}>{b.phaseLabel}</Badge> },
          { key: "r", label: "Views · clicks", num: true, render: (b) => <span className="small tnum">{b.views.toLocaleString("en-IN")} · {b.clicks}</span> },
          { key: "x", label: "", align: "right", render: (b) => ["live", "scheduled", "listing_off"].includes(b.phase) ? <Button size="sm" variant="ghost" onClick={() => stop(b)}>Stop</Button> : null },
        ]} />
      </Panel>
      <Drawer open={!!edit} onClose={() => setEdit(null)} title="Prices and spots" sub="A new price counts for boosts bought from now."
        footer={edit && <><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={save}>Save</Button></>}>
        {edit && <div className="pf-stack">
          {[...d.places, { id: "hero", label: "Home page banner" }].map((p) => (
            <div key={p.id} className="pf-stack tight" style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
              <b>{p.label}</b>
              <div className="pf-grid-2 tight">
                <Field label="Price a day (Rs., VAT included)"><Input className="input tnum" inputMode="numeric" value={edit[p.id].price} onChange={(e) => setEdit({ ...edit, [p.id]: { ...edit[p.id], price: e.target.value.replace(/\D/g, "") } })} /></Field>
                <Field label={p.id === "city" ? "Spots in each city" : p.id === "hero" ? "Banners that take turns" : "Spots at once"}><Input className="input tnum" inputMode="numeric" value={edit[p.id].spots} onChange={(e) => setEdit({ ...edit, [p.id]: { ...edit[p.id], spots: e.target.value.replace(/\D/g, "") } })} /></Field>
              </div>
              <ToggleRow title="On sale" sub="Off: no new boosts here; running ones keep going." checked={edit[p.id].active} onChange={(v) => setEdit({ ...edit, [p.id]: { ...edit[p.id], active: v } })} />
            </div>
          ))}
          <Field label="Lengths on sale (days)" hint="Separate with commas, like 3, 7, 14, 30."><Input value={edit.lengths} onChange={(e) => setEdit({ ...edit, lengths: e.target.value })} /></Field>
        </div>}
      </Drawer>
    </>
  );
}

// ───── Home page banners ─────
const BTONE = { awaiting: "action", checking: "progress", review: "action", rejected: "problem", scheduled: "progress", live: "done", ended: "neutral", stopped: "neutral", cancelled: "neutral" };

function BannersPanel() {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [view, setView] = useState(null);
  const [add, setAdd] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => adminApi("GET", "/admin/promote/banners").then((r) => setRows(r.data)).catch((e) => { setRows([]); toast(e.message); });
  useEffect(() => { load(); }, []);
  const review = (b, decision) => {
    const note = decision === "reject" ? window.prompt("What should the business change? They see this.") : undefined;
    if (decision === "reject" && !note) return;
    setBusy(true);
    adminApi("POST", `/admin/promote/banners/${b.id}/review`, { decision, note }).then((r) => { toast(r.message); setView(null); load(); }).catch((e) => toast(e.message)).finally(() => setBusy(false));
  };
  const stop = (b) => { const note = window.prompt(`Stop ${b.no}? Say why.`); if (note) adminApi("POST", `/admin/promote/banners/${b.id}/stop`, { note }).then((r) => { toast(r.message); setView(null); load(); }).catch((e) => toast(e.message)); };
  const save = async () => {
    setBusy(true);
    try {
      const r = await adminApi("POST", "/admin/promote/banners", { link: add.link.trim(), title: add.title.trim(), button: add.button.trim(), startOn: add.startOn, endOn: add.endOn, desktop: { data: await fileToBase64(add.desktop) }, mobile: { data: await fileToBase64(add.mobile) } });
      toast(r.message); setAdd(null); load();
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  };
  if (!rows) return <p className="muted pf-pad">Loading banners…</p>;
  const toCheck = rows.filter((b) => b.phase === "review");
  const shown = rows.filter((b) => !["cancelled", "ended", "stopped"].includes(b.phase) || b === view);
  return (
    <>
      {toCheck.length > 0 && <div className="pf-alert action"><Icon name="image" size={18} /><div><b>{toCheck.length} banner picture{toCheck.length > 1 ? "s" : ""} to check</b><span>Paid. Approve to show them on their dates, or ask for a change.</span></div><Button size="sm" onClick={() => setView(toCheck[0])}>Check now</Button></div>}
      <Panel title="Home page banners" sub="Paid ones show first; Sheetal's own fill the spots left." actions={<Button size="sm" icon="image-plus" onClick={() => setAdd({ link: "", title: "", button: "", startOn: "", endOn: "", desktop: null, mobile: null })}>Add Sheetal banner</Button>}>
        <Table rows={shown} minWidth={900} onRowClick={setView} empty={<p className="pf-pad small muted">No banners running or booked.</p>} columns={[
          { key: "p", label: "Banner", render: (b) => <span className="pf-person"><img src={b.desktop} alt="" style={{ width: 96, height: 30, objectFit: "cover", borderRadius: 4 }} /><span className="pf-two"><b>{b.title || b.no}</b><small>{b.no} · {b.tenant}</small></span></span> },
          { key: "d", label: "Dates", num: true, render: (b) => <span className="small tnum">{fdate(b.startOn)} – {fdate(b.endOn)}</span> },
          { key: "t", label: "Paid", num: true, align: "right", render: (b) => (b.source === "staff" ? "Own" : rs(b.total)) },
          { key: "s", label: "Status", render: (b) => <Badge tone={BTONE[b.phase]}>{b.phaseLabel}</Badge> },
          { key: "r", label: "Views · clicks", num: true, render: (b) => <span className="small tnum">{b.views.toLocaleString("en-IN")} · {b.clicks}</span> },
        ]} />
      </Panel>
      <Drawer open={!!view} onClose={() => setView(null)} title={view ? `${view.no} · ${view.tenant}` : ""} sub={view ? `${fdate(view.startOn)} – ${fdate(view.endOn)} · ${view.phaseLabel}` : ""}
        footer={view && <>{view.phase === "review" && <><Button variant="outline" disabled={busy} onClick={() => review(view, "reject")}>Ask for a change</Button><Button icon="check" disabled={busy} onClick={() => review(view, "approve")}>Approve</Button></>}
          {["live", "scheduled", "rejected"].includes(view.phase) && <Button variant="outline" onClick={() => stop(view)}>Stop</Button>}</>}>
        {view && <div className="pf-stack">
          <span className="small muted">Computer (1920 × 600)</span><img src={view.desktop} alt="" style={{ width: "100%", borderRadius: 6 }} />
          <span className="small muted">Phone (1080 × 1080)</span><img src={view.mobile} alt="" style={{ width: "60%", borderRadius: 6 }} />
          <dl className="pf-kv"><dt>Link</dt><dd><a href={view.link} target="_blank" rel="noreferrer">{view.link}</a></dd><dt>Title</dt><dd>{view.title || "—"}</dd><dt>Button</dt><dd>{view.button || "Learn more"}</dd>{view.invoice && <><dt>Invoice</dt><dd className="tnum">{view.invoice}</dd></>}{view.reviewNote && <><dt>Change asked</dt><dd>{view.reviewNote}</dd></>}</dl>
          <p className="small muted" style={{ margin: 0 }}>Check: nothing misleading or against the law, readable, and the link works.</p>
        </div>}
      </Drawer>
      <Drawer open={!!add} onClose={() => !busy && setAdd(null)} title="Add Sheetal banner" sub="Free. Shows when paid banners leave a spot."
        footer={add && <><Button variant="outline" onClick={() => setAdd(null)}>Cancel</Button><Button disabled={busy || !add.desktop || !add.mobile || !add.startOn || !add.endOn || !/^https?:\/\/\S+\.\S+$/i.test(add.link)} onClick={save}>{busy ? "Saving…" : "Add"}</Button></>}>
        {add && <div className="pf-stack">
          <Field label="Picture for computers (1920 × 600, up to 1 MB)"><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(e) => setAdd({ ...add, desktop: e.target.files[0] || null })} /></Field>
          <Field label="Picture for phones (1080 × 1080, up to 1 MB)"><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(e) => setAdd({ ...add, mobile: e.target.files[0] || null })} /></Field>
          <Field label="Link"><Input type="url" placeholder="https://" value={add.link} onChange={(e) => setAdd({ ...add, link: e.target.value })} /></Field>
          <div className="pf-grid-2 tight"><Field label="Title" optional><Input value={add.title} onChange={(e) => setAdd({ ...add, title: e.target.value })} /></Field><Field label="Button text" optional><Input value={add.button} onChange={(e) => setAdd({ ...add, button: e.target.value })} /></Field></div>
          <div className="pf-grid-2 tight"><Field label="From"><Input type="date" value={add.startOn} onChange={(e) => setAdd({ ...add, startOn: e.target.value })} /></Field><Field label="Until"><Input type="date" value={add.endOn} onChange={(e) => setAdd({ ...add, endOn: e.target.value })} /></Field></div>
        </div>}
      </Drawer>
    </>
  );
}
