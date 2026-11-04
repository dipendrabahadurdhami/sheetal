// The signed-in person as the website reads them.
// Where it fits: sign-in and profile replies on the website API.
// How it works: same field names as the old site's API, so existing screens keep working.

import type { SessionUser } from "./sessions.js";

/** The person in the shape the website expects. */
export function userJson(user: SessionUser) {
  const main = user.memberships[0];
  return {
    id: user.id,
    user_name: user.userName,
    first_name: user.firstName,
    last_name: user.lastName,
    email: user.email,
    phone: user.phone,
    address: user.address,
    photo: user.photoUrl,
    user_type: user.userType,
    email_verified: !!user.emailVerifiedAt,
    platform_role: user.platformRole,
    plan: main?.tenant.plan.name ?? null,
    workspaces: user.memberships.map((m) => ({ id: m.tenant.id, name: m.tenant.name, type: m.tenant.type, role: m.role.key, plan: m.tenant.plan.name, status: m.tenant.status })),
  };
}
