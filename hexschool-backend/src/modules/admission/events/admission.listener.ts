import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AdmissionApplicationStatus } from '../../../common/constants';
import { NotificationService } from '../../communication/services/notification.service';
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
 * Applicant-facing SMS per status (roadmap M10 §4). **Retro-wired to
 * M17**: each message goes through `NotificationService.send` (coded
 * `ADMISSION_STATUS`), so admission SMS is now real, credit-accounted and
 * in the delivery log — not the old log-only stub. The status prose is
 * specific per transition, so it is passed as a `rawBody`; a school that
 * wants a uniform template can still author the `ADMISSION_STATUS` one.
 *
 * Delivery is fire-and-forget (M07 convention: it must never block or fail
 * the mutation).
 */
@Injectable()
export class AdmissionListener {
  private readonly logger = new Logger(AdmissionListener.name);

  constructor(private readonly notifications: NotificationService) {}

  @OnEvent(ADMISSION_EVENTS.APPLICATION_SUBMITTED)
  handleSubmitted(event: ApplicationSubmittedEvent): void {
    const feeLine =
      event.fee > 0
        ? ` Application fee BDT ${event.fee.toFixed(2)} is due — pay at the school office to confirm.`
        : '';
    this.sendSms(
      event.schoolId,
      event.phone,
      event.applicationNo,
      `Admission: application ${event.applicationNo} for ${event.applicantName} (${event.className}) received.${feeLine} Track with your application number + phone.`,
    );
  }

  @OnEvent(ADMISSION_EVENTS.STATUS_CHANGED)
  handleStatusChanged(event: ApplicationStatusChangedEvent): void {
    const body = STATUS_MESSAGES[event.to];
    if (!body) return;
    this.sendSms(
      event.schoolId,
      event.phone,
      event.applicationNo,
      `Admission ${event.applicationNo}: ${body}${event.note ? ` ${event.note}` : ''}`,
    );
  }

  private sendSms(
    schoolId: string,
    to: string,
    applicationNo: string,
    text: string,
  ): void {
    void this.notifications
      .send({
        schoolId,
        code: 'ADMISSION_STATUS',
        channel: 'SMS',
        recipient: { type: 'RAW', destination: to },
        rawBody: text,
        vars: { application_no: applicationNo },
      })
      .catch((err: Error) =>
        this.logger.error(`Failed to send admission SMS: ${err.message}`),
      );
  }
}
