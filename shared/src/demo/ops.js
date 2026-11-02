// Day-to-day operations of one business: rooms, menu, tables, extras, bookings, the open shift and
// conversations. Every business starts empty; the backend fills these from real activity.
export function emptyOps() {
  return {
    rooms: [], menu: [], tables: [], extras: [], bookings: [], conversations: [],
    shift: { open: false, by: null, since: null, float: 0, sales: { cash: 0, fonepay: 0, card: 0, esewa: 0, room: 0 } },
  };
}

/** This business's operations, or an empty set if it has none yet. */
export const opsOf = (db, tid) => db.ops?.[tid] || emptyOps();
