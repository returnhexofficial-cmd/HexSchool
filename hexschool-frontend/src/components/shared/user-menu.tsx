"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { logout } from "@/lib/store/auth-slice";
import { useAppDispatch, useAuth } from "@/lib/store/hooks";

/**
 * Minimal signed-in header strip (M02). The full admin shell with sidebar
 * and session switcher arrives in later modules — this only exposes who is
 * logged in, the session manager, and logout.
 */
export function UserMenu() {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const { user, status } = useAuth();

  if (status !== "authenticated" || !user) return null;

  const signOut = async () => {
    await dispatch(logout(false));
    router.replace("/login");
  };

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border bg-card px-4 py-2 text-sm">
      <span className="truncate text-muted-foreground">
        Signed in as{" "}
        <span className="font-medium text-foreground">
          {user.email ?? user.phone}
        </span>{" "}
        ({user.userType})
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/account/sessions">Devices</Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link href="/change-password">Password</Link>
        </Button>
        <Button variant="outline" size="sm" onClick={() => void signOut()}>
          Sign out
        </Button>
      </span>
    </div>
  );
}
