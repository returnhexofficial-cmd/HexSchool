import { NotificationChannel } from '../../../common/constants';
import { DocumentSettingsService } from './document-settings.service';

/**
 * One typed read of the `documents.*` group, and the reason it exists:
 * **a hand-edited settings value must not be able to stop the office
 * issuing a certificate**. Every case here is a value somebody could
 * plausibly type into the settings screen months before the code that
 * reads it runs.
 */
describe('DocumentSettingsService', () => {
  const SCHOOL = 'school-1';

  const build = (overrides: Record<string, unknown> = {}) => {
    const defaults: Record<string, unknown> = {
      'documents.enabled': true,
      'documents.certificate_no_pattern': '{TYPE}-{YY}-{SEQ4}',
      'documents.certificate_type_prefixes': {
        TRANSFER: 'TC',
        CHARACTER: 'CC',
        TESTIMONIAL: 'TS',
        PRIZE: 'PR',
        PARTICIPATION: 'PA',
        CUSTOM: 'CE',
      },
      'documents.clearance_required_types': ['TRANSFER'],
      'documents.clearance_include_library': true,
      'documents.clearance_include_hostel': true,
      'documents.tc_sets_transferred': true,
      'documents.notify_on_issue': true,
      'documents.verify_url_base': '',
      'website.site_url': 'https://school.edu.bd',
      'documents.conduct_default': 'Good',
      'documents.duplicate_watermark_text': 'DUPLICATE',
      'documents.signatory_max_kb': 500,
      'documents.archive_max_file_mb': 20,
      'documents.archive_allowed_types': ['application/pdf'],
      'documents.bulk_prize_max': 200,
      ...overrides,
    };
    const settings = {
      getValue: jest.fn((_school: string, key: string) =>
        Promise.resolve(defaults[key]),
      ),
    };
    return new DocumentSettingsService(settings as never);
  };

  it('reads the group into one typed object', async () => {
    const cfg = await build().load(SCHOOL);
    expect(cfg).toMatchObject({
      enabled: true,
      certificateNoPattern: '{TYPE}-{YY}-{SEQ4}',
      clearanceRequiredTypes: ['TRANSFER'],
      clearanceIncludeLibrary: true,
      clearanceIncludeHostel: true,
      tcSetsTransferred: true,
      notifyOnIssue: true,
      conductDefault: 'Good',
      duplicateWatermarkText: 'DUPLICATE',
      signatoryMaxKb: 500,
      archiveMaxFileMb: 20,
      bulkPrizeMax: 200,
      noticeChannel: NotificationChannel.SMS,
    });
    expect(cfg.typePrefixes.TRANSFER).toBe('TC');
  });

  describe('the NULL-is-zero trap (M24/M25/M26, restated)', () => {
    /**
     * `Number(null)` is `0` and `Number.isFinite(0)` is `true`, so a guard
     * that only tests for NaN never sees "no value" and clamps to the
     * MINIMUM instead of falling back to the default.
     */
    it('falls back to the default for a missing numeric row', async () => {
      const cfg = await build({
        'documents.archive_max_file_mb': null,
        'documents.bulk_prize_max': null,
        'documents.signatory_max_kb': null,
      }).load(SCHOOL);

      // Not 1 MB, not 1 certificate, not 10 KB.
      expect(cfg.archiveMaxFileMb).toBe(20);
      expect(cfg.bulkPrizeMax).toBe(200);
      expect(cfg.signatoryMaxKb).toBe(500);
    });

    it('does the same for an empty string and for undefined', async () => {
      const cfg = await build({
        'documents.archive_max_file_mb': '',
        'documents.bulk_prize_max': undefined,
      }).load(SCHOOL);
      expect(cfg.archiveMaxFileMb).toBe(20);
      expect(cfg.bulkPrizeMax).toBe(200);
    });

    it('falls back for a value that is not a number at all', async () => {
      const cfg = await build({ 'documents.archive_max_file_mb': 'twenty' }).load(
        SCHOOL,
      );
      expect(cfg.archiveMaxFileMb).toBe(20);
    });

    it('still clamps a real out-of-range value', async () => {
      expect(
        (await build({ 'documents.archive_max_file_mb': 9_999 }).load(SCHOOL))
          .archiveMaxFileMb,
      ).toBe(200);
      expect(
        (await build({ 'documents.archive_max_file_mb': -5 }).load(SCHOOL))
          .archiveMaxFileMb,
      ).toBe(1);
    });
  });

  describe('the certificate number pattern', () => {
    it('falls back when the pattern row is blank', async () => {
      const cfg = await build({
        'documents.certificate_no_pattern': '   ',
      }).load(SCHOOL);
      expect(cfg.certificateNoPattern).toBe('{TYPE}-{YY}-{SEQ4}');
    });

    it('keeps the defaults when the prefix map is malformed', async () => {
      const cfg = await build({
        'documents.certificate_type_prefixes': 'TC',
      }).load(SCHOOL);
      expect(cfg.typePrefixes.TRANSFER).toBe('TC');
      expect(cfg.typePrefixes.CHARACTER).toBe('CC');
    });

    it('honours a per-type override and ignores an unknown key', async () => {
      const cfg = await build({
        'documents.certificate_type_prefixes': { TRANSFER: 'tcx', NOPE: 'ZZ' },
      }).load(SCHOOL);
      expect(cfg.typePrefixes.TRANSFER).toBe('TCX');
      expect(cfg.typePrefixes.PRIZE).toBe('PR');
    });
  });

  describe('the clearance gate', () => {
    it('gates the TC by default and nothing else', async () => {
      const cfg = await build().load(SCHOOL);
      expect(cfg.clearanceRequiredTypes).toEqual(['TRANSFER']);
    });

    it('accepts a widened list', async () => {
      const cfg = await build({
        'documents.clearance_required_types': ['TRANSFER', 'TESTIMONIAL'],
      }).load(SCHOOL);
      expect(cfg.clearanceRequiredTypes).toEqual(['TRANSFER', 'TESTIMONIAL']);
    });

    /**
     * An EMPTY list is a legitimate configuration — a school that gates
     * nothing. A list that was entirely garbage is a typo, and silently
     * gating nothing is exactly the failure that lets a transfer
     * certificate out over unpaid fees with no warning anywhere.
     */
    it('honours a deliberately empty list', async () => {
      const cfg = await build({
        'documents.clearance_required_types': [],
      }).load(SCHOOL);
      expect(cfg.clearanceRequiredTypes).toEqual([]);
    });

    it('falls back when every entry is nonsense', async () => {
      const cfg = await build({
        'documents.clearance_required_types': ['DIPLOMA', 42],
      }).load(SCHOOL);
      expect(cfg.clearanceRequiredTypes).toEqual(['TRANSFER']);
    });

    it('drops only the unrecognised entries from a partly-valid list', async () => {
      const cfg = await build({
        'documents.clearance_required_types': ['TRANSFER', 'DIPLOMA'],
      }).load(SCHOOL);
      expect(cfg.clearanceRequiredTypes).toEqual(['TRANSFER']);
    });

    it('falls back when the value is not a list at all', async () => {
      const cfg = await build({
        'documents.clearance_required_types': 'TRANSFER',
      }).load(SCHOOL);
      expect(cfg.clearanceRequiredTypes).toEqual(['TRANSFER']);
    });
  });

  describe('the verification URL', () => {
    it('falls back to the website URL when no base is set', async () => {
      const cfg = await build().load(SCHOOL);
      expect(cfg.verifyUrlBase).toBe('https://school.edu.bd');
    });

    it('prefers an explicit base', async () => {
      const cfg = await build({
        'documents.verify_url_base': 'https://verify.school.edu.bd',
      }).load(SCHOOL);
      expect(cfg.verifyUrlBase).toBe('https://verify.school.edu.bd');
    });

    it('is empty when neither is configured — never a localhost QR', async () => {
      const cfg = await build({
        'documents.verify_url_base': '',
        'website.site_url': '',
      }).load(SCHOOL);
      expect(cfg.verifyUrlBase).toBe('');
    });
  });

  describe('booleans default the way the module intends', () => {
    it('treats a missing row as ON for the opt-out flags', async () => {
      const cfg = await build({
        'documents.enabled': undefined,
        'documents.tc_sets_transferred': undefined,
        'documents.clearance_include_library': undefined,
        'documents.clearance_include_hostel': undefined,
      }).load(SCHOOL);
      expect(cfg.enabled).toBe(true);
      expect(cfg.tcSetsTransferred).toBe(true);
      expect(cfg.clearanceIncludeLibrary).toBe(true);
      expect(cfg.clearanceIncludeHostel).toBe(true);
    });

    it('honours an explicit false', async () => {
      const cfg = await build({
        'documents.clearance_include_hostel': false,
      }).load(SCHOOL);
      expect(cfg.clearanceIncludeHostel).toBe(false);
    });
  });

  it('falls back to the accepted-type list when the config is empty', async () => {
    const cfg = await build({ 'documents.archive_allowed_types': [] }).load(
      SCHOOL,
    );
    expect(cfg.archiveAllowedTypes).toContain('application/pdf');
  });

  it('caps the watermark at what fits across a page', async () => {
    const cfg = await build({
      'documents.duplicate_watermark_text': 'D'.repeat(80),
    }).load(SCHOOL);
    expect(cfg.duplicateWatermarkText).toHaveLength(30);
  });
});
