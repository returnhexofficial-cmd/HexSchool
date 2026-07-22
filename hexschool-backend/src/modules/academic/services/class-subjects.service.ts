import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { UpdateClassSubjectsDto } from '../dto';
import { AcademicSessionsRepository } from '../repositories/academic-sessions.repository';
import { ClassesRepository } from '../repositories/classes.repository';
import {
  ClassSubjectsRepository,
  ClassSubjectWithRelations,
} from '../repositories/class-subjects.repository';
import { GroupsRepository } from '../repositories/groups.repository';
import { SubjectsRepository } from '../repositories/subjects.repository';
import { MarksRepository } from '../../result/repositories/marks.repository';

/**
 * Curriculum mapping (roadmap M06 §4): GET/PUT a class's subjects for
 * one session. PUT is a full replacement (bulk assign) — order,
 * optional flag (4th subject), default full marks, per-group rows.
 * **A subject cannot be removed once marks exist for it** — live since
 * M15, over a re-provisioned marks repository.
 */
@Injectable()
export class ClassSubjectsService {
  constructor(
    private readonly classSubjects: ClassSubjectsRepository,
    private readonly classes: ClassesRepository,
    private readonly subjects: SubjectsRepository,
    private readonly sessions: AcademicSessionsRepository,
    private readonly groups: GroupsRepository,
    private readonly auditContext: AuditContextService,
    private readonly marks: MarksRepository,
  ) {}

  async getForClass(
    classId: string,
    sessionId: string,
    schoolId: string,
  ): Promise<ClassSubjectWithRelations[]> {
    await this.classes.findByIdOrFail(classId, schoolId);
    await this.sessions.findByIdOrFail(sessionId, schoolId);
    return this.classSubjects.findForClassSession(classId, sessionId, schoolId);
  }

  async replaceForClass(
    classId: string,
    dto: UpdateClassSubjectsDto,
    actor: AccessTokenPayload,
  ): Promise<ClassSubjectWithRelations[]> {
    const schoolId = actor.schoolId;
    const klass = await this.classes.findByIdOrFail(classId, schoolId);
    await this.sessions.findByIdOrFail(dto.sessionId, schoolId);

    // No duplicate (subject, group) pairs within the payload.
    const identities = dto.subjects.map(
      (row) => `${row.subjectId}:${row.groupId ?? '-'}`,
    );
    if (new Set(identities).size !== identities.length) {
      throw new BadRequestException(
        'Duplicate subject/group combination in the payload',
      );
    }

    // Referenced subjects/groups must exist (and groups must apply).
    const subjectIds = [...new Set(dto.subjects.map((r) => r.subjectId))];
    const found = await this.subjects.findAll(
      { id: { in: subjectIds } },
      schoolId,
    );
    if (found.length !== subjectIds.length) {
      const known = new Set(found.map((s) => s.id));
      const missing = subjectIds.filter((sid) => !known.has(sid));
      throw new BadRequestException(
        `Unknown subject id(s): ${missing.join(', ')}`,
      );
    }
    const groupIds = [
      ...new Set(dto.subjects.flatMap((r) => (r.groupId ? [r.groupId] : []))),
    ];
    for (const groupId of groupIds) {
      const group = await this.groups.findByIdOrFail(groupId, schoolId);
      if (klass.numericLevel < group.applicableFromLevel) {
        throw new BadRequestException(
          `Group "${group.name}" applies from class level ${group.applicableFromLevel} — this class is level ${klass.numericLevel}`,
        );
      }
    }

    const before = await this.classSubjects.findForClassSession(
      classId,
      dto.sessionId,
      schoolId,
    );

    // The M06 "subject removal blocked once marks exist" slot, armed by
    // Module 15. Dropping a subject from the curriculum does not delete
    // the exam papers already set on it, but it does make an existing
    // result unexplainable — the report card would carry a subject the
    // class is no longer mapped to. Removals are therefore refused;
    // adding and re-ordering stay unconditional.
    const keptSubjects = new Set(dto.subjects.map((row) => row.subjectId));
    const removedSubjects = [
      ...new Set(
        before
          .map((row) => row.subjectId)
          .filter((subjectId) => !keptSubjects.has(subjectId)),
      ),
    ];
    for (const subjectId of removedSubjects) {
      const marks = await this.marks.countForClassSubject(
        classId,
        subjectId,
        dto.sessionId,
      );
      if (marks > 0) {
        const label =
          before.find((row) => row.subjectId === subjectId)?.subject.name ??
          subjectId;
        throw new ConflictException(
          `Cannot remove "${label}" from this class: ${marks} exam mark(s) have already been entered for it this session`,
        );
      }
    }

    await this.classSubjects.replaceForClassSession(
      { schoolId, classId, sessionId: dto.sessionId },
      dto.subjects.map((row, index) => ({
        subjectId: row.subjectId,
        groupId: row.groupId ?? null,
        isOptional: row.isOptional ?? false,
        fullMarksDefault: row.fullMarksDefault ?? 100,
        displayOrder: row.displayOrder ?? index,
      })),
    );

    const after = await this.classSubjects.findForClassSession(
      classId,
      dto.sessionId,
      schoolId,
    );
    this.auditContext.set({
      entityType: 'ClassSubjects',
      entityId: classId,
      oldValues: { subjects: before.map((r) => this.label(r)) },
      newValues: { subjects: after.map((r) => this.label(r)) },
    });
    return after;
  }

  private label(row: ClassSubjectWithRelations): string {
    return [
      row.subject.code,
      row.group ? `[${row.group.name}]` : null,
      row.isOptional ? '(optional)' : null,
    ]
      .filter(Boolean)
      .join(' ');
  }
}
