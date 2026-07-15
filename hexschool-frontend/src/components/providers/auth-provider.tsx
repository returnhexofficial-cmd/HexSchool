"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { bootstrapSession } from "@/lib/store/auth-slice";
import { useAppDispatch, useAuth } from "@/lib/store/hooks";

/**
 * Bootstraps the session once per tab (refresh cookie → access token →
 * /auth/me) and enforces the forced-password-change interstitial:
 * a user with must_change_password can go nowhere but /change-password.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const dispatch = useAppDispatch();
  const { user, status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const booted = useRef(false);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void dispatch(bootstrapSession());
  }, [dispatch]);

  useEffect(() => {
    if (
      status === "authenticated" &&
      user?.mustChangePassword &&
      pathname !== "/change-password"
    ) {
      router.replace("/change-password?forced=1");
    }
  }, [status, user?.mustChangePassword, pathname, router]);

  return children;
}
