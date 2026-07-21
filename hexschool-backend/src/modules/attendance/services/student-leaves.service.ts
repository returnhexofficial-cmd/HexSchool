import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LeaveStatus, StudentLeaveAppliedBy } from '../../../common/constants';
import { PaginatedResult } from '../../../common/dto/paginated.dto';
import { parseDate } from '../../academic/calendar/date.util';
import { AcademicSessionsRepository } from '../../academic/repositories/academic-sessions.repository';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { EnrollmentsRepository } from '../../enrollment/repositories/enrollments.repository';
import { StudentsRepository } from '../../student/repositories/students.repository';
import {
  CreateStudentLeaveDto,
  DecideStudentLeaveDto,
  StudentLeaveQueryDto,
  UpdateStudentLeaveDto,
} from '../dto';
import { StudentAttendancesRepository } from '../repositories/student-attendances.repository';
import {
  StudentLeaveApplicationsRepository,
  StudentLeaveWithRelations,
} from '../repositories/student-leave-applications.repository';

export interface LeaveDecisionResult {
  leave: StudentLeaveWithRelations;
  /** Already-recorded ABSENT/HALF_DAY days flipped to LEAVE on approval. */
  correctedDays: number;
}

/**
 * Student leave applications (roadmap M12 §3). Approving one is the
 * retroactive fix the roadmap asks for: every already-marked
 * ABSENT/HALF_DAY inside the range becomes LEAVE, and future marking
 * picks the override up through `findApprovedCovering`.
 */
@Injectable()
export class StudentLeavesService {
  constructor(
    private readonly leaves: StudentLeaveApplicationsRepository,
    private readonly attendances: StudentAttendancesRepository,
    private readonly students: StudentsRepository,
    private readonly enrollments: EnrollmentsRepository,
    private readonly sessions: AcademicSessionsRepository,
    private readonly auditContext: AuditContextService,
  ) {}

  async list(
    query: StudentLeaveQueryDto,
    schoolId: string,
  ): Promise<PaginatedResult<StudentLeaveWithRelations>> {
    return this.leaves.paginateList(query, schoolId);
  }

  async getDetail(
    id: string,
    schoolId: string,
  ): Promise<StudentLeaveWithRelations> {
    const leave = await this.leaves.findDetail(id, schoolId);
    if (!leave)
      throw new NotFoundException(`Leave application ${id} not found`);
    return leave;
  }

  async create(
    dto: CreateStudentLeaveDto,
    actor: AccessTokenPayload,
  ): Promise<StudentLeaveWithRelations> {
    const schoolId = actor.schoolId;
    const student = await this.students.findByIdOrFail(dto.studentId, schoolId);
    const { fromDate, toDate } = this.parseRange(dto.fromDate, dto.toDate);

    const sessionId = await this.resolveSession(
      dto.sessionId,
      student.id,
      schoolId,
    );
    const session = await this.sessions.findByIdOrFail(sessionId, schoolId);
    if (
      fromDate.getTime() < session.startDate.getTime() ||
      toDate.getTime() > session.endDate.getTime()
    ) {
      throw new BadRequestException(
        `Leave dates must fall inside session ${session.name}`,
      );
    }

    const overlapping = await this.leaves.findOverlapping(
      student.id,
      fromDate,
      toDate,
    );
    if (overlapping.length > 0) {
      throw new ConflictException(
        'An open or approved leave already covers part of this range',
      );
    }

    const created = await this.leaves.create({
      schoolId,
      studentId: student.id,
      sessionId,
      fromDate,
      toDate,
      reason: dto.reason,
      appliedBy: dto.appliedBy ?? StudentLeaveAppliedBy.ADMIN,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'StudentLeaveApplication',
      entityId: created.id,
      newValues: {
        studentUid: student.studentUid,
        fromDate: dto.fromDate,
        toDate: dto.toDate,
        status: LeaveStatus.PENDING,
      },
    });
    return this.getDetail(created.id, schoolId);
  }

  async update(
    id: string,
    dto: UpdateStudentLeaveDto,
    actor: AccessTokenPayload,
  ): Promise<StudentLeaveWithRelations> {
    const schoolId = actor.schoolId;
    const existing = await this.getDetail(id, schoolId);
    this.assertPending(existing.status, 'edited');

    const fromDate = dto.fromDate ? parseDate(dto.fromDate) : existing.fromDate;
    const toDate = dto.toDate ? parseDate(dto.toDate) : existing.toDate;
    if (fromDate.getTime() > toDate.getTime()) {
      throw new BadRequestException('fromDate must be on or before toDate');
    }

    const overlapping = await this.leaves.findOverlapping(
      existing.studentId,
      fromDate,
      toDate,
      id,
    );
    if (overlapping.length > 0) {
      throw new ConflictException(
        'An open or approved leave already covers part of this range',
      );
    }

    await this.leaves.update(id, {
      fromDate,
      toDate,
      ...(dto.reason !== undefined ? { reason: dto.reason } : {}),
      updatedBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'StudentLeaveApplication',
      entityId: id,
      oldValues: {
        fromDate: existing.fromDate,
        toDate: existing.toDate,
        reason: existing.reason,
      },
      newValues: dto,
    });
    return this.getDetail(id, schoolId);
  }

  async remove(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.getDetail(id, actor.schoolId);
    this.assertPending(existing.status, 'deleted');
    await this.leaves.softDelete(id);
    this.auditContext.set({
      entityType: 'StudentLeaveApplication',
      entityId: id,
      oldValues: { status: existing.status },
      newValues: { deleted: true },
    });
  }

  /** APPROVE → retro-mark the covered days as LEAVE (roadmap M12 §6). */
  async approve(
    id: string,
    dto: DecideStudentLeaveDto,
    actor: AccessTokenPayload,
  ): Promise<LeaveDecisionResult> {
    const schoolId = actor.schoolId;
    const existing = await this.getDetail(id, schoolId);
    this.assertPending(existing.status, 'approved');

    // Every enrollment the student held in this session — a mid-year
    // section transfer leaves attendance rows on both enrollments.
    const enrollments = await this.enrollments.findAll(
      { studentId: existing.studentId, sessionId: existing.sessionId },
      schoolId,
    );

    const correctedDays = await this.leaves.withTransaction(async (tx) => {
      await this.leaves.update(
        id,
        {
          status: LeaveStatus.APPROVED,
          approvedBy: actor.sub,
          approvedAt: new Date(),
          decisionNote: dto.note ?? null,
          updatedBy: actor.sub,
        },
        tx,
      );
      return this.attendances.convertAbsentToLeave(
        enrollments.map((e) => e.id),
        existing.fromDate,
        existing.toDate,
        actor.sub,
        tx,
      );
    });

    this.auditContext.set({
      entityType: 'StudentLeaveApplication',
      entityId: id,
      oldValues: { status: LeaveStatus.PENDING },
      newValues: {
        status: LeaveStatus.APPROVED,
        note: dto.note,
        correctedDays,
      },
    });
    return { leave: await this.getDetail(id, schoolId), correctedDays };
  }

  async reject(
    id: string,
    dto: DecideStudentLeaveDto,
    actor: AccessTokenPayload,
  ): Promise<StudentLeaveWithRelations> {
    const schoolId = actor.schoolId;
    const existing = await this.getDetail(id, schoolId);
    this.assertPending(existing.status, 'rejected');

    await this.leaves.update(id, {
      status: LeaveStatus.REJECTED,
      approvedBy: actor.sub,
      approvedAt: new Date(),
      decisionNote: dto.note ?? null,
      updatedBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'StudentLeaveApplication',
      entityId: id,
      oldValues: { status: LeaveStatus.PENDING },
      newValues: { status: LeaveStatus.REJECTED, note: dto.note },
    });
    return this.getDetail(id, schoolId);
  }

  // ── internals ───────────────────────────────────────────────────────

  private parseRange(
    from: string,
    to: string,
  ): {
    fromDate: Date;
    toDate: Date;
  } {
    const fromDate = parseDate(from);
    const toDate = parseDate(to);
    if (fromDate.getTime() > toDate.getTime()) {
      throw new BadRequestException('fromDate must be on or before toDate');
    }
    return { fromDate, toDate };
  }

  /** Explicit session, else the student's live enrollment session. */
  private async resolveSession(
    sessionId: string | undefined,
    studentId: string,
    schoolId: string,
  ): Promise<string> {
    if (sessionId) return sessionId;
    const current = await this.sessions.findCurrent(schoolId);
    if (!current) {
      throw new BadRequestException(
        'No current academic session — pass sessionId explicitly',
      );
    }
    const enrollment = await this.enrollments.findLiveByStudentSession(
      studentId,
      current.id,
      schoolId,
    );
    if (!enrollment) {
      throw new BadRequestException(
        `Student has no active enrollment in ${current.name}`,
      );
    }
    return current.id;
  }

  private assertPending(status: LeaveStatus, verb: string): void {
    if (status !== LeaveStatus.PENDING) {
      throw new BadRequestException(
        `Only PENDING applications can be ${verb} (this one is ${status})`,
      );
    }
  }
}
