import React, { useState } from "react";
import { useT } from "@sheetal/shared/core/i18n";
import { useStore } from "@sheetal/shared/core/store";
import { can } from "@sheetal/shared/core/rbac";
import { fdate, rs, rsShort } from "@sheetal/shared/core/format";
import { Badge, Button, Drawer, Empty, Field, PageHead, Panel, Person, Seg, Select, Stat, Table, Tabs, Textarea, ToggleRow, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { Counter } from "./ListingWizard";
import { Bars, Donut, Funnel, Line } from "@sheetal/shared/core/charts";
import { AIStudio } from "./AI";

/* ───────── People: attendance, leave, shifts, birthdays ───────── */
const LEAVE_TYPES = ["casual", "sick", "home", "festival", "unpaid"];
const seedHR = (members) => ({
  att: members.map((m, i) => ({ id: m.id, name: m.name, in: i % 5 === 4 ? null : `0${7 + (i % 3)}:${["02", "14", "48", "55", "31"][i % 5]}`, out: i === 1 ? "17:05" : null, place: i % 4 === 3 ? "away" : "office", dist: [12, 30, 8, 2400, 45][i % 5], late: i % 3 === 2 })),
  leaves: [
    { id: "lv1", name: members[2]?.name || "Bikash Thapa", type: "festival", from: "2027-03-14", days: 2, note: "Holi at home", status: "pending" },
    { id: "lv2", name: members[4]?.name || "Ramesh Shrestha", type: "sick", from: "2027-02-27", days: 1, note: "Fever", status: "approved" },
    { id: "lv3", name: members[3]?.name || "Anjali Rai", type: "casual", from: "2027-03-20", days: 1, note: "", status: "pending" },
  ],
  balance: { casual: 6, sick: 12, home: 18, festival: 4, unpaid: 0 },
  birthdays: members.slice(0, 4).map((m, i) => ({ name: m.name, date: ["2027-03-04", "2027-03-11", "2027-03-29", "2027-04-02"][i] })),
  wish: { on: true, time: "08:00", sms: true, wa: true, email: false, text: "Happy birthday, {name}! Wishing you a wonderful year ahead from all of us at {business}." },
  geofence: { on: true, radius: 100, place: "Lakeside office" },
});

export function People({ tenant, role, embedded }) {
  const t = useT();
  const toast = useToast();
  const { db, update } = useStore();
  const members = db.members[tenant.id] || [];
  const hr = db.hr?.[tenant.id] || seedHR(members);
  const setHR = (fn) => update((d) => { d.hr = d.hr || {}; d.hr[tenant.id] = d.hr[tenant.id] || seedHR(members); fn(d.hr[tenant.id]); });
  const manage = can(role, "team.manage");
  const [tab, setTab] = useState("today");
  const [apply, setApply] = useState(false);
  const [lv, setLv] = useState({ type: "casual", days: 1, from: "2027-03-10", note: "" });
  const me = hr.att[0];
  const present = hr.att.filter((a) => a.in).length;

  const checkIn = () => {
    const finish = (dist) => { setHR((h) => { const a = h.att[0]; if (!a.in) { a.in = new Date().toTimeString().slice(0, 5); a.dist = dist; a.place = dist <= h.geofence.radius ? "office" : "away"; } else a.out = new Date().toTimeString().slice(0, 5); }); toast(me.in ? t("hr.toastOut") : t("hr.toastIn")); };
    if (navigator.geolocation && !me.in) navigator.geolocation.getCurrentPosition(() => finish(18), () => finish(18), { timeout: 3000 }); else finish(18);
  };

  return (
    <>
      {(() => { const btn = <Button icon={me.in && !me.out ? "log-out" : "log-in"} onClick={checkIn} disabled={!!me.out}>{me.out ? t("hr.doneToday") : me.in ? t("hr.checkOut") : t("hr.checkIn")}</Button>;
        return embedded ? <div className="pf-row-actions" style={{ justifyContent: "space-between" }}><span className="small muted">{t("hr.sub")}</span>{btn}</div> : <PageHead title={t("hr.title")} sub={t("hr.sub")} actions={btn} />; })()}
      <div className="pf-stats">
        <Stat label={t("hr.present")} value={`${present} / ${hr.att.length}`} note={t("hr.late", { n: hr.att.filter((a) => a.in && a.late).length })} />
        <Stat label={t("hr.onLeave")} value={hr.leaves.filter((l) => l.status === "approved" && l.from === "2027-03-02").length} note={t("hr.today")} />
        <Stat label={t("hr.requests")} value={hr.leaves.filter((l) => l.status === "pending").length} note={t("hr.waiting")} tone="action" noteIcon="circle-alert" />
        <Stat label={t("hr.myCheckIn")} value={me.in || "—"} note={me.in ? t(`hr.p_${me.place}`, { m: me.dist }) : t("hr.notYet")} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "today", label: t("hr.tToday"), icon: "map-pin" }, { id: "leave", label: t("hr.tLeave"), icon: "calendar-days", count: hr.leaves.filter((l) => l.status === "pending").length }, { id: "week", label: t("hr.tWeek"), icon: "calendar-range" }, { id: "birthdays", label: t("hr.tBirthdays"), icon: "cake" }, ...(manage ? [{ id: "rules", label: t("hr.tRules"), icon: "settings" }] : [])]} />

      {tab === "today" && <section className="card pf-panel"><Table rows={hr.att} minWidth={720} columns={[
        { key: "n", label: t("team.member"), render: (a) => <Person name={a.name} /> },
        { key: "in", label: t("hr.in"), num: true, render: (a) => a.in ? <span className={a.late ? "pf-tone-action" : undefined}>{a.in}{a.late ? ` · ${t("hr.lateTag")}` : ""}</span> : "—" },
        { key: "out", label: t("hr.out"), num: true, render: (a) => a.out || "—" },
        { key: "where", label: t("hr.where"), render: (a) => a.in ? <Badge tone={a.place === "office" ? "done" : "action"} icon={a.place === "office" ? "map-pin" : "map-pin-off"}>{t(`hr.p_${a.place}`, { m: a.dist })}</Badge> : <Badge tone="neutral">{t("hr.absent")}</Badge> },
      ]} /></section>}

      {tab === "leave" && <>
        <div className="pf-split">
          <section className="card pf-panel grow">
            <div className="pf-panel-head"><div className="pf-panel-title"><h2>{t("hr.leaveRequests")}</h2></div><Button size="sm" icon="plus" onClick={() => setApply(true)}>{t("hr.apply")}</Button></div>
            <Table rows={hr.leaves} minWidth={640} columns={[
              { key: "n", label: t("team.member"), render: (l) => <span className="pf-two"><b>{l.name}</b><small>{l.note || "—"}</small></span> },
              { key: "t", label: t("hr.type"), render: (l) => t(`hr.lt_${l.type}`) },
              { key: "d", label: t("hr.dates"), num: true, render: (l) => `${fdate(l.from)} · ${t("hr.days", { n: l.days })}` },
              { key: "s", label: t("common.status"), render: (l) => <Badge tone={l.status === "approved" ? "done" : l.status === "declined" ? "neutral" : "action"}>{t(`hr.s_${l.status}`)}</Badge> },
              { key: "x", label: "", align: "right", render: (l) => manage && l.status === "pending" && <div className="pf-row-actions">
                <Button variant="outline" size="sm" onClick={() => setHR((h) => { h.leaves.find((x) => x.id === l.id).status = "declined"; })}>{t("bk.decline")}</Button>
                <Button size="sm" onClick={() => { setHR((h) => { h.leaves.find((x) => x.id === l.id).status = "approved"; }); toast(t("hr.toastApproved")); }}>{t("common.approve")}</Button></div> },
            ]} />
          </section>
          <Panel title={t("hr.myBalance")} className="side"><ul className="pf-list">{LEAVE_TYPES.map((k) => <li key={k}><div><b>{t(`hr.lt_${k}`)}</b></div><b className="tnum">{t("hr.days", { n: hr.balance[k] })}</b></li>)}</ul></Panel>
        </div>
        <Drawer open={apply} onClose={() => setApply(false)} title={t("hr.apply")}
          footer={<><Button variant="outline" onClick={() => setApply(false)}>{t("common.cancel")}</Button><Button icon="send" onClick={() => { setHR((h) => { h.leaves.unshift({ id: Math.random().toString(36).slice(2), name: members[0]?.name, ...lv, status: "pending" }); }); setApply(false); toast(t("hr.toastApplied")); }}>{t("hr.send")}</Button></>}>
          <div className="pf-stack">
            <Field label={t("hr.type")}><div className="pf-tiles">{LEAVE_TYPES.map((k) => <button key={k} className={lv.type === k ? "on" : ""} onClick={() => setLv({ ...lv, type: k })}><Icon name={{ casual: "coffee", sick: "thermometer", home: "house", festival: "party-popper", unpaid: "wallet" }[k]} size={18} /><span>{t(`hr.lt_${k}`)}</span></button>)}</div></Field>
            <Field label={t("hr.start")}><div className="pf-chips">{[["2027-03-03", "tomorrow"], ["2027-03-10", "nextweek"], ["2027-03-14", "holi"]].map(([d, k]) => <button key={d} className={`chip ${lv.from === d ? "active" : ""}`} onClick={() => setLv({ ...lv, from: d })}>{t(`hr.d_${k}`)} · {fdate(d)}</button>)}</div></Field>
            <Field label={t("hr.howMany")}><Counter value={lv.days} min={1} max={30} onChange={(n) => setLv({ ...lv, days: n })} label={t("hr.howMany")} /></Field>
            <Field label={t("hr.note")} optional><Textarea rows={2} value={lv.note} onChange={(e) => setLv({ ...lv, note: e.target.value })} style={{ minHeight: 70 }} /></Field>
          </div>
        </Drawer>
      </>}

      {tab === "week" && <section className="card pf-panel"><div className="pf-table-wrap"><table className="table pf-table pf-roster" style={{ minWidth: 820 }}>
        <thead><tr><th>{t("team.member")}</th>{["Sun 28", "Mon 1", "Tue 2", "Wed 3", "Thu 4", "Fri 5", "Sat 6"].map((d) => <th key={d} className="tnum">{d}</th>)}</tr></thead>
        <tbody>{members.map((m, i) => <tr key={m.id}><td><Person name={m.name} size={30} /></td>{[0, 1, 2, 3, 4, 5, 6].map((d) => { const k = (i + d) % 6 === 5 ? "off" : (i + d) % 3 === 0 ? "night" : (i + d) % 3 === 1 ? "morning" : "day"; return <td key={d}><span className={`pf-shift ${k}`}>{t(`hr.sh_${k}`)}</span></td>; })}</tr>)}</tbody>
      </table></div></section>}

      {tab === "birthdays" && <div className="pf-split">
        <Panel title={t("hr.upcoming")} className="grow"><ul className="pf-list">{hr.birthdays.map((b) => <li key={b.name}><Person name={b.name} /><div><span className="small muted tnum">{fdate(b.date)}</span></div>{b.date === "2027-03-04" ? <Badge tone="action" icon="cake">{t("hr.inTwoDays")}</Badge> : null}</li>)}</ul></Panel>
        <Panel title={t("hr.autoWish")} className="side" pad><div className="pf-stack">
          <ToggleRow title={t("hr.autoWishOn")} sub={t("hr.autoWishSub", { time: hr.wish.time })} checked={hr.wish.on} onChange={(v) => setHR((h) => { h.wish.on = v; })} />
          <div className="pf-chips">{[["wa", "WhatsApp"], ["email", t("common.email")]].map(([k, l]) => <button key={k} className={`chip ${hr.wish[k] ? "active" : ""}`} onClick={() => setHR((h) => { h.wish[k] = !h.wish[k]; })}>{hr.wish[k] && <Icon name="check" size={14} />}{l}</button>)}</div>
          <Field label={t("hr.message")} hint={t("hr.messageHint")}><Textarea rows={3} value={hr.wish.text} onChange={(e) => setHR((h) => { h.wish.text = e.target.value; })} style={{ minHeight: 90 }} /></Field>
          <div className="pf-note"><Icon name="cake" size={16} />{hr.wish.text.replace("{name}", hr.birthdays[0]?.name.split(" ")[0] || "Sita").replace("{business}", tenant.name)}</div>
          <ToggleRow title={t("hr.wishGuests")} sub={t("hr.wishGuestsSub")} checked onChange={() => {}} />
        </div></Panel>
      </div>}

      {tab === "rules" && <Panel title={t("hr.tRules")} pad><div className="pf-stack">
        <ToggleRow title={t("hr.geofence")} sub={t("hr.geofenceSub", { place: hr.geofence.place })} checked={hr.geofence.on} onChange={(v) => setHR((h) => { h.geofence.on = v; })} />
        <Field label={t("hr.radius")}><Seg value={String(hr.geofence.radius)} onChange={(v) => setHR((h) => { h.geofence.radius = Number(v); })} options={["50", "100", "250", "500"].map((x) => ({ id: x, label: `${x} m` }))} /></Field>
        <Field label={t("hr.lateAfter")}><Seg value="09:15" onChange={() => {}} options={["09:00", "09:15", "09:30", "10:00"].map((x) => ({ id: x, label: x }))} /></Field>
        <ToggleRow title={t("hr.selfie")} sub={t("hr.selfieSub")} checked={false} onChange={() => {}} />
        <ToggleRow title={t("hr.payrollExport")} sub={t("hr.payrollExportSub")} checked onChange={() => {}} />
      </div></Panel>}
    </>
  );
}

/* ───────── Analytics ───────── */
const MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];
export function Analytics({ tenant }) {
  const t = useT();
  const [range, setRange] = useState("12m");
  const stay = tenant.type === "hotel" || tenant.type === "host";
  const rev = [182, 164, 128, 96, 104, 176, 248, 262, 214, 196, 238, 312].map((v, i) => ({ label: MONTHS[i], v: v * 1000 }));
  const occ = [62, 58, 41, 33, 36, 61, 84, 88, 72, 66, 74, 79];
  const last = [55, 52, 44, 30, 31, 55, 79, 81, 70, 60, 69, 71];
  return (
    <>
      <PageHead title={t("an.title")} sub={t("an.sub")} actions={<><Seg value={range} onChange={setRange} options={[{ id: "30d", label: t("an.30d") }, { id: "90d", label: t("an.90d") }, { id: "12m", label: t("an.12m") }]} /><Button variant="outline" icon="download">{t("common.export")}</Button></>} />
      <div className="pf-stats">
        <Stat label={t("an.revenue")} value={rsShort(rev.reduce((s, x) => s + x.v, 0))} note={t("an.vsLy", { p: "+18%" })} noteIcon="trending-up" />
        <Stat label={stay ? t("an.occupancy") : t("an.conversion")} value={stay ? "66%" : "4.8%"} note={t("an.vsLy", { p: "+6 pts" })} noteIcon="trending-up" />
        <Stat label={stay ? t("an.adr") : t("an.avgDeal")} value={stay ? rs(6240) : rsShort(18400000)} note={t("an.vsLy", { p: "+4%" })} noteIcon="trending-up" />
        <Stat label={t("an.repeat")} value="23%" note={t("an.repeatNote")} />
      </div>
      <div className="pf-split">
        <Panel title={t("an.revByMonth")} sub={t("an.revByMonthSub")} className="grow" pad><Bars data={rev} format={rs} /></Panel>
        <Panel title={t("an.sources")} sub={t("an.sourcesSub")} className="side" pad>
          <Donut center="412" data={[{ label: "Sheetal", v: 46 }, { label: t("src.direct"), v: 18 }, { label: "Booking.com", v: 17 }, { label: "Airbnb", v: 11 }, { label: t("src.walkin"), v: 8 }]} />
        </Panel>
      </div>
      <div className="pf-split">
        <Panel title={stay ? t("an.occByMonth") : t("an.leadsByMonth")} sub={t("an.thisVsLast")} className="grow" pad><Line labels={MONTHS} max={100} series={[{ name: t("an.thisYear"), data: occ }, { name: t("an.lastYear"), data: last }]} /></Panel>
        <Panel title={t("an.funnel")} sub={t("an.funnelSub")} className="side" pad>
          <Funnel steps={[{ label: t("an.f_views"), v: 18420 }, { label: t("an.f_enquiries"), v: 1260 }, { label: t("an.f_visits"), v: 410 }, { label: t("an.f_booked"), v: 236 }]} />
        </Panel>
      </div>
      <Panel title={t("an.top")} sub={t("an.topSub")}>
        <Table minWidth={640} rows={[["Deluxe lake view", 1820, 86, 548000], ["Family suite", 940, 41, 412000], ["Garden villa", 760, 22, 386000], ["Standard twin", 1210, 64, 201000]].map(([n, v, b, r], i) => ({ id: i, n, v, b, r }))} columns={[
          { key: "n", label: stay ? t("an.roomType") : t("listings.listing"), render: (x) => <b className="pf-strong">{x.n}</b> },
          { key: "v", label: t("listings.views"), num: true, align: "right", render: (x) => x.v.toLocaleString("en-IN") },
          { key: "b", label: t("an.bookings"), num: true, align: "right", render: (x) => x.b },
          { key: "c", label: t("an.conv"), num: true, align: "right", render: (x) => `${((x.b / x.v) * 100).toFixed(1)}%` },
          { key: "r", label: t("an.revenue"), num: true, align: "right", render: (x) => rs(x.r) },
        ]} />
      </Panel>
    </>
  );
}

/* Admin: site traffic */
export function AdminAnalytics() {
  const t = useT();
  const days = ["24", "25", "26", "27", "28", "1", "2"];
  return (
    <>
      <PageHead title={t("an.traffic")} sub={t("an.trafficSub")} actions={<Badge tone="done" icon="radio">{t("an.liveNow", { n: 38 })}</Badge>} />
      <div className="pf-stats">
        <Stat label={t("an.visitors")} value="24,810" note={t("an.vsLw", { p: "+9%" })} noteIcon="trending-up" />
        <Stat label={t("an.signups")} value="312" note={t("an.vsLw", { p: "+14%" })} noteIcon="trending-up" />
        <Stat label={t("an.enquiries")} value="1,946" note={t("an.vsLw", { p: "+6%" })} noteIcon="trending-up" />
        <Stat label={t("an.bounce")} value="41%" note={t("an.vsLw", { p: "−3 pts" })} noteIcon="trending-down" />
      </div>
      <div className="pf-split">
        <Panel title={t("an.visitsByDay")} className="grow" pad><Line labels={days} series={[{ name: t("an.visitors"), data: [3120, 3340, 2980, 3610, 4020, 3870, 3870] }, { name: t("an.enquiries"), data: [240, 262, 230, 301, 344, 298, 271] }]} /></Panel>
        <Panel title={t("an.devices")} className="side" pad><Donut center="24.8k" data={[{ label: t("an.mobile"), v: 71 }, { label: t("an.desktop"), v: 24 }, { label: t("an.tablet"), v: 5 }]} /></Panel>
      </div>
      <div className="pf-split">
        <Panel title={t("an.topPages")} className="grow"><Table minWidth={520} rows={[["/stays?city=pokhara", 4820], ["/project/shetal-heights", 3110], ["/buy?area=budhanilkantha", 2640], ["/rent?city=lalitpur", 2210], ["/investment/chitwan-jungle-lodge", 1480]].map(([p, v]) => ({ id: p, p, v }))} columns={[{ key: "p", label: t("an.page"), render: (r) => <code>{r.p}</code> }, { key: "v", label: t("an.visits"), num: true, align: "right", render: (r) => r.v.toLocaleString("en-IN") }]} /></Panel>
        <Panel title={t("an.cities")} className="side"><ul className="pf-bars">{[["Kathmandu", 42], ["Pokhara", 18], ["Lalitpur", 12], ["Abroad (NRN)", 16], ["Other", 12]].map(([c, v]) => <li key={c}><span>{c}</span><div className="bar"><i style={{ width: `${v * 2}%` }} /></div><b className="tnum">{v}%</b></li>)}</ul></Panel>
      </div>
    </>
  );
}

/* ───────── Developers: API keys, webhooks, embeds ───────── */
const SNIPPETS = {
  html: (k) => `<div id="shetal-listings" data-business="t1" data-type="stays"></div>\n<script src="https://sheetalproperty.com/embed.js" data-key="${k}" async></script>`,
  wordpress: () => `// 1. Install the "Sheetal Listings" plugin\n// 2. Settings → Sheetal → paste your API key\n// 3. Put a shortcode on any page:\n[shetal_listings type="stays" limit="6"]\n[shetal_booking listing="S-201"]`,
  react: (k) => `import { useEffect, useState } from "react";\n\nexport function Listings() {\n  const [items, setItems] = useState([]);\n  useEffect(() => {\n    fetch("https://api.sheetalproperty.com/v1/listings?business=t1", {\n      headers: { Authorization: "Bearer ${k}" },\n    }).then((r) => r.json()).then((d) => setItems(d.data));\n  }, []);\n  return items.map((l) => <a key={l.id} href={l.url}>{l.title}</a>);\n}`,
  php: (k) => `<?php\n$ch = curl_init("https://api.sheetalproperty.com/v1/listings?business=t1");\ncurl_setopt($ch, CURLOPT_HTTPHEADER, ["Authorization: Bearer ${k}"]);\ncurl_setopt($ch, CURLOPT_RETURNTRANSFER, true);\n$listings = json_decode(curl_exec($ch), true)["data"];\nforeach ($listings as $l) echo "<a href='{$l['url']}'>{$l['title']}</a>";`,
};
export function Developers({ tenant }) {
  const t = useT();
  const toast = useToast();
  const [tab, setTab] = useState("keys");
  const [lang, setLang] = useState("html");
  const [keys, setKeys] = useState([{ id: "k1", name: "Website", key: "sk_live_7Hq2…9fXa", scopes: ["listings:read", "bookings:write"], last: "2027-03-02", created: "2027-01-20" }, { id: "k2", name: "WordPress plugin", key: "sk_live_Lp4c…2mQe", scopes: ["listings:read"], last: "2027-02-28", created: "2027-02-01" }]);
  const hooks = [["https://lakesideretreat.com.np/hooks/shetal", ["booking.created", "payment.received"], "ok"], ["https://hooks.zapier.com/abc123", ["lead.created"], "ok"]];
  return (
    <>
      <PageHead title={t("dev.title")} sub={t("dev.sub")} actions={<Button variant="outline" icon="book-open">{t("dev.docs")}</Button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "keys", label: t("dev.keys"), icon: "key-round" }, { id: "embed", label: t("dev.embed"), icon: "code" }, { id: "hooks", label: t("dev.hooks"), icon: "webhook" }, { id: "blog", label: t("ai.t_blog"), icon: "pen-line" }, { id: "ask", label: t("ai.t_ask"), icon: "message-circle-question" }]} />
      {(tab === "blog" || tab === "ask") && <AIStudio key={tab} tenant={tenant} only={tab} />}
      {tab === "keys" && <section className="card pf-panel">
        <div className="pf-panel-head"><div className="pf-panel-title"><h2>{t("dev.keys")}</h2><span>{t("dev.keysSub")}</span></div><Button size="sm" icon="plus" onClick={() => { setKeys([{ id: `k${Date.now()}`, name: t("dev.newKey"), key: `sk_live_${Math.random().toString(36).slice(2, 6)}…${Math.random().toString(36).slice(2, 6)}`, scopes: ["listings:read"], last: "—", created: "2027-03-02" }, ...keys]); toast(t("dev.toastKey")); }}>{t("dev.create")}</Button></div>
        <Table rows={keys} minWidth={720} columns={[
          { key: "n", label: t("dev.name"), render: (k) => <span className="pf-two"><b>{k.name}</b><small className="tnum">{t("dev.created", { d: fdate(k.created) })}</small></span> },
          { key: "k", label: t("dev.key"), render: (k) => <code>{k.key}</code> },
          { key: "s", label: t("dev.scopes"), render: (k) => <span className="pf-chips">{k.scopes.map((s) => <Badge key={s} tone="neutral" icon="key-round">{s}</Badge>)}</span> },
          { key: "l", label: t("dev.lastUsed"), num: true, render: (k) => (k.last === "—" ? "—" : fdate(k.last)) },
          { key: "x", label: "", align: "right", render: (k) => <Button variant="ghost" size="sm" onClick={() => { setKeys(keys.filter((x) => x.id !== k.id)); toast(t("dev.toastRevoked")); }}>{t("team.revoke")}</Button> },
        ]} />
      </section>}
      {tab === "embed" && <div className="pf-split">
        <section className="card pf-panel grow">
          <div className="pf-panel-head"><div className="pf-panel-title"><h2>{t("dev.embed")}</h2><span>{t("dev.embedSub")}</span></div><Seg value={lang} onChange={setLang} options={[{ id: "html", label: "HTML" }, { id: "wordpress", label: "WordPress" }, { id: "react", label: "React" }, { id: "php", label: "PHP" }]} /></div>
          <pre className="pf-code"><code>{SNIPPETS[lang](keys[0]?.key || "YOUR_KEY")}</code></pre>
          <div className="pf-panel-foot"><span className="small muted">{t("dev.embedNote")}</span><Button variant="outline" size="sm" icon="copy" onClick={() => { navigator.clipboard?.writeText(SNIPPETS[lang](keys[0]?.key)); toast(t("dom.copied")); }}>{t("dom.copy")}</Button></div>
        </section>
        <Panel title={t("dev.widgets")} className="side"><ul className="pf-list">{["w_listings", "w_booking", "w_chat", "w_reviews", "w_calc"].map((w) => <li key={w}><span className="pf-li-ico"><Icon name={{ w_listings: "layout-grid", w_booking: "calendar-check", w_chat: "message-circle", w_reviews: "star", w_calc: "calculator" }[w]} size={16} /></span><div><b>{t(`dev.${w}`)}</b><span className="small muted">{t(`dev.${w}Sub`)}</span></div></li>)}</ul></Panel>
      </div>}
      {tab === "hooks" && <section className="card pf-panel">
        <div className="pf-panel-head"><div className="pf-panel-title"><h2>{t("dev.hooks")}</h2><span>{t("dev.hooksSub")}</span></div><Button size="sm" icon="plus">{t("dev.addHook")}</Button></div>
        <Table rows={hooks.map(([url, ev, st], i) => ({ id: i, url, ev, st }))} minWidth={640} columns={[
          { key: "u", label: t("dev.endpoint"), render: (h) => <code>{h.url}</code> },
          { key: "e", label: t("dev.events"), render: (h) => <span className="small">{h.ev.join(", ")}</span> },
          { key: "s", label: t("common.status"), render: () => <Badge tone="done">{t("dev.delivering")}</Badge> },
          { key: "x", label: "", align: "right", render: () => <Button variant="ghost" size="sm" icon="send" onClick={() => toast(t("dev.toastTest"))}>{t("dev.test")}</Button> },
        ]} />
      </section>}
    </>
  );
}

export { Select, Empty };
