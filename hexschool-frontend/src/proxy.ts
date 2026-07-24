import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { homePathFor, UserType } from "@/lib/constants/enums";

/**
 * Optimistic route guards (Next 16: proxy.ts replaces middleware.ts).
 *
 * Decisions are based on the non-sensitive `hs_session` hint cookie set by
 * the auth store — real enforcement always happens API-side via the global
 * JWT guard; this only prevents flashing protected shells at anonymous
 * visitors and routes users to the right portal.
 */
const ADMIN_TYPES = new Set<string>([
  UserType.SUPER_ADMIN,
  UserType.ADMIN,
  UserType.STAFF,
]);
const PORTAL_TYPES = new Set<string>([
  UserType.TEACHER,
  UserType.STUDENT,
  UserType.PARENT,
]);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const userType = request.cookies.get("hs_session")?.value;

  // Not signed in (as far as the hint knows) → to login, remembering where
  // the user was heading.
  if (!userType) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  // Teachers operate from the portal but do a few tasks in admin pages
  // they hold the permission for (attendance marking, mark entry, the
  // routine) — the admin sidebar's <Can> gating and the API guards handle
  // authorization; this only lets the shell render for them (M18 §5
  // "Take Attendance / Mark Entry shortcuts").
  const TEACHER_ADMIN_PATHS = ["/admin/attendance", "/admin/exams", "/admin/timetables"];
  const teacherAllowed =
    userType === UserType.TEACHER &&
    TEACHER_ADMIN_PATHS.some((p) => pathname.startsWith(p));

  // Signed in but in the wrong area → send to their own home.
  if (
    pathname.startsWith("/admin") &&
    !ADMIN_TYPES.has(userType) &&
    !teacherAllowed
  ) {
    return NextResponse.redirect(new URL(homePathFor(userType), request.url));
  }
  if (pathname.startsWith("/portal") && !PORTAL_TYPES.has(userType)) {
    return NextResponse.redirect(new URL(homePathFor(userType), request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/portal/:path*", "/account/:path*"],
};
