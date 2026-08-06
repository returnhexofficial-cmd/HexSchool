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
    [
      'fees.fine_grace_days',
      'number',
      'Days after the due date before a fine',
      5,
    ],
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
  // M17 — every knob the communication module reads (quiet hours, SMS
  // cost + credit, dedupe, bulk gating, scheduled jobs, DLR secret). The
  // gateway credentials themselves stay in the `sms.*` / `email.*` groups.
  ...g(SettingsGroup.communication, [
    [
      'communication.quiet_hours_enabled',
      'boolean',
      'Hold SMS during quiet hours',
      false,
    ],
    [
      'communication.quiet_hours_start',
      'string',
      'Quiet hours start (HH:mm)',
      '21:00',
    ],
    [
      'communication.quiet_hours_end',
      'string',
      'Quiet hours end (HH:mm)',
      '08:00',
    ],
    [
      'communication.sms_rate_per_part',
      'number',
      'SMS cost per part (BDT)',
      0.5,
    ],
    [
      'communication.sms_unicode_rate_per_part',
      'number',
      'SMS cost per Bangla/unicode part (0 = same as text)',
      0,
    ],
    [
      'communication.dedupe_window_minutes',
      'number',
      'Window that collapses a repeat (destination, template) send',
      120,
    ],
    [
      'communication.bulk_large_threshold',
      'number',
      'Recipient count above which a bulk send needs notification.bulk.large',
      500,
    ],
    [
      'communication.bulk_chunk_size',
      'number',
      'Bulk messages per rate-spread chunk',
      100,
    ],
    [
      'communication.low_credit_threshold',
      'number',
      'SMS-credit balance that triggers a low-balance alert',
      100,
    ],
    [
      'communication.default_language',
      'string',
      'Default template language (EN|BN)',
      'EN',
    ],
    [
      'communication.sms_masking',
      'boolean',
      'Use a masked (branded) sender id',
      true,
    ],
    [
      'communication.birthday_wish_enabled',
      'boolean',
      'Send a daily birthday SMS to guardians',
      false,
    ],
    [
      'communication.birthday_wish_time',
      'string',
      'Birthday-wish dispatch time (HH:mm)',
      '08:00',
    ],
    [
      'communication.dlr_webhook_secret',
      'string',
      'Shared secret for the SMS delivery-report webhook',
      '',
      true,
    ],
  ]),
  // M19 — the public website: identity, the home-page furniture (hero
  // slides, quick links, footer, socials, map), SEO/analytics, and the
  // privacy switches on the public verification endpoints. reCAPTCHA
  // deliberately stays in env (`RECAPTCHA_SECRET_KEY`, the M10 decision)
  // rather than joining this group.
  ...g(SettingsGroup.website, [
    ['website.enabled', 'boolean', 'Public website enabled', true],
    [
      'website.site_url',
      'string',
      'Public site base URL (absolute, used in sitemap/RSS/canonical links)',
      '',
    ],
    [
      'website.site_title',
      'string',
      'Site title (falls back to school name)',
      '',
    ],
    ['website.site_title_bn', 'string', 'Site title (Bangla)', ''],
    ['website.tagline', 'string', 'Tagline shown under the site title', ''],
    [
      'website.meta_description',
      'string',
      'Default meta description for pages that declare none',
      '',
    ],
    ['website.og_image_url', 'string', 'Default OpenGraph share image URL', ''],
    [
      'website.indexable',
      'boolean',
      'Allow search engines to index the site (off ⇒ robots.txt disallows all)',
      true,
    ],
    ['website.analytics_id', 'string', 'Analytics measurement ID', ''],
    [
      'website.hero_slides',
      'json',
      'Home hero slides ([{ imageUrl, title, subtitle, ctaLabel, ctaHref }])',
      [],
    ],
    [
      'website.quick_links',
      'json',
      'Quick links block ([{ label, href }])',
      [],
    ],
    ['website.footer_text', 'string', 'Footer note', ''],
    ['website.social_facebook', 'string', 'Facebook page URL', ''],
    ['website.social_youtube', 'string', 'YouTube channel URL', ''],
    ['website.social_linkedin', 'string', 'LinkedIn page URL', ''],
    ['website.social_x', 'string', 'X (Twitter) profile URL', ''],
    ['website.map_embed_url', 'string', 'Google Maps embed URL', ''],
    [
      'website.contact_email',
      'string',
      'Address contact-form notifications are emailed to (blank = in-app only)',
      '',
    ],
    [
      'website.default_language',
      'string',
      'Default site language (en|bn)',
      'en',
    ],
    [
      'website.language_toggle',
      'boolean',
      'Offer the Bangla/English toggle (content fields are dual)',
      true,
    ],
    [
      'website.cache_ttl_seconds',
      'number',
      'Server-side cache TTL for public composite endpoints',
      60,
    ],
    ['website.news_page_size', 'number', 'Posts per page on the news feed', 9],
    [
      'website.teacher_directory_enabled',
      'boolean',
      'Publish the teacher & staff directory (never exposes phone/email)',
      true,
    ],
    [
      'website.student_verification_enabled',
      'boolean',
      'Allow public student verification by UID / QR token',
      true,
    ],
    [
      'website.student_verification_fields',
      'json',
      'Fields a verification result may reveal (name, class, status, photo)',
      ['name', 'class', 'status', 'photo'],
    ],
    [
      'website.career_cv_max_mb',
      'number',
      'Maximum CV upload size for a career application (MB)',
      5,
    ],
  ]),
  // M20 — the ledger's knobs: voucher numbering per type, whether fee
  // money posts itself, and the two safety checks the roadmap makes
  // configurable (§6 cash-negative, §7 future dating, §8 backdating).
  ...g(SettingsGroup.accounting, [
    ['accounting.enabled', 'boolean', 'Accounting module enabled', true],
    [
      'accounting.auto_post_fees',
      'boolean',
      'Post fee receipts and refunds to the ledger automatically',
      true,
    ],
    [
      'accounting.auto_post_status',
      'string',
      'Auto-posted vouchers land as POSTED or DRAFT (for review)',
      'POSTED',
    ],
    [
      'accounting.voucher_no_pattern_debit',
      'string',
      'Payment (debit) voucher number pattern',
      'DV-{YY}-{SEQ5}',
    ],
    [
      'accounting.voucher_no_pattern_credit',
      'string',
      'Receipt (credit) voucher number pattern',
      'CV-{YY}-{SEQ5}',
    ],
    [
      'accounting.voucher_no_pattern_journal',
      'string',
      'Journal voucher number pattern',
      'JV-{YY}-{SEQ5}',
    ],
    [
      'accounting.voucher_no_pattern_contra',
      'string',
      'Contra voucher number pattern',
      'CN-{YY}-{SEQ5}',
    ],
    [
      'accounting.future_voucher_days',
      'number',
      'Days a voucher may be dated ahead (0 = no future dating)',
      0,
    ],
    [
      'accounting.cash_negative_check',
      'string',
      'Cash going negative: HARD (refuse), SOFT (warn) or OFF',
      'SOFT',
    ],
    [
      'accounting.backdate_after_close',
      'boolean',
      'A payment dated inside a closed period posts to the next open one with a note (BD practice)',
      true,
    ],
    [
      'accounting.require_narration',
      'boolean',
      'Every voucher must carry a narration',
      true,
    ],
    [
      'accounting.fiscal_year_start_month',
      'number',
      'Month the accounting year starts (1–12)',
      1,
    ],
    [
      'accounting.report_footer',
      'string',
      'Footer line printed on accounting statements',
      '',
    ],
  ]),
  // M21 — every number the payroll engine cannot invent for itself: what
  // an absent day costs, the provident-fund percentages, the income-tax
  // slabs, the rounding a school prints on a payslip, and the leave-year
  // rules. The engines take these as arguments and stay dependency-free.
  ...g(SettingsGroup.payroll, [
    ['payroll.enabled', 'boolean', 'HR & Payroll module enabled', true],
    [
      'payroll.absent_deduction_enabled',
      'boolean',
      'Deduct pay for unexcused absent days',
      true,
    ],
    [
      'payroll.absent_deduction_base',
      'string',
      'Absent deduction divides BASIC or GROSS by working days',
      'BASIC',
    ],
    [
      'payroll.unpaid_leave_deduction_enabled',
      'boolean',
      'Deduct pay for approved leave on an unpaid leave type',
      true,
    ],
    [
      'payroll.working_days_source',
      'string',
      'Working days per month: CALENDAR (holidays + weekly off) or FIXED',
      'CALENDAR',
    ],
    [
      'payroll.fixed_working_days',
      'number',
      'Working days per month when the source is FIXED',
      26,
    ],
    ['payroll.pf_enabled', 'boolean', 'Operate a provident fund', false],
    [
      'payroll.pf_employee_percent',
      'number',
      'Employee provident-fund contribution (% of the PF base)',
      10,
    ],
    [
      'payroll.pf_employer_percent',
      'number',
      'Employer provident-fund contribution (% of the PF base)',
      10,
    ],
    [
      'payroll.pf_base',
      'string',
      'PF base: BASIC, or BASIC plus components flagged as PF base',
      'BASIC',
    ],
    [
      'payroll.pf_min_service_months',
      'number',
      'Months of service before provident-fund deduction starts',
      12,
    ],
    ['payroll.tax_enabled', 'boolean', 'Deduct income tax at source', false],
    [
      'payroll.tax_slabs',
      'json',
      'BD income-tax slabs: [{ upTo: number|null, rate: percent }] on ANNUAL taxable income',
      [
        { upTo: 350000, rate: 0 },
        { upTo: 450000, rate: 5 },
        { upTo: 750000, rate: 10 },
        { upTo: 1150000, rate: 15 },
        { upTo: 1650000, rate: 20 },
        { upTo: null, rate: 25 },
      ],
    ],
    [
      'payroll.tax_rebate_percent',
      'number',
      'Flat investment rebate applied to the computed annual tax (%)',
      0,
    ],
    [
      'payroll.rounding',
      'string',
      'Net pay rounding: NONE, NEAREST_1, NEAREST_5 or NEAREST_10',
      'NEAREST_1',
    ],
    [
      'payroll.default_payment_mode',
      'string',
      'Default disbursement mode for a new salary assignment',
      'BANK',
    ],
    [
      'payroll.festival_bonus_min_service_months',
      'number',
      'Default minimum service (months) for festival-bonus eligibility',
      6,
    ],
    [
      'payroll.festival_bonus_prorate',
      'boolean',
      'Prorate a festival bonus for employees short of the minimum service',
      false,
    ],
    [
      'payroll.payslip_sms',
      'boolean',
      'Send an SMS when a payroll run is disbursed',
      true,
    ],
    [
      'payroll.auto_post_accounting',
      'boolean',
      'Post the salary voucher to the ledger on disbursement',
      true,
    ],
    [
      'payroll.leave_year_carry_forward',
      'boolean',
      'Carry unused balance into the next session where the type allows it',
      true,
    ],
    [
      'payroll.leave_requires_balance',
      'boolean',
      'Refuse an approval that would take a balance negative',
      true,
    ],
    [
      'payroll.report_footer',
      'string',
      'Footer line printed on payslips and payroll reports',
      '',
    ],
  ]),
  // ── Module 22: Assignments & Homework ───────────────────────────────
  ...g(SettingsGroup.assignment, [
    ['assignment.enabled', 'boolean', 'Assignments & homework enabled', true],
    [
      'assignment.max_attachments',
      'number',
      'Maximum files on one assignment or submission',
      3,
    ],
    [
      'assignment.max_attachment_mb',
      'number',
      'Maximum size of a single attachment (MB)',
      10,
    ],
    [
      'assignment.allowed_file_types',
      'json',
      'Attachment extensions students and teachers may upload',
      ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png'],
    ],
    [
      'assignment.allow_resubmission',
      'boolean',
      'Let a student replace a submission they already made',
      true,
    ],
    [
      'assignment.resubmission_until_due',
      'boolean',
      'Only allow resubmission before the deadline has passed',
      true,
    ],
    [
      'assignment.allow_late_default',
      'boolean',
      'New assignments accept late submissions by default',
      false,
    ],
    [
      'assignment.default_due_days',
      'number',
      'Days ahead the due date is pre-filled to on a new assignment',
      7,
    ],
    [
      'assignment.publish_notification',
      'boolean',
      'Notify the section when an assignment is published',
      true,
    ],
    // SMS costs real money per part (M17), and a school setting five
    // assignments a day across twelve sections would spend a term's
    // credit in a week. The in-app bell is free and is where a portal
    // user already looks, so it is the default and SMS is opt-in.
    [
      'assignment.notification_channel',
      'string',
      'Channel for assignment alerts: IN_APP or SMS',
      'IN_APP',
    ],
    [
      'assignment.due_reminder_enabled',
      'boolean',
      'Send a reminder before an assignment falls due',
      true,
    ],
    [
      'assignment.due_reminder_hours',
      'number',
      'Hours before the deadline the reminder is sent',
      24,
    ],
    [
      'assignment.no_submission_alert_days',
      'number',
      'Days after the due date a teacher is nudged about zero submissions',
      3,
    ],
    [
      'assignment.material_link_hosts',
      'json',
      'Hosts a VIDEO_URL/LINK material may point at (empty = any https host)',
      ['youtube.com', 'youtu.be', 'drive.google.com', 'docs.google.com'],
    ],
  ]),
  // ── Module 23: Library Management ───────────────────────────────────
  ...g(SettingsGroup.library, [
    ['library.enabled', 'boolean', 'Library management enabled', true],
    [
      'library.accession_pattern',
      'string',
      'Accession-number pattern for new copies',
      'ACC-{YY}-{SEQ5}',
    ],
    [
      'library.card_no_pattern',
      'string',
      'Library card-number pattern for new members',
      'LIB-{YY}-{SEQ5}',
    ],
    // Roadmap §3's "student 7 / teacher 14". Staff sit with the
    // teachers: an office assistant borrowing a reference book is doing
    // the same thing a teacher is, and a shorter loan for them would be
    // a distinction the school never asked for.
    [
      'library.loan_days_student',
      'number',
      'Loan period for a student (days)',
      7,
    ],
    [
      'library.loan_days_teacher',
      'number',
      'Loan period for a teacher (days)',
      14,
    ],
    ['library.loan_days_staff', 'number', 'Loan period for staff (days)', 14],
    [
      'library.max_books_student',
      'number',
      'Books a student may hold at once',
      2,
    ],
    [
      'library.max_books_teacher',
      'number',
      'Books a teacher may hold at once',
      5,
    ],
    [
      'library.max_books_staff',
      'number',
      'Books a staff member may hold at once',
      3,
    ],
    ['library.max_renews', 'number', 'Times one loan may be renewed', 2],
    ['library.fine_per_day', 'number', 'Overdue fine per day (BDT)', 2],
    [
      'library.fine_grace_days',
      'number',
      'Days after the due date before a fine starts',
      0,
    ],
    [
      'library.max_fine_per_book',
      'number',
      'Ceiling on the overdue fine for one loan (0 = uncapped)',
      500,
    ],
    // Roadmap §4 calls holiday-awareness an "option" and it is one: a
    // school whose library opens on Fridays wants every day counted, and
    // one that closes would otherwise fine a member for a day on which
    // they could not physically have returned the book.
    [
      'library.fine_holiday_aware',
      'boolean',
      'Skip school holidays when counting overdue days',
      true,
    ],
    [
      'library.fine_block_threshold',
      'number',
      'Unpaid fine at or above which borrowing is blocked (0 = never)',
      100,
    ],
    [
      'library.block_when_overdue',
      'boolean',
      'Refuse a new loan while the member is holding an overdue book',
      true,
    ],
    [
      'library.block_duplicate_title',
      'boolean',
      'Refuse a second copy of a title the member already has out',
      true,
    ],
    [
      'library.lost_price_multiplier',
      'number',
      'Charge for a lost book, as a multiple of its price',
      1.5,
    ],
    [
      'library.damaged_price_multiplier',
      'number',
      'Charge for a damaged book, as a multiple of its price',
      0.5,
    ],
    [
      'library.default_book_price',
      'number',
      'Replacement value used when a title carries no price (BDT)',
      300,
    ],
    [
      'library.reservation_days',
      'number',
      'Days a returned copy is held for the member who reserved it',
      3,
    ],
    [
      'library.auto_provision_members',
      'boolean',
      'Enrol a student/teacher/staff member automatically on their first issue',
      true,
    ],
    [
      'library.overdue_notice_enabled',
      'boolean',
      'Send the weekly overdue chase',
      true,
    ],
    [
      'library.overdue_notice_channel',
      'string',
      'Channel for library alerts: IN_APP or SMS',
      'IN_APP',
    ],
    [
      'library.overdue_notice_weekday',
      'number',
      'Day of week the overdue chase runs (0 = Sunday)',
      6,
    ],
    [
      'library.overdue_repeat_days',
      'number',
      'Days before the same overdue loan is chased again',
      7,
    ],
    [
      'library.opac_enabled',
      'boolean',
      'Show the catalogue in the portal',
      true,
    ],
    [
      'library.opac_allow_reservation',
      'boolean',
      'Let portal users place their own holds',
      true,
    ],
    [
      'library.auto_post_accounting',
      'boolean',
      'Post collected fines to the ledger (Module 20)',
      true,
    ],
    // Deliberately OFF by default, mirroring `fees.dues_block_exit_status`
    // (M16): a school transferring a student mid-dispute still has to be
    // able to record it, so the default is a warning the office reads.
    [
      'library.clearance_block_exit',
      'boolean',
      'Block a student exit status while books are out or fines unpaid',
      false,
    ],
  ]),

  // ── Module 25: Transport Management ─────────────────────────────────
  ...g(SettingsGroup.transport, [
    ['transport.enabled', 'boolean', 'School transport is in use', true],
    // The M16 link. An id wins; the NAME is the fallback, so a school
    // that simply created a fee head called "Transport" bills correctly
    // with nothing configured — the M20 posting-map shape.
    [
      'transport.fee_head_id',
      'string',
      'Fee head the monthly transport charge is billed under',
      '',
    ],
    [
      'transport.fee_head_name',
      'string',
      'Fee head name to fall back on when no id is set',
      'Transport',
    ],
    [
      'transport.auto_invoice',
      'boolean',
      'Add a transport line to the monthly fee batch',
      true,
    ],
    // Roadmap §6: "ending an assignment stops future transport invoicing
    // (current month per proration rule)". Off means a whole month is
    // charged for any service in it, which is what "per month started"
    // schools mean.
    [
      'transport.prorate_enabled',
      'boolean',
      'Charge part of a month when a rider starts or stops mid-month',
      true,
    ],
    // Roadmap §6 makes over-capacity a WARNING. A school that means it
    // turns this on deliberately, and `transport.assign.override` is
    // then what gets past it.
    [
      'transport.capacity_hard_block',
      'boolean',
      'Refuse an assignment that would exceed the vehicle’s seats',
      false,
    ],
    [
      'transport.expiry_alert_enabled',
      'boolean',
      'Send the daily fitness / tax / insurance / licence alert',
      true,
    ],
    [
      'transport.expiry_alert_days',
      'number',
      'Days before a document expires that the alert starts',
      30,
    ],
    [
      'transport.expiry_alert_channel',
      'string',
      'Channel for transport alerts: IN_APP or SMS',
      'IN_APP',
    ],
    [
      'transport.expiry_repeat_days',
      'number',
      'Days before the same lapsed document is flagged again',
      7,
    ],
    // Off by default: a route assignment is not news a family needs an
    // SMS about every time the office edits a stop (the M22 channel
    // reasoning — the cheapest message is the one not sent).
    [
      'transport.notify_guardian_on_assign',
      'boolean',
      'Tell the guardian the route, stop and times when a rider is assigned',
      false,
    ],
    [
      'transport.auto_post_accounting',
      'boolean',
      'Post vehicle expenses to the ledger (Module 20)',
      true,
    ],
  ]),

  // ── Module 24: Inventory & Assets ───────────────────────────────────
  ...g(SettingsGroup.inventory, [
    ['inventory.enabled', 'boolean', 'The school runs a store', true],
    // Document-number patterns, the M07 `general.employee_id_pattern`
    // convention: the counter is per school and per year, so a school
    // that restarts numbering each session gets what it expects.
    [
      'inventory.purchase_no_pattern',
      'string',
      'Purchase number pattern ({YY}, {SEQ5} …)',
      'PO-{YY}-{SEQ5}',
    ],
    [
      'inventory.issue_no_pattern',
      'string',
      'Issue (gate pass) number pattern',
      'ISS-{YY}-{SEQ5}',
    ],
    // Asset tags deliberately carry NO year token by default. A tag is a
    // sticker on a projector for the whole of its life, and a school
    // reading `AST-00042` off a label should not have to know which year
    // it was bought in to find the row.
    [
      'inventory.asset_tag_pattern',
      'string',
      'Asset tag pattern — printed on the label, never reused',
      'AST-{SEQ5}',
    ],
    [
      'inventory.low_stock_alert_enabled',
      'boolean',
      'Send the low-stock alert for items at or below their reorder level',
      true,
    ],
    // IN_APP for the M22/M23/M25 reason: this is an OFFICE problem, the
    // people who can act on it are already looking at the bell, and a
    // store with four hundred items would spend real credit weekly.
    [
      'inventory.low_stock_alert_channel',
      'string',
      'Channel for store alerts: IN_APP or SMS',
      'IN_APP',
    ],
    [
      'inventory.low_stock_alert_weekday',
      'number',
      'Day of week the low-stock sweep runs (0 = Sunday)',
      6,
    ],
    [
      'inventory.warranty_alert_days',
      'number',
      'Days before an asset warranty expires that it is flagged',
      30,
    ],
    // Roadmap §4's optional posting. On by default, because a school that
    // has switched accounting on wants its purchases in the books; a
    // missing account logs and is skipped, never throws (the M20 rule).
    [
      'inventory.auto_post_accounting',
      'boolean',
      'Post received purchases to the ledger (Module 20)',
      true,
    ],
    // **The valuation method, named in the setting so nobody has to guess
    // what the total on the report means.** Roadmap §4 asks for last
    // price × qty and calls it FIFO-simple; it is not FIFO, and the
    // report says so on its face.
    [
      'inventory.valuation_method',
      'string',
      'Stock valuation basis (LAST_PRICE — the only method implemented)',
      'LAST_PRICE',
    ],
    // A receipt that generates one tagged unit per asset bought is the
    // point of the module; a school buying 500 chairs in one delivery
    // still should not create 500 rows by accident, so the batch is
    // capped and the message says to split the purchase.
    [
      'inventory.max_asset_units_per_receipt',
      'number',
      'Most tagged units one purchase receipt may generate',
      200,
    ],
  ]),

  // ── Module 26: Hostel Management ────────────────────────────────────
  ...g(SettingsGroup.hostel, [
    ['hostel.enabled', 'boolean', 'The school runs a boarding house', true],
    // The M16 link, twice: a hostel bill is a room charge and a food
    // charge, and a school wants to see them apart in its fee reports.
    // An id wins; the NAME is the fallback, so a school that simply
    // created a fee head called "Hostel" bills correctly with nothing
    // configured — the M20 posting-map / M25 transport shape.
    [
      'hostel.fee_head_id',
      'string',
      'Fee head the monthly seat rent is billed under',
      '',
    ],
    [
      'hostel.fee_head_name',
      'string',
      'Fee head name to fall back on when no id is set',
      'Hostel',
    ],
    [
      'hostel.mess_fee_head_id',
      'string',
      'Fee head the monthly mess charge is billed under',
      '',
    ],
    [
      'hostel.mess_fee_head_name',
      'string',
      'Mess fee head name to fall back on when no id is set',
      'Mess',
    ],
    [
      'hostel.auto_invoice',
      'boolean',
      'Add hostel and mess lines to the monthly fee batch',
      true,
    ],
    [
      'hostel.prorate_enabled',
      'boolean',
      'Charge part of a month when a boarder arrives or leaves mid-month',
      true,
    ],
    [
      'hostel.default_security_deposit',
      'number',
      'Deposit suggested when a new boarder is allocated a bed',
      0,
    ],
    // Roadmap §6's "meal-off min duration setting (e.g., ≥ 3 days)". The
    // kitchen buys ahead, so a one-night absence saves the school
    // nothing and crediting it would cost money to be told about.
    [
      'hostel.meal_off_min_days',
      'number',
      'Shortest meal-off a boarder may claim a credit for',
      3,
    ],
    // Zero means "derive from the plan's monthly charge over the days of
    // that month", which is the only form that can never over-credit.
    // A flat rate above zero is the school's own figure — see
    // `mess.engine.ts` for why the credit is then capped.
    [
      'hostel.mess_day_rate',
      'number',
      'Flat per-day mess credit; 0 derives it from the plan',
      0,
    ],
    // Deliberately OFF, mirroring `fees.dues_block_exit_status` (M16) and
    // `library.clearance_block_exit` (M23): a school moving a student out
    // mid-dispute still has to be able to record it, so the default is a
    // warning the office reads.
    [
      'hostel.vacate_block_dues',
      'boolean',
      'Refuse to release a bed while fees are outstanding',
      false,
    ],
    [
      'hostel.notify_guardian_on_allocation',
      'boolean',
      'Tell the guardian the hostel, room and bed when a boarder is allocated',
      false,
    ],
    [
      'hostel.auto_post_accounting',
      'boolean',
      'Post security deposits and their refunds to the ledger (Module 20)',
      true,
    ],
    [
      'hostel.bed_no_prefix',
      'string',
      'Prefix bulk bed generation uses ("B" → B1, B2, B3 …)',
      'B',
    ],
    // The M23 200-copy / M24 transaction-budget cap: an unbounded loop
    // inserting rows inside one transaction is how a fat-fingered number
    // takes the request down.
    ['hostel.max_beds_per_room', 'number', 'Most beds one room may hold', 20],
  ]),

  // ── Module 27 — documents & certificates ─────────────────────────────
  ...g(SettingsGroup.documents, [
    [
      'documents.enabled',
      'boolean',
      'The school issues certificates from this system',
      true,
    ],
    // PROJECT_CONTEXT §3 records `TC-{YY}-{SEQ4}` (per type). `{TYPE}` is
    // resolved from the prefix map below before the shared SequenceService
    // renderer sees the pattern — one pattern language, one place that
    // knows `{SEQ4}`.
    [
      'documents.certificate_no_pattern',
      'string',
      'Certificate number pattern',
      '{TYPE}-{YY}-{SEQ4}',
    ],
    [
      'documents.certificate_type_prefixes',
      'json',
      'Number prefix per certificate type',
      {
        TRANSFER: 'TC',
        CHARACTER: 'CC',
        TESTIMONIAL: 'TS',
        PRIZE: 'PR',
        PARTICIPATION: 'PA',
        CUSTOM: 'CE',
      },
    ],
    // Roadmap §6 gates the TC and only the TC. A character certificate is
    // a reference, and refusing to say a child is of good character over
    // two months' unpaid tuition is a different and meaner act — see
    // `clearance.engine.ts`. A school may widen the list.
    [
      'documents.clearance_required_types',
      'json',
      'Certificate types that require full clearance',
      ['TRANSFER'],
    ],
    [
      'documents.clearance_include_library',
      'boolean',
      'Count unreturned books and unpaid library fines as clearance',
      true,
    ],
    [
      'documents.clearance_include_hostel',
      'boolean',
      'Count a bed still held and an unreturned deposit as clearance',
      true,
    ],
    // Roadmap §4 makes this the rule; the knob exists because a school
    // that issues a TC weeks before the child actually leaves would
    // otherwise lose them off every register in the meantime.
    [
      'documents.tc_sets_transferred',
      'boolean',
      'Issuing a transfer certificate marks the student TRANSFERRED',
      true,
    ],
    [
      'documents.notify_on_issue',
      'boolean',
      'Tell the guardian when a certificate is issued',
      true,
    ],
    // Empty means "use website.site_url" — a QR pointing at localhost is
    // worse than one carrying the bare code (the M19 sitemap rule).
    [
      'documents.verify_url_base',
      'string',
      'Public base URL the certificate QR encodes (blank = the website URL)',
      '',
    ],
    ['documents.conduct_default', 'string', 'Default conduct wording', 'Good'],
    [
      'documents.duplicate_watermark_text',
      'string',
      'Watermark printed across a duplicate re-issue',
      'DUPLICATE',
    ],
    // Roadmap §7: "signatory images ≤ 500 KB".
    [
      'documents.signatory_max_kb',
      'number',
      'Largest signature image, in KB',
      500,
    ],
    [
      'documents.archive_max_file_mb',
      'number',
      'Largest file the archive accepts, in MB',
      20,
    ],
    [
      'documents.archive_allowed_types',
      'json',
      'MIME types the archive accepts',
      [
        'application/pdf',
        'image/jpeg',
        'image/png',
        'image/webp',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ],
    ],
    [
      'documents.bulk_prize_max',
      'number',
      'Most prize certificates one wizard run may raise',
      200,
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
