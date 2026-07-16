import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Department, Group, SchoolClass, Shift, Subject } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { PaginatedResult } from '../../../common/dto/paginated.dto';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import {
  CreateClassDto,
  CreateDepartmentDto,
  CreateGroupDto,
  CreateShiftDto,
  CreateSubjectDto,
  UpdateClassDto,
  UpdateDepartmentDto,
  UpdateGroupDto,
  UpdateShiftDto,
  UpdateSubjectDto,
} from '../dto';
import { ClassesRepository } from '../repositories/classes.repository';
import { DepartmentsRepository } from '../repositories/departments.repository';
import { GroupsRepository } from '../repositories/groups.repository';
import { ShiftsRepository } from '../repositories/shifts.repository';
import { SubjectsRepository } from '../repositories/subjects.repository';

/** "HH:MM" wall clock ↔ TIME column (Prisma maps TIME to a 1970 Date). */
export const timeToDate = (hhmm: string): Date =>
  new Date(`1970-01-01T${hhmm}:00.000Z`);
export const dateToTime = (date: Date): string =>
  date.toISOString().slice(11, 16);

/**
 * CRUD for the five session-independent masters (roadmap M06):
 * departments, shifts, classes, groups, subjects. Uniqueness conflicts
 * → 409; deletes are guarded with explanatory 409s while live rows
 * still reference the master (M06 §4; marks/enrollment guards join in
 * M11/M15).
 */
@Injectable()
export class MastersService {
  constructor(
    private readonly departments: DepartmentsRepository,
    private readonly shifts: ShiftsRepository,
    private readonly classes: ClassesRepository,
    private readonly groups: GroupsRepository,
    private readonly subjects: SubjectsRepository,
    private readonly auditContext: AuditContextService,
  ) {}

  // ── Departments ───────────────────────────────────────────────────

  async listDepartments(
    query: PaginationQueryDto,
    schoolId: string,
  ): Promise<PaginatedResult<Department>> {
    return this.departments.paginate(query, {
      schoolId,
      searchColumns: ['name', 'code'],
      sortableColumns: ['name', 'code', 'createdAt'],
    });
  }

  async createDepartment(
    dto: CreateDepartmentDto,
    actor: AccessTokenPayload,
  ): Promise<Department> {
    await this.assertUnique(
      this.departments.findOne({ code: dto.code }, actor.schoolId),
      `Department code "${dto.code}" already exists`,
    );
    const department = await this.departments.create({
      schoolId: actor.schoolId,
      ...dto,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });
    this.audit('Department', department.id, undefined, dto);
    return department;
  }

  async updateDepartment(
    id: string,
    dto: UpdateDepartmentDto,
    actor: AccessTokenPayload,
  ): Promise<Department> {
    const existing = await this.departments.findByIdOrFail(id, actor.schoolId);
    if (dto.code && dto.code !== existing.code) {
      await this.assertUnique(
        this.departments.findOne({ code: dto.code }, actor.schoolId),
        `Department code "${dto.code}" already exists`,
      );
    }
    const updated = await this.departments.update(id, {
      ...dto,
      updatedBy: actor.sub,
    });
    this.audit(
      'Department',
      id,
      { name: existing.name, code: existing.code },
      { name: updated.name, code: updated.code },
    );
    return updated;
  }

  async removeDepartment(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.departments.findByIdOrFail(id, actor.schoolId);
    const refs = await this.departments.countReferences(id);
    if (refs > 0) {
      throw new ConflictException(
        `${refs} subject(s) still belong to this department — reassign them first`,
      );
    }
    await this.departments.softDelete(id);
    this.audit('Department', id, { name: existing.name });
  }

  // ── Shifts ────────────────────────────────────────────────────────

  async listShifts(
    query: PaginationQueryDto,
    schoolId: string,
  ): Promise<PaginatedResult<Shift>> {
    return this.shifts.paginate(query, {
      schoolId,
      searchColumns: ['name'],
      sortableColumns: ['name', 'createdAt'],
    });
  }

  async createShift(
    dto: CreateShiftDto,
    actor: AccessTokenPayload,
  ): Promise<Shift> {
    this.assertShiftTimes(dto.startTime, dto.endTime);
    await this.assertUnique(
      this.shifts.findOne({ name: dto.name }, actor.schoolId),
      `Shift "${dto.name}" already exists`,
    );
    const shift = await this.shifts.create({
      schoolId: actor.schoolId,
      name: dto.name,
      startTime: timeToDate(dto.startTime),
      endTime: timeToDate(dto.endTime),
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });
    this.audit('Shift', shift.id, undefined, dto);
    return shift;
  }

  async updateShift(
    id: string,
    dto: UpdateShiftDto,
    actor: AccessTokenPayload,
  ): Promise<Shift> {
    const existing = await this.shifts.findByIdOrFail(id, actor.schoolId);
    const startTime = dto.startTime ?? dateToTime(existing.startTime);
    const endTime = dto.endTime ?? dateToTime(existing.endTime);
    this.assertShiftTimes(startTime, endTime);
    if (dto.name && dto.name !== existing.name) {
      await this.assertUnique(
        this.shifts.findOne({ name: dto.name }, actor.schoolId),
        `Shift "${dto.name}" already exists`,
      );
    }
    const updated = await this.shifts.update(id, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      startTime: timeToDate(startTime),
      endTime: timeToDate(endTime),
      updatedBy: actor.sub,
    });
    this.audit(
      'Shift',
      id,
      {
        name: existing.name,
        startTime: dateToTime(existing.startTime),
        endTime: dateToTime(existing.endTime),
      },
      { name: updated.name, startTime, endTime },
    );
    return updated;
  }

  async removeShift(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.shifts.findByIdOrFail(id, actor.schoolId);
    const refs = await this.shifts.countReferences(id);
    if (refs > 0) {
      throw new ConflictException(
        `${refs} section(s) still use this shift — move them first`,
      );
    }
    await this.shifts.hardDelete(id);
    this.audit('Shift', id, { name: existing.name });
  }

  // ── Classes ───────────────────────────────────────────────────────

  async listClasses(
    query: PaginationQueryDto,
    schoolId: string,
  ): Promise<PaginatedResult<SchoolClass>> {
    return this.classes.paginate(query, {
      schoolId,
      searchColumns: ['name', 'nameBn'],
      sortableColumns: ['name', 'numericLevel', 'displayOrder', 'createdAt'],
    });
  }

  async getClass(id: string, schoolId: string): Promise<SchoolClass> {
    return this.classes.findByIdOrFail(id, schoolId);
  }

  async createClass(
    dto: CreateClassDto,
    actor: AccessTokenPayload,
  ): Promise<SchoolClass> {
    await this.assertUnique(
      this.classes.findOne({ numericLevel: dto.numericLevel }, actor.schoolId),
      `A class with level ${dto.numericLevel} already exists`,
    );
    const created = await this.classes.create({
      schoolId: actor.schoolId,
      ...dto,
      displayOrder: dto.displayOrder ?? dto.numericLevel,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });
    this.audit('Class', created.id, undefined, dto);
    return created;
  }

  async updateClass(
    id: string,
    dto: UpdateClassDto,
    actor: AccessTokenPayload,
  ): Promise<SchoolClass> {
    const existing = await this.classes.findByIdOrFail(id, actor.schoolId);
    if (
      dto.numericLevel !== undefined &&
      dto.numericLevel !== existing.numericLevel
    ) {
      await this.assertUnique(
        this.classes.findOne(
          { numericLevel: dto.numericLevel },
          actor.schoolId,
        ),
        `A class with level ${dto.numericLevel} already exists`,
      );
    }
    const updated = await this.classes.update(id, {
      ...dto,
      updatedBy: actor.sub,
    });
    this.audit(
      'Class',
      id,
      { name: existing.name, numericLevel: existing.numericLevel },
      { name: updated.name, numericLevel: updated.numericLevel },
    );
    return updated;
  }

  async removeClass(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.classes.findByIdOrFail(id, actor.schoolId);
    const refs = await this.classes.countReferences(id);
    if (refs > 0) {
      throw new ConflictException(
        `Class has ${refs} section(s)/subject mapping(s) — remove them first`,
      );
    }
    await this.classes.softDelete(id);
    this.audit('Class', id, { name: existing.name });
  }

  // ── Groups ────────────────────────────────────────────────────────

  async listGroups(
    query: PaginationQueryDto,
    schoolId: string,
  ): Promise<PaginatedResult<Group>> {
    return this.groups.paginate(query, {
      schoolId,
      searchColumns: ['name'],
      sortableColumns: ['name', 'applicableFromLevel', 'createdAt'],
    });
  }

  async createGroup(
    dto: CreateGroupDto,
    actor: AccessTokenPayload,
  ): Promise<Group> {
    await this.assertUnique(
      this.groups.findOne({ name: dto.name }, actor.schoolId),
      `Group "${dto.name}" already exists`,
    );
    const group = await this.groups.create({
      schoolId: actor.schoolId,
      ...dto,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });
    this.audit('Group', group.id, undefined, dto);
    return group;
  }

  async updateGroup(
    id: string,
    dto: UpdateGroupDto,
    actor: AccessTokenPayload,
  ): Promise<Group> {
    const existing = await this.groups.findByIdOrFail(id, actor.schoolId);
    if (dto.name && dto.name !== existing.name) {
      await this.assertUnique(
        this.groups.findOne({ name: dto.name }, actor.schoolId),
        `Group "${dto.name}" already exists`,
      );
    }
    const updated = await this.groups.update(id, {
      ...dto,
      updatedBy: actor.sub,
    });
    this.audit(
      'Group',
      id,
      {
        name: existing.name,
        applicableFromLevel: existing.applicableFromLevel,
      },
      { name: updated.name, applicableFromLevel: updated.applicableFromLevel },
    );
    return updated;
  }

  async removeGroup(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.groups.findByIdOrFail(id, actor.schoolId);
    const refs = await this.groups.countReferences(id);
    if (refs > 0) {
      throw new ConflictException(
        `${refs} section(s)/subject mapping(s) still use this group`,
      );
    }
    await this.groups.softDelete(id);
    this.audit('Group', id, { name: existing.name });
  }

  // ── Subjects ──────────────────────────────────────────────────────

  async listSubjects(
    query: PaginationQueryDto,
    schoolId: string,
  ): Promise<PaginatedResult<Subject>> {
    return this.subjects.paginate(query, {
      schoolId,
      searchColumns: ['name', 'nameBn', 'code'],
      sortableColumns: ['name', 'code', 'type', 'createdAt'],
    });
  }

  async createSubject(
    dto: CreateSubjectDto,
    actor: AccessTokenPayload,
  ): Promise<Subject> {
    await this.assertUnique(
      this.subjects.findOne({ code: dto.code }, actor.schoolId),
      `Subject code "${dto.code}" already exists`,
    );
    await this.assertDepartment(dto.departmentId, actor.schoolId);
    const subject = await this.subjects.create({
      schoolId: actor.schoolId,
      ...dto,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });
    this.audit('Subject', subject.id, undefined, dto);
    return subject;
  }

  async updateSubject(
    id: string,
    dto: UpdateSubjectDto,
    actor: AccessTokenPayload,
  ): Promise<Subject> {
    const existing = await this.subjects.findByIdOrFail(id, actor.schoolId);
    if (dto.code && dto.code !== existing.code) {
      await this.assertUnique(
        this.subjects.findOne({ code: dto.code }, actor.schoolId),
        `Subject code "${dto.code}" already exists`,
      );
    }
    await this.assertDepartment(dto.departmentId, actor.schoolId);
    const updated = await this.subjects.update(id, {
      ...dto,
      updatedBy: actor.sub,
    });
    this.audit(
      'Subject',
      id,
      { name: existing.name, code: existing.code, type: existing.type },
      { name: updated.name, code: updated.code, type: updated.type },
    );
    return updated;
  }

  async removeSubject(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.subjects.findByIdOrFail(id, actor.schoolId);
    const refs = await this.subjects.countReferences(id);
    if (refs > 0) {
      throw new ConflictException(
        `Subject is mapped to ${refs} class-session(s) — unassign it first`,
      );
    }
    await this.subjects.softDelete(id);
    this.audit('Subject', id, { name: existing.name, code: existing.code });
  }

  // ── internals ─────────────────────────────────────────────────────

  private async assertUnique(
    lookup: Promise<unknown>,
    message: string,
  ): Promise<void> {
    if (await lookup) throw new ConflictException(message);
  }

  private assertShiftTimes(startTime: string, endTime: string): void {
    if (startTime >= endTime) {
      throw new BadRequestException('startTime must be before endTime');
    }
  }

  private async assertDepartment(
    departmentId: string | undefined,
    schoolId: string,
  ): Promise<void> {
    if (departmentId) {
      await this.departments.findByIdOrFail(departmentId, schoolId);
    }
  }

  private audit(
    entityType: string,
    entityId: string,
    oldValues?: unknown,
    newValues?: unknown,
  ): void {
    this.auditContext.set({ entityType, entityId, oldValues, newValues });
  }
}
