import { NotificationChannel } from '../../../common/constants';
import { InventorySettingsService } from './inventory-settings.service';

/**
 * One typed read of the `inventory.*` group, and the reason it exists:
 * **a hand-edited settings value must not be able to take the store
 * down**. Every case here is a value somebody could plausibly type into
 * the settings screen months before the code that reads it runs.
 */
describe('InventorySettingsService', () => {
  const SCHOOL = 'school-1';

  const build = (overrides: Record<string, unknown> = {}) => {
    const defaults: Record<string, unknown> = {
      'inventory.enabled': true,
      'inventory.purchase_no_pattern': 'PO-{YY}-{SEQ5}',
      'inventory.issue_no_pattern': 'ISS-{YY}-{SEQ5}',
      'inventory.asset_tag_pattern': 'AST-{SEQ5}',
      'inventory.low_stock_alert_enabled': true,
      'inventory.low_stock_alert_channel': 'IN_APP',
      'inventory.low_stock_alert_weekday': 6,
      'inventory.warranty_alert_days': 30,
      'inventory.auto_post_accounting': true,
      'inventory.valuation_method': 'LAST_PRICE',
      'inventory.max_asset_units_per_receipt': 200,
      ...overrides,
    };
    const settings = {
      getValue: jest.fn((_school: string, key: string) =>
        Promise.resolve(defaults[key]),
      ),
    };
    return new InventorySettingsService(settings as never);
  };

  it('reads the group into one typed object', async () => {
    const cfg = await build().load(SCHOOL);
    expect(cfg).toMatchObject({
      enabled: true,
      purchaseNoPattern: 'PO-{YY}-{SEQ5}',
      issueNoPattern: 'ISS-{YY}-{SEQ5}',
      assetTagPattern: 'AST-{SEQ5}',
      lowStockAlertEnabled: true,
      lowStockAlertChannel: NotificationChannel.IN_APP,
      lowStockAlertWeekday: 6,
      warrantyAlertDays: 30,
      autoPostAccounting: true,
      valuationMethod: 'LAST_PRICE',
      maxAssetUnitsPerReceipt: 200,
    });
  });

  describe('document-number patterns', () => {
    it('**repairs a pattern with no sequence token**', async () => {
      // Without a {SEQ} token every purchase renders the same string, and
      // the gap-free unique index refuses the SECOND delivery a school
      // ever enters. Repairing beats refusing (the M21 `normalizeSlabs`
      // reasoning) — the alternative is a purchase screen throwing on a
      // value somebody edited months ago.
      const cfg = await build({
        'inventory.purchase_no_pattern': 'PO-{YY}',
        'inventory.issue_no_pattern': 'GATE-PASS',
        'inventory.asset_tag_pattern': '',
      }).load(SCHOOL);

      expect(cfg.purchaseNoPattern).toBe('PO-{YY}-{SEQ5}');
      expect(cfg.issueNoPattern).toBe('ISS-{YY}-{SEQ5}');
      expect(cfg.assetTagPattern).toBe('AST-{SEQ5}');
    });

    it('keeps a school’s own pattern when it carries a sequence', async () => {
      const cfg = await build({
        'inventory.purchase_no_pattern': '{SCHOOL_CODE}/PUR/{YYYY}/{SEQ4}',
      }).load(SCHOOL);
      expect(cfg.purchaseNoPattern).toBe('{SCHOOL_CODE}/PUR/{YYYY}/{SEQ4}');
    });

    it('falls back on a non-string', async () => {
      const cfg = await build({
        'inventory.asset_tag_pattern': 12345,
      }).load(SCHOOL);
      expect(cfg.assetTagPattern).toBe('AST-{SEQ5}');
    });
  });

  describe('numbers', () => {
    it('falls back on a value that is not a number at all', async () => {
      const cfg = await build({
        'inventory.warranty_alert_days': 'thirty',
        'inventory.max_asset_units_per_receipt': null,
      }).load(SCHOOL);
      expect(cfg.warrantyAlertDays).toBe(30);
      expect(cfg.maxAssetUnitsPerReceipt).toBe(200);
    });

    it('clamps rather than refusing an out-of-range value', async () => {
      const cfg = await build({
        'inventory.warranty_alert_days': 99999,
        'inventory.low_stock_alert_weekday': 99,
        'inventory.max_asset_units_per_receipt': 0,
      }).load(SCHOOL);
      expect(cfg.warrantyAlertDays).toBe(3650);
      expect(cfg.lowStockAlertWeekday).toBe(6);
      expect(cfg.maxAssetUnitsPerReceipt).toBe(1);
    });

    it('accepts Sunday as weekday 0 rather than treating it as unset', async () => {
      const cfg = await build({
        'inventory.low_stock_alert_weekday': 0,
      }).load(SCHOOL);
      expect(cfg.lowStockAlertWeekday).toBe(0);
    });
  });

  describe('booleans default ON, so a missing row does not switch a feature off', () => {
    it('treats undefined as enabled', async () => {
      const cfg = await build({
        'inventory.enabled': undefined,
        'inventory.low_stock_alert_enabled': undefined,
        'inventory.auto_post_accounting': undefined,
      }).load(SCHOOL);
      expect(cfg.enabled).toBe(true);
      expect(cfg.lowStockAlertEnabled).toBe(true);
      expect(cfg.autoPostAccounting).toBe(true);
    });

    it('honours an explicit false', async () => {
      const cfg = await build({
        'inventory.enabled': false,
        'inventory.auto_post_accounting': false,
      }).load(SCHOOL);
      expect(cfg.enabled).toBe(false);
      expect(cfg.autoPostAccounting).toBe(false);
    });
  });

  describe('alert channel', () => {
    it('only SMS opts out of the free default (the M22/M23/M25 rule)', async () => {
      expect(
        (
          await build({ 'inventory.low_stock_alert_channel': 'SMS' }).load(
            SCHOOL,
          )
        ).lowStockAlertChannel,
      ).toBe(NotificationChannel.SMS);
      expect(
        (
          await build({ 'inventory.low_stock_alert_channel': 'sms' }).load(
            SCHOOL,
          )
        ).lowStockAlertChannel,
      ).toBe(NotificationChannel.SMS);
    });

    it('anything else is IN_APP', async () => {
      for (const value of ['EMAIL', 'nonsense', '', null, 42]) {
        const cfg = await build({
          'inventory.low_stock_alert_channel': value,
        }).load(SCHOOL);
        expect(cfg.lowStockAlertChannel).toBe(NotificationChannel.IN_APP);
      }
    });
  });

  it('upper-cases the valuation method, so the report prints one spelling', async () => {
    const cfg = await build({
      'inventory.valuation_method': 'last_price',
    }).load(SCHOOL);
    expect(cfg.valuationMethod).toBe('LAST_PRICE');
  });
});
