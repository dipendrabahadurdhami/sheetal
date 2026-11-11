// ReplyBox: the public reply under one review: the saved reply with Edit and Remove, or a box to write one.
// Where it fits: inside ReviewCard (the Reviews page). Texts, buttons and the placeholder are the ones the old page had.
// How it works: `onReply(text)` sends the reply (the page adds the review's version) and answers true when it worked. On true the box closes and the draft is cleared; on a
// failure (including a stale version) the draft stays, so nothing typed is lost. Remove asks first (the app's Confirm dialog), then sends empty text.
// Rules: shown by replyLogic.replyState(): no box and no buttons without canReply. Phone width: the box fills the card and the buttons are 44 px high (platform.css).

import React, { useState } from "react";
import { fdate } from "@sheetal/shared/core/format";
import { Button, Confirm, Textarea } from "@sheetal/ui/primitives";
import { REMOVE_CONFIRM, REMOVE_TEXT, REPLY_MAX, REPLY_PLACEHOLDER, canSubmit, replyState, submitLabel, textToSend } from "./replyLogic.js";

export function ReplyBox({ review: r, canReply, onReply }) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const state = replyState({ reply: r.reply, canReply, editing });
  const send = async (text, afterOk) => {
    setBusy(true);
    try { if (await onReply(text)) { setEditing(false); setDraft(""); afterOk?.(); } } finally { setBusy(false); }
  };

  if (state === "none") return null;
  if (state === "reply" || state === "reply-only") {
    return (
      <div className="pf-review-reply">
        <small className="muted">Your reply{r.repliedBy ? ` by ${r.repliedBy}` : ""} · {fdate(r.repliedAt)}</small>
        <p>{r.reply}</p>
        {state === "reply" && (
          <div className="pf-row-actions pf-start">
            <Button size="sm" variant="ghost" icon="pencil" onClick={() => { setEditing(true); setDraft(r.reply); }}>Edit</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setAsking(true)}>Remove</Button>
          </div>
        )}
        <Confirm open={asking} onClose={() => setAsking(false)} danger title={REMOVE_CONFIRM.title} confirmLabel={REMOVE_CONFIRM.confirmLabel}
          onConfirm={() => send(REMOVE_TEXT)}>{REMOVE_CONFIRM.text}</Confirm>
      </div>
    );
  }
  return (
    <div className="pf-review-box">
      <Textarea rows={2} maxLength={REPLY_MAX} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={REPLY_PLACEHOLDER} aria-label={`Reply to ${r.by}`} />
      <div className="pf-row-actions pf-start">
        <Button size="sm" disabled={!canSubmit(draft, busy)} onClick={() => send(textToSend(draft))}>{submitLabel(r.reply)}</Button>
        {editing && <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setDraft(""); }}>Cancel</Button>}
      </div>
    </div>
  );
}
