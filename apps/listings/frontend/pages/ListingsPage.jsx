// Listings: find, edit, duplicate, pause, publish, archive, mark sold and delete every listing.
// Where it fits: Business → Listings. Moved here from business/frontend/src/pages/ListingsManager.jsx in P2-W6 (that file is the shim); backend apps/listings/backend.
// How it works: signed in, every action goes to the business API and new or edited listings wait for Sheetal's review
// ("In review"); "Needs changes" shows the reviewer's note. With All branches picked, each shows its branch.

import React, { useState } from "react";
import { useT, useLang } from "@sheetal/shared/core/i18n";
import { useStore } from "@sheetal/shared/core/store";
import { useBranch } from "@sheetal/shared/core/branch";
import { useRouter } from "@sheetal/shared/core/router";
import { rsShort } from "@sheetal/shared/core/format";
import { Badge, Button, Checkbox, Confirm, Empty, Menu, Modal, PageHead, SearchInput, Select, StatusBadge, useToast } from "@sheetal/ui/primitives";
import { Icon } from "@sheetal/shared/core/icons";
import { DataActions } from "@sheetal/shared/components/DataIO";
import { OtaCell, OtaDrawer, isStayListing } from "./OtaPanel.jsx";
import { listingCap, planOf } from "@sheetal/shared/core/plans";
import { listingActions, useListingPage } from "../api.js";

const STATUS = [["all", "All statuses"], ["needs_review", "Needs review"], ["published", "Live"], ["in_review", "In review"], ["draft", "Draft"], ["paused", "Paused"], ["rejected", "Needs changes"], ["sold", "Sold"], ["rented", "Rented out"], ["archived", "Archived"]];

function ListingStatus({ s }) {
  if (s === "paused") return <Badge tone="neutral" icon="clock">Paused</Badge>;
  if (s === "archived") return <Badge tone="neutral" icon="archive">Archived</Badge>;
  if (s === "needs_review") return <Badge tone="action" icon="triangle-alert">Needs review</Badge>;
  if (s === "sold" || s === "rented") return <Badge tone="done" icon="handshake">{s === "sold" ? "Sold" : "Rented out"}</Badge>;
  if (s === "rejected") return <Badge tone="problem" icon="pencil">Needs changes</Badge>;
  return <StatusBadge status={s} />;
}

export function ListingsPage({ tenant, canEdit, onChanged }) {
  const t = useT(); const lang = useLang(); const toast = useToast();
  const { db, update } = useStore(); const { navigate } = useRouter();
  const [q, setQ0] = useState(""); const [kind, setKind0] = useState("all"); const [status, setStatus0] = useState("all");
  const [sel, setSel] = useState([]); const [ask, setAsk] = useState(null); const [ota, setOta] = useState(null); const [moving, setMoving] = useState(null); const [shown, setShown] = useState(100);
  const live = listingActions(toast, onChanged);
  // With "All branches" picked, each listing says which branch it belongs to.
  const showBranch = useBranch().branch === "all";
  const setQ = (v) => { setQ0(v); setShown(100); }; const setKind = (v) => { setKind0(v); setShown(100); }; const setStatus = (v) => { setStatus0(v); setShown(100); };
  const draft = db.drafts[tenant.id];
  // The server searches, filters and pages (Sheetal alone has thousands).
  const page = useListingPage(tenant.id, { q, kind, status, per: shown });
  const kinds = db.catalog.listingKinds.filter((k) => (page.meta?.listedKinds || []).includes(k.id));
  const kindName = (k) => { const o = db.catalog.listingKinds.find((x) => x.id === k); return o ? (lang === "ne" ? o.ne : o.en) : k; };
  const stays = (page.rows || []).some(isStayListing);
  const plan = planOf(db, tenant);
  const capped = !!page.meta && page.meta.cap !== -1 && page.meta.used >= page.meta.cap;
  const counts = Object.fromEntries(STATUS.map(([id]) => [id, page.meta?.counts?.[id] || 0]));
  const rows = page.rows || [];
  // How many match the filters (the server knows).
  const total = page.meta?.total ?? 0;
  // The server answers every change with its own message (shown by listingActions).
  const setStatusOf = (ids, s) => { live.setStatus(ids, s); setSel([]); };
  const remove = (ids) => { live.remove(ids); setSel([]); };
  const edit = (l) => {
    live.open(l.id).then((d) => { update((x) => { x.drafts[tenant.id] = { kind: d.kind, values: { ...d.values, title: d.title }, editId: l.id }; }); navigate("/business/listings/new"); }).catch((e) => toast(e.message));
  };
  const duplicate = (l) => { live.duplicate(l.id); };
  const allOn = rows.length > 0 && rows.every((r) => sel.includes(r.id));
  const toggleAll = (v) => setSel(v ? rows.map((r) => r.id) : []);
  const toggle = (id, v) => setSel((s) => (v ? [...s, id] : s.filter((x) => x !== id)));

  return (
    <>
      <PageHead title={t("nav.listings")} sub={counts.published + " live · " + (Object.entries(counts).filter(([k]) => k !== "all").reduce((a, [, n]) => a + n, 0)).toLocaleString("en-IN") + " in total"}
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
                <td><button type="button" className="lm-title" onClick={() => canEdit && edit(l)}><b>{l.title}</b><small className="tnum">{l.id}{l.branch && showBranch ? ` · ${l.branch}` : ""} · {t("listings.updated")} {l.updated}</small>{l.issues?.length > 0 && <small className="lm-issues">{l.issues.join(" · ")}</small>}</button></td>
                <td>{kindName(l.kind)}</td><td><ListingStatus s={l.status} /></td>
                <td className="tnum" style={{ textAlign: "right" }}>{rsShort(l.price)}</td>
                <td className="tnum" style={{ textAlign: "right" }}>{(l.views || 0).toLocaleString("en-IN")}</td>
                <td className="tnum" style={{ textAlign: "right" }}><a href="#" onClick={(e) => { e.preventDefault(); navigate("/business/inbox"); }}>{l.leads || 0}</a></td>
                {stays && <td>{isStayListing(l) && l.status === "published" ? <OtaCell listing={l} onOpen={() => setOta(l)} /> : <span className="small muted">{isStayListing(l) ? "Publish first" : "—"}</span>}</td>}
                <td style={{ textAlign: "right" }}>
                  <div className="pf-row-actions" style={{ justifyContent: "flex-end" }}>
                    {canEdit && <Button variant="ghost" size="sm" icon="pencil" onClick={() => edit(l)}>Edit</Button>}
                    {live && l.status === "published" && <Button variant="ghost" size="sm" icon="rocket" title="Show it first on the website" onClick={() => navigate(`/business/promote/boost/${encodeURIComponent(l.id)}`)}>Boost</Button>}
                    <Menu trigger={({ toggle: tg, open }) => <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-haspopup="menu" aria-expanded={open} aria-label={"More actions for " + l.title} onClick={tg}><Icon name="list" size={16} /></button>}>
                      {live
                        ? l.link && <a data-close="" href={l.link} target="_blank" rel="noreferrer"><Icon name="external-link" size={16} />View on website</a>
                        : <button type="button" data-close="" onClick={() => navigate("/site/" + tenant.id)}><Icon name="external-link" size={16} />View on site</button>}
                      {canEdit && !capped && <button type="button" data-close="" onClick={() => duplicate(l)}><Icon name="copy" size={16} />Duplicate</button>}
                      {canEdit && (l.status === "published"
                        ? <button type="button" data-close="" onClick={() => setStatusOf([l.id], "paused", "Paused. Hidden from the website until you publish again.")}><Icon name="clock" size={16} />Pause</button>
                        : l.status !== "in_review" && <button type="button" data-close="" onClick={() => setStatusOf([l.id], "published", "Published")}><Icon name="send" size={16} />Publish</button>)}
                      <button type="button" data-close="" onClick={() => navigate("/business/analytics")}><Icon name="chart-column" size={16} />{t("nav.analytics")}</button>
                      {live && l.status === "published" && <button type="button" data-close="" onClick={() => navigate(`/business/promote/featured`)}><Icon name="star" size={16} />Free featured slot</button>}
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
            ))}</tbody></table>{total > shown && <div className="pf-pad" style={{ textAlign: "center" }}><Button variant="outline" onClick={() => setShown((n) => n + 100)}>Show more ({(total - shown).toLocaleString("en-IN")} left)</Button></div>}</div>
        ) : live && !page.rows ? (
          <p className="muted pf-pad">Loading listings…</p>
        ) : (counts.all + (counts.archived || 0)) ? (
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
