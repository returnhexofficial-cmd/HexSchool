import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AdmissionApplication } from '@prisma/client';
import {
  AdmissionApplicationStatus,
  AdmissionCycleStatus,
} from '../../../common/constants';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { SettingsService } from '../../school/services/settings.service';
import {
  ADMISSION_EVENTS,
  ApplicationStatusChangedEvent,
} from '../events/admission.events';
import {
  AdmissionApplicationsRepository,
  ApplicationWithRelations,
} from '../repositories/admission-applications.repository';
import { AdmissionCyclesRepository } from '../repositories/admission-cycles.repository';

/** Candidate fields the ranking needs (kept minimal for testability —
 *  Prisma Decimal satisfies the toString-able shape). */
export interface MeritCandidate {
  testMarks: number | { toString(): string } | null;
  previousGpa: number | { toString(): string } | null;
  dob: Date;
}

/**
 * Merit ordering (roadmap M10 §4): test marks desc → previous GPA desc →
 * dob asc (older applicant wins the tie). Null marks/GPA sort last.
 * Exported pure so the unit suite golden-tests it.
 */
export function compareForMerit(a: MeritCandidate, b: MeritCandidate): number {
  const marksA = a.testMarks === null ? -1 : Number(a.testMarks);
  const marksB = b.testMarks === null ? -1 : Number(b.testMarks);
  if (marksA !== marksB) return marksB - marksA;

  const gpaA = a.previousGpa === null ? -1 : Number(a.previousGpa);
  const gpaB = b.previousGpa === null ? -1 : Number(b.previousGpa);
  if (gpaA !== gpaB) return gpaB - gpaA;

  return a.dob.getTime() - b.dob.getTime();
}

export interface MeritGenerationResult {
  classId: string;
  seats: number;
  alreadyAdmitted: number;
  selected: number;
  waitlisted: number;
  regenerated: boolean;
}

/**
 * Merit & waiting lists (roadmap M10). Generation runs per (cycle,
 * class) on a CLOSED cycle ("test marks locked"); regeneration voids the
 * previous list (SELECTED/WAITLISTED reset into the pool — ADMITTED rows
 * are untouched and consume seats). SELECTED applicants get an admission
 * deadline; the expiry job EXPIREs overdue ones and promotes the
 * waitlist.
 */
@Injectable()
export class MeritListService {
  constructor(
    private readonly cycles: AdmissionCyclesRepository,
    private readonly applications: AdmissionApplicationsRepository,
    private readonly settings: SettingsService,
    private readonly auditContext: AuditContextService,
    private readonly events: EventEmitter2,
  ) {}

  async generate(
    cycleId: string,
    classId: string,
    actor: AccessTokenPayload,
  ): Promise<MeritGenerationResult> {
    const cycle = await this.cycles.findDetail(cycleId, actor.schoolId);
    if (!cycle) {
      throw new BadRequestException(`Admission cycle ${cycleId} not found`);
    }
    if (
      cycle.status !== AdmissionCycleStatus.CLOSED &&
      cycle.status !== AdmissionCycleStatus.COMPLETED
    ) {
      throw new ConflictException(
        'Close the cycle first — merit lists are generated after applications (and test marks) are locked',
      );
    }
    const cycleClass = cycle.classes.find((c) => c.classId === classId);
    if (!cycleClass) {
      throw new BadRequestException('Class is not offered by this cycle');
    }

    // Pool: PASSED candidates when a test is required, otherwise every
    // paid application still in review — PLUS the previous list when
    // regenerating (SELECTED/WAITLISTED reset; ADMITTED keeps its seat).
    const baseStatuses = cycle.testRequired
      ? [AdmissionApplicationStatus.PASSED]
      : [
          AdmissionApplicationStatus.SUBMITTED,
          AdmissionApplicationStatus.UNDER_REVIEW,
        ];
    const previous = await this.applications.findForMerit(cycleId, classId, [
      AdmissionApplicationStatus.SELECTED,
      AdmissionApplicationStatus.WAITLISTED,
    ]);
    const pool = [
      ...(await this.applications.findForMerit(cycleId, classId, baseStatuses)),
      ...previous,
    ];
    if (pool.length === 0) {
      throw new BadRequestException(
        'No eligible applications to rank for this class',
      );
    }

    const alreadyAdmitted = await this.applications.countAdmitted(
      cycleId,
      classId,
    );
    const seatsLeft = Math.max(0, cycleClass.seats - alreadyAdmitted);
    const deadline = await this.selectionDeadline(actor.schoolId);

    const ranked = [...pool].sort(compareForMerit);
    let selected = 0;
    let waitlisted = 0;

    await this.applications.withTransaction(async (tx) => {
      for (let i = 0; i < ranked.length; i += 1) {
        const app = ranked[i];
        const isSelected = i < seatsLeft;
        if (isSelected) selected += 1;
        else waitlisted += 1;
        await this.applications.update(
          app.id,
          {
            meritPosition: i + 1,
            status: isSelected
              ? AdmissionApplicationStatus.SELECTED
              : AdmissionApplicationStatus.WAITLISTED,
            admissionDeadline: isSelected ? deadline : null,
            updatedBy: actor.sub,
          },
          tx,
        );
      }
    });

    for (let i = 0; i < ranked.length; i += 1) {
      const app = ranked[i];
      const to =
        i < seatsLeft
          ? AdmissionApplicationStatus.SELECTED
          : AdmissionApplicationStatus.WAITLISTED;
      if (app.status === to) continue; // regeneration kept the outcome
      this.events.emit(ADMISSION_EVENTS.STATUS_CHANGED, {
        applicationId: app.id,
        applicationNo: app.applicationNo,
        schoolId: actor.schoolId,
        phone: app.phone,
        from: app.status,
        to,
        note:
          to === AdmissionApplicationStatus.SELECTED
            ? `Complete admission by ${deadline.toISOString().slice(0, 10)}.`
            : `Waiting list position ${i + 1 - seatsLeft}.`,
      } satisfies ApplicationStatusChangedEvent);
    }

    this.auditContext.set({
      entityType: 'AdmissionCycle',
      entityId: cycleId,
      newValues: {
        action: 'MERIT_LIST_GENERATED',
        classId,
        ranked: ranked.length,
        selected,
        waitlisted,
        regenerated: previous.length > 0,
      },
    });

    return {
      classId,
      seats: cycleClass.seats,
      alreadyAdmitted,
      selected,
      waitlisted,
      regenerated: previous.length > 0,
    };
  }

  async meritList(
    cycleId: string,
    classId: string,
    schoolId: string,
  ): Promise<ApplicationWithRelations[]> {
    await this.assertCycle(cycleId, schoolId);
    return this.applications.findMeritList(cycleId, classId, [
      AdmissionApplicationStatus.SELECTED,
      AdmissionApplicationStatus.ADMITTED,
      AdmissionApplicationStatus.EXPIRED,
    ]);
  }

  async waitingList(
    cycleId: string,
    classId: string,
    schoolId: string,
  ): Promise<ApplicationWithRelations[]> {
    await this.assertCycle(cycleId, schoolId);
    return this.applications.findMeritList(cycleId, classId, [
      AdmissionApplicationStatus.WAITLISTED,
    ]);
  }

  /** Promote the next N waitlisted candidates ("seats increased after
   *  merit publish" — roadmap M10 §8; also used on cancel/expire). */
  async promoteNext(
    cycleId: string,
    classId: string,
    count: number,
    actor: AccessTokenPayload | null,
  ): Promise<AdmissionApplication[]> {
    const schoolId = actor?.schoolId;
    if (schoolId) await this.assertCycle(cycleId, schoolId);

    const candidates = await this.applications.findNextWaitlisted(
      cycleId,
      classId,
      count,
    );
    if (candidates.length === 0) return [];

    const deadline = await this.selectionDeadline(
      schoolId ?? candidates[0].schoolId,
    );
    await this.applications.withTransaction(async (tx) => {
      for (const app of candidates) {
        await this.applications.update(
          app.id,
          {
            status: AdmissionApplicationStatus.SELECTED,
            admissionDeadline: deadline,
            updatedBy: actor?.sub,
          },
          tx,
        );
      }
    });

    for (const app of candidates) {
      this.events.emit(ADMISSION_EVENTS.STATUS_CHANGED, {
        applicationId: app.id,
        applicationNo: app.applicationNo,
        schoolId: app.schoolId,
        phone: app.phone,
        from: AdmissionApplicationStatus.WAITLISTED,
        to: AdmissionApplicationStatus.SELECTED,
        note: `Promoted from the waiting list. Complete admission by ${deadline.toISOString().slice(0, 10)}.`,
      } satisfies ApplicationStatusChangedEvent);
    }

    if (actor) {
      this.auditContext.set({
        entityType: 'AdmissionCycle',
        entityId: cycleId,
        newValues: {
          action: 'WAITLIST_PROMOTED',
          classId,
          promoted: candidates.map((c) => c.applicationNo),
        },
      });
    }
    return candidates;
  }

  // ── internals ─────────────────────────────────────────────────────

  private async assertCycle(cycleId: string, schoolId: string): Promise<void> {
    const cycle = await this.cycles.findById(cycleId, schoolId);
    if (!cycle) {
      throw new BadRequestException(`Admission cycle ${cycleId} not found`);
    }
  }

  private async selectionDeadline(schoolId: string): Promise<Date> {
    const days = await this.settings.getValue<number>(
      schoolId,
      'academic.admission_selection_deadline_days',
    );
    return new Date(Date.now() + (days || 7) * 24 * 3600 * 1000);
  }
}
