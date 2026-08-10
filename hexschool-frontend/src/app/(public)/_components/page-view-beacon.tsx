"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { recordPageView } from "@/lib/api/analytics";

/**
 * Records one page view per public-site navigation (Module 29, roadmap §3).
 *
 * **Why a beacon and not middleware.** The roadmap's default suggestion
 * was a server-side counter on the public API routes, and it would give
 * wrong numbers: a Next-rendered marketing page makes anywhere between
 * zero and five `/public/*` calls depending on the route, so the notices
 * page would report five times the traffic of the homepage while the
 * homepage — which fetches nothing — reported none. Counting confidently
 * and wrongly is worse than counting a little short.
 *
 * The trade this makes instead is explicit: a reader with JavaScript off
 * is not counted. That understates traffic slightly and never distorts
 * the shape of it.
 *
 * It is a **client component with no markup**, so it adds nothing to the
 * static HTML the public pages are optimised around — the M19 Lighthouse
 * work stands. `sendBeacon` is not used deliberately: the request must
 * carry the app's own axios base URL and interceptors, and the fire-and-
 * forget behaviour is already handled by `recordPageView` swallowing
 * every error.
 */
export function PageViewBeacon() {
  const pathname = usePathname();
  const last = useRef<string | null>(null);

  useEffect(() => {
    // React Strict Mode runs effects twice in development, and a
    // navigation back to the same path is not a new view. One ref makes
    // both cases a no-op, which matters because the counter is the
    // reported figure — there is no de-duplication behind it.
    if (last.current === pathname) return;
    last.current = pathname;
    void recordPageView(pathname, document.referrer || undefined);
  }, [pathname]);

  return null;
}
