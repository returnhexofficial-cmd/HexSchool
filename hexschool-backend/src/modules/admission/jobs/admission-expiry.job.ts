import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AdmissionApplicationStatus } from '../../../common/constants';
import {
  ADMISSION_EVENTS,
  ApplicationStatusChangedEvent,
} from '../events/admission.events';
import { AdmissionApplicationsRepository } from '../repositories/admission-applications.repository';
import { MeritListService } from '../services/merit-list.service';

/**
 * Selection-deadline enforcement (roadmap M10 §6): SELECTED applications
 * past their admission deadline auto-EXPIRE and the freed seats promote
 * the next waitlisted candidates per (cycle, class).
 */
@Injectable()
export class AdmissionExpiryJob {
  private readonly logger = new Logger(AdmissionExpiryJob.name);

  constructor(
    private readonly applications: AdmissionApplicationsRepository,
    private readonly merit: MeritListService,
    private readonly events: EventEmitter2,
  ) {}

  /** Hourly on the hour (deadline granularity is days). */
  @Cron('0 * * * *')
  async expireOverdueSelections(): Promise<number> {
    const overdue = await this.applications.findExpiredSelections(new Date());
    if (overdue.length === 0) return 0;

    for (const app of overdue) {
      await this.applications.update(app.id, {
        status: AdmissionApplicationStatus.EXPIRED,
      });
      this.events.emit(ADMISSION_EVENTS.STATUS_CHANGED, {
        applicationId: app.id,
        applicationNo: app.applicationNo,
        schoolId: app.schoolId,
        phone: app.phone,
        from: AdmissionApplicationStatus.SELECTED,
        to: AdmissionApplicationStatus.EXPIRED,
      } satisfies ApplicationStatusChangedEvent);
    }

    // Promote per (cycle, class) — one candidate per freed seat.
    const freed = new Map<string, number>();
    for (const app of overdue) {
      const key = `${app.cycleId}:${app.classId}`;
      freed.set(key, (freed.get(key) ?? 0) + 1);
    }
    for (const [key, count] of freed) {
      const [cycleId, classId] = key.split(':');
      await this.merit.promoteNext(cycleId, classId, count, null);
    }

    this.logger.log(
      `Admission expiry: ${overdue.length} selection(s) expired, waitlist promoted`,
    );
    return overdue.length;
  }
}
