import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Section } from '@prisma/client';
import { PaginatedResult } from '../../../common/dto/paginated.dto';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { SettingsService } from '../../school/services/settings.service';
import { TeachersRepository } from '../../teacher/repositories/teachers.repository';
import {
  CreateSectionDto,
  SectionListQueryDto,
  UpdateSectionDto,
} from '../dto';
import { AcademicSessionsRepository } from '../repositories/academic-sessions.repository';
import { ClassesRepository } from '../repositories/classes.repository';
import { GroupsRepository } from '../repositories/groups.repository';
import {
  SectionsRepository,
  SectionWithRelations,
} from '../repositories/sections.repository';
import { ShiftsRepository } from '../repositories/shifts.repository';

/**
 * Session-scoped sections (roadmap M06 §6): identity unique per
 * (school, session, class, name, shift); a group may only sit on a
 * class at/above the group's applicable level (BD: streams from class
 * 9); capacity is advisory here and enforced at enrollment (M11).
 * Mid-session sections are allowed — the UI warns about routines/seat
 * plans (M13/M14 regenerate manually).
 */
@Injectable()
export class SectionsService {
  constructor(
    private readonly sections: SectionsRepository,
    private readonly classes: ClassesRepository,
    private readonly sessions: AcademicSessionsRepository,
    private readonly shifts: ShiftsRepository,
    private readonly groups: GroupsRepository,
    private readonly teachers: TeachersRepository,
    private readonly settings: SettingsService,
    private readonly auditContext: AuditContextService,
  ) {}

  async list(
    query: SectionListQueryDto,
    schoolId: string,
  ): Promise<PaginatedResult<SectionWithRelations>> {
    return this.sections.paginateWithRelations(query, schoolId);
  }

  async create(
    dto: CreateSectionDto,
    actor: AccessTokenPayload,
  ): Promise<Section> {
    const schoolId = actor.schoolId;
    const klass = await this.classes.findByIdOrFail(dto.classId, schoolId);
    await this.sessions.findByIdOrFail(dto.sessionId, schoolId);
    if (dto.shiftId) await this.shifts.findByIdOrFail(dto.shiftId, schoolId);
    await this.assertGroupApplies(dto.groupId, klass.numericLevel, schoolId);
    if (dto.classTeacherId) {
      await this.assertClassTeacherAllowed(
        dto.classTeacherId,
        dto.sessionId,
        schoolId,
      );
    }

    const duplicate = await this.sections.findByIdentity({
      schoolId,
      sessionId: dto.sessionId,
      classId: dto.classId,
      name: dto.name,
      shiftId: dto.shiftId ?? null,
    });
    if (duplicate) {
      throw new ConflictException(
        `Section "${dto.name}" already exists for this class/session/shift`,
      );
    }

    const section = await this.sections.create({
      schoolId,
      ...dto,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });
    this.auditContext.set({
      entityType: 'Section',
      entityId: section.id,
      newValues: { class: klass.name, ...dto },
    });
    return section;
  }

  async update(
    id: string,
    dto: UpdateSectionDto,
    actor: AccessTokenPayload,
  ): Promise<Section> {
    const schoolId = actor.schoolId;
    const existing = await this.sections.findByIdOrFail(id, schoolId);
    const klass = await this.classes.findByIdOrFail(existing.classId, schoolId);

    const shiftId = dto.shiftId !== undefined ? dto.shiftId : existing.shiftId;
    const groupId = dto.groupId !== undefined ? dto.groupId : existing.groupId;
    if (shiftId) await this.shifts.findByIdOrFail(shiftId, schoolId);
    await this.assertGroupApplies(
      groupId ?? undefined,
      klass.numericLevel,
      schoolId,
    );
    if (dto.classTeacherId && dto.classTeacherId !== existing.classTeacherId) {
      await this.assertClassTeacherAllowed(
        dto.classTeacherId,
        existing.sessionId,
        schoolId,
        id,
      );
    }

    const name = dto.name ?? existing.name;
    const duplicate = await this.sections.findByIdentity({
      schoolId,
      sessionId: existing.sessionId,
      classId: existing.classId,
      name,
      shiftId: shiftId ?? null,
      excludeId: id,
    });
    if (duplicate) {
      throw new ConflictException(
        `Section "${name}" already exists for this class/session/shift`,
      );
    }

    const updated = await this.sections.update(id, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.shiftId !== undefined ? { shiftId: dto.shiftId } : {}),
      ...(dto.groupId !== undefined ? { groupId: dto.groupId } : {}),
      ...(dto.capacity !== undefined ? { capacity: dto.capacity } : {}),
      ...(dto.roomNo !== undefined ? { roomNo: dto.roomNo } : {}),
      ...(dto.classTeacherId !== undefined
        ? { classTeacherId: dto.classTeacherId }
        : {}),
      updatedBy: actor.sub,
    });
    this.auditContext.set({
      entityType: 'Section',
      entityId: id,
      oldValues: this.snapshot(existing),
      newValues: this.snapshot(updated),
    });
    return updated;
  }

  async remove(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.sections.findByIdOrFail(id, actor.schoolId);
    // Enrollment/attendance delete guards join in M11/M12.
    await this.sections.softDelete(id);
    this.auditContext.set({
      entityType: 'Section',
      entityId: id,
      oldValues: this.snapshot(existing),
    });
  }

  // ── internals ─────────────────────────────────────────────────────

  /** Groups apply only from their configured class level (M06 §6). */
  private async assertGroupApplies(
    groupId: string | undefined,
    classLevel: number,
    schoolId: string,
  ): Promise<void> {
    if (!groupId) return;
    const group = await this.groups.findByIdOrFail(groupId, schoolId);
    if (classLevel < group.applicableFromLevel) {
      throw new BadRequestException(
        `Group "${group.name}" applies from class level ${group.applicableFromLevel} — this class is level ${classLevel}`,
      );
    }
  }

  /** Class-teacher cap (M08 §6): at most N sections per teacher per
   *  session (setting `academic.max_class_teacher_sections`, default 1). */
  private async assertClassTeacherAllowed(
    teacherId: string,
    sessionId: string,
    schoolId: string,
    excludeSectionId?: string,
  ): Promise<void> {
    const teacher = await this.teachers.findByIdOrFail(teacherId, schoolId);
    if (teacher.status !== 'ACTIVE') {
      throw new BadRequestException(
        `Teacher is ${teacher.status} — only ACTIVE teachers can be class teachers`,
      );
    }
    const max = await this.settings.getValue<number>(
      schoolId,
      'academic.max_class_teacher_sections',
    );
    const held = await this.teachers.countClassTeacherSections(
      teacherId,
      sessionId,
      excludeSectionId,
    );
    if (held >= max) {
      throw new ConflictException(
        `This teacher is already class teacher of ${held} section(s) — the limit is ${max} per session`,
      );
    }
  }

  private snapshot(section: Section) {
    return {
      name: section.name,
      shiftId: section.shiftId,
      groupId: section.groupId,
      capacity: section.capacity,
      roomNo: section.roomNo,
      classTeacherId: section.classTeacherId,
    };
  }
}
