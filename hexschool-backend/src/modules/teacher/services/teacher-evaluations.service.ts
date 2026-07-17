import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TeacherEvaluation } from '@prisma/client';
import { parseDate } from '../../academic/calendar/date.util';
import { SessionsService } from '../../academic/services/sessions.service';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { CreateEvaluationDto, UpdateEvaluationDto } from '../dto';
import { TeacherEvaluationsRepository } from '../repositories/teacher-evaluations.repository';
import { TeachersRepository } from '../repositories/teachers.repository';

/**
 * Evaluation records (roadmap M08): per-criterion scores (criterion
 * names come from the `academic.teacher_evaluation_criteria` setting —
 * free-form here, the setting only drives the form), overall score 0–100
 * (DB CHECK too). evaluator = the acting user.
 */
@Injectable()
export class TeacherEvaluationsService {
  constructor(
    private readonly evaluations: TeacherEvaluationsRepository,
    private readonly teachers: TeachersRepository,
    private readonly sessions: SessionsService,
    private readonly auditContext: AuditContextService,
  ) {}

  async list(
    teacherId: string,
    schoolId: string,
    sessionId?: string,
  ): Promise<TeacherEvaluation[]> {
    await this.teachers.findByIdOrFail(teacherId, schoolId);
    return this.evaluations.listForTeacher(teacherId, sessionId);
  }

  async create(
    teacherId: string,
    dto: CreateEvaluationDto,
    actor: AccessTokenPayload,
  ): Promise<TeacherEvaluation> {
    await this.teachers.findByIdOrFail(teacherId, actor.schoolId);
    await this.sessions.getById(dto.sessionId, actor.schoolId);
    this.assertCriteria(dto.criteria);

    const evaluation = await this.evaluations.create({
      schoolId: actor.schoolId,
      teacherId,
      sessionId: dto.sessionId,
      evaluatorId: actor.sub,
      criteria: dto.criteria,
      score: dto.score,
      remarks: dto.remarks,
      evaluatedAt: parseDate(dto.evaluatedAt),
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });
    this.auditContext.set({
      entityType: 'TeacherEvaluation',
      entityId: evaluation.id,
      newValues: { teacherId, score: dto.score, sessionId: dto.sessionId },
    });
    return evaluation;
  }

  async update(
    teacherId: string,
    evaluationId: string,
    dto: UpdateEvaluationDto,
    actor: AccessTokenPayload,
  ): Promise<TeacherEvaluation> {
    await this.teachers.findByIdOrFail(teacherId, actor.schoolId);
    const existing = await this.getOwned(teacherId, evaluationId);
    if (dto.sessionId) {
      await this.sessions.getById(dto.sessionId, actor.schoolId);
    }
    if (dto.criteria) this.assertCriteria(dto.criteria);

    const updated = await this.evaluations.update(evaluationId, {
      ...(dto.sessionId !== undefined ? { sessionId: dto.sessionId } : {}),
      ...(dto.criteria !== undefined ? { criteria: dto.criteria } : {}),
      ...(dto.score !== undefined ? { score: dto.score } : {}),
      ...(dto.remarks !== undefined ? { remarks: dto.remarks } : {}),
      ...(dto.evaluatedAt !== undefined
        ? { evaluatedAt: parseDate(dto.evaluatedAt) }
        : {}),
      updatedBy: actor.sub,
    });
    this.auditContext.set({
      entityType: 'TeacherEvaluation',
      entityId: evaluationId,
      oldValues: { score: existing.score, remarks: existing.remarks },
      newValues: { score: updated.score, remarks: updated.remarks },
    });
    return updated;
  }

  async remove(
    teacherId: string,
    evaluationId: string,
    actor: AccessTokenPayload,
  ): Promise<void> {
    await this.teachers.findByIdOrFail(teacherId, actor.schoolId);
    const existing = await this.getOwned(teacherId, evaluationId);
    await this.evaluations.hardDelete(evaluationId);
    this.auditContext.set({
      entityType: 'TeacherEvaluation',
      entityId: evaluationId,
      oldValues: { teacherId, score: existing.score },
    });
  }

  // ── internals ─────────────────────────────────────────────────────

  private async getOwned(
    teacherId: string,
    evaluationId: string,
  ): Promise<TeacherEvaluation> {
    const evaluation = await this.evaluations.findOne({
      id: evaluationId,
      teacherId,
    });
    if (!evaluation) {
      throw new NotFoundException(`Evaluation ${evaluationId} not found`);
    }
    return evaluation;
  }

  /** Every criterion score must be a number 0–100. */
  private assertCriteria(criteria: Record<string, unknown>): void {
    for (const [name, value] of Object.entries(criteria)) {
      if (
        typeof value !== 'number' ||
        Number.isNaN(value) ||
        value < 0 ||
        value > 100
      ) {
        throw new BadRequestException(
          `Criterion "${name}" must score between 0 and 100`,
        );
      }
    }
  }
}
