import { Injectable, Logger } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { StorageService } from '../../storage/storage.service';
import { buildZip, type ZipEntry } from '../calc/zip.util';
import { ASSIGNMENT_BUCKET_PURPOSE } from '../assignment.constants';
import { AssignmentsService } from './assignments.service';
import { SubmissionsService } from './submissions.service';

export interface ExportFile {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

interface StoredAttachment {
  key: string;
  name: string;
}

/**
 * Roadmap §5 — "download-all zip" on the submissions review table, plus
 * the marks sheet a teacher wants in Excel.
 *
 * The zip is assembled in memory through the dependency-free
 * `zip.util.ts` writer. Entries are foldered per student
 * (`Roll 07 — Rahim Uddin/essay.pdf`) because the alternative — forty
 * files called `homework.pdf` in one folder — is what the teacher is
 * trying to escape by downloading them together.
 *
 * A file that cannot be fetched from S3 is **skipped with a note in the
 * archive** rather than failing the download. One missing object must not
 * cost a teacher the other thirty-nine submissions.
 */
@Injectable()
export class AssignmentExportService {
  private readonly logger = new Logger(AssignmentExportService.name);

  constructor(
    private readonly assignments: AssignmentsService,
    private readonly submissions: SubmissionsService,
    private readonly storage: StorageService,
  ) {}

  async submissionsZip(
    assignmentId: string,
    actor: AccessTokenPayload,
  ): Promise<ExportFile> {
    const assignment = await this.assignments.findOrFail(
      assignmentId,
      actor.schoolId,
    );
    const { rows } = await this.submissions.grid(assignmentId, actor);

    const entries: ZipEntry[] = [];
    const missing: string[] = [];

    for (const row of rows) {
      if (!row.submission) continue;
      const folder = `Roll ${String(row.rollNo).padStart(2, '0')} - ${row.studentName}`;

      if (row.submission.textAnswer) {
        entries.push({
          name: `${folder}/answer.txt`,
          data: Buffer.from(row.submission.textAnswer, 'utf8'),
          date: row.submission.submittedAt,
        });
      }

      for (const file of this.attachmentsOf(row.submission.attachmentUrls)) {
        try {
          const data = await this.storage.download(
            file.key,
            ASSIGNMENT_BUCKET_PURPOSE,
          );
          entries.push({
            name: `${folder}/${file.name}`,
            data,
            date: row.submission.submittedAt,
          });
        } catch (error) {
          this.logger.warn(
            `Submission attachment ${file.key} could not be read: ${(error as Error).message}`,
          );
          missing.push(`${folder}/${file.name}`);
        }
      }
    }

    if (missing.length > 0) {
      entries.push({
        name: '_missing-files.txt',
        data: Buffer.from(
          [
            'These attachments could not be read from storage and are not in this archive:',
            ...missing.map((m) => `  - ${m}`),
          ].join('\n'),
          'utf8',
        ),
      });
    }

    return {
      buffer: buildZip(entries),
      filename: `${this.slug(assignment.title)}-submissions.zip`,
      contentType: 'application/zip',
    };
  }

  async marksSheet(
    assignmentId: string,
    actor: AccessTokenPayload,
  ): Promise<ExportFile> {
    const assignment = await this.assignments.findOrFail(
      assignmentId,
      actor.schoolId,
    );
    const { rows, stats } = await this.submissions.grid(assignmentId, actor);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Submissions');

    sheet.addRow([assignment.title]);
    sheet.addRow([
      `${assignment.section.class.name} ${assignment.section.name} · ${assignment.subject.name}`,
    ]);
    sheet.addRow([
      `Due ${assignment.dueAt.toISOString()} · full marks ${
        assignment.fullMarks === null ? '—' : String(assignment.fullMarks)
      }`,
    ]);
    sheet.addRow([
      `Submitted ${stats.submitted}/${stats.expected} (${stats.submissionRate}%) · late ${stats.late} · evaluated ${stats.evaluated}`,
    ]);
    sheet.addRow([]);
    sheet.addRow([
      'Roll',
      'Student ID',
      'Name',
      'Status',
      'Submitted at',
      'Late',
      'Attempt',
      'Marks',
      'Feedback',
    ]);
    sheet.getRow(6).font = { bold: true };

    for (const row of rows) {
      sheet.addRow([
        row.rollNo,
        row.studentUid,
        row.studentName + (row.transferredOut ? ' (transferred)' : ''),
        row.submission?.status ?? 'NOT SUBMITTED',
        row.submission?.submittedAt.toISOString() ?? '',
        row.submission?.isLate ? 'Yes' : '',
        row.submission?.attempt ?? '',
        row.submission?.marks === null || row.submission === null
          ? ''
          : Number(row.submission.marks),
        row.submission?.feedback ?? '',
      ]);
    }

    sheet.columns.forEach((column, index) => {
      column.width = [8, 18, 28, 16, 24, 8, 9, 10, 40][index] ?? 14;
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return {
      buffer: Buffer.from(buffer),
      filename: `${this.slug(assignment.title)}-marks.xlsx`,
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  private attachmentsOf(value: unknown): StoredAttachment[] {
    if (!Array.isArray(value)) return [];
    return value.filter(
      (v): v is StoredAttachment =>
        typeof v === 'object' &&
        v !== null &&
        typeof (v as StoredAttachment).key === 'string' &&
        typeof (v as StoredAttachment).name === 'string',
    );
  }

  private slug(title: string): string {
    return (
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'assignment'
    );
  }
}
