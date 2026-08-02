import { Injectable } from '@nestjs/common';
import { NotificationChannel } from '../../../common/constants';
import { SettingsService } from '../../school/services/settings.service';

export interface InventoryConfig {
  enabled: boolean;
  purchaseNoPattern: string;
  issueNoPattern: string;
  assetTagPattern: string;
  lowStockAlertEnabled: boolean;
  lowStockAlertChannel: NotificationChannel;
  /** 0 = Sunday. The job runs daily and decides for itself. */
  lowStockAlertWeekday: number;
  warrantyAlertDays: number;
  autoPostAccounting: boolean;
  /** Named in the settings so the report can print its own method. */
  valuationMethod: string;
  maxAssetUnitsPerReceipt: number;
}

function clamp(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  // `null`, `undefined` and `''` are "no value", and every one of them
  // passes through `Number()` as 0 or NaN. Only NaN is caught by the
  // finiteness check — so a NULL setting would be read as **zero** and
  // then clamped to `min`, which for `max_asset_units_per_receipt` means
  // a school whose row is missing can receive exactly one chair per
  // delivery. Rejected before the coercion, not after it.
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function text(value: unknown, fallback: string): string {
  const s = typeof value === 'string' ? value.trim() : '';
  return s.length > 0 ? s : fallback;
}

/**
 * One typed read of the whole `inventory.*` group — the M12/M13/M19/M20/
 * M21/M22/M23/M25 settings-service precedent.
 *
 * Every malformed value falls back to the registry default instead of
 * throwing. A hand-edited `warranty_alert_days` of `"thirty"` must not be
 * able to take the nightly job down, and a store alert that uses the
 * default window and lets somebody notice is strictly better than a sweep
 * that stops.
 *
 * The document-number patterns get the same treatment for a sharper
 * reason: a pattern with no `{SEQ}` token in it would render the same
 * string for every purchase, and the gap-free unique index would then
 * refuse the *second* delivery a school ever entered. `hasSequence`
 * repairs that rather than letting it reach the database.
 */
@Injectable()
export class InventorySettingsService {
  constructor(private readonly settings: SettingsService) {}

  async load(schoolId: string): Promise<InventoryConfig> {
    const read = <T>(key: string) => this.settings.getValue<T>(schoolId, key);

    const [
      enabled,
      purchasePattern,
      issuePattern,
      tagPattern,
      lowStockEnabled,
      lowStockChannel,
      lowStockWeekday,
      warrantyDays,
      autoPost,
      valuation,
      maxUnits,
    ] = await Promise.all([
      read<boolean>('inventory.enabled'),
      read<string>('inventory.purchase_no_pattern'),
      read<string>('inventory.issue_no_pattern'),
      read<string>('inventory.asset_tag_pattern'),
      read<boolean>('inventory.low_stock_alert_enabled'),
      read<string>('inventory.low_stock_alert_channel'),
      read<number>('inventory.low_stock_alert_weekday'),
      read<number>('inventory.warranty_alert_days'),
      read<boolean>('inventory.auto_post_accounting'),
      read<string>('inventory.valuation_method'),
      read<number>('inventory.max_asset_units_per_receipt'),
    ]);

    return {
      enabled: enabled !== false,
      purchaseNoPattern: pattern(purchasePattern, 'PO-{YY}-{SEQ5}'),
      issueNoPattern: pattern(issuePattern, 'ISS-{YY}-{SEQ5}'),
      assetTagPattern: pattern(tagPattern, 'AST-{SEQ5}'),
      lowStockAlertEnabled: lowStockEnabled !== false,
      // Only SMS opts out of the free default; anything else is IN_APP —
      // the M22/M23/M25 channel rule.
      lowStockAlertChannel:
        String(lowStockChannel ?? '').toUpperCase() === 'SMS'
          ? NotificationChannel.SMS
          : NotificationChannel.IN_APP,
      lowStockAlertWeekday: clamp(lowStockWeekday, 0, 6, 6),
      warrantyAlertDays: clamp(warrantyDays, 1, 3650, 30),
      autoPostAccounting: autoPost !== false,
      // The only method implemented. Stored as a setting so the report can
      // print what it did rather than leaving a reader to guess.
      valuationMethod: text(valuation, 'LAST_PRICE').toUpperCase(),
      maxAssetUnitsPerReceipt: clamp(maxUnits, 1, 1000, 200),
    };
  }
}

/**
 * A document-number pattern with no `{SEQ…}` token renders the same
 * string every time, and the second document a school ever creates would
 * hit the unique index. Repairing beats refusing here — the M21
 * `normalizeSlabs` reasoning — because the alternative is a purchase
 * screen throwing on a settings value somebody edited months ago.
 */
function pattern(value: unknown, fallback: string): string {
  const candidate = text(value, fallback);
  return /\{SEQ\d+\}/.test(candidate) ? candidate : fallback;
}
