import { useStore } from "@sheetal/shared/core/store";
import { Link, useRouter } from "@sheetal/shared/core/router";
import { Button, Panel } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";

// What a new business needs before it is ready to sell. Each step is worked out from real data.
export function setupSteps(db, tenant) {
  const saved = db.tenantSettings?.[tenant.id];
  const pay = saved?.payments;
  const payOk = !!pay && (pay.mode === "shetal" ? !!pay.payoutBank?.account : Object.values(pay.own || {}).some((g) => g.on && (g.merchant || g.key || g.qr || g === pay.own.cash)));
  return [
    { id: "verify", icon: "shield-check", label: "Verify your business", sub: "Upload company registration and PAN. Usually checked within 24 hours.", to: "/business/settings/profile", cta: "Verify", done: tenant.status !== "pending_verification" },
    { id: "profile", icon: "building-2", label: "Check business details", sub: "Name, PAN, VAT, address and contact shown on bills.", to: "/business/settings/profile", cta: "Review", done: !!saved },
    { id: "brand", icon: "palette", label: "Add your logo and colour", sub: "Used on receipts, POS and your booking page.", to: "/business/settings/branding", cta: "Add", done: !!saved?.branding?.useBrand },
    { id: "pay", icon: "wallet", label: "Set up payments", sub: "Choose Sheetal payouts or your own eSewa, Khalti or Fonepay.", to: "/business/settings/payments", cta: "Set up", done: payOk },
    { id: "listing", icon: "house-plus", label: "Publish your first listing", sub: "A property, stay, project or investment.", to: "/business/listings/new", cta: "Create", done: (db.listings || []).some((l) => l.tenantId === tenant.id && l.status !== "draft") },
    { id: "team", icon: "user-plus", label: "Invite your team", sub: "Give each person only the access they need.", to: "/business/team", cta: "Invite", done: (db.members?.[tenant.id] || []).length > 1 || (db.invites?.[tenant.id] || []).some((i) => i.status === "pending") },
    { id: "domain", icon: "globe", label: "Connect your own domain", sub: "Optional. Your site works on Sheetal right away.", to: "/business/domains", cta: "Connect", done: !!db.domains?.[tenant.id], optional: true },
  ];
}

export function useSetup(tenant) {
  const { db, update } = useStore();
  const steps = setupSteps(db, tenant);
  const required = steps.filter((s) => !s.optional);
  const done = required.filter((s) => s.done).length;
  const hidden = !!db.session.setupHidden?.[tenant.id];
  return { steps, done, total: required.length, pct: Math.round((done / required.length) * 100), complete: done === required.length, hidden,
    hide: (v = true) => update((d) => { d.session.setupHidden = { ...(d.session.setupHidden || {}), [tenant.id]: v }; }) };
}

export function SetupPanel({ tenant }) {
  const { navigate } = useRouter();
  const s = useSetup(tenant);
  if (s.complete || s.hidden) return null;
  return (
    <Panel title={`Set up ${tenant.name}`} sub={`${s.done} of ${s.total} done`} actions={<Button variant="ghost" size="sm" onClick={() => s.hide()}>Hide for now</Button>}>
      <div className="pf-pad" style={{ paddingTop: 0 }}><div className="bar" role="img" aria-label={`Setup ${s.pct}% done`}><i style={{ width: `${s.pct}%` }} /></div></div>
      <ul className="pf-list pf-setup">
        {s.steps.map((x) => (
          <li key={x.id} className={x.done ? "done" : undefined}>
            <span className="pf-li-ico"><Icon name={x.done ? "check" : x.icon} size={17} /></span>
            <div><b>{x.label}{x.optional && <span className="small muted" style={{ fontWeight: 400 }}> · optional</span>}</b><span className="small muted">{x.sub}</span></div>
            {!x.done && <Button variant="outline" size="sm" onClick={() => navigate(x.to)}>{x.cta}</Button>}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// Small progress chip for the sidebar footer until setup is finished.
export function SetupChip({ tenant }) {
  const s = useSetup(tenant);
  if (s.complete) return null;
  return (
    <Link to="/business" className="pf-plan-chip pf-setup-chip" onClick={() => s.hidden && s.hide(false)}>
      <i style={{ "--p": s.pct }} aria-hidden="true" /><span>Setup {s.done}/{s.total}</span><Icon name="chevron-right" size={14} />
    </Link>
  );
}
