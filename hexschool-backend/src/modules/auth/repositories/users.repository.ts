import { Injectable } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { BaseRepository } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

@Injectable()
export class UsersRepository extends BaseRepository<
  User,
  Prisma.UserWhereInput,
  Prisma.UserUncheckedCreateInput,
  Prisma.UserUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.user, 'User');
  }

  /** Lookup by normalized login identifier (email OR BD phone). */
  async findByIdentifier(identifier: {
    email?: string;
    phone?: string;
  }): Promise<User | null> {
    if (identifier.email) return this.findOne({ email: identifier.email });
    if (identifier.phone) return this.findOne({ phone: identifier.phone });
    return null;
  }

  /** Atomic failed-attempt bump; returns the new counter value. */
  async incrementFailedAttempts(id: string): Promise<number> {
    const user = await this.prisma.user.update({
      where: { id },
      data: { failedLoginAttempts: { increment: 1 } },
      select: { failedLoginAttempts: true },
    });
    return user.failedLoginAttempts;
  }

  async resetLoginCounters(id: string): Promise<void> {
    await this.update(id, {
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
    });
  }

  async lock(id: string, until: Date): Promise<void> {
    await this.update(id, { lockedUntil: until });
  }

  async setPassword(id: string, passwordHash: string): Promise<void> {
    await this.update(id, {
      passwordHash,
      passwordChangedAt: new Date(),
      mustChangePassword: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
  }
}
