"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { useAuth } from "@/lib/store/hooks";
import {
  resolveRoutePermission,
  satisfiesMenuItem,
} from "@/lib/config/resolve-route-permission";
import { Button } from "@/components/ui/button";

/**
 * Route-level permission gate for the admin shell.
 *
 * The sidebar has always been gated, but the *routes* were not: a user without
 * `role.view` who typed, bookmarked or back-buttoned their way to
 * `/admin/roles` got the full page chrome — heading, table headers, a working
 * Export button — with "Insufficient permissions" inside the table and a "Try
 * again" that could never succeed (QA finding F8).
 *
 * The API was, and remains, the authoritative boundary; this is the UX half.
 * It reads the same ADMIN_MENU declarations that gate the sidebar, so the two
 * cannot drift.
 *
 * **It deliberately renders children while auth is still loading.** Permissions
 * arrive with /auth/me, so deciding early would flash a denial on every cold
 * load for users who are perfectly entitled (the F5/F6 failure mode).
 */
export function RouteGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { status } = useAuth();
  const { can, canAny } = usePermissions();

  const item = resolveRoutePermission(pathname);
  const allowed = satisfiesMenuItem(item, { can, canAny });

  if (status !== "authenticated" || allowed) return <>{children}</>;

  return (
    <div className="flex min-h-[60svh] flex-col items-center justify-center gap-3 p-10 text-center">
      <ShieldAlert className="size-10 text-muted-foreground" aria-hidden />
      <p className="text-lg font-medium">You don&apos;t have access to this page</p>
      <p className="max-w-md text-sm text-muted-foreground">
        Your account doesn&apos;t include the permission this section requires
        {item?.label ? ` (${item.label})` : ""}. If you think that&apos;s wrong,
        ask an administrator to review your role.
      </p>
      <Button asChild variant="outline" className="mt-2">
        <Link href="/admin">Back to dashboard</Link>
      </Button>
    </div>
  );
}
