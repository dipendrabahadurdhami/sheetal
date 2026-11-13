// Plan and billing (LiveBilling and LiveAddons on the business API), the read-only screen for suspended businesses, and backup export.
// Where it fits: Settings → Plan and billing, and Settings → Data.

import React, { useState } from "react";
import { ImportDrawer, TEMPLATES, downloadTemplate } from "@sheetal/shared/components/DataIO";
import { useT } from "@sheetal/shared/core/i18n";
import { fdate } from "@sheetal/shared/core/format";
import { Badge, Button, Empty, PageHead, Panel, Table, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { LiveBilling } from "./LiveBilling";
import { LiveAddons } from "./LiveAddons";

export function BusinessBilling({ tenant, canManage }) {
  // Buying an add-on makes an invoice: the billing panel loads again to show it.
  const [tick, setTick] = useState(0);
  return <><LiveBilling key={tick} tenant={tenant} canManage={canManage} /><LiveAddons tenant={tenant} onChange={() => setTick((n) => n + 1)} /></>;
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
