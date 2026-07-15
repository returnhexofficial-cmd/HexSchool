import { createAsyncThunk, createSlice, PayloadAction } from "@reduxjs/toolkit";
import { AuthUser, authApi } from "@/lib/api/auth";
import {
  clearSessionHint,
  setSessionHint,
} from "@/lib/utils/session-cookie";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

export interface AuthState {
  user: AuthUser | null;
  permissions: string[];
  status: AuthStatus;
}

const initialState: AuthState = {
  user: null,
  permissions: [],
  status: "loading",
};

/**
 * Page-load bootstrap: the httpOnly refresh cookie (if any) mints an
 * access token, then /auth/me hydrates profile + permissions.
 */
export const bootstrapSession = createAsyncThunk(
  "auth/bootstrap",
  async (): Promise<{ user: AuthUser; permissions: string[] } | null> => {
    const user = await authApi.bootstrap();
    if (!user) return null;
    const me = await authApi.me();
    return me;
  },
);

export const logout = createAsyncThunk(
  "auth/logout",
  async (allDevices: boolean = false): Promise<void> => {
    await authApi.logout(allDevices);
  },
);

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    /** Dispatched by the login page after authApi.login succeeds. */
    sessionEstablished(state, action: PayloadAction<AuthUser>) {
      state.user = action.payload;
      state.status = "authenticated";
      setSessionHint(action.payload.userType);
    },
    permissionsLoaded(state, action: PayloadAction<string[]>) {
      state.permissions = action.payload;
    },
    userUpdated(state, action: PayloadAction<Partial<AuthUser>>) {
      if (state.user) Object.assign(state.user, action.payload);
    },
    sessionCleared(state) {
      state.user = null;
      state.permissions = [];
      state.status = "unauthenticated";
      clearSessionHint();
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(bootstrapSession.fulfilled, (state, action) => {
        if (action.payload) {
          state.user = action.payload.user;
          state.permissions = action.payload.permissions;
          state.status = "authenticated";
          setSessionHint(action.payload.user.userType);
        } else {
          state.user = null;
          state.permissions = [];
          state.status = "unauthenticated";
          clearSessionHint();
        }
      })
      .addCase(bootstrapSession.rejected, (state) => {
        state.user = null;
        state.permissions = [];
        state.status = "unauthenticated";
        clearSessionHint();
      })
      .addCase(logout.fulfilled, (state) => {
        state.user = null;
        state.permissions = [];
        state.status = "unauthenticated";
        clearSessionHint();
      })
      // Even a failed logout call clears the client session.
      .addCase(logout.rejected, (state) => {
        state.user = null;
        state.permissions = [];
        state.status = "unauthenticated";
        clearSessionHint();
      });
  },
});

export const {
  sessionEstablished,
  permissionsLoaded,
  userUpdated,
  sessionCleared,
} = authSlice.actions;
export const authReducer = authSlice.reducer;
