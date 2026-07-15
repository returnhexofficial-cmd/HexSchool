import { Injectable } from '@nestjs/common';
import { OtpCode, OtpPurpose } from '@prisma/client';
import { PrismaService } from '../../../database/prisma/prisma.service';

@Injectable()
export class OtpCodesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createCode(data: {
    userId: string | null;
    identifier: string;
    codeHash: string;
    purpose: OtpPurpose;
    expiresAt: Date;
  }): Promise<OtpCode> {
    return this.prisma.otpCode.create({ data });
  }

  /** Most recent unconsumed code for identifier+purpose (cooldown + verify). */
  async findLatestActive(
    identifier: string,
    purpose: OtpPurpose,
  ): Promise<OtpCode | null> {
    return this.prisma.otpCode.findFirst({
      where: { identifier, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** New code supersedes any outstanding ones for the same target. */
  async consumeActive(identifier: string, purpose: OtpPurpose): Promise<void> {
    await this.prisma.otpCode.updateMany({
      where: { identifier, purpose, consumedAt: null },
      data: { consumedAt: new Date() },
    });
  }

  async incrementAttempts(id: string): Promise<number> {
    const otp = await this.prisma.otpCode.update({
      where: { id },
      data: { attempts: { increment: 1 } },
      select: { attempts: true },
    });
    return otp.attempts;
  }

  async markConsumed(id: string): Promise<void> {
    await this.prisma.otpCode.update({
      where: { id },
      data: { consumedAt: new Date() },
    });
  }

  /** Nightly purge: codes created more than `olderThanDays` days ago. */
  async purgeOld(olderThanDays: number): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const result = await this.prisma.otpCode.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return result.count;
  }
}
