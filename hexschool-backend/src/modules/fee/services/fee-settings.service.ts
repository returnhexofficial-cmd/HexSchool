import { Injectable } from '@nestjs/common';
import { SettingsService } from '../../school/services/settings.service';
import { FineConfig } from '../calc/fine.engine';

export interface FeeConfig {
  /** Day of month a monthly invoice falls due when the head says nothing. */
  dueDayOfMonth: number;
  fine: FineConfig;
  /** Prorate a mid-month joiner's recurring heads. */
  prorateEnabled: boolean;
  /** Count the joining day itself as billable. */
  prorateIncludeJoinDay: boolean;
  /** Allow taking more money than an invoice asks for (needs a permission). */
  allowOverpayment: boolean;
  invoicePrefix: string;
  paymentPrefix: string;
  receiptFooter: string;
  /** Queue a receipt SMS when a payment succeeds (real once M17 lands). */
  receiptSmsEnabled: boolean;
  receiptSmsTemplate: string;
  duesSmsTemplate: string;
  /** Gateways run against sandbox endpoints. */
  sandbox: boolean;
}

/**
 * One typed read of every `fees.*` and `payment.*` knob (the M12–M15
 * settings-service pattern), so no service reads `SettingsService`
 * directly and they all inherit the M04 Redis cache.
 */
@Injectable()
export class FeeSettingsService {
  constructor(private readonly settings: SettingsService) {}

  async load(schoolId: string): Promise<FeeConfig> {
    const get = <T>(key: string) => this.settings.getValue<T>(schoolId, key);
    const [
      dueDay,
      graceDays,
      flatPerMonth,
      percentPerMonth,
      cap,
      prorate,
      includeJoinDay,
      allowOverpayment,
      invoicePrefix,
      paymentPrefix,
      receiptFooter,
      receiptSms,
      receiptTemplate,
      duesTemplate,
      sandbox,
    ] = await Promise.all([
      get<number>('fees.due_day_of_month'),
      get<number>('fees.fine_grace_days'),
      get<number>('fees.fine_flat_per_month'),
      get<number>('fees.late_fee_percent'),
      get<number>('fees.fine_cap'),
      get<boolean>('fees.prorate_enabled'),
      get<boolean>('fees.prorate_include_join_day'),
      get<boolean>('fees.allow_overpayment'),
      get<string>('fees.invoice_no_pattern'),
      get<string>('fees.payment_no_pattern'),
      get<string>('fees.receipt_footer'),
      get<boolean>('fees.receipt_sms_enabled'),
      get<string>('fees.receipt_sms_template'),
      get<string>('fees.dues_sms_template'),
      get<boolean>('payment.sandbox'),
    ]);

    return {
      dueDayOfMonth: bounded(dueDay, 1, 28, 10),
      fine: {
        graceDays: nonNegative(graceDays, 0),
        flatPerMonth: nonNegative(flatPerMonth, 0),
        percentPerMonth: nonNegative(percentPerMonth, 0),
        cap: nonNegative(cap, 0),
      },
      prorateEnabled: prorate !== false,
      prorateIncludeJoinDay: includeJoinDay !== false,
      // Fails CLOSED: a misconfigured value must not silently permit
      // taking more money than an invoice asks for.
      allowOverpayment: allowOverpayment === true,
      invoicePrefix: text(invoicePrefix, 'INV-{YY}{MM}-{SEQ6}'),
      paymentPrefix: text(paymentPrefix, 'RCP-{YY}{MM}-{SEQ6}'),
      receiptFooter: text(receiptFooter, ''),
      receiptSmsEnabled: receiptSms === true,
      receiptSmsTemplate: text(
        receiptTemplate,
        '{school}: received {amount} BDT against {invoice} for {name}. Thank you.',
      ),
      duesSmsTemplate: text(
        duesTemplate,
        '{school}: {name} has {amount} BDT outstanding. Please pay by {due}.',
      ),
      // Sandbox unless explicitly turned off — never accidentally live.
      sandbox: sandbox !== false,
    };
  }
}

function nonNegative(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function bounded(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback;
}
