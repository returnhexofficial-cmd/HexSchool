import { ExamStatus } from '../../../common/constants';
import {
  allowedTransitions,
  canTransition,
  isMarkEntryOpen,
  isShapeEditable,
  transitionRefusal,
} from './exam-status.machine';

/** Roadmap M14 §9: "Unit: … status machine". */
describe('exam status machine', () => {
  const ALL = Object.values(ExamStatus);

  it('walks the whole happy path DRAFT → ARCHIVED', () => {
    const path = [
      ExamStatus.DRAFT,
      ExamStatus.SCHEDULED,
      ExamStatus.ONGOING,
      ExamStatus.MARK_ENTRY,
      ExamStatus.PROCESSING,
      ExamStatus.PUBLISHED,
      ExamStatus.ARCHIVED,
    ];
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(canTransition(path[i], path[i + 1])).toBe(true);
    }
  });

  it('allows exactly one step back, to undo a mis-click', () => {
    expect(canTransition(ExamStatus.SCHEDULED, ExamStatus.DRAFT)).toBe(true);
    expect(canTransition(ExamStatus.ONGOING, ExamStatus.SCHEDULED)).toBe(true);
    expect(canTransition(ExamStatus.PROCESSING, ExamStatus.MARK_ENTRY)).toBe(
      true,
    );
  });

  it('refuses a two-step jump', () => {
    expect(canTransition(ExamStatus.DRAFT, ExamStatus.ONGOING)).toBe(false);
    expect(canTransition(ExamStatus.SCHEDULED, ExamStatus.MARK_ENTRY)).toBe(
      false,
    );
  });

  it('never rewinds a PUBLISHED exam — a correction is an M15 re-issue', () => {
    expect(allowedTransitions(ExamStatus.PUBLISHED)).toEqual([
      ExamStatus.ARCHIVED,
    ]);
    expect(canTransition(ExamStatus.PUBLISHED, ExamStatus.PROCESSING)).toBe(
      false,
    );
    expect(canTransition(ExamStatus.PUBLISHED, ExamStatus.MARK_ENTRY)).toBe(
      false,
    );
  });

  it('treats ARCHIVED as terminal', () => {
    expect(allowedTransitions(ExamStatus.ARCHIVED)).toEqual([]);
    expect(transitionRefusal(ExamStatus.ARCHIVED, ExamStatus.DRAFT)).toContain(
      'terminal',
    );
  });

  it('lets a cancelled exam reach ARCHIVED from every non-terminal state', () => {
    for (const status of ALL) {
      if (status === ExamStatus.ARCHIVED) continue;
      expect(canTransition(status, ExamStatus.ARCHIVED)).toBe(true);
    }
  });

  it('explains a refusal and names the legal options', () => {
    const reason = transitionRefusal(ExamStatus.DRAFT, ExamStatus.PUBLISHED);
    expect(reason).toContain('DRAFT');
    expect(reason).toContain('PUBLISHED');
    expect(reason).toContain('SCHEDULED');
  });

  it('returns null for a legal transition and a distinct message for a no-op', () => {
    expect(
      transitionRefusal(ExamStatus.DRAFT, ExamStatus.SCHEDULED),
    ).toBeNull();
    expect(transitionRefusal(ExamStatus.DRAFT, ExamStatus.DRAFT)).toContain(
      'already DRAFT',
    );
  });

  describe('derived gates other modules read', () => {
    it('freezes the exam shape once mark entry opens', () => {
      expect(isShapeEditable(ExamStatus.DRAFT)).toBe(true);
      expect(isShapeEditable(ExamStatus.SCHEDULED)).toBe(true);
      expect(isShapeEditable(ExamStatus.ONGOING)).toBe(true);
      expect(isShapeEditable(ExamStatus.MARK_ENTRY)).toBe(false);
      expect(isShapeEditable(ExamStatus.PUBLISHED)).toBe(false);
    });

    it('opens mark entry for MARK_ENTRY and PROCESSING only', () => {
      const open = ALL.filter(isMarkEntryOpen);
      expect(open).toEqual([ExamStatus.MARK_ENTRY, ExamStatus.PROCESSING]);
    });
  });
});
