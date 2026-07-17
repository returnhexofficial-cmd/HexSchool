import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, StaffProfile } from '@prisma/client';
import sharp from 'sharp';
import { UserStatus, UserType } from '../../../common/constants';
import { PaginatedResult } from '../../../common/dto/paginated.dto';
import { parseDate } from '../../academic/calendar/date.util';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { RefreshTokensRepository } from '../../auth/repositories/refresh-tokens.repository';
import { UsersRepository } from '../../auth/repositories/users.repository';
import { PasswordService } from '../../auth/services/password.service';
import { DepartmentsRepository } from '../../academic/repositories/departments.repository';
import { RolesRepository } from '../../rbac/repositories/roles.repository';
import { UserRolesRepository } from '../../rbac/repositories/user-roles.repository';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import { SettingsService } from '../../school/services/settings.service';
import { SequenceService } from '../../sequence/sequence.service';
import { StorageService } from '../../storage/storage.service';
import {
  CreateStaffDto,
  UpdateStaffDto,
  UpdateStaffStatusDto,
  StaffQueryDto,
} from '../dto';
import {
  STAFF_EVENTS,
  StaffCreatedEvent,
  StaffStatusChangedEvent,
} from '../events/staff.events';
import {
  StaffProfilesRepository,
  StaffWithRelations,
} from '../repositories/staff-profiles.repository';
import { defaultRoleSlugFor, generateTempPassword } from '../staff.utils';

export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
export const PHOTO_SIZE_PX = 512;
const PHOTO_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface StaffDetail extends StaffWithRelations {
  photoSignedUrl: string | null;
}

/**
 * Staff lifecycle (roadmap M07): creation is transactional with the user
 * account (gap-free employee ID from SequenceService, temp password,
 * must_change_password) — the welcome message and the RESIGNED/TERMINATED
 * → user-deactivation cascade run via events (StaffListener).
 */
@Injectable()
export class StaffService {
  constructor(
    private readonly staffProfiles: StaffProfilesRepository,
    private readonly users: UsersRepository,
    private readonly refreshTokens: RefreshTokensRepository,
    private readonly roles: RolesRepository,
    private readonly userRoles: UserRolesRepository,
    private readonly departments: DepartmentsRepository,
    private readonly schools: SchoolsRepository,
    private readonly passwords: PasswordService,
    private readonly settings: SettingsService,
    private readonly sequences: SequenceService,
    private readonly storage: StorageService,
    private readonly auditContext: AuditContextService,
    private readonly events: EventEmitter2,
  ) {}

  async list(
    query: StaffQueryDto,
    schoolId: string,
  ): Promise<PaginatedResult<StaffWithRelations>> {
    return this.staffProfiles.paginateList(query, schoolId);
  }

  async getDetail(id: string, schoolId: string): Promise<StaffDetail> {
    const staff = await this.staffProfiles.findDetail(id, schoolId);
    if (!staff) throw new NotFoundException(`Staff member ${id} not found`);
    return {
      ...staff,
      photoSignedUrl: staff.photoUrl
        ? await this.storage.getSignedUrl(staff.photoUrl, 3600, 'photos')
        : null,
    };
  }

  /** Duplicate-NID soft check (M07 §8: warn, never block). */
  async nidExists(
    nid: string,
    schoolId: string,
    excludeId?: string,
  ): Promise<boolean> {
    return (await this.staffProfiles.countByNid(nid, schoolId, excludeId)) > 0;
  }

  async create(
    dto: CreateStaffDto,
    actor: AccessTokenPayload,
  ): Promise<StaffWithRelations> {
    const contact = this.normalizeContact(dto.email, dto.phone);
    this.assertDates(dto.dob, dto.joiningDate);
    await this.assertContactAvailable(contact, actor.schoolId);
    if (dto.departmentId) {
      await this.departments.findByIdOrFail(dto.departmentId, actor.schoolId);
    }

    const school = await this.schools.findByIdOrFail(actor.schoolId);
    const pattern = await this.settings.getValue<string>(
      actor.schoolId,
      'general.employee_id_pattern',
    );
    const defaultRole = await this.roles.findBySlug(
      actor.schoolId,
      defaultRoleSlugFor(dto.designation),
    );

    const tempPassword = generateTempPassword();
    const passwordHash = await this.passwords.hash(tempPassword);
    const joining = parseDate(dto.joiningDate);

    const staff = await this.staffProfiles.withTransaction(async (tx) => {
      // Gap-free per (school, joining-year) counter — rolls back with the tx.
      const employeeId = await this.sequences.nextDocumentNumber({
        schoolId: actor.schoolId,
        counterKey: `staff:${joining.getUTCFullYear() % 100}`,
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
          userType: UserType.STAFF,
          mustChangePassword: true,
          createdBy: actor.sub,
          updatedBy: actor.sub,
        },
        tx,
      );
      if (defaultRole) {
        await this.userRoles.assignRole(user.id, defaultRole.id, tx);
      }

      const created = await this.staffProfiles.create(
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
          employmentType: dto.employmentType,
          createdBy: actor.sub,
          updatedBy: actor.sub,
        },
        tx,
      );
      return created;
    });

    this.events.emit(STAFF_EVENTS.CREATED, {
      staffId: staff.id,
      userId: staff.userId,
      schoolId: actor.schoolId,
      employeeId: staff.employeeId,
      name: `${dto.firstName} ${dto.lastName}`,
      email: contact.email ?? null,
      phone: contact.phone ?? null,
      tempPassword,
    } satisfies StaffCreatedEvent);

    this.auditContext.set({
      entityType: 'StaffProfile',
      entityId: staff.id,
      newValues: {
        employeeId: staff.employeeId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        designation: dto.designation,
        email: contact.email ?? null,
        phone: contact.phone ?? null,
      },
    });

    return (await this.staffProfiles.findDetail(staff.id, actor.schoolId))!;
  }

  async update(
    id: string,
    dto: UpdateStaffDto,
    actor: AccessTokenPayload,
  ): Promise<StaffWithRelations> {
    const existing = await this.staffProfiles.findByIdOrFail(
      id,
      actor.schoolId,
    );
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

    const updated = await this.staffProfiles.withTransaction(async (tx) => {
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
      return this.staffProfiles.update(
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
          ...(dto.employmentType !== undefined
            ? { employmentType: dto.employmentType }
            : {}),
          updatedBy: actor.sub,
        },
        tx,
      );
    });

    this.auditContext.set({
      entityType: 'StaffProfile',
      entityId: id,
      oldValues: this.auditSnapshot(existing, user.email, user.phone),
      newValues: this.auditSnapshot(
        updated,
        contact ? (contact.email ?? null) : user.email,
        contact ? (contact.phone ?? null) : user.phone,
      ),
    });

    return (await this.staffProfiles.findDetail(id, actor.schoolId))!;
  }

  /** Status transition with mandatory reason (feeds HR in M21). */
  async updateStatus(
    id: string,
    dto: UpdateStaffStatusDto,
    actor: AccessTokenPayload,
  ): Promise<StaffWithRelations> {
    const existing = await this.staffProfiles.findByIdOrFail(
      id,
      actor.schoolId,
    );
    if (existing.status === dto.status) {
      throw new BadRequestException(`Staff member is already ${dto.status}`);
    }

    const updated = await this.staffProfiles.update(id, {
      status: dto.status,
      updatedBy: actor.sub,
    });

    this.events.emit(STAFF_EVENTS.STATUS_CHANGED, {
      staffId: id,
      userId: existing.userId,
      schoolId: actor.schoolId,
      from: existing.status,
      to: dto.status,
      reason: dto.reason,
    } satisfies StaffStatusChangedEvent);

    this.auditContext.set({
      entityType: 'StaffProfile',
      entityId: id,
      oldValues: { status: existing.status },
      newValues: { status: updated.status, reason: dto.reason },
    });
    return (await this.staffProfiles.findDetail(id, actor.schoolId))!;
  }

  /** Soft delete; the linked account is soft-deleted too (frees the
   *  email/phone via the partial uniques) and every session is revoked.
   *  The employee ID stays burned — its unique index ignores deleted_at. */
  async remove(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.staffProfiles.findByIdOrFail(
      id,
      actor.schoolId,
    );
    await this.staffProfiles.withTransaction(async (tx) => {
      await this.staffProfiles.update(
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
      entityType: 'StaffProfile',
      entityId: id,
      oldValues: {
        employeeId: existing.employeeId,
        firstName: existing.firstName,
        lastName: existing.lastName,
        status: existing.status,
      },
    });
  }

  /** Photo upload: ≤2 MB image → EXIF-normalized 512px PNG on S3. */
  async uploadPhoto(
    id: string,
    file: { buffer: Buffer; mimetype: string; size: number } | undefined,
    actor: AccessTokenPayload,
  ): Promise<StaffDetail> {
    const staff = await this.staffProfiles.findByIdOrFail(id, actor.schoolId);
    if (!file) throw new BadRequestException('Photo file is required');
    if (!PHOTO_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException('Photo must be a JPEG, PNG, or WebP image');
    }
    if (file.size > PHOTO_MAX_BYTES) {
      throw new BadRequestException('Photo must be 2 MB or smaller');
    }

    let resized: Buffer;
    try {
      // .rotate() applies the EXIF orientation before it is stripped
      // (roadmap M07 §8 — normalize server-side).
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
      prefix: `staff/${actor.schoolId}/${id}`,
      filename: 'photo.png',
      purpose: 'photos',
    });
    await this.staffProfiles.update(id, {
      photoUrl: uploaded.key,
      updatedBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'StaffProfile',
      entityId: id,
      oldValues: { photoUrl: staff.photoUrl },
      newValues: { photoUrl: uploaded.key },
    });
    return this.getDetail(id, actor.schoolId);
  }

  // ── internals ─────────────────────────────────────────────────────

  private normalizeContact(
    email: string | undefined,
    phone: string | undefined,
  ): { email?: string; phone?: string } {
    const normalized = {
      ...(email ? { email: email.trim().toLowerCase() } : {}),
      ...(phone ? { phone: phone.trim() } : {}),
    };
    if (!normalized.email && !normalized.phone) {
      // Staff without email are common in BD — but SOME contact must
      // exist for login + the welcome message (chk_users_contact).
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

  /** DOB ⇒ age ≥ 18; joining date ≤ today (roadmap M07 §7). */
  private assertDates(dob: string, joiningDate: string): void {
    const birth = parseDate(dob);
    const joining = parseDate(joiningDate);
    const now = new Date();

    const adultAt = new Date(birth);
    adultAt.setUTCFullYear(adultAt.getUTCFullYear() + 18);
    if (adultAt.getTime() > now.getTime()) {
      throw new BadRequestException('Staff must be at least 18 years old');
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
    staff: StaffProfile,
    email: string | null,
    phone: string | null,
  ): Record<string, unknown> {
    return {
      firstName: staff.firstName,
      lastName: staff.lastName,
      nameBn: staff.nameBn,
      designation: staff.designation,
      departmentId: staff.departmentId,
      gender: staff.gender,
      dob: this.iso(staff.dob),
      bloodGroup: staff.bloodGroup,
      nidNumber: staff.nidNumber,
      joiningDate: this.iso(staff.joiningDate),
      employmentType: staff.employmentType,
      email,
      phone,
    };
  }
}
