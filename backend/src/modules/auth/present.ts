import type { SessionUser } from "./sessions.js";

// The user object the website reads (same field names as the old API, so screens keep working).
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
