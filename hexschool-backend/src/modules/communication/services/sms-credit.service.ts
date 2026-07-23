import { Injectable, Logger } from '@nestjs/common';
import { SmsCredit } from '@prisma/client';
import { SmsCreditsRepository } from '../repositories/sms-credits.repository';

export interface ConsumeResult {
  /** The school meters SMS (has ever purchased credit). */
  metered: boolean;
  /** There was enough credit for the requested parts. */
  ok: boolean;
  /** Balance after the movement (unchanged when not metered). */
  balance: number;
}

/**
 * SMS-credit accounting (roadmap M17 §4 "Credit accounting: decrement per
 * SMS part … low-balance alert to admin").
 *
 * A school that never bought credit is **unmetered** — sends are not
 * blocked and no ledger row is written (small deployments on a flat
 * provider plan). Once any PURCHASE exists the school is metered: a send
 * consumes parts and is refused when the balance cannot cover them, with
 * the running balance pinned non-negative by `chk_sms_credits_balance`.
 */
@Injectable()
export class SmsCreditService {
  private readonly logger = new Logger(SmsCreditService.name);

  constructor(private readonly credits: SmsCreditsRepository) {}

  async balance(schoolId: string): Promise<number> {
    return this.credits.balance(schoolId);
  }

  async ledger(schoolId: string, take = 100): Promise<SmsCredit[]> {
    return this.credits.ledger(schoolId, take);
  }

  /** Whether any credit movement has ever been recorded for the school. */
  async isMetered(schoolId: string): Promise<boolean> {
    const rows = await this.credits.ledger(schoolId, 1);
    return rows.length > 0;
  }

  async purchase(
    schoolId: string,
    qty: number,
    ref: string | null,
    by: string | null,
  ): Promise<number> {
    return this.credits.append(schoolId, 'PURCHASE', Math.abs(qty), ref, by);
  }

  /** A signed manual correction (can be negative, never below zero). */
  async adjust(
    schoolId: string,
    qty: number,
    ref: string | null,
    by: string | null,
  ): Promise<number> {
    return this.credits.append(schoolId, 'ADJUST', qty, ref, by);
  }

  /**
   * Consume `parts` for a sent SMS. On an unmetered school this is a
   * no-op that reports OK. On a metered school it appends a CONSUME
   * movement; if the balance cannot cover the parts it reports `ok:false`
   * (the caller then fails the send before it goes out).
   */
  async consume(
    schoolId: string,
    parts: number,
    ref: string | null,
  ): Promise<ConsumeResult> {
    if (!(await this.isMetered(schoolId))) {
      return { metered: false, ok: true, balance: 0 };
    }
    const current = await this.credits.balance(schoolId);
    if (current < parts) {
      return { metered: true, ok: false, balance: current };
    }
    const balance = await this.credits.append(
      schoolId,
      'CONSUME',
      -parts,
      ref,
      null,
    );
    return { metered: true, ok: true, balance };
  }
}
