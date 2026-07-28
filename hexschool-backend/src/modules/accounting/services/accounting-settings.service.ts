import { Injectable } from '@nestjs/common';
import { SettingsService } from '../../school/services/settings.service';

export type CashNegativeMode = 'HARD' | 'SOFT' | 'OFF';

export interface AccountingConfig {
  enabled: boolean;
  autoPostFees: boolean;
  /** Whether an auto-posted voucher lands POSTED or waits as a DRAFT. */
  autoPostAsDraft: boolean;
  voucherPatterns: Record<'DEBIT' | 'CREDIT' | 'JOURNAL' | 'CONTRA', string>;
  futureDays: number;
  cashNegative: CashNegativeMode;
  backdateAfterClose: boolean;
  requireNarration: boolean;
  fiscalYearStartMonth: number;
  reportFooter: string;
}

const PATTERN_KEYS = {
  DEBIT: 'accounting.voucher_no_pattern_debit',
  CREDIT: 'accounting.voucher_no_pattern_credit',
  JOURNAL: 'accounting.voucher_no_pattern_journal',
  CONTRA: 'accounting.voucher_no_pattern_contra',
} as const;

/**
 * One typed read of the whole `accounting.*` group (the M12/M13/M19
 * settings-service precedent), so no service reaches into
 * `SettingsService` key by key and no report has to remember a default.
 */
@Injectable()
export class AccountingSettingsService {
  constructor(private readonly settings: SettingsService) {}

  async load(schoolId: string): Promise<AccountingConfig> {
    const [
      enabled,
      autoPostFees,
      autoPostStatus,
      debit,
      credit,
      journal,
      contra,
      futureDays,
      cashNegative,
      backdateAfterClose,
      requireNarration,
      fiscalYearStartMonth,
      reportFooter,
    ] = await Promise.all([
      this.settings.getValue<boolean>(schoolId, 'accounting.enabled'),
      this.settings.getValue<boolean>(schoolId, 'accounting.auto_post_fees'),
      this.settings.getValue<string>(schoolId, 'accounting.auto_post_status'),
      this.settings.getValue<string>(schoolId, PATTERN_KEYS.DEBIT),
      this.settings.getValue<string>(schoolId, PATTERN_KEYS.CREDIT),
      this.settings.getValue<string>(schoolId, PATTERN_KEYS.JOURNAL),
      this.settings.getValue<string>(schoolId, PATTERN_KEYS.CONTRA),
      this.settings.getValue<number>(
        schoolId,
        'accounting.future_voucher_days',
      ),
      this.settings.getValue<string>(
        schoolId,
        'accounting.cash_negative_check',
      ),
      this.settings.getValue<boolean>(
        schoolId,
        'accounting.backdate_after_close',
      ),
      this.settings.getValue<boolean>(schoolId, 'accounting.require_narration'),
      this.settings.getValue<number>(
        schoolId,
        'accounting.fiscal_year_start_month',
      ),
      this.settings.getValue<string>(schoolId, 'accounting.report_footer'),
    ]);

    return {
      enabled: enabled !== false,
      autoPostFees: autoPostFees !== false,
      autoPostAsDraft:
        String(autoPostStatus ?? 'POSTED').toUpperCase() === 'DRAFT',
      voucherPatterns: {
        DEBIT: debit || 'DV-{YY}-{SEQ5}',
        CREDIT: credit || 'CV-{YY}-{SEQ5}',
        JOURNAL: journal || 'JV-{YY}-{SEQ5}',
        CONTRA: contra || 'CN-{YY}-{SEQ5}',
      },
      futureDays: numberOr(futureDays, 0),
      cashNegative: mode(cashNegative),
      backdateAfterClose: backdateAfterClose !== false,
      requireNarration: requireNarration !== false,
      fiscalYearStartMonth: clampMonth(fiscalYearStartMonth),
      reportFooter: reportFooter ?? '',
    };
  }
}

function numberOr(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function clampMonth(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(12, Math.max(1, Math.trunc(parsed)));
}

/** A malformed value falls back to the registry default, never a 500. */
function mode(value: unknown): CashNegativeMode {
  const upper = typeof value === 'string' ? value.toUpperCase() : '';
  return upper === 'HARD' || upper === 'OFF' ? upper : 'SOFT';
}
