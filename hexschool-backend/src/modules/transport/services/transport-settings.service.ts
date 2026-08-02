import { Injectable } from '@nestjs/common';
import { NotificationChannel } from '../../../common/constants';
import { SettingsService } from '../../school/services/settings.service';

export interface TransportConfig {
  enabled: boolean;
  /** M16 fee head the transport line bills under; '' when unconfigured. */
  feeHeadId: string;
  /** Fallback resolution when no id is set — the M20 posting-map trick. */
  feeHeadName: string;
  autoInvoice: boolean;
  prorateEnabled: boolean;
  capacityHardBlock: boolean;
  expiryAlertEnabled: boolean;
  expiryAlertDays: number;
  expiryAlertChannel: NotificationChannel;
  /** Days before the same lapsed document is flagged again. */
  expiryRepeatDays: number;
  notifyGuardianOnAssign: boolean;
  autoPostAccounting: boolean;
}

function clamp(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  // `null`, `undefined` and `''` all mean "no value", and `Number()` maps
  // the first and third to **0** rather than to NaN — so the finiteness
  // check below never sees them and they clamp to `min` instead of
  // falling back. For `transport.expiry_alert_days` that turns a missing
  // row into a ONE-DAY warning window on a bus's fitness certificate.
  // Found by M24's settings spec, which carries the same helper.
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
 * One typed read of the whole `transport.*` group — the M12/M13/M19/M20/
 * M21/M22/M23 settings-service precedent.
 *
 * Every malformed value falls back to the registry default instead of
 * throwing. A hand-edited `expiry_alert_days` of `"thirty"` must not be
 * able to take the nightly job — or worse, invoice generation — down; a
 * fleet alert that uses the default window and lets somebody notice is
 * strictly better than a batch that stops.
 */
@Injectable()
export class TransportSettingsService {
  constructor(private readonly settings: SettingsService) {}

  async load(schoolId: string): Promise<TransportConfig> {
    const read = <T>(key: string) => this.settings.getValue<T>(schoolId, key);

    const [
      enabled,
      feeHeadId,
      feeHeadName,
      autoInvoice,
      prorate,
      hardBlock,
      alertEnabled,
      alertDays,
      alertChannel,
      repeatDays,
      notifyGuardian,
      autoPost,
    ] = await Promise.all([
      read<boolean>('transport.enabled'),
      read<string>('transport.fee_head_id'),
      read<string>('transport.fee_head_name'),
      read<boolean>('transport.auto_invoice'),
      read<boolean>('transport.prorate_enabled'),
      read<boolean>('transport.capacity_hard_block'),
      read<boolean>('transport.expiry_alert_enabled'),
      read<number>('transport.expiry_alert_days'),
      read<string>('transport.expiry_alert_channel'),
      read<number>('transport.expiry_repeat_days'),
      read<boolean>('transport.notify_guardian_on_assign'),
      read<boolean>('transport.auto_post_accounting'),
    ]);

    return {
      enabled: enabled !== false,
      // A non-UUID here would make every generation run throw on the FK,
      // so a value that cannot be an id is treated as no value at all.
      feeHeadId: /^[0-9a-f-]{36}$/i.test(String(feeHeadId ?? ''))
        ? String(feeHeadId)
        : '',
      feeHeadName: text(feeHeadName, 'Transport'),
      autoInvoice: autoInvoice !== false,
      prorateEnabled: prorate !== false,
      // Roadmap §6: over capacity WARNS. A school that means it turns
      // this on deliberately.
      capacityHardBlock: hardBlock === true,
      expiryAlertEnabled: alertEnabled !== false,
      expiryAlertDays: clamp(alertDays, 1, 365, 30),
      // Only SMS opts out of the free default; anything else is IN_APP —
      // the M22/M23 channel rule. These alerts go to office users who are
      // already looking at the bell.
      expiryAlertChannel:
        String(alertChannel ?? '').toUpperCase() === 'SMS'
          ? NotificationChannel.SMS
          : NotificationChannel.IN_APP,
      expiryRepeatDays: clamp(repeatDays, 1, 365, 7),
      notifyGuardianOnAssign: notifyGuardian === true,
      autoPostAccounting: autoPost !== false,
    };
  }
}
