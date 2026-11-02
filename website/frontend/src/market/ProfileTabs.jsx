import React, { useState } from "react";
import { StoreProvider, useStore } from "@sheetal/shared/core/store";
import { RouterProvider } from "@sheetal/shared/core/router";
import { ToastProvider, ToggleRow, Field, Seg, Button, Badge, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { THEMES, applyTheme, readTheme } from "@sheetal/shared/core/theme";
import { Account } from "./Orders";
import { SavedBody } from "./Market";
import "@sheetal/shared/styles/platform.css";

// Tabs for your existing My profile page (master prompt §9, §17, §20, §26.3, §29).
// Usage in pages/Profile.jsx:  <PlatformProfileTab tab="orders" />  (orders | investments | enquiries | payments | saved | settings)
function Settings({ section }) {
  const show = (k) => !section || section === k;
  const toast = useToast();
  const [n, setN] = useState({ inapp: true, email: true, sms: true, wa: true, marketing: false });
  const { db, update } = useStore();
  const [twofa, setTwofa] = useState(false);
  const [bs, setBs] = useState(true);
  const [theme, setThemeS] = useState(readTheme);
  const lang = db.session.lang;
  const setLang = (v) => { update((d) => { d.session.lang = v; }); toast(v === "ne" ? "भाषा नेपालीमा बदलियो" : "Language set to English"); };
  return (
    <div className="pf-stack" style={{ maxWidth: 720 }}>
      {show("security") && <section className="card pf-pad pf-stack"><b>Sign-in</b>
        <div className="pf-row-actions" style={{ justifyContent: "space-between" }}><span className="pf-person"><Icon name="globe" size={18} /><span className="pf-two"><b>Google</b><small>Not linked</small></span></span><Button variant="outline" size="sm" onClick={() => toast("Google account linked")}>Link Google</Button></div>
        <div className="pf-row-actions" style={{ justifyContent: "space-between" }}><span className="pf-person"><Icon name="smartphone" size={18} /><span className="pf-two"><b>Phone</b><small className="tnum">98XXXXXXXX · verified</small></span></span><Button variant="ghost" size="sm" onClick={() => toast("Code sent")}>Change</Button></div>
        <ToggleRow title="Two-step sign-in" sub="A code by SMS when you sign in on a new device" checked={twofa} onChange={(v) => { setTwofa(v); toast(v ? "Two-step sign-in turned on" : "Two-step sign-in turned off"); }} />
        <Button variant="outline" size="sm" icon="log-out" onClick={() => toast("Signed out on all other devices")}>Sign out of all other devices</Button>
      </section>}
      {show("notifications") && <section className="card pf-pad pf-stack"><b>Notifications</b>
        {[["inapp", "In the app"], ["email", "Email"], ["sms", "SMS"], ["wa", "WhatsApp"], ["marketing", "Offers and news"]].map(([k, l]) => <ToggleRow key={k} title={l} sub={k === "marketing" ? "At most twice a month" : "Bookings, payments, refunds and updates"} checked={n[k]} onChange={(v) => setN({ ...n, [k]: v })} />)}
      </section>}
      {show("language") && <section className="card pf-pad pf-stack"><b>Language and display</b>
        <Field label="Language"><Seg value={lang} onChange={setLang} options={[{ id: "en", label: "English" }, { id: "ne", label: "नेपाली" }]} /></Field>
        <Field label="Theme"><Seg value={theme} onChange={(v) => { applyTheme(v); setThemeS(v); }} options={THEMES.map((x) => ({ id: x.id, label: x.id[0].toUpperCase() + x.id.slice(1), icon: x.icon }))} /></Field>
        <ToggleRow title="Show Bikram Sambat dates" sub="Next to every English date" checked={bs} onChange={setBs} />
      </section>}
      {show("kyc") && <section className="card pf-pad pf-stack"><b>ID and investor check (KYC)</b>
        <span className="small muted">Needed to invest, reserve a project unit or check in at some stays. Only the business you book with and Sheetal's verification team can see it.</span>
        <label className="drop pf-drop"><input type="file" hidden /><Icon name="upload" size={22} /><b>Upload citizenship or passport</b></label>
        <Badge tone="action" icon="clock">Not verified yet</Badge>
      </section>}
      {show("data") && <section className="card pf-pad pf-stack"><b>Your data</b>
        <div className="pf-row-actions" style={{ justifyContent: "flex-start" }}><Button variant="outline" size="sm" icon="download" onClick={() => toast("We'll email you a copy of your data")}>Download my data</Button><Button variant="outline" size="sm" className="pf-danger" onClick={() => toast("Request sent. We'll confirm by email.")}>Delete my account</Button></div>
      </section>}
    </div>
  );
}

function Body({ tab, section }) {
  if (tab === "saved") return <SavedBody />;
  if (tab === "settings") return <Settings section={section} />;
  const kinds = { orders: ["stay"], investments: ["invest"], enquiries: ["reserve"], payments: null }[tab];
  return <Account embedded start={tab === "payments" ? "payments" : "orders"} kinds={kinds} />;
}

export default function PlatformProfileTab({ tab, section }) {
  return <StoreProvider><RouterProvider mode="history"><ToastProvider><div className="pf-root pf-embed"><Body tab={tab} section={section} /></div></ToastProvider></RouterProvider></StoreProvider>;
}
