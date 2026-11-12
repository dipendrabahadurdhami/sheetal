// Online forms on the website: show a live form at /f/<slug> and take the answers.
// Where it fits: website/frontend/src/pages/PublicForm.jsx; businesses build the forms in Business → Forms
// (business/backend/src/modules/forms).
// How it works: GET returns only what the page needs (fields, look, thank-you text, payment details when the form
// asks for a payment, the robot-check site key). POST checks every answer against the form's own fields, saves any
// files privately, and makes an Inbox lead (kind "form") at the form's branch, given to the form's assignee if it has
// one. Requirement forms are matched to the business's listings and the matches go on the lead. The team that sees
// leads there gets a notification, and the business (and the assignee) an email.
// Rules: 5 answers a minute per address; a hidden field people never fill catches simple bots; the robot check runs
// when Sheetal has saved its keys; the plan's monthly response limit closes the form for the rest of the month.

import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { dbOf } from "@sheetal/platform/db/client";
import { AppError, notFound } from "@sheetal/platform/core/errors";
import { savePrivateFile } from "@sheetal/backend-core/lib/files";
import { Vault } from "@sheetal/platform/auth/vault";
import { captchaSiteKey, checkCaptcha } from "@sheetal/backend-core/lib/captcha";
import type { Fetch } from "@sheetal/backend-core/lib/payments";
import { headOffice } from "@sheetal/backend-core/domain/branches";
import { DEST_LABEL, FieldsSchema, answersText, checkAnswers, contactOf, formLimits, matchListings, monthStart, type Match } from "@sheetal/backend-core/domain/forms";
import { notify, teamWith } from "@sheetal/platform/notify/index";

const rs = (n: number) => `Rs. ${n.toLocaleString("en-IN")}`;

export async function formRoutes(app: FastifyInstance, opts: { fetch?: Fetch } = {}) {
  const db = () => dbOf(app);
  const vault = new Vault(app.config.SECRETS_KEY, app.config.NODE_ENV === "production");
  const live = (slug: string) => db().form.findFirst({ where: { slug: slug.toLowerCase().slice(0, 60), status: "live" }, include: { tenant: { select: { id: true, name: true, logoUrl: true, email: true, status: true } } } });
  const full = async (tenantId: string) => {
    const lim = await formLimits(db(), tenantId);
    return lim.responses !== -1 && (await db().formResponse.count({ where: { tenantId, createdAt: { gte: monthStart() } } })) >= lim.responses;
  };
  const ended = (status: string) => ["suspended", "cancelled"].includes(status);

  app.get<{ Params: { slug: string } }>("/forms/:slug", async (request) => {
    const f = await live(request.params.slug);
    if (!f || ended(f.tenant.status)) throw notFound("This form isn't open. The link may be wrong, or the business closed it.");
    const fields = FieldsSchema.parse(f.fields);
    const style = (f.style ?? {}) as Record<string, unknown>;
    return {
      status: 200,
      data: {
        slug: f.slug, title: f.title, desc: f.description, fields, thanks: f.thanks, style,
        pay: fields.some((x) => x.type === "payment") ? f.pay : null,
        business: { name: f.tenant.name, logoUrl: f.tenant.logoUrl && !f.tenant.logoUrl.startsWith("/brand/") ? f.tenant.logoUrl : null },
        captcha: await captchaSiteKey(db()),
        closed: await full(f.tenantId),
      },
    };
  });

  app.post<{ Params: { slug: string } }>("/forms/:slug", { bodyLimit: 24 * 1024 * 1024, config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request) => {
    const b = z.object({
      answers: z.record(z.string().max(40), z.unknown()).default({}),
      captcha: z.string().max(4096).nullish(),
      website: z.string().max(500).optional(), // spam trap: a hidden field people never fill
    }).parse(request.body);
    const f = await live(request.params.slug);
    if (!f || ended(f.tenant.status)) throw notFound("This form isn't open any more.");
    // Bots that fill the hidden field are told it worked, and nothing is kept.
    if (b.website) return { status: 200, message: f.thanks || "Thanks! We'll be in touch soon." };
    await checkCaptcha({ db: db(), vault, token: b.captcha, ip: request.ip, fetch: opts.fetch });
    if (await full(f.tenantId)) throw new AppError(403, "form_full", `${f.tenant.name} isn't taking new answers this month. Please contact them directly.`);

    const fields = FieldsSchema.parse(f.fields);
    const { errors, answers, files } = checkAnswers(fields, b.answers);
    if (Object.keys(errors).length) throw new AppError(422, "validation", "Please check the highlighted questions.", errors);
    for (const file of files) {
      const name = await savePrivateFile(app.config.MEDIA_DIR, "forms", file.data);
      const a = answers.find((x) => x.id === file.fieldId)!;
      a.value = { ...(a.value as object), file: name };
    }
    const who = contactOf(answers);
    const payF = fields.find((x) => x.type === "payment" && answers.some((a) => a.id === x.id));
    const matches: Match[] = f.dest === "requirements" ? await matchListings(db(), f.tenantId, answers) : [];
    const branchId = f.branchId ?? await headOffice(db(), f.tenantId);
    const message = `${f.title}\n${answersText(answers)}`.slice(0, 4000);

    const { lead, response } = await db().$transaction(async (tx) => {
      const response = await tx.formResponse.create({
        data: { formId: f.id, tenantId: f.tenantId, answers: answers as unknown as Prisma.InputJsonValue, name: who.name, phone: who.phone, email: who.email, payAmount: payF?.amount ?? null, payStatus: payF ? "to_confirm" : null, ip: request.ip },
      });
      const lead = await tx.lead.create({
        data: {
          tenantId: f.tenantId, branchId, userId: request.user?.id, kind: "form", name: who.name, email: who.email, phone: who.phone, message, ip: request.ip,
          assigneeId: f.assigneeId, tags: [f.title.slice(0, 30), ...(f.dest !== "leads" ? [DEST_LABEL[f.dest]!] : [])],
          details: { formId: f.id, formTitle: f.title, dest: f.dest, responseId: response.id, ...(payF ? { payment: payF.amount } : {}), ...(f.dest === "requirements" ? { matches } : {}) } as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.formResponse.update({ where: { id: response.id }, data: { leadId: lead.id } });
      return { lead, response };
    });

    const people = await teamWith(db(), f.tenantId, ["crm.lead.read"], branchId);
    const matchLine = f.dest === "requirements" ? (matches.length ? `${matches.length} of your listings match` : "No listing matches yet") : "";
    await notify(db(), [...people, f.assigneeId], { tenantId: f.tenantId, type: "lead", title: `New response to ${f.title}`, message: [who.name, who.phone, matchLine].filter(Boolean).join(" · "), link: "/business/inbox" });

    const assignee = f.assigneeId ? await db().user.findUnique({ where: { id: f.assigneeId }, select: { email: true } }) : null;
    const text = [
      `A new response to your form "${f.title}" came in on Sheetal Property.`, "",
      answersText(answers),
      payF ? `\nPayment: ${rs(payF.amount)}. Check the screenshot and confirm it in Business → Forms → Responses.` : "",
      f.dest === "requirements" ? `\n${matches.length ? `Listings that match:\n${matches.map((m) => `${m.code} ${m.title}${m.price != null ? ` (${rs(m.price)})` : ""}`).join("\n")}` : "None of your listings match yet."}` : "",
      "", "Reply from your Inbox in Sheetal Business.",
    ].filter((x) => x !== "").join("\n");
    for (const to of [...new Set([f.tenant.email, assignee?.email].filter((x): x is string => !!x))]) {
      await app.mailer.send({ to, subject: `${f.title}: new response from ${who.name}`, text });
    }
    return { status: 200, message: f.thanks || "Thanks! We'll be in touch soon.", data: { id: response.id, ref: lead.ref } };
  });
}
