import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  AdmissionApplicationStatus,
  AdmissionPaymentStatus,
  GuardianRelation,
} from '../../../common/constants';
import { PaginatedResult } from '../../../common/dto/paginated.dto';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { AddressDto } from '../../staff/dto/staff.dto';
import { StudentsRepository } from '../../student/repositories/students.repository';
import {
  CreateStudentResult,
  StudentsService,
} from '../../student/services/students.service';
import {
  ApplicationQueryDto,
  RecordPaymentDto,
  SetPaymentStatusDto,
  UpdateApplicationStatusDto,
} from '../dto';
import {
  ADMISSION_EVENTS,
  ApplicationStatusChangedEvent,
} from '../events/admission.events';
import {
  AdmissionApplicationsRepository,
  ApplicationWithRelations,
} from '../repositories/admission-applications.repository';
import { AdmissionCyclesRepository } from '../repositories/admission-cycles.repository';
import { MeritListService } from './merit-list.service';

/** Guardian snapshot shape stored on the application (public.dto). */
interface GuardianSnapshot {
  name: string;
  nameBn?: string;
  relation: GuardianRelation;
  phone: string;
  email?: string;
  occupation?: string;
}

/**
 * Manual review transitions (roadmap M10 §4). Engine-owned statuses
 * (TEST_SCHEDULED, PASSED/FAILED, SELECTED/WAITLISTED, ADMITTED,
 * EXPIRED) are produced by their dedicated endpoints/jobs only.
 */
const MANUAL_TRANSITIONS: Partial<
  Record<AdmissionApplicationStatus, AdmissionApplicationStatus[]>
> = {
  [AdmissionApplicationStatus.SUBMITTED]: [
    AdmissionApplicationStatus.UNDER_REVIEW,
    AdmissionApplicationStatus.REJECTED,
    AdmissionApplicationStatus.CANCELLED,
  ],
  [AdmissionApplicationStatus.PAYMENT_PENDING]: [
    AdmissionApplicationStatus.CANCELLED,
  ],
  [AdmissionApplicationStatus.UNDER_REVIEW]: [
    AdmissionApplicationStatus.REJECTED,
    AdmissionApplicationStatus.CANCELLED,
  ],
  [AdmissionApplicationStatus.TEST_SCHEDULED]: [
    AdmissionApplicationStatus.CANCELLED,
  ],
  [AdmissionApplicationStatus.SELECTED]: [AdmissionApplicationStatus.CANCELLED],
  [AdmissionApplicationStatus.WAITLISTED]: [
    AdmissionApplicationStatus.CANCELLED,
  ],
};

export function canTransitionManually(
  from: AdmissionApplicationStatus,
  to: AdmissionApplicationStatus,
): boolean {
  return MANUAL_TRANSITIONS[from]?.includes(to) ?? false;
}

export interface AdmitResult extends CreateStudentResult {
  /** True when the application was already ADMITTED (idempotent re-call). */
  alreadyAdmitted: boolean;
}

/**
 * Application desk (roadmap M10): listing, manual review transitions,
 * offline fee payments (online gateway wiring arrives with M16), and the
 * approval → student conversion reusing the M09 registration path
 * (guardian dedup + gap-free UID included).
 */
@Injectable()
export class AdmissionApplicationsService {
  constructor(
    private readonly applications: AdmissionApplicationsRepository,
    private readonly cycles: AdmissionCyclesRepository,
    private readonly merit: MeritListService,
    private readonly studentsService: StudentsService,
    private readonly students: StudentsRepository,
    private readonly auditContext: AuditContextService,
    private readonly events: EventEmitter2,
  ) {}

  async list(
    query: ApplicationQueryDto,
    schoolId: string,
  ): Promise<PaginatedResult<ApplicationWithRelations>> {
    return this.applications.paginateList(query, schoolId);
  }

  async getDetail(
    id: string,
    schoolId: string,
  ): Promise<ApplicationWithRelations> {
    const app = await this.applications.findDetail(id, schoolId);
    if (!app) throw new NotFoundException(`Application ${id} not found`);
    return app;
  }

  async updateStatus(
    id: string,
    dto: UpdateApplicationStatusDto,
    actor: AccessTokenPayload,
  ): Promise<ApplicationWithRelations> {
    const app = await this.getDetail(id, actor.schoolId);
    if (app.status === dto.status) {
      throw new BadRequestException(`Application is already ${dto.status}`);
    }
    if (!canTransitionManually(app.status, dto.status)) {
      throw new ConflictException(
        `Cannot move a ${app.status} application to ${dto.status} manually`,
      );
    }

    await this.applications.update(id, {
      status: dto.status,
      updatedBy: actor.sub,
    });

    // A cancelled selection frees its seat — the next waitlisted
    // candidate is promoted automatically (roadmap M10 §4).
    if (
      app.status === AdmissionApplicationStatus.SELECTED &&
      dto.status === AdmissionApplicationStatus.CANCELLED
    ) {
      await this.merit.promoteNext(app.cycleId, app.classId, 1, actor);
    }

    this.events.emit(ADMISSION_EVENTS.STATUS_CHANGED, {
      applicationId: id,
      applicationNo: app.applicationNo,
      schoolId: actor.schoolId,
      phone: app.phone,
      from: app.status,
      to: dto.status,
      note: dto.reason,
    } satisfies ApplicationStatusChangedEvent);

    this.auditContext.set({
      entityType: 'AdmissionApplication',
      entityId: id,
      oldValues: { status: app.status },
      newValues: { status: dto.status, reason: dto.reason },
    });
    return this.getDetail(id, actor.schoolId);
  }

  /** Offline fee payment (cash/bank/mobile money at the office). */
  async recordPayment(
    id: string,
    dto: RecordPaymentDto,
    actor: AccessTokenPayload,
  ): Promise<ApplicationWithRelations> {
    const app = await this.getDetail(id, actor.schoolId);
    if (app.paymentStatus === AdmissionPaymentStatus.PAID) {
      throw new ConflictException('Application fee is already paid');
    }
    const fee = await this.applicationFee(app);
    const amount = dto.amount ?? fee;

    const fromStatus = app.status;
    const toStatus =
      app.status === AdmissionApplicationStatus.PAYMENT_PENDING
        ? AdmissionApplicationStatus.SUBMITTED
        : app.status;

    await this.applications.update(id, {
      paymentStatus: AdmissionPaymentStatus.PAID,
      paymentMethod: dto.method,
      paymentRef: dto.reference,
      paidAmount: amount,
      paidAt: new Date(),
      status: toStatus,
      updatedBy: actor.sub,
    });

    if (toStatus !== fromStatus) {
      this.events.emit(ADMISSION_EVENTS.STATUS_CHANGED, {
        applicationId: id,
        applicationNo: app.applicationNo,
        schoolId: actor.schoolId,
        phone: app.phone,
        from: fromStatus,
        to: toStatus,
        note: `Payment of BDT ${amount.toFixed(2)} received.`,
      } satisfies ApplicationStatusChangedEvent);
    }

    this.auditContext.set({
      entityType: 'AdmissionApplication',
      entityId: id,
      oldValues: { paymentStatus: app.paymentStatus, status: fromStatus },
      newValues: {
        paymentStatus: AdmissionPaymentStatus.PAID,
        method: dto.method,
        reference: dto.reference,
        amount,
        status: toStatus,
      },
    });
    return this.getDetail(id, actor.schoolId);
  }

  /** Waive (or refund) the fee — separate permission (M10 §6: fee is
   *  non-refundable by default). Waiving unblocks PAYMENT_PENDING. */
  async setPaymentStatus(
    id: string,
    dto: SetPaymentStatusDto,
    actor: AccessTokenPayload,
  ): Promise<ApplicationWithRelations> {
    const app = await this.getDetail(id, actor.schoolId);
    if (app.paymentStatus === dto.status) {
      throw new BadRequestException(`Payment is already ${dto.status}`);
    }
    if (
      dto.status === AdmissionPaymentStatus.REFUNDED &&
      app.paymentStatus !== AdmissionPaymentStatus.PAID
    ) {
      throw new ConflictException('Only a paid fee can be refunded');
    }

    const fromStatus = app.status;
    const toStatus =
      dto.status === AdmissionPaymentStatus.WAIVED &&
      app.status === AdmissionApplicationStatus.PAYMENT_PENDING
        ? AdmissionApplicationStatus.SUBMITTED
        : app.status;

    await this.applications.update(id, {
      paymentStatus: dto.status,
      status: toStatus,
      updatedBy: actor.sub,
    });

    if (toStatus !== fromStatus) {
      this.events.emit(ADMISSION_EVENTS.STATUS_CHANGED, {
        applicationId: id,
        applicationNo: app.applicationNo,
        schoolId: actor.schoolId,
        phone: app.phone,
        from: fromStatus,
        to: toStatus,
        note: 'Application fee waived.',
      } satisfies ApplicationStatusChangedEvent);
    }

    this.auditContext.set({
      entityType: 'AdmissionApplication',
      entityId: id,
      oldValues: { paymentStatus: app.paymentStatus },
      newValues: { paymentStatus: dto.status, reason: dto.reason },
    });
    return this.getDetail(id, actor.schoolId);
  }

  /**
   * Approval → student conversion (roadmap M10 §4): SELECTED only.
   * Reuses StudentsService.create — same gap-free UID, guardian phone
   * dedup, and warn-only duplicate report as manual registration.
   * Idempotent: re-admitting an ADMITTED application returns the
   * existing student (M10 §6). Enrollment is backfilled by Module 11.
   */
  async admit(id: string, actor: AccessTokenPayload): Promise<AdmitResult> {
    const app = await this.getDetail(id, actor.schoolId);

    if (app.status === AdmissionApplicationStatus.ADMITTED) {
      if (!app.studentId) {
        throw new ConflictException(
          'Application is ADMITTED but has no linked student — contact support',
        );
      }
      const student = await this.studentsService.getDetail(
        app.studentId,
        actor.schoolId,
      );
      return {
        student,
        duplicateWarnings: [],
        warnings: [],
        alreadyAdmitted: true,
      };
    }
    if (app.status !== AdmissionApplicationStatus.SELECTED) {
      throw new ConflictException(
        `Only SELECTED applications can be admitted (current: ${app.status})`,
      );
    }

    const guardian = app.guardian as unknown as GuardianSnapshot;
    if (!guardian?.name || !guardian?.phone) {
      throw new BadRequestException(
        'Application is missing its guardian snapshot',
      );
    }

    const created = await this.studentsService.create(
      {
        firstName: app.firstName,
        lastName: app.lastName,
        nameBn: app.nameBn ?? undefined,
        gender: app.gender,
        dob: app.dob.toISOString().slice(0, 10),
        religion: app.religion,
        presentAddress: app.presentAddress as AddressDto,
        permanentAddress: app.permanentAddress as AddressDto,
        admissionDate: new Date().toISOString().slice(0, 10),
        admissionClassId: app.classId,
        previousSchool: app.previousSchool ?? undefined,
        guardians: [
          {
            name: guardian.name,
            nameBn: guardian.nameBn,
            relation: guardian.relation ?? GuardianRelation.OTHER,
            phone: guardian.phone,
            email: guardian.email,
            occupation: guardian.occupation,
            isPrimary: true,
            isEmergencyContact: true,
          },
        ],
      },
      actor,
    );

    // The applicant photo (admissions/… key) becomes the student photo.
    if (app.photoUrl) {
      await this.students.update(created.student.id, {
        photoUrl: app.photoUrl,
        updatedBy: actor.sub,
      });
    }

    await this.applications.update(id, {
      status: AdmissionApplicationStatus.ADMITTED,
      studentId: created.student.id,
      updatedBy: actor.sub,
    });

    this.events.emit(ADMISSION_EVENTS.STATUS_CHANGED, {
      applicationId: id,
      applicationNo: app.applicationNo,
      schoolId: actor.schoolId,
      phone: app.phone,
      from: app.status,
      to: AdmissionApplicationStatus.ADMITTED,
      note: `Student ID ${created.student.studentUid}.`,
    } satisfies ApplicationStatusChangedEvent);

    this.auditContext.set({
      entityType: 'AdmissionApplication',
      entityId: id,
      oldValues: { status: app.status },
      newValues: {
        status: AdmissionApplicationStatus.ADMITTED,
        studentId: created.student.id,
        studentUid: created.student.studentUid,
      },
    });

    return { ...created, alreadyAdmitted: false };
  }

  // ── internals ─────────────────────────────────────────────────────

  private async applicationFee(app: ApplicationWithRelations): Promise<number> {
    const cycle = await this.cycles.findDetail(app.cycleId, app.schoolId);
    const entry = cycle?.classes.find((c) => c.classId === app.classId);
    return entry ? Number(entry.applicationFee) : 0;
  }
}
