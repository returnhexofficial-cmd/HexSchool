/**
 * Shared enum registry — mirrors the backend's Prisma enums
 * (hexschool-backend/prisma/schema.prisma, re-exported from
 * src/common/constants/enums.ts). Keep both repos in sync per module.
 */

export enum UserType {
  SUPER_ADMIN = "SUPER_ADMIN",
  ADMIN = "ADMIN",
  STAFF = "STAFF",
  TEACHER = "TEACHER",
  STUDENT = "STUDENT",
  PARENT = "PARENT",
}

export enum UserStatus {
  ACTIVE = "ACTIVE",
  INACTIVE = "INACTIVE",
  SUSPENDED = "SUSPENDED",
  PENDING = "PENDING",
}

/** Where each user type lands after login (M02 routing rule). */
export function homePathFor(userType: UserType | string): string {
  switch (userType) {
    case UserType.SUPER_ADMIN:
    case UserType.ADMIN:
    case UserType.STAFF:
      return "/admin";
    default:
      return "/portal";
  }
}
