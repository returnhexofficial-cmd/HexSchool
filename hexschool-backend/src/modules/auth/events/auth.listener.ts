import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { LoginEvent } from '../../../common/constants';
import {
  NOTIFICATIONS_QUEUE,
  NotificationJob,
} from '../../../queues/queues.constants';
import { LoginActivitiesRepository } from '../repositories/login-activities.repository';
import { AUTH_EVENTS } from './auth.events';
import type { AuthActivityEvent } from './auth.events';

/**
 * Writes the append-only login_activities log for every auth event and
 * sends security alerts (lockout / token theft) to the user's phone.
 * Runs out-of-band: a logging failure must never fail the auth request.
 */
@Injectable()
export class AuthListener {
  private readonly logger = new Logger(AuthListener.name);

  constructor(
    private readonly loginActivities: LoginActivitiesRepository,
    @InjectQueue(NOTIFICATIONS_QUEUE)
    private readonly notifications: Queue<NotificationJob>,
  ) {}

  @OnEvent(AUTH_EVENTS.LOGGED_IN)
  @OnEvent(AUTH_EVENTS.LOGIN_FAILED)
  @OnEvent(AUTH_EVENTS.LOGGED_OUT)
  @OnEvent(AUTH_EVENTS.REFRESHED)
  @OnEvent(AUTH_EVENTS.LOCKED)
  @OnEvent(AUTH_EVENTS.TOKEN_REUSE)
  @OnEvent(AUTH_EVENTS.PASSWORD_CHANGED)
  async handle(payload: AuthActivityEvent): Promise<void> {
    try {
      await this.loginActivities.record(payload);
    } catch (err) {
      this.logger.error(
        `Failed to record login activity (${payload.event})`,
        err instanceof Error ? err.stack : String(err),
      );
    }

    if (
      (payload.event === LoginEvent.LOCKED ||
        payload.event === LoginEvent.TOKEN_REUSE) &&
      payload.alertPhone
    ) {
      const text =
        payload.event === LoginEvent.LOCKED
          ? 'HexSchool: your account was locked for 15 minutes after 5 failed sign-in attempts. Not you? Reset your password.'
          : 'HexSchool: suspicious session activity detected — all devices were signed out. Please sign in again and change your password.';
      try {
        await this.notifications.add('sms', {
          type: 'sms',
          to: payload.alertPhone,
          text,
        });
      } catch (err) {
        this.logger.error(
          'Failed to enqueue security alert SMS',
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
  }
}
