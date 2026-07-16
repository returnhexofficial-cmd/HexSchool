import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { CloneStructureDto } from '../dto';
import { AcademicSessionsRepository } from '../repositories/academic-sessions.repository';
import { ClassSubjectsRepository } from '../repositories/class-subjects.repository';
import { SectionsRepository } from '../repositories/sections.repository';

export interface CloneReport {
  preview: boolean;
  fromSession: string;
  toSession: string;
  sections: { toCreate: number; alreadyPresent: number };
  classSubjects: { toCreate: number; alreadyPresent: number };
}

/**
 * Yearly rollover (roadmap M06 §4): copy a session's sections and
 * class-subject maps into another session. Additive and idempotent —
 * rows whose identity already exists in the target are skipped, so a
 * partial manual setup survives a later clone. `preview` reports the
 * same numbers without writing. class_teacher_id is NOT copied
 * (assignments are per-session decisions, M08).
 */
@Injectable()
export class StructureCloneService {
  constructor(
    private readonly sessions: AcademicSessionsRepository,
    private readonly sections: SectionsRepository,
    private readonly classSubjects: ClassSubjectsRepository,
    private readonly auditContext: AuditContextService,
  ) {}

  async clone(
    dto: CloneStructureDto,
    actor: AccessTokenPayload,
  ): Promise<CloneReport> {
    const schoolId = actor.schoolId;
    if (dto.fromSessionId === dto.toSessionId) {
      throw new BadRequestException('Source and target must differ');
    }
    const [from, to] = await Promise.all([
      this.sessions.findByIdOrFail(dto.fromSessionId, schoolId),
      this.sessions.findByIdOrFail(dto.toSessionId, schoolId),
    ]);

    const [sourceSections, targetSections, sourceMaps, targetMaps] =
      await Promise.all([
        this.sections.findForSession(schoolId, from.id),
        this.sections.findForSession(schoolId, to.id),
        this.classSubjects.findForSession(schoolId, from.id),
        this.classSubjects.findForSession(schoolId, to.id),
      ]);

    const sectionKey = (s: {
      classId: string;
      name: string;
      shiftId: string | null;
    }) => `${s.classId}:${s.name.toLowerCase()}:${s.shiftId ?? '-'}`;
    const existingSections = new Set(targetSections.map(sectionKey));
    const newSections = sourceSections.filter(
      (s) => !existingSections.has(sectionKey(s)),
    );

    const mapKey = (m: {
      classId: string;
      subjectId: string;
      groupId: string | null;
    }) => `${m.classId}:${m.subjectId}:${m.groupId ?? '-'}`;
    const existingMaps = new Set(targetMaps.map(mapKey));
    const newMaps = sourceMaps.filter((m) => !existingMaps.has(mapKey(m)));

    const report: CloneReport = {
      preview: dto.preview ?? false,
      fromSession: from.name,
      toSession: to.name,
      sections: {
        toCreate: newSections.length,
        alreadyPresent: sourceSections.length - newSections.length,
      },
      classSubjects: {
        toCreate: newMaps.length,
        alreadyPresent: sourceMaps.length - newMaps.length,
      },
    };
    if (dto.preview) return report;

    await this.sections.withTransaction(async (tx) => {
      for (const s of newSections) {
        await tx.section.create({
          data: {
            schoolId,
            sessionId: to.id,
            classId: s.classId,
            name: s.name,
            shiftId: s.shiftId,
            groupId: s.groupId,
            capacity: s.capacity,
            roomNo: s.roomNo,
            // class_teacher_id intentionally not copied (M08 decision).
            createdBy: actor.sub,
            updatedBy: actor.sub,
          },
        });
      }
      if (newMaps.length > 0) {
        await tx.classSubject.createMany({
          data: newMaps.map((m) => ({
            schoolId,
            sessionId: to.id,
            classId: m.classId,
            subjectId: m.subjectId,
            groupId: m.groupId,
            isOptional: m.isOptional,
            fullMarksDefault: m.fullMarksDefault,
            displayOrder: m.displayOrder,
          })),
          skipDuplicates: true,
        });
      }
    });

    this.auditContext.set({
      entityType: 'AcademicStructure',
      entityId: to.id,
      newValues: {
        clonedFrom: from.name,
        sections: report.sections.toCreate,
        classSubjects: report.classSubjects.toCreate,
      },
    });
    return report;
  }
}
