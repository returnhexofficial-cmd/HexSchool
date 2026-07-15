"use client";

import { usePermissions } from "@/lib/hooks/use-permissions";

interface CanProps {
  /** Required code(s) — string or array means ALL must be held. */
  permission?: string | string[];
  /** OR alternative: render when ANY of these codes is held. */
  anyOf?: string[];
  /** Rendered when the check fails (default: nothing). */
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Permission gate for menu items, buttons and page sections (roadmap
 * global convention). UI-only: the API re-checks everything server-side.
 *
 *   <Can permission="role.create"><Button>New role</Button></Can>
 *   <Can anyOf={["role.view", "permission.view"]}>…</Can>
 */
export function Can({ permission, anyOf, fallback = null, children }: CanProps) {
  const { can, canAny } = usePermissions();

  const required =
    permission === undefined
      ? []
      : Array.isArray(permission)
        ? permission
        : [permission];
  const allowed =
    (required.length === 0 || can(...required)) &&
    (anyOf === undefined || anyOf.length === 0 || canAny(...anyOf));

  return <>{allowed ? children : fallback}</>;
}
