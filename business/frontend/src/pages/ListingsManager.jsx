import React, { useMemo, useState } from "react";
import { useT, useLang } from "@sheetal/shared/core/i18n";
import { useStore } from "@sheetal/shared/core/store";
import { useRouter } from "@sheetal/shared/core/router";
import { TODAY, rsShort } from "@sheetal/shared/core/format";
import { Badge, Button, Checkbox, Confirm, Empty, Menu, Modal, PageHead, SearchInput, Select, StatusBadge, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { DataActions } from "@sheetal/shared/components/DataIO";
import { OtaCell, OtaDrawer, isStayListing } from "./OtaPanel";
import { atListingCap, listingCap, planOf } from "@sheetal/shared/core/plans";
import { isLive, liveListings } from "../live";

// Listings: one place to find, edit, duplicate, pause, publish, archive and delete every listing.
// "Needs review" holds listings imported from the old site until someone checks and publishes them.
// For a business on the API (../live.js) every action goes to the business API, and new or edited listings wait
// for Sheetal's review ("In review"); "Needs changes" shows the reviewer's note.
const STATUS = [["all", "All statuses"], ["needs_review", "Needs review"], ["published", "Live"], ["in_review", "In review"], ["draft", "Draft"], ["paused", "Paused"], ["rejected", "Needs changes"], ["sold", "Sold"], ["rented", "Rented out"], ["archived", "Archived"]];
const nextId = (list) => "L-" + (Math.max(1100, ...list.map((l) => Number(String(l.id).replace(/\D/g, "")) || 0)) + 1);

function ListingStatus({ s }) {
  if (s === "paused") return <Badge tone="neutral" icon="clock">Paused</Badge>;
  if (s === "archived") return <Badge tone="neutral" icon="archive">Archived</Badge>;
  if (s === "needs_review") return <Badge tone="action" icon="triangle-alert">Needs review</Badge>;
  if (s === "sold" || s === "rented") return <Badge tone="done" icon="handshake">{s === "sold" ? "Sold" : "Rented out"}</Badge>;
  if (s === "rejected") return <Badge tone="problem" icon="pencil">Needs changes</Badge>;
  return <StatusBadge status={s} />;
}

export function ListingsPage({ tenant, canEdit }) {
  const t = useT(); const lang = useLang(); const toast = useToast();
  const { db, update } = useStore(); const { navigate } = useRouter();
  const [q, setQ] = useState(""); const [kind, setKind] = useState("all"); const [status, setStatus] = useState("all");
  const [sel, setSel] = useState([]); const [ask, setAsk] = useState(null); const [ota, setOta] = useState(null); const [moving, setMoving] = useState(null); const [shown, setShown] = useState(100);
  const live = isLive(tenant.id) ? liveListings(toast) : null;
  const all = db.listings.filter((l) => l.tenantId === tenant.id);
  const draft = db.drafts[tenant.id];
  const kinds = db.catalog.listingKinds.filter((k) => all.some((l) => l.kind === k.id));
  const kindName = (k) => { const o = db.catalog.listingKinds.find((x) => x.id === k); return o ? (lang === "ne" ? o.ne : o.en) : k; };
  const stays = all.some(isStayListing);
  const plan = planOf(db, tenant);
  const capped = atListingCap(plan, all.filter((l) => l.status !== "archived" && l.status !== "rejected").length);
  const rows = useMemo(() => all.filter((l) =>
    (kind === "all" || l.kind === kind) &&
    (status === "all" ? l.status !== "archived" : l.status === status) &&
    (!q.trim() || (l.title + " " + l.id).toLowerCase().includes(q.trim().toLowerCase()))), [all, kind, status, q]);
  const counts = Object.fromEntries(STATUS.map(([id]) => [id, id === "all" ? all.filter((l) => l.status !== "archived").length : all.filter((l) => l.status === id).length]));
  const setStatusOf = (ids, s, msg) => { if (live) { live.setStatus(ids, s); setSel([]); return; } update((d) => { d.listings.forEach((l) => { if (ids.includes(l.id)) { l.status = s; l.updated = TODAY.slice(0, 10); if (s === "published") delete l.issues; } }); }); setSel([]); toast(msg); };
  const remove = (ids) => { if (live) { live.remove(ids); setSel([]); return; } update((d) => { d.listings = d.listings.filter((l) => !ids.includes(l.id)); }); setSel([]); toast(ids.length > 1 ? ids.length + " listings deleted" : "Listing deleted"); };
  const edit = (l) => {
    if (live) {
      live.open(l.id).then((d) => { update((x) => { x.drafts[tenant.id] = { kind: d.kind, values: { ...d.values, title: d.title }, editId: l.id }; }); navigate("/business/listings/new"); }).catch((e) => toast(e.message));
      return;
    }
    update((d) => { d.drafts[tenant.id] = { kind: l.kind, values: { ...(l.values || {}), title: l.title }, editId: l.id }; }); navigate("/business/listings/new"); };
  const duplicate = (l) => { if (live) { live.duplicate(l.id); return; } update((d) => { d.listings.unshift({ ...structuredClone(l), id: nextId(d.listings), title: l.title + " (copy)", status: "draft", views: 0, leads: 0, updated: TODAY.slice(0, 10) }); }); toast("Copy saved as a draft"); };
  const allOn = rows.length > 0 && rows.every((r) => sel.includes(r.id));
  const toggleAll = (v) => setSel(v ? rows.map((r) => r.id) : []);
  const toggle = (id, v) => setSel((s) => (v ? [...s, id] : s.filter((x) => x !== id)));

  return (
    <>
      <PageHead title={t("nav.listings")} sub={counts.published + " live · " + all.length + " in total"}
        actions={<><DataActions kind="listings" onlyExport={!canEdit} />{canEdit && <Button icon="plus" onClick={() => { update((d) => { if (d.drafts[tenant.id]?.editId) delete d.drafts[tenant.id]; }); navigate("/business/listings/new"); }}>{t("listings.new")}</Button>}</>} />
      {draft && !draft.editId && (
        <div className="pf-alert progress"><Icon name="file-pen" size={18} /><div><b>{t("listings.draftTitle")}</b><span>{t("listings.draftText", { kind: kindName(draft.kind) })}</span></div><Button size="sm" onClick={() => navigate("/business/listings/new")}>{t("listings.resume")}</Button></div>
      )}
      {capped && canEdit && (
        <div className="pf-alert action"><Icon name="rocket" size={18} /><div><b>{t("plan.capTitle")}</b><span>{listingCap(plan) === 1 ? t("plan.capText") : t("plan.capTextPaid", { n: listingCap(plan) })}</span></div><Button size="sm" onClick={() => navigate("/business/billing")}>{t("plan.upCta")}</Button></div>
      )}
      {counts.needs_review > 0 && status !== "needs_review" && (
        <div className="pf-alert action"><Icon name="triangle-alert" size={18} /><div><b>{counts.needs_review} imported listings need review</b><span>Check the type, location and details, then publish. They stay off the website until then.</span></div><Button size="sm" onClick={() => { setStatus("needs_review"); setSel([]); }}>Review now</Button></div>
      )}
      <div className="lm-toolbar">
        <SearchInput value={q} onChange={setQ} placeholder="Search by title or ID" />
        <Select value={kind} onChange={setKind} aria-label="Type" options={[{ id: "all", label: "All types" }, ...kinds.map((k) => ({ id: k.id, label: lang === "ne" ? k.ne : k.en }))]} />
        <div className="lm-status" role="tablist" aria-label="Status">
          {STATUS.filter(([id]) => id === "all" || counts[id]).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={status === id} className={status === id ? "on" : ""} onClick={() => { setStatus(id); setSel([]); }}>{label}<span className="tnum">{counts[id]}</span></button>
          ))}
        </div>
      </div>
      {sel.length > 0 && canEdit && (
        <div className="lm-bulk" role="region" aria-label="Selected listings">
          <b>{sel.length} selected</b>
          <Button size="sm" variant="outline" icon="send" onClick={() => setStatusOf(sel, "published", "Published")}>Publish</Button>
          <Button size="sm" variant="outline" icon="clock" onClick={() => setStatusOf(sel, "paused", "Paused. Hidden from the website until you publish again.")}>Pause</Button>
          <Button size="sm" variant="outline" icon="archive" onClick={() => setStatusOf(sel, "archived", "Archived")}>Archive</Button>
          <Button size="sm" variant="outline" className="pf-danger" icon="trash-2" onClick={() => setAsk({ ids: sel })}>Delete</Button>
          <Button size="sm" variant="ghost" onClick={() => setSel([])}>Clear</Button>
        </div>
      )}
      <section className="card pf-panel">
        {rows.length ? (
          <div className="pf-table-wrap"><table className="table pf-table lm-table" style={{ minWidth: 820 }}>
            <thead><tr>
              {canEdit && <th style={{ width: 44 }}><Checkbox checked={allOn} onChange={toggleAll} label="" /></th>}
              <th>{t("listings.listing")}</th><th>{t("listings.kind")}</th><th>{t("common.status")}</th>
              <th style={{ textAlign: "right" }}>{t("listings.price")}</th><th style={{ textAlign: "right" }}>{t("listings.views")}</th><th style={{ textAlign: "right" }}>{t("listings.leads")}</th>
              {stays && <th>Other sites</th>}<th />
            </tr></thead>
            <tbody>{rows.slice(0, shown).map((l) => (
              <tr key={l.id} className={sel.includes(l.id) ? "lm-on" : undefined}>
                {canEdit && <td><Checkbox checked={sel.includes(l.id)} onChange={(v) => toggle(l.id, v)} label="" /></td>}
                <td><button type="button" className="lm-title" onClick={() => canEdit && edit(l)}><b>{l.title}</b><small className="tnum">{l.id} · {t("listings.updated")} {l.updated}</small>{l.issues?.length > 0 && <small className="lm-issues">{l.issues.join(" · ")}</small>}</button></td>
                <td>{kindName(l.kind)}</td><td><ListingStatus s={l.status} /></td>
                <td className="tnum" style={{ textAlign: "right" }}>{rsShort(l.price)}</td>
                <td className="tnum" style={{ textAlign: "right" }}>{(l.views || 0).toLocaleString("en-IN")}</td>
                <td className="tnum" style={{ textAlign: "right" }}><a href="#" onClick={(e) => { e.preventDefault(); navigate("/business/inbox"); }}>{l.leads || 0}</a></td>
                {stays && <td>{isStayListing(l) && l.status === "published" ? <OtaCell listing={l} onOpen={() => setOta(l)} /> : <span className="small muted">{isStayListing(l) ? "Publish first" : "—"}</span>}</td>}
                <td style={{ textAlign: "right" }}>
                  <div className="pf-row-actions" style={{ justifyContent: "flex-end" }}>
                    {canEdit && <Button variant="ghost" size="sm" icon="pencil" onClick={() => edit(l)}>Edit</Button>}
                    <Menu trigger={({ toggle: tg, open }) => <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-haspopup="menu" aria-expanded={open} aria-label={"More actions for " + l.title} onClick={tg}><Icon name="list" size={16} /></button>}>
                      {live
                        ? l.link && <a data-close="" href={l.link} target="_blank" rel="noreferrer"><Icon name="external-link" size={16} />View on website</a>
                        : <button type="button" data-close="" onClick={() => navigate("/site/" + tenant.id)}><Icon name="external-link" size={16} />View on site</button>}
                      {canEdit && !capped && <button type="button" data-close="" onClick={() => duplicate(l)}><Icon name="copy" size={16} />Duplicate</button>}
                      {canEdit && (l.status === "published"
                        ? <button type="button" data-close="" onClick={() => setStatusOf([l.id], "paused", "Paused. Hidden from the website until you publish again.")}><Icon name="clock" size={16} />Pause</button>
                        : l.status !== "in_review" && <button type="button" data-close="" onClick={() => setStatusOf([l.id], "published", "Published")}><Icon name="send" size={16} />Publish</button>)}
                      <button type="button" data-close="" onClick={() => navigate("/business/analytics")}><Icon name="chart-column" size={16} />{t("nav.analytics")}</button>
                      <button type="button" data-close="" onClick={() => navigate("/business/agreements")}><Icon name="file-pen-line" size={16} />{t("ag.new")}</button>
                      {stays && isStayListing(l) && l.status === "published" && <button type="button" data-close="" onClick={() => setOta(l)}><Icon name="globe" size={16} />Sell on other sites</button>}
                      {live && canEdit && (l.status === "published" || l.status === "sold" || l.status === "rented") && (l.status === "published"
                        ? <button type="button" data-close="" onClick={() => setStatusOf([l.id], "sold")}><Icon name="handshake" size={16} />{l.kind === "sell" || l.kind === "project" ? "Mark sold" : "Mark rented out"}</button>
                        : <button type="button" data-close="" onClick={() => setStatusOf([l.id], "available")}><Icon name="undo-2" size={16} />Available again</button>)}
                      {live && canEdit && (db.session.memberships || []).length > 1 && <button type="button" data-close="" onClick={() => setMoving(l)}><Icon name="arrow-right-left" size={16} />Move to another business</button>}
                      {canEdit && <div className="pf-menu-sep" />}
                      {canEdit && l.status !== "archived" && <button type="button" data-close="" onClick={() => setStatusOf([l.id], "archived", "Archived")}><Icon name="archive" size={16} />Archive</button>}
                      {canEdit && <button type="button" data-close="" className="pf-danger" onClick={() => setAsk({ ids: [l.id], title: l.title })}><Icon name="trash-2" size={16} />Delete</button>}
                    </Menu>
                  </div>
                </td>
              </tr>
            ))}</tbody></table>{rows.length > shown && <div className="pf-pad" style={{ textAlign: "center" }}><Button variant="outline" onClick={() => setShown((n) => n + 100)}>Show more ({(rows.length - shown).toLocaleString("en-IN")} left)</Button></div>}</div>
        ) : all.length ? (
          <Empty icon="search" title="No listings match" action={<Button variant="outline" onClick={() => { setQ(""); setKind("all"); setStatus("all"); }}>Clear filters</Button>}>Try another type or status.</Empty>
        ) : (
          <Empty icon="house-plus" title={t("listings.none")} action={canEdit && <Button icon="plus" onClick={() => navigate("/business/listings/new")}>{t("listings.new")}</Button>}>{t("listings.noneText")}</Empty>
        )}
      </section>
      <Confirm open={!!ask} onClose={() => setAsk(null)} onConfirm={() => remove(ask.ids)} danger
        title={ask && ask.ids.length > 1 ? "Delete " + ask.ids.length + " listings?" : "Delete this listing?"}
        confirmLabel="Delete">{ask && (ask.title ? "\"" + ask.title + "\" will be removed from your workspace and the website." : "They will be removed from your workspace and the website.") + " Archive instead if you may need it again."}</Confirm>
      {stays && <OtaDrawer tenant={tenant} listing={ota} onClose={() => setOta(null)} />}
      {live && <MoveListing listing={moving} onClose={() => setMoving(null)} actions={live} />}
    </>
  );
}

/** Moves a listing (and its enquiries) to another business the person manages listings in. */
function MoveListing({ listing, onClose, actions }) {
  const [targets, setTargets] = useState(null);
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  React.useEffect(() => {
    setTargets(null); setTo("");
    if (listing) actions.moveTargets(listing.id).then(setTargets).catch(() => setTargets([]));
  }, [listing?.id]);
  const pick = targets?.find((x) => x.id === to);
  const go = () => { setBusy(true); actions.move(listing.id, to).then(onClose).catch(() => {}).finally(() => setBusy(false)); };
  return (
    <Modal open={!!listing} onClose={onClose} title="Move to another business"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button icon="arrow-right-left" disabled={!pick?.allowed || busy} onClick={go}>{busy ? "Moving…" : "Move"}</Button></>}>
      {listing && <p className="muted" style={{ marginTop: 0 }}>“{listing.title}” and its enquiries will belong to the business you pick. Its link on the website stays the same.</p>}
      {!targets ? <p className="muted">Loading your businesses…</p>
        : !targets.length ? <Empty icon="building-2" title="No other business">You can move listings only into a business where you manage listings.</Empty>
        : <div className="pf-stack tight" role="radiogroup" aria-label="Business">
          {targets.map((x) => (
            <label key={x.id} className={"pf-choice" + (to === x.id ? " on" : "") + (x.allowed ? "" : " off")}>
              <input type="radio" name="move-to" value={x.id} checked={to === x.id} disabled={!x.allowed} onChange={() => setTo(x.id)} />
              <span className="pf-two"><b>{x.name}</b><small>{x.type} · {x.plan}{x.allowed ? "" : " · can't list this kind of property"}</small></span>
            </label>
          ))}
        </div>}
    </Modal>
  );
}
