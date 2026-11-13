# CHANGES P2-W4 Hotel on the kernel, screens on the kit

- `business/backend/src/modules/hotel/routes.ts` → `apps/hotel/backend/` (`repositories.ts`, `hotel.service.ts`, `hotel.controller.ts`, `presenter.ts`, `routes.ts`,
  `index.ts`). The old file is a shim (still exports `bookingCode`, `folioOf`). `app.ts` registers `hotelRoutes` from `@sheetal/app-hotel/backend` with
  `contextOf: businessContextOf` (rule 11).
- Same routes, answers, messages and audit strings; every audit line is now written in the same transaction as the change.
- **Double booking at the same moment:** a booking (new, moved dates or room, check-in) re-checks that the room and the type are free INSIDE its transaction,
  after holding the rooms of that type at that branch (`SELECT … FOR UPDATE`). Before, two people booking the last room at once could both succeed.
  The online travel sites (`modules/ota`, backend-core `domain/ota.ts`) still write bookings from their feeds without that hold; they move later.
- Check-out reads the room bill again inside its transaction (a charge added a moment ago must be paid too). Status changes are compare-and-set.
- Migration `20261113140000_hotel_kernel_columns` (additive) on `rooms`, `bookings`. Room-bill lines, guest payments, night prices and rules get no kernel
  columns, on purpose (see `repositories.ts`).
- Rooms and bookings carry `version`; a room or booking change may send it (stale = 409).
- Events: `hotel.room.added|updated`, `hotel.calendar.changed`, `hotel.booking.created|updated|cancelled|checked_in|checked_out`, `hotel.folio.added`,
  `hotel.payment.received`.
- `hotel` added to `PHASE_ONE_CAPS`.
- Screens: Front desk, Bookings and Calendar moved to `apps/hotel/frontend/pages/HotelPages.jsx` on the kit. `LiveOps.jsx` now holds only the old names
  (re-exports of the Hotel, POS, Projects and Investments pages). The pages now also reload when the branch picked at the top changes.
- Tests: `operations.test.ts` unchanged; new `business/backend/test/hotel-kernel.test.ts` (including two bookings of the last room at once) and
  `apps/hotel/frontend/pages/HotelPages.test.js`.
