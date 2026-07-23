import { Injectable } from '@nestjs/common';
import { SettingsService } from '../../school/services/settings.service';
import { minutesOfDayOr } from '../../../common/utils/clock.util';
import { SmsCredentials } from '../adapters/sms.adapter';
import { EmailCredentials } from '../adapters/email.adapter';

export interface CommunicationConfig {
  quietHoursEnabled: boolean;
  /** Quiet-window start/end in minutes-of-day (Asia/Dhaka). */
  quietStartMin: number;
  quietEndMin: number;
  smsRatePerPart: number;
  smsUnicodeRatePerPart: number;
  dedupeWindowMinutes: number;
  bulkLargeThreshold: number;
  bulkChunkSize: number;
  lowCreditThreshold: number;
  defaultLanguage: 'EN' | 'BN';
  birthdayWishEnabled: boolean;
  birthdayWishMin: number;
  dlrWebhookSecret: string;
  sms: SmsCredentials;
  email: EmailCredentials;
}

/**
 * One typed read of every `communication.*`, `sms.*` and `email.*` knob
 * (the M12–M16 settings-service pattern), so no communication service
 * reads `SettingsService` directly and they all inherit the M04 Redis
 * cache. Malformed HH:mm falls back to the registry default rather than
 * 500-ing a send.
 */
@Injectable()
export class CommunicationSettingsService {
  constructor(private readonly settings: SettingsService) {}

  async load(schoolId: string): Promise<CommunicationConfig> {
    const get = <T>(key: string) => this.settings.getValue<T>(schoolId, key);
    const [
      quietEnabled,
      quietStart,
      quietEnd,
      smsRate,
      smsUnicodeRate,
      dedupeWindow,
      bulkThreshold,
      chunkSize,
      lowCredit,
      defaultLang,
      birthdayEnabled,
      birthdayTime,
      dlrSecret,
      smsEnabled,
      smsProvider,
      smsApiUrl,
      smsApiKey,
      smsSenderId,
      smsMasking,
      emailEnabled,
      emailHost,
      emailPort,
      emailUser,
      emailPass,
      emailFromName,
      emailFromEmail,
    ] = await Promise.all([
      get<boolean>('communication.quiet_hours_enabled'),
      get<string>('communication.quiet_hours_start'),
      get<string>('communication.quiet_hours_end'),
      get<number>('communication.sms_rate_per_part'),
      get<number>('communication.sms_unicode_rate_per_part'),
      get<number>('communication.dedupe_window_minutes'),
      get<number>('communication.bulk_large_threshold'),
      get<number>('communication.bulk_chunk_size'),
      get<number>('communication.low_credit_threshold'),
      get<string>('communication.default_language'),
      get<boolean>('communication.birthday_wish_enabled'),
      get<string>('communication.birthday_wish_time'),
      get<string>('communication.dlr_webhook_secret'),
      get<boolean>('sms.enabled'),
      get<string>('sms.provider'),
      get<string>('sms.api_url'),
      get<string>('sms.api_key'),
      get<string>('sms.sender_id'),
      get<boolean>('communication.sms_masking'),
      get<boolean>('email.enabled'),
      get<string>('email.smtp_host'),
      get<number>('email.smtp_port'),
      get<string>('email.smtp_user'),
      get<string>('email.smtp_pass'),
      get<string>('email.from_name'),
      get<string>('email.from_email'),
    ]);

    return {
      quietHoursEnabled: quietEnabled === true,
      quietStartMin: minutesOfDayOr(quietStart, '21:00'),
      quietEndMin: minutesOfDayOr(quietEnd, '08:00'),
      smsRatePerPart: nonNegative(smsRate, 0.5),
      smsUnicodeRatePerPart: nonNegative(smsUnicodeRate, 0),
      dedupeWindowMinutes: nonNegative(dedupeWindow, 120),
      bulkLargeThreshold: nonNegative(bulkThreshold, 500),
      bulkChunkSize: Math.max(1, nonNegative(chunkSize, 100)),
      lowCreditThreshold: nonNegative(lowCredit, 100),
      defaultLanguage: defaultLang === 'BN' ? 'BN' : 'EN',
      birthdayWishEnabled: birthdayEnabled === true,
      birthdayWishMin: minutesOfDayOr(birthdayTime, '08:00'),
      dlrWebhookSecret: text(dlrSecret, ''),
      sms: {
        enabled: smsEnabled === true,
        provider: text(smsProvider, ''),
        apiUrl: text(smsApiUrl, ''),
        apiKey: text(smsApiKey, ''),
        senderId: text(smsSenderId, ''),
        masking: smsMasking !== false,
      },
      email: {
        enabled: emailEnabled === true,
        host: text(emailHost, ''),
        port: nonNegative(emailPort, 587),
        user: text(emailUser, ''),
        pass: text(emailPass, ''),
        fromName: text(emailFromName, ''),
        fromEmail: text(emailFromEmail, ''),
      },
    };
  }
}

function nonNegative(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback;
}
