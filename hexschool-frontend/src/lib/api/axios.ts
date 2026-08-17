import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from "axios";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

/** Standard backend envelopes (`{ success, data, meta?, message? }`). */
export interface ApiEnvelope<T> {
  success: true;
  data: T;
  meta?: PaginationMeta;
  message?: string;
}

export interface ApiError {
  success: false;
  error: { code: string; message: string; details?: unknown };
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// Access token lives in memory only (refresh token is an httpOnly cookie).
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

interface RetriableConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

/**
 * Single-flight refresh: concurrent 401s share one refresh request instead
 * of stampeding `/auth/refresh` (Module 02 provides the endpoint).
 */
let refreshPromise: Promise<string | null> | null = null;

/**
 * Endpoints whose 401 is the *business answer*, not an expired access token.
 *
 * The backend raises `UnauthorizedException` for both "your access token is
 * gone" and "that password is wrong", so the status code and the error
 * envelope look identical. Refreshing cannot turn a wrong password into a
 * right one, so retrying these only ever costs a second identical request.
 *
 * QA finding F3: submitting change-password with the wrong current password
 * produced `POST /auth/change-password 401` → `POST /auth/refresh 200` →
 * `POST /auth/change-password 401` — the same wrong password sent twice,
 * doubling audit rows and burning the 5/min credential throttle at twice the
 * rate.
 *
 * The cleaner fix is for the backend to return 400/422 for a credential
 * mismatch and reserve 401 for "not authenticated" — but that changes a
 * published API contract, so it is recorded as follow-up rather than done
 * here.
 */
const BUSINESS_401_ENDPOINTS = [
  "/auth/login",
  "/auth/change-password",
  "/auth/reset-password",
  "/auth/verify-otp",
];

function isBusiness401(url: string | undefined): boolean {
  if (!url) return false;
  // Compare on the path only: baseURL may or may not be applied yet, and a
  // query string must not defeat the match.
  const path = url.split("?")[0];
  return BUSINESS_401_ENDPOINTS.some((endpoint) => path.endsWith(endpoint));
}

async function refreshAccessToken(client: AxiosInstance): Promise<string | null> {
  try {
    const res = await client.post<ApiEnvelope<{ accessToken: string }>>(
      "/auth/refresh",
      {},
      // Cast: marker consumed by the response interceptor below.
      { _retry: true } as Partial<RetriableConfig>,
    );
    const token = res.data.data.accessToken ?? null;
    setAccessToken(token);
    return token;
  } catch {
    setAccessToken(null);
    return null;
  }
}

export function createApiClient(): AxiosInstance {
  const client = axios.create({
    baseURL: API_BASE_URL,
    withCredentials: true, // refresh cookie
    headers: { "Content-Type": "application/json" },
    timeout: 30_000,
  });

  client.interceptors.request.use((config) => {
    if (accessToken) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }
    return config;
  });

  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const original = error.config as RetriableConfig | undefined;

      if (
        error.response?.status === 401 &&
        original &&
        !original._retry &&
        // F3 — a credential refusal is the answer, not a stale token.
        !isBusiness401(original.url)
      ) {
        original._retry = true;
        refreshPromise ??= refreshAccessToken(client).finally(() => {
          refreshPromise = null;
        });
        const token = await refreshPromise;
        if (token) {
          original.headers.Authorization = `Bearer ${token}`;
          return client(original);
        }
        // Refresh failed → session is gone; land on login.
        if (typeof window !== "undefined") {
          window.location.assign("/login");
        }
      }
      return Promise.reject(error);
    },
  );

  return client;
}

/** App-wide API client. Imported by every data hook. */
export const api = createApiClient();
