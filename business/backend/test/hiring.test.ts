import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/platform/core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const call = (who: string, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: object, tenant = ids.agency) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": tenant! } });
const job = (over: object = {}) => ({ title: "Sales agent", jobType: "full_time", location: "Kathmandu", description: "Show homes to buyers and follow up on leads every day.", vacancies: 2, status: "open", ...over });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, app_settings, audit_logs, job_posts, notifications RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const k of ["owner", "agent", "other", "staff"]) {
    const u = await db.user.create({ data: { email: `${k}@everest.test`, userName: k, emailVerifiedAt: new Date(), ...(k === "staff" ? { platformRole: "super_admin" } : {}) } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  ids.agency = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Everest Realty", type: "agency", planId: "agency-business" }))).id;
  ids.otherBiz = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.other!, name: "Lalit Homes", type: "agency", planId: "agency-business" }))).id;
  const role = await db.role.findFirstOrThrow({ where: { tenantId: ids.agency, key: "agent" } });
  await db.membership.create({ data: { tenantId: ids.agency!, userId: ids.agent!, roleId: role.id, status: "active" } });
});
afterAll(async () => { await app.close(); });

describe("jobs a business posts", () => {
  it("sends an unverified business's open job to Sheetal for a check", async () => {
    const r = await call("owner", "POST", "/jobs", job({ description: "<p>Show homes to buyers and follow up on leads.</p><script>alert(1)</script>" }));
    expect(r.statusCode).toBe(200);
    expect(r.json().message).toMatch(/Sent to Sheetal/);
    ids.job = String(r.json().data.id);
    const row = await app.db!.jobPost.findUniqueOrThrow({ where: { id: Number(ids.job) } });
    expect(row).toMatchObject({ tenantId: ids.agency, review: "pending", status: "open", slug: "sales-agent-everest-realty" });
    expect(row.description).toContain("<p>Show homes");   // kept as clean HTML, scripts removed
    expect(row.description).not.toContain("script");
    expect(await app.db!.notification.count({ where: { userId: ids.staff, type: "job_review" } })).toBe(1);
    const list = (await call("owner", "GET", "/jobs")).json();
    expect(list.meta.verified).toBe(false);
    expect(list.data[0]).toMatchObject({ title: "Sales agent", review: "pending", applications: 0 });
  });

  it("checks the form and who may post", async () => {
    expect((await call("owner", "POST", "/jobs", job({ title: "x" }))).statusCode).toBe(422);
    expect((await call("owner", "POST", "/jobs", job({ description: "too short" }))).statusCode).toBe(422);
    expect((await call("agent", "POST", "/jobs", job())).statusCode).toBe(403);
    expect((await call("agent", "GET", "/jobs")).statusCode).toBe(403);
  });

  it("keeps an approved job live while only its status moves, and checks it again after a text change", async () => {
    const saved = await app.db!.jobPost.update({ where: { id: Number(ids.job) }, data: { review: "approved" } });
    const base = job({ description: saved.description });
    expect((await call("owner", "PUT", `/jobs/${ids.job}`, { ...base, status: "closed" })).statusCode).toBe(200);
    expect((await call("owner", "PUT", `/jobs/${ids.job}`, base)).statusCode).toBe(200);
    expect((await app.db!.jobPost.findUniqueOrThrow({ where: { id: Number(ids.job) } })).review).toBe("approved");
    expect((await call("owner", "PUT", `/jobs/${ids.job}`, { ...base, title: "Senior sales agent" })).json().message).toMatch(/Sheetal to check/);
    expect((await app.db!.jobPost.findUniqueOrThrow({ where: { id: Number(ids.job) } })).review).toBe("pending");
  });

  it("puts a verified business's job on the website at once", async () => {
    await app.db!.tenant.update({ where: { id: ids.agency }, data: { verification: "verified" } });
    const r = await call("owner", "POST", "/jobs", job({ title: "Office assistant" }));
    expect(r.json().message).toMatch(/on the website now/);
    expect((await app.db!.jobPost.findUniqueOrThrow({ where: { id: r.json().data.id } })).review).toBe("approved");
    expect((await call("owner", "PUT", `/jobs/${ids.job}`, job({ title: "Senior sales agent", vacancies: 3 }))).statusCode).toBe(200);
    expect((await app.db!.jobPost.findUniqueOrThrow({ where: { id: Number(ids.job) } })).review).toBe("approved");
  });

  it("shows applications to this business only, and keeps CVs private", async () => {
    const a = await app.db!.jobApplication.create({ data: { jobId: Number(ids.job), name: "Ram", email: "ram@x.test", cvFile: null } });
    const list = (await call("owner", "GET", `/jobs/${ids.job}/applications`)).json().data;
    expect(list).toEqual([expect.objectContaining({ name: "Ram", status: "new", cv: false })]);
    expect(JSON.stringify(list)).not.toContain("ip");
    expect((await call("owner", "GET", "/jobs")).json().data.find((j: { id: number }) => j.id === Number(ids.job)).newApplications).toBe(1);
    expect((await call("owner", "PATCH", `/job-applications/${a.id}`, { status: "shortlisted" })).statusCode).toBe(200);
    expect((await call("owner", "GET", `/job-applications/${a.id}/cv`)).statusCode).toBe(404);
    // Another business sees none of it.
    expect((await call("other", "GET", "/jobs", undefined, ids.otherBiz)).json().data).toEqual([]);
    expect((await call("other", "GET", `/jobs/${ids.job}/applications`, undefined, ids.otherBiz)).statusCode).toBe(404);
    expect((await call("other", "PATCH", `/job-applications/${a.id}`, { status: "hired" }, ids.otherBiz)).statusCode).toBe(404);
    expect((await call("other", "DELETE", `/jobs/${ids.job}`, undefined, ids.otherBiz)).statusCode).toBe(404);
    expect((await app.db!.jobApplication.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("shortlisted");
  });

  it("deletes a job with its applications and audits the work", async () => {
    expect((await call("owner", "DELETE", `/jobs/${ids.job}`)).statusCode).toBe(200);
    expect(await app.db!.jobApplication.count({ where: { jobId: Number(ids.job) } })).toBe(0);
    const actions = (await app.db!.auditLog.findMany({ where: { tenantId: ids.agency } })).map((x) => x.action);
    expect(actions).toEqual(expect.arrayContaining(["jobs.created", "jobs.updated", "jobs.deleted"]));
  });
});
