import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ResultStatus } from '../../../common/constants';
import { SessionsService } from '../../academic/services/sessions.service';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { ExamsRepository } from '../../exam/repositories/exams.repository';
import {
  CombinedComponent,
  combine,
  weightError,
} from '../calc/combined-result.engine';
import { parseGradingSnapshot } from '../calc/grading-snapshot';
import { rankScopes } from '../calc/merit.engine';
import { CombinedResultQueryDto, GenerateCombinedResultDto } from '../dto';
import {
  CombinedResultsRepository,
  CombinedResultWithRelations,
} from '../repositories/combined-results.repository';
import { ResultsRepository } from '../repositories/results.repository';
import { ResultSettingsService } from './result-settings.service';

export interface CombinedGenerationResult {
  name: string;
  sessionId: string;
  generated: number;
  skipped: Array<{ enrollmentId: string; reason: string }>;
  components: Array<{ examId: string; examName: string; weight: number }>;
}

/**
 * Weighted final results — "Annual = 30 % Half-Yearly + 70 % Annual"
 * (roadmap M15 §3).
 *
 * The weight set is validated to sum to 100 and then **frozen onto every
 * generated row**: an exam type's `weight` may be edited afterwards
 * without restating a final result already issued. That is the same
 * argument that freezes the grading snapshot, and it is the reason M14
 * deliberately left "does a combined set sum to 100" to this module —
 * only the merge knows which types it is merging.
 *
 * A candidate missing from any component exam is **skipped rather than
 * merged as a zero**: a student who joined after the half-yearly has no
 * half-yearly result, and inventing one would fail them.
 */
@Injectable()
export class CombinedResultsService {
  constructor(
    private readonly combined: CombinedResultsRepository,
    private readonly results: ResultsRepository,
    private readonly exams: ExamsRepository,
    private readonly sessions: SessionsService,
    private readonly config: ResultSettingsService,
    private readonly auditContext: AuditContextService,
  ) {}

  // ── read ────────────────────────────────────────────────────────────

  async listBatches(sessionId: string | undefined, schoolId: string) {
    const resolved = await this.resolveSession(sessionId, schoolId);
    return this.combined.findBatchNames(resolved, schoolId);
  }

  async getBatch(
    query: CombinedResultQueryDto,
    schoolId: string,
  ): Promise<CombinedResultWithRelations[]> {
    const sessionId = await this.resolveSession(query.sessionId, schoolId);
    return this.combined.findBatch(sessionId, query.name.trim(), {
      classId: query.classId,
      sectionId: query.sectionId,
    });
  }

  // ── write ───────────────────────────────────────────────────────────

  async generate(
    dto: GenerateCombinedResultDto,
    actor: AccessTokenPayload,
  ): Promise<CombinedGenerationResult> {
    const schoolId = actor.schoolId;
    const sessionId = await this.resolveSession(dto.sessionId, schoolId);
    const name = dto.name.trim();

    const weightsInvalid = weightError(dto.components.map((c) => c.weight));
    if (weightsInvalid) throw new BadRequestException(weightsInvalid);

    const uniqueExams = new Set(dto.components.map((c) => c.examId));
    if (uniqueExams.size !== dto.components.length) {
      throw new BadRequestException('An exam may only be weighted once');
    }

    // Load every component exam and its results up front: a merge that
    // discovers a missing exam halfway through would leave the batch
    // half-written.
    const parts: Array<{
      examId: string;
      examName: string;
      weight: number;
      results: Map<
        string,
        Awaited<ReturnType<ResultsRepository['findForExam']>>[number]
      >;
    }> = [];

    for (const component of dto.components) {
      const exam = await this.exams.findDetail(component.examId, schoolId);
      if (!exam) {
        throw new BadRequestException(`Exam ${component.examId} not found`);
      }
      if (exam.sessionId !== sessionId) {
        throw new BadRequestException(
          `${exam.name} belongs to a different session — a combined result merges one session's exams`,
        );
      }
      const rows = await this.results.findForExam(exam.id);
      if (rows.length === 0) {
        throw new BadRequestException(
          `${exam.name} has no processed results — process it before combining`,
        );
      }
      parts.push({
        examId: exam.id,
        examName: exam.name,
        weight: component.weight,
        results: new Map(rows.map((r) => [r.enrollmentId, r])),
      });
    }

    const config = await this.config.load(schoolId);
    // The scale comes from the first component's frozen snapshot: every
    // exam of a session grades against the same system in practice, and
    // reading a live table here would undo the whole freezing argument.
    const snapshot = parseGradingSnapshot(
      [...parts[0].results.values()][0].gradingSnapshot,
    );

    const weights = Object.fromEntries(parts.map((p) => [p.examId, p.weight]));
    const enrollmentIds = [...parts[0].results.keys()];
    const skipped: CombinedGenerationResult['skipped'] = [];
    const ranked: Array<{
      key: string;
      gpa: number;
      obtainedMarks: number;
      rollNo: number;
      sectionId: string;
      classId: string;
    }> = [];
    const idByEnrollment = new Map<string, string>();

    await this.combined.withTransaction(async (tx) => {
      // A regenerate replaces the batch wholesale, so a candidate who
      // dropped out of one component does not linger from a prior run.
      await this.combined.deleteBatch(sessionId, name, tx);

      for (const enrollmentId of enrollmentIds) {
        const rows = parts.map((part) => ({
          part,
          result: part.results.get(enrollmentId),
        }));
        const missing = rows.filter((r) => !r.result);
        if (missing.length > 0) {
          skipped.push({
            enrollmentId,
            reason: `No result in ${missing.map((m) => m.part.examName).join(', ')}`,
          });
          continue;
        }

        const components: CombinedComponent[] = rows.map(
          ({ part, result }) => ({
            examId: part.examId,
            examName: part.examName,
            weight: part.weight,
            gpa: Number(result!.gpa),
            obtainedMarks: Number(result!.obtainedMarks),
            totalMarks: Number(result!.totalMarks),
            status: result!.status,
          }),
        );

        const outcome = combine(components, snapshot);
        const anchor = rows[0].result!;

        const id = await this.combined.upsert(
          {
            schoolId,
            sessionId,
            enrollmentId,
            name,
            components: outcome.components as unknown as Prisma.InputJsonValue,
            weights: weights,
            totalMarks: outcome.totalMarks,
            obtainedMarks: outcome.obtainedMarks,
            gpa: outcome.gpa,
            grade: outcome.grade,
            status: outcome.status,
            generatedAt: new Date(),
            createdBy: actor.sub,
            updatedBy: actor.sub,
          },
          tx,
        );
        idByEnrollment.set(enrollmentId, id);

        if (outcome.status === ResultStatus.PASSED) {
          ranked.push({
            key: enrollmentId,
            gpa: outcome.gpa,
            obtainedMarks: outcome.obtainedMarks,
            rollNo: anchor.enrollment.rollNo,
            sectionId: anchor.enrollment.sectionId,
            classId: anchor.enrollment.classId,
          });
        }
      }

      // Merit over the merged GPAs — the same second pass and the same
      // engine the per-exam processor uses.
      const positions = rankScopes(ranked, config.meritTiebreak);
      for (const [enrollmentId, id] of idByEnrollment) {
        await this.combined.setMerit(
          id,
          positions.get(enrollmentId) ?? { section: null, class: null },
          tx,
        );
      }
    });

    this.auditContext.set({
      entityType: 'CombinedResult',
      entityId: `${sessionId}:${name}`,
      newValues: {
        name,
        sessionId,
        components: parts.map((p) => ({
          examId: p.examId,
          examName: p.examName,
          weight: p.weight,
        })),
        generated: idByEnrollment.size,
        skipped: skipped.length,
      },
    });

    return {
      name,
      sessionId,
      generated: idByEnrollment.size,
      skipped,
      components: parts.map((p) => ({
        examId: p.examId,
        examName: p.examName,
        weight: p.weight,
      })),
    };
  }

  async removeBatch(
    query: CombinedResultQueryDto,
    actor: AccessTokenPayload,
  ): Promise<{ removed: number }> {
    const sessionId = await this.resolveSession(
      query.sessionId,
      actor.schoolId,
    );
    const removed = await this.combined.deleteBatch(
      sessionId,
      query.name.trim(),
    );
    if (removed === 0) {
      throw new NotFoundException(`No combined result named "${query.name}"`);
    }
    this.auditContext.set({
      entityType: 'CombinedResult',
      entityId: `${sessionId}:${query.name.trim()}`,
      oldValues: { name: query.name.trim(), rows: removed },
    });
    return { removed };
  }

  private async resolveSession(
    sessionId: string | undefined,
    schoolId: string,
  ): Promise<string> {
    if (sessionId) return sessionId;
    const current = await this.sessions.getCurrent(schoolId);
    if (!current) {
      throw new BadRequestException(
        'No current academic session — pass sessionId explicitly',
      );
    }
    return current.id;
  }
}
