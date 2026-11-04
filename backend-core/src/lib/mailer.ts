// System emails (verify email, reset password, invitations, invoices, reminders) and their texts.
// Where it fits: app.mailer.send() in every API.
// How it works: each email is saved to the outbox table; the mail server sends it within seconds (on a developer's
// computer it is saved as a file instead, and can be opened in Admin → System status).
// Rules: never put a password in an email; links carry one-time tokens only.

import type { FastifyBaseLogger } from "fastify";
import type { Db } from "./db.js";

export interface Email { to: string; subject: string; text: string; html?: string }

export class Mailer {
  constructor(private readonly db: Db | undefined, private readonly log: FastifyBaseLogger, private readonly devLog: boolean) {}

  async send(email: Email): Promise<void> {
    if (this.devLog) this.log.info({ to: email.to, subject: email.subject, text: email.text }, "email queued");
    if (!this.db) return;
    await this.db.outboundEmail.create({ data: { to: email.to, subject: email.subject, text: email.text, html: email.html } });
  }
}

const sign = "\n\nSheetal Property\nhttps://sheetalproperty.com";

export const emails = {
  verify: (to: string, name: string, link: string): Email => ({
    to, subject: "Confirm your email",
    text: `Namaste ${name},\n\nPlease confirm your email address by opening this link:\n${link}\n\nThe link works for 48 hours. If you didn't create an account, ignore this email.${sign}`,
  }),
  reset: (to: string, name: string, link: string): Email => ({
    to, subject: "Set a new password",
    text: `Namaste ${name},\n\nOpen this link to set a new password:\n${link}\n\nThe link works for 1 hour. If you didn't ask for this, you can ignore this email; your password stays the same.${sign}`,
  }),
  welcomeBack: (to: string, name: string, link: string): Email => ({
    to, subject: "Welcome to the new Sheetal Property",
    text: `Namaste ${name},\n\nSheetal Property has a new website. Your account and saved listings moved with you; please set a new password to log in:\n${link}\n\nThe link works for 1 hour.${sign}`,
  }),
};
