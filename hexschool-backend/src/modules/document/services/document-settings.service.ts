import { Injectable } from '@nestjs/common';
import { NotificationChannel } from '../../../common/constants';
import { SettingsService } from '../../school/services/settings.service';
import {
  DEFAULT_TYPE_PREFIXES,
  mergePrefixes,
} from '../calc/certificate-number.util';
import { CERTIFICATE_TYPES, type CertificateTypeCode } from '../calc/types';

export interface DocumentConfig {
  enabled: boolean;
  certificateNoPattern: string;
  typePrefixes: Record<CertificateTypeCode, string>;
  clearanceRequiredTypes: CertificateTypeCode[];
  clearanceIncludeLibrary: boolean;
  clearanceIncludeHostel: boolean;
  tcSetsTransferred: boolean;
  notifyOnIssue: boolean;
  /** '' ⇒ fall back to `website.site_url`. */
  verifyUrlBase: string;
  conductDefault: string;
  duplicateWatermarkText: string;
  signatoryMaxKb: number;
  archiveMaxFileMb: number;
  archiveAllowedTypes: string[];
  bulkPrizeMax: number;
  noticeChannel: NotificationChannel;
}

/**
 * `null`, `undefined` and `''` all mean "no value", and `Number()` maps
 * the first and third to **0** rather than to NaN — so a finiteness check
 * alone never sees them and they clamp to `min` instead of falling back to
 * the registry default. M24 found this in its own helper, M25 carried the
 * identical defect, and M26 restated it; here a missing
 * `documents.archive_max_file_mb` would cap every upload at one megabyte
 * and a missing `documents.bulk_prize_max` would let the prize wizard
 * raise exactly one certificate.
 *
 * **A guard that tests for NaN has not tested for "no value".**
 */
function clamp(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function text(value: unknown, fallback: string): string {
  const s = typeof value === 'string' ? value.trim() : '';
  return s.length > 0 ? s : fallback;
}

/** Only the values that name a real certificate type survive. */
function asTypeList(value: unknown, fallback: CertificateTypeCode[]) {
  if (!Array.isArray(value)) return fallback;
  const known = new Set<string>(CERTIFICATE_TYPES);
  const parsed = value.filter(
    (v): v is CertificateTypeCode => typeof v === 'string' && known.has(v),
  );
  // An empty list is a legitimate configuration — a school that gates
  // nothing — but a list that was *entirely* garbage is a typo, and
  // silently gating nothing is the failure mode that lets a transfer
  // certificate out over unpaid fees with no warning anywhere.
  return value.length > 0 && parsed.length === 0 ? fallback : parsed;
}

function asStringList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const parsed = value.filter(
    (v): v is string => typeof v === 'string' && v.trim().length > 0,
  );
  return parsed.length > 0 ? parsed.map((v) => v.trim()) : fallback;
}

const DEFAULT_ARCHIVE_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

/**
 * One typed read of the whole `documents.*` group — the M12/M13/M19/M20/
 * M21/M22/M23/M24/M25/M26 settings-service precedent.
 *
 * Every malformed value falls back to the registry default rather than
 * throwing. A hand-edited `certificate_type_prefixes` of `"TC"` must not
 * be able to stop the office issuing a transfer certificate; a number
 * generated with the default prefix and noticed by somebody is strictly
 * better than a counter that will not open.
 */
@Injectable()
export class DocumentSettingsService {
  constructor(private readonly settings: SettingsService) {}

  async load(schoolId: string): Promise<DocumentConfig> {
    const read = <T>(key: string) => this.settings.getValue<T>(schoolId, key);

    const [
      enabled,
      pattern,
      prefixes,
      requiredTypes,
      includeLibrary,
      includeHostel,
      tcTransfers,
      notify,
      verifyBase,
      siteUrl,
      conduct,
      watermark,
      signatoryKb,
      archiveMb,
      archiveTypes,
      prizeMax,
    ] = await Promise.all([
      read<boolean>('documents.enabled'),
      read<string>('documents.certificate_no_pattern'),
      read<unknown>('documents.certificate_type_prefixes'),
      read<unknown>('documents.clearance_required_types'),
      read<boolean>('documents.clearance_include_library'),
      read<boolean>('documents.clearance_include_hostel'),
      read<boolean>('documents.tc_sets_transferred'),
      read<boolean>('documents.notify_on_issue'),
      read<string>('documents.verify_url_base'),
      // The QR's URL falls back to the site the public verification page
      // actually lives on, rather than to a second value somebody has to
      // remember to set — one configured URL, two consumers.
      read<string>('website.site_url'),
      read<string>('documents.conduct_default'),
      read<string>('documents.duplicate_watermark_text'),
      read<number>('documents.signatory_max_kb'),
      read<number>('documents.archive_max_file_mb'),
      read<unknown>('documents.archive_allowed_types'),
      read<number>('documents.bulk_prize_max'),
    ]);

    return {
      enabled: enabled !== false,
      certificateNoPattern: text(pattern, '{TYPE}-{YY}-{SEQ4}'),
      typePrefixes: mergePrefixes(prefixes) ?? DEFAULT_TYPE_PREFIXES,
      clearanceRequiredTypes: asTypeList(requiredTypes, ['TRANSFER']),
      clearanceIncludeLibrary: includeLibrary !== false,
      clearanceIncludeHostel: includeHostel !== false,
      tcSetsTransferred: tcTransfers !== false,
      notifyOnIssue: notify !== false,
      verifyUrlBase: text(verifyBase, text(siteUrl, '')),
      conductDefault: text(conduct, 'Good'),
      duplicateWatermarkText: text(watermark, 'DUPLICATE').slice(0, 30),
      signatoryMaxKb: clamp(signatoryKb, 10, 5_000, 500),
      archiveMaxFileMb: clamp(archiveMb, 1, 200, 20),
      archiveAllowedTypes: asStringList(archiveTypes, DEFAULT_ARCHIVE_TYPES),
      bulkPrizeMax: clamp(prizeMax, 1, 2_000, 200),
      // Certificates are rare and important, so unlike homework this one
      // earns an SMS — but the bell still carries it first, because a
      // guardian with no handset is the M22 case and a portal user is
      // already looking at the inbox.
      noticeChannel: NotificationChannel.SMS,
    };
  }
}
