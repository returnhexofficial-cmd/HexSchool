"use client";

import { useMemo } from "react";
import { useAuth } from "@/lib/store/hooks";
import { UserType } from "@/lib/constants/enums";

export interface PermissionChecks {
  /** Sorted permission codes from /auth/me. */
  permissions: string[];
  /** Super Admins bypass checks — mirrors the backend guard. */
  isSuperAdmin: boolean;
  /** AND: every listed code must be held. */
  can: (...codes: string[]) => boolean;
  /** OR: at least one listed code must be held. */
  canAny: (...codes: string[]) => boolean;
}

/**
 * Client-side permission checks (UI gating only — real enforcement is
 * always the API's PermissionsGuard). Codes come from the auth store,
 * hydrated by /auth/me and refreshed on session bootstrap.
 */
export function usePermissions(): PermissionChecks {
  const { user, permissions } = useAuth();
  return useMemo(() => {
    const held = new Set(permissions);
    const isSuperAdmin = user?.userType === UserType.SUPER_ADMIN;
    return {
      permissions,
      isSuperAdmin,
      can: (...codes: string[]) =>
        isSuperAdmin || codes.every((code) => held.has(code)),
      canAny: (...codes: string[]) =>
        isSuperAdmin || codes.some((code) => held.has(code)),
    };
  }, [user?.userType, permissions]);
}
