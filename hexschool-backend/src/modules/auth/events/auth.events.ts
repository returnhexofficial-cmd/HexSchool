import { LoginEvent } from '../../../common/constants';

/**
 * Auth domain events (roadmap M02 §Events). Emitted by AuthService via
 * @nestjs/event-emitter; the listener writes `login_activities` and sends
 * the lock-alert SMS. In-process now, queue-swap-ready (PROJECT_CONTEXT §16).
 */
export const AUTH_EVENTS = {
  LOGGED_IN: 'user.logged_in',
  LOGIN_FAILED: 'user.login_failed',
  LOGGED_OUT: 'user.logged_out',
  REFRESHED: 'user.refreshed',
  LOCKED: 'user.locked',
  TOKEN_REUSE: 'user.token_reuse',
  PASSWORD_CHANGED: 'password.changed',
} as const;

export interface AuthActivityEvent {
  userId: string;
  /** What gets written into login_activities. */
  event: LoginEvent;
  ip?: string | null;
  userAgent?: string | null;
  /** Phone to alert (lock / token-reuse notifications). */
  alertPhone?: string | null;
}
