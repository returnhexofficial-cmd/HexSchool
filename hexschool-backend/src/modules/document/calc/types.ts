/**
 * Plain string-literal unions mirroring the PG enums this module's engines
 * reason about.
 *
 * **No `calc/` engine imports `@prisma/client`** — the rule M24 broke and
 * paid for (reaching for the generated enums pulled the whole client into
 * every engine and every spec until Jest's workers ran out of memory), and
 * that M26 then applied from the start. `tsc` checks these lists agree with
 * the generated enums at every call site, so a divergence is a compile
 * error rather than a runtime surprise.
 */

export type CertificateTypeCode =
  | 'TRANSFER'
  | 'CHARACTER'
  | 'TESTIMONIAL'
  | 'PRIZE'
  | 'PARTICIPATION'
  | 'CUSTOM';

export type CertificateStatusCode = 'DRAFT' | 'ISSUED' | 'REVOKED';

export type CertificateIssueKindCode = 'ORIGINAL' | 'DUPLICATE' | 'CORRECTION';

export type ArchiveLinkTypeCode =
  'STUDENT' | 'TEACHER' | 'STAFF' | 'CERTIFICATE';

export const CERTIFICATE_TYPES: readonly CertificateTypeCode[] = [
  'TRANSFER',
  'CHARACTER',
  'TESTIMONIAL',
  'PRIZE',
  'PARTICIPATION',
  'CUSTOM',
];
