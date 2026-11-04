// Small charts (bars, line, donut, funnel) drawn with SVG, no chart library.
// Where it fits: dashboards and analytics in both panels.
// How it works: colours come from the theme, so charts follow light, dark and brand themes.

import React from "react";

export function Bars({ data, height = 200, format = (v) => v, highlightLast = true }) {
  const max = Math.max(1, ...data.map((d) => d.v));
  const w = 100 / data.length;
  return (
    <figure className="pf-svgchart" role="img" aria-label={data.map((d) => `${d.label} ${format(d.v)}`).join(", ")}>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ height }}>
        {[0.25, 0.5, 0.75, 1].map((g) => <line key={g} x1="0" x2="100" y1={height - g * (height - 20)} y2={height - g * (height - 20)} className="grid" vectorEffect="non-scaling-stroke" />)}
        {data.map((d, i) => {
          const h = (d.v / max) * (height - 20);
          return <rect key={i} x={i * w + w * 0.18} y={height - h} width={w * 0.64} height={h} rx="0.6" className={highlightLast && i === data.length - 1 ? "pf-col-now" : "pf-col"} />;
        })}
      </svg>
      <figcaption className="pf-svgchart-x">{data.map((d) => <span key={d.label}>{d.label}</span>)}</figcaption>
    </figure>
  );
}

export function Line({ series, labels, height = 200, max: forced }) {
  const max = forced || Math.max(1, ...series.flatMap((s) => s.data));
  const n = labels.length;
  const pt = (v, i) => `${(i / (n - 1)) * 100},${height - (v / max) * (height - 16) - 4}`;
  return (
    <figure className="pf-svgchart" role="img" aria-label={series.map((s) => `${s.name}: ${s.data.join(", ")}`).join("; ")}>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ height }}>
        {[0.25, 0.5, 0.75, 1].map((g) => <line key={g} x1="0" x2="100" y1={height - g * (height - 16) - 4} y2={height - g * (height - 16) - 4} className="grid" vectorEffect="non-scaling-stroke" />)}
        {series.map((s, si) => (
          <g key={s.name} className={`ln ln${si}`}>
            {si === 0 && <polygon points={`0,${height} ${s.data.map(pt).join(" ")} 100,${height}`} className="area" />}
            <polyline points={s.data.map(pt).join(" ")} fill="none" vectorEffect="non-scaling-stroke" />
          </g>
        ))}
      </svg>
      <figcaption className="pf-svgchart-x">{labels.map((l, i) => <span key={i}>{l}</span>)}</figcaption>
      {series.length > 1 && <div className="pf-legend">{series.map((s, si) => <span key={s.name}><i className={`lg${si}`} />{s.name}</span>)}</div>}
    </figure>
  );
}

export function Donut({ data, size = 160, center }) {
  const total = data.reduce((s, d) => s + d.v, 0) || 1;
  let acc = 0;
  const r = 15.915;
  return (
    <div className="pf-donut">
      <svg viewBox="0 0 42 42" width={size} height={size} role="img" aria-label={data.map((d) => `${d.label} ${Math.round((d.v / total) * 100)}%`).join(", ")}>
        <circle cx="21" cy="21" r={r} className="track" fill="none" strokeWidth="6" />
        {data.map((d, i) => {
          const pct = (d.v / total) * 100;
          const el = <circle key={i} cx="21" cy="21" r={r} fill="none" strokeWidth="6" className={`pf-arc s${i}`} strokeDasharray={`${pct} ${100 - pct}`} strokeDashoffset={25 - acc} />;
          acc += pct;
          return el;
        })}
        {center && <text x="21" y="22.5" textAnchor="middle" className="ctr">{center}</text>}
      </svg>
      <ul>{data.map((d, i) => <li key={d.label}><i className={`s${i}`} /><span>{d.label}</span><b className="tnum">{Math.round((d.v / total) * 100)}%</b></li>)}</ul>
    </div>
  );
}

export function Funnel({ steps }) {
  const max = steps[0].v || 1;
  return (
    <ol className="pf-funnel">
      {steps.map((s, i) => (
        <li key={s.label}>
          <span>{s.label}</span>
          <div className="bar"><i style={{ width: `${(s.v / max) * 100}%` }} /></div>
          <b className="tnum">{s.v.toLocaleString("en-IN")}</b>
          <small className="tnum">{i ? `${Math.round((s.v / steps[i - 1].v) * 100)}%` : ""}</small>
        </li>
      ))}
    </ol>
  );
}
