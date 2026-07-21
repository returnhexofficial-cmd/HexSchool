import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EnrollmentStatus,
  EnrollmentType,
  Prisma,
  PromotionBatchStatus,
  PromotionDecision,
  StudentStatus,
} from '@prisma/client';
import { PrismaClientLike } from '../../../common/database/base.repository';
import { PaginatedResult } from '../../../common/dto/paginated.dto';
import { AcademicSessionsRepository } from '../../academic/repositories/academic-sessions.repository';
import { SectionsRepository } from '../../academic/repositories/sections.repository';
import { StudentAttendancesRepository } from '../../attendance/repositories/student-attendances.repository';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { StudentStatusHistoryRepository } from '../../student/repositories/student-status-history.repository';
import { StudentsRepository } from '../../student/repositories/students.repository';
import {
  CreatePromotionBatchDto,
  ExecutePromotionDto,
  PromotionMappingDto,
  PromotionQueryDto,
  UpdatePromotionItemsDto,
} from '../dto';
import { EnrollmentsRepository } from '../repositories/enrollments.repository';
import {
  PromotionBatchesRepository,
  PromotionBatchWithRelations,
} from '../repositories/promotion-batches.repository';
import {
  PromotionItemsRepository,
  PromotionItemWithRelations,
} from '../repositories/promotion-items.repository';

export interface PromotionBatchDetail {
  batch: PromotionBatchWithRelations;
  items: PromotionItemWithRelations[];
}

export interface PromotionPreview {
  batch: PromotionBatchWithRelations;
  counts: Record<PromotionDecision, number>;
  targetSections: Array<{ sectionId: string; count: number }>;
  warnings: string[];
}

export interface PromotionExecutionResult {
  promoted: number;
  retained: number;
  graduated: number;
  excluded: number;
}

/**
 * Yearly promotion (roadmap M11 §4): build a DRAFT batch (one item per
 * candidate student, decisions auto-filled from a class→class mapping and
 * editable), preview, then execute transactionally — close old
 * enrollments, create new ones in the target session, and graduate
 * final-class students. Rollback is allowed while the new session has no
 * dependent data (attendance/marks — those modules land in M12/M15; the
 * guard is a hook until then).
 */
@Injectable()
export class PromotionService {
  constructor(
    private readonly batches: PromotionBatchesRepository,
    private readonly items: PromotionItemsRepository,
    private readonly enrollments: EnrollmentsRepository,
    private readonly sections: SectionsRepository,
    private readonly sessions: AcademicSessionsRepository,
    private readonly students: StudentsRepository,
    private readonly statusHistory: StudentStatusHistoryRepository,
    /** Re-provisioned stateless repo — the M12 rollback guard (see
     *  `rollback`); importing AttendanceModule would close a cycle. */
    private readonly attendances: StudentAttendancesRepository,
    private readonly auditContext: AuditContextService,
  ) {}

  async list(
    query: PromotionQueryDto,
    schoolId: string,
  ): Promise<PaginatedResult<PromotionBatchWithRelations>> {
    return this.batches.paginateList(query, schoolId);
  }

  async getDetail(id: string, schoolId: string): Promise<PromotionBatchDetail> {
    const batch = await this.batches.findDetail(id, schoolId);
    if (!batch) throw new NotFoundException(`Promotion batch ${id} not found`);
    const items = await this.items.findForBatch(id);
    return { batch, items };
  }

  async create(
    dto: CreatePromotionBatchDto,
    actor: AccessTokenPayload,
  ): Promise<PromotionBatchDetail> {
    const schoolId = actor.schoolId;
    if (dto.fromSessionId === dto.toSessionId) {
      throw new BadRequestException('from and to sessions must be different');
    }
    await this.sessions.findByIdOrFail(dto.fromSessionId, schoolId);
    await this.sessions.findByIdOrFail(dto.toSessionId, schoolId);

    // Target session must have structure to promote into (roadmap M11 §6).
    const targetSections = await this.sections.findForSession(
      schoolId,
      dto.toSessionId,
    );
    if (targetSections.length === 0) {
      throw new BadRequestException(
        'Target session has no sections — clone the academic structure first (Module 06)',
      );
    }

    const mappings = dto.mappings ?? [];
    const mapByClass = new Map(mappings.map((m) => [m.fromClassId, m]));

    const candidates = await this.enrollments.findLiveForSession(
      dto.fromSessionId,
      schoolId,
    );
    if (candidates.length === 0) {
      throw new BadRequestException(
        'Source session has no active enrollments to promote',
      );
    }

    const batch = await this.batches.create({
      schoolId,
      fromSessionId: dto.fromSessionId,
      toSessionId: dto.toSessionId,
      status: PromotionBatchStatus.DRAFT,
      criteria: {
        mappings: mappings as unknown as Prisma.InputJsonValue,
        builtAt: new Date().toISOString(),
      },
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });

    const itemRows: Prisma.PromotionItemUncheckedCreateInput[] = candidates.map(
      (enrollment) => {
        const decision = this.defaultDecision(enrollment.classId, mapByClass);
        const mapping = mapByClass.get(enrollment.classId);
        return {
          batchId: batch.id,
          studentId: enrollment.studentId,
          fromEnrollmentId: enrollment.id,
          decision,
          toClassId:
            decision === PromotionDecision.PROMOTE
              ? (mapping?.toClassId ?? null)
              : null,
          toSectionId:
            decision === PromotionDecision.PROMOTE
              ? (mapping?.toSectionId ?? null)
              : null,
        };
      },
    );
    await this.items.createMany(itemRows);

    this.auditContext.set({
      entityType: 'PromotionBatch',
      entityId: batch.id,
      newValues: {
        fromSessionId: dto.fromSessionId,
        toSessionId: dto.toSessionId,
        candidates: itemRows.length,
      },
    });
    return this.getDetail(batch.id, schoolId);
  }

  async updateItems(
    id: string,
    dto: UpdatePromotionItemsDto,
    actor: AccessTokenPayload,
  ): Promise<PromotionBatchDetail> {
    const schoolId = actor.schoolId;
    const batch = await this.batches.findDetail(id, schoolId);
    if (!batch) throw new NotFoundException(`Promotion batch ${id} not found`);
    this.assertDraft(batch);

    const existing = await this.items.findForBatch(id);
    const byId = new Map(existing.map((it) => [it.id, it]));

    await this.batches.withTransaction(async (tx) => {
      for (const change of dto.items) {
        const item = byId.get(change.itemId);
        if (!item) {
          throw new NotFoundException(
            `Promotion item ${change.itemId} is not part of this batch`,
          );
        }
        if (change.decision === PromotionDecision.PROMOTE) {
          await this.validateTarget(
            change.toClassId ?? null,
            change.toSectionId ?? null,
            batch.toSessionId,
            schoolId,
          );
        }
        await this.items.update(
          change.itemId,
          {
            decision: change.decision,
            toClassId:
              change.decision === PromotionDecision.PROMOTE ||
              change.decision === PromotionDecision.RETAIN
                ? (change.toClassId ?? null)
                : null,
            toSectionId:
              change.decision === PromotionDecision.PROMOTE ||
              change.decision === PromotionDecision.RETAIN
                ? (change.toSectionId ?? null)
                : null,
          },
          tx,
        );
      }
    });

    this.auditContext.set({
      entityType: 'PromotionBatch',
      entityId: id,
      newValues: { action: 'EDIT_DECISIONS', changes: dto.items.length },
    });
    return this.getDetail(id, schoolId);
  }

  async preview(id: string, schoolId: string): Promise<PromotionPreview> {
    const { batch, items } = await this.getDetail(id, schoolId);
    const counts: Record<PromotionDecision, number> = {
      PROMOTE: 0,
      RETAIN: 0,
      GRADUATE: 0,
      EXCLUDE: 0,
    };
    const targetCounts = new Map<string, number>();
    const warnings: string[] = [];

    for (const item of items) {
      counts[item.decision] += 1;
      if (
        item.decision === PromotionDecision.PROMOTE ||
        item.decision === PromotionDecision.RETAIN
      ) {
        if (!item.toClassId || !item.toSectionId) {
          warnings.push(
            `${item.student.firstName} ${item.student.lastName}: ${item.decision} decision is missing a target class/section`,
          );
        } else {
          targetCounts.set(
            item.toSectionId,
            (targetCounts.get(item.toSectionId) ?? 0) + 1,
          );
        }
      }
    }

    return {
      batch,
      counts,
      targetSections: [...targetCounts.entries()].map(([sectionId, count]) => ({
        sectionId,
        count,
      })),
      warnings,
    };
  }

  async execute(
    id: string,
    dto: ExecutePromotionDto,
    actor: AccessTokenPayload,
  ): Promise<PromotionExecutionResult> {
    const schoolId = actor.schoolId;
    const batch = await this.batches.findDetail(id, schoolId);
    if (!batch) throw new NotFoundException(`Promotion batch ${id} not found`);
    this.assertDraft(batch);

    const items = await this.items.findForBatch(id);
    // Validate all movement targets up front (fail before any writes).
    for (const item of items) {
      if (
        item.decision === PromotionDecision.PROMOTE ||
        item.decision === PromotionDecision.RETAIN
      ) {
        await this.validateTarget(
          item.toClassId,
          item.toSectionId,
          batch.toSessionId,
          schoolId,
        );
      }
    }

    const result: PromotionExecutionResult = {
      promoted: 0,
      retained: 0,
      graduated: 0,
      excluded: 0,
    };

    await this.batches.withTransaction(async (tx) => {
      // Next-roll cursor per target section (lazy-loaded).
      const rollCursor = new Map<string, number>();
      const nextRoll = async (sectionId: string): Promise<number> => {
        if (!rollCursor.has(sectionId)) {
          const base = await this.enrollments.maxRoll(
            batch.toSessionId,
            sectionId,
            tx,
          );
          rollCursor.set(sectionId, base);
        }
        const next = (rollCursor.get(sectionId) as number) + 1;
        rollCursor.set(sectionId, next);
        return next;
      };

      for (const item of items) {
        switch (item.decision) {
          case PromotionDecision.EXCLUDE:
            result.excluded += 1;
            break;

          case PromotionDecision.GRADUATE:
            await this.closeEnrollment(
              item.fromEnrollmentId,
              EnrollmentStatus.COMPLETED,
              actor.sub,
              tx,
            );
            await this.graduateStudent(item.studentId, schoolId, actor.sub, tx);
            result.graduated += 1;
            break;

          case PromotionDecision.PROMOTE:
          case PromotionDecision.RETAIN: {
            const section = await this.sections.findByIdOrFail(
              item.toSectionId as string,
              schoolId,
            );
            const roll = await nextRoll(section.id);
            const created = await this.enrollments.create(
              {
                schoolId,
                studentId: item.studentId,
                sessionId: batch.toSessionId,
                classId: item.toClassId as string,
                sectionId: section.id,
                groupId: section.groupId,
                shiftId: section.shiftId,
                rollNo: roll,
                enrollmentDate: new Date(),
                type:
                  item.decision === PromotionDecision.PROMOTE
                    ? EnrollmentType.PROMOTED
                    : EnrollmentType.READMITTED,
                createdBy: actor.sub,
                updatedBy: actor.sub,
              },
              tx,
            );
            await this.closeEnrollment(
              item.fromEnrollmentId,
              item.decision === PromotionDecision.PROMOTE
                ? EnrollmentStatus.PROMOTED
                : EnrollmentStatus.RETAINED,
              actor.sub,
              tx,
            );
            await this.items.update(
              item.id,
              { toEnrollmentId: created.id },
              tx,
            );
            if (item.decision === PromotionDecision.PROMOTE)
              result.promoted += 1;
            else result.retained += 1;
            break;
          }
        }
      }

      await this.batches.update(
        id,
        {
          status: PromotionBatchStatus.EXECUTED,
          executedBy: actor.sub,
          executedAt: new Date(),
          updatedBy: actor.sub,
        },
        tx,
      );
    });

    this.auditContext.set({
      entityType: 'PromotionBatch',
      entityId: id,
      oldValues: { status: PromotionBatchStatus.DRAFT },
      newValues: { status: PromotionBatchStatus.EXECUTED, ...result },
    });
    return result;
  }

  async rollback(id: string, actor: AccessTokenPayload): Promise<void> {
    const schoolId = actor.schoolId;
    const batch = await this.batches.findDetail(id, schoolId);
    if (!batch) throw new NotFoundException(`Promotion batch ${id} not found`);
    if (batch.status !== PromotionBatchStatus.EXECUTED) {
      throw new BadRequestException(
        `Only EXECUTED batches can be rolled back (this one is ${batch.status})`,
      );
    }

    const items = await this.items.findForBatch(id);

    // Rollback guard (roadmap M11 §8): blocked once the new session has
    // dependent data. Live since M12 for attendance; marks (M15) extend
    // the same check when that table lands.
    const createdEnrollmentIds = items
      .map((item) => item.toEnrollmentId)
      .filter((value): value is string => value !== null);
    const attendanceRows = await this.attendances.findForEnrollments(
      createdEnrollmentIds,
      new Date(Date.UTC(1970, 0, 1)),
      new Date(Date.UTC(2999, 11, 31)),
    );
    if (attendanceRows.length > 0) {
      throw new ConflictException(
        `Cannot roll back: ${attendanceRows.length} attendance record(s) already exist in ${batch.toSession.name}. Correct the affected enrollments individually instead.`,
      );
    }

    await this.batches.withTransaction(async (tx) => {
      for (const item of items) {
        if (item.toEnrollmentId) {
          // Hard-delete the enrollment created at execution.
          await this.enrollments.hardDelete(item.toEnrollmentId, tx);
        }
        if (item.fromEnrollmentId) {
          await this.enrollments.update(
            item.fromEnrollmentId,
            { status: EnrollmentStatus.ACTIVE, updatedBy: actor.sub },
            tx,
          );
        }
        if (item.decision === PromotionDecision.GRADUATE) {
          await this.revertGraduation(item.studentId, schoolId, actor.sub, tx);
        }
        await this.items.update(item.id, { toEnrollmentId: null }, tx);
      }
      await this.batches.update(
        id,
        { status: PromotionBatchStatus.ROLLED_BACK, updatedBy: actor.sub },
        tx,
      );
    });

    this.auditContext.set({
      entityType: 'PromotionBatch',
      entityId: id,
      oldValues: { status: PromotionBatchStatus.EXECUTED },
      newValues: { status: PromotionBatchStatus.ROLLED_BACK },
    });
  }

  async remove(id: string, actor: AccessTokenPayload): Promise<void> {
    const batch = await this.batches.findDetail(id, actor.schoolId);
    if (!batch) throw new NotFoundException(`Promotion batch ${id} not found`);
    this.assertDraft(batch);
    await this.batches.hardDelete(id); // cascades items
    this.auditContext.set({
      entityType: 'PromotionBatch',
      entityId: id,
      oldValues: { status: batch.status },
    });
  }

  // ── internals ───────────────────────────────────────────────────────

  private defaultDecision(
    classId: string,
    mapByClass: Map<string, PromotionMappingDto>,
  ): PromotionDecision {
    const mapping = mapByClass.get(classId);
    if (!mapping) return PromotionDecision.EXCLUDE;
    if (!mapping.toClassId) return PromotionDecision.GRADUATE;
    return PromotionDecision.PROMOTE;
  }

  private assertDraft(batch: PromotionBatchWithRelations): void {
    if (batch.status !== PromotionBatchStatus.DRAFT) {
      throw new ConflictException(
        `Batch is ${batch.status} — only DRAFT batches can be edited/executed`,
      );
    }
  }

  private async validateTarget(
    toClassId: string | null,
    toSectionId: string | null,
    toSessionId: string,
    schoolId: string,
  ): Promise<void> {
    if (!toClassId || !toSectionId) {
      throw new BadRequestException(
        'PROMOTE/RETAIN decisions require a target class and section',
      );
    }
    const section = await this.sections.findByIdOrFail(toSectionId, schoolId);
    if (section.sessionId !== toSessionId) {
      throw new BadRequestException(
        'Target section is not in the promotion target session',
      );
    }
    if (section.classId !== toClassId) {
      throw new BadRequestException(
        'Target section does not belong to the target class',
      );
    }
  }

  private async closeEnrollment(
    enrollmentId: string | null,
    status: EnrollmentStatus,
    actorId: string,
    tx: PrismaClientLike,
  ): Promise<void> {
    if (!enrollmentId) return;
    await this.enrollments.update(
      enrollmentId,
      { status, updatedBy: actorId },
      tx,
    );
  }

  private async graduateStudent(
    studentId: string,
    schoolId: string,
    actorId: string,
    tx: PrismaClientLike,
  ): Promise<void> {
    const student = await this.students.findByIdOrFail(studentId, schoolId);
    if (student.status === StudentStatus.GRADUATED) return;
    await this.students.update(
      studentId,
      { status: StudentStatus.GRADUATED, updatedBy: actorId },
      tx,
    );
    await this.statusHistory.append(
      {
        studentId,
        fromStatus: student.status,
        toStatus: StudentStatus.GRADUATED,
        reason: 'Graduated via promotion batch',
        changedBy: actorId,
      },
      tx,
    );
  }

  private async revertGraduation(
    studentId: string,
    schoolId: string,
    actorId: string,
    tx: PrismaClientLike,
  ): Promise<void> {
    const student = await this.students.findByIdOrFail(studentId, schoolId);
    if (student.status !== StudentStatus.GRADUATED) return;
    await this.students.update(
      studentId,
      { status: StudentStatus.ACTIVE, updatedBy: actorId },
      tx,
    );
    await this.statusHistory.append(
      {
        studentId,
        fromStatus: StudentStatus.GRADUATED,
        toStatus: StudentStatus.ACTIVE,
        reason: 'Promotion batch rolled back',
        changedBy: actorId,
      },
      tx,
    );
  }
}
