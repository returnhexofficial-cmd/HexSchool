"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Spinner } from "@/components/shared/spinner";
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

/** Whether a path belongs to an area that renders for a signed-in user. */
function needsSessionFor(pathname: string): boolean {
  return AUTHENTICATED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

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

  const needsSession = needsSessionFor(pathname);

  useEffect(() => {
    if (booted.current) return;
    if (!needsSession) return;
    booted.current = true;
    void dispatch(bootstrapSession());
  }, [dispatch, needsSession]);

  useEffect(() => {
    if (
      status === "authenticated" &&
      user?.mustChangePassword &&
      pathname !== "/change-password"
    ) {
      router.replace("/change-password?forced=1");
    }
  }, [status, user?.mustChangePassword, pathname, router]);

  /**
   * Hold the authenticated areas until the bootstrap settles.
   *
   * Rendering children immediately let every page mount and fire its queries
   * with no access token yet — so a cold load produced a burst of 401s that
   * the interceptor then refreshed and retried (QA finding F6), and the
   * `<Can>`-gated controls popped in a beat after the tables because
   * permissions had not arrived (F5).
   *
   * **Only the authenticated areas.** The public site deliberately skips the
   * bootstrap, so its status stays `"loading"` forever — gating on status
   * alone would render the entire marketing site blank.
   */
  if (needsSession && status === "loading") {
    return (
      <div
        className="flex min-h-svh items-center justify-center"
        role="status"
        aria-label="Loading"
      >
        <Spinner />
      </div>
    );
  }

  return children;
}
