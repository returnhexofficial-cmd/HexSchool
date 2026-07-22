import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { PeriodSlotType } from '../../../common/constants';
import type {
  MasterRoutine,
  RoutineCell,
  SectionRoutine,
  TeacherRoutine,
} from './routine.service';

export interface ExportFile {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

/**
 * Printable routines (roadmap M13 §4): the section grid a classroom pins
 * to the wall and a teacher's personal week. Both are the same
 * days × periods matrix, so one renderer serves them and the callers only
 * decide what goes in each cell.
 *
 * Deliberately plain like the M12 exports — the styled report engine
 * arrives with M18. Landscape throughout: a week of periods never fits a
 * portrait page legibly.
 */
@Injectable()
export class RoutineExportService {
  async sectionPdf(routine: SectionRoutine): Promise<ExportFile> {
    const byCell = new Map(
      routine.cells.map((c) => [`${c.day}|${c.periodSlotId}`, c]),
    );
    return this.grid(
      `routine-${routine.section.className}-${routine.section.name}`.replace(
        /\s+/g,
        '',
      ),
      `${routine.section.className} — Section ${routine.section.name}`,
      [
        routine.session.name,
        routine.section.shiftName ? `${routine.section.shiftName} shift` : '',
        routine.timetable
          ? `v${routine.timetable.version} · ${routine.timetable.status} · from ${routine.timetable.effectiveFrom}`
          : 'No published routine',
        routine.section.roomNo ? `Room ${routine.section.roomNo}` : '',
      ]
        .filter(Boolean)
        .join(' · '),
      routine,
      (day, slotId) => {
        const cell = byCell.get(`${day}|${slotId}`);
        if (!cell) return [];
        return [
          cell.subject.name,
          cell.teacher.name,
          this.roomLine(cell, routine.section.roomNo),
        ].filter((line): line is string => Boolean(line));
      },
    );
  }

  async teacherPdf(routine: TeacherRoutine): Promise<ExportFile> {
    const byCell = new Map(
      routine.cells.map((c) => [`${c.day}|${c.periodSlotId}`, c]),
    );
    return this.grid(
      `routine-${routine.teacher.employeeId}`,
      `${routine.teacher.name} (${routine.teacher.employeeId})`,
      `${routine.session.name} · ${routine.periodsPerWeek} period(s) per week`,
      routine,
      (day, slotId) => {
        const cell = byCell.get(`${day}|${slotId}`);
        if (!cell) return [];
        return [
          cell.sectionLabel,
          cell.subject.name,
          cell.roomNo ? `Room ${cell.roomNo}` : '',
        ].filter((line): line is string => Boolean(line));
      },
    );
  }

  /** Whole-school load sheet — one row per section, plus the teacher heat list. */
  async masterPdf(routine: MasterRoutine): Promise<ExportFile> {
    const doc = this.newDoc(`Master routine · ${routine.session.name}`);
    const chunks: Buffer[] = [];
    const done = this.collect(doc, chunks);

    doc.fontSize(14).text('Master routine');
    doc
      .fontSize(9)
      .fillColor('#555')
      .text(
        `${routine.session.name} · ${routine.sections.length} section(s) · ${routine.days.length}-day week`,
      );
    doc.moveDown(0.8).fillColor('#000');

    this.table(
      doc,
      ['Section', 'Shift', 'Status', 'Filled', 'Capacity', 'Coverage'],
      routine.sections.map((row) => [
        row.sectionLabel,
        row.shiftName ?? '—',
        row.status ?? 'NOT BUILT',
        String(row.filled),
        String(row.capacity),
        row.capacity > 0
          ? `${Math.round((row.filled / row.capacity) * 100)}%`
          : '—',
      ]),
    );

    doc.moveDown(1).fontSize(12).text('Teacher load');
    doc.moveDown(0.4);
    this.table(
      doc,
      ['Teacher', 'Employee ID', 'Periods/week', ...routine.days],
      routine.teacherLoad.map((row) => [
        row.name,
        row.employeeId,
        String(row.periodsPerWeek),
        ...routine.days.map((day) => String(row.byDay[day] ?? 0)),
      ]),
    );

    doc.end();
    return {
      buffer: await done,
      filename: `master-routine-${routine.session.name.replace(/\s+/g, '')}.pdf`,
      contentType: 'application/pdf',
    };
  }

  // ── renderers ───────────────────────────────────────────────────────

  /**
   * The shared days × periods matrix. BREAK/ASSEMBLY rows are shaded and
   * span the week — they are the same for every day, and printing an
   * empty cell per day would suggest a lesson could go there.
   */
  private async grid(
    basename: string,
    title: string,
    subtitle: string,
    routine: Pick<SectionRoutine, 'days' | 'slots'>,
    cellLines: (day: string, slotId: string) => string[],
  ): Promise<ExportFile> {
    const doc = this.newDoc(title);
    const chunks: Buffer[] = [];
    const done = this.collect(doc, chunks);

    doc.fontSize(14).text(title);
    doc.fontSize(9).fillColor('#555').text(subtitle);
    doc.moveDown(0.8).fillColor('#000');

    const left = 32;
    const usable = doc.page.width - 64;
    const periodWidth = 96;
    const dayWidth = (usable - periodWidth) / Math.max(1, routine.days.length);
    const rowHeight = 44;

    // Header row.
    let y = doc.y;
    doc.fontSize(9);
    doc.text('Period', left, y, { width: periodWidth - 4 });
    routine.days.forEach((day, index) => {
      doc.text(day, left + periodWidth + index * dayWidth, y, {
        width: dayWidth - 4,
      });
    });
    y += 16;
    doc
      .moveTo(left, y - 4)
      .lineTo(doc.page.width - 32, y - 4)
      .strokeColor('#999')
      .stroke();

    for (const slot of routine.slots) {
      if (y + rowHeight > doc.page.height - 40) {
        doc.addPage();
        y = doc.y;
      }

      doc.fontSize(8).fillColor('#000');
      doc.text(`${slot.name}\n${slot.startTime}–${slot.endTime}`, left, y, {
        width: periodWidth - 4,
      });

      if (slot.type === PeriodSlotType.CLASS) {
        routine.days.forEach((day, index) => {
          const lines = cellLines(day, slot.id);
          const x = left + periodWidth + index * dayWidth;
          if (lines.length === 0) {
            doc.fillColor('#bbb').text('—', x, y, { width: dayWidth - 4 });
          } else {
            doc
              .fillColor('#000')
              .fontSize(8)
              .text(lines[0], x, y, {
                width: dayWidth - 4,
                ellipsis: true,
                lineBreak: false,
              });
            doc
              .fontSize(7)
              .fillColor('#555')
              .text(lines.slice(1).join('\n'), x, y + 11, {
                width: dayWidth - 4,
                ellipsis: true,
              });
          }
        });
      } else {
        doc
          .fillColor('#777')
          .fontSize(8)
          .text(slot.type, left + periodWidth, y, {
            width: usable - periodWidth,
            align: 'center',
          });
      }

      y += rowHeight;
      doc.fillColor('#000');
      doc
        .moveTo(left, y - 6)
        .lineTo(doc.page.width - 32, y - 6)
        .strokeColor('#e5e5e5')
        .stroke();
    }

    doc.end();
    return {
      buffer: await done,
      filename: `${basename}.pdf`,
      contentType: 'application/pdf',
    };
  }

  private table(
    doc: PDFKit.PDFDocument,
    headers: string[],
    rows: string[][],
  ): void {
    const left = 32;
    const usable = doc.page.width - 64;
    const colWidth = usable / headers.length;
    const write = (cells: string[], bold: boolean) => {
      if (doc.y > doc.page.height - 48) doc.addPage();
      const top = doc.y;
      doc.fontSize(bold ? 8.5 : 8);
      cells.forEach((cell, index) => {
        doc.text(cell, left + index * colWidth, top, {
          width: colWidth - 4,
          ellipsis: true,
          lineBreak: false,
        });
      });
      doc.y = top + 13;
    };
    write(headers, true);
    doc
      .moveTo(left, doc.y - 3)
      .lineTo(doc.page.width - 32, doc.y - 3)
      .strokeColor('#999')
      .stroke();
    for (const row of rows) write(row, false);
    if (rows.length === 0) doc.fontSize(9).text('Nothing to show.');
  }

  private newDoc(title: string): PDFKit.PDFDocument {
    return new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: 32,
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

  /** A cell only prints its room when it differs from the section's own. */
  private roomLine(cell: RoutineCell, sectionRoom: string | null): string {
    if (cell.combinedWith) return `with ${cell.combinedWith.label}`;
    if (!cell.roomNo || cell.roomNo === sectionRoom) return '';
    return `Room ${cell.roomNo}`;
  }
}
