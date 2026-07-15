import { Injectable } from '@nestjs/common';
import { Prisma, RefreshToken } from '@prisma/client';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { DeviceInfo } from '../interfaces/device-info.interface';

/**
 * Log-style table (no audit columns / soft delete), so this repository
 * stands alone instead of extending BaseRepository — same access rules
 * apply: services never touch Prisma directly.
 */
@Injectable()
export class RefreshTokensRepository {
  constructor(private readonly prisma: PrismaService) {}

  async issue(data: {
    userId: string;
    tokenHash: string;
    deviceInfo: DeviceInfo;
    expiresAt: Date;
  }): Promise<RefreshToken> {
    return this.prisma.refreshToken.create({
      data: { ...data, deviceInfo: data.deviceInfo as Prisma.InputJsonValue },
    });
  }

  async findByHash(tokenHash: string): Promise<RefreshToken | null> {
    return this.prisma.refreshToken.findUnique({ where: { tokenHash } });
  }

  async findActiveById(
    id: string,
    userId: string,
  ): Promise<RefreshToken | null> {
    return this.prisma.refreshToken.findFirst({
      where: {
        id,
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
  }

  /** Rotation: mark `oldId` revoked and chained to its replacement. */
  async markReplaced(oldId: string, newId: string): Promise<void> {
    await this.prisma.refreshToken.update({
      where: { id: oldId },
      data: { revokedAt: new Date(), replacedById: newId },
    });
  }

  async revoke(id: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Theft response / logout-all / deactivation: kill every live session. */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Active devices for the session-manager UI. */
  async listActiveForUser(userId: string): Promise<RefreshToken[]> {
    return this.prisma.refreshToken.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Nightly purge: tokens expired more than `olderThanDays` days ago. */
  async purgeExpired(olderThanDays: number): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const result = await this.prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: cutoff } },
    });
    return result.count;
  }
}
