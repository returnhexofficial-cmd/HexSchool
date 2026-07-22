import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ExamType } from '@prisma/client';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { CreateExamTypeDto, UpdateExamTypeDto } from '../dto';
import { ExamTypesRepository } from '../repositories/exam-types.repository';

/**
 * Exam types — the small master list ("Half Yearly", "Class Test") every
 * exam hangs off. Names are unique per school case-insensitively
 * (`uq_exam_types_name`); the pre-check gives a readable 409 instead of a
 * raw constraint violation.
 */
@Injectable()
export class ExamTypesService {
  constructor(
    private readonly examTypes: ExamTypesRepository,
    private readonly auditContext: AuditContextService,
  ) {}

  async list(schoolId: string): Promise<ExamType[]> {
    return this.examTypes.findAllForSchool(schoolId);
  }

  async getById(id: string, schoolId: string): Promise<ExamType> {
    const type = await this.examTypes.findById(id, schoolId);
    if (!type) throw new NotFoundException(`Exam type ${id} not found`);
    return type;
  }

  async create(
    dto: CreateExamTypeDto,
    actor: AccessTokenPayload,
  ): Promise<ExamType> {
    const name = dto.name.trim();
    await this.assertNameFree(actor.schoolId, name);

    const created = await this.examTypes.create({
      schoolId: actor.schoolId,
      name,
      weight: dto.weight ?? null,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'ExamType',
      entityId: created.id,
      newValues: { name, weight: dto.weight ?? null },
    });
    return created;
  }

  async update(
    id: string,
    dto: UpdateExamTypeDto,
    actor: AccessTokenPayload,
  ): Promise<ExamType> {
    const existing = await this.getById(id, actor.schoolId);
    const name = dto.name?.trim();
    if (name && name.toLowerCase() !== existing.name.toLowerCase()) {
      await this.assertNameFree(actor.schoolId, name, id);
    }

    const updated = await this.examTypes.update(id, {
      ...(name ? { name } : {}),
      ...(dto.weight !== undefined ? { weight: dto.weight } : {}),
      updatedBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'ExamType',
      entityId: id,
      oldValues: { name: existing.name, weight: existing.weight },
      newValues: { name: updated.name, weight: updated.weight },
    });
    return updated;
  }

  /** Blocked while exams reference it — an orphaned exam has no type. */
  async remove(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.getById(id, actor.schoolId);
    const exams = await this.examTypes.countExams(id);
    if (exams > 0) {
      throw new ConflictException(
        `"${existing.name}" is used by ${exams} exam(s) — archive those exams first`,
      );
    }

    await this.examTypes.softDelete(id);
    this.auditContext.set({
      entityType: 'ExamType',
      entityId: id,
      oldValues: { name: existing.name, weight: existing.weight },
    });
  }

  private async assertNameFree(
    schoolId: string,
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const clash = await this.examTypes.findByName(schoolId, name, excludeId);
    if (clash) {
      throw new ConflictException(
        `An exam type named "${name}" already exists`,
      );
    }
  }
}
