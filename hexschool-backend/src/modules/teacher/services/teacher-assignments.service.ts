import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TeacherSectionSubject } from '@prisma/client';
import { StaffStatus, UserType } from '../../../common/constants';
import { SectionsRepository } from '../../academic/repositories/sections.repository';
import { SubjectsRepository } from '../../academic/repositories/subjects.repository';
import { SessionsService } from '../../academic/services/sessions.service';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { PermissionsService } from '../../rbac/services/permissions.service';
import {
  AssignmentQueryDto,
  CreateAssignmentDto,
  TransferAssignmentsDto,
} from '../dto';
import { TIMETABLE_CONFLICT_CHECKER } from '../interfaces/timetable-conflict.interface';
import type { TimetableConflictChecker } from '../interfaces/timetable-conflict.interface';
import {
  AssignmentWithRelations,
  TeacherAssignmentsRepository,
} from '../repositories/teacher-assignments.repository';
import { TeacherSubjectsRepository } from '../repositories/teacher-subjects.repository';
import { TeachersRepository } from '../repositories/teachers.repository';

export interface WorkloadRow {
  teacherId: string;
  employeeId: string;
  name: string;
  designation: string;
  assignments: number;
}

/**
 * Section-subject assignments (roadmap M08 §4/§6): one teacher per
 * (session, section, subject) — assigning an occupied slot REPLACES the
 * holder (history stays in audit_logs). Expertise mismatches are refused
 * unless `override` is passed by an actor holding
 * `teacher.assign.override`. The timetable hook is a no-op until M13.
 */
@Injectable()
export class TeacherAssignmentsService {
  constructor(
    private readonly assignments: TeacherAssignmentsRepository,
    private readonly teachers: TeachersRepository,
    private readonly teacherSubjects: TeacherSubjectsRepository,
    private readonly sections: SectionsRepository,
    private readonly subjects: SubjectsRepository,
    private readonly sessions: SessionsService,
    private readonly permissions: PermissionsService,
    private readonly auditContext: AuditContextService,
    @Inject(TIMETABLE_CONFLICT_CHECKER)
    private readonly timetable: TimetableConflictChecker,
  ) {}

  async list(
    query: AssignmentQueryDto,
    schoolId: string,
  ): Promise<AssignmentWithRelations[]> {
    return this.assignments.list(
      {
        sessionId: query.sessionId,
        ...(query.sectionId ? { sectionId: query.sectionId } : {}),
        ...(query.teacherId ? { teacherId: query.teacherId } : {}),
      },
      schoolId,
    );
  }

  /** Interim schedule (M13 adds periods): a teacher's slots in a session. */
  async schedule(
    teacherId: string,
    sessionId: string,
    schoolId: string,
  ): Promise<AssignmentWithRelations[]> {
    await this.teachers.findByIdOrFail(teacherId, schoolId);
    return this.assignments.list({ sessionId, teacherId }, schoolId);
  }

  async assign(
    dto: CreateAssignmentDto,
    actor: AccessTokenPayload,
  ): Promise<AssignmentWithRelations> {
    const schoolId = actor.schoolId;
    await this.sessions.getById(dto.sessionId, schoolId);
    const section = await this.sections.findByIdOrFail(dto.sectionId, schoolId);
    if (section.sessionId !== dto.sessionId) {
      throw new BadRequestException(
        'Section does not belong to the given session',
      );
    }
    await this.subjects.findByIdOrFail(dto.subjectId, schoolId);
    const teacher = await this.teachers.findByIdOrFail(dto.teacherId, schoolId);
    if (teacher.status !== StaffStatus.ACTIVE) {
      throw new BadRequestException(
        `Teacher is ${teacher.status} — only ACTIVE teachers can be assigned`,
      );
    }

    await this.assertExpertiseOrOverride(
      dto.teacherId,
      dto.subjectId,
      dto.override ?? false,
      actor,
    );
    await this.timetable.assertNoConflict({
      sessionId: dto.sessionId,
      sectionId: dto.sectionId,
      subjectId: dto.subjectId,
      teacherId: dto.teacherId,
    });

    const previous = await this.assignments.findBySlot(
      dto.sessionId,
      dto.sectionId,
      dto.subjectId,
    );
    const saved = await this.assignments.upsertSlot({
      schoolId,
      sessionId: dto.sessionId,
      sectionId: dto.sectionId,
      subjectId: dto.subjectId,
      teacherId: dto.teacherId,
      actorId: actor.sub,
    });

    // Replacement history lives here (roadmap M08 §6).
    this.auditContext.set({
      entityType: 'TeacherAssignment',
      entityId: saved.id,
      oldValues: previous ? { teacherId: previous.teacherId } : undefined,
      newValues: {
        sessionId: dto.sessionId,
        sectionId: dto.sectionId,
        subjectId: dto.subjectId,
        teacherId: dto.teacherId,
        ...(dto.override ? { override: true } : {}),
      },
    });

    const rows = await this.assignments.list(
      { sessionId: dto.sessionId, sectionId: dto.sectionId },
      schoolId,
    );
    return rows.find((r) => r.id === saved.id)!;
  }

  async remove(id: string, actor: AccessTokenPayload): Promise<void> {
    const assignment = await this.getOwned(id, actor.schoolId);
    await this.assignments.remove(id);
    this.auditContext.set({
      entityType: 'TeacherAssignment',
      entityId: id,
      oldValues: {
        sessionId: assignment.sessionId,
        sectionId: assignment.sectionId,
        subjectId: assignment.subjectId,
        teacherId: assignment.teacherId,
      },
    });
  }

  /** Bulk-transfer helper for resignations (roadmap M08 §8). */
  async transfer(
    dto: TransferAssignmentsDto,
    actor: AccessTokenPayload,
  ): Promise<{ transferred: number }> {
    const schoolId = actor.schoolId;
    if (dto.fromTeacherId === dto.toTeacherId) {
      throw new BadRequestException('Source and target teacher are the same');
    }
    await this.teachers.findByIdOrFail(dto.fromTeacherId, schoolId);
    const target = await this.teachers.findByIdOrFail(
      dto.toTeacherId,
      schoolId,
    );
    if (target.status !== StaffStatus.ACTIVE) {
      throw new BadRequestException(
        `Target teacher is ${target.status} — only ACTIVE teachers can take over`,
      );
    }
    await this.sessions.getById(dto.sessionId, schoolId);

    // The target must cover every subject being handed over (or override).
    const subjectIds = await this.assignments.distinctSubjectIdsForTeacher(
      dto.fromTeacherId,
      dto.sessionId,
    );
    if (subjectIds.length === 0) {
      return { transferred: 0 };
    }
    const missing: string[] = [];
    for (const subjectId of subjectIds) {
      if (
        !(await this.teacherSubjects.hasExpertise(dto.toTeacherId, subjectId))
      ) {
        missing.push(subjectId);
      }
    }
    if (missing.length > 0) {
      await this.assertOverrideAllowed(
        dto.override ?? false,
        actor,
        `Target teacher lacks expertise in ${missing.length} subject(s) being transferred`,
      );
    }

    const transferred = await this.assignments.transferAll(
      dto.fromTeacherId,
      dto.toTeacherId,
      dto.sessionId,
      actor.sub,
    );

    this.auditContext.set({
      entityType: 'TeacherAssignment',
      entityId: dto.fromTeacherId,
      oldValues: { teacherId: dto.fromTeacherId, sessionId: dto.sessionId },
      newValues: {
        teacherId: dto.toTeacherId,
        transferred,
        ...(dto.override ? { override: true } : {}),
      },
    });
    return { transferred };
  }

  /** Interim workload = assignment counts (periods/week arrive with M13). */
  async workload(sessionId: string, schoolId: string): Promise<WorkloadRow[]> {
    await this.sessions.getById(sessionId, schoolId);
    const counts = await this.assignments.workloadCounts(sessionId, schoolId);
    if (counts.length === 0) return [];

    const teachers = await this.teachers.findAll(
      { id: { in: counts.map((c) => c.teacherId) } },
      schoolId,
    );
    const byId = new Map(teachers.map((t) => [t.id, t]));
    return counts
      .map((c) => {
        const teacher = byId.get(c.teacherId);
        return {
          teacherId: c.teacherId,
          employeeId: teacher?.employeeId ?? '—',
          name: teacher ? `${teacher.firstName} ${teacher.lastName}` : '—',
          designation: teacher?.designation ?? '—',
          assignments: c.assignments,
        };
      })
      .sort((a, b) => b.assignments - a.assignments);
  }

  // ── internals ─────────────────────────────────────────────────────

  private async getOwned(
    id: string,
    schoolId: string,
  ): Promise<TeacherSectionSubject> {
    const assignment = await this.assignments.findById(id);
    if (!assignment || assignment.schoolId !== schoolId) {
      throw new NotFoundException(`Assignment ${id} not found`);
    }
    return assignment;
  }

  /** Expertise rule (M08 §6): mismatch → 409 unless override + permission. */
  private async assertExpertiseOrOverride(
    teacherId: string,
    subjectId: string,
    override: boolean,
    actor: AccessTokenPayload,
  ): Promise<void> {
    if (await this.teacherSubjects.hasExpertise(teacherId, subjectId)) return;
    await this.assertOverrideAllowed(
      override,
      actor,
      'Teacher does not have this subject in their expertise set',
    );
  }

  private async assertOverrideAllowed(
    override: boolean,
    actor: AccessTokenPayload,
    problem: string,
  ): Promise<void> {
    if (!override) {
      throw new ConflictException(
        `${problem} — pass override=true (requires teacher.assign.override)`,
      );
    }
    if (actor.userType === UserType.SUPER_ADMIN) return;
    const codes = await this.permissions.getUserPermissionCodes(actor.sub);
    if (!codes.includes('teacher.assign.override')) {
      throw new ForbiddenException(
        'Overriding the expertise check requires teacher.assign.override',
      );
    }
  }
}
