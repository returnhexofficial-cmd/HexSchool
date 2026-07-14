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

      if (error.response?.status === 401 && original && !original._retry) {
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
