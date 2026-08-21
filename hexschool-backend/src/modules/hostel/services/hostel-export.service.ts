import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type {
  MealOffReportQueryDto,
  OccupancyQueryDto,
  ResidentsQueryDto,
} from '../dto';
import { HostelReportsService } from './hostel-reports.service';
import { dhakaDisplayDate } from '../../../common/utils/clock.util';

export interface ExportFile {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

const XLSX_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Report files. The shapes come from `HostelReportsService`, so the sheet
 * and the screen are the same numbers (the M12 reports/export split).
 *
 * The resident register is the one that leaves the office: it is what a
 * warden carries on a fire drill, so it is laid out **room by room in the
 * order a person walks the corridor**, with the guardian's phone beside
 * each name — not sorted by roll number, which is useless when you are
 * standing outside a door counting heads.
 */
@Injectable()
export class HostelExportService {
  constructor(private readonly reports: HostelReportsService) {}

  async occupancyXlsx(
    query: OccupancyQueryDto,
    schoolId: string,
  ): Promise<ExportFile> {
    const report = await this.reports.occupancy(query, schoolId);
    const workbook = new ExcelJS.Workbook();

    const summary = workbook.addWorksheet('Summary');
    summary.columns = [
      { header: 'Hostel', key: 'hostel', width: 28 },
      { header: 'For', key: 'type', width: 10 },
      { header: 'Beds', key: 'total', width: 10 },
      { header: 'Occupied', key: 'occupied', width: 12 },
      { header: 'Vacant', key: 'vacant', width: 10 },
      { header: 'Maintenance', key: 'maintenance', width: 14 },
      { header: 'Utilization %', key: 'utilization', width: 14 },
      { header: 'Note', key: 'note', width: 44 },
    ];
    summary.getRow(1).font = { bold: true };
    for (const hostel of report.hostels) {
      summary.addRow({
        hostel: hostel.hostelName,
        type: hostel.type,
        ...hostel.occupancy,
        note: hostel.capacityNote ?? '',
      });
    }
    summary.addRow({ hostel: 'All hostels', ...report.overall });
    summary.lastRow!.font = { bold: true };

    const rooms = workbook.addWorksheet('Rooms');
    rooms.columns = [
      { header: 'Hostel', key: 'hostel', width: 24 },
      { header: 'Floor', key: 'floor', width: 8 },
      { header: 'Room', key: 'roomNo', width: 12 },
      { header: 'Type', key: 'type', width: 12 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Monthly fee', key: 'monthlyFee', width: 14 },
      { header: 'Beds', key: 'total', width: 8 },
      { header: 'Occupied', key: 'occupied', width: 10 },
      { header: 'Vacant', key: 'vacant', width: 10 },
      { header: 'Note', key: 'note', width: 44 },
    ];
    rooms.getRow(1).font = { bold: true };
    for (const hostel of report.hostels) {
      for (const floor of hostel.floors) {
        for (const room of floor.rooms) {
          rooms.addRow({
            hostel: hostel.hostelName,
            floor: floor.floor,
            roomNo: room.roomNo,
            type: room.type,
            status: room.status,
            monthlyFee: room.monthlyFee,
            total: room.occupancy.total,
            occupied: room.occupancy.occupied,
            vacant: room.occupancy.vacant,
            note: room.bedCountNote ?? '',
          });
        }
      }
    }

    return this.xlsx(workbook, `hostel-occupancy-${report.generatedAt}.xlsx`);
  }

  async residentsXlsx(
    query: ResidentsQueryDto,
    schoolId: string,
  ): Promise<ExportFile> {
    const rows = await this.reports.residents(query, schoolId);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Residents');
    sheet.columns = [
      { header: 'Hostel', key: 'hostelName', width: 24 },
      { header: 'Room', key: 'roomNo', width: 10 },
      { header: 'Bed', key: 'bedNo', width: 8 },
      { header: 'Student ID', key: 'studentUid', width: 18 },
      { header: 'Student', key: 'studentName', width: 28 },
      { header: 'Class', key: 'className', width: 12 },
      { header: 'Section', key: 'sectionName', width: 12 },
      { header: 'Roll', key: 'rollNo', width: 8 },
      { header: 'Since', key: 'startDate', width: 12 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Monthly fee', key: 'monthlyFee', width: 14 },
      { header: 'Mess plan', key: 'messPlan', width: 20 },
      { header: 'Guardian', key: 'guardianName', width: 24 },
      { header: 'Relation', key: 'guardianRelation', width: 14 },
      { header: 'Phone', key: 'guardianPhone', width: 16 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const row of rows) sheet.addRow(row);
    return this.xlsx(workbook, 'hostel-residents.xlsx');
  }

  async duesXlsx(
    query: ResidentsQueryDto,
    schoolId: string,
  ): Promise<ExportFile> {
    const rows = await this.reports.dues(query, schoolId);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Resident dues');
    sheet.columns = [
      { header: 'Hostel', key: 'hostelName', width: 24 },
      { header: 'Room', key: 'roomNo', width: 10 },
      { header: 'Student ID', key: 'studentUid', width: 18 },
      { header: 'Student', key: 'studentName', width: 28 },
      { header: 'Class', key: 'className', width: 12 },
      { header: 'Guardian', key: 'guardianName', width: 24 },
      { header: 'Phone', key: 'guardianPhone', width: 16 },
      { header: 'Outstanding (BDT)', key: 'outstanding', width: 18 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const row of rows) sheet.addRow(row);
    sheet.addRow({
      studentName: 'Total',
      outstanding: rows.reduce((sum, row) => sum + row.outstanding, 0),
    });
    sheet.lastRow!.font = { bold: true };
    return this.xlsx(workbook, 'hostel-dues.xlsx');
  }

  async mealOffsXlsx(
    query: MealOffReportQueryDto,
    schoolId: string,
  ): Promise<ExportFile> {
    const rows = await this.reports.mealOffSummary(query, schoolId);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Meal-offs');
    sheet.columns = [
      { header: 'Hostel', key: 'hostelName', width: 24 },
      { header: 'Student ID', key: 'studentUid', width: 18 },
      { header: 'Student', key: 'studentName', width: 28 },
      { header: 'Requests', key: 'requested', width: 12 },
      { header: 'Approved', key: 'approved', width: 12 },
      { header: 'Refused', key: 'rejected', width: 12 },
      { header: 'Days claimed', key: 'daysRequested', width: 14 },
      { header: 'Days credited', key: 'daysApproved', width: 14 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const row of rows) sheet.addRow(row);
    return this.xlsx(workbook, 'hostel-meal-offs.xlsx');
  }

  /** The register the warden carries. */
  async residentsPdf(
    query: ResidentsQueryDto,
    schoolId: string,
  ): Promise<ExportFile> {
    const rows = await this.reports.residents(query, schoolId);
    const doc = new PDFDocument({ size: 'A4', margin: 36 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));

    doc.fontSize(16).text('Hostel resident register', { align: 'left' });
    doc.moveDown(0.3);
    doc
      .fontSize(9)
      .text(
        `${rows.length} resident(s)   |   Printed: ${dhakaDisplayDate(new Date())}`,
      );
    doc.moveDown(0.8);

    // Room by room, in the order a person walks the corridor.
    const byRoom = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = `${row.hostelName} · Room ${row.roomNo}`;
      const list = byRoom.get(key) ?? [];
      list.push(row);
      byRoom.set(key, list);
    }

    for (const [room, residents] of [...byRoom].sort((a, b) =>
      a[0].localeCompare(b[0], undefined, { numeric: true }),
    )) {
      doc.fontSize(11).text(`${room}  — ${residents.length} boarder(s)`);
      doc.moveDown(0.2);
      doc.fontSize(9);
      for (const resident of residents) {
        doc.text(
          `   Bed ${resident.bedNo}  ·  ${resident.studentName}  ·  ${resident.className}${
            resident.sectionName ? ` ${resident.sectionName}` : ''
          } roll ${resident.rollNo ?? '—'}  ·  ${
            resident.guardianName ?? 'guardian not on file'
          } ${resident.guardianPhone ?? ''}`,
        );
      }
      doc.moveDown(0.5);
    }

    doc.end();
    await new Promise((resolve) => doc.on('end', resolve));
    return {
      buffer: Buffer.concat(chunks),
      filename: 'hostel-residents.pdf',
      contentType: 'application/pdf',
    };
  }

  private async xlsx(
    workbook: ExcelJS.Workbook,
    filename: string,
  ): Promise<ExportFile> {
    const buffer = await workbook.xlsx.writeBuffer();
    return {
      buffer: Buffer.from(buffer),
      filename,
      contentType: XLSX_TYPE,
    };
  }
}
