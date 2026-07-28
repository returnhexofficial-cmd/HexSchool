import { describe, expect, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const dispatch = vi.fn();
let pathname = "/";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock("@/lib/store/hooks", () => ({
  useAppDispatch: () => dispatch,
  useAuth: () => ({ user: null, status: "unauthenticated" }),
}));

vi.mock("@/lib/store/auth-slice", () => ({
  bootstrapSession: () => ({ type: "auth/bootstrap" }),
}));

import { AuthProvider } from "./auth-provider";

/**
 * The public site must not call `/auth/refresh`: an anonymous visitor has
 * no refresh cookie, so it can only 401 — a wasted round trip on the
 * critical path and a console error on every marketing page.
 */
describe("AuthProvider session bootstrap", () => {
  beforeEach(() => {
    dispatch.mockClear();
  });

  it.each(["/", "/news", "/admission/apply", "/some-cms-page", "/login"])(
    "does not bootstrap on the public route %s",
    (route) => {
      pathname = route;
      render(<AuthProvider>ok</AuthProvider>);
      expect(dispatch).not.toHaveBeenCalled();
    },
  );

  it.each(["/admin", "/admin/students", "/portal", "/account/sessions", "/change-password"])(
    "bootstraps on the authenticated route %s",
    (route) => {
      pathname = route;
      render(<AuthProvider>ok</AuthProvider>);
      expect(dispatch).toHaveBeenCalledTimes(1);
    },
  );

  it("does not treat a public path that merely starts with an app name as authenticated", () => {
    // A CMS page called "administration" is not the admin area.
    pathname = "/administration";
    render(<AuthProvider>ok</AuthProvider>);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("bootstraps at most once per tab", () => {
    pathname = "/admin";
    const { rerender } = render(<AuthProvider>ok</AuthProvider>);
    rerender(<AuthProvider>ok</AuthProvider>);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
