/**
 * Non-sensitive session HINT cookie (`hs_session=<userType>`), readable by
 * proxy.ts for optimistic route guards. It carries no secret — the real
 * session lives in the httpOnly refresh cookie on the API host and every
 * API call is enforced server-side by the JWT guard.
 */
const NAME = "hs_session";
const MAX_AGE_DAYS = 30;

export function setSessionHint(userType: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${NAME}=${encodeURIComponent(userType)}; path=/; max-age=${
    MAX_AGE_DAYS * 24 * 60 * 60
  }; samesite=lax`;
}

export function clearSessionHint(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${NAME}=; path=/; max-age=0; samesite=lax`;
}

export const SESSION_HINT_COOKIE = NAME;
