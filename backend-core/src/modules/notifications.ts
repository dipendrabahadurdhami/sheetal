import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Prisma } from "@prisma/client";
import { dbOf } from "../lib/db.js";
import { notFound } from "../lib/errors.js";

// The bell in a panel: the signed-in person's notifications for that panel (one business, or Sheetal staff work).
// `scope` picks them for each request; read, read-all and remove only ever touch the person's own.

export function notificationRoutes(app: FastifyInstance, path: string, scope: (request: FastifyRequest) => Prisma.NotificationWhereInput) {
  const json = (n: { id: string; type: string; title: string; message: string; link: string | null; readAt: Date | null; createdAt: Date }) =>
    ({ id: n.id, type: n.type, title: n.title, message: n.message, link: n.link, read: !!n.readAt, at: n.createdAt });

  app.get(path, async (request) => {
    const where = scope(request);
    const [rows, unread] = await Promise.all([
      dbOf(app).notification.findMany({ where, orderBy: { createdAt: "desc" }, take: 50 }),
      dbOf(app).notification.count({ where: { ...where, readAt: null } }),
    ]);
    return { data: rows.map(json), meta: { unread } };
  });
  app.post<{ Params: { id: string } }>(`${path}/:id/read`, async (request) => {
    const r = await dbOf(app).notification.updateMany({ where: { ...scope(request), id: request.params.id, readAt: null }, data: { readAt: new Date() } });
    return { data: { changed: r.count } };
  });
  app.post(`${path}/read-all`, async (request) => {
    const r = await dbOf(app).notification.updateMany({ where: { ...scope(request), readAt: null }, data: { readAt: new Date() } });
    return { data: { changed: r.count } };
  });
  app.delete<{ Params: { id: string } }>(`${path}/:id`, async (request) => {
    const r = await dbOf(app).notification.deleteMany({ where: { ...scope(request), id: request.params.id } });
    if (!r.count) throw notFound("Notification not found.");
    return { data: { removed: r.count } };
  });
}
