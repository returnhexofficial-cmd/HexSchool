import { Injectable } from '@nestjs/common';
import { Workbook } from 'exceljs';
import PDFDocument from 'pdfkit';
import type {
  ReportCard,
  TabulationSheet,
  Transcript,
} from './result-reports.service';

export interface ExportFile {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

const XLSX_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Printable result artifacts: the tabulation sheet a controller of
 * examinations checks, the report card that goes home with a student,
 * and the multi-exam transcript.
 *
 * Pure presentation over the shapes `ResultReportsService` produces (the
 * M12 split), and deliberately plain — the styled, school-branded report
 * engine arrives with M18, and pdfkit's default font cannot set Bangla,
 * which is the same limitation flagged for the M09 ID cards and the M13
 * routines.
 */
@Injectable()
export class ResultExportService {
  // ── tabulation ──────────────────────────────────────────────────────

  async tabulationXlsx(sheet: TabulationSheet): Promise<ExportFile> {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Tabulation');

    worksheet.addRow([sheet.exam.name]);
    worksheet.addRow([`${sheet.scope} · ${sheet.exam.sessionName}`]);
    worksheet.addRow([]);
    worksheet.addRow([
      'Roll',
      'UID',
      'Name',
      'Section',
      ...sheet.papers.map((p) => `${p.subjectName} (${p.fullMarks})`),
      'Total',
      'GPA',
      'Grade',
      'Status',
      'Merit (section)',
      'Merit (class)',
    ]);

    for (const row of sheet.rows) {
      worksheet.addRow([
        row.rollNo,
        row.studentUid,
        row.studentName,
        row.sectionName,
        ...sheet.papers.map((p) => cell(row.marks[p.examSubjectId])),
        row.obtainedMarks,
        row.gpa,
        row.grade,
        row.status,
        row.meritPositionSection ?? '',
        row.meritPositionClass ?? '',
      ]);
    }

    worksheet.addRow([]);
    worksheet.addRow([
      `Candidates ${sheet.summary.candidates} · Passed ${sheet.summary.passed} · Failed ${sheet.summary.failed} · Incomplete ${sheet.summary.incomplete}`,
    ]);

    worksheet.getRow(1).font = { bold: true, size: 14 };
    worksheet.getRow(4).font = { bold: true };
    worksheet.columns.forEach((column) => {
      column.width = 14;
    });

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return {
      buffer,
      filename: `tabulation-${slug(sheet.exam.name)}.xlsx`,
      contentType: XLSX_TYPE,
    };
  }

  async tabulationPdf(sheet: TabulationSheet): Promise<ExportFile> {
    // Landscape: a section sheet is 6–10 subject columns wide.
    const doc = this.newDoc(`Tabulation — ${sheet.exam.name}`, 'landscape');
    const chunks: Buffer[] = [];
    const done = this.collect(doc, chunks);

    doc.fontSize(15).font('Helvetica-Bold').text(sheet.exam.name);
    doc
      .fontSize(9)
      .font('Helvetica')
      .fillColor('#555')
      .text(`${sheet.scope} · ${sheet.exam.sessionName} · Tabulation sheet`);
    doc.moveDown(0.8).fillColor('#000');

    const subjectWidth = Math.max(
      34,
      Math.min(60, Math.floor(430 / Math.max(1, sheet.papers.length))),
    );
    const widths = [
      34,
      140,
      ...sheet.papers.map(() => subjectWidth),
      46,
      36,
      38,
      52,
    ];

    this.table(
      doc,
      [
        'Roll',
        'Name',
        ...sheet.papers.map((p) => abbreviate(p.subjectName)),
        'Total',
        'GPA',
        'Grade',
        'Merit',
      ],
      sheet.rows.map((row) => [
        String(row.rollNo),
        row.studentName,
        ...sheet.papers.map((p) => cell(row.marks[p.examSubjectId])),
        String(row.obtainedMarks),
        row.gpa.toFixed(2),
        row.grade,
        row.meritPositionClass === null ? '—' : `#${row.meritPositionClass}`,
      ]),
      widths,
    );

    doc.moveDown(0.8);
    doc
      .fontSize(8)
      .fillColor('#6b7280')
      .text(
        `Candidates ${sheet.summary.candidates}   ·   Passed ${sheet.summary.passed}   ·   Failed ${sheet.summary.failed}   ·   Incomplete ${sheet.summary.incomplete}`,
      );
    doc.moveDown(1.5).fillColor('#000');
    doc
      .fontSize(8)
      .text(
        'Prepared by: ________________     Checked by: ________________     Principal: ________________',
      );

    doc.end();
    return {
      buffer: await done,
      filename: `tabulation-${slug(sheet.exam.name)}.pdf`,
      contentType: 'application/pdf',
    };
  }

  // ── report cards ────────────────────────────────────────────────────

  /** One A4 page per candidate — the batch the office prints and folds. */
  async reportCardsPdf(cards: ReportCard[]): Promise<ExportFile> {
    const doc = this.newDoc(
      `Report cards — ${cards[0]?.exam.name ?? 'Exam'}`,
      'portrait',
    );
    const chunks: Buffer[] = [];
    const done = this.collect(doc, chunks);

    cards.forEach((card, index) => {
      if (index > 0) doc.addPage();
      this.renderReportCard(doc, card);
    });

    doc.end();
    return {
      buffer: await done,
      filename:
        cards.length === 1
          ? `report-card-${slug(cards[0].student.uid)}.pdf`
          : `report-cards-${slug(cards[0]?.exam.name ?? 'exam')}.pdf`,
      contentType: 'application/pdf',
    };
  }

  private renderReportCard(doc: PDFKit.PDFDocument, card: ReportCard): void {
    const left = doc.page.margins.left;

    doc.fontSize(16).font('Helvetica-Bold').text(card.school.name, {
      align: 'center',
    });
    if (card.school.address) {
      doc
        .fontSize(8)
        .font('Helvetica')
        .fillColor('#555')
        .text(card.school.address, { align: 'center' });
    }
    doc
      .moveDown(0.3)
      .fontSize(12)
      .font('Helvetica-Bold')
      .fillColor('#1e3a5f')
      .text(`${card.exam.name} — ${card.exam.sessionName}`, {
        align: 'center',
      });
    doc.moveDown(0.8).fillColor('#000');

    // Identity block, two columns.
    const top = doc.y;
    doc.fontSize(9).font('Helvetica');
    doc.text(`Name: ${card.student.name}`, left, top);
    doc.text(`Student ID: ${card.student.uid}`, left, doc.y);
    doc.text(
      `Class: ${card.student.className} — ${card.student.sectionName}`,
      left,
      doc.y,
    );
    doc.text(`Roll: ${card.student.rollNo}`, left, doc.y);
    doc.y = top;
    const rightCol = left + 300;
    doc.text(`GPA: ${card.summary.gpa.toFixed(2)}`, rightCol, doc.y);
    doc.text(`Grade: ${card.summary.grade}`, rightCol, doc.y);
    doc.text(`Result: ${card.summary.status}`, rightCol, doc.y);
    if (card.summary.meritPositionClass !== null) {
      doc.text(
        `Merit (class): ${card.summary.meritPositionClass}`,
        rightCol,
        doc.y,
      );
    }
    doc.x = left;
    doc.moveDown(1);

    const hasComponents = card.subjects.some(
      (s) =>
        s.cq !== null ||
        s.mcq !== null ||
        s.practical !== null ||
        s.ca !== null,
    );

    this.table(
      doc,
      hasComponents
        ? ['Subject', 'CQ', 'MCQ', 'Prac', 'CA', 'Total', 'Full', 'Grade', 'GP']
        : ['Subject', 'Marks', 'Full', 'Pass', 'Grade', 'GP', 'Remark'],
      card.subjects.map((s) =>
        hasComponents
          ? [
              subjectLabel(s),
              num(s.cq),
              num(s.mcq),
              num(s.practical),
              num(s.ca),
              s.isAbsent ? 'Abs' : String(s.obtained),
              String(s.fullMarks),
              s.grade,
              s.gradePoint.toFixed(2),
            ]
          : [
              subjectLabel(s),
              s.isAbsent ? 'Absent' : String(s.obtained),
              String(s.fullMarks),
              String(s.passMarks),
              s.grade,
              s.gradePoint.toFixed(2),
              remark(s),
            ],
      ),
      hasComponents
        ? [140, 42, 42, 42, 42, 48, 42, 46, 40]
        : [150, 60, 46, 46, 50, 44, 128],
    );

    doc.moveDown(0.8);
    doc.fontSize(9).font('Helvetica-Bold');
    doc.text(
      `Total ${card.summary.obtainedMarks} / ${card.summary.totalMarks}  (${card.summary.percentage}%)   ·   GPA ${card.summary.gpa.toFixed(2)} (${card.summary.grade})`,
      left,
      doc.y,
    );
    doc.font('Helvetica').fontSize(8).fillColor('#555');
    doc.text(
      `GPA without 4th subject: ${card.summary.gpaWithoutOptional.toFixed(2)}   ·   Failed subjects: ${card.summary.failedSubjects}`,
    );
    if (card.attendance) {
      doc.text(
        `Attendance: ${card.attendance.percentage}% over ${card.attendance.markedDays} marked day(s)`,
      );
    }
    // A grace mark is a decision about a student, so it is printed
    // rather than folded silently into the total.
    const graced = card.subjects.filter((s) => s.graceApplied > 0);
    if (graced.length > 0) {
      doc.text(
        `Grace marks applied: ${graced
          .map((s) => `${s.subjectName} +${s.graceApplied}`)
          .join(', ')}`,
      );
    }
    doc.fillColor('#000');

    doc.moveDown(2.5);
    doc
      .fontSize(8)
      .text(
        'Class Teacher: ______________     Guardian: ______________     Principal: ______________',
      );
    if (card.footer) {
      doc.moveDown(0.8).fontSize(7).fillColor('#6b7280').text(card.footer);
      doc.fillColor('#000');
    }
  }

  // ── transcript ──────────────────────────────────────────────────────

  async transcriptPdf(transcript: Transcript): Promise<ExportFile> {
    const doc = this.newDoc(
      `Transcript — ${transcript.student.name}`,
      'portrait',
    );
    const chunks: Buffer[] = [];
    const done = this.collect(doc, chunks);

    doc.fontSize(16).font('Helvetica-Bold').text(transcript.school.name, {
      align: 'center',
    });
    doc
      .moveDown(0.3)
      .fontSize(12)
      .fillColor('#1e3a5f')
      .text('Academic Transcript', { align: 'center' });
    doc.moveDown(0.8).fillColor('#000');

    doc
      .fontSize(9)
      .font('Helvetica')
      .text(`Name: ${transcript.student.name}`)
      .text(`Student ID: ${transcript.student.uid}`);
    doc.moveDown(0.8);

    this.table(
      doc,
      ['Exam', 'Class', 'Roll', 'Marks', 'GPA', 'Grade', 'Result', 'Merit'],
      transcript.exams.map((e) => [
        e.examName,
        e.className,
        String(e.rollNo),
        `${e.obtainedMarks}/${e.totalMarks}`,
        e.gpa.toFixed(2),
        e.grade,
        e.status,
        e.meritPositionClass === null ? '—' : `#${e.meritPositionClass}`,
      ]),
      [130, 62, 38, 74, 42, 46, 66, 46],
    );

    doc.moveDown(2.5);
    doc
      .fontSize(8)
      .text(
        'Verified by: ______________________     Principal: ______________________',
      );

    doc.end();
    return {
      buffer: await done,
      filename: `transcript-${slug(transcript.student.uid)}.pdf`,
      contentType: 'application/pdf',
    };
  }

  // ── renderers ───────────────────────────────────────────────────────

  private table(
    doc: PDFKit.PDFDocument,
    headers: string[],
    rows: string[][],
    widths: number[],
  ): void {
    const left = doc.page.margins.left;
    const write = (cells: string[], bold: boolean): void => {
      if (doc.y > doc.page.height - 60) doc.addPage();
      const top = doc.y;
      let x = left;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 8.5 : 8);
      cells.forEach((cellText, i) => {
        doc.text(cellText, x, top, {
          width: widths[i] - 4,
          ellipsis: true,
          lineBreak: false,
        });
        x += widths[i];
      });
      doc.y = top + 13;
      doc.x = left;
    };

    write(headers, true);
    doc
      .moveTo(left, doc.y - 3)
      .lineTo(left + widths.reduce((a, b) => a + b, 0), doc.y - 3)
      .strokeColor('#9ca3af')
      .stroke();
    for (const row of rows) write(row, false);
    if (rows.length === 0) {
      doc.font('Helvetica').fontSize(9).text('Nothing to show.', left, doc.y);
    }
  }

  private newDoc(
    title: string,
    layout: 'portrait' | 'landscape',
  ): PDFKit.PDFDocument {
    return new PDFDocument({
      size: 'A4',
      layout,
      margin: 36,
      info: { Title: title },
    });
  }

  private collect(doc: PDFKit.PDFDocument, chunks: Buffer[]): Promise<Buffer> {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    return new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });
  }
}

function cell(
  mark: { obtained: number; grade: string; absent: boolean } | null,
): string {
  if (!mark) return '—';
  return mark.absent ? 'Abs' : String(mark.obtained);
}

function num(value: number | null): string {
  return value === null ? '—' : String(value);
}

function subjectLabel(subject: {
  subjectName: string;
  isOptional: boolean;
}): string {
  return subject.isOptional
    ? `${subject.subjectName} (4th)`
    : subject.subjectName;
}

function remark(subject: {
  passed: boolean;
  isAbsent: boolean;
  failedComponents: string[];
}): string {
  if (subject.isAbsent) return 'Absent';
  if (subject.passed) return '';
  return subject.failedComponents.length > 0
    ? `Failed: ${subject.failedComponents.join(', ')}`
    : 'Below pass mark';
}

function abbreviate(name: string): string {
  return name.length <= 8 ? name : `${name.slice(0, 7)}.`;
}

function slug(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'result';
}
