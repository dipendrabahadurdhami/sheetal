// The People rows as the repositories hand them out (the Prisma columns of Attendance, LeaveType and LeaveRequest, with the kernel columns).
// Where it fits: the type parameters of the repositories and of PeopleService.
// How it works: types only. Attendance and LeaveRequest belong to one branch; LeaveType is business-wide.
// Rules: the kernel columns (version, createdBy, updatedBy, updatedAt, deletedAt, deletedBy) were added by migration 20261113090000_people_kernel_columns.

import type { BranchEntity, BusinessEntity } from "@sheetal/platform/core/repository";

export interface AttendanceRow extends BranchEntity {
  userId: string; day: Date; inAt: Date; outAt: Date | null;
  inLat: number | null; inLng: number | null; outLat: number | null; outLng: number | null;
  late: boolean; note: string | null; source: string; editedBy: string | null;
}
export interface LeaveTypeRow extends BusinessEntity { name: string; daysPerYear: number; paid: boolean; active: boolean }
export interface LeaveRequestRow extends BranchEntity {
  userId: string; typeId: string; fromDay: Date; toDay: Date; days: number; halfDay: boolean; reason: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled" | string; decidedBy: string | null; decidedAt: Date | null; note: string | null;
}
/** A person of the business who works at a branch in view. */
export interface TeamPerson { userId: string; name: string; role: string }
export interface UserName { id: string; userName: string; firstName: string | null; lastName: string | null }
