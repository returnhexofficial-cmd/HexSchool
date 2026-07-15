import { Injectable } from '@nestjs/common';
import { LoginEvent } from '@prisma/client';
import { PrismaService } from '../../../database/prisma/prisma.service';

/** Append-only writer — no update/delete methods by design. */
@Injectable()
export class LoginActivitiesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async record(data: {
    userId: string;
    event: LoginEvent;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<void> {
    await this.prisma.loginActivity.create({
      data: {
        userId: data.userId,
        event: data.event,
        ip: data.ip ?? null,
        userAgent: data.userAgent?.slice(0, 512) ?? null,
      },
    });
  }
}
