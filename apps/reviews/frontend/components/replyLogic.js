// The rules of the reply box, with no React in them, so they can be tested without a browser.
// Where it fits: ReplyBox.jsx and resources/review.jsx. Texts are the ones the old Reviews page used.
// How it works: replyState() says what a review card shows under the comment; the other helpers give the button words and the text to send.
// Rules: a person who cannot reply (meta.canReply is false) never gets the box or the Edit / Remove buttons, only the reply that is already there. Empty text sent to the
// server means "take the reply down"; the Post / Save button stays off until there is something to say, and Remove is the way to take it down.

export const REPLY_PLACEHOLDER = "Write a public reply: thank them, or say how you'll put it right.";
export const REPLY_MAX = 1500;

/** "reply" (the saved reply, with Edit / Remove), "reply-only" (the saved reply, nothing to press), "box" (write or edit) or "none". */
export function replyState({ reply, canReply, editing }) {
  if (reply && !editing) return canReply ? "reply" : "reply-only";
  return canReply ? "box" : "none";
}

/** The main button: "Save reply" when a reply is already there, otherwise "Post reply". */
export const submitLabel = (reply) => (reply ? "Save reply" : "Post reply");

/** The text to send for a draft (trimmed). */
export const textToSend = (draft) => String(draft ?? "").trim();

/** Can the main button be pressed? Not while a request is running or while the draft is blank. */
export const canSubmit = (draft, busy) => !busy && textToSend(draft) !== "";

/** The question asked before Remove (a public reply comes down and its text is not kept). */
export const REMOVE_CONFIRM = { title: "Remove your reply?", text: "Its text is deleted.", confirmLabel: "Remove" };

/** What "Remove" sends: empty text. */
export const REMOVE_TEXT = "";
