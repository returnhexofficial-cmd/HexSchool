import { Injectable } from '@nestjs/common';
import {
  LibraryMemberType,
  NotificationChannel,
} from '../../../common/constants';
import { SettingsService } from '../../school/services/settings.service';
import type { IssuePolicy } from '../calc/circulation.engine';
import type { FinePolicy } from '../calc/fine.engine';

export interface LibraryConfig {
  enabled: boolean;
  accessionPattern: string;
  cardNoPattern: string;
  /** Loan length and borrowing cap, per member type. */
  loanDays: Record<LibraryMemberType, number>;
  maxBooks: Record<LibraryMemberType, number>;
  maxRenews: number;
  fine: FinePolicy;
  issue: IssuePolicy;
  reservationDays: number;
  autoProvisionMembers: boolean;
  overdueNoticeEnabled: boolean;
  overdueNoticeChannel: NotificationChannel;
  /** 0 = Sunday … 6 = Saturday. */
  overdueNoticeWeekday: number;
  overdueRepeatDays: number;
  opacEnabled: boolean;
  opacAllowReservation: boolean;
  autoPostAccounting: boolean;
  clearanceBlockExit: boolean;
}

function clamp(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Same, but keeping the fractional part — multipliers and money. */
function clampFloat(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function pattern(value: unknown, fallback: string): string {
  const s = typeof value === 'string' ? value.trim() : '';
  // A pattern with no sequence token would hand every copy the same
  // accession number and the unique index would refuse the second one —
  // at the desk, mid-cataloguing. Better to ignore the edit.
  return s.length > 0 && /\{SEQ\d+\}/.test(s) ? s : fallback;
}

/**
 * One typed read of the whole `library.*` group — the M12/M13/M19/M20/
 * M21/M22 settings-service precedent.
 *
 * Every malformed value falls back to the registry default instead of
 * throwing. A hand-edited `fine_per_day` of `"two"` must not be able to
 * take the return desk down on a Saturday morning; charging the default
 * and letting somebody notice is strictly better than refusing to accept
 * a book back.
 */
@Injectable()
export class LibrarySettingsService {
  constructor(private readonly settings: SettingsService) {}

  async load(schoolId: string): Promise<LibraryConfig> {
    const read = <T>(key: string) => this.settings.getValue<T>(schoolId, key);

    const [
      enabled,
      accessionPattern,
      cardNoPattern,
      loanStudent,
      loanTeacher,
      loanStaff,
      maxStudent,
      maxTeacher,
      maxStaff,
      maxRenews,
      finePerDay,
      graceDays,
      maxFine,
      holidayAware,
      fineBlock,
      blockWhenOverdue,
      blockDuplicate,
      lostMultiplier,
      damagedMultiplier,
      defaultPrice,
      reservationDays,
      autoProvision,
      overdueEnabled,
      overdueChannel,
      overdueWeekday,
      overdueRepeat,
      opacEnabled,
      opacReservation,
      autoPost,
      clearanceBlock,
    ] = await Promise.all([
      read<boolean>('library.enabled'),
      read<string>('library.accession_pattern'),
      read<string>('library.card_no_pattern'),
      read<number>('library.loan_days_student'),
      read<number>('library.loan_days_teacher'),
      read<number>('library.loan_days_staff'),
      read<number>('library.max_books_student'),
      read<number>('library.max_books_teacher'),
      read<number>('library.max_books_staff'),
      read<number>('library.max_renews'),
      read<number>('library.fine_per_day'),
      read<number>('library.fine_grace_days'),
      read<number>('library.max_fine_per_book'),
      read<boolean>('library.fine_holiday_aware'),
      read<number>('library.fine_block_threshold'),
      read<boolean>('library.block_when_overdue'),
      read<boolean>('library.block_duplicate_title'),
      read<number>('library.lost_price_multiplier'),
      read<number>('library.damaged_price_multiplier'),
      read<number>('library.default_book_price'),
      read<number>('library.reservation_days'),
      read<boolean>('library.auto_provision_members'),
      read<boolean>('library.overdue_notice_enabled'),
      read<string>('library.overdue_notice_channel'),
      read<number>('library.overdue_notice_weekday'),
      read<number>('library.overdue_repeat_days'),
      read<boolean>('library.opac_enabled'),
      read<boolean>('library.opac_allow_reservation'),
      read<boolean>('library.auto_post_accounting'),
      read<boolean>('library.clearance_block_exit'),
    ]);

    return {
      enabled: enabled !== false,
      accessionPattern: pattern(accessionPattern, 'ACC-{YY}-{SEQ5}'),
      cardNoPattern: pattern(cardNoPattern, 'LIB-{YY}-{SEQ5}'),
      loanDays: {
        [LibraryMemberType.STUDENT]: clamp(loanStudent, 1, 365, 7),
        [LibraryMemberType.TEACHER]: clamp(loanTeacher, 1, 365, 14),
        [LibraryMemberType.STAFF]: clamp(loanStaff, 1, 365, 14),
      },
      maxBooks: {
        // The DB CHECK pins `max_books` to 1–100, so the seed value must
        // land inside it or enrolling a member would 500.
        [LibraryMemberType.STUDENT]: clamp(maxStudent, 1, 100, 2),
        [LibraryMemberType.TEACHER]: clamp(maxTeacher, 1, 100, 5),
        [LibraryMemberType.STAFF]: clamp(maxStaff, 1, 100, 3),
      },
      maxRenews: clamp(maxRenews, 0, 20, 2),
      fine: {
        perDay: clampFloat(finePerDay, 0, 10_000, 2),
        graceDays: clamp(graceDays, 0, 365, 0),
        maxPerBook: clampFloat(maxFine, 0, 1_000_000, 500),
        holidayAware: holidayAware !== false,
        lostMultiplier: clampFloat(lostMultiplier, 0, 20, 1.5),
        damagedMultiplier: clampFloat(damagedMultiplier, 0, 20, 0.5),
        defaultBookPrice: clampFloat(defaultPrice, 0, 1_000_000, 300),
      },
      issue: {
        enabled: enabled !== false,
        fineBlockThreshold: clampFloat(fineBlock, 0, 1_000_000, 100),
        blockWhenOverdue: blockWhenOverdue !== false,
        blockDuplicateTitle: blockDuplicate !== false,
      },
      reservationDays: clamp(reservationDays, 1, 60, 3),
      autoProvisionMembers: autoProvision !== false,
      overdueNoticeEnabled: overdueEnabled !== false,
      // Only SMS opts out of the free default; anything else is IN_APP.
      overdueNoticeChannel:
        String(overdueChannel ?? '').toUpperCase() === 'SMS'
          ? NotificationChannel.SMS
          : NotificationChannel.IN_APP,
      overdueNoticeWeekday: clamp(overdueWeekday, 0, 6, 6),
      overdueRepeatDays: clamp(overdueRepeat, 1, 365, 7),
      opacEnabled: opacEnabled !== false,
      opacAllowReservation: opacReservation !== false,
      autoPostAccounting: autoPost !== false,
      clearanceBlockExit: clearanceBlock === true,
    };
  }

  /** Loan length for a member type, already clamped. */
  loanDaysFor(config: LibraryConfig, type: LibraryMemberType): number {
    return config.loanDays[type];
  }
}
