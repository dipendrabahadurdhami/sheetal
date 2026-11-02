import React, { useState } from "react";
import { ImportDrawer, TEMPLATES, downloadTemplate } from "@sheetal/shared/components/DataIO";
import { useT } from "@sheetal/shared/core/i18n";
import { useStore } from "@sheetal/shared/core/store";
import { fdate, rs, limitText } from "@sheetal/shared/core/format";
import { Badge, Button, Confirm, Empty, PageHead, Panel, Seg, StatusBadge, Table, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { PERIODS, planFeatureList, priceFor, savingFor } from "@sheetal/shared/core/plans";
import { BusinessAddons } from "@sheetal/shared/components/Addons";

export function BusinessBilling({ tenant, canManage }) {
  const t = useT();
  const { db, update } = useStore();
  const toast = useToast();
  const [months, setMonths] = useState(12);
  const [pick, setPick] = useState(null);
  const [cancel, setCancel] = useState(false);
  const plans = db.plans.filter((p) => p.type === tenant.type && p.active);
  const cur = db.plans.find((p) => p.id === tenant.planId);
  const invoices = []; // real invoices come from the billing API
  const change = (p) => { update((d) => { d.tenants.find((x) => x.id === tenant.id).planId = p.id; }); toast(t("billing.toastChanged", { plan: p.name })); };

  return (
    <>
      <PageHead title={t("billing.title")} sub={t("billing.sub")} />
      {tenant.status === "past_due" && (
        <div className="pf-alert action"><Icon name="circle-alert" size={18} /><div><b>{t("billing.pastDue")}</b><span>{t("billing.pastDueText", { days: db.platformSettings.graceDays })}</span></div><Button size="sm" icon="credit-card">{t("bdash.payNow")}</Button></div>
      )}
      <div className="pf-split">
        <Panel title={t("billing.current")} className="grow" pad>
          <div className="pf-cur-plan">
            <div><span className="small muted">{t(`type.${tenant.type}`)}</span><h3>{cur.name}</h3><span className="tnum">{cur.price ? `${rs(priceFor(cur, tenant.period || 1))} ${(tenant.period || 1) === 1 ? t("plans.perMonth") : `for ${(tenant.period || 1) === 12 ? "1 year" : tenant.period + " months"}`}` : "Free · renews every month"}</span></div>
            <dl className="pf-kv">
              <dt>{t("common.status")}</dt><dd><StatusBadge status={tenant.status} /></dd>
              <dt>{t("tenants.renews")}</dt><dd className="tnum">{fdate(tenant.renews)}</dd>
              <dt>Auto-renew</dt><dd>{cur.price ? (tenant.autoRenew ? "On" : <span className="muted">Off · ask Sheetal support to turn it on</span>) : "Starter renews by itself"}</dd>
            </dl>
          </div>
        </Panel>
        <Panel title={t("billing.usage")} className="side" pad>
          <div className="pf-stack">{Object.entries(cur.limits).map(([k, lim]) => (
            <div key={k} className="pf-meter-top"><span>{t(`limit.${k}`)}</span><b className="tnum">{tenant.usage[k] || 0} / {limitText(lim)}</b></div>
          ))}</div>
        </Panel>
      </div>

      <section className="card pf-panel">
        <div className="pf-panel-head"><div className="pf-panel-title"><h2>{t("billing.compare")}</h2><span>{t("billing.compareSub")}</span></div>
          <div className="pf-panel-actions"><Seg value={months} onChange={setMonths} label="Billing period" options={PERIODS.map((x) => ({ id: x.months, label: x.months === 1 ? "1 month" : x.months === 12 ? "1 year" : `${x.months} months` + (x.save ? ` · save ${x.save}%` : "") }))} /></div></div>
        <div className="pf-plan-grid pf-pad">
          {plans.map((p) => {
            const isCur = p.id === cur.id;
            const up = p.price > cur.price;
            return (
              <div key={p.id} className={`card pf-plan ${isCur ? "cur" : ""}`}>
                <div className="pf-plan-top"><h3>{p.name}</h3>{isCur && <Badge tone="done">{t("billing.yourPlan")}</Badge>}</div>
                <div className="pf-price-line"><b className="tnum">{p.price ? rs(priceFor(p, months)) : "Free"}</b><span>{p.price ? (months === 1 ? t("plans.perMonth") : `for ${months === 12 ? "1 year" : months + " months"}`) : "renews every month"}</span></div>
                {p.price > 0 && savingFor(p, months) > 0 && <span className="small pf-tone-done tnum">{t("billing.save", { v: rs(savingFor(p, months)) })}</span>}
                {/* Same full list as the website's plan cards, row for row (shared/src/core/plans.js). */}
                <ul className="pf-plan-feats">
                  {planFeatureList(p, tenant.type, db.aiConfig?.credits).map(([on, text]) => <li key={text} className={on ? "" : "off"}><Icon name={on ? "check" : "minus"} size={15} />{text}</li>)}
                </ul>
                <div className="pf-plan-foot">{!isCur && canManage && <Button variant={up ? "primary" : "outline"} block onClick={() => setPick(p)}>{up ? t("billing.upgrade") : t("billing.downgrade")}</Button>}</div>
              </div>
            );
          })}
        </div>
      </section>

      <BusinessAddons tenant={tenant} canManage={canManage} />
      <Panel title={t("billing.invoices")} actions={<Button variant="outline" size="sm" icon="download">{t("common.exportCsv")}</Button>}>
        <Table rows={invoices} minWidth={560} columns={[
          { key: "id", label: t("billing.invoice"), num: true, render: (r) => <b className="pf-strong">{r.id}</b> },
          { key: "date", label: t("billing.date"), num: true, render: (r) => fdate(r.date) },
          { key: "amount", label: t("billing.amount"), num: true, align: "right", render: (r) => rs(r.amount) },
          { key: "status", label: t("common.status"), render: (r) => <StatusBadge status={r.status} /> },
          { key: "dl", label: "", align: "right", render: (r) => <div className="pf-row-actions">{r.status === "overdue" && <Button size="sm">{t("bdash.payNow")}</Button>}<Button variant="ghost" size="sm" icon="download">PDF</Button></div> },
        ]} />
      </Panel>
      {canManage && <div className="pf-danger-zone"><div><b>{t("billing.cancelTitle")}</b><span className="small muted">{t("billing.cancelText", { d: fdate(tenant.renews) })}</span></div><Button variant="outline" className="pf-danger" onClick={() => setCancel(true)}>{t("billing.cancel")}</Button></div>}

      <Confirm open={!!pick} onClose={() => setPick(null)} onConfirm={() => change(pick)} title={pick ? t("billing.confirmTitle", { plan: pick.name }) : ""} confirmLabel={t("common.confirm")}>
        {pick && (pick.price > cur.price ? t("billing.upText", { v: rs(Math.round(((pick.price - cur.price) * 10) / 30)) }) : t("billing.downText", { d: fdate(tenant.renews) }))}
      </Confirm>
      <Confirm open={cancel} onClose={() => setCancel(false)} danger onConfirm={() => toast(t("billing.toastCancel"))} title={t("billing.cancelTitle")} confirmLabel={t("billing.cancel")}>{t("billing.cancelConfirm", { d: fdate(tenant.renews) })}</Confirm>
    </>
  );
}

// Import and export: CSV/Excel templates per data type, column mapping, full backup.
const TPL_COLS = {
  rooms: [["Room no", 1, "201"], ["Room type", 1, "Deluxe lake view"], ["Beds", 1, "Queen"], ["Max guests", 1, "2"], ["Rate (Rs.)", 1, "6500"], ["Floor", 0, "2"]],
  bookings: [["Guest name", 1, "Sita Gurung"], ["Phone", 1, "9841010101"], ["Room no", 1, "201"], ["Check-in", 1, "2027-03-12"], ["Check-out", 1, "2027-03-15"], ["Amount", 1, "49720"], ["Paid", 0, "14916"]],
  guests: [["Name", 1, "Sita Gurung"], ["Phone", 1, "9841010101"], ["Email", 0, "sita@gmail.com"], ["Nationality", 0, "Nepali"], ["ID no", 0, "27-01-74-01234"], ["Birthday", 0, "1994-03-04"]],
  menu: [["Item", 1, "Chicken momo (10)"], ["Category", 1, "Nepali"], ["Price", 1, "420"], ["VAT", 0, "Yes"], ["Outlet", 0, "Lakeside Café"]],
  listings: [["Title", 1, "4 BHK house for sale"], ["Purpose", 1, "Sale"], ["Category", 1, "House"], ["District", 1, "Kathmandu"], ["Area", 1, "Budhanilkantha"], ["Price", 1, "32000000"], ["Land (aana)", 0, "8"]],
  leads: [["Name", 1, "Rita Maharjan"], ["Phone", 1, "9815550011"], ["Source", 0, "WhatsApp"], ["Interested in", 0, "L-1042"], ["Budget", 0, "30000000"]],
  contacts: [["Name", 1, "Shyam Adhikari"], ["Phone", 1, "9841234500"], ["Citizenship no", 0, "27-01-74-01234"], ["Father's name", 0, "Hari Prasad"], ["Address", 0, "Budhanilkantha-3"]],
};
TPL_COLS.units = TPL_COLS.rooms; TPL_COLS.buyers = TPL_COLS.contacts; TPL_COLS.investors = TPL_COLS.contacts;

export function BackupOnly({ tenant }) {
  const t = useT();
  const toast = useToast();
  return (
    <div className="pf-backup">
      <section className="card pf-panel">
        <div className="pf-pad pf-stack" style={{ alignItems: "center", textAlign: "center" }}>
          <span className="pf-kind-ico"><Icon name="archive" size={26} /></span>
          <h2 style={{ fontSize: 22 }}>{t("backup.title", { name: tenant.name })}</h2>
          <p className="muted" style={{ maxWidth: 520 }}>{t("backup.text")}</p>
          <div className="pf-row-actions" style={{ justifyContent: "center" }}><Button icon="credit-card">{t("backup.renew")}</Button><Button variant="outline" icon="file-spreadsheet" onClick={() => toast(t("data.toastBackup"))}>{t("backup.all")}</Button></div>
        </div>
        <ul className="pf-list">{["bookings", "guests", "listings", "invoices", "agreements", "contacts"].map((k) => <li key={k}><span className="pf-li-ico"><Icon name="file-spreadsheet" size={16} /></span><div><b>{t(`data.ds_${k}`)}</b><span className="small muted">{t("backup.sheet")}</span></div><Button variant="ghost" size="sm" icon="download" onClick={() => toast(t("data.toastExport"))}>Excel</Button></li>)}</ul>
        <p className="pf-hint pf-pad"><Icon name="clock" size={13} />{t("backup.keep")}</p>
      </section>
    </div>
  );
}
const DATASETS = {
  hotel: ["rooms", "bookings", "guests", "menu", "sales", "invoices"],
  host: ["units", "bookings", "guests", "invoices"],
  developer: ["units", "buyers", "reservations", "instalments", "invoices"],
  agency: ["listings", "leads", "contacts", "agreements", "invoices"],
  sponsor: ["investors", "investments", "payouts", "invoices"],
};

export function BusinessData({ tenant }) {
  const t = useT();
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [ds, setDs] = useState(DATASETS[tenant.type][0]);
  const [step, setStep] = useState(0);
  const [imp, setImp] = useState(null);
  const cols = ["Name", "Phone", "Email", "Room / unit", "Check-in", "Amount"];
  const fields = ["name", "phone", "email", "unit", "date", "amount", "skip"];
  const history = [];
  return (
    <>
      <PageHead title={t("data.title")} sub={t("data.sub")} actions={<Button variant="outline" icon="archive" onClick={() => toast(t("data.toastBackup"))}>{t("data.backup")}</Button>} />
      <div className="pf-split">
        <Panel title={t("data.import")} sub={t("data.importSub")} className="grow" pad>
          <div className="pf-stack">
            <div className="pf-chips">{DATASETS[tenant.type].map((d) => <button key={d} className={`chip ${ds === d ? "active" : ""}`} onClick={() => { setDs(d); setStep(0); setFile(null); }}>{t(`data.ds_${d}`)}</button>)}</div>
            {step === 0 && <>
              <div className="pf-tpl">
                <div className="pf-tpl-head"><b>{t("data.tplTitle", { ds: t(`data.ds_${ds}`) })}</b><span className="small muted">{t("data.tplSub")}</span></div>
                <div className="pf-table-wrap"><table className="table pf-table" style={{ minWidth: 560 }}>
                  <thead><tr>{TPL_COLS[ds] ? TPL_COLS[ds].map(([c, req]) => <th key={c}>{c}{req ? " *" : ""}</th>) : <th>—</th>}</tr></thead>
                  <tbody><tr>{(TPL_COLS[ds] || []).map(([c, , ex]) => <td key={c} className="tnum small">{ex}</td>)}</tr></tbody>
                </table></div>
                <div className="pf-row-actions" style={{ justifyContent: "flex-start", padding: "10px 14px" }}><Button variant="outline" size="sm" icon="file-spreadsheet" onClick={() => TEMPLATES[ds] && downloadTemplate(ds, "xlsx")}>{t("data.getXlsx")}</Button><Button variant="ghost" size="sm" icon="download" onClick={() => TEMPLATES[ds] && downloadTemplate(ds)}>CSV</Button><span className="pf-hint">{t("data.tplReq")}</span></div>
              </div>
              <label className="drop pf-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); setFile(e.dataTransfer.files[0]?.name); setStep(1); }}>
                <input type="file" accept=".csv,.xlsx,.xls" hidden onChange={(e) => { setFile(e.target.files[0]?.name); setStep(1); }} />
                <Icon name="file-spreadsheet" size={26} /><b>{t("data.drop")}</b><span className="small muted">{t("data.dropHint")}</span>
              </label>
              <a className="link small" href="#" onClick={(e) => { e.preventDefault(); TEMPLATES[ds] && downloadTemplate(ds); }}><Icon name="download" size={14} />{t("data.template", { ds: t(`data.ds_${ds}`) })}</a>
            </>}
            {step === 1 && <>
              <div className="pf-note"><Icon name="file-spreadsheet" size={16} />{t("data.mapping", { file: file || "file.csv", n: 248 })}</div>
              <div className="pf-map-cols">
                {cols.map((c, i) => <div key={c}><span className="tnum">{c}</span><Icon name="arrow-right" size={14} /><select className="select" defaultValue={fields[i]}>{fields.map((f) => <option key={f} value={f}>{t(`data.f_${f}`)}</option>)}</select></div>)}
              </div>
              <div className="pf-note"><Icon name="circle-alert" size={16} />{t("data.issues", { n: 3 })}</div>
              <div className="pf-row-actions"><Button variant="outline" onClick={() => setStep(0)}>{t("common.back")}</Button><Button onClick={() => { setStep(0); setFile(null); toast(t("data.toastImported", { n: 245 })); }}>{t("data.importN", { n: 245 })}</Button></div>
            </>}
          </div>
        </Panel>
        <Panel title={t("data.export")} sub={t("data.exportSub")} className="side">
          <ul className="pf-list">{DATASETS[tenant.type].map((d) => (
            <li key={d}><div><b>{t(`data.ds_${d}`)}</b></div><div className="pf-row-actions">{TEMPLATES[d] && <Button variant="ghost" size="sm" icon="upload" onClick={() => setImp(d)}>Import</Button>}<Button variant="ghost" size="sm" onClick={() => toast(t("data.toastExport"))}>CSV</Button><Button variant="ghost" size="sm" onClick={() => toast(t("data.toastExport"))}>Excel</Button></div></li>
          ))}</ul>
        </Panel>
      </div>
      {imp && <ImportDrawer kind={imp} open onClose={() => setImp(null)} />}
      <Panel title={t("data.history")}>
        <Table rows={history} minWidth={560} empty={<Empty title={t("data.noHistory")} />} columns={[
          { key: "kind", label: t("data.kind"), render: (r) => <Badge tone={r.kind === "import" ? "progress" : "neutral"} icon={r.kind === "import" ? "upload" : "download"}>{t(`data.${r.kind}`)}</Badge> },
          { key: "what", label: t("data.dataset"), render: (r) => t(`data.ds_${r.what}`) },
          { key: "rows", label: t("data.rows"), num: true, render: (r) => r.rows.toLocaleString("en-IN") },
          { key: "by", label: t("data.by"), render: (r) => r.by },
          { key: "at", label: t("billing.date"), num: true, render: (r) => fdate(r.at) },
        ]} />
      </Panel>
    </>
  );
}
