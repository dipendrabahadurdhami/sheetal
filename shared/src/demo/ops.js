// A business's day-to-day data in the store: rooms, menu, tables, bookings, the open shift, conversations.
// How it works: every business starts empty; the live loaders fill it from the APIs.

export function emptyOps() {
  return {
    rooms: [], menu: [], tables: [], extras: [], bookings: [], conversations: [],
    shift: { open: false, by: null, since: null, float: 0, sales: { cash: 0, fonepay: 0, card: 0, esewa: 0, room: 0 } },
  };
}

/** This business's operations, or an empty set if it has none yet. */
export const opsOf = (db, tid) => db.ops?.[tid] || emptyOps();
