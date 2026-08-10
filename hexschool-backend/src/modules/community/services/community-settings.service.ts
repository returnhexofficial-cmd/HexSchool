import { Injectable } from '@nestjs/common';
import { SettingsService } from '../../school/services/settings.service';
import { DEFAULT_SLA_HOURS } from '../calc/sla.engine';
import {
  TICKET_CATEGORIES,
  type TicketCategoryCode,
  type TicketPriorityCode,
} from '../calc/types';

export interface CommunityConfig {
  enabled: boolean;
  // ── complaints ────────────────────────────────────────────────────
  ticketNoPattern: string;
  ticketAllowAnonymous: boolean;
  ticketAllowPublic: boolean;
  ticketSlaHours: Record<TicketPriorityCode, number>;
  ticketReopenDays: number;
  ticketSensitiveCategories: TicketCategoryCode[];
  ticketNotifyRequester: boolean;
  ticketSatisfactionPrompt: boolean;
  ticketPublicHourlyLimit: number;
  // ── visitors ──────────────────────────────────────────────────────
  visitorGatePassRequired: boolean;
  visitorGatePassPattern: string;
  /** Minutes past midnight, Dhaka. */
  visitorAutoCheckoutMinutes: number;
  visitorPhotoRequired: boolean;
  visitorMaxPassDays: number;
  appointmentNotify: boolean;
  // ── alumni ────────────────────────────────────────────────────────
  alumniPublicRegistration: boolean;
  alumniDirectoryPublic: boolean;
  alumniMinBatchYear: number;
  alumniAutoApprove: boolean;
  alumniNotifyOnApproval: boolean;
  // ── donations ─────────────────────────────────────────────────────
  donationReceiptPattern: string;
  donationPostToAccounts: boolean;
  donationThankYou: boolean;
}

/**
 * `null`, `undefined` and `''` all mean "no value", and `Number()` maps
 * the first and third to **0** rather than to NaN — so a finiteness check
 * alone never sees them and they clamp to `min` instead of falling back to
 * the registry default. M24 found this in its own helper, M25 carried the
 * identical defect, M26 and M27 restated it; here a missing
 * `community.ticket_reopen_days` would shut the reopen window the instant
 * a ticket was closed, and a missing `community.visitor_max_pass_days`
 * would refuse every multi-day pass.
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

function text(value: unknown, fallback: string): string {
  const s = typeof value === 'string' ? value.trim() : '';
  return s.length > 0 ? s : fallback;
}

/** Only values naming a real category survive. */
function asCategoryList(
  value: unknown,
  fallback: TicketCategoryCode[],
): TicketCategoryCode[] {
  if (!Array.isArray(value)) return fallback;
  const known = new Set<string>(TICKET_CATEGORIES);
  const parsed = value.filter(
    (v): v is TicketCategoryCode => typeof v === 'string' && known.has(v),
  );
  // An empty list is a legitimate configuration — a school that restricts
  // nothing — but a list that was *entirely* garbage is a typo, and
  // silently restricting nothing is how a complaint about a teacher ends
  // up readable in the staff room.
  return value.length > 0 && parsed.length === 0 ? fallback : parsed;
}

function asSlaMap(value: unknown): Record<TicketPriorityCode, number> {
  const map = { ...DEFAULT_SLA_HOURS };
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of Object.keys(map) as TicketPriorityCode[]) {
      const raw = (value as Record<string, unknown>)[key];
      const hours = Number(raw);
      // A zero-hour SLA marks every ticket breached the instant it is
      // raised, which is the same as having no SLA at all but noisier.
      if (Number.isFinite(hours) && hours > 0) {
        map[key] = Math.min(24 * 90, Math.max(1, Math.round(hours)));
      }
    }
  }
  return map;
}

/** `HH:mm` → minutes past midnight; anything malformed falls back. */
function minutesOfDay(value: unknown, fallback: number): number {
  if (typeof value !== 'string') return fallback;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return fallback;
  return hours * 60 + minutes;
}

/**
 * One typed read of the whole `community.*` group — the M12/M13/M19/M20/
 * M21/M22/M23/M24/M25/M26/M27 settings-service precedent.
 *
 * Every malformed value falls back to the registry default rather than
 * throwing. A hand-edited `ticket_sla_hours` of `"soon"` must not stop the
 * office taking complaints; escalating on the roadmap's 72 hours and
 * having somebody notice the setting is stale is strictly better than an
 * inbox that will not open.
 */
@Injectable()
export class CommunitySettingsService {
  constructor(private readonly settings: SettingsService) {}

  async load(schoolId: string): Promise<CommunityConfig> {
    const read = <T>(key: string) => this.settings.getValue<T>(schoolId, key);

    const [
      enabled,
      ticketPattern,
      allowAnonymous,
      allowPublic,
      slaHours,
      reopenDays,
      sensitiveCategories,
      notifyRequester,
      satisfactionPrompt,
      publicHourlyLimit,
      gatePassRequired,
      gatePassPattern,
      autoCheckoutTime,
      photoRequired,
      maxPassDays,
      appointmentNotify,
      alumniPublicRegistration,
      alumniDirectoryPublic,
      alumniMinBatchYear,
      alumniAutoApprove,
      alumniNotifyOnApproval,
      donationReceiptPattern,
      donationPostToAccounts,
      donationThankYou,
    ] = await Promise.all([
      read<boolean>('community.enabled'),
      read<string>('community.ticket_no_pattern'),
      read<boolean>('community.ticket_allow_anonymous'),
      read<boolean>('community.ticket_allow_public'),
      read<unknown>('community.ticket_sla_hours'),
      read<number>('community.ticket_reopen_days'),
      read<unknown>('community.ticket_sensitive_categories'),
      read<boolean>('community.ticket_notify_requester'),
      read<boolean>('community.ticket_satisfaction_prompt'),
      read<number>('community.ticket_public_hourly_limit'),
      read<boolean>('community.visitor_gate_pass_required'),
      read<string>('community.visitor_gate_pass_pattern'),
      read<string>('community.visitor_auto_checkout_time'),
      read<boolean>('community.visitor_photo_required'),
      read<number>('community.visitor_max_pass_days'),
      read<boolean>('community.appointment_notify'),
      read<boolean>('community.alumni_public_registration'),
      read<boolean>('community.alumni_directory_public'),
      read<number>('community.alumni_min_batch_year'),
      read<boolean>('community.alumni_auto_approve'),
      read<boolean>('community.alumni_notify_on_approval'),
      read<string>('community.donation_receipt_pattern'),
      read<boolean>('community.donation_post_to_accounts'),
      read<boolean>('community.donation_thank_you'),
    ]);

    return {
      enabled: enabled !== false,
      ticketNoPattern: text(ticketPattern, 'CMP-{YY}-{SEQ5}'),
      ticketAllowAnonymous: allowAnonymous !== false,
      ticketAllowPublic: allowPublic !== false,
      ticketSlaHours: asSlaMap(slaHours),
      ticketReopenDays: clamp(reopenDays, 0, 365, 7),
      ticketSensitiveCategories: asCategoryList(sensitiveCategories, [
        'TEACHER',
      ]),
      ticketNotifyRequester: notifyRequester !== false,
      ticketSatisfactionPrompt: satisfactionPrompt !== false,
      ticketPublicHourlyLimit: clamp(publicHourlyLimit, 1, 100, 5),
      visitorGatePassRequired: gatePassRequired === true,
      visitorGatePassPattern: text(gatePassPattern, 'GP-{YY}{MM}-{SEQ5}'),
      visitorAutoCheckoutMinutes: minutesOfDay(autoCheckoutTime, 21 * 60),
      visitorPhotoRequired: photoRequired === true,
      visitorMaxPassDays: clamp(maxPassDays, 1, 365, 7),
      appointmentNotify: appointmentNotify !== false,
      alumniPublicRegistration: alumniPublicRegistration !== false,
      alumniDirectoryPublic: alumniDirectoryPublic !== false,
      alumniMinBatchYear: clamp(alumniMinBatchYear, 1800, 2200, 1950),
      // Defaults OFF, and stays off unless a school explicitly says so:
      // an approval queue whose purpose is roadmap §8's identity conflict
      // cannot auto-approve.
      alumniAutoApprove: alumniAutoApprove === true,
      alumniNotifyOnApproval: alumniNotifyOnApproval !== false,
      donationReceiptPattern: text(donationReceiptPattern, 'DON-{YY}-{SEQ5}'),
      donationPostToAccounts: donationPostToAccounts !== false,
      donationThankYou: donationThankYou !== false,
    };
  }
}
