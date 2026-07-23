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
    // M08 — teacher variant of the same generator.
    [
      'general.teacher_id_pattern',
      'string',
      'Teacher ID pattern',
      '{SCHOOL_CODE}-T-{YY}{SEQ4}',
    ],
    // M09 — permanent student UID (never reused; roll numbers are M11).
    [
      'general.student_id_pattern',
      'string',
      'Student UID pattern',
      '{SCHOOL_CODE}-{YYYY}{SEQ5}',
    ],
    // M10 — admission application numbers (same generator).
    [
      'general.application_no_pattern',
      'string',
      'Admission application number pattern',
      'ADM-{YY}-{SEQ6}',
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
    // M08 — class-teacher cap + evaluation form criteria.
    [
      'academic.max_class_teacher_sections',
      'number',
      'Max sections per class teacher',
      1,
    ],
    [
      'academic.teacher_evaluation_criteria',
      'json',
      'Teacher evaluation criteria',
      [
        'Subject knowledge',
        'Class management',
        'Punctuality',
        'Lesson planning',
        'Student engagement',
      ],
    ],
    // M10 — admission pipeline knobs.
    [
      'academic.admission_selection_deadline_days',
      'number',
      'Admission deadline after selection (days)',
      7,
    ],
    [
      'academic.admission_age_tolerance_years',
      'number',
      'Applicant age tolerance around class level (years)',
      3,
    ],
    [
      'academic.admission_multi_class_applications',
      'boolean',
      'Allow one applicant to apply to multiple classes',
      true,
    ],
    // M13 — routine knobs. Which DAYS the routine offers is not a setting:
    // it is derived from `general.weekly_holidays` (roadmap M13 §6), so
    // there is one place to change the school week.
    [
      'academic.timetable_max_periods_per_teacher_per_day',
      'number',
      'Max periods one teacher may be booked for in a day (0 = unlimited)',
      0,
    ],
    [
      'academic.timetable_allow_combined_classes',
      'boolean',
      'Allow two sections to share one teacher via a combined-class marker',
      true,
    ],
    [
      'academic.timetable_room_conflict_check',
      'boolean',
      'Refuse two sections in the same room at overlapping times',
      true,
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
    // M16 — bKash's token-grant call needs the merchant's portal
    // username/password in addition to the app key pair.
    ['payment.bkash_username', 'string', 'bKash merchant username', ''],
    ['payment.bkash_password', 'string', 'bKash merchant password', '', true],
    ['payment.nagad_merchant_id', 'string', 'Nagad merchant ID', ''],
    ['payment.nagad_private_key', 'string', 'Nagad private key', '', true],
  ]),
  // M12 — every knob the attendance module reads (mode, timing, jobs,
  // edit window, SMS cost control).
  ...g(SettingsGroup.attendance, [
    ['attendance.mode', 'string', 'Attendance mode (daily|period)', 'daily'],
    [
      'attendance.default_start_time',
      'string',
      'Default class start time (HH:mm) — used when a section has no shift',
      '08:00',
    ],
    ['attendance.late_after_minutes', 'number', 'Late after (minutes)', 15],
    [
      'attendance.half_day_after_minutes',
      'number',
      'Half day after (minutes)',
      120,
    ],
    [
      'attendance.edit_window_days',
      'number',
      'Days a marked day stays editable without elevated permission',
      7,
    ],
    [
      'attendance.late_alert_threshold',
      'number',
      'Late days per month flagged in the late analysis report',
      3,
    ],
    [
      'attendance.qr_duplicate_window_minutes',
      'number',
      'QR re-scan window treated as already marked (minutes)',
      5,
    ],
    [
      'attendance.auto_absent_enabled',
      'boolean',
      'Auto-mark unmarked students ABSENT at the cutoff',
      false,
    ],
    [
      'attendance.auto_absent_time',
      'string',
      'Auto-absent cutoff (HH:mm, Asia/Dhaka)',
      '11:00',
    ],
    [
      'attendance.absent_sms_enabled',
      'boolean',
      'Absent SMS to guardians',
      false,
    ],
    [
      'attendance.absent_sms_time',
      'string',
      'Absent SMS dispatch time (HH:mm, Asia/Dhaka)',
      '12:00',
    ],
    [
      'attendance.absent_sms_daily_cap',
      'number',
      'Maximum absent SMS per day (cost control)',
      500,
    ],
  ]),
  // M14 — every knob the examination module reads. `default_pass_mark`
  // and `grace_marks` predate it (M04 placeholders); the rest arrived
  // with the exam wizard, routine clash checks and admit cards.
  ...g(SettingsGroup.exam, [
    ['exam.default_pass_mark', 'number', 'Default pass mark', 33],
    ['exam.grace_marks', 'number', 'Grace marks', 0],
    [
      'exam.default_full_marks',
      'number',
      'Fallback full marks when a class-subject declares none',
      100,
    ],
    [
      'exam.default_duration_min',
      'number',
      'Default sitting length (minutes)',
      180,
    ],
    [
      'exam.default_start_time',
      'string',
      'Default sitting start time (HH:mm)',
      '10:00',
    ],
    [
      'exam.allow_multiple_papers_per_day',
      'boolean',
      'Allow one class to sit more than one paper on the same day',
      false,
    ],
    [
      'exam.room_conflict_check',
      'boolean',
      'Refuse two sittings in the same room at overlapping times',
      true,
    ],
    [
      'exam.seat_plan_default_capacity',
      'number',
      'Default seats per room when the generator is given none',
      30,
    ],
    [
      'exam.seat_plan_default_strategy',
      'string',
      'Default seating layout (SERPENTINE|INTERLEAVE)',
      'SERPENTINE',
    ],
    [
      'exam.admit_card_block_dues',
      'boolean',
      'Block admit cards for candidates with outstanding dues (needs Module 16)',
      false,
    ],
    [
      'exam.admit_card_instructions',
      'string',
      'Instruction block printed on every admit card',
      'Bring this card to every sitting. Mobile phones and calculators are not allowed in the examination hall.',
    ],
    // M15 — result processing. `default_pass_mark` and `grace_marks`
    // above finally have a consumer; the rest arrived with the GPA
    // engine, merit ranking and the report card.
    [
      'exam.grace_max_subjects',
      'number',
      'In how many subjects grace marks may be spent',
      1,
    ],
    [
      'exam.optional_bonus_base',
      'number',
      '4th-subject grade points above this are added as a bonus',
      2,
    ],
    [
      'exam.merit_tiebreak',
      'string',
      'When GPA and marks tie: NONE (share the position) or ROLL_ASC',
      'NONE',
    ],
    [
      'exam.require_locked_marks',
      'boolean',
      'Refuse to process results until every paper is LOCKED',
      true,
    ],
    [
      'exam.result_sms_template',
      'string',
      'Result SMS body ({name} {exam} {gpa} {grade} {merit})',
      '{name}: {exam} result published. GPA {gpa} ({grade}), merit position {merit}.',
    ],
    [
      'exam.public_result_search',
      'boolean',
      'Allow the public website to look results up by roll number',
      true,
    ],
    [
      'exam.report_card_footer',
      'string',
      'Note printed at the foot of every report card',
      'This is a computer-generated report card. Contact the office within 7 days for any correction.',
    ],
    [
      'exam.report_card_show_attendance',
      'boolean',
      'Print the attendance percentage on the report card',
      true,
    ],
  ]),
  // M16 — `due_day_of_month` and `late_fee_percent` predate it (M04
  // placeholders) and finally have a consumer; the rest arrived with
  // invoicing, the fine job and the collection desk.
  ...g(SettingsGroup.fees, [
    ['fees.due_day_of_month', 'number', 'Monthly due day', 10],
    ['fees.late_fee_percent', 'number', 'Late fine per overdue month (%)', 0],
    [
      'fees.fine_flat_per_month',
      'number',
      'Late fine per overdue month (flat BDT)',
      0,
    ],
    ['fees.fine_grace_days', 'number', 'Days after the due date before a fine', 5],
    [
      'fees.fine_cap',
      'number',
      'Maximum total fine per invoice (0 = uncapped)',
      0,
    ],
    [
      'fees.prorate_enabled',
      'boolean',
      'Prorate monthly fees for mid-month joiners',
      true,
    ],
    [
      'fees.prorate_include_join_day',
      'boolean',
      'Count the joining day itself as billable',
      true,
    ],
    [
      'fees.allow_overpayment',
      'boolean',
      'Allow collecting more than an invoice asks for (needs fee.overpay)',
      false,
    ],
    [
      'fees.invoice_no_pattern',
      'string',
      'Invoice number pattern',
      'INV-{YY}{MM}-{SEQ6}',
    ],
    [
      'fees.payment_no_pattern',
      'string',
      'Receipt number pattern',
      'RCP-{YY}{MM}-{SEQ6}',
    ],
    [
      'fees.receipt_footer',
      'string',
      'Note printed at the foot of every receipt',
      'This receipt is computer-generated. Please retain it for your records.',
    ],
    [
      'fees.receipt_sms_enabled',
      'boolean',
      'Send an SMS receipt when a payment succeeds',
      false,
    ],
    [
      'fees.receipt_sms_template',
      'string',
      'Receipt SMS body ({school} {name} {amount} {invoice} {balance})',
      '{school}: received {amount} BDT against {invoice} for {name}. Outstanding {balance} BDT.',
    ],
    [
      'fees.dues_sms_template',
      'string',
      'Dues reminder SMS body ({school} {name} {amount} {due})',
      '{school}: {name} has {amount} BDT outstanding. Please pay by {due}.',
    ],
    [
      'fees.dues_block_exit_status',
      'boolean',
      'Block TRANSFERRED/GRADUATED/DROPPED while dues are outstanding',
      false,
    ],
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
