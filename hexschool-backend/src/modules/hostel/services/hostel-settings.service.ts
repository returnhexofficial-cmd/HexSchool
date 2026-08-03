import { Injectable } from '@nestjs/common';
import { NotificationChannel } from '../../../common/constants';
import { SettingsService } from '../../school/services/settings.service';

export interface HostelConfig {
  enabled: boolean;
  /** M16 fee head the seat rent bills under; '' when unconfigured. */
  feeHeadId: string;
  feeHeadName: string;
  /** M16 fee head the mess charge bills under; '' when unconfigured. */
  messFeeHeadId: string;
  messFeeHeadName: string;
  autoInvoice: boolean;
  prorateEnabled: boolean;
  defaultSecurityDeposit: number;
  mealOffMinDays: number;
  /** 0 = derive the day rate from the plan's monthly charge. */
  messDayRate: number;
  vacateBlockDues: boolean;
  notifyGuardianOnAllocation: boolean;
  autoPostAccounting: boolean;
  bedNoPrefix: string;
  maxBedsPerRoom: number;
  /** Where the meal-off decision goes. */
  noticeChannel: NotificationChannel;
}

/**
 * `null`, `undefined` and `''` all mean "no value", and `Number()` maps
 * the first and third to **0** rather than to NaN — so a finiteness check
 * alone never sees them and they clamp to `min` instead of falling back
 * to the registry default. M24's settings spec found this in its own
 * helper and M25 carried the identical defect; here it would turn a
 * missing `hostel.meal_off_min_days` row into a minimum of one day and a
 * missing `hostel.max_beds_per_room` into one bed per room.
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

/** The same rule for money, which keeps its decimals. */
function clampMoney(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n * 100) / 100));
}

function text(value: unknown, fallback: string): string {
  const s = typeof value === 'string' ? value.trim() : '';
  return s.length > 0 ? s : fallback;
}

/**
 * One typed read of the whole `hostel.*` group — the M12/M13/M19/M20/M21/
 * M22/M23/M24/M25 settings-service precedent.
 *
 * Every malformed value falls back to the registry default instead of
 * throwing. A hand-edited `meal_off_min_days` of `"three"` must not be
 * able to take invoice generation down; a hostel line computed with the
 * default and noticed by somebody is strictly better than a monthly batch
 * that stops.
 */
@Injectable()
export class HostelSettingsService {
  constructor(private readonly settings: SettingsService) {}

  async load(schoolId: string): Promise<HostelConfig> {
    const read = <T>(key: string) => this.settings.getValue<T>(schoolId, key);

    const [
      enabled,
      feeHeadId,
      feeHeadName,
      messFeeHeadId,
      messFeeHeadName,
      autoInvoice,
      prorate,
      deposit,
      minDays,
      dayRate,
      blockDues,
      notifyGuardian,
      autoPost,
      bedPrefix,
      maxBeds,
    ] = await Promise.all([
      read<boolean>('hostel.enabled'),
      read<string>('hostel.fee_head_id'),
      read<string>('hostel.fee_head_name'),
      read<string>('hostel.mess_fee_head_id'),
      read<string>('hostel.mess_fee_head_name'),
      read<boolean>('hostel.auto_invoice'),
      read<boolean>('hostel.prorate_enabled'),
      read<number>('hostel.default_security_deposit'),
      read<number>('hostel.meal_off_min_days'),
      read<number>('hostel.mess_day_rate'),
      read<boolean>('hostel.vacate_block_dues'),
      read<boolean>('hostel.notify_guardian_on_allocation'),
      read<boolean>('hostel.auto_post_accounting'),
      read<string>('hostel.bed_no_prefix'),
      read<number>('hostel.max_beds_per_room'),
    ]);

    return {
      enabled: enabled !== false,
      // A non-UUID here would make every generation run throw on the FK,
      // so a value that cannot be an id is treated as no value at all
      // (the M25 rule).
      feeHeadId: asUuid(feeHeadId),
      feeHeadName: text(feeHeadName, 'Hostel'),
      messFeeHeadId: asUuid(messFeeHeadId),
      messFeeHeadName: text(messFeeHeadName, 'Mess'),
      autoInvoice: autoInvoice !== false,
      prorateEnabled: prorate !== false,
      defaultSecurityDeposit: clampMoney(deposit, 0, 1_000_000, 0),
      mealOffMinDays: clamp(minDays, 1, 90, 3),
      messDayRate: clampMoney(dayRate, 0, 100_000, 0),
      // Roadmap §6's dues check WARNS by default — a school that means to
      // hold a bed over an unpaid bill turns it on deliberately (the M23
      // `library.clearance_block_exit` reasoning).
      vacateBlockDues: blockDues === true,
      notifyGuardianOnAllocation: notifyGuardian === true,
      autoPostAccounting: autoPost !== false,
      bedNoPrefix: text(bedPrefix, 'B').slice(0, 10),
      maxBedsPerRoom: clamp(maxBeds, 1, 50, 20),
      // Meal-off decisions and allocations go to the bell. A school with
      // two hundred boarders going home for Eid would otherwise spend a
      // term's SMS credit in a week (the M22/M23/M24/M25 channel rule).
      noticeChannel: NotificationChannel.IN_APP,
    };
  }
}

function asUuid(value: unknown): string {
  // A stored setting can be any JSON value; only a string can be an id,
  // and anything else is treated as no value at all rather than
  // stringified into `[object Object]` and then failing a FK at billing
  // time (the M25 rule for `transport.fee_head_id`).
  const s = typeof value === 'string' ? value : '';
  return /^[0-9a-f-]{36}$/i.test(s) ? s : '';
}
