import { useEffect, useState } from "react";
import { useStore } from "@sheetal/shared/core/store";
import { adminApi, adminApiReady, signedIn } from "./api";

// When a Sheetal staff member is signed in, the panel uses their real staff role, and the review queue reads from
// the admin API. Screens not on the API yet keep their current data until their phase.

let staffLive = false;
/** True once the admin API has confirmed the signed-in person is Sheetal staff. */
export const isStaffLive = () => staffLive;

export function useLiveStaff() {
  const { update } = useStore();
  const [, setReady] = useState(false);
  useEffect(() => {
    if (!adminApiReady() || !signedIn()) return;
    adminApi("GET", "/admin/me").then(({ data }) => {
      staffLive = true;
      update((d) => { d.session = { ...d.session, platformRoleId: `p-${data.role}`, userName: data.name, userEmail: data.email }; });
      setReady(true);
    }).catch(() => { /* not staff, or the API is off: the panel keeps working on its own data */ });
  }, []);
}

/** The listing review queue (oldest first) and the number waiting, refreshed every minute and after each decision. */
export function useReviewQueue(enabled) {
  const [state, setState] = useState({ rows: null, waiting: 0, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let gone = false;
    const load = () => adminApi("GET", "/admin/listings?status=pending")
      .then((r) => !gone && setState({ rows: r.data, waiting: r.meta.waiting, error: null }))
      .catch((e) => !gone && setState((s) => ({ ...s, rows: s.rows || [], error: e.message })));
    load();
    const every = setInterval(load, 60_000);
    return () => { gone = true; clearInterval(every); };
  }, [enabled, tick]);
  return { ...state, reload: () => setTick((n) => n + 1) };
}

export const reviewListing = (id) => adminApi("GET", `/admin/listings/${id}`).then((r) => r.data);
export const decideListing = (id, decision, note) => adminApi("POST", `/admin/listings/${id}/review`, { decision, note });
