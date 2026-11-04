// The "Ask AI" box: compare listings by their codes and get a plain answer.
// How it works: sends the codes and question to the website API (/ask-ai), which answers from public facts only.

import { useState } from "react";
import { X, Plus, Send } from "lucide-react";
import { api } from "../api/endpoints";
import { toItem } from "../api/client";
import { useApp } from "../context/AppContext";
import { Modal } from "./ui";
import { fmtPrice, titleOf } from "../utils/format";

const MAX = 3;
const norm = (c) => { const s = String(c).trim().replace(/^#/, "").toUpperCase(); return /^\d+$/.test(s) ? `SP${s}` : s; };

export function AskAi({ open, onClose, start }) {
  const { toast } = useApp();
  const [props, setProps] = useState(start ? [start] : []);
  const [code, setCode] = useState("");
  const [q, setQ] = useState("");
  const [chat, setChat] = useState([]);
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!code.trim()) return;
    if (props.length >= MAX) return toast(`You can compare up to ${MAX} properties.`);
    const c = norm(code);
    if (props.some((p) => p.property_code === c)) return toast("Already added.");
    try { const p = toItem(await api.byCode(c)); if (!p?.property_code) throw new Error(); setProps([...props, p]); setCode(""); }
    catch { toast("No property found with that code."); }
  };
  const ask = async () => {
    if (!props.length) return toast("Add a property first.");
    const question = q.trim() || (props.length > 1 ? "Which of these is the better buy and why?" : "Is this property good value? What should I check before buying?");
    setQ(""); setBusy(true);
    try { const r = await api.askAi(props.map((p) => p.property_code), question); setChat((c) => [...c, { question, answer: r?.summary || r?.data?.summary || "No answer." }]); }
    catch { toast("AI is busy right now. Try again shortly."); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} wide>
      <div className="stack" style={{ gap: 18 }}>
        <h3>Ask AI about this property</h3>
        <p className="small muted">Add up to three property codes to compare price, area, road access and location.</p>
        <div className="row-wrap" style={{ gap: 8 }}>
          {props.map((p) => (
            <span key={p.property_code} className="chip active" style={{ height: "auto", padding: "8px 12px" }}>
              <span><b className="tnum">#{p.property_code}</b> · {titleOf(p).slice(0, 34)} · {fmtPrice(p.total_price)}</span>
              <X size={14} style={{ cursor: "pointer" }} onClick={() => setProps(props.filter((x) => x !== p))} />
            </span>
          ))}
          {props.length < MAX && (
            <div className="row" style={{ gap: 6 }}>
              <input className="input code-in" style={{ height: 38, width: 150 }} placeholder="Code e.g. SP1004" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
              <button className="btn btn-outline btn-sm" onClick={add}><Plus size={14} /> Add</button>
            </div>
          )}
        </div>
        <div className="stack" style={{ gap: 12, maxHeight: 320, overflowY: "auto" }}>
          {chat.map((m, i) => (
            <div key={i} className="stack" style={{ gap: 8 }}>
              <div className="bubble me">{m.question}</div>
              <div className="bubble">{m.answer}</div>
            </div>
          ))}
          {busy && <div className="bubble muted">Thinking…</div>}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <input className="input" placeholder="Ask anything, e.g. which has better road access?" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} />
          <button className="btn btn-primary" onClick={ask} disabled={busy}><Send size={16} /> Ask</button>
        </div>
      </div>
    </Modal>
  );
}
