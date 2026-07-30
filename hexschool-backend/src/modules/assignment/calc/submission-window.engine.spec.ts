import {
  isLate,
  isWithinReminderWindow,
  submissionVerdict,
  timeToDue,
  type SubmissionWindowInput,
} from './submission-window.engine';

const DUE = Date.UTC(2026, 6, 30, 18, 0, 0); // 30 Jul 2026 18:00Z
const HOUR = 3_600_000;

const base = (
  over: Partial<SubmissionWindowInput> = {},
): SubmissionWindowInput => ({
  status: 'PUBLISHED',
  dueAt: DUE,
  now: DUE - HOUR,
  allowLate: false,
  allowResubmission: true,
  resubmissionUntilDue: true,
  existing: null,
  ...over,
});

describe('isLate', () => {
  it('is false before the deadline', () => {
    expect(isLate(DUE, DUE - 1)).toBe(false);
  });

  it('treats the deadline instant itself as on time', () => {
    // A deadline of 18:00 means "by 18:00"; the boundary belongs to the
    // student, not to the school.
    expect(isLate(DUE, DUE)).toBe(false);
  });

  it('is true one millisecond after', () => {
    expect(isLate(DUE, DUE + 1)).toBe(true);
  });
});

describe('timeToDue', () => {
  it('counts down and then goes negative', () => {
    expect(timeToDue(DUE, DUE - 2 * HOUR)).toBe(2 * HOUR);
    expect(timeToDue(DUE, DUE + HOUR)).toBe(-HOUR);
  });
});

describe('isWithinReminderWindow', () => {
  it('fires inside the window', () => {
    expect(isWithinReminderWindow(DUE, DUE - 23 * HOUR, 24)).toBe(true);
  });

  it('does not fire before the window opens', () => {
    expect(isWithinReminderWindow(DUE, DUE - 25 * HOUR, 24)).toBe(false);
  });

  it('includes the exact window edge', () => {
    expect(isWithinReminderWindow(DUE, DUE - 24 * HOUR, 24)).toBe(true);
  });

  it('never fires once the deadline has passed — a reminder after the fact is a reproach', () => {
    expect(isWithinReminderWindow(DUE, DUE, 24)).toBe(false);
    expect(isWithinReminderWindow(DUE, DUE + 1, 24)).toBe(false);
  });
});

describe('submissionVerdict — lifecycle', () => {
  it('allows a first, on-time submission', () => {
    expect(submissionVerdict(base())).toEqual({
      allowed: true,
      nextStatus: 'SUBMITTED',
      late: false,
      attempt: 1,
    });
  });

  it('refuses a DRAFT assignment — a student cannot see it at all', () => {
    const v = submissionVerdict(base({ status: 'DRAFT' }));
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe('NOT_PUBLISHED');
  });

  it('refuses a CLOSED assignment even before the deadline', () => {
    const v = submissionVerdict(
      base({ status: 'CLOSED', now: DUE - 5 * HOUR, allowLate: true }),
    );
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe('CLOSED');
  });
});

describe('submissionVerdict — lateness', () => {
  it('refuses a late submission when late is not allowed', () => {
    const v = submissionVerdict(base({ now: DUE + HOUR }));
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe('PAST_DUE');
    expect(v.late).toBe(true);
  });

  it('accepts a late submission when allow_late is on, and flags it', () => {
    const v = submissionVerdict(base({ now: DUE + HOUR, allowLate: true }));
    expect(v.allowed).toBe(true);
    expect(v.late).toBe(true);
  });

  it('reports lateness on a refusal too, so the UI can explain itself', () => {
    expect(
      submissionVerdict(base({ status: 'CLOSED', now: DUE + HOUR })).late,
    ).toBe(true);
  });
});

describe('submissionVerdict — resubmission', () => {
  it('allows a resubmission before the deadline and bumps the attempt', () => {
    const v = submissionVerdict(base({ existing: { status: 'SUBMITTED' } }));
    expect(v).toEqual({
      allowed: true,
      nextStatus: 'RESUBMITTED',
      late: false,
      attempt: 2,
    });
  });

  it('refuses a resubmission when the school switched it off', () => {
    const v = submissionVerdict(
      base({ existing: { status: 'SUBMITTED' }, allowResubmission: false }),
    );
    expect(v.reason).toBe('RESUBMISSION_DISABLED');
  });

  it('refuses a resubmission past the deadline under resubmission_until_due', () => {
    const v = submissionVerdict(
      base({
        existing: { status: 'SUBMITTED' },
        now: DUE + HOUR,
        allowLate: true,
      }),
    );
    expect(v.reason).toBe('RESUBMISSION_PAST_DUE');
  });

  it('allows a late resubmission when the school does not require it before due', () => {
    const v = submissionVerdict(
      base({
        existing: { status: 'SUBMITTED' },
        now: DUE + HOUR,
        allowLate: true,
        resubmissionUntilDue: false,
      }),
    );
    expect(v.allowed).toBe(true);
    expect(v.late).toBe(true);
  });

  it('refuses overwriting an EVALUATED submission', () => {
    const v = submissionVerdict(base({ existing: { status: 'EVALUATED' } }));
    expect(v.reason).toBe('ALREADY_EVALUATED');
  });

  it('lets a RETURNED submission back in even when resubmission is off', () => {
    // The teacher explicitly asked for the work again; refusing here
    // would make return-for-revision a dead end.
    const v = submissionVerdict(
      base({ existing: { status: 'RETURNED' }, allowResubmission: false }),
    );
    expect(v.allowed).toBe(true);
    expect(v.nextStatus).toBe('RESUBMITTED');
  });

  it('lets a RETURNED submission back in past the deadline when late is allowed', () => {
    const v = submissionVerdict(
      base({
        existing: { status: 'RETURNED' },
        allowResubmission: false,
        resubmissionUntilDue: true,
        now: DUE + 5 * HOUR,
        allowLate: true,
      }),
    );
    expect(v.allowed).toBe(true);
  });

  it('still refuses a returned resubmission when late is not allowed', () => {
    const v = submissionVerdict(
      base({ existing: { status: 'RETURNED' }, now: DUE + HOUR }),
    );
    expect(v.reason).toBe('PAST_DUE');
  });
});
