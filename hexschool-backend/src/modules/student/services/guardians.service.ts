import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StudentGuardian } from '@prisma/client';
import { PaginatedResult } from '../../../common/dto/paginated.dto';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { UsersRepository } from '../../auth/repositories/users.repository';
import {
  CreateGuardianDto,
  GuardianQueryDto,
  LinkGuardianDto,
  UpdateGuardianDto,
  UpdateGuardianLinkDto,
} from '../dto';
import {
  GuardiansRepository,
  GuardianWithRelations,
} from '../repositories/guardians.repository';
import { StudentGuardiansRepository } from '../repositories/student-guardians.repository';
import { StudentsRepository } from '../repositories/students.repository';

/**
 * Guardian master + student↔guardian links (roadmap M09). Guardians are
 * shared across siblings — phone is the dedup key. The one-primary-per-
 * student invariant is enforced here (transactionally) on top of the
 * uq_student_guardians_primary partial index.
 */
@Injectable()
export class GuardiansService {
  constructor(
    private readonly guardians: GuardiansRepository,
    private readonly links: StudentGuardiansRepository,
    private readonly students: StudentsRepository,
    private readonly users: UsersRepository,
    private readonly auditContext: AuditContextService,
  ) {}

  async list(
    query: GuardianQueryDto,
    schoolId: string,
  ): Promise<PaginatedResult<GuardianWithRelations>> {
    return this.guardians.paginateList(query, schoolId);
  }

  async getDetail(
    id: string,
    schoolId: string,
  ): Promise<GuardianWithRelations> {
    const guardian = await this.guardians.findDetail(id, schoolId);
    if (!guardian) throw new NotFoundException(`Guardian ${id} not found`);
    return guardian;
  }

  async create(
    dto: CreateGuardianDto,
    actor: AccessTokenPayload,
  ): Promise<GuardianWithRelations> {
    // Phone is the dedup key — refuse a second row for the same number
    // (link the existing guardian instead; siblings share rows).
    const existing = await this.guardians.findByPhone(
      dto.phone,
      actor.schoolId,
    );
    if (existing) {
      throw new ConflictException(
        `A guardian with phone ${dto.phone} already exists (${existing.name}) — link them instead`,
      );
    }

    const guardian = await this.guardians.create({
      schoolId: actor.schoolId,
      name: dto.name,
      nameBn: dto.nameBn,
      relation: dto.relation,
      phone: dto.phone,
      email: dto.email,
      nid: dto.nid,
      occupation: dto.occupation,
      monthlyIncome: dto.monthlyIncome,
      address: (dto.address ?? {}) as Prisma.InputJsonValue,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'Guardian',
      entityId: guardian.id,
      newValues: { name: dto.name, phone: dto.phone, relation: dto.relation },
    });
    return this.getDetail(guardian.id, actor.schoolId);
  }

  async update(
    id: string,
    dto: UpdateGuardianDto,
    actor: AccessTokenPayload,
  ): Promise<GuardianWithRelations> {
    const existing = await this.guardians.findByIdOrFail(id, actor.schoolId);

    if (dto.phone && dto.phone !== existing.phone) {
      const holder = await this.guardians.findByPhone(
        dto.phone,
        actor.schoolId,
      );
      if (holder && holder.id !== id) {
        throw new ConflictException(
          `A guardian with phone ${dto.phone} already exists (${holder.name})`,
        );
      }
    }

    const updated = await this.guardians.update(id, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.nameBn !== undefined ? { nameBn: dto.nameBn } : {}),
      ...(dto.relation !== undefined ? { relation: dto.relation } : {}),
      ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
      ...(dto.email !== undefined ? { email: dto.email || null } : {}),
      ...(dto.nid !== undefined ? { nid: dto.nid || null } : {}),
      ...(dto.occupation !== undefined
        ? { occupation: dto.occupation || null }
        : {}),
      ...(dto.monthlyIncome !== undefined
        ? { monthlyIncome: dto.monthlyIncome }
        : {}),
      ...(dto.address !== undefined
        ? { address: dto.address as Prisma.InputJsonValue }
        : {}),
      updatedBy: actor.sub,
    });

    // Keep the portal login in sync with the guardian's contact.
    if (existing.userId && dto.phone && dto.phone !== existing.phone) {
      await this.users.update(existing.userId, {
        phone: dto.phone,
        updatedBy: actor.sub,
      });
    }

    this.auditContext.set({
      entityType: 'Guardian',
      entityId: id,
      oldValues: {
        name: existing.name,
        phone: existing.phone,
        relation: existing.relation,
        email: existing.email,
      },
      newValues: {
        name: updated.name,
        phone: updated.phone,
        relation: updated.relation,
        email: updated.email,
      },
    });
    return this.getDetail(id, actor.schoolId);
  }

  /** Blocked while any (non-deleted) child is linked — unlink first. */
  async remove(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.guardians.findByIdOrFail(id, actor.schoolId);

    const children = await this.links.countForGuardian(id);
    if (children > 0) {
      throw new ConflictException(
        `Guardian is linked to ${children} student(s) — unlink them first`,
      );
    }

    await this.guardians.withTransaction(async (tx) => {
      await this.guardians.update(
        id,
        { deletedAt: new Date(), updatedBy: actor.sub },
        tx,
      );
      if (existing.userId) {
        await this.users.update(
          existing.userId,
          { deletedAt: new Date(), status: 'INACTIVE', updatedBy: actor.sub },
          tx,
        );
      }
    });

    this.auditContext.set({
      entityType: 'Guardian',
      entityId: id,
      oldValues: { name: existing.name, phone: existing.phone },
    });
  }

  // ── student ↔ guardian links ──────────────────────────────────────

  async link(
    studentId: string,
    dto: LinkGuardianDto,
    actor: AccessTokenPayload,
  ): Promise<StudentGuardian[]> {
    await this.students.findByIdOrFail(studentId, actor.schoolId);
    const guardian = await this.guardians.findByIdOrFail(
      dto.guardianId,
      actor.schoolId,
    );

    const existing = await this.links.find(studentId, dto.guardianId);
    if (existing) {
      throw new ConflictException('Guardian is already linked to this student');
    }

    await this.links.withTransaction(async (tx) => {
      const hasGuardians =
        (await this.links.countForStudent(studentId, tx)) > 0;
      const makePrimary = dto.isPrimary ?? !hasGuardians;
      if (makePrimary) await this.links.demotePrimary(studentId, tx);
      await this.links.link(
        {
          studentId,
          guardianId: dto.guardianId,
          relation: dto.relation,
          isPrimary: makePrimary,
          isEmergencyContact: dto.isEmergencyContact ?? false,
        },
        tx,
      );
    });

    this.auditContext.set({
      entityType: 'StudentGuardian',
      entityId: studentId,
      newValues: {
        guardian: guardian.name,
        relation: dto.relation,
        isPrimary: dto.isPrimary ?? false,
      },
    });
    return this.links.listForStudent(studentId);
  }

  async updateLink(
    studentId: string,
    guardianId: string,
    dto: UpdateGuardianLinkDto,
    actor: AccessTokenPayload,
  ): Promise<StudentGuardian[]> {
    await this.students.findByIdOrFail(studentId, actor.schoolId);
    const link = await this.links.find(studentId, guardianId);
    if (!link) throw new NotFoundException('Guardian link not found');

    if (dto.isPrimary === false && link.isPrimary) {
      throw new BadRequestException(
        'Promote another guardian to primary instead of demoting this one',
      );
    }

    await this.links.withTransaction(async (tx) => {
      if (dto.isPrimary === true && !link.isPrimary) {
        await this.links.demotePrimary(studentId, tx);
      }
      await this.links.update(
        studentId,
        guardianId,
        {
          ...(dto.relation !== undefined ? { relation: dto.relation } : {}),
          ...(dto.isPrimary !== undefined ? { isPrimary: dto.isPrimary } : {}),
          ...(dto.isEmergencyContact !== undefined
            ? { isEmergencyContact: dto.isEmergencyContact }
            : {}),
        },
        tx,
      );
    });

    this.auditContext.set({
      entityType: 'StudentGuardian',
      entityId: studentId,
      oldValues: { guardianId, isPrimary: link.isPrimary },
      newValues: { guardianId, ...dto },
    });
    return this.links.listForStudent(studentId);
  }

  /** The primary link cannot be removed while other guardians remain
   *  (M09 §6: exactly one primary — promote another first). */
  async unlink(
    studentId: string,
    guardianId: string,
    actor: AccessTokenPayload,
  ): Promise<StudentGuardian[]> {
    await this.students.findByIdOrFail(studentId, actor.schoolId);
    const link = await this.links.find(studentId, guardianId);
    if (!link) throw new NotFoundException('Guardian link not found');

    const total = await this.links.countForStudent(studentId);
    if (link.isPrimary && total > 1) {
      throw new ConflictException(
        'This guardian is the primary contact — promote another guardian first',
      );
    }

    await this.links.unlink(studentId, guardianId);

    this.auditContext.set({
      entityType: 'StudentGuardian',
      entityId: studentId,
      oldValues: { guardianId, relation: link.relation },
    });
    return this.links.listForStudent(studentId);
  }
}
