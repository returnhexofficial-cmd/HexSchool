/**
 * Recursive redaction of secret-bearing fields before anything is
 * persisted to audit_logs (roadmap M03 §4 — password_hash, tokens, OTP
 * codes must never appear in the log, even inside nested objects).
 */

const SENSITIVE_KEY_PATTERN =
  /password|token|secret|otp|code_hash|codehash|apikey|api_key|authorization/i;

export const REDACTED = '[REDACTED]';

const MAX_DEPTH = 8;

export function redactSensitive(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return REDACTED; // defensive: no runaway recursion

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item, depth + 1));
  }
  if (value instanceof Date) return value;

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? REDACTED
      : redactSensitive(val, depth + 1);
  }
  return out;
}
