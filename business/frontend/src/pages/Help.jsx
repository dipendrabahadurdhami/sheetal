// The first-run tour and the Help page.
// How it works: the tour shows once per business; it can be restarted from the account menu.

import React, { useState } from "react";
import { useT } from "@sheetal/shared/core/i18n";
import { Link, useRouter } from "@sheetal/shared/core/router";
import { Button, PageHead, Panel, SearchInput } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";

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
        <Button size="sm" onClick={() => (i < STEPS.length - 1 ? setI(i + 1) : onDone())}>{i < STEPS.length - 1 ? t("common.next") : t("tour.finish")}</Button>
      </div>
    </div>
  );
}

const GUIDES = [
  ["rocket", "start", ["g_start1", "g_start2", "g_start3"]],
  ["house-plus", "listings", ["g_list1", "g_list2", "g_list3"]],
  ["store", "pos", ["g_pos1", "g_pos2", "g_pos3"]],
  ["file-signature", "agreements", ["g_ag1", "g_ag2", "g_ag3"]],
  ["wallet", "payments", ["g_pay1", "g_pay2", "g_pay3"]],
  ["users", "team", ["g_team1", "g_team2", "g_team3"]],
];

export function Help() {
  const t = useT();
  const [q, setQ] = useState("");
  const ql = q.toLowerCase();
  return (
    <>
      <PageHead title={t("help.title")} sub={t("help.sub")} actions={<SearchInput value={q} onChange={setQ} placeholder={t("help.search")} />} />
      <div className="pf-help-grid">
        {GUIDES.map(([icon, k, items]) => {
          const list = items.filter((g) => t(`help.${g}`).toLowerCase().includes(ql));
          if (!list.length) return null;
          return (
            <section key={k} className="card pf-help">
              <div className="pf-help-head"><Icon name={icon} size={20} /><b>{t(`help.c_${k}`)}</b></div>
              <ul>{list.map((g) => <li key={g}><a href="#" onClick={(e) => e.preventDefault()}><Icon name="file-text" size={15} />{t(`help.${g}`)}</a></li>)}</ul>
            </section>
          );
        })}
      </div>
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
