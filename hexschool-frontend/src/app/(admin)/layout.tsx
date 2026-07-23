"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Can } from "@/components/shared/can";
import { NotificationBell } from "@/components/shared/notification-bell";
import { SessionSwitcher } from "@/components/shared/session-switcher";
import { UserMenu } from "@/components/shared/user-menu";
import { schoolApi } from "@/lib/api/school";
import { ADMIN_MENU } from "@/lib/config/admin-menu";
import { useAuth } from "@/lib/store/hooks";
import { cn } from "@/lib/utils";

/**
 * Admin shell (started in M03 with the RBAC pages; the session switcher
 * and dashboards arrive with Modules 04–05). Sidebar items are declared
 * in ADMIN_MENU and permission-gated via <Can> — routes are additionally
 * guarded by proxy.ts and, authoritatively, by the API.
 */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { status } = useAuth();
  // School identity for the header (M04); logoUrl is a signed S3 URL.
  const school = useQuery({
    queryKey: ["school"],
    queryFn: schoolApi.get,
    enabled: status === "authenticated",
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className="flex min-h-svh">
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-card sm:flex">
        <div className="flex h-14 items-center gap-2 border-b px-4 font-semibold">
          {school.data?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={school.data.logoUrl}
              alt=""
              className="size-7 rounded object-contain"
            />
          ) : null}
          <span className="truncate">{school.data?.name ?? "HexSchool"}</span>
        </div>
        <nav className="flex-1 space-y-1 p-2">
          {ADMIN_MENU.map((item) => {
            const active =
              item.href === "/admin"
                ? pathname === "/admin"
                : pathname.startsWith(item.href);
            return (
              <Can
                key={item.href}
                permission={item.permission}
                anyOf={item.anyOf}
              >
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <item.icon className="size-4" />
                  {item.label}
                </Link>
              </Can>
            );
          })}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b p-3">
          {/* Global session switcher (M05) — session-scoped pages read it. */}
          <SessionSwitcher />
          <div className="min-w-0 flex-1" />
          {/* In-app notification bell (M17). */}
          <NotificationBell />
          <UserMenu />
        </header>
        <div className="flex-1">{children}</div>
      </div>
    </div>
  );
}
