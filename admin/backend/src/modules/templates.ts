// Admin → Messages: the wording of the messages the system sends.
// Where it fits: the Messages page in the admin panel. Senders use the wording through Mailer (lib/mailer.ts).
// How it works: every built-in message is listed with its placeholders; staff can change the subject and text per
// channel and language, preview it with sample values, send themselves a test, switch their wording off, or reset to
// the built-in text (which removes the saved row). Only the placeholders listed for a message may be used.
// Rules: settings.platform; every change is audited; a test goes only to the signed-in staff member's own email.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { dbOf } from "@sheetal/platform/db/client";
import { badRequest, notFound } from "@sheetal/platform/core/errors";
import { SAMPLE_VALUES, TEMPLATE_DEFS, TPL_CHANNELS, TPL_LANGS, allowedVars, defOf, placeholdersIn, renderText } from "@sheetal/backend-core/domain/templates";
import { staffOf } from "./routes.js";

const where = z.object({ channel: z.enum(["email", "sms", "whatsapp"]).default("email"), lang: z.enum(TPL_LANGS).default("en") });
const wording = z.object({
  channel: z.enum(["email", "sms", "whatsapp"]).default("email"), lang: z.enum(TPL_LANGS).default("en"),
  subject: z.string().trim().max(200).default(""), body: z.string().trim().min(5, "Write the message.").max(5000, "That's too long."), active: z.boolean().default(true),
});

function check(key: string, channel: string, subject: string, body: string) {
  if (channel === "email" && !subject) throw badRequest("An email needs a subject.");
  const bad = placeholdersIn(`${subject}\n${body}`).filter((p) => !allowedVars(key).includes(p));
  if (bad.length) throw badRequest(`{{${bad[0]}}} isn't available in this message. You can use: ${allowedVars(key).map((v) => `{{${v}}}`).join(", ")}.`);
}

export async function adminTemplateRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const def = (key: string) => defOf(key) ?? (() => { throw notFound("There is no such message."); })();

  app.get("/admin/templates", async (request) => {
    staffOf(request, "platform.settings.read+platform.settings.update");
    const saved = await db().messageTemplate.findMany({ orderBy: [{ key: "asc" }, { channel: "asc" }, { lang: "asc" }] });
    return {
      data: {
        defs: TEMPLATE_DEFS.map((d) => ({ key: d.key, name: d.name, when: d.when, subject: d.subject, body: d.body, vars: d.vars, allowed: allowedVars(d.key) })),
        saved: saved.map((t) => ({ key: t.key, channel: t.channel, lang: t.lang, subject: t.subject, body: t.body, active: t.active, updatedAt: t.updatedAt.toISOString() })),
        channels: TPL_CHANNELS, langs: TPL_LANGS,
      },
    };
  });

  app.put<{ Params: { key: string } }>("/admin/templates/:key", async (request) => {
    const s = staffOf(request, "platform.settings.read+platform.settings.update");
    def(request.params.key);
    const b = wording.parse(request.body);
    check(request.params.key, b.channel, b.subject, b.body);
    const id = { key_channel_lang: { key: request.params.key, channel: b.channel, lang: b.lang } };
    const cur = await db().messageTemplate.findUnique({ where: id });
    if (cur && cur.subject === b.subject && cur.body === b.body && cur.active === b.active) return { message: "Nothing changed." };
    await db().messageTemplate.upsert({ where: id, create: { key: request.params.key, channel: b.channel, lang: b.lang, subject: b.subject, body: b.body, active: b.active, updatedBy: s.user.id }, update: { subject: b.subject, body: b.body, active: b.active, updatedBy: s.user.id } });
    await db().auditLog.create({ data: { actorId: s.user.id, action: "template.save", target: `${request.params.key} · ${b.channel} · ${b.lang}${b.active ? "" : " (off)"}`, ip: request.ip } });
    return { message: "Saved." };
  });

  /** Back to the built-in wording. */
  app.delete<{ Params: { key: string } }>("/admin/templates/:key", async (request) => {
    const s = staffOf(request, "platform.settings.read+platform.settings.update");
    def(request.params.key);
    const q = where.parse(request.query);
    const r = await db().messageTemplate.deleteMany({ where: { key: request.params.key, channel: q.channel, lang: q.lang } });
    if (r.count) await db().auditLog.create({ data: { actorId: s.user.id, action: "template.reset", target: `${request.params.key} · ${q.channel} · ${q.lang}`, ip: request.ip } });
    return { message: r.count ? "Back to the built-in text." : "Already the built-in text." };
  });

  app.post<{ Params: { key: string } }>("/admin/templates/:key/preview", async (request) => {
    staffOf(request, "platform.settings.read+platform.settings.update");
    def(request.params.key);
    const b = z.object({ subject: z.string().max(200).default(""), body: z.string().max(5000) }).parse(request.body);
    return { data: { subject: renderText(b.subject, SAMPLE_VALUES), body: renderText(b.body, SAMPLE_VALUES) } };
  });

  app.post<{ Params: { key: string } }>("/admin/templates/:key/test", async (request) => {
    const s = staffOf(request, "platform.settings.read+platform.settings.update");
    def(request.params.key);
    const b = z.object({ subject: z.string().trim().min(1).max(200), body: z.string().trim().min(5).max(5000) }).parse(request.body);
    check(request.params.key, "email", b.subject, b.body);
    await app.mailer.send({ to: s.user.email, subject: `[Test] ${renderText(b.subject, SAMPLE_VALUES)}`, text: renderText(b.body, SAMPLE_VALUES) });
    return { message: `A test went to ${s.user.email}.` };
  });
}
