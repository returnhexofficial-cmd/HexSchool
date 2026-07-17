import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { OnEvent } from '@nestjs/event-emitter';
import type { Queue } from 'bullmq';
import { StudentStatus, UserStatus } from '../../../common/constants';
import {
  NOTIFICATIONS_QUEUE,
  NotificationJob,
} from '../../../queues/queues.constants';
import { RefreshTokensRepository } from '../../auth/repositories/refresh-tokens.repository';
import { UsersRepository } from '../../auth/repositories/users.repository';
import { EXIT_STATUSES } from '../services/students.service';
import { STUDENT_EVENTS } from './student.events';
import type {
  PortalAccountCreatedEvent,
  StudentStatusChangedEvent,
} from './student.events';

/**
 * Out-of-band student effects: portal credentials on (lazy) account
 * creation, and the exit-status cascade — TRANSFERRED/GRADUATED/DROPPED
 * (and SUSPENDED) deactivate the portal account, sessions revoked FIRST
 * (M07 cascade-order convention). Guardian accounts are left alone: a
 * guardian may have other enrolled children.
 */
@Injectable()
export class StudentListener {
  private readonly logger = new Logger(StudentListener.name);

  constructor(
    private readonly users: UsersRepository,
    private readonly refreshTokens: RefreshTokensRepository,
    @InjectQueue(NOTIFICATIONS_QUEUE)
    private readonly notifications: Queue<NotificationJob>,
  ) {}

  @OnEvent(STUDENT_EVENTS.ACCOUNT_CREATED)
  @OnEvent(STUDENT_EVENTS.GUARDIAN_ACCOUNT_CREATED)
  async onAccountCreated(event: PortalAccountCreatedEvent): Promise<void> {
    const portal = event.holder === 'student' ? 'student' : 'parent';
    const text =
      `HexSchool: welcome ${event.name}! Your ${portal} portal account is ready. ` +
      `Sign in with ${event.phone ?? event.email} and temporary password ` +
      `${event.tempPassword} — you must change it on first login.`;
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
          subject: `Welcome to HexSchool — your ${portal} portal account`,
          text,
        });
      }
    } catch (err) {
      this.logger.error(
        'Failed to enqueue portal welcome message',
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  @OnEvent(STUDENT_EVENTS.STATUS_CHANGED)
  async onStatusChanged(event: StudentStatusChangedEvent): Promise<void> {
    if (!event.userId) return; // no portal account to cascade to
    try {
      if (
        EXIT_STATUSES.has(event.to) ||
        event.to === StudentStatus.SUSPENDED ||
        event.to === StudentStatus.INACTIVE
      ) {
        await this.refreshTokens.revokeAllForUser(event.userId);
        await this.users.update(event.userId, {
          status:
            event.to === StudentStatus.SUSPENDED
              ? UserStatus.SUSPENDED
              : UserStatus.INACTIVE,
        });
      } else if (event.to === StudentStatus.ACTIVE) {
        await this.users.update(event.userId, { status: UserStatus.ACTIVE });
      }
    } catch (err) {
      this.logger.error(
        `Failed to cascade student status ${event.from}→${event.to} to user ${event.userId}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
