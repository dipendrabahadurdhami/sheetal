// The setup guide on the Overview page and the small "Setup 2/3" chip in the side bar.
// Where it fits: LiveOverview.jsx shows SetupPanel; BusinessApp.jsx shows SetupChip; both open the step-by-step page (GettingStarted.jsx).
// How it works: GET /setup says which first steps are really done (worked out from the business's own data); the words come from setupGuide.js.
// Rules: the guide disappears when the required steps are done or the owner hides it; hiding is remembered on the server for the business.

import { useCallback, useEffect, useState } from "react";
import { Link, useRouter } from "@sheetal/shared/core/router";
import { Button, Panel } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { bizApi } from "../api";
import { nextStep, withWords } from "./setupGuide";

/** The setup status of one business: { data, reload, setHidden }. data is null until loaded (or if it cannot be read). */
export function useSetupStatus(tenant) {
  const [data, setData] = useState(null);
  const reload = useCallback(() => bizApi("GET", "/setup").then((r) => setData(r.data)).catch(() => {}), [tenant.id]);
  useEffect(() => { setData(null); reload(); }, [reload]);
  const setState = (patch) => bizApi("POST", "/setup/state", patch).then((r) => setData(r.data)).catch(() => {});
  return { data, reload, setState };
}

export function SetupPanel({ tenant }) {
  const { navigate } = useRouter();
  const { data, setState } = useSetupStatus(tenant);
  if (!data || data.complete || data.hidden) return null;
  const steps = withWords(data.type, data.steps);
  const next = nextStep(data.steps);
  const pct = Math.round((data.done / data.total) * 100);
  return (
    <Panel title={`Set up ${tenant.name}`} sub={`${data.done} of ${data.total} done`} actions={<Button variant="ghost" size="sm" onClick={() => setState({ hidden: true })}>Hide for now</Button>}>
      <div className="pf-pad" style={{ paddingTop: 0 }}><div className="bar" role="img" aria-label={`Setup ${pct}% done`}><i style={{ width: `${pct}%` }} /></div></div>
      <ul className="pf-list pf-setup">
        {steps.map((x) => (
          <li key={x.id} className={x.done ? "done" : undefined}>
            <span className="pf-li-ico"><Icon name={x.done ? "check" : x.icon} size={17} /></span>
            <div><b>{x.title}{x.optional && <span className="small muted" style={{ fontWeight: 400 }}> · optional</span>}</b><span className="small muted">{x.why}</span></div>
            {!x.done && <Button variant="outline" size="sm" onClick={() => navigate(x.to)}>{x.cta}</Button>}
          </li>
        ))}
      </ul>
      {next && <div className="pf-pad"><Button icon="map" onClick={() => navigate("/business/start")}>Guide me step by step</Button></div>}
    </Panel>
  );
}

// Small progress chip for the side bar until the required steps are finished.
export function SetupChip({ tenant }) {
  const { data, setState } = useSetupStatus(tenant);
  if (!data || data.complete) return null;
  const pct = Math.round((data.done / data.total) * 100);
  return (
    <Link to="/business/start" className="pf-plan-chip pf-setup-chip" onClick={() => data.hidden && setState({ hidden: false })}>
      <i style={{ "--p": pct }} aria-hidden="true" /><span>Setup {data.done}/{data.total}</span><Icon name="chevron-right" size={14} />
    </Link>
  );
}
