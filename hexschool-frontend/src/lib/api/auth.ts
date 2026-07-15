import { api, ApiEnvelope, setAccessToken } from "./axios";
import type { UserStatus, UserType } from "@/lib/constants/enums";

/** Mirrors the backend's SafeUser (auth.service.ts). */
export interface AuthUser {
  id: string;
  schoolId: string;
  email: string | null;
  phone: string | null;
  userType: UserType;
  status: UserStatus;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
}

export interface SessionInfo {
  id: string;
  deviceInfo: { userAgent?: string; ip?: string; deviceName?: string };
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

interface LoginResponse {
  user: AuthUser;
  accessToken: string;
}

export const authApi = {
  async login(input: {
    identifier: string;
    password: string;
    rememberMe?: boolean;
    deviceName?: string;
  }): Promise<AuthUser> {
    const res = await api.post<ApiEnvelope<LoginResponse>>(
      "/auth/login",
      input,
    );
    setAccessToken(res.data.data.accessToken);
    return res.data.data.user;
  },

  /**
   * Session bootstrap on page load: the refresh cookie mints a new access
   * token. `_retry` marks the request so the axios interceptor never
   * chains a second refresh (or redirects) when this probe 401s.
   */
  async bootstrap(): Promise<AuthUser | null> {
    try {
      const res = await api.post<ApiEnvelope<LoginResponse>>(
        "/auth/refresh",
        {},
        { _retry: true } as object,
      );
      setAccessToken(res.data.data.accessToken);
      return res.data.data.user;
    } catch {
      setAccessToken(null);
      return null;
    }
  },

  async me(): Promise<{ user: AuthUser; permissions: string[] }> {
    const res =
      await api.get<ApiEnvelope<{ user: AuthUser; permissions: string[] }>>(
        "/auth/me",
      );
    return res.data.data;
  },

  async logout(allDevices = false): Promise<void> {
    try {
      await api.post("/auth/logout", { allDevices });
    } finally {
      setAccessToken(null);
    }
  },

  async forgotPassword(identifier: string): Promise<void> {
    await api.post("/auth/forgot-password", { identifier });
  },

  async verifyOtp(identifier: string, code: string): Promise<string> {
    const res = await api.post<ApiEnvelope<{ resetToken: string }>>(
      "/auth/verify-otp",
      { identifier, code },
    );
    return res.data.data.resetToken;
  },

  async resetPassword(resetToken: string, newPassword: string): Promise<void> {
    await api.post("/auth/reset-password", { resetToken, newPassword });
  },

  async changePassword(
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    await api.post("/auth/change-password", { currentPassword, newPassword });
  },

  async sessions(): Promise<SessionInfo[]> {
    const res = await api.get<ApiEnvelope<SessionInfo[]>>("/auth/sessions");
    return res.data.data;
  },

  async revokeSession(id: string): Promise<void> {
    await api.delete(`/auth/sessions/${id}`);
  },
};

/** Human-readable API error message (falls back to a generic line). */
export function apiErrorMessage(err: unknown): string {
  if (
    typeof err === "object" &&
    err !== null &&
    "response" in err &&
    typeof (err as { response?: { data?: unknown } }).response === "object"
  ) {
    const data = (
      err as { response: { data?: { error?: { message?: string } } } }
    ).response.data;
    if (data?.error?.message) return data.error.message;
  }
  return "Something went wrong. Please try again.";
}
