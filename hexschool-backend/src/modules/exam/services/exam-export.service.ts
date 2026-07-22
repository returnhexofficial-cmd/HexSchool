import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { isoDate } from '../../academic/calendar/date.util';
import type { SeatPlanWithEntries } from '../repositories/seat-plans.repository';
import type { ExamRoutine } from './exam-routine.service';

export interface ExportFile {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

/**
 * Printable exam artifacts: the routine a school pins to the notice
 * board and the per-room seat list an invigilator carries into the hall.
 *
 * Deliberately plain like the M12/M13 exports — the styled report engine
 * arrives with M18.
 */
@Injectable()
export class ExamExportService {
  /** The routine, one block per sitting date. */
  async routinePdf(routine: ExamRoutine): Promise<ExportFile> {
    const doc = this.newDoc(`Routine — ${routine.exam.name}`, 'portrait');
    const chunks: Buffer[] = [];
    const done = this.collect(doc, chunks);

    doc.fontSize(15).font('Helvetica-Bold').text(routine.exam.name);
    doc
      .fontSize(9)
      .font('Helvetica')
      .fillColor('#555')
      .text(
        `${routine.exam.examTypeName} · ${routine.exam.sessionName} · ${routine.exam.startDate} → ${routine.exam.endDate} · ${routine.exam.status}`,
      );
    doc.moveDown(0.8).fillColor('#000');

    if (routine.days.length === 0) {
      doc.fontSize(10).text('No sittings have been scheduled yet.');
    }

    for (const day of routine.days) {
      if (doc.y > doc.page.height - 120) doc.addPage();
      doc
        .fontSize(11)
        .font('Helvetica-Bold')
        .fillColor('#1e3a5f')
        .text(
          `${day.date}${day.holiday ? `  ⚠ ${day.holidayTitle ?? 'Holiday'}` : ''}`,
        );
      doc.moveDown(0.2).fillColor('#000');

      this.table(
        doc,
        ['Class', 'Subject', 'Time', 'Room', 'Full', 'Pass'],
        day.sittings.map((s) => [
          s.className,
          `${s.subjectName} (${s.subjectCode})`,
          `${s.startTime}–${s.endTime}`,
          s.room ?? '—',
          String(s.fullMarks),
          String(s.passMarks),
        ]),
        [70, 170, 90, 70, 45, 45],
      );
      doc.moveDown(0.6);
    }

    if (routine.unscheduled.length > 0) {
      doc.moveDown(0.5);
      doc
        .fontSize(10)
        .font('Helvetica-Bold')
        .fillColor('#b45309')
        .text(`${routine.unscheduled.length} paper(s) not yet scheduled`);
      doc.fillColor('#000');
      this.table(
        doc,
        ['Class', 'Subject'],
        routine.unscheduled.map((u) => [u.className, u.subjectName]),
        [120, 300],
      );
    }

    doc.end();
    return {
      buffer: await done,
      filename: `exam-routine-${slug(routine.exam.name)}.pdf`,
      contentType: 'application/pdf',
    };
  }

  /** Seat plans: one page per room, plus a summary table. */
  async seatPlanPdf(
    examName: string,
    plans: SeatPlanWithEntries[],
  ): Promise<ExportFile> {
    const doc = this.newDoc(`Seat plan — ${examName}`, 'portrait');
    const chunks: Buffer[] = [];
    const done = this.collect(doc, chunks);

    doc.fontSize(15).font('Helvetica-Bold').text(examName);
    doc
      .fontSize(9)
      .font('Helvetica')
      .fillColor('#555')
      .text(`Seat plan · ${plans.length} room(s)`);
    doc.moveDown(0.8).fillColor('#000');

    this.table(
      doc,
      ['Date', 'Room', 'Seated', 'Capacity', 'Layout'],
      plans.map((p) => [
        isoDate(p.date),
        p.room,
        String(p.entries.length),
        String(p.capacity),
        p.strategy,
      ]),
      [90, 90, 70, 70, 100],
    );

    for (const plan of plans) {
      doc.addPage();
      doc.fontSize(14).font('Helvetica-Bold').text(`Room ${plan.room}`);
      doc
        .fontSize(9)
        .font('Helvetica')
        .fillColor('#555')
        .text(
          `${isoDate(plan.date)} · ${plan.entries.length}/${plan.capacity} seats · ${plan.strategy}`,
        );
      doc.moveDown(0.6).fillColor('#000');

      this.table(
        doc,
        ['Seat', 'Student ID', 'Name', 'Class', 'Section', 'Roll'],
        plan.entries.map((e) => [
          String(e.seatNo),
          e.enrollment.student.studentUid,
          `${e.enrollment.student.firstName} ${e.enrollment.student.lastName}`,
          e.enrollment.class.name,
          e.enrollment.section.name,
          String(e.enrollment.rollNo),
        ]),
        [40, 90, 150, 65, 55, 40],
      );

      // Invigilator sign-off — the sheet is a legal register in practice.
      doc.moveDown(2);
      doc
        .fontSize(8)
        .fillColor('#6b7280')
        .text(
          'Invigilator: ______________________     Signature: ______________________     Date: ____________',
        );
      doc.fillColor('#000');
    }

    doc.end();
    return {
      buffer: await done,
      filename: `seat-plan-${slug(examName)}.pdf`,
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
      cells.forEach((cell, i) => {
        doc.text(cell, x, top, {
          width: widths[i] - 4,
          ellipsis: true,
          lineBreak: false,
        });
        x += widths[i];
      });
      doc.y = top + 13;
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

function slug(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'exam';
}
