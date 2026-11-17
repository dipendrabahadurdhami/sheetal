// The first-run tour and the Help page.
// How it works: the tour shows once per business; it can be restarted from the account menu. Signed in, the Help
// page also shows "Message Sheetal" (LiveSupport.jsx): questions to Sheetal's team and their answers.

import React, { useState } from "react";
import { useT } from "@sheetal/shared/core/i18n";
import { Link, useRouter } from "@sheetal/shared/core/router";
import { Button, PageHead, Panel, SearchInput } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { isLive } from "../live";
import { LiveSupport } from "./LiveSupport";
import { searchGuides } from "./setupGuide";

const STEPS = [
  ["sparkles", "tour.s1", "/business"],
  ["users", "tour.s2", "/business/team"],
  ["house-plus", "tour.s3", "/business/listings/new"],
  ["wallet", "tour.s4", "/business/settings"],
  ["life-buoy", "tour.s5", "/business/help"],
];

// First-run walkthrough. Shows once per workspace; restart from the account menu.
export function Tour({ tenant, onDone }) {
  const t = useT();
  const { navigate } = useRouter();
  const [i, setI] = useState(0);
  const [icon, key, to] = STEPS[i];
  return (
    <div className="pf-tour" role="dialog" aria-label={t("tour.label")}>
      <div className="pf-tour-top"><span className="pf-tour-ico"><Icon name={icon} size={20} /></span><span className="tiny muted tnum">{i + 1} / {STEPS.length}</span>
        <button className="btn btn-ghost btn-icon" onClick={onDone} aria-label={t("tour.skip")}><Icon name="x" size={16} /></button></div>
      <b>{t(`${key}Title`, { name: tenant.name })}</b>
      <p className="small">{t(`${key}Text`)}</p>
      <div className="pf-tour-dots">{STEPS.map((_, j) => <i key={j} className={j === i ? "on" : ""} />)}</div>
      <div className="pf-row-actions">
        <Button variant="ghost" size="sm" onClick={onDone}>{t("tour.skip")}</Button>
        {i > 0 && <Button variant="outline" size="sm" onClick={() => navigate(to)}>{t("tour.show")}</Button>}
        <Button size="sm" onClick={() => { if (i < STEPS.length - 1) setI(i + 1); else { onDone(); navigate("/business/start"); } }}>{i < STEPS.length - 1 ? t("common.next") : t("tour.finish")}</Button>
      </div>
    </div>
  );
}

export function Help({ tenant }) {
  const t = useT();
  const { navigate } = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null);
  const guides = searchGuides(q);
  return (
    <>
      <PageHead title={t("help.title")} sub={t("help.sub")} actions={<SearchInput value={q} onChange={setQ} placeholder={t("help.search")} />} />
      <section className="card pf-panel" style={{ padding: 16 }}>
        <div className="row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
          <div><b>New here?</b><div className="small muted">Open the step-by-step guide to set up your business.</div></div>
          <Button icon="map" onClick={() => navigate("/business/start")}>Open Getting started</Button>
        </div>
      </section>
      <div className="pf-help-grid">
        {guides.map((g) => (
          <section key={g.id} className="card pf-help">
            <div className="pf-help-head"><Icon name={g.icon} size={20} /><b>{g.title}</b></div>
            <ul>{g.items.map((it) => {
              const key = `${g.id}:${it.q}`;
              const shown = open === key || !!q.trim();
              return (
                <li key={key} style={{ display: "block" }}>
                  <button type="button" className="link" aria-expanded={shown} onClick={() => setOpen(open === key ? null : key)} style={{ background: "none", border: 0, padding: 0, textAlign: "left", cursor: "pointer", display: "flex", gap: 8, alignItems: "center" }}><Icon name={shown ? "chevron-down" : "chevron-right"} size={15} />{it.q}</button>
                  {shown && (
                    <div style={{ margin: "8px 0 4px 23px" }}>
                      <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>{it.steps.map((x) => <li key={x} style={{ marginBottom: 3 }}>{x}</li>)}</ol>
                      {it.to && <Button size="sm" variant="outline" style={{ marginTop: 8 }} onClick={() => navigate(it.to)}>{it.cta}</Button>}
                    </div>
                  )}
                </li>
              );
            })}</ul>
          </section>
        ))}
        {!guides.length && <p className="muted pf-pad">Nothing matches that. Try another word, or message Sheetal below.</p>}
      </div>
      {tenant && isLive(tenant.id) && <LiveSupport tenant={tenant} />}
      <Panel title={t("help.contact")} sub={t("help.contactSub")} pad>
        <div className="pf-row-actions" style={{ justifyContent: "flex-start" }}>
          <Button icon="message-circle">{t("help.whatsapp")}</Button>
          <Button variant="outline" icon="phone">+977 980-1136817</Button>
          <Button variant="outline" icon="mail">support@sheetalproperty.com</Button>
        </div>
      </Panel>
    </>
  );
}

export { Link };
