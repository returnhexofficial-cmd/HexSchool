import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Enrollment,
  EnrollmentStatus,
  EnrollmentType,
  Prisma,
  Section,
} from '@prisma/client';
import { UserType } from '../../../common/constants';
import { PrismaClientLike } from '../../../common/database/base.repository';
import { PaginatedResult } from '../../../common/dto/paginated.dto';
import { parseDate } from '../../academic/calendar/date.util';
import { ClassSubjectsRepository } from '../../academic/repositories/class-subjects.repository';
import { SectionsRepository } from '../../academic/repositories/sections.repository';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { PermissionsService } from '../../rbac/services/permissions.service';
import { StudentsRepository } from '../../student/repositories/students.repository';
import {
  BulkEnrollDto,
  CancelEnrollmentDto,
  CreateEnrollmentDto,
  EnrollableQueryDto,
  EnrollmentQueryDto,
  RenumberStrategy,
  RollAssignDto,
  RollStrategy,
  TransferSectionDto,
  UpdateEnrollmentDto,
} from '../dto';
import {
  EnrollmentsRepository,
  EnrollmentWithRelations,
} from '../repositories/enrollments.repository';
import { EnrollmentTransfersRepository } from '../repositories/enrollment-transfers.repository';

export interface BulkEnrollResult {
  enrolled: EnrollmentWithRelations[];
  skipped: Array<{ studentId: string; reason: string }>;
}

/** Student statuses that may be actively enrolled (roadmap M11). */
const ENROLLABLE_STUDENT_STATUS = new Set(['ACTIVE']);

/**
 * Enrollment lifecycle (roadmap M11): binds a student to a
 * (session, class, section, group, shift) with a roll number. One live
 * enrollment per student per session and roll-unique-per-section are DB
 * partial unique indexes; capacity is enforced here (override needs
 * `enrollment.capacity.override`). Also owns the canonical roster
 * queries every later module builds on: `getSectionStudents()` /
 * `getStudentCurrentEnrollment()`.
 */
@Injectable()
export class EnrollmentsService {
  constructor(
    private readonly enrollments: EnrollmentsRepository,
    private readonly transfers: EnrollmentTransfersRepository,
    private readonly sections: SectionsRepository,
    private readonly classSubjects: ClassSubjectsRepository,
    private readonly students: StudentsRepository,
    private readonly permissions: PermissionsService,
    private readonly auditContext: AuditContextService,
  ) {}

  // ── reads ───────────────────────────────────────────────────────────

  async list(
    query: EnrollmentQueryDto,
    schoolId: string,
  ): Promise<PaginatedResult<EnrollmentWithRelations>> {
    return this.enrollments.paginateList(query, schoolId);
  }

  async getDetail(
    id: string,
    schoolId: string,
  ): Promise<EnrollmentWithRelations> {
    const enrollment = await this.enrollments.findDetail(id, schoolId);
    if (!enrollment) throw new NotFoundException(`Enrollment ${id} not found`);
    return enrollment;
  }

  /** Canonical roster (exported for Attendance/Exams/Fees). */
  async getSectionStudents(
    sectionId: string,
    schoolId: string,
  ): Promise<EnrollmentWithRelations[]> {
    await this.sections.findByIdOrFail(sectionId, schoolId);
    return this.enrollments.findSectionRoster(sectionId, schoolId);
  }

  /** Canonical current enrollment for a student in a session. */
  async getStudentCurrentEnrollment(
    studentId: string,
    sessionId: string,
    schoolId: string,
  ): Promise<EnrollmentWithRelations | null> {
    return this.enrollments.findLiveByStudentSession(
      studentId,
      sessionId,
      schoolId,
    );
  }

  async listEnrollable(query: EnrollableQueryDto, schoolId: string) {
    return this.enrollments.findEnrollableStudents(query.sessionId, schoolId, {
      search: query.search,
      limit: query.limit ?? 50,
    });
  }

  // ── single enroll ───────────────────────────────────────────────────

  async enroll(
    dto: CreateEnrollmentDto,
    actor: AccessTokenPayload,
  ): Promise<EnrollmentWithRelations> {
    const schoolId = actor.schoolId;
    const section = await this.loadSectionForSession(
      dto.sectionId,
      dto.sessionId,
      schoolId,
    );
    const student = await this.students.findByIdOrFail(dto.studentId, schoolId);
    if (!ENROLLABLE_STUDENT_STATUS.has(student.status)) {
      throw new BadRequestException(
        `Student is ${student.status} — only ACTIVE students can be enrolled`,
      );
    }

    const groupId = dto.groupId ?? section.groupId ?? null;
    const shiftId = dto.shiftId ?? section.shiftId ?? null;
    await this.validateOptionalSubject(
      dto.optionalSubjectId ?? null,
      section.classId,
      dto.sessionId,
      groupId,
      schoolId,
    );

    const created = await this.enrollments.withTransaction(async (tx) => {
      await this.assertNotAlreadyEnrolled(
        dto.studentId,
        dto.sessionId,
        schoolId,
        tx,
      );
      await this.assertCapacity(
        section,
        dto.sessionId,
        1,
        dto.overrideCapacity ?? false,
        actor,
        tx,
      );
      const rollNo = await this.resolveRoll(
        dto.sessionId,
        dto.sectionId,
        dto.rollNo,
        tx,
      );

      return this.createRow(
        {
          schoolId,
          studentId: dto.studentId,
          sessionId: dto.sessionId,
          classId: section.classId,
          sectionId: dto.sectionId,
          groupId,
          shiftId,
          rollNo,
          enrollmentDate: this.resolveDate(dto.enrollmentDate),
          type: dto.type ?? EnrollmentType.NEW,
          optionalSubjectId: dto.optionalSubjectId ?? null,
          createdBy: actor.sub,
          updatedBy: actor.sub,
        },
        tx,
      );
    });

    this.auditContext.set({
      entityType: 'Enrollment',
      entityId: created.id,
      newValues: {
        studentUid: student.studentUid,
        sectionId: dto.sectionId,
        rollNo: created.rollNo,
      },
    });
    return this.getDetail(created.id, schoolId);
  }

  // ── bulk enroll ─────────────────────────────────────────────────────

  async bulkEnroll(
    dto: BulkEnrollDto,
    actor: AccessTokenPayload,
  ): Promise<BulkEnrollResult> {
    const schoolId = actor.schoolId;
    const section = await this.loadSectionForSession(
      dto.sectionId,
      dto.sessionId,
      schoolId,
    );
    const groupId = section.groupId ?? null;
    const shiftId = section.shiftId ?? null;

    // Fetch once (validates existence + gives names for alphabetical order).
    const found = await this.students.findManyDetailed(
      dto.studentIds,
      schoolId,
    );
    const byId = new Map(found.map((s) => [s.id, s]));
    const ordered =
      (dto.rollStrategy ?? RollStrategy.NEXT) === RollStrategy.ALPHABETICAL
        ? [...found] // findManyDetailed already sorts by name
        : dto.studentIds
            .map((id) => byId.get(id))
            .filter((s): s is NonNullable<typeof s> => s != null);

    const skipped: Array<{ studentId: string; reason: string }> = [];
    for (const id of dto.studentIds) {
      if (!byId.has(id)) {
        skipped.push({ studentId: id, reason: 'Student not found' });
      }
    }

    const enrolled = await this.enrollments.withTransaction(async (tx) => {
      let nextRoll = await this.enrollments.maxRoll(
        dto.sessionId,
        dto.sectionId,
        tx,
      );
      const active = await this.enrollments.countActiveInSection(
        dto.sessionId,
        dto.sectionId,
        tx,
      );

      const rows: Enrollment[] = [];
      let admitted = 0;
      for (const student of ordered) {
        if (!ENROLLABLE_STUDENT_STATUS.has(student.status)) {
          skipped.push({
            studentId: student.id,
            reason: `Student is ${student.status}`,
          });
          continue;
        }
        const existing = await this.enrollments.findLiveByStudentSession(
          student.id,
          dto.sessionId,
          schoolId,
          tx,
        );
        if (existing) {
          skipped.push({
            studentId: student.id,
            reason: 'Already enrolled in this session',
          });
          continue;
        }
        if (
          section.capacity != null &&
          active + admitted + 1 > section.capacity
        ) {
          await this.assertCapacity(
            section,
            dto.sessionId,
            0,
            dto.overrideCapacity ?? false,
            actor,
            tx,
          );
        }
        nextRoll += 1;
        const row = await this.createRow(
          {
            schoolId,
            studentId: student.id,
            sessionId: dto.sessionId,
            classId: section.classId,
            sectionId: dto.sectionId,
            groupId,
            shiftId,
            rollNo: nextRoll,
            enrollmentDate: this.resolveDate(dto.enrollmentDate),
            type: dto.type ?? EnrollmentType.NEW,
            createdBy: actor.sub,
            updatedBy: actor.sub,
          },
          tx,
        );
        rows.push(row);
        admitted += 1;
      }
      return rows;
    });

    this.auditContext.set({
      entityType: 'Enrollment',
      entityId: dto.sectionId,
      newValues: {
        action: 'BULK_ENROLL',
        sectionId: dto.sectionId,
        enrolled: enrolled.length,
        skipped: skipped.length,
      },
    });

    const detailed = await Promise.all(
      enrolled.map((e) => this.getDetail(e.id, schoolId)),
    );
    return { enrolled: detailed, skipped };
  }

  // ── update / cancel ─────────────────────────────────────────────────

  async update(
    id: string,
    dto: UpdateEnrollmentDto,
    actor: AccessTokenPayload,
  ): Promise<EnrollmentWithRelations> {
    const schoolId = actor.schoolId;
    const existing = await this.enrollments.findByIdOrFail(id, schoolId);

    const groupId = dto.groupId !== undefined ? dto.groupId : existing.groupId;
    if (dto.optionalSubjectId !== undefined && dto.optionalSubjectId !== null) {
      await this.validateOptionalSubject(
        dto.optionalSubjectId,
        existing.classId,
        existing.sessionId,
        groupId,
        schoolId,
      );
    }

    if (dto.rollNo !== undefined && dto.rollNo !== existing.rollNo) {
      const taken = await this.enrollments.isRollTaken(
        existing.sessionId,
        existing.sectionId,
        dto.rollNo,
        id,
      );
      if (taken) {
        throw new ConflictException(
          `Roll ${dto.rollNo} is already used in this section`,
        );
      }
    }

    await this.enrollments.update(id, {
      ...(dto.rollNo !== undefined ? { rollNo: dto.rollNo } : {}),
      ...(dto.optionalSubjectId !== undefined
        ? { optionalSubjectId: dto.optionalSubjectId }
        : {}),
      ...(dto.groupId !== undefined ? { groupId: dto.groupId } : {}),
      ...(dto.shiftId !== undefined ? { shiftId: dto.shiftId } : {}),
      updatedBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'Enrollment',
      entityId: id,
      oldValues: {
        rollNo: existing.rollNo,
        optionalSubjectId: existing.optionalSubjectId,
      },
      newValues: dto,
    });
    return this.getDetail(id, schoolId);
  }

  /** Cancel an enrollment (frees the session slot + roll). */
  async cancel(
    id: string,
    dto: CancelEnrollmentDto,
    actor: AccessTokenPayload,
  ): Promise<void> {
    const existing = await this.enrollments.findByIdOrFail(id, actor.schoolId);
    if (existing.status === EnrollmentStatus.CANCELLED) {
      throw new BadRequestException('Enrollment is already cancelled');
    }
    await this.enrollments.update(id, {
      status: EnrollmentStatus.CANCELLED,
      updatedBy: actor.sub,
    });
    this.auditContext.set({
      entityType: 'Enrollment',
      entityId: id,
      oldValues: { status: existing.status },
      newValues: { status: EnrollmentStatus.CANCELLED, reason: dto.reason },
    });
  }

  // ── transfer ────────────────────────────────────────────────────────

  async transferSection(
    id: string,
    dto: TransferSectionDto,
    actor: AccessTokenPayload,
  ): Promise<EnrollmentWithRelations> {
    const schoolId = actor.schoolId;
    const existing = await this.enrollments.findByIdOrFail(id, schoolId);
    if (existing.status !== EnrollmentStatus.ACTIVE) {
      throw new BadRequestException(
        `Only ACTIVE enrollments can be transferred (this one is ${existing.status})`,
      );
    }
    if (dto.toSectionId === existing.sectionId) {
      throw new BadRequestException('Target section is the current section');
    }
    const target = await this.sections.findByIdOrFail(
      dto.toSectionId,
      schoolId,
    );
    if (target.sessionId !== existing.sessionId) {
      throw new BadRequestException(
        'Transfer target must be in the same session',
      );
    }
    if (target.classId !== existing.classId) {
      throw new BadRequestException(
        'Transfer target must belong to the same class',
      );
    }

    const updated = await this.enrollments.withTransaction(async (tx) => {
      await this.assertCapacity(
        target,
        existing.sessionId,
        1,
        dto.overrideCapacity ?? false,
        actor,
        tx,
      );

      const keepRoll = dto.keepRoll ?? true;
      let rollNo = existing.rollNo;
      if (
        !keepRoll ||
        (await this.enrollments.isRollTaken(
          existing.sessionId,
          dto.toSectionId,
          existing.rollNo,
          id,
          tx,
        ))
      ) {
        rollNo =
          (await this.enrollments.maxRoll(
            existing.sessionId,
            dto.toSectionId,
            tx,
          )) + 1;
      }

      const row = await this.enrollments.update(
        id,
        {
          sectionId: dto.toSectionId,
          groupId: target.groupId,
          shiftId: target.shiftId,
          rollNo,
          updatedBy: actor.sub,
        },
        tx,
      );
      await this.transfers.create(
        {
          schoolId,
          enrollmentId: id,
          fromSectionId: existing.sectionId,
          toSectionId: dto.toSectionId,
          fromRollNo: existing.rollNo,
          toRollNo: rollNo,
          reason: dto.reason,
          transferredBy: actor.sub,
        },
        tx,
      );
      return row;
    });

    this.auditContext.set({
      entityType: 'Enrollment',
      entityId: id,
      oldValues: {
        sectionId: existing.sectionId,
        rollNo: existing.rollNo,
      },
      newValues: { sectionId: dto.toSectionId, rollNo: updated.rollNo },
    });
    return this.getDetail(id, schoolId);
  }

  async transferHistory(id: string, schoolId: string) {
    await this.enrollments.findByIdOrFail(id, schoolId);
    return this.transfers.findForEnrollment(id);
  }

  // ── roll assignment (renumber a whole section) ──────────────────────

  async rollAssign(
    dto: RollAssignDto,
    actor: AccessTokenPayload,
  ): Promise<EnrollmentWithRelations[]> {
    const schoolId = actor.schoolId;
    await this.loadSectionForSession(dto.sectionId, dto.sessionId, schoolId);

    const roster = await this.enrollments.findSectionRoster(
      dto.sectionId,
      schoolId,
    );
    const ordered =
      dto.strategy === RenumberStrategy.ALPHABETICAL
        ? [...roster].sort(
            (a, b) =>
              a.student.lastName.localeCompare(b.student.lastName) ||
              a.student.firstName.localeCompare(b.student.firstName),
          )
        : [...roster].sort((a, b) => a.rollNo - b.rollNo);

    const start = dto.startFrom ?? 1;

    await this.enrollments.withTransaction(async (tx) => {
      // Two-phase to dodge the partial-unique index during renumbering:
      // park every roll at a negative temp value, then set the finals.
      for (let i = 0; i < ordered.length; i += 1) {
        await this.enrollments.update(ordered[i].id, { rollNo: -(i + 1) }, tx);
      }
      for (let i = 0; i < ordered.length; i += 1) {
        await this.enrollments.update(
          ordered[i].id,
          { rollNo: start + i, updatedBy: actor.sub },
          tx,
        );
      }
    });

    this.auditContext.set({
      entityType: 'Enrollment',
      entityId: dto.sectionId,
      newValues: {
        action: 'ROLL_ASSIGN',
        sectionId: dto.sectionId,
        strategy: dto.strategy,
        count: ordered.length,
      },
    });
    return this.enrollments.findSectionRoster(dto.sectionId, schoolId);
  }

  // ── internals ───────────────────────────────────────────────────────

  private async loadSectionForSession(
    sectionId: string,
    sessionId: string,
    schoolId: string,
  ): Promise<Section> {
    const section = await this.sections.findByIdOrFail(sectionId, schoolId);
    if (section.sessionId !== sessionId) {
      throw new BadRequestException(
        'Section does not belong to the given session',
      );
    }
    return section;
  }

  private async assertNotAlreadyEnrolled(
    studentId: string,
    sessionId: string,
    schoolId: string,
    tx: PrismaClientLike,
  ): Promise<void> {
    const existing = await this.enrollments.findLiveByStudentSession(
      studentId,
      sessionId,
      schoolId,
      tx,
    );
    if (existing) {
      throw new ConflictException(
        'Student is already enrolled in this session',
      );
    }
  }

  /** Capacity gate (roadmap M11 §6): override needs the permission. */
  private async assertCapacity(
    section: Section,
    sessionId: string,
    adding: number,
    override: boolean,
    actor: AccessTokenPayload,
    tx: PrismaClientLike,
  ): Promise<void> {
    if (section.capacity == null) return;
    const active = await this.enrollments.countActiveInSection(
      sessionId,
      section.id,
      tx,
    );
    if (active + adding <= section.capacity) return;

    if (!override) {
      throw new ConflictException(
        `Section is at capacity (${section.capacity}) — pass overrideCapacity=true (requires enrollment.capacity.override)`,
      );
    }
    if (actor.userType === UserType.SUPER_ADMIN) return;
    const codes = await this.permissions.getUserPermissionCodes(actor.sub);
    if (!codes.includes('enrollment.capacity.override')) {
      throw new ForbiddenException(
        'Exceeding section capacity requires enrollment.capacity.override',
      );
    }
  }

  private async resolveRoll(
    sessionId: string,
    sectionId: string,
    requested: number | undefined,
    tx: PrismaClientLike,
  ): Promise<number> {
    if (requested != null) {
      const taken = await this.enrollments.isRollTaken(
        sessionId,
        sectionId,
        requested,
        undefined,
        tx,
      );
      if (taken) {
        throw new ConflictException(
          `Roll ${requested} is already used in this section`,
        );
      }
      return requested;
    }
    const max = await this.enrollments.maxRoll(sessionId, sectionId, tx);
    return max + 1;
  }

  private async validateOptionalSubject(
    optionalSubjectId: string | null,
    classId: string,
    sessionId: string,
    groupId: string | null,
    schoolId: string,
  ): Promise<void> {
    if (!optionalSubjectId) return;
    const mappings = await this.classSubjects.findForClassSession(
      classId,
      sessionId,
      schoolId,
    );
    const match = mappings.find(
      (m) =>
        m.subjectId === optionalSubjectId &&
        m.isOptional &&
        (m.groupId === null || m.groupId === groupId),
    );
    if (!match) {
      throw new BadRequestException(
        'Optional subject is not an optional subject offered by this class for the session',
      );
    }
  }

  private resolveDate(input?: string): Date {
    if (input) return parseDate(input);
    return parseDate(new Date().toISOString().slice(0, 10));
  }

  private async createRow(
    data: Prisma.EnrollmentUncheckedCreateInput,
    tx: PrismaClientLike,
  ): Promise<Enrollment> {
    try {
      return await this.enrollments.create(data, tx);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'Enrollment conflicts with an existing roll or session enrollment (concurrent write) — retry',
        );
      }
      throw err;
    }
  }
}
