import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { describe, expect, it } from "vitest";
import { Can } from "./can";
import { makeStore } from "@/lib/store";
import { sessionEstablished, permissionsLoaded } from "@/lib/store/auth-slice";
import type { AuthUser } from "@/lib/api/auth";
import { UserType, UserStatus } from "@/lib/constants/enums";

const user = (userType: UserType): AuthUser => ({
  id: "u1",
  schoolId: "s1",
  email: "u@test.local",
  phone: null,
  userType,
  status: UserStatus.ACTIVE,
  mustChangePassword: false,
  lastLoginAt: null,
});

function renderWithAuth(
  ui: React.ReactNode,
  { userType = UserType.ADMIN, permissions = [] as string[] } = {},
) {
  const store = makeStore();
  store.dispatch(sessionEstablished(user(userType)));
  store.dispatch(permissionsLoaded(permissions));
  return render(<Provider store={store}>{ui}</Provider>);
}

describe("<Can>", () => {
  it("renders children when the permission is held", () => {
    renderWithAuth(
      <Can permission="role.view">
        <button>Visible</button>
      </Can>,
      { permissions: ["role.view"] },
    );
    expect(screen.getByRole("button", { name: "Visible" })).toBeInTheDocument();
  });

  it("hides children (renders fallback) when the permission is missing", () => {
    renderWithAuth(
      <Can permission="role.delete" fallback={<span>No access</span>}>
        <button>Hidden</button>
      </Can>,
      { permissions: ["role.view"] },
    );
    expect(screen.queryByRole("button", { name: "Hidden" })).toBeNull();
    expect(screen.getByText("No access")).toBeInTheDocument();
  });

  it("array permission uses AND semantics", () => {
    renderWithAuth(
      <Can permission={["role.view", "role.update"]}>
        <span>Both</span>
      </Can>,
      { permissions: ["role.view"] },
    );
    expect(screen.queryByText("Both")).toBeNull();
  });

  it("anyOf uses OR semantics", () => {
    renderWithAuth(
      <Can anyOf={["permission.view", "role.view"]}>
        <span>Either</span>
      </Can>,
      { permissions: ["role.view"] },
    );
    expect(screen.getByText("Either")).toBeInTheDocument();
  });

  it("Super Admin bypasses every check", () => {
    renderWithAuth(
      <Can permission="anything.at-all">
        <span>Bypassed</span>
      </Can>,
      { userType: UserType.SUPER_ADMIN, permissions: [] },
    );
    expect(screen.getByText("Bypassed")).toBeInTheDocument();
  });

  it("renders children when no permission prop is given", () => {
    renderWithAuth(
      <Can>
        <span>Open</span>
      </Can>,
    );
    expect(screen.getByText("Open")).toBeInTheDocument();
  });
});
