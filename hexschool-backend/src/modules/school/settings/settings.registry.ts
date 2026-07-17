import { SettingsGroup } from '../../../common/constants';

/**
 * Settings key catalog — the source of truth for every configurable key
 * (mirrors the permission-registry pattern): which group it belongs to,
 * its type, its default, and whether it is a secret. The service
 * validates every PUT against this registry (unknown keys and wrong
 * types are rejected — roadmap M04 §7 "Zod-like schemas server-side"),
 * encrypts `secret` values at rest, and masks them on read.
 *
 * Later modules extend their group here (no migration needed — storage
 * is generic key/JSONB rows).
 */

export type SettingType = 'string' | 'number' | 'boolean' | 'json';

export interface SettingDefinition {
  key: string;
  group: SettingsGroup;
  type: SettingType;
  label: string;
  /** AES-256-GCM encrypted at rest; masked in GET responses. */
  secret?: boolean;
  default: unknown;
}

const g = (
  group: SettingsGroup,
  entries: ReadonlyArray<
    readonly [
      key: string,
      type: SettingType,
      label: string,
      def: unknown,
      secret?: boolean,
    ]
  >,
): SettingDefinition[] =>
  entries.map(([key, type, label, def, secret]) => ({
    key,
    group,
    type,
    label,
    default: def,
    ...(secret ? { secret: true } : {}),
  }));

export const SETTINGS_REGISTRY: ReadonlyArray<SettingDefinition> = [
  ...g(SettingsGroup.general, [
    ['general.timezone', 'string', 'Display timezone', 'Asia/Dhaka'],
    ['general.language', 'string', 'Default language', 'en'],
    ['general.weekly_holidays', 'json', 'Weekly holidays', ['FRIDAY']],
    // M07 — consumed by SequenceService when staff records are created.
    [
      'general.employee_id_pattern',
      'string',
      'Employee ID pattern',
      '{SCHOOL_CODE}-S-{YY}{SEQ4}',
    ],
  ]),
  ...g(SettingsGroup.academic, [
    ['academic.session_start_month', 'number', 'Session start month (1–12)', 1],
    [
      'academic.roll_generation',
      'string',
      'Roll generation strategy',
      'admission',
    ],
  ]),
  ...g(SettingsGroup.sms, [
    ['sms.enabled', 'boolean', 'SMS sending enabled', false],
    ['sms.provider', 'string', 'Gateway provider', ''],
    ['sms.api_url', 'string', 'Gateway API URL', ''],
    ['sms.api_key', 'string', 'Gateway API key', '', true],
    ['sms.sender_id', 'string', 'Sender ID', ''],
  ]),
  ...g(SettingsGroup.email, [
    ['email.enabled', 'boolean', 'Email sending enabled', false],
    ['email.smtp_host', 'string', 'SMTP host', ''],
    ['email.smtp_port', 'number', 'SMTP port', 587],
    ['email.smtp_user', 'string', 'SMTP username', ''],
    ['email.smtp_pass', 'string', 'SMTP password', '', true],
    ['email.from_name', 'string', 'From name', ''],
    ['email.from_email', 'string', 'From email', ''],
  ]),
  ...g(SettingsGroup.payment, [
    ['payment.sandbox', 'boolean', 'Sandbox mode', true],
    ['payment.sslcommerz_store_id', 'string', 'SSLCommerz store ID', ''],
    [
      'payment.sslcommerz_store_pass',
      'string',
      'SSLCommerz store password',
      '',
      true,
    ],
    ['payment.bkash_app_key', 'string', 'bKash app key', ''],
    ['payment.bkash_app_secret', 'string', 'bKash app secret', '', true],
    ['payment.nagad_merchant_id', 'string', 'Nagad merchant ID', ''],
    ['payment.nagad_private_key', 'string', 'Nagad private key', '', true],
  ]),
  ...g(SettingsGroup.attendance, [
    ['attendance.late_after_minutes', 'number', 'Late after (minutes)', 15],
    [
      'attendance.absent_sms_enabled',
      'boolean',
      'Absent SMS to guardians',
      false,
    ],
  ]),
  ...g(SettingsGroup.exam, [
    ['exam.default_pass_mark', 'number', 'Default pass mark', 33],
    ['exam.grace_marks', 'number', 'Grace marks', 0],
  ]),
  ...g(SettingsGroup.fees, [
    ['fees.due_day_of_month', 'number', 'Monthly due day', 10],
    ['fees.late_fee_percent', 'number', 'Late fee (%)', 0],
  ]),
];

const byKey = new Map(SETTINGS_REGISTRY.map((d) => [d.key, d]));
const byGroup = new Map<SettingsGroup, SettingDefinition[]>();
for (const def of SETTINGS_REGISTRY) {
  const list = byGroup.get(def.group) ?? [];
  list.push(def);
  byGroup.set(def.group, list);
}

export function settingDefinition(key: string): SettingDefinition | undefined {
  return byKey.get(key);
}

export function groupDefinitions(group: SettingsGroup): SettingDefinition[] {
  return byGroup.get(group) ?? [];
}

/** Placeholder returned instead of stored secrets; PUTting it back keeps
 *  the existing value (so the UI can round-trip a form untouched). */
export const SECRET_MASK = '__SECRET__';
