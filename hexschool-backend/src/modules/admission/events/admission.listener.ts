import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { Queue } from 'bullmq';
import { AdmissionApplicationStatus } from '../../../common/constants';
import {
  NOTIFICATIONS_QUEUE,
  NotificationJob,
} from '../../../queues/queues.constants';
import { ADMISSION_EVENTS } from './admission.events';
import type {
  ApplicationStatusChangedEvent,
  ApplicationSubmittedEvent,
} from './admission.events';

/** Applicant-facing SMS per status (roadmap M10 §4: notify at every
 *  status change). Log-only until Module 17 wires the real gateway. */
const STATUS_MESSAGES: Partial<Record<AdmissionApplicationStatus, string>> = {
  [AdmissionApplicationStatus.SUBMITTED]:
    'Your application is submitted and under processing.',
  [AdmissionApplicationStatus.UNDER_REVIEW]:
    'Your application is now under review.',
  [AdmissionApplicationStatus.TEST_SCHEDULED]:
    'Your admission test has been scheduled. Download your admit card from the admission portal.',
  [AdmissionApplicationStatus.PASSED]:
    'Congratulations — you passed the admission test. Await the merit list.',
  [AdmissionApplicationStatus.FAILED]:
    'Unfortunately you did not pass the admission test.',
  [AdmissionApplicationStatus.SELECTED]:
    'Congratulations — you have been SELECTED for admission.',
  [AdmissionApplicationStatus.WAITLISTED]:
    'You are on the admission waiting list.',
  [AdmissionApplicationStatus.ADMITTED]:
    'Admission confirmed. Welcome to the school!',
  [AdmissionApplicationStatus.REJECTED]:
    'We are sorry — your application was not accepted.',
  [AdmissionApplicationStatus.CANCELLED]:
    'Your admission application has been cancelled.',
  [AdmissionApplicationStatus.EXPIRED]:
    'Your admission selection expired (deadline passed).',
};

/**
 * Fire-and-forget SMS enqueues (M07 convention: delivery must never
 * block or fail the mutation — Redis being down buffers `add` forever).
 */
@Injectable()
export class AdmissionListener {
  private readonly logger = new Logger(AdmissionListener.name);

  constructor(
    @InjectQueue(NOTIFICATIONS_QUEUE)
    private readonly notifications: Queue<NotificationJob>,
  ) {}

  @OnEvent(ADMISSION_EVENTS.APPLICATION_SUBMITTED)
  handleSubmitted(event: ApplicationSubmittedEvent): void {
    const feeLine =
      event.fee > 0
        ? ` Application fee BDT ${event.fee.toFixed(2)} is due — pay at the school office to confirm.`
        : '';
    this.enqueueSms(
      event.phone,
      `HexSchool admission: application ${event.applicationNo} for ${event.applicantName} (${event.className}) received.${feeLine} Track with your application number + phone.`,
    );
  }

  @OnEvent(ADMISSION_EVENTS.STATUS_CHANGED)
  handleStatusChanged(event: ApplicationStatusChangedEvent): void {
    const body = STATUS_MESSAGES[event.to];
    if (!body) return;
    this.enqueueSms(
      event.phone,
      `HexSchool admission ${event.applicationNo}: ${body}${event.note ? ` ${event.note}` : ''}`,
    );
  }

  private enqueueSms(to: string, text: string): void {
    void this.notifications
      .add('sms', { type: 'sms', to, text })
      .catch((err: Error) =>
        this.logger.error(`Failed to enqueue admission SMS: ${err.message}`),
      );
  }
}
