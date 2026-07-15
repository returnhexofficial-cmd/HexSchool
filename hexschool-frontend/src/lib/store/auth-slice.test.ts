import { describe, expect, it, vi } from "vitest";
import { makeStore } from "./index";
import {
  bootstrapSession,
  sessionCleared,
  sessionEstablished,
  userUpdated,
} from "./auth-slice";
import type { AuthUser } from "@/lib/api/auth";
import { UserStatus, UserType } from "@/lib/constants/enums";

vi.mock("@/lib/api/auth", () => ({
  authApi: {
    bootstrap: vi.fn().mockResolvedValue(null),
    me: vi.fn(),
    logout: vi.fn(),
  },
}));

const user: AuthUser = {
  id: "u1",
  schoolId: "s1",
  email: "a@b.c",
  phone: null,
  userType: UserType.ADMIN,
  status: UserStatus.ACTIVE,
  mustChangePassword: false,
  lastLoginAt: null,
};

describe("auth slice", () => {
  it("starts in loading state", () => {
    const store = makeStore();
    expect(store.getState().auth.status).toBe("loading");
  });

  it("sessionEstablished → authenticated with user", () => {
    const store = makeStore();
    store.dispatch(sessionEstablished(user));
    expect(store.getState().auth).toMatchObject({
      status: "authenticated",
      user: { id: "u1" },
    });
    expect(document.cookie).toContain("hs_session=ADMIN");
  });

  it("userUpdated patches the profile (forced-change cleared)", () => {
    const store = makeStore();
    store.dispatch(sessionEstablished({ ...user, mustChangePassword: true }));
    store.dispatch(userUpdated({ mustChangePassword: false }));
    expect(store.getState().auth.user?.mustChangePassword).toBe(false);
  });

  it("sessionCleared wipes user + hint cookie", () => {
    const store = makeStore();
    store.dispatch(sessionEstablished(user));
    store.dispatch(sessionCleared());
    expect(store.getState().auth).toMatchObject({
      status: "unauthenticated",
      user: null,
    });
    expect(document.cookie).not.toContain("hs_session=ADMIN");
  });

  it("bootstrap without a valid refresh cookie → unauthenticated", async () => {
    const store = makeStore();
    await store.dispatch(bootstrapSession());
    expect(store.getState().auth.status).toBe("unauthenticated");
  });
});
