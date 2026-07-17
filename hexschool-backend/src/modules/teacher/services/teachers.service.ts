import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, Subject, Teacher, TeacherQualification } from '@prisma/client';
import sharp from 'sharp';
import { UserStatus, UserType } from '../../../common/constants';
import { PaginatedResult } from '../../../common/dto/paginated.dto';
import { parseDate } from '../../academic/calendar/date.util';
import { DepartmentsRepository } from '../../academic/repositories/departments.repository';
import { SubjectsRepository } from '../../academic/repositories/subjects.repository';
import { SessionsService } from '../../academic/services/sessions.service';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { RefreshTokensRepository } from '../../auth/repositories/refresh-tokens.repository';
import { UsersRepository } from '../../auth/repositories/users.repository';
import { PasswordService } from '../../auth/services/password.service';
import { RolesRepository } from '../../rbac/repositories/roles.repository';
import { UserRolesRepository } from '../../rbac/repositories/user-roles.repository';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import { SettingsService } from '../../school/services/settings.service';
import { SequenceService } from '../../sequence/sequence.service';
import { generateTempPassword } from '../../staff/staff.utils';
import { StorageService } from '../../storage/storage.service';
import {
  CreateQualificationDto,
  CreateTeacherDto,
  TeacherQueryDto,
  UpdateQualificationDto,
  UpdateTeacherDto,
  UpdateTeacherStatusDto,
} from '../dto';
import { TEACHER_EVENTS } from '../events/teacher.events';
import type {
  TeacherCreatedEvent,
  TeacherStatusChangedEvent,
} from '../events/teacher.events';
import { TeacherAssignmentsRepository } from '../repositories/teacher-assignments.repository';
import { TeacherQualificationsRepository } from '../repositories/teacher-qualifications.repository';
import { TeacherSubjectsRepository } from '../repositories/teacher-subjects.repository';
import {
  TeachersRepository,
  TeacherWithRelations,
} from '../repositories/teachers.repository';

export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
export const PHOTO_SIZE_PX = 512;
const PHOTO_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface TeacherDetail extends TeacherWithRelations {
  photoSignedUrl: string | null;
}

/**
 * Teacher lifecycle (roadmap M08) — the M07 staff pattern with the
 * teaching-specific pieces on top: transactional creation (SequenceService
 * ID from `general.teacher_id_pattern`, temp password, `teacher` system
 * role), qualifications, subject expertise, and the resign guard (no
 * status change to RESIGNED/TERMINATED while assignments or class-teacher
 * duties exist in the CURRENT session — transfer first, M08 §8).
 */
@Injectable()
export class TeachersService {
  constructor(
    private readonly teachers: TeachersRepository,
    private readonly qualifications: TeacherQualificationsRepository,
    private readonly teacherSubjects: TeacherSubjectsRepository,
    private readonly assignments: TeacherAssignmentsRepository,
    private readonly users: UsersRepository,
    private readonly refreshTokens: RefreshTokensRepository,
    private readonly roles: RolesRepository,
    private readonly userRoles: UserRolesRepository,
    private readonly departments: DepartmentsRepository,
    private readonly subjects: SubjectsRepository,
    private readonly schools: SchoolsRepository,
    private readonly sessions: SessionsService,
    private readonly passwords: PasswordService,
    private readonly settings: SettingsService,
    private readonly sequences: SequenceService,
    private readonly storage: StorageService,
    private readonly auditContext: AuditContextService,
    private readonly events: EventEmitter2,
  ) {}

  async list(
    query: TeacherQueryDto,
    schoolId: string,
  ): Promise<PaginatedResult<TeacherWithRelations>> {
    return this.teachers.paginateList(query, schoolId);
  }

  async getDetail(id: string, schoolId: string): Promise<TeacherDetail> {
    const teacher = await this.teachers.findDetail(id, schoolId);
    if (!teacher) throw new NotFoundException(`Teacher ${id} not found`);
    return {
      ...teacher,
      photoSignedUrl: teacher.photoUrl
        ? await this.storage.getSignedUrl(teacher.photoUrl, 3600, 'photos')
        : null,
    };
  }

  async create(
    dto: CreateTeacherDto,
    actor: AccessTokenPayload,
  ): Promise<TeacherWithRelations> {
    const contact = this.normalizeContact(dto.email, dto.phone);
    this.assertDates(dto.dob, dto.joiningDate);
    await this.assertContactAvailable(contact, actor.schoolId);
    if (dto.departmentId) {
      await this.departments.findByIdOrFail(dto.departmentId, actor.schoolId);
    }

    const school = await this.schools.findByIdOrFail(actor.schoolId);
    const pattern = await this.settings.getValue<string>(
      actor.schoolId,
      'general.teacher_id_pattern',
    );
    const teacherRole = await this.roles.findBySlug(actor.schoolId, 'teacher');

    const tempPassword = generateTempPassword();
    const passwordHash = await this.passwords.hash(tempPassword);
    const joining = parseDate(dto.joiningDate);

    const teacher = await this.teachers.withTransaction(async (tx) => {
      const employeeId = await this.sequences.nextDocumentNumber({
        schoolId: actor.schoolId,
        counterKey: `teacher:${joining.getUTCFullYear() % 100}`,
        pattern,
        schoolCode: school.code,
        date: joining,
        tx,
      });

      const user = await this.users.create(
        {
          schoolId: actor.schoolId,
          email: contact.email ?? null,
          phone: contact.phone ?? null,
          passwordHash,
          userType: UserType.TEACHER,
          mustChangePassword: true,
          createdBy: actor.sub,
          updatedBy: actor.sub,
        },
        tx,
      );
      if (teacherRole) {
        await this.userRoles.assignRole(user.id, teacherRole.id, tx);
      }

      return this.teachers.create(
        {
          schoolId: actor.schoolId,
          userId: user.id,
          employeeId,
          firstName: dto.firstName,
          lastName: dto.lastName,
          nameBn: dto.nameBn,
          designation: dto.designation,
          departmentId: dto.departmentId,
          gender: dto.gender,
          dob: parseDate(dto.dob),
          bloodGroup: dto.bloodGroup,
          nidNumber: dto.nidNumber,
          address: (dto.address ?? {}) as Prisma.InputJsonValue,
          joiningDate: joining,
          salaryGrade: dto.salaryGrade,
          mpoIndexNo: dto.mpoIndexNo,
          specialization: dto.specialization,
          createdBy: actor.sub,
          updatedBy: actor.sub,
        },
        tx,
      );
    });

    this.events.emit(TEACHER_EVENTS.CREATED, {
      teacherId: teacher.id,
      userId: teacher.userId,
      schoolId: actor.schoolId,
      employeeId: teacher.employeeId,
      name: `${dto.firstName} ${dto.lastName}`,
      email: contact.email ?? null,
      phone: contact.phone ?? null,
      tempPassword,
    } satisfies TeacherCreatedEvent);

    this.auditContext.set({
      entityType: 'Teacher',
      entityId: teacher.id,
      newValues: {
        employeeId: teacher.employeeId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        designation: dto.designation,
        email: contact.email ?? null,
        phone: contact.phone ?? null,
      },
    });

    return (await this.teachers.findDetail(teacher.id, actor.schoolId))!;
  }

  async update(
    id: string,
    dto: UpdateTeacherDto,
    actor: AccessTokenPayload,
  ): Promise<TeacherWithRelations> {
    const existing = await this.teachers.findByIdOrFail(id, actor.schoolId);
    const user = await this.users.findByIdOrFail(existing.userId);

    const contactChanged =
      (dto.email !== undefined && (dto.email || null) !== user.email) ||
      (dto.phone !== undefined && (dto.phone || null) !== user.phone);
    const contact = contactChanged
      ? this.normalizeContact(
          dto.email !== undefined ? dto.email : (user.email ?? undefined),
          dto.phone !== undefined ? dto.phone : (user.phone ?? undefined),
        )
      : null;
    if (contact) {
      await this.assertContactAvailable(contact, actor.schoolId, user.id);
    }

    this.assertDates(
      dto.dob ?? this.iso(existing.dob),
      dto.joiningDate ?? this.iso(existing.joiningDate),
    );
    if (dto.departmentId) {
      await this.departments.findByIdOrFail(dto.departmentId, actor.schoolId);
    }

    const updated = await this.teachers.withTransaction(async (tx) => {
      if (contact) {
        await this.users.update(
          user.id,
          {
            email: contact.email ?? null,
            phone: contact.phone ?? null,
            updatedBy: actor.sub,
          },
          tx,
        );
      }
      return this.teachers.update(
        id,
        {
          ...(dto.firstName !== undefined ? { firstName: dto.firstName } : {}),
          ...(dto.lastName !== undefined ? { lastName: dto.lastName } : {}),
          ...(dto.nameBn !== undefined ? { nameBn: dto.nameBn } : {}),
          ...(dto.designation !== undefined
            ? { designation: dto.designation }
            : {}),
          ...(dto.departmentId !== undefined
            ? { departmentId: dto.departmentId || null }
            : {}),
          ...(dto.gender !== undefined ? { gender: dto.gender } : {}),
          ...(dto.dob !== undefined ? { dob: parseDate(dto.dob) } : {}),
          ...(dto.bloodGroup !== undefined
            ? { bloodGroup: dto.bloodGroup || null }
            : {}),
          ...(dto.nidNumber !== undefined
            ? { nidNumber: dto.nidNumber || null }
            : {}),
          ...(dto.address !== undefined
            ? { address: dto.address as Prisma.InputJsonValue }
            : {}),
          ...(dto.joiningDate !== undefined
            ? { joiningDate: parseDate(dto.joiningDate) }
            : {}),
          ...(dto.salaryGrade !== undefined
            ? { salaryGrade: dto.salaryGrade || null }
            : {}),
          ...(dto.mpoIndexNo !== undefined
            ? { mpoIndexNo: dto.mpoIndexNo || null }
            : {}),
          ...(dto.specialization !== undefined
            ? { specialization: dto.specialization || null }
            : {}),
          updatedBy: actor.sub,
        },
        tx,
      );
    });

    this.auditContext.set({
      entityType: 'Teacher',
      entityId: id,
      oldValues: this.auditSnapshot(existing, user.email, user.phone),
      newValues: this.auditSnapshot(
        updated,
        contact ? (contact.email ?? null) : user.email,
        contact ? (contact.phone ?? null) : user.phone,
      ),
    });

    return (await this.teachers.findDetail(id, actor.schoolId))!;
  }

  /**
   * Status transition with reason. RESIGNED/TERMINATED is BLOCKED while
   * the teacher still holds assignments or class-teacher duties in the
   * current session (roadmap M08 §8 — transfer first).
   */
  async updateStatus(
    id: string,
    dto: UpdateTeacherStatusDto,
    actor: AccessTokenPayload,
  ): Promise<TeacherWithRelations> {
    const existing = await this.teachers.findByIdOrFail(id, actor.schoolId);
    if (existing.status === dto.status) {
      throw new BadRequestException(`Teacher is already ${dto.status}`);
    }

    if (dto.status === 'RESIGNED' || dto.status === 'TERMINATED') {
      const current = await this.sessions.getCurrent(actor.schoolId);
      if (current) {
        const [assignments, classTeacherOf] = await Promise.all([
          this.assignments.countForTeacher(id, current.id),
          this.teachers.countClassTeacherSections(id, current.id),
        ]);
        if (assignments > 0 || classTeacherOf > 0) {
          throw new ConflictException(
            `Teacher still holds ${assignments} subject assignment(s) and is class teacher of ` +
              `${classTeacherOf} section(s) in the current session — transfer them first ` +
              `(POST /teacher-assignments/transfer, section class-teacher edits)`,
          );
        }
      }
    }

    const updated = await this.teachers.update(id, {
      status: dto.status,
      updatedBy: actor.sub,
    });

    this.events.emit(TEACHER_EVENTS.STATUS_CHANGED, {
      teacherId: id,
      userId: existing.userId,
      schoolId: actor.schoolId,
      from: existing.status,
      to: dto.status,
      reason: dto.reason,
    } satisfies TeacherStatusChangedEvent);

    this.auditContext.set({
      entityType: 'Teacher',
      entityId: id,
      oldValues: { status: existing.status },
      newValues: { status: updated.status, reason: dto.reason },
    });
    return (await this.teachers.findDetail(id, actor.schoolId))!;
  }

  /** Same semantics as staff removal (M07): profile + user soft-deleted,
   *  sessions revoked, employee ID stays burned. Blocked like a resign
   *  while current-session duties exist. */
  async remove(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.teachers.findByIdOrFail(id, actor.schoolId);

    const current = await this.sessions.getCurrent(actor.schoolId);
    if (current) {
      const [assignments, classTeacherOf] = await Promise.all([
        this.assignments.countForTeacher(id, current.id),
        this.teachers.countClassTeacherSections(id, current.id),
      ]);
      if (assignments > 0 || classTeacherOf > 0) {
        throw new ConflictException(
          `Teacher still holds ${assignments} assignment(s) / ${classTeacherOf} class-teacher section(s) in the current session — transfer them first`,
        );
      }
    }

    await this.teachers.withTransaction(async (tx) => {
      await this.teachers.update(
        id,
        { deletedAt: new Date(), updatedBy: actor.sub },
        tx,
      );
      await this.users.update(
        existing.userId,
        {
          deletedAt: new Date(),
          status: UserStatus.INACTIVE,
          updatedBy: actor.sub,
        },
        tx,
      );
    });
    await this.refreshTokens.revokeAllForUser(existing.userId);

    this.auditContext.set({
      entityType: 'Teacher',
      entityId: id,
      oldValues: {
        employeeId: existing.employeeId,
        firstName: existing.firstName,
        lastName: existing.lastName,
        status: existing.status,
      },
    });
  }

  /** Photo upload — identical contract to staff (M07). */
  async uploadPhoto(
    id: string,
    file: { buffer: Buffer; mimetype: string; size: number } | undefined,
    actor: AccessTokenPayload,
  ): Promise<TeacherDetail> {
    const teacher = await this.teachers.findByIdOrFail(id, actor.schoolId);
    if (!file) throw new BadRequestException('Photo file is required');
    if (!PHOTO_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException('Photo must be a JPEG, PNG, or WebP image');
    }
    if (file.size > PHOTO_MAX_BYTES) {
      throw new BadRequestException('Photo must be 2 MB or smaller');
    }

    let resized: Buffer;
    try {
      resized = await sharp(file.buffer)
        .rotate()
        .resize(PHOTO_SIZE_PX, PHOTO_SIZE_PX, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .png()
        .toBuffer();
    } catch {
      throw new BadRequestException('File is not a decodable image');
    }

    const uploaded = await this.storage.upload({
      body: resized,
      contentType: 'image/png',
      prefix: `teachers/${actor.schoolId}/${id}`,
      filename: 'photo.png',
      purpose: 'photos',
    });
    await this.teachers.update(id, {
      photoUrl: uploaded.key,
      updatedBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'Teacher',
      entityId: id,
      oldValues: { photoUrl: teacher.photoUrl },
      newValues: { photoUrl: uploaded.key },
    });
    return this.getDetail(id, actor.schoolId);
  }

  // ── qualifications ────────────────────────────────────────────────

  async listQualifications(
    teacherId: string,
    schoolId: string,
  ): Promise<TeacherQualification[]> {
    await this.teachers.findByIdOrFail(teacherId, schoolId);
    return this.qualifications.listForTeacher(teacherId);
  }

  async addQualification(
    teacherId: string,
    dto: CreateQualificationDto,
    actor: AccessTokenPayload,
  ): Promise<TeacherQualification> {
    await this.teachers.findByIdOrFail(teacherId, actor.schoolId);
    this.assertPassingYear(dto.passingYear);
    const qualification = await this.qualifications.create({
      teacherId,
      degree: dto.degree,
      institution: dto.institution,
      passingYear: dto.passingYear,
      result: dto.result,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });
    this.auditContext.set({
      entityType: 'TeacherQualification',
      entityId: qualification.id,
      newValues: { teacherId, ...dto },
    });
    return qualification;
  }

  async updateQualification(
    teacherId: string,
    qualificationId: string,
    dto: UpdateQualificationDto,
    actor: AccessTokenPayload,
  ): Promise<TeacherQualification> {
    await this.teachers.findByIdOrFail(teacherId, actor.schoolId);
    const existing = await this.getOwnedQualification(
      teacherId,
      qualificationId,
    );
    if (dto.passingYear !== undefined) this.assertPassingYear(dto.passingYear);

    const updated = await this.qualifications.update(qualificationId, {
      ...dto,
      updatedBy: actor.sub,
    });
    this.auditContext.set({
      entityType: 'TeacherQualification',
      entityId: qualificationId,
      oldValues: {
        degree: existing.degree,
        institution: existing.institution,
        passingYear: existing.passingYear,
        result: existing.result,
      },
      newValues: {
        degree: updated.degree,
        institution: updated.institution,
        passingYear: updated.passingYear,
        result: updated.result,
      },
    });
    return updated;
  }

  async removeQualification(
    teacherId: string,
    qualificationId: string,
    actor: AccessTokenPayload,
  ): Promise<void> {
    await this.teachers.findByIdOrFail(teacherId, actor.schoolId);
    const existing = await this.getOwnedQualification(
      teacherId,
      qualificationId,
    );
    await this.qualifications.hardDelete(qualificationId);
    this.auditContext.set({
      entityType: 'TeacherQualification',
      entityId: qualificationId,
      oldValues: { teacherId, degree: existing.degree },
    });
  }

  // ── subject expertise ─────────────────────────────────────────────

  async getSubjects(teacherId: string, schoolId: string): Promise<Subject[]> {
    await this.teachers.findByIdOrFail(teacherId, schoolId);
    return this.teacherSubjects.findSubjectsForTeacher(teacherId);
  }

  async setSubjects(
    teacherId: string,
    subjectIds: string[],
    actor: AccessTokenPayload,
  ): Promise<Subject[]> {
    await this.teachers.findByIdOrFail(teacherId, actor.schoolId);

    const unique = [...new Set(subjectIds)];
    const found = await this.subjects.findAll(
      { id: { in: unique } },
      actor.schoolId,
    );
    if (found.length !== unique.length) {
      const foundIds = new Set(found.map((s) => s.id));
      const missing = unique.filter((sid) => !foundIds.has(sid));
      throw new BadRequestException(
        `Unknown subject id(s): ${missing.join(', ')}`,
      );
    }

    const before = await this.teacherSubjects.findSubjectsForTeacher(teacherId);
    await this.teacherSubjects.replaceForTeacher(teacherId, unique);

    this.auditContext.set({
      entityType: 'TeacherSubjects',
      entityId: teacherId,
      oldValues: { subjects: before.map((s) => s.code).sort() },
      newValues: { subjects: found.map((s) => s.code).sort() },
    });
    return this.teacherSubjects.findSubjectsForTeacher(teacherId);
  }

  // ── internals ─────────────────────────────────────────────────────

  private async getOwnedQualification(
    teacherId: string,
    qualificationId: string,
  ): Promise<TeacherQualification> {
    const qualification = await this.qualifications.findOne({
      id: qualificationId,
      teacherId,
    });
    if (!qualification) {
      throw new NotFoundException(`Qualification ${qualificationId} not found`);
    }
    return qualification;
  }

  private assertPassingYear(year: number): void {
    const currentYear = new Date().getUTCFullYear();
    if (year > currentYear) {
      throw new BadRequestException(
        `passingYear cannot be after ${currentYear}`,
      );
    }
  }

  private normalizeContact(
    email: string | undefined,
    phone: string | undefined,
  ): { email?: string; phone?: string } {
    const normalized = {
      ...(email ? { email: email.trim().toLowerCase() } : {}),
      ...(phone ? { phone: phone.trim() } : {}),
    };
    if (!normalized.email && !normalized.phone) {
      throw new BadRequestException('Provide an email or a phone number');
    }
    return normalized;
  }

  private async assertContactAvailable(
    contact: { email?: string; phone?: string },
    schoolId: string,
    excludeUserId?: string,
  ): Promise<void> {
    if (contact.email) {
      const holder = await this.users.findOne(
        { email: contact.email },
        schoolId,
      );
      if (holder && holder.id !== excludeUserId) {
        throw new ConflictException(
          `A user with email ${contact.email} already exists`,
        );
      }
    }
    if (contact.phone) {
      const holder = await this.users.findOne(
        { phone: contact.phone },
        schoolId,
      );
      if (holder && holder.id !== excludeUserId) {
        throw new ConflictException(
          `A user with phone ${contact.phone} already exists`,
        );
      }
    }
  }

  /** DOB ⇒ age ≥ 18; joining date ≤ today (same policy as staff, M07 §7). */
  private assertDates(dob: string, joiningDate: string): void {
    const birth = parseDate(dob);
    const joining = parseDate(joiningDate);
    const now = new Date();

    const adultAt = new Date(birth);
    adultAt.setUTCFullYear(adultAt.getUTCFullYear() + 18);
    if (adultAt.getTime() > now.getTime()) {
      throw new BadRequestException('Teachers must be at least 18 years old');
    }
    if (joining.getTime() > now.getTime()) {
      throw new BadRequestException('Joining date cannot be in the future');
    }
    if (birth.getTime() >= joining.getTime()) {
      throw new BadRequestException('Joining date must be after date of birth');
    }
  }

  private iso(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private auditSnapshot(
    teacher: Teacher,
    email: string | null,
    phone: string | null,
  ): Record<string, unknown> {
    return {
      firstName: teacher.firstName,
      lastName: teacher.lastName,
      nameBn: teacher.nameBn,
      designation: teacher.designation,
      departmentId: teacher.departmentId,
      gender: teacher.gender,
      dob: this.iso(teacher.dob),
      nidNumber: teacher.nidNumber,
      joiningDate: this.iso(teacher.joiningDate),
      salaryGrade: teacher.salaryGrade,
      mpoIndexNo: teacher.mpoIndexNo,
      specialization: teacher.specialization,
      email,
      phone,
    };
  }
}
