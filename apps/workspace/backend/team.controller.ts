// The HTTP side of the team, exactly as the business switcher, Team, Roles, Settings → Profile and Branding and the invitation page call it:
// GET /workspaces, POST /workspaces (201); POST /workspace/cover; PATCH /workspace/profile; PUT /workspace/branding (4 MB); GET /team;
// POST /team/invites (20 an hour), POST /team/invites/:id/resend (10 an hour), POST /team/invites/:id/revoke; GET /invites/preview (public),
// POST /invites/accept (10 a minute); PATCH /team/members/:userId, DELETE /team/members/:userId; POST /team/roles, PATCH /team/roles/:id, DELETE /team/roles/:id.
// Rules: no business logic and no Prisma here. The four routes with no business yet take the signed-in person (or nobody, for the preview).

import type { FastifyInstance, FastifyRequest } from "fastify";
import { BaseController } from "@sheetal/platform/core/controller";
import type { BusinessContext } from "@sheetal/platform/core/context";
import type { RequestInfo, TeamService, TeamUser } from "./team.service.js";

type P = { Params: { id: string } };
type U = { Params: { userId: string } };

export class TeamController extends BaseController<never, never, never> {
  constructor(private readonly s: TeamService, contextOf: (req: FastifyRequest) => Promise<BusinessContext>, private readonly userOf: (req: FastifyRequest) => TeamUser) {
    super(s as never, { basePath: "/team", standardRoutes: [], contextOf });
  }
  protected override routes(app: FastifyInstance): void {
    const s = this.s, ctx = (req: FastifyRequest) => this.ctxOf(req);
    const info = (req: FastifyRequest): RequestInfo => ({ ip: req.ip, requestId: String(req.id), log: req.log });
    // The person behind a support session has no own list of businesses: only a signed-in person does.
    const userOrNull = (req: FastifyRequest) => ((req as { support?: unknown }).support ? null : this.userOf(req));
    app.get("/workspaces", async (req) => ({ data: s.myBusinesses(this.userOf(req)) }));
    app.post("/workspaces", async (req) => s.addBusiness(info(req), this.userOf(req), req.body));
    app.post("/workspace/cover", async (req) => { const c = await ctx(req); return s.cover(c, userOrNull(req), req.body); });
    app.patch("/workspace/profile", async (req) => s.saveProfile(await ctx(req), req.body));
    app.put("/workspace/branding", { bodyLimit: 4 * 1024 * 1024 }, async (req) => s.saveBranding(await ctx(req), req.body));
    app.get("/team", async (req) => ({ data: await s.teamPage(await ctx(req)) }));
    app.post("/team/invites", { config: { rateLimit: { max: 20, timeWindow: "1 hour" } } }, async (req) => s.invite(await ctx(req), req.body));
    app.post<P>("/team/invites/:id/resend", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (req) => s.resendInvite(await ctx(req), req.params.id));
    app.post<P>("/team/invites/:id/revoke", async (req) => s.revokeInvite(await ctx(req), req.params.id));
    app.get("/invites/preview", async (req) => ({ data: await s.previewInvite(req.query) }));
    app.post("/invites/accept", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => s.acceptInvite(info(req), this.userOf(req), req.body));
    app.patch<U>("/team/members/:userId", async (req) => s.editMember(await ctx(req), req.params.userId, req.body));
    app.delete<U>("/team/members/:userId", async (req) => s.removeMember(await ctx(req), req.params.userId));
    app.post("/team/roles", async (req) => s.addRole(await ctx(req), req.body));
    app.patch<P>("/team/roles/:id", async (req) => s.editRole(await ctx(req), req.params.id, req.body));
    app.delete<P>("/team/roles/:id", async (req) => s.deleteRole(await ctx(req), req.params.id));
  }
}
