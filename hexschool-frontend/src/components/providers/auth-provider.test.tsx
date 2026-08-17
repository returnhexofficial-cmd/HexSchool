import { describe, expect, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const dispatch = vi.fn();
let pathname = "/";
let authState: { user: unknown; status: string } = {
  user: null,
  status: "unauthenticated",
};

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock("@/lib/store/hooks", () => ({
  useAppDispatch: () => dispatch,
  useAuth: () => authState,
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
    authState = { user: null, status: "unauthenticated" };
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

/**
 * QA findings F5 and F6 — the provider used to render children immediately,
 * so every page mounted and fired its queries before an access token existed.
 * A cold load produced a burst of 401s that were then refreshed and retried,
 * and `<Can>`-gated controls appeared a beat after the tables they belong to.
 */
describe("AuthProvider holds authenticated areas until auth settles", () => {
  beforeEach(() => {
    dispatch.mockClear();
    authState = { user: null, status: "unauthenticated" };
  });

  it.each(["/admin", "/admin/students", "/portal", "/account/sessions"])(
    "does not render %s children while the session is still bootstrapping",
    (route) => {
      pathname = route;
      authState = { user: null, status: "loading" };
      const { queryByText, getByRole } = render(
        <AuthProvider>secret-content</AuthProvider>,
      );
      expect(queryByText("secret-content")).toBeNull();
      expect(getByRole("status")).toBeTruthy();
    },
  );

  it("renders children once the session resolves", () => {
    pathname = "/admin";
    authState = { user: { mustChangePassword: false }, status: "authenticated" };
    const { queryByText } = render(<AuthProvider>secret-content</AuthProvider>);
    expect(queryByText("secret-content")).not.toBeNull();
  });

  it("renders children when the session resolves to unauthenticated", () => {
    // The route guard, not this provider, decides where an anonymous user
    // goes — blocking here would deadlock the redirect.
    pathname = "/admin";
    authState = { user: null, status: "unauthenticated" };
    const { queryByText } = render(<AuthProvider>secret-content</AuthProvider>);
    expect(queryByText("secret-content")).not.toBeNull();
  });

  it.each(["/", "/news", "/some-cms-page", "/login"])(
    "never holds the public route %s, whose status stays 'loading' forever",
    (route) => {
      // The public site skips the bootstrap entirely, so its status never
      // leaves "loading". Gating on status alone would blank the whole
      // marketing site — the trap this test exists to catch.
      pathname = route;
      authState = { user: null, status: "loading" };
      const { queryByText } = render(<AuthProvider>public-content</AuthProvider>);
      expect(queryByText("public-content")).not.toBeNull();
    },
  );
});
