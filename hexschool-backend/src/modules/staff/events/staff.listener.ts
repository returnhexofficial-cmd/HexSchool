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
import { STAFF_EVENTS } from './staff.events';
import type {
  StaffCreatedEvent,
  StaffStatusChangedEvent,
} from './staff.events';

const DEACTIVATING = new Set<StaffStatus>([
  StaffStatus.RESIGNED,
  StaffStatus.TERMINATED,
]);

/**
 * Out-of-band staff effects: welcome credentials on creation, and the
 * RESIGNED/TERMINATED → user-deactivation cascade (roadmap M07 §6 — the
 * account dies with the employment; every session is revoked at once).
 */
@Injectable()
export class StaffListener {
  private readonly logger = new Logger(StaffListener.name);

  constructor(
    private readonly users: UsersRepository,
    private readonly refreshTokens: RefreshTokensRepository,
    @InjectQueue(NOTIFICATIONS_QUEUE)
    private readonly notifications: Queue<NotificationJob>,
  ) {}

  @OnEvent(STAFF_EVENTS.CREATED)
  async onCreated(event: StaffCreatedEvent): Promise<void> {
    const text =
      `HexSchool: welcome ${event.name}! Your staff account is ready. ` +
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
          subject: 'Welcome to HexSchool — your staff account',
          text,
        });
      }
    } catch (err) {
      this.logger.error(
        'Failed to enqueue staff welcome message',
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  @OnEvent(STAFF_EVENTS.STATUS_CHANGED)
  async onStatusChanged(event: StaffStatusChangedEvent): Promise<void> {
    try {
      if (DEACTIVATING.has(event.to)) {
        // Sessions die first, THEN the status flips — the e2e polls the
        // status as the "cascade finished" signal.
        await this.refreshTokens.revokeAllForUser(event.userId);
        await this.users.update(event.userId, {
          status: UserStatus.INACTIVE,
        });
      } else if (
        DEACTIVATING.has(event.from) &&
        event.to === StaffStatus.ACTIVE
      ) {
        // Rehired/correction: bring the account back with the profile.
        await this.users.update(event.userId, { status: UserStatus.ACTIVE });
      }
    } catch (err) {
      this.logger.error(
        `Failed to cascade staff status ${event.from}→${event.to} to user ${event.userId}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
