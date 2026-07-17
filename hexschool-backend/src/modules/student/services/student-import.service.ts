import { BadRequestException, Injectable } from '@nestjs/common';
import { Workbook, type Worksheet } from 'exceljs';
import { Gender, GuardianRelation, Religion } from '../../../common/constants';
import { parseDate } from '../../academic/calendar/date.util';
import { ClassesRepository } from '../../academic/repositories/classes.repository';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import {
  BD_PHONE_PATTERN,
  BLOOD_GROUPS,
  NID_PATTERN,
} from '../../staff/dto/staff.dto';
import { BIRTH_CERT_PATTERN, CreateStudentDto } from '../dto';
import { StudentsService } from './students.service';

export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
const IMPORT_MAX_ROWS = 2000;

/** Column order is the template contract — keep both in sync. */
const COLUMNS = [
  ['firstName', 'First Name *'],
  ['lastName', 'Last Name *'],
  ['nameBn', 'Name (Bangla)'],
  ['gender', 'Gender * (MALE/FEMALE/OTHER)'],
  ['dob', 'Date of Birth * (YYYY-MM-DD)'],
  ['religion', 'Religion (ISLAM/HINDUISM/BUDDHISM/CHRISTIANITY/OTHER)'],
  ['bloodGroup', 'Blood Group (A+/A-/B+/B-/AB+/AB-/O+/O-)'],
  ['birthCertificateNo', 'Birth Certificate No (17 digits)'],
  ['admissionDate', 'Admission Date * (YYYY-MM-DD)'],
  ['classLevel', 'Class Level * (numeric, e.g. 6)'],
  ['previousSchool', 'Previous School'],
  ['presentAddress', 'Present Address'],
  ['permanentAddress', 'Permanent Address'],
  ['guardianName', 'Guardian Name *'],
  ['guardianPhone', 'Guardian Phone * (01XXXXXXXXX)'],
  [
    'guardianRelation',
    'Guardian Relation * (FATHER/MOTHER/BROTHER/SISTER/UNCLE/AUNT/GRANDPARENT/LEGAL_GUARDIAN/OTHER)',
  ],
  ['guardianNid', 'Guardian NID'],
  ['guardianOccupation', 'Guardian Occupation'],
  ['guardianEmail', 'Guardian Email'],
] as const;

type ColumnKey = (typeof COLUMNS)[number][0];

export interface ImportRowResult {
  row: number;
  status: 'VALID' | 'ERROR' | 'IMPORTED';
  studentUid?: string;
  errors: string[];
  warnings: string[];
}

export interface ImportReport {
  total: number;
  valid: number;
  invalid: number;
  imported: number;
  committed: boolean;
  rows: ImportRowResult[];
}

/**
 * XLSX bulk import (roadmap M09 §4 — onboarding existing schools).
 * Two-phase: dry run (commit=false) returns the row-level validation
 * report; commit inserts every VALID row through StudentsService.create
 * (one transaction per row — a bad row never rolls back its neighbours,
 * and each student still gets the gap-free UID + guardian dedup +
 * duplicate warnings of the normal path). Bangla text arrives as UTF-8
 * XLSX natively.
 */
@Injectable()
export class StudentImportService {
  constructor(
    private readonly studentsService: StudentsService,
    private readonly classes: ClassesRepository,
    private readonly auditContext: AuditContextService,
  ) {}

  /** Downloadable template: headers + one sample row + notes. */
  async buildTemplate(): Promise<Buffer> {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Students');
    sheet.addRow(COLUMNS.map(([, header]) => header));
    sheet.getRow(1).font = { bold: true };
    sheet.columns.forEach((col) => {
      col.width = 22;
    });
    sheet.addRow([
      'Rahim',
      'Uddin',
      'রহিম উদ্দিন',
      'MALE',
      '2014-03-12',
      'ISLAM',
      'B+',
      '',
      '2026-01-10',
      '6',
      '',
      'House 1, Road 2, Dhaka',
      '',
      'Karim Uddin',
      '01712345678',
      'FATHER',
      '',
      'Service',
      '',
    ]);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  async import(
    file: { buffer: Buffer; size: number } | undefined,
    commit: boolean,
    actor: AccessTokenPayload,
  ): Promise<ImportReport> {
    if (!file) throw new BadRequestException('XLSX file is required');
    if (file.size > IMPORT_MAX_BYTES) {
      throw new BadRequestException('Import file must be 5 MB or smaller');
    }

    const workbook = new Workbook();
    try {
      await workbook.xlsx.load(file.buffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException('File is not a readable XLSX workbook');
    }
    const sheet = workbook.worksheets[0];
    if (!sheet || sheet.rowCount < 2) {
      throw new BadRequestException('Workbook has no data rows');
    }
    if (sheet.rowCount - 1 > IMPORT_MAX_ROWS) {
      throw new BadRequestException(
        `Import is limited to ${IMPORT_MAX_ROWS} rows per file`,
      );
    }

    const classesByLevel = new Map(
      (await this.classes.findAll(undefined, actor.schoolId)).map((c) => [
        c.numericLevel,
        c,
      ]),
    );

    const rows: ImportRowResult[] = [];
    const seenInFile = new Set<string>();
    const seenBirthCerts = new Set<string>();

    for (let rowNo = 2; rowNo <= sheet.rowCount; rowNo += 1) {
      const raw = this.readRow(sheet, rowNo);
      if (Object.values(raw).every((v) => v === '')) continue; // blank line

      const result: ImportRowResult = {
        row: rowNo,
        status: 'VALID',
        errors: [],
        warnings: [],
      };
      const dto = this.validateRow(raw, classesByLevel, result);

      // In-file duplicate probes (DB-level ones run in create()).
      const nameDobKey =
        `${raw.firstName}|${raw.lastName}|${raw.dob}`.toLowerCase();
      if (dto && seenInFile.has(nameDobKey)) {
        result.warnings.push('Duplicate name + date of birth within this file');
      }
      seenInFile.add(nameDobKey);
      if (raw.birthCertificateNo) {
        if (seenBirthCerts.has(raw.birthCertificateNo)) {
          result.errors.push(
            'Birth certificate number appears twice in this file',
          );
        }
        seenBirthCerts.add(raw.birthCertificateNo);
      }

      if (result.errors.length > 0) {
        result.status = 'ERROR';
        rows.push(result);
        continue;
      }

      if (commit && dto) {
        try {
          const created = await this.studentsService.create(dto, actor);
          result.status = 'IMPORTED';
          result.studentUid = created.student.studentUid;
          result.warnings.push(
            ...created.warnings,
            ...created.duplicateWarnings.map(
              (d) => `Possible duplicate of ${d.studentUid} (${d.name})`,
            ),
          );
        } catch (err) {
          result.status = 'ERROR';
          result.errors.push(
            err instanceof Error ? err.message : 'Import failed',
          );
        }
      }
      rows.push(result);
    }

    const report: ImportReport = {
      total: rows.length,
      valid: rows.filter((r) => r.status !== 'ERROR').length,
      invalid: rows.filter((r) => r.status === 'ERROR').length,
      imported: rows.filter((r) => r.status === 'IMPORTED').length,
      committed: commit,
      rows,
    };

    if (commit) {
      this.auditContext.set({
        entityType: 'StudentImport',
        entityId: actor.schoolId,
        newValues: {
          total: report.total,
          imported: report.imported,
          invalid: report.invalid,
        },
      });
    }
    return report;
  }

  // ── internals ─────────────────────────────────────────────────────

  private readRow(sheet: Worksheet, rowNo: number): Record<ColumnKey, string> {
    const row = sheet.getRow(rowNo);
    const out = {} as Record<ColumnKey, string>;
    COLUMNS.forEach(([key], idx) => {
      const cell = row.getCell(idx + 1);
      const value = cell.value;
      if (value instanceof Date) {
        out[key] = value.toISOString().slice(0, 10);
      } else {
        out[key] = (cell.text ?? '').trim();
      }
    });
    return out;
  }

  private validateRow(
    raw: Record<ColumnKey, string>,
    classesByLevel: Map<number, { id: string }>,
    result: ImportRowResult,
  ): CreateStudentDto | null {
    const errors = result.errors;

    if (!raw.firstName) errors.push('firstName is required');
    if (!raw.lastName) errors.push('lastName is required');
    if (!this.isEnum(raw.gender, Gender)) {
      errors.push('gender must be MALE, FEMALE or OTHER');
    }
    if (raw.religion && !this.isEnum(raw.religion, Religion)) {
      errors.push('religion is not a recognised value');
    }
    if (raw.bloodGroup && !BLOOD_GROUPS.includes(raw.bloodGroup as never)) {
      errors.push('bloodGroup is not a recognised value');
    }
    if (
      raw.birthCertificateNo &&
      !BIRTH_CERT_PATTERN.test(raw.birthCertificateNo)
    ) {
      errors.push('birthCertificateNo must be 17 digits');
    }

    let dob: Date | null = null;
    let admission: Date | null = null;
    try {
      dob = parseDate(raw.dob);
    } catch {
      errors.push('dob must be a valid YYYY-MM-DD date');
    }
    try {
      admission = parseDate(raw.admissionDate);
    } catch {
      errors.push('admissionDate must be a valid YYYY-MM-DD date');
    }
    if (dob && admission && dob.getTime() >= admission.getTime()) {
      errors.push('admissionDate must be after dob');
    }

    const level = Number(raw.classLevel);
    const admissionClass = Number.isInteger(level)
      ? classesByLevel.get(level)
      : undefined;
    if (!admissionClass) {
      errors.push(`classLevel ${raw.classLevel || '(empty)'} matches no class`);
    }

    if (!raw.guardianName) errors.push('guardianName is required');
    if (!BD_PHONE_PATTERN.test(raw.guardianPhone)) {
      errors.push('guardianPhone must be a BD mobile number (01XXXXXXXXX)');
    }
    if (!this.isEnum(raw.guardianRelation, GuardianRelation)) {
      errors.push('guardianRelation is not a recognised value');
    }
    if (raw.guardianNid && !NID_PATTERN.test(raw.guardianNid)) {
      errors.push('guardianNid must be 10, 13 or 17 digits');
    }
    if (
      raw.guardianEmail &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.guardianEmail)
    ) {
      errors.push('guardianEmail is not a valid email address');
    }

    if (errors.length > 0) return null;

    return {
      firstName: raw.firstName,
      lastName: raw.lastName,
      nameBn: raw.nameBn || undefined,
      gender: raw.gender as Gender,
      dob: raw.dob,
      bloodGroup: raw.bloodGroup || undefined,
      religion: (raw.religion || undefined) as Religion | undefined,
      birthCertificateNo: raw.birthCertificateNo || undefined,
      presentAddress: raw.presentAddress
        ? { present: raw.presentAddress }
        : undefined,
      permanentAddress: raw.permanentAddress
        ? { permanent: raw.permanentAddress }
        : undefined,
      admissionDate: raw.admissionDate,
      admissionClassId: admissionClass!.id,
      previousSchool: raw.previousSchool || undefined,
      guardians: [
        {
          name: raw.guardianName,
          phone: raw.guardianPhone,
          relation: raw.guardianRelation as GuardianRelation,
          nid: raw.guardianNid || undefined,
          occupation: raw.guardianOccupation || undefined,
          email: raw.guardianEmail || undefined,
          isPrimary: true,
          isEmergencyContact: true,
        },
      ],
    };
  }

  private isEnum(value: string, enumObj: Record<string, string>): boolean {
    return Object.values(enumObj).includes(value);
  }
}
