import { Workbook } from 'exceljs';
import { UserType } from '../../../common/constants';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { StudentImportService } from './student-import.service';

const actor: AccessTokenPayload = {
  sub: 'actor-1',
  schoolId: 'school-1',
  userType: UserType.ADMIN,
};

const HEADERS = 19;

const goodRow = (overrides: Record<number, string> = {}): string[] => {
  const row = [
    'Rahim', // firstName
    'Uddin', // lastName
    'রহিম উদ্দিন', // nameBn (UTF-8 Bangla — M09 §8)
    'MALE', // gender
    '2014-03-12', // dob
    'ISLAM', // religion
    'B+', // bloodGroup
    '', // birthCertificateNo
    '2026-01-10', // admissionDate
    '6', // classLevel
    '', // previousSchool
    'House 1, Dhaka', // presentAddress
    '', // permanentAddress
    'Karim Uddin', // guardianName
    '01712345678', // guardianPhone
    'FATHER', // guardianRelation
    '', // guardianNid
    'Service', // guardianOccupation
    '', // guardianEmail
  ];
  for (const [idx, value] of Object.entries(overrides)) {
    row[Number(idx)] = value;
  }
  return row;
};

async function workbookBuffer(rows: string[][]): Promise<Buffer> {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet('Students');
  sheet.addRow(Array.from({ length: HEADERS }, (_, i) => `Col ${i + 1}`));
  rows.forEach((r) => sheet.addRow(r));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('StudentImportService', () => {
  let studentsService: { create: jest.Mock };
  let classes: { findAll: jest.Mock };
  let service: StudentImportService;

  beforeEach(() => {
    studentsService = {
      create: jest.fn().mockResolvedValue({
        student: { studentUid: 'HXS-202600001' },
        duplicateWarnings: [],
        warnings: [],
      }),
    };
    classes = {
      findAll: jest
        .fn()
        .mockResolvedValue([{ id: 'class-6', numericLevel: 6 }]),
    };
    service = new StudentImportService(
      studentsService as never,
      classes as never,
      { set: jest.fn() } as never,
    );
  });

  it('produces a downloadable template workbook', async () => {
    const template = await service.buildTemplate();
    const workbook = new Workbook();
    await workbook.xlsx.load(template as unknown as ArrayBuffer);
    expect(workbook.worksheets[0].getRow(1).cellCount).toBe(HEADERS);
  });

  it('dry run validates without inserting', async () => {
    const buffer = await workbookBuffer([goodRow()]);

    const report = await service.import(
      { buffer, size: buffer.length },
      false,
      actor,
    );
    expect(report).toMatchObject({
      total: 1,
      valid: 1,
      invalid: 0,
      imported: 0,
      committed: false,
    });
    expect(studentsService.create).not.toHaveBeenCalled();
  });

  it('reports row-level errors with row numbers', async () => {
    const buffer = await workbookBuffer([
      goodRow(),
      goodRow({ 3: 'MALE-ISH', 14: '123', 9: '99' }),
    ]);

    const report = await service.import(
      { buffer, size: buffer.length },
      false,
      actor,
    );
    expect(report.invalid).toBe(1);
    const bad = report.rows.find((r) => r.status === 'ERROR')!;
    expect(bad.row).toBe(3); // header is row 1
    expect(bad.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('gender'),
        expect.stringContaining('guardianPhone'),
        expect.stringContaining('classLevel'),
      ]),
    );
  });

  it('flags in-file duplicates (warn for name+dob, error for birth cert)', async () => {
    const buffer = await workbookBuffer([
      goodRow({ 7: '11111111111111111' }),
      goodRow({ 7: '11111111111111111' }),
    ]);

    const report = await service.import(
      { buffer, size: buffer.length },
      false,
      actor,
    );
    const second = report.rows[1];
    expect(second.status).toBe('ERROR');
    expect(second.errors[0]).toContain('appears twice');
    expect(second.warnings[0]).toContain('Duplicate name + date of birth');
  });

  it('commit inserts valid rows through the normal create path', async () => {
    const buffer = await workbookBuffer([goodRow(), goodRow({ 3: 'BAD' })]);

    const report = await service.import(
      { buffer, size: buffer.length },
      true,
      actor,
    );
    expect(studentsService.create).toHaveBeenCalledTimes(1);
    expect(studentsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: 'Rahim',
        nameBn: 'রহিম উদ্দিন',
        admissionClassId: 'class-6',
        guardians: [
          expect.objectContaining({
            phone: '01712345678',
            isPrimary: true,
          }),
        ],
      }),
      actor,
    );
    expect(report.imported).toBe(1);
    expect(report.invalid).toBe(1);
    expect(report.rows[0].studentUid).toBe('HXS-202600001');
  });

  it('a row failing on insert is reported, not thrown', async () => {
    studentsService.create.mockRejectedValue(
      new Error('Birth certificate taken'),
    );
    const buffer = await workbookBuffer([goodRow()]);

    const report = await service.import(
      { buffer, size: buffer.length },
      true,
      actor,
    );
    expect(report.rows[0].status).toBe('ERROR');
    expect(report.rows[0].errors[0]).toContain('Birth certificate taken');
  });

  it('rejects an unreadable file', async () => {
    await expect(
      service.import(
        { buffer: Buffer.from('not-xlsx'), size: 8 },
        false,
        actor,
      ),
    ).rejects.toThrow('not a readable XLSX workbook');
  });
});
