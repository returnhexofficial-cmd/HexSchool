import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AdmissionCycle } from '@prisma/client';
import {
  AdmissionApplicationStatus,
  AdmissionCycleStatus,
} from '../../../common/constants';
import { PaginatedResult } from '../../../common/dto/paginated.dto';
import { AcademicSessionsRepository } from '../../academic/repositories/academic-sessions.repository';
import { ClassesRepository } from '../../academic/repositories/classes.repository';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import {
  AdmissionCycleQueryDto,
  CreateAdmissionCycleDto,
  CycleClassEntryDto,
  UpdateAdmissionCycleDto,
} from '../dto';
import {
  ADMISSION_EVENTS,
  ApplicationStatusChangedEvent,
} from '../events/admission.events';
import { AdmissionApplicationsRepository } from '../repositories/admission-applications.repository';
import {
  AdmissionCycleDetail,
  AdmissionCyclesRepository,
} from '../repositories/admission-cycles.repository';

/**
 * Admission cycle lifecycle (roadmap M10): DRAFT → OPEN → CLOSED →
 * COMPLETED. Per-class seats/fees live in admission_cycle_classes and
 * are replaced wholesale on update (removal blocked once a class has
 * applications). Closing a cycle auto-cancels unpaid PAYMENT_PENDING
 * applications (M10 §8) with an SMS notification.
 */
@Injectable()
export class AdmissionCyclesService {
  constructor(
    private readonly cycles: AdmissionCyclesRepository,
    private readonly applications: AdmissionApplicationsRepository,
    private readonly sessions: AcademicSessionsRepository,
    private readonly classes: ClassesRepository,
    private readonly auditContext: AuditContextService,
    private readonly events: EventEmitter2,
  ) {}

  async list(
    query: AdmissionCycleQueryDto,
    schoolId: string,
  ): Promise<PaginatedResult<AdmissionCycleDetail>> {
    return this.cycles.paginateList(query, schoolId);
  }

  async getDetail(id: string, schoolId: string): Promise<AdmissionCycleDetail> {
    const cycle = await this.cycles.findDetail(id, schoolId);
    if (!cycle) throw new NotFoundException(`Admission cycle ${id} not found`);
    return cycle;
  }

  async create(
    dto: CreateAdmissionCycleDto,
    actor: AccessTokenPayload,
  ): Promise<AdmissionCycleDetail> {
    const window = this.parseWindow(dto.startAt, dto.endAt);
    await this.assertWindowWithinSession(dto.sessionId, window, actor.schoolId);
    await this.assertNameAvailable(dto.name, actor.schoolId);
    await this.assertClassEntries(dto.classes, actor.schoolId);

    const cycle = await this.cycles.withTransaction(async (tx) => {
      const created = await this.cycles.create(
        {
          schoolId: actor.schoolId,
          sessionId: dto.sessionId,
          name: dto.name,
          startAt: window.startAt,
          endAt: window.endAt,
          testRequired: dto.testRequired ?? false,
          instructions: dto.instructions,
          createdBy: actor.sub,
          updatedBy: actor.sub,
        },
        tx,
      );
      await this.cycles.replaceClasses(
        created.id,
        this.normalizeClassEntries(dto.classes),
        tx,
      );
      return created;
    });

    this.auditContext.set({
      entityType: 'AdmissionCycle',
      entityId: cycle.id,
      newValues: {
        name: dto.name,
        sessionId: dto.sessionId,
        classes: dto.classes.length,
        testRequired: dto.testRequired ?? false,
      },
    });
    return this.getDetail(cycle.id, actor.schoolId);
  }

  async update(
    id: string,
    dto: UpdateAdmissionCycleDto,
    actor: AccessTokenPayload,
  ): Promise<AdmissionCycleDetail> {
    const existing = await this.getDetail(id, actor.schoolId);
    if (existing.status === AdmissionCycleStatus.COMPLETED) {
      throw new ConflictException('A completed cycle is read-only');
    }

    const window = this.parseWindow(
      dto.startAt ?? existing.startAt.toISOString(),
      dto.endAt ?? existing.endAt.toISOString(),
    );
    const sessionId = dto.sessionId ?? existing.sessionId;
    await this.assertWindowWithinSession(sessionId, window, actor.schoolId);
    if (dto.name && dto.name !== existing.name) {
      await this.assertNameAvailable(dto.name, actor.schoolId);
    }
    if (dto.classes) {
      await this.assertClassEntries(dto.classes, actor.schoolId);
      await this.assertRemovedClassesHaveNoApplications(existing, dto.classes);
    }

    await this.cycles.withTransaction(async (tx) => {
      await this.cycles.update(
        id,
        {
          ...(dto.sessionId !== undefined ? { sessionId: dto.sessionId } : {}),
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.startAt !== undefined ? { startAt: window.startAt } : {}),
          ...(dto.endAt !== undefined ? { endAt: window.endAt } : {}),
          ...(dto.testRequired !== undefined
            ? { testRequired: dto.testRequired }
            : {}),
          ...(dto.instructions !== undefined
            ? { instructions: dto.instructions || null }
            : {}),
          updatedBy: actor.sub,
        },
        tx,
      );
      if (dto.classes) {
        await this.cycles.replaceClasses(
          id,
          this.normalizeClassEntries(dto.classes),
          tx,
        );
      }
    });

    this.auditContext.set({
      entityType: 'AdmissionCycle',
      entityId: id,
      oldValues: { name: existing.name, status: existing.status },
      newValues: { ...dto, classes: dto.classes?.length },
    });
    return this.getDetail(id, actor.schoolId);
  }

  /** DRAFT (or re-opened CLOSED) → OPEN. Needs ≥1 class and a live window. */
  async open(id: string, actor: AccessTokenPayload): Promise<AdmissionCycle> {
    const cycle = await this.getDetail(id, actor.schoolId);
    if (
      cycle.status !== AdmissionCycleStatus.DRAFT &&
      cycle.status !== AdmissionCycleStatus.CLOSED
    ) {
      throw new ConflictException(`Cannot open a ${cycle.status} cycle`);
    }
    if (cycle.classes.length === 0) {
      throw new BadRequestException(
        'Add at least one class (with seats) before opening',
      );
    }
    if (cycle.endAt.getTime() <= Date.now()) {
      throw new BadRequestException(
        'The application window has already ended — extend end date first',
      );
    }
    return this.transition(cycle, AdmissionCycleStatus.OPEN, actor);
  }

  /** OPEN → CLOSED. Unpaid PAYMENT_PENDING applications are cancelled
   *  with an SMS (roadmap M10 §8 — cycle closed early). */
  async close(id: string, actor: AccessTokenPayload): Promise<AdmissionCycle> {
    const cycle = await this.getDetail(id, actor.schoolId);
    if (cycle.status !== AdmissionCycleStatus.OPEN) {
      throw new ConflictException(`Cannot close a ${cycle.status} cycle`);
    }

    const unpaid = await this.applications.findUnpaidPending(id);
    const updated = await this.cycles.withTransaction(async (tx) => {
      for (const app of unpaid) {
        await this.applications.update(
          app.id,
          {
            status: AdmissionApplicationStatus.CANCELLED,
            updatedBy: actor.sub,
          },
          tx,
        );
      }
      return this.cycles.update(
        id,
        { status: AdmissionCycleStatus.CLOSED, updatedBy: actor.sub },
        tx,
      );
    });

    for (const app of unpaid) {
      this.events.emit(ADMISSION_EVENTS.STATUS_CHANGED, {
        applicationId: app.id,
        applicationNo: app.applicationNo,
        schoolId: actor.schoolId,
        phone: app.phone,
        from: app.status,
        to: AdmissionApplicationStatus.CANCELLED,
        note: 'The admission cycle closed before payment was received.',
      } satisfies ApplicationStatusChangedEvent);
    }

    this.auditContext.set({
      entityType: 'AdmissionCycle',
      entityId: id,
      oldValues: { status: cycle.status },
      newValues: {
        status: AdmissionCycleStatus.CLOSED,
        cancelledUnpaid: unpaid.length,
      },
    });
    return updated;
  }

  /** CLOSED → COMPLETED (cycle archived; merit/admissions done). */
  async complete(
    id: string,
    actor: AccessTokenPayload,
  ): Promise<AdmissionCycle> {
    const cycle = await this.getDetail(id, actor.schoolId);
    if (cycle.status !== AdmissionCycleStatus.CLOSED) {
      throw new ConflictException(`Cannot complete a ${cycle.status} cycle`);
    }
    return this.transition(cycle, AdmissionCycleStatus.COMPLETED, actor);
  }

  async remove(id: string, actor: AccessTokenPayload): Promise<void> {
    const cycle = await this.getDetail(id, actor.schoolId);
    const applications = await this.applications.count(
      { cycleId: id },
      actor.schoolId,
    );
    if (applications > 0) {
      throw new ConflictException(
        `Cannot delete: ${applications} application(s) exist for this cycle`,
      );
    }
    await this.cycles.update(id, {
      deletedAt: new Date(),
      updatedBy: actor.sub,
    });
    this.auditContext.set({
      entityType: 'AdmissionCycle',
      entityId: id,
      oldValues: { name: cycle.name, status: cycle.status },
    });
  }

  // ── internals ─────────────────────────────────────────────────────

  private async transition(
    cycle: AdmissionCycleDetail,
    to: AdmissionCycleStatus,
    actor: AccessTokenPayload,
  ): Promise<AdmissionCycle> {
    const updated = await this.cycles.update(cycle.id, {
      status: to,
      updatedBy: actor.sub,
    });
    this.auditContext.set({
      entityType: 'AdmissionCycle',
      entityId: cycle.id,
      oldValues: { status: cycle.status },
      newValues: { status: to },
    });
    return updated;
  }

  private parseWindow(
    startAt: string,
    endAt: string,
  ): { startAt: Date; endAt: Date } {
    const start = new Date(startAt);
    const end = new Date(endAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Invalid startAt/endAt timestamp');
    }
    if (start.getTime() >= end.getTime()) {
      throw new BadRequestException('endAt must be after startAt');
    }
    return { startAt: start, endAt: end };
  }

  /** Roadmap M10 §7: the application window must fall within its session. */
  private async assertWindowWithinSession(
    sessionId: string,
    window: { startAt: Date; endAt: Date },
    schoolId: string,
  ): Promise<void> {
    const session = await this.sessions.findByIdOrFail(sessionId, schoolId);
    // Admission for a session typically runs BEFORE it starts — only the
    // end of the window is bounded (cannot outlive the session).
    const sessionEnd = session.endDate.getTime() + 24 * 3600 * 1000;
    if (window.endAt.getTime() > sessionEnd) {
      throw new BadRequestException(
        `The application window must end within session ${session.name}`,
      );
    }
  }

  private async assertNameAvailable(
    name: string,
    schoolId: string,
  ): Promise<void> {
    const existing = await this.cycles.findByName(name, schoolId);
    if (existing) {
      throw new ConflictException(`Cycle "${name}" already exists`);
    }
  }

  private async assertClassEntries(
    entries: CycleClassEntryDto[],
    schoolId: string,
  ): Promise<void> {
    const seen = new Set<string>();
    for (const entry of entries) {
      if (seen.has(entry.classId)) {
        throw new BadRequestException(
          'The same class appears more than once in the cycle',
        );
      }
      seen.add(entry.classId);
      await this.classes.findByIdOrFail(entry.classId, schoolId);
    }
  }

  private async assertRemovedClassesHaveNoApplications(
    existing: AdmissionCycleDetail,
    next: CycleClassEntryDto[],
  ): Promise<void> {
    const keep = new Set(next.map((e) => e.classId));
    for (const current of existing.classes) {
      if (keep.has(current.classId)) continue;
      const count = await this.applications.count(
        { cycleId: existing.id, classId: current.classId },
        existing.schoolId,
      );
      if (count > 0) {
        throw new ConflictException(
          `Cannot remove ${current.class.name}: ${count} application(s) exist`,
        );
      }
    }
  }

  private normalizeClassEntries(
    entries: CycleClassEntryDto[],
  ): Array<{ classId: string; seats: number; applicationFee: number }> {
    return entries.map((e) => ({
      classId: e.classId,
      seats: e.seats,
      applicationFee: e.applicationFee ?? 0,
    }));
  }
}
