import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AdmissionTest } from '@prisma/client';
import { AdmissionApplicationStatus } from '../../../common/constants';
import { parseDate } from '../../academic/calendar/date.util';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { EnterTestMarksDto, ScheduleTestsDto } from '../dto';
import {
  ADMISSION_EVENTS,
  ApplicationStatusChangedEvent,
} from '../events/admission.events';
import { AdmissionApplicationsRepository } from '../repositories/admission-applications.repository';
import { AdmissionCyclesRepository } from '../repositories/admission-cycles.repository';
import { AdmissionTestsRepository } from '../repositories/admission-tests.repository';

/** Statuses eligible to be moved onto the test roster when a slot is
 *  scheduled (paid/waived is enforced by the merit-pool query later —
 *  here we require it up front so admit cards only exist for payers). */
const SCHEDULABLE = [
  AdmissionApplicationStatus.SUBMITTED,
  AdmissionApplicationStatus.UNDER_REVIEW,
];

/** Marks may be (re-)entered while the pipeline hasn't passed merit. */
const MARKABLE: AdmissionApplicationStatus[] = [
  AdmissionApplicationStatus.TEST_SCHEDULED,
  AdmissionApplicationStatus.PASSED,
  AdmissionApplicationStatus.FAILED,
];

/**
 * Admission test scheduling + bulk mark entry (roadmap M10 §4).
 * Scheduling a class slot moves that class's paid applications to
 * TEST_SCHEDULED (admit cards become downloadable); mark entry grades
 * against the slot's pass mark → PASSED/FAILED.
 */
@Injectable()
export class AdmissionTestsService {
  constructor(
    private readonly cycles: AdmissionCyclesRepository,
    private readonly tests: AdmissionTestsRepository,
    private readonly applications: AdmissionApplicationsRepository,
    private readonly auditContext: AuditContextService,
    private readonly events: EventEmitter2,
  ) {}

  async schedule(
    cycleId: string,
    dto: ScheduleTestsDto,
    actor: AccessTokenPayload,
  ): Promise<AdmissionTest[]> {
    const cycle = await this.cycles.findDetail(cycleId, actor.schoolId);
    if (!cycle) {
      throw new BadRequestException(`Admission cycle ${cycleId} not found`);
    }
    if (!cycle.testRequired) {
      throw new ConflictException(
        'This cycle does not require an admission test',
      );
    }
    const offered = new Set(cycle.classes.map((c) => c.classId));
    for (const slot of dto.tests) {
      if (!offered.has(slot.classId)) {
        throw new BadRequestException(
          `Class ${slot.classId} is not offered by this cycle`,
        );
      }
      if (slot.passMarks > slot.totalMarks) {
        throw new BadRequestException('passMarks cannot exceed totalMarks');
      }
    }

    const moved: Array<{
      id: string;
      applicationNo: string;
      phone: string;
      from: AdmissionApplicationStatus;
      note: string;
    }> = [];

    await this.cycles.withTransaction(async (tx) => {
      await this.tests.upsertMany(
        cycleId,
        dto.tests.map((slot) => ({
          classId: slot.classId,
          testDate: parseDate(slot.testDate),
          venue: slot.venue,
          totalMarks: slot.totalMarks,
          passMarks: slot.passMarks,
          actorId: actor.sub,
        })),
        tx,
      );

      // Paid applications of each scheduled class join the test roster.
      for (const slot of dto.tests) {
        const eligible = await this.applications.findForMerit(
          cycleId,
          slot.classId,
          SCHEDULABLE,
        );
        for (const app of eligible) {
          await this.applications.update(
            app.id,
            {
              status: AdmissionApplicationStatus.TEST_SCHEDULED,
              updatedBy: actor.sub,
            },
            tx,
          );
          moved.push({
            id: app.id,
            applicationNo: app.applicationNo,
            phone: app.phone,
            from: app.status,
            note: `Test on ${slot.testDate}${slot.venue ? ` at ${slot.venue}` : ''}.`,
          });
        }
      }
    });

    for (const app of moved) {
      this.events.emit(ADMISSION_EVENTS.STATUS_CHANGED, {
        applicationId: app.id,
        applicationNo: app.applicationNo,
        schoolId: actor.schoolId,
        phone: app.phone,
        from: app.from,
        to: AdmissionApplicationStatus.TEST_SCHEDULED,
        note: app.note,
      } satisfies ApplicationStatusChangedEvent);
    }

    this.auditContext.set({
      entityType: 'AdmissionCycle',
      entityId: cycleId,
      newValues: {
        testsScheduled: dto.tests.length,
        applicationsMoved: moved.length,
      },
    });
    return this.tests.findForCycle(cycleId);
  }

  async enterMarks(
    cycleId: string,
    dto: EnterTestMarksDto,
    actor: AccessTokenPayload,
  ): Promise<{ graded: number; passed: number; failed: number }> {
    const cycle = await this.cycles.findDetail(cycleId, actor.schoolId);
    if (!cycle) {
      throw new BadRequestException(`Admission cycle ${cycleId} not found`);
    }

    let passed = 0;
    let failed = 0;
    await this.cycles.withTransaction(async (tx) => {
      for (const entry of dto.entries) {
        const app = await this.applications.findDetail(
          entry.applicationId,
          actor.schoolId,
        );
        if (!app || app.cycleId !== cycleId) {
          throw new BadRequestException(
            `Application ${entry.applicationId} does not belong to this cycle`,
          );
        }
        if (!MARKABLE.includes(app.status)) {
          throw new ConflictException(
            `${app.applicationNo} is ${app.status} — marks are locked`,
          );
        }
        const test = await this.tests.findForCycleClass(cycleId, app.classId);
        if (!test) {
          throw new BadRequestException(
            `No test scheduled for ${app.class.name} in this cycle`,
          );
        }
        if (entry.marks > test.totalMarks) {
          throw new BadRequestException(
            `${app.applicationNo}: marks ${entry.marks} exceed total ${test.totalMarks}`,
          );
        }

        const result =
          entry.marks >= test.passMarks
            ? AdmissionApplicationStatus.PASSED
            : AdmissionApplicationStatus.FAILED;
        if (result === AdmissionApplicationStatus.PASSED) passed += 1;
        else failed += 1;

        await this.applications.update(
          app.id,
          { testMarks: entry.marks, status: result, updatedBy: actor.sub },
          tx,
        );
      }
    });

    this.auditContext.set({
      entityType: 'AdmissionCycle',
      entityId: cycleId,
      newValues: { marksEntered: dto.entries.length, passed, failed },
    });
    return { graded: dto.entries.length, passed, failed };
  }
}
