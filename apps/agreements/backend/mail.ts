// The emails Agreements sends: the signing link (first time and again), and the "cancelled" note.
// Where it fits: AgreementService calls these AFTER the change is committed. Texts unchanged from the old route file (P2-W1 stage 3).
// Rules: the link is only in the email (only its SHA-256 is kept). The mailer is the API's (app.mailer), passed in by routes.ts.

import { agreementNo } from "@sheetal/backend-core/domain/agreements";
import type { Full } from "./types.js";

export interface Mailer { send(m: { to: string; subject: string; text: string }): Promise<unknown> }

export function linkMail(mailer: Mailer, site: string, a: Full, business: string, s: { name: string; email: string }, token: string, again = false) {
  const ref = agreementNo(a.seq);
  const link = `${site}/sign/${token}`;
  const en = `Namaste ${s.name},\n\n${business} ${again ? "has sent you the signing link again for" : "has sent you an agreement to sign"}: ${a.title} (${ref}).\n\nOpen this link to read it and sign. You will get a 6-digit code by email to confirm it is you:\n${link}\n\nThe link is only for you. Don't forward it.`;
  const ne = `नमस्ते,\n\n${business} ले तपाईंलाई हस्ताक्षरका लागि सम्झौता पठाएको छ (${ref})। तलको लिंक खोली सम्झौता पढ्नुहोस् र हस्ताक्षर गर्नुहोस्। तपाईं नै हो भनी पुष्टि गर्न इमेलमा ६ अङ्कको कोड आउनेछ:\n${link}\n\nयो लिंक तपाईंका लागि मात्र हो। अरूलाई नपठाउनुहोस्।`;
  const text = a.lang === "ne" ? ne : a.lang === "both" ? `${en}\n\n———\n\n${ne}` : en;
  return mailer.send({ to: s.email, subject: `${again ? "Reminder: sign" : "Please sign"}: ${a.title} (${ref})`, text: `${text}\n\nSheetal Property` });
}

export function cancelMail(mailer: Mailer, a: Full, business: string, s: { name: string; email: string }, note: string) {
  return mailer.send({ to: s.email, subject: `Cancelled: ${a.title} (${agreementNo(a.seq)})`, text: `Namaste ${s.name},\n\n${business} cancelled the agreement "${a.title}" (${agreementNo(a.seq)}). You don't need to sign it.${note ? `\n\nNote: ${note}` : ""}\n\nSheetal Property` });
}
