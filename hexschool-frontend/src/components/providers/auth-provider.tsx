"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { bootstrapSession } from "@/lib/store/auth-slice";
import { useAppDispatch, useAuth } from "@/lib/store/hooks";

/**
 * Route prefixes that render something for a signed-in user. Everything
 * else is the Module 19 public site, which shows an anonymous visitor the
 * same page either way.
 *
 * Deliberately an allow-list of *authenticated* areas rather than of public
 * ones: the public site includes a `[slug]` catch-all for CMS pages, so any
 * top-level path can be public and no public list could stay complete. The
 * failure mode here is also the safer one — forget to add a new admin area
 * and a hard refresh simply does not restore the session, which shows up
 * immediately; the route guard still redirects to login.
 */
const AUTHENTICATED_PREFIXES = [
  "/admin",
  "/portal",
  "/account",
  "/change-password",
];

/**
 * Bootstraps the session once per tab (refresh cookie → access token →
 * /auth/me) and enforces the forced-password-change interstitial:
 * a user with must_change_password can go nowhere but /change-password.
 *
 * The bootstrap is skipped on the public site. An anonymous visitor has no
 * refresh cookie, so it could only ever 401 — an extra round trip on the
 * critical path of the pages that most need to be fast, and a console error
 * on every marketing page (both flagged by the Module 19 Lighthouse run).
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const dispatch = useAppDispatch();
  const { user, status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const booted = useRef(false);

  useEffect(() => {
    if (booted.current) return;
    const needsSession = AUTHENTICATED_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
    if (!needsSession) return;
    booted.current = true;
    void dispatch(bootstrapSession());
  }, [dispatch, pathname]);

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
