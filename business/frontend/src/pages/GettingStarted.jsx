// Getting started: a guided, one-step-at-a-time setup for a new business.
// Where it fits: /business/start in BusinessApp.jsx; opened from the Overview card, the side bar chip, the tour and Help.
// How it works: GET /setup (via useSetupStatus) says which steps are done; the page shows one step at a time with why it matters, plain steps and a
// button that opens the real screen. Coming back here after doing the step ticks it. Optional steps can be skipped; nothing is forced.
// Rules: no sample data; progress comes only from the business's real data; "Skip for now" never marks a step done.

import { useEffect, useState } from "react";
import { useRouter } from "@sheetal/shared/core/router";
import { Badge, Button, PageHead, Panel } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { useSetupStatus } from "./Setup";
import { nextStep, withWords } from "./setupGuide";

export function GettingStarted({ tenant }) {
  const { navigate } = useRouter();
  const { data, reload } = useSetupStatus(tenant);
  const [at, setAt] = useState(null);
  const [skipped, setSkipped] = useState([]);
  // Coming back from another screen: look again, so the step just done is ticked.
  useEffect(() => { const f = () => reload(); window.addEventListener("focus", f); return () => window.removeEventListener("focus", f); }, [reload]);

  const head = <PageHead title="Getting started" sub={`Let's set up ${tenant.name}, one step at a time.`} />;
  if (!data) return <>{head}<div className="sk" style={{ height: 260, borderRadius: "var(--r)" }} /></>;

  const steps = withWords(data.type, data.steps);
  const open = steps.filter((s) => !s.done && !skipped.includes(s.id));
  const nextId = nextStep(data.steps)?.id;
  const current = steps.find((s) => s.id === (at || (open.find((s) => s.id === nextId) || open[0])?.id));
  const pct = Math.round((data.done / data.total) * 100);

  return (
    <>
      {head}
      <section className="card pf-panel" style={{ padding: 18 }}>
        <div className="row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <b>{data.complete ? "The basics are ready." : `${data.done} of ${data.total} basics done`}</b>
          <span className="small muted">{pct}%</span>
        </div>
        <div className="bar" style={{ marginTop: 8 }} role="img" aria-label={`Setup ${pct}% done`}><i style={{ width: `${pct}%` }} /></div>
      </section>

      <div className="pf-split" style={{ alignItems: "flex-start" }}>
        <Panel title="Steps" className="grow">
          <ul className="pf-list pf-setup">
            {steps.map((s) => (
              <li key={s.id} className={s.done ? "done" : undefined}>
                <span className="pf-li-ico"><Icon name={s.done ? "check" : s.icon} size={17} /></span>
                <div><b>{s.title}{s.optional && <span className="small muted" style={{ fontWeight: 400 }}> · optional</span>}</b></div>
                {!s.done && <Button variant={current?.id === s.id ? "light" : "ghost"} size="sm" onClick={() => setAt(s.id)}>{current?.id === s.id ? "Now" : "Show"}</Button>}
                {s.done && <Badge tone="done">Done</Badge>}
              </li>
            ))}
          </ul>
        </Panel>

        {current ? (
          <Panel title={current.title} sub={current.optional ? "Optional: you can do this later." : "Needed to get started."} className="grow" pad>
            <div className="stack" style={{ gap: 12 }}>
              <p style={{ margin: 0 }}><b>Why:</b> {current.why}</p>
              <ol style={{ margin: 0, paddingLeft: 20 }}>{current.how.map((h) => <li key={h} style={{ marginBottom: 4 }}>{h}</li>)}</ol>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <Button icon={current.icon} onClick={() => navigate(current.to)}>{current.cta}</Button>
                <Button variant="outline" onClick={() => { setSkipped([...skipped, current.id]); setAt(null); }}>Skip for now</Button>
                <Button variant="ghost" icon="refresh-cw" onClick={reload}>I did it, check again</Button>
              </div>
              <p className="small muted" style={{ margin: 0 }}>After you finish on that screen, come back here with the Getting started button in the side bar, or press "I did it, check again".</p>
            </div>
          </Panel>
        ) : (
          <Panel title="All steps are done or skipped" className="grow" pad>
            <p style={{ marginTop: 0 }}>You can start working now. Need more? Add apps from the Marketplace, or open Help for how-to guides.</p>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <Button onClick={() => navigate("/business")}>Go to my Overview</Button>
              <Button variant="outline" onClick={() => navigate("/business/marketplace")}>Open the Marketplace</Button>
              <Button variant="ghost" onClick={() => navigate("/business/help")}>Open Help</Button>
            </div>
          </Panel>
        )}
      </div>
    </>
  );
}
