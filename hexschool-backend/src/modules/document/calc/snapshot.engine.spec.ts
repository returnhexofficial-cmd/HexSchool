import {
  buildSnapshot,
  CERTIFICATE_VARIABLES,
  completenessWarning,
  missingFields,
  type SnapshotInput,
} from './snapshot.engine';
import { CERTIFICATE_TYPES } from './types';

const input = (over: Partial<SnapshotInput> = {}): SnapshotInput => ({
  school: {
    name: 'Dhaka Model High School',
    address: 'Mirpur',
    eiin: '107321',
  },
  student: {
    name: 'Rafiqul Islam',
    nameBn: 'রফিকুল ইসলাম',
    studentUid: 'DMHS-2024-00042',
    fatherName: 'Abdul Islam',
    motherName: 'Salma Begum',
    dob: '2010-04-11',
    gender: 'MALE',
    religion: 'ISLAM',
    admissionDate: '2019-01-05',
  },
  enrollment: {
    className: 'Class 9',
    section: 'A',
    roll: 12,
    group: 'Science',
    session: '2026',
  },
  result: { examName: 'Annual 2025', gpa: 4.5, grade: 'A+', position: 2 },
  attendance: { percentage: 92.456 },
  conduct: 'Excellent',
  issue: {
    certificateNo: 'TC-26-0014',
    verifyCode: '4KJ7M2QX9B',
    verifyUrl: 'https://school.edu.bd/verify/certificate?code=4KJ7M2QX9B',
    issueDate: '2026-08-06',
  },
  ...over,
});

describe('snapshot.engine', () => {
  describe('buildSnapshot', () => {
    it('flattens every input into the variable bag a template renders against', () => {
      const snapshot = buildSnapshot(input());
      expect(snapshot).toMatchObject({
        school_name: 'Dhaka Model High School',
        school_eiin: '107321',
        student_name: 'Rafiqul Islam',
        student_name_bn: 'রফিকুল ইসলাম',
        student_uid: 'DMHS-2024-00042',
        father_name: 'Abdul Islam',
        class: 'Class 9',
        section: 'A',
        roll: '12',
        session: '2026',
        exam_name: 'Annual 2025',
        grade: 'A+',
        position: '2',
        conduct: 'Excellent',
        certificate_no: 'TC-26-0014',
        verify_code: '4KJ7M2QX9B',
        issue_date: '2026-08-06',
      });
    });

    it('produces a value for every declared palette variable', () => {
      const snapshot = buildSnapshot(input());
      for (const variable of CERTIFICATE_VARIABLES) {
        expect(snapshot).toHaveProperty(variable);
      }
    });

    it('formats the GPA once, at issue, so a re-print never disagrees', () => {
      expect(buildSnapshot(input({ result: { gpa: 4 } })).gpa).toBe('4.00');
      expect(buildSnapshot(input({ result: { gpa: 3.5 } })).gpa).toBe('3.50');
      expect(buildSnapshot(input({ result: { gpa: 4.999 } })).gpa).toBe('5.00');
    });

    it('leaves a missing GPA blank rather than printing 0.00', () => {
      // A zero GPA is a fail; a blank one is "this exam was not processed".
      // Printing the first for the second would fail a student on paper.
      expect(buildSnapshot(input({ result: null })).gpa).toBe('');
      expect(buildSnapshot(input({ result: { gpa: null } })).gpa).toBe('');
    });

    it('formats attendance with its percent sign, and blanks a missing one', () => {
      expect(buildSnapshot(input()).attendance_percentage).toBe('92.46%');
      expect(
        buildSnapshot(input({ attendance: null })).attendance_percentage,
      ).toBe('');
    });

    it('trims and blanks nulls rather than printing "null"', () => {
      const snapshot = buildSnapshot(
        input({
          student: {
            name: '  Rafiqul Islam  ',
            studentUid: 'X-1',
            fatherName: null,
          },
        }),
      );
      expect(snapshot.student_name).toBe('Rafiqul Islam');
      expect(snapshot.father_name).toBe('');
    });

    it('blanks the whole enrollment block when there is no enrollment', () => {
      const snapshot = buildSnapshot(input({ enrollment: null }));
      expect(snapshot.class).toBe('');
      expect(snapshot.section).toBe('');
      expect(snapshot.session).toBe('');
    });

    it('carries the original number on a duplicate re-issue', () => {
      const snapshot = buildSnapshot(
        input({
          issue: {
            certificateNo: 'TC-26-0031',
            verifyCode: 'ABCDEF1234',
            verifyUrl: 'https://x/verify',
            issueDate: '2026-09-01',
            originalNo: 'TC-26-0014',
          },
        }),
      );
      expect(snapshot.original_no).toBe('TC-26-0014');
    });

    it('adds free-text extras but never lets one shadow a resolved fact', () => {
      const snapshot = buildSnapshot(
        input({ extra: { prize_name: 'Best in Physics', gpa: '5.00' } }),
      );
      expect(snapshot.prize_name).toBe('Best in Physics');
      // The one number a testimonial exists to state is not hand-editable.
      expect(snapshot.gpa).toBe('4.50');
    });
  });

  describe('missingFields', () => {
    it('reports nothing for a complete record', () => {
      const snapshot = buildSnapshot(input());
      for (const type of CERTIFICATE_TYPES) {
        expect(missingFields(snapshot, type)).toEqual([]);
      }
    });

    it('names a TRANSFER’s missing identification fields', () => {
      const snapshot = buildSnapshot(
        input({
          student: {
            name: 'Rafiqul Islam',
            studentUid: 'DMHS-1',
            fatherName: null,
            dob: null,
            admissionDate: null,
          },
        }),
      );
      expect(missingFields(snapshot, 'TRANSFER')).toEqual([
        'father_name',
        'date_of_birth',
        'admission_date',
      ]);
    });

    it('requires a GPA on a TESTIMONIAL but not on a CHARACTER certificate', () => {
      const snapshot = buildSnapshot(input({ result: null }));
      expect(missingFields(snapshot, 'TESTIMONIAL')).toEqual(['gpa']);
      expect(missingFields(snapshot, 'CHARACTER')).toEqual([]);
    });

    it('asks a CUSTOM certificate for a name and nothing else', () => {
      const snapshot = buildSnapshot(
        input({ enrollment: null, result: null, conduct: '' }),
      );
      expect(missingFields(snapshot, 'CUSTOM')).toEqual([]);
    });

    it('treats whitespace as blank', () => {
      const snapshot = buildSnapshot(input({ conduct: '   ' }));
      expect(missingFields(snapshot, 'CHARACTER')).toEqual(['conduct']);
    });
  });

  describe('completenessWarning', () => {
    it('is null when nothing is missing', () => {
      expect(
        completenessWarning(buildSnapshot(input()), 'TRANSFER'),
      ).toBeNull();
    });

    it('reads as a warning, not a refusal, and says why it matters', () => {
      const snapshot = buildSnapshot(input({ result: null }));
      const warning = completenessWarning(snapshot, 'TESTIMONIAL');
      expect(warning).toContain('gpa');
      expect(warning).toContain('frozen at issue');
    });

    it('uses singular and plural correctly', () => {
      const one = buildSnapshot(input({ result: null }));
      expect(completenessWarning(one, 'TESTIMONIAL')).toContain('is blank');

      const many = buildSnapshot(
        input({
          student: { name: 'X', studentUid: 'U-1' },
        }),
      );
      expect(completenessWarning(many, 'TRANSFER')).toContain('are blank');
    });
  });
});
