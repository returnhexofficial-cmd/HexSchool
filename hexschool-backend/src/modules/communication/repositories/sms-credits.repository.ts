import { Injectable } from '@nestjs/common';
import { Prisma, SmsCredit, SmsCreditType } from '@prisma/client';
import { PrismaClientLike } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

/**
 * The SMS-credit ledger (append-only, no BaseRepository — it is a log with
 * a running balance, like `audit_logs`/`login_activities`). A movement is
 * appended with `balance_after` computed from the previous row under a row
 * lock, so concurrent consumes cannot both read the same balance.
 */
@Injectable()
export class SmsCreditsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Current balance = the latest row's `balance_after` (0 if none). */
  async balance(schoolId: string, tx?: PrismaClientLike): Promise<number> {
    const client = (tx ?? this.prisma) as PrismaService;
    const last = await client.smsCredit.findFirst({
      where: { schoolId },
      orderBy: { createdAt: 'desc' },
    });
    return last?.balanceAfter ?? 0;
  }

  async ledger(schoolId: string, take = 100): Promise<SmsCredit[]> {
    return this.prisma.smsCredit.findMany({
      where: { schoolId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  /**
   * Append a movement inside a transaction, locking the school's rows so
   * the balance read + write is atomic. Returns the new balance.
   * `qty` is signed (+PURCHASE, −CONSUME); the caller ensures a CONSUME
   * does not overdraw (the CHECK is the backstop).
   */
  async append(
    schoolId: string,
    type: SmsCreditType,
    qty: number,
    ref: string | null,
    createdBy: string | null,
  ): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      // Serialize concurrent movements for this school. $executeRaw (not
      // $queryRaw) because the lock function returns void, which Prisma
      // cannot deserialize as a result column.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'sms_credit:' + schoolId}))`;
      const current = await this.balance(schoolId, tx);
      const balanceAfter = current + qty;
      await tx.smsCredit.create({
        data: {
          schoolId,
          type,
          qty,
          balanceAfter,
          ref: ref ?? undefined,
          createdBy: createdBy ?? undefined,
        } satisfies Prisma.SmsCreditUncheckedCreateInput,
      });
      return balanceAfter;
    });
  }
}
