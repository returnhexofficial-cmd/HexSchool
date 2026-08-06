import type { CertificateTypeCode } from './types';

/**
 * Certificate numbering (roadmap M27 §3 `TC-{YY}-{SEQ4}` per type, §6
 * "sequential per type/year, never reused").
 *
 * **The counter key is the whole design.** PROJECT_CONTEXT §3 already
 * records the pattern; what it does not say is that "per type/year" means
 * six independent sequences per year, not one. A school issuing its
 * fourteenth transfer certificate and its second character certificate in
 * 2026 expects `TC-26-0014` and `CC-26-0002`, and a shared counter would
 * give the second one `CC-26-0015` — a number that is unique, sequential
 * and answers a question nobody asked. So the counter key carries the type.
 *
 * The gap-free guarantee is `SequenceService`'s: the number is claimed
 * inside the issuing transaction, so a rolled-back issue returns it.
 */

/** Default prefix per type — overridable per school via settings. */
export const DEFAULT_TYPE_PREFIXES: Record<CertificateTypeCode, string> = {
  TRANSFER: 'TC',
  CHARACTER: 'CC',
  TESTIMONIAL: 'TS',
  PRIZE: 'PR',
  PARTICIPATION: 'PA',
  CUSTOM: 'CE',
};

/**
 * The `{TYPE}` token is resolved here rather than inside `SequenceService`,
 * because the sequence renderer's tokens are school/date facts and this one
 * is a per-row fact. Everything after this call is the shared renderer's
 * job — one pattern language, one place that knows `{SEQ4}`.
 */
export function resolvePattern(
  pattern: string,
  type: CertificateTypeCode,
  prefixes: Partial<Record<CertificateTypeCode, string>> = {},
): string {
  const prefix = normalizePrefix(prefixes[type]) ?? DEFAULT_TYPE_PREFIXES[type];
  return pattern.replaceAll('{TYPE}', prefix);
}

/**
 * Counter identity: one sequence per school, per type, per calendar year.
 *
 * The year is part of the KEY rather than only of the rendered number.
 * Deriving it from the pattern instead would mean a school that drops
 * `{YY}` gets one counter that never resets — plausible — while a school
 * that keeps it gets numbers that restart at 1 each January against a
 * counter that did not, which produces `TC-27-0231` in the first week of
 * January. Keying on the year makes the reset real.
 */
export function counterKey(type: CertificateTypeCode, date: Date): string {
  const yy = String(date.getUTCFullYear()).slice(2);
  return `certificate:${type.toLowerCase()}:${yy}`;
}

/** Prefixes are printed on a document; blanks and spaces are not. */
function normalizePrefix(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toUpperCase();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Merge a school's configured prefix map over the defaults, dropping
 * anything that is not a usable prefix.
 *
 * A settings value is whatever somebody typed into a JSON box months ago,
 * so a malformed entry has to degrade to the default rather than produce
 * `undefined-26-0001` on a printed certificate — the M12/M13/M19
 * settings-service convention.
 */
export function mergePrefixes(
  configured: unknown,
): Record<CertificateTypeCode, string> {
  const merged = { ...DEFAULT_TYPE_PREFIXES };
  if (
    configured &&
    typeof configured === 'object' &&
    !Array.isArray(configured)
  ) {
    for (const [key, value] of Object.entries(configured)) {
      if (key in merged && typeof value === 'string') {
        const prefix = normalizePrefix(value);
        if (prefix) merged[key as CertificateTypeCode] = prefix;
      }
    }
  }
  return merged;
}

/**
 * Roadmap §8's legacy backfill: a number the school wrote by hand before
 * this system existed. It is not generated, so the only thing that can be
 * said about it is that it is a number — non-blank, not absurdly long, and
 * stored exactly as the school records it, because matching it later
 * against a paper register is the entire point of entering it.
 */
export function normalizeLegacyNumber(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

export function isUsableCertificateNumber(raw: string): boolean {
  const value = normalizeLegacyNumber(raw);
  return value.length > 0 && value.length <= 60;
}
