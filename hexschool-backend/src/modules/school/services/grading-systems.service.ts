import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { CreateGradingSystemDto, UpdateGradingSystemDto } from '../dto';
import {
  findCoverageIssues,
  findOverlapIssues,
  GradeBand,
} from '../grading/grade-range.validator';
import {
  GradingSystemsRepository,
  GradingSystemWithPoints,
} from '../repositories/grading-systems.repository';

/**
 * Grading system lifecycle (roadmap M04 §6): overlap-free bands on every
 * save; full 0–100 coverage before a system can be(come) the default;
 * exactly one default per school (transactional switch + partial unique
 * index); the default cannot be deleted. Published results snapshot
 * their grades (M15), so edits here never mutate history.
 */
@Injectable()
export class GradingSystemsService {
  constructor(
    private readonly systems: GradingSystemsRepository,
    private readonly auditContext: AuditContextService,
  ) {}

  async list(schoolId: string): Promise<GradingSystemWithPoints[]> {
    return this.systems.findAllWithPoints(schoolId);
  }

  async create(
    dto: CreateGradingSystemDto,
    actor: AccessTokenPayload,
  ): Promise<GradingSystemWithPoints> {
    this.assertBands(dto.gradePoints, dto.isDefault ?? false);

    const system = await this.systems.createWithPoints(
      {
        schoolId: actor.schoolId,
        name: dto.name,
        isDefault: false, // promoted below via the transactional switch
        createdBy: actor.sub,
        updatedBy: actor.sub,
      },
      dto.gradePoints,
    );
    if (dto.isDefault) {
      await this.systems.setDefault(system.id, actor.schoolId);
      system.isDefault = true;
    }

    this.auditContext.set({
      entityType: 'GradingSystem',
      entityId: system.id,
      newValues: this.snapshot(system),
    });
    return system;
  }

  async update(
    id: string,
    dto: UpdateGradingSystemDto,
    actor: AccessTokenPayload,
  ): Promise<GradingSystemWithPoints> {
    const existing = await this.getOrFail(id, actor.schoolId);

    const bands = dto.gradePoints ?? existing.gradePoints;
    const willBeDefault = dto.isDefault ?? existing.isDefault;
    this.assertBands(bands, willBeDefault);

    if (existing.isDefault && dto.isDefault === false) {
      throw new BadRequestException(
        'Demote by setting another system as default instead',
      );
    }

    const updated = await this.systems.updateWithPoints(
      id,
      {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        updatedBy: actor.sub,
      },
      dto.gradePoints,
    );
    if (dto.isDefault && !existing.isDefault) {
      await this.systems.setDefault(id, actor.schoolId);
      updated.isDefault = true;
    }

    this.auditContext.set({
      entityType: 'GradingSystem',
      entityId: id,
      oldValues: this.snapshot(existing),
      newValues: this.snapshot(updated),
    });
    return updated;
  }

  async remove(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.getOrFail(id, actor.schoolId);
    if (existing.isDefault) {
      throw new ConflictException(
        'The default grading system cannot be deleted — set another default first',
      );
    }
    await this.systems.softDelete(id);
    this.auditContext.set({
      entityType: 'GradingSystem',
      entityId: id,
      oldValues: this.snapshot(existing),
    });
  }

  // ── internals ─────────────────────────────────────────────────────

  private async getOrFail(
    id: string,
    schoolId: string,
  ): Promise<GradingSystemWithPoints> {
    const system = await this.systems.findByIdWithPoints(id, schoolId);
    if (!system) throw new NotFoundException(`GradingSystem ${id} not found`);
    return system;
  }

  private assertBands(
    bands: Array<GradeBand & { point?: unknown }>,
    mustCover: boolean,
  ): void {
    const grades = bands.map((b) => b.grade);
    if (new Set(grades).size !== grades.length) {
      throw new BadRequestException('Grade labels must be unique');
    }
    const issues = [
      ...findOverlapIssues(bands),
      ...(mustCover ? findCoverageIssues(bands) : []),
    ];
    if (issues.length > 0) {
      throw new BadRequestException(
        `Invalid grade ranges: ${issues.map((i) => i.message).join('; ')}`,
      );
    }
  }

  private snapshot(system: GradingSystemWithPoints) {
    return {
      name: system.name,
      isDefault: system.isDefault,
      gradePoints: system.gradePoints.map(
        (p) => `${p.grade} ${p.minMark}-${p.maxMark} (${p.point.toString()})`,
      ),
    };
  }
}
