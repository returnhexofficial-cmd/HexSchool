import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TeacherLeave } from '@prisma/client';
import { LeaveStatus } from '../../../common/constants';
import { PaginatedResult } from '../../../common/dto/paginated.dto';
import { isoDate, parseDate } from '../../academic/calendar/date.util';
import { SessionsService } from '../../academic/services/sessions.service';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { CreateLeaveDto, LeaveQueryDto, UpdateLeaveDto } from '../dto';
import { TEACHER_EVENTS } from '../events/teacher.events';
import type { TeacherLeaveApprovedEvent } from '../events/teacher.events';
import {
  LeaveWithTeacher,
  TeacherLeavesRepository,
} from '../repositories/teacher-leaves.repository';
import { TeachersRepository } from '../repositories/teachers.repository';

/**
 * Interim leave records (roadmap M08; the HR module M21 absorbs them).
 * Rules (§6/§7): from ≤ to, range inside the CURRENT session, and an
 * APPROVED leave may never overlap another APPROVED leave of the same
 * teacher — checked at create AND approve. Only PENDING rows can be
 * edited/deleted. `teacher.leave.approved` is the M12 attendance hook.
 */
@Injectable()
export class TeacherLeavesService {
  constructor(
    private readonly leaves: TeacherLeavesRepository,
    private readonly teachers: TeachersRepository,
    private readonly sessions: SessionsService,
    private readonly auditContext: AuditContextService,
    private readonly events: EventEmitter2,
  ) {}

  async list(
    query: LeaveQueryDto,
    schoolId: string,
  ): Promise<PaginatedResult<LeaveWithTeacher>> {
    return this.leaves.paginateList(query, schoolId);
  }

  async create(
    dto: CreateLeaveDto,
    actor: AccessTokenPayload,
  ): Promise<TeacherLeave> {
    const teacher = await this.teachers.findByIdOrFail(
      dto.teacherId,
      actor.schoolId,
    );
    const { from, to } = await this.assertValidRange(
      dto.fromDate,
      dto.toDate,
      actor.schoolId,
    );
    await this.assertNoApprovedOverlap(dto.teacherId, from, to);

    const leave = await this.leaves.create({
      schoolId: actor.schoolId,
      teacherId: dto.teacherId,
      fromDate: from,
      toDate: to,
      type: dto.type,
      reason: dto.reason,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });
    this.auditContext.set({
      entityType: 'TeacherLeave',
      entityId: leave.id,
      newValues: {
        teacher: `${teacher.firstName} ${teacher.lastName}`,
        ...dto,
      },
    });
    return leave;
  }

  async update(
    id: string,
    dto: UpdateLeaveDto,
    actor: AccessTokenPayload,
  ): Promise<TeacherLeave> {
    const existing = await this.getOwnedPending(id, actor.schoolId, 'edited');
    const { from, to } = await this.assertValidRange(
      dto.fromDate ?? isoDate(existing.fromDate),
      dto.toDate ?? isoDate(existing.toDate),
      actor.schoolId,
    );
    await this.assertNoApprovedOverlap(existing.teacherId, from, to, id);

    const updated = await this.leaves.update(id, {
      fromDate: from,
      toDate: to,
      ...(dto.type !== undefined ? { type: dto.type } : {}),
      ...(dto.reason !== undefined ? { reason: dto.reason } : {}),
      updatedBy: actor.sub,
    });
    this.auditContext.set({
      entityType: 'TeacherLeave',
      entityId: id,
      oldValues: this.snapshot(existing),
      newValues: this.snapshot(updated),
    });
    return updated;
  }

  async remove(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.getOwnedPending(id, actor.schoolId, 'deleted');
    await this.leaves.hardDelete(id);
    this.auditContext.set({
      entityType: 'TeacherLeave',
      entityId: id,
      oldValues: this.snapshot(existing),
    });
  }

  async approve(id: string, actor: AccessTokenPayload): Promise<TeacherLeave> {
    const existing = await this.getOwnedPending(id, actor.schoolId, 'approved');
    await this.assertNoApprovedOverlap(
      existing.teacherId,
      existing.fromDate,
      existing.toDate,
      id,
    );

    const approved = await this.leaves.update(id, {
      status: LeaveStatus.APPROVED,
      approvedBy: actor.sub,
      updatedBy: actor.sub,
    });

    // M12 attendance subscribes to this to mark Leave days.
    this.events.emit(TEACHER_EVENTS.LEAVE_APPROVED, {
      leaveId: id,
      teacherId: existing.teacherId,
      schoolId: actor.schoolId,
      fromDate: isoDate(existing.fromDate),
      toDate: isoDate(existing.toDate),
      type: existing.type,
    } satisfies TeacherLeaveApprovedEvent);

    this.auditContext.set({
      entityType: 'TeacherLeave',
      entityId: id,
      oldValues: { status: LeaveStatus.PENDING },
      newValues: { status: LeaveStatus.APPROVED },
    });
    return approved;
  }

  async reject(id: string, actor: AccessTokenPayload): Promise<TeacherLeave> {
    await this.getOwnedPending(id, actor.schoolId, 'rejected');
    const rejected = await this.leaves.update(id, {
      status: LeaveStatus.REJECTED,
      approvedBy: actor.sub,
      updatedBy: actor.sub,
    });
    this.auditContext.set({
      entityType: 'TeacherLeave',
      entityId: id,
      oldValues: { status: LeaveStatus.PENDING },
      newValues: { status: LeaveStatus.REJECTED },
    });
    return rejected;
  }

  // ── internals ─────────────────────────────────────────────────────

  private async getOwnedPending(
    id: string,
    schoolId: string,
    verb: string,
  ): Promise<TeacherLeave> {
    const leave = await this.leaves.findById(id, schoolId);
    if (!leave) throw new NotFoundException(`Leave ${id} not found`);
    if (leave.status !== LeaveStatus.PENDING) {
      throw new BadRequestException(
        `Only PENDING leaves can be ${verb} — this one is ${leave.status}`,
      );
    }
    return leave;
  }

  /** from ≤ to, inside the current session's dates (M08 §7). */
  private async assertValidRange(
    fromDate: string,
    toDate: string,
    schoolId: string,
  ): Promise<{ from: Date; to: Date }> {
    const from = parseDate(fromDate);
    const to = parseDate(toDate);
    if (from.getTime() > to.getTime()) {
      throw new BadRequestException('fromDate must be on or before toDate');
    }

    const current = await this.sessions.getCurrent(schoolId);
    if (!current) {
      throw new BadRequestException(
        'No current academic session — activate one before recording leaves',
      );
    }
    if (
      from.getTime() < current.startDate.getTime() ||
      to.getTime() > current.endDate.getTime()
    ) {
      throw new BadRequestException(
        `Leave must fall within the current session (${isoDate(current.startDate)} – ${isoDate(current.endDate)})`,
      );
    }
    return { from, to };
  }

  private async assertNoApprovedOverlap(
    teacherId: string,
    from: Date,
    to: Date,
    excludeId?: string,
  ): Promise<void> {
    const overlaps = await this.leaves.countApprovedOverlaps(
      teacherId,
      from,
      to,
      excludeId,
    );
    if (overlaps > 0) {
      throw new ConflictException(
        'This range overlaps an already-approved leave of the same teacher',
      );
    }
  }

  private snapshot(leave: TeacherLeave) {
    return {
      teacherId: leave.teacherId,
      fromDate: isoDate(leave.fromDate),
      toDate: isoDate(leave.toDate),
      type: leave.type,
      status: leave.status,
      reason: leave.reason,
    };
  }
}
