import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { OnEvent } from '@nestjs/event-emitter';
import type { Queue } from 'bullmq';
import { StaffStatus, UserStatus } from '../../../common/constants';
import {
  NOTIFICATIONS_QUEUE,
  NotificationJob,
} from '../../../queues/queues.constants';
import { RefreshTokensRepository } from '../../auth/repositories/refresh-tokens.repository';
import { UsersRepository } from '../../auth/repositories/users.repository';
import { TEACHER_EVENTS } from './teacher.events';
import type {
  TeacherCreatedEvent,
  TeacherStatusChangedEvent,
} from './teacher.events';

const DEACTIVATING = new Set<StaffStatus>([
  StaffStatus.RESIGNED,
  StaffStatus.TERMINATED,
]);

/**
 * Out-of-band teacher effects, mirroring StaffListener: welcome
 * credentials on creation; RESIGNED/TERMINATED → user deactivation
 * (sessions revoked FIRST, then the status flips — same cascade order
 * convention as M07). leave.approved has no listener here — M12
 * attendance subscribes to it.
 */
@Injectable()
export class TeacherListener {
  private readonly logger = new Logger(TeacherListener.name);

  constructor(
    private readonly users: UsersRepository,
    private readonly refreshTokens: RefreshTokensRepository,
    @InjectQueue(NOTIFICATIONS_QUEUE)
    private readonly notifications: Queue<NotificationJob>,
  ) {}

  @OnEvent(TEACHER_EVENTS.CREATED)
  async onCreated(event: TeacherCreatedEvent): Promise<void> {
    const text =
      `HexSchool: welcome ${event.name}! Your teacher account is ready. ` +
      `Employee ID: ${event.employeeId}. Sign in with ${
        event.phone ?? event.email
      } and temporary password ${event.tempPassword} — you must change it on first login.`;
    try {
      if (event.phone) {
        await this.notifications.add('sms', {
          type: 'sms',
          to: event.phone,
          text,
        });
      } else if (event.email) {
        await this.notifications.add('email', {
          type: 'email',
          to: event.email,
          subject: 'Welcome to HexSchool — your teacher account',
          text,
        });
      }
    } catch (err) {
      this.logger.error(
        'Failed to enqueue teacher welcome message',
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  @OnEvent(TEACHER_EVENTS.STATUS_CHANGED)
  async onStatusChanged(event: TeacherStatusChangedEvent): Promise<void> {
    try {
      if (DEACTIVATING.has(event.to)) {
        await this.refreshTokens.revokeAllForUser(event.userId);
        await this.users.update(event.userId, {
          status: UserStatus.INACTIVE,
        });
      } else if (
        DEACTIVATING.has(event.from) &&
        event.to === StaffStatus.ACTIVE
      ) {
        await this.users.update(event.userId, { status: UserStatus.ACTIVE });
      }
    } catch (err) {
      this.logger.error(
        `Failed to cascade teacher status ${event.from}→${event.to} to user ${event.userId}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
