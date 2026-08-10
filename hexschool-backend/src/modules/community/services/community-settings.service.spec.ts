import { CommunitySettingsService } from './community-settings.service';
import type { SettingsService } from '../../school/services/settings.service';

/** A settings store that answers exactly what the test puts in it. */
function settingsWith(values: Record<string, unknown>) {
  return {
    getValue: jest.fn((_schoolId: string, key: string) =>
      Promise.resolve(values[key]),
    ),
  } as unknown as SettingsService;
}

describe('CommunitySettingsService', () => {
  it('returns the registry defaults for a school that has configured nothing', async () => {
    const service = new CommunitySettingsService(settingsWith({}));
    const cfg = await service.load('school-1');

    expect(cfg.enabled).toBe(true);
    expect(cfg.ticketNoPattern).toBe('CMP-{YY}-{SEQ5}');
    expect(cfg.ticketReopenDays).toBe(7);
    // Roadmap §4 names 72 hours; MEDIUM is where that lives.
    expect(cfg.ticketSlaHours.MEDIUM).toBe(72);
    expect(cfg.ticketSensitiveCategories).toEqual(['TEACHER']);
    expect(cfg.visitorAutoCheckoutMinutes).toBe(21 * 60);
    expect(cfg.visitorMaxPassDays).toBe(7);
    expect(cfg.alumniMinBatchYear).toBe(1950);
    expect(cfg.donationReceiptPattern).toBe('DON-{YY}-{SEQ5}');
  });

  /**
   * **The M24 lesson, restated for the fourth time.** `Number(null)` is 0
   * and `Number.isFinite(0)` is true, so a guard that only tests for NaN
   * reads "no value" as zero and clamps to the MINIMUM. Here that would
   * shut the reopen window the instant a ticket was closed and refuse
   * every multi-day visitor pass.
   */
  describe('a missing value falls back to the default, never to the minimum', () => {
    for (const empty of [null, undefined, '']) {
      it(`treats ${JSON.stringify(empty)} as "not configured"`, async () => {
        const service = new CommunitySettingsService(
          settingsWith({
            'community.ticket_reopen_days': empty,
            'community.visitor_max_pass_days': empty,
            'community.alumni_min_batch_year': empty,
            'community.ticket_public_hourly_limit': empty,
          }),
        );
        const cfg = await service.load('school-1');

        expect(cfg.ticketReopenDays).toBe(7);
        expect(cfg.visitorMaxPassDays).toBe(7);
        expect(cfg.alumniMinBatchYear).toBe(1950);
        expect(cfg.ticketPublicHourlyLimit).toBe(5);
      });
    }

    it('still honours a genuine zero where zero is meaningful', async () => {
      // A school that wants no reopen window at all is making a real
      // choice, and 0 is inside the clamp range for this key.
      const service = new CommunitySettingsService(
        settingsWith({ 'community.ticket_reopen_days': 0 }),
      );
      expect((await service.load('school-1')).ticketReopenDays).toBe(0);
    });
  });

  describe('the SLA map', () => {
    it('takes a school’s configured hours per priority', async () => {
      const service = new CommunitySettingsService(
        settingsWith({
          'community.ticket_sla_hours': { URGENT: 4, MEDIUM: 36 },
        }),
      );
      const cfg = await service.load('school-1');

      expect(cfg.ticketSlaHours.URGENT).toBe(4);
      expect(cfg.ticketSlaHours.MEDIUM).toBe(36);
      // Untouched priorities keep their defaults rather than vanishing.
      expect(cfg.ticketSlaHours.LOW).toBe(120);
      expect(cfg.ticketSlaHours.HIGH).toBe(48);
    });

    it('ignores a zero or negative SLA — it would breach every ticket at birth', async () => {
      const service = new CommunitySettingsService(
        settingsWith({
          'community.ticket_sla_hours': { URGENT: 0, HIGH: -5, LOW: 'soon' },
        }),
      );
      const cfg = await service.load('school-1');

      expect(cfg.ticketSlaHours.URGENT).toBe(24);
      expect(cfg.ticketSlaHours.HIGH).toBe(48);
      expect(cfg.ticketSlaHours.LOW).toBe(120);
    });

    it('falls back wholesale when the value is not an object at all', async () => {
      const service = new CommunitySettingsService(
        settingsWith({ 'community.ticket_sla_hours': 'seventy-two' }),
      );
      expect((await service.load('school-1')).ticketSlaHours.MEDIUM).toBe(72);
    });
  });

  describe('the sensitive-category list', () => {
    it('takes a widened list', async () => {
      const service = new CommunitySettingsService(
        settingsWith({
          'community.ticket_sensitive_categories': ['TEACHER', 'FEES'],
        }),
      );
      expect(
        (await service.load('school-1')).ticketSensitiveCategories,
      ).toEqual(['TEACHER', 'FEES']);
    });

    it('accepts an empty list — a school that restricts nothing', async () => {
      const service = new CommunitySettingsService(
        settingsWith({ 'community.ticket_sensitive_categories': [] }),
      );
      expect(
        (await service.load('school-1')).ticketSensitiveCategories,
      ).toEqual([]);
    });

    it('falls back when the list is ENTIRELY garbage — silently restricting nothing is the dangerous failure', async () => {
      const service = new CommunitySettingsService(
        settingsWith({
          'community.ticket_sensitive_categories': ['TEECHER', 'staff'],
        }),
      );
      expect(
        (await service.load('school-1')).ticketSensitiveCategories,
      ).toEqual(['TEACHER']);
    });

    it('keeps the recognizable half of a partly-wrong list', async () => {
      const service = new CommunitySettingsService(
        settingsWith({
          'community.ticket_sensitive_categories': ['TEACHER', 'nonsense'],
        }),
      );
      expect(
        (await service.load('school-1')).ticketSensitiveCategories,
      ).toEqual(['TEACHER']);
    });
  });

  describe('the day-end sweep time', () => {
    it('parses HH:mm into minutes past midnight', async () => {
      const service = new CommunitySettingsService(
        settingsWith({ 'community.visitor_auto_checkout_time': '18:30' }),
      );
      expect((await service.load('school-1')).visitorAutoCheckoutMinutes).toBe(
        18 * 60 + 30,
      );
    });

    it('falls back on a malformed time rather than closing the register at midnight', async () => {
      for (const bad of ['half past six', '25:00', '18:75', '', null]) {
        const service = new CommunitySettingsService(
          settingsWith({ 'community.visitor_auto_checkout_time': bad }),
        );
        expect(
          (await service.load('school-1')).visitorAutoCheckoutMinutes,
        ).toBe(21 * 60);
      }
    });
  });

  describe('the switches that default OFF', () => {
    it('never auto-approves an alumni claim unless a school says so explicitly', async () => {
      const off = new CommunitySettingsService(settingsWith({}));
      expect((await off.load('school-1')).alumniAutoApprove).toBe(false);

      // Not even a truthy string turns it on — the approval queue exists
      // for roadmap §8's identity conflict, and auto-approving into one is
      // the failure it is there to prevent.
      const fuzzy = new CommunitySettingsService(
        settingsWith({ 'community.alumni_auto_approve': 'yes' }),
      );
      expect((await fuzzy.load('school-1')).alumniAutoApprove).toBe(false);

      const on = new CommunitySettingsService(
        settingsWith({ 'community.alumni_auto_approve': true }),
      );
      expect((await on.load('school-1')).alumniAutoApprove).toBe(true);
    });

    it('does not require a gate pass or a photo unless configured', async () => {
      const cfg = await new CommunitySettingsService(settingsWith({})).load(
        'school-1',
      );
      expect(cfg.visitorGatePassRequired).toBe(false);
      expect(cfg.visitorPhotoRequired).toBe(false);
    });
  });

  it('honours the switches that default ON being turned off', async () => {
    const service = new CommunitySettingsService(
      settingsWith({
        'community.ticket_allow_anonymous': false,
        'community.donation_post_to_accounts': false,
        'community.alumni_directory_public': false,
      }),
    );
    const cfg = await service.load('school-1');

    expect(cfg.ticketAllowAnonymous).toBe(false);
    expect(cfg.donationPostToAccounts).toBe(false);
    expect(cfg.alumniDirectoryPublic).toBe(false);
  });
});
