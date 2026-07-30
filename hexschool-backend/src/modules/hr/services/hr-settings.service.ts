import { Injectable } from '@nestjs/common';
import { PaymentMode } from '../../../common/constants';
import { SettingsService } from '../../school/services/settings.service';
import { DeductionBase, RoundingMode } from '../calc/payroll.engine';
import { DEFAULT_TAX_SLABS, TaxSlab, normalizeSlabs } from '../calc/tax.engine';

export type WorkingDaysSource = 'CALENDAR' | 'FIXED';
export type PfBaseSetting = 'BASIC' | 'COMPONENTS';

export interface HrConfig {
  enabled: boolean;
  absentDeductionEnabled: boolean;
  absentDeductionBase: DeductionBase;
  unpaidLeaveDeductionEnabled: boolean;
  workingDaysSource: WorkingDaysSource;
  fixedWorkingDays: number;
  pfEnabled: boolean;
  pfEmployeePercent: number;
  pfEmployerPercent: number;
  pfBase: PfBaseSetting;
  pfMinServiceMonths: number;
  taxEnabled: boolean;
  taxSlabs: TaxSlab[];
  taxRebatePercent: number;
  rounding: RoundingMode;
  defaultPaymentMode: PaymentMode;
  festivalBonusMinServiceMonths: number;
  festivalBonusProrate: boolean;
  payslipSms: boolean;
  autoPostAccounting: boolean;
  leaveCarryForward: boolean;
  leaveRequiresBalance: boolean;
  reportFooter: string;
}

/**
 * One typed read of the whole `payroll.*` group — the M12/M13/M19/M20
 * settings-service precedent, so no service reaches into
 * `SettingsService` key by key and no engine has to remember a default.
 *
 * Every malformed value falls back to the registry default rather than
 * throwing. A hand-edited tax-slab JSON must not be able to take payroll
 * generation down; a wrong-but-sane number is visible and fixable, a 500
 * in the middle of a run is neither.
 */
@Injectable()
export class HrSettingsService {
  constructor(private readonly settings: SettingsService) {}

  async load(schoolId: string): Promise<HrConfig> {
    const [
      enabled,
      absentDeductionEnabled,
      absentDeductionBase,
      unpaidLeaveDeductionEnabled,
      workingDaysSource,
      fixedWorkingDays,
      pfEnabled,
      pfEmployeePercent,
      pfEmployerPercent,
      pfBase,
      pfMinServiceMonths,
      taxEnabled,
      taxSlabs,
      taxRebatePercent,
      rounding,
      defaultPaymentMode,
      festivalBonusMinServiceMonths,
      festivalBonusProrate,
      payslipSms,
      autoPostAccounting,
      leaveCarryForward,
      leaveRequiresBalance,
      reportFooter,
    ] = await Promise.all([
      this.settings.getValue<boolean>(schoolId, 'payroll.enabled'),
      this.settings.getValue<boolean>(
        schoolId,
        'payroll.absent_deduction_enabled',
      ),
      this.settings.getValue<string>(schoolId, 'payroll.absent_deduction_base'),
      this.settings.getValue<boolean>(
        schoolId,
        'payroll.unpaid_leave_deduction_enabled',
      ),
      this.settings.getValue<string>(schoolId, 'payroll.working_days_source'),
      this.settings.getValue<number>(schoolId, 'payroll.fixed_working_days'),
      this.settings.getValue<boolean>(schoolId, 'payroll.pf_enabled'),
      this.settings.getValue<number>(schoolId, 'payroll.pf_employee_percent'),
      this.settings.getValue<number>(schoolId, 'payroll.pf_employer_percent'),
      this.settings.getValue<string>(schoolId, 'payroll.pf_base'),
      this.settings.getValue<number>(schoolId, 'payroll.pf_min_service_months'),
      this.settings.getValue<boolean>(schoolId, 'payroll.tax_enabled'),
      this.settings.getValue<unknown>(schoolId, 'payroll.tax_slabs'),
      this.settings.getValue<number>(schoolId, 'payroll.tax_rebate_percent'),
      this.settings.getValue<string>(schoolId, 'payroll.rounding'),
      this.settings.getValue<string>(schoolId, 'payroll.default_payment_mode'),
      this.settings.getValue<number>(
        schoolId,
        'payroll.festival_bonus_min_service_months',
      ),
      this.settings.getValue<boolean>(
        schoolId,
        'payroll.festival_bonus_prorate',
      ),
      this.settings.getValue<boolean>(schoolId, 'payroll.payslip_sms'),
      this.settings.getValue<boolean>(schoolId, 'payroll.auto_post_accounting'),
      this.settings.getValue<boolean>(
        schoolId,
        'payroll.leave_year_carry_forward',
      ),
      this.settings.getValue<boolean>(
        schoolId,
        'payroll.leave_requires_balance',
      ),
      this.settings.getValue<string>(schoolId, 'payroll.report_footer'),
    ]);

    return {
      enabled: enabled !== false,
      absentDeductionEnabled: absentDeductionEnabled !== false,
      absentDeductionBase:
        String(absentDeductionBase ?? '').toUpperCase() === 'GROSS'
          ? 'GROSS'
          : 'BASIC',
      unpaidLeaveDeductionEnabled: unpaidLeaveDeductionEnabled !== false,
      workingDaysSource:
        String(workingDaysSource ?? '').toUpperCase() === 'FIXED'
          ? 'FIXED'
          : 'CALENDAR',
      fixedWorkingDays: clamp(fixedWorkingDays, 1, 31, 26),
      pfEnabled: pfEnabled === true,
      pfEmployeePercent: clamp(pfEmployeePercent, 0, 100, 10),
      pfEmployerPercent: clamp(pfEmployerPercent, 0, 100, 10),
      pfBase:
        String(pfBase ?? '').toUpperCase() === 'COMPONENTS'
          ? 'COMPONENTS'
          : 'BASIC',
      pfMinServiceMonths: clamp(pfMinServiceMonths, 0, 600, 12),
      taxEnabled: taxEnabled === true,
      taxSlabs: parseSlabs(taxSlabs),
      taxRebatePercent: clamp(taxRebatePercent, 0, 100, 0),
      rounding: parseRounding(rounding),
      defaultPaymentMode: parsePaymentMode(defaultPaymentMode),
      festivalBonusMinServiceMonths: clamp(
        festivalBonusMinServiceMonths,
        0,
        600,
        6,
      ),
      festivalBonusProrate: festivalBonusProrate === true,
      payslipSms: payslipSms !== false,
      autoPostAccounting: autoPostAccounting !== false,
      leaveCarryForward: leaveCarryForward !== false,
      leaveRequiresBalance: leaveRequiresBalance !== false,
      reportFooter: reportFooter ?? '',
    };
  }
}

function clamp(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseRounding(value: unknown): RoundingMode {
  const upper = typeof value === 'string' ? value.toUpperCase() : '';
  return upper === 'NONE' ||
    upper === 'NEAREST_5' ||
    upper === 'NEAREST_10' ||
    upper === 'NEAREST_1'
    ? upper
    : 'NEAREST_1';
}

function parsePaymentMode(value: unknown): PaymentMode {
  const upper = typeof value === 'string' ? value.toUpperCase() : '';
  return upper === 'CASH' || upper === 'MOBILE_BANKING'
    ? upper
    : PaymentMode.BANK;
}

/**
 * The slab table, normalized. `normalizeSlabs` also *adds* the
 * open-ended band when a hand-edited config forgot one — without it the
 * highest earners would silently pay no tax above the last ceiling, which
 * reads like a working configuration and is not one.
 */
function parseSlabs(value: unknown): TaxSlab[] {
  if (!Array.isArray(value)) return [...DEFAULT_TAX_SLABS];
  const rows = value
    .filter(
      (row): row is Record<string, unknown> =>
        typeof row === 'object' && row !== null,
    )
    .map((row) => ({
      upTo:
        row.upTo === null || row.upTo === undefined ? null : Number(row.upTo),
      rate: Number(row.rate),
    }));
  return normalizeSlabs(rows);
}
