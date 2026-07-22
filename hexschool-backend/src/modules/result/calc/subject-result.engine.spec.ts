import { NCTB } from './grading-snapshot.spec';
import {
  evaluateSubject,
  evaluateSubjects,
  MarkEntry,
  PaperSpec,
} from './subject-result.engine';

const flat = (over: Partial<PaperSpec> = {}): PaperSpec => ({
  examSubjectId: 'es-1',
  subjectId: 'sub-1',
  subjectName: 'Bangla',
  classId: 'cls-1',
  fullMarks: 100,
  passMarks: 33,
  componentMarks: {},
  componentPassMarks: {},
  isOptional: false,
  ...over,
});

/** The BD layout M14 seeds for a practical subject: CQ 75 + practical 25. */
const split = (over: Partial<PaperSpec> = {}): PaperSpec =>
  flat({
    examSubjectId: 'es-2',
    subjectId: 'sub-2',
    subjectName: 'Physics',
    componentMarks: { cq: 75, practical: 25 },
    componentPassMarks: { practical: 10 },
    ...over,
  });

const mark = (over: Partial<MarkEntry> = {}): MarkEntry => ({
  total: 0,
  isAbsent: false,
  ...over,
});

const noGrace = { graceMarks: 0, graceMaxSubjects: 0 };

describe('subject-result engine', () => {
  describe('flat papers', () => {
    it('grades a pass through the frozen scale', () => {
      const outcome = evaluateSubject(flat(), mark({ total: 82 }), NCTB);

      expect(outcome.obtained).toBe(82);
      expect(outcome.percentage).toBe(82);
      expect(outcome.grade).toBe('A+');
      expect(outcome.gradePoint).toBe(5);
      expect(outcome.passed).toBe(true);
    });

    it('fails below the pass mark', () => {
      const outcome = evaluateSubject(flat(), mark({ total: 32 }), NCTB);

      expect(outcome.passed).toBe(false);
      expect(outcome.grade).toBe('F');
      expect(outcome.gradePoint).toBe(0);
    });

    it('passes exactly at the pass mark', () => {
      expect(evaluateSubject(flat(), mark({ total: 33 }), NCTB).passed).toBe(
        true,
      );
    });

    it('scales the percentage by the paper, not by 100', () => {
      // A 50-mark class test: 30/50 is 60 %, an A-, not a D.
      const outcome = evaluateSubject(
        flat({ fullMarks: 50, passMarks: 17 }),
        mark({ total: 30 }),
        NCTB,
      );
      expect(outcome.percentage).toBe(60);
      expect(outcome.grade).toBe('A-');
    });
  });

  describe('component thresholds', () => {
    it('passes when every threshold is cleared', () => {
      const outcome = evaluateSubject(
        split(),
        mark({ cq: 60, practical: 20, total: 80 }),
        NCTB,
      );

      expect(outcome.passed).toBe(true);
      expect(outcome.grade).toBe('A+');
      expect(outcome.failedComponents).toEqual([]);
    });

    it('fails a strong total when the practical bar is missed', () => {
      // 88/100 overall but 8/25 practical against a bar of 10 — the band
      // table only sees the total, so the engine has to override it.
      const outcome = evaluateSubject(
        split(),
        mark({ cq: 80, practical: 8, total: 88 }),
        NCTB,
      );

      expect(outcome.passed).toBe(false);
      expect(outcome.grade).toBe('F');
      expect(outcome.gradePoint).toBe(0);
      expect(outcome.failedComponents).toEqual(['Practical 8/10']);
    });

    it('ignores components that carry no threshold', () => {
      const outcome = evaluateSubject(
        split({ componentPassMarks: {} }),
        mark({ cq: 80, practical: 0, total: 80 }),
        NCTB,
      );
      expect(outcome.passed).toBe(true);
      expect(outcome.failedComponents).toEqual([]);
    });

    it('treats a blank component as zero against its threshold', () => {
      const outcome = evaluateSubject(
        split(),
        mark({ cq: 75, total: 75 }),
        NCTB,
      );
      expect(outcome.failedComponents).toEqual(['Practical 0/10']);
    });
  });

  describe('absence and missing marks', () => {
    it('scores an absent candidate zero and fails them', () => {
      const outcome = evaluateSubject(
        flat(),
        mark({ isAbsent: true, total: 0 }),
        NCTB,
      );

      expect(outcome.absent).toBe(true);
      expect(outcome.obtained).toBe(0);
      expect(outcome.grade).toBe('F');
      expect(outcome.passed).toBe(false);
    });

    it('distinguishes a missing mark row from an absence', () => {
      const outcome = evaluateSubject(flat(), undefined, NCTB);

      expect(outcome.missing).toBe(true);
      expect(outcome.absent).toBe(false);
      expect(outcome.passed).toBe(false);
    });
  });

  describe('grace marks', () => {
    const papers = [
      flat({ examSubjectId: 'es-a', subjectName: 'Bangla' }),
      flat({ examSubjectId: 'es-b', subjectName: 'English' }),
    ];

    it('lifts a near-miss to exactly the pass mark', () => {
      const outcomes = evaluateSubjects(
        [papers[0]],
        new Map([['es-a', mark({ total: 31 })]]),
        NCTB,
        { graceMarks: 2, graceMaxSubjects: 1 },
      );

      expect(outcomes[0].graceApplied).toBe(2);
      expect(outcomes[0].rawMarks).toBe(31);
      expect(outcomes[0].obtained).toBe(33);
      expect(outcomes[0].passed).toBe(true);
      expect(outcomes[0].grade).toBe('D');
    });

    it('never reaches further than the allowance', () => {
      const outcomes = evaluateSubjects(
        [papers[0]],
        new Map([['es-a', mark({ total: 28 })]]),
        NCTB,
        { graceMarks: 2, graceMaxSubjects: 1 },
      );

      expect(outcomes[0].graceApplied).toBe(0);
      expect(outcomes[0].passed).toBe(false);
    });

    it('spends a one-subject budget on the cheapest deficit', () => {
      const outcomes = evaluateSubjects(
        papers,
        new Map([
          ['es-a', mark({ total: 30 })], // 3 short
          ['es-b', mark({ total: 32 })], // 1 short
        ]),
        NCTB,
        { graceMarks: 3, graceMaxSubjects: 1 },
      );

      expect(outcomes[0].graceApplied).toBe(0);
      expect(outcomes[1].graceApplied).toBe(1);
      expect(outcomes[1].passed).toBe(true);
    });

    it('does not buy a missed component threshold', () => {
      const outcomes = evaluateSubjects(
        [split({ passMarks: 33 })],
        new Map([['es-2', mark({ cq: 24, practical: 8, total: 32 })]]),
        NCTB,
        { graceMarks: 5, graceMaxSubjects: 3 },
      );

      expect(outcomes[0].graceApplied).toBe(0);
      expect(outcomes[0].passed).toBe(false);
    });

    it('never rescues an absent candidate', () => {
      const outcomes = evaluateSubjects(
        [papers[0]],
        new Map([['es-a', mark({ isAbsent: true })]]),
        NCTB,
        { graceMarks: 50, graceMaxSubjects: 5 },
      );

      expect(outcomes[0].graceApplied).toBe(0);
      expect(outcomes[0].passed).toBe(false);
    });

    it('is inert when the school configures no grace', () => {
      const outcomes = evaluateSubjects(
        [papers[0]],
        new Map([['es-a', mark({ total: 32 })]]),
        NCTB,
        noGrace,
      );
      expect(outcomes[0].graceApplied).toBe(0);
      expect(outcomes[0].passed).toBe(false);
    });
  });
});
