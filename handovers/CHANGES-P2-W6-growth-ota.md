# CHANGES P2-W6 Workspace part 2e: growth tools and the online travel sites, each into its own app

`business/backend/src/modules/growth/routes.ts` and `modules/ota/routes.ts` are split by owner (both old files are shims that register nothing):
- **Workspace** (`apps/workspace/backend/growth.*`): `GET /ai/usage`, `GET /analytics`, `GET/POST /channels`, `POST /channels/:id/disconnect`.
- **CRM** (`apps/crm/backend/finder.*`): `POST /ai/extract-leads` (the lead finder), `GET/POST /webhooks/meta` (incoming WhatsApp, Messenger, Instagram).
- **Hotel** (`apps/hotel/backend/ota.*`): `GET/POST /ota/feeds`, `POST /ota/feeds/:id/sync`, the public `GET /ical/:tenant/:type/:sig`, and
  `GET/POST /ota/requests`, `POST /ota/requests/:id/reply|pause`. `hotelRoutes` and `leadRoutes` now take `fetch` / `ai` (tests swap them).
Same routes, answers, messages and status codes. New: every change writes an audit line and an event in ONE transaction (`channel.connected|disconnected`,
`leads.found`, `ota.feed_added|feed_synced|requested|replied|paused`); webhook messages write `crm.lead.received` with the lead. Reading another site's
calendar takes up to 20 s, so it runs outside the transaction, and what it brought is written afterwards. Feed syncs do not take the room-type hold yet
(listed as a Phase 2 leftover). Tests: old tests unchanged; new `business/backend/test/growth-kernel.test.ts`.
