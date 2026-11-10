// Shows one language's copy of an agreement inside the page (the same page that prints), sized to its content.
// Where it fits: Business → Agreements and the website's signing page. See core/agreementDoc.js.

import React, { useEffect, useRef, useState } from "react";
import { agreementHtml } from "../core/agreementDoc";

export function AgreementFrame({ doc, lang, title = "Agreement" }) {
  const ref = useRef(null);
  const [h, setH] = useState(600);
  const html = agreementHtml(doc, [lang]);
  useEffect(() => {
    const f = ref.current;
    if (!f) return undefined;
    let ro;
    const fit = () => { const d = f.contentDocument; if (d?.body) setH(Math.max(300, d.documentElement.scrollHeight + 4)); };
    const onLoad = () => { fit(); try { ro = new ResizeObserver(fit); ro.observe(f.contentDocument.body); } catch { /* old browsers: fixed height */ } };
    f.addEventListener("load", onLoad);
    return () => { f.removeEventListener("load", onLoad); ro?.disconnect(); };
  }, [html]);
  return <iframe ref={ref} title={title} srcDoc={html} sandbox="allow-same-origin allow-modals" style={{ width: "100%", height: h, border: "1px solid var(--line, #e3dfd8)", borderRadius: 8, background: "#fff", display: "block" }} />;
}
