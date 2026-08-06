import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ResultStatus } from '@prisma/client';
import { CertificateType } from '../../../common/constants';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { ResultsRepository } from '../../result/repositories/results.repository';
import {
  ordinal,
  selectPrizeWinners,
  type PrizeCandidate,
  type PrizeSelectionResult,
} from '../calc/prize.engine';
import type { BulkPrizeDto } from '../dto';
import { CertificatesService } from './certificates.service';
import { DocumentSettingsService } from './document-settings.service';

export interface BulkPrizeResult {
  selection: PrizeSelectionResult;
  /** Empty on a dry run — the wizard's first step never writes. */
  issued: Array<{
    certificateId: string;
    certificateNo: string;
    studentName: string;
    className: string;
    position: string;
  }>;
  failed: Array<{ studentName: string; reason: string }>;
  warnings: string[];
  dryRun: boolean;
}

/**
 * Roadmap §4's "Bulk prize certificates (e.g., merit top-3 per class from
 * an exam) wizard endpoint".
 *
 * **It always previews before it writes**, and `dryRun` defaults to true
 * for a reason worth stating: a run that raised two hundred certificates
 * before showing anybody the list would be corrected by *revoking* two
 * hundred certificates, each of which is a permanent row in the register
 * with a number that can never be reused. Preview-then-confirm is not a UI
 * nicety here; it is the only cheap step in the process.
 *
 * The selection itself is `prize.engine`'s, which cuts on **position
 * rather than count** so a tied second place takes both students.
 */
@Injectable()
export class PrizeWizardService {
  private readonly logger = new Logger(PrizeWizardService.name);

  constructor(
    private readonly results: ResultsRepository,
    private readonly certificates: CertificatesService,
    private readonly config: DocumentSettingsService,
  ) {}

  async run(
    dto: BulkPrizeDto,
    actor: AccessTokenPayload,
  ): Promise<BulkPrizeResult> {
    const config = await this.config.load(actor.schoolId);
    const rows = await this.results.findForExam(dto.examId, {});
    if (rows.length === 0) {
      throw new NotFoundException(
        'That exam has no processed results — run the processor before raising prize certificates.',
      );
    }

    const wanted = dto.classIds?.length ? new Set(dto.classIds) : null;
    const candidates: PrizeCandidate[] = rows
      .filter((row) => !wanted || wanted.has(row.enrollment.class.id))
      .map((row) => ({
        enrollmentId: row.enrollmentId,
        studentId: row.enrollment.student.id,
        classId: row.enrollment.class.id,
        className: row.enrollment.class.name,
        studentName:
          `${row.enrollment.student.firstName} ${row.enrollment.student.lastName}`.trim(),
        position: row.meritPositionClass,
        gpa: row.gpa === null ? null : Number(row.gpa),
        passed: row.status === ResultStatus.PASSED,
      }));

    const selection = selectPrizeWinners(candidates, dto.topN);
    const warnings: string[] = [];

    if (selection.total > config.bulkPrizeMax) {
      throw new BadRequestException(
        `That would raise ${selection.total} certificates, over the ${config.bulkPrizeMax} limit (documents.bulk_prize_max). Narrow the classes or lower the cut.`,
      );
    }
    for (const skipped of selection.skipped) {
      warnings.push(`${skipped.className}: ${skipped.reason}`);
    }
    for (const entry of selection.classes) {
      if (entry.note) warnings.push(`${entry.className}: ${entry.note}`);
    }

    // The default is a preview. Writing needs BOTH `dryRun: false` and
    // `issue: true` — one flag would make an accidental default of `false`
    // into two hundred certificates.
    const writing = dto.dryRun === false && dto.issue === true;
    if (!writing) {
      return {
        selection,
        issued: [],
        failed: [],
        warnings: [
          ...warnings,
          `Preview only — ${selection.total} certificate(s) would be raised. Send dryRun:false and issue:true to write them.`,
        ],
        dryRun: true,
      };
    }

    const issued: BulkPrizeResult['issued'] = [];
    const failed: BulkPrizeResult['failed'] = [];

    for (const entry of selection.classes) {
      for (const winner of entry.winners) {
        try {
          // One certificate per transaction, deliberately: a batch that
          // rolled back on its ninetieth student would return eighty-nine
          // sequence numbers and leave the office with nothing, and the
          // failures here are per-student (a missing record, a clearance)
          // rather than systemic — the M09 XLSX-import rule, where one bad
          // row never rolls back its neighbours.
          const result = await this.certificates.create(
            {
              studentId: winner.studentId,
              type: CertificateType.PRIZE,
              templateId: dto.templateId,
              enrollmentId: winner.enrollmentId,
              conduct: config.conductDefault,
              examId: dto.examId,
              extra: {
                prize_position: ordinal(winner.position as number),
                prize_class: entry.className,
              },
              remarks: `Merit position ${winner.position} in ${entry.className}`,
              issue: true,
              // A prize is not a leaving document, and nothing about it
              // should touch a student's status.
              confirmTransfer: false,
            },
            actor,
          );
          issued.push({
            certificateId: result.certificate.id,
            certificateNo: result.certificate.certificateNo ?? '',
            studentName: winner.studentName,
            className: entry.className,
            position: ordinal(winner.position as number),
          });
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `Prize certificate failed for ${winner.studentName}: ${reason}`,
          );
          failed.push({ studentName: winner.studentName, reason });
        }
      }
    }

    return { selection, issued, failed, warnings, dryRun: false };
  }
}
