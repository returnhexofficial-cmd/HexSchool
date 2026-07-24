"use client";

import { useQuery } from "@tanstack/react-query";
import { NotificationBell } from "@/components/shared/notification-bell";
import { UserMenu } from "@/components/shared/user-menu";
import { schoolApi } from "@/lib/api/school";
import { useAuth } from "@/lib/store/hooks";

/**
 * Portal shell (Module 18) — the student / parent / teacher experience.
 * Deliberately lighter than the admin shell: parents are mobile-first, so
 * there is no fixed sidebar, just a top bar with the school identity, the
 * in-app bell (M17), and the account menu. Per-role navigation lives in
 * the page itself (tabs / child switcher).
 */
export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { status } = useAuth();
  const school = useQuery({
    queryKey: ["school"],
    queryFn: schoolApi.get,
    enabled: status === "authenticated",
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex h-14 items-center gap-3 border-b bg-card px-4">
        {school.data?.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={school.data.logoUrl}
            alt=""
            className="size-8 rounded object-contain"
          />
        ) : null}
        <span className="truncate font-semibold">
          {school.data?.name ?? "HexSchool"}
        </span>
        <div className="min-w-0 flex-1" />
        <NotificationBell />
        <UserMenu />
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
