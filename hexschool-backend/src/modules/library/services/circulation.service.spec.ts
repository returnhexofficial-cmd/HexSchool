import { ConflictException, ForbiddenException } from '@nestjs/common';
import { CirculationService } from './circulation.service';

/**
 * The circulation desk's rules, over mocked repositories.
 *
 * The engines are golden-tested separately; what this suite is for is
 * the *wiring* — that the verdict is consulted before anything is
 * written, that an override is refused without the permission code, that
 * the copy's status moves with the loan, and that a return's fine lands
 * on the row with the flag the CHECK will accept.
 */
describe('CirculationService', () => {
  const SCHOOL = 'school-1';
  const actor = { sub: 'user-1', schoolId: SCHOOL } as never;

  let issues: Record<string, jest.Mock>;
  let reservations: Record<string, jest.Mock>;
  let copies: Record<string, jest.Mock>;
  let members: Record<string, jest.Mock>;
  let membersService: Record<string, jest.Mock>;
  let calendar: Record<string, jest.Mock>;
  let permissions: Record<string, jest.Mock>;
  let config: Record<string, jest.Mock>;
  let service: CirculationService;

  const CONFIG = {
    enabled: true,
    accessionPattern: 'ACC-{YY}-{SEQ5}',
    cardNoPattern: 'LIB-{YY}-{SEQ5}',
    loanDays: { STUDENT: 7, TEACHER: 14, STAFF: 14 },
    maxBooks: { STUDENT: 2, TEACHER: 5, STAFF: 3 },
    maxRenews: 2,
    fine: {
      perDay: 2,
      graceDays: 0,
      maxPerBook: 500,
      holidayAware: false,
      lostMultiplier: 1.5,
      damagedMultiplier: 0.5,
      defaultBookPrice: 300,
    },
    issue: {
      enabled: true,
      fineBlockThreshold: 100,
      blockWhenOverdue: true,
      blockDuplicateTitle: true,
    },
    reservationDays: 3,
    autoProvisionMembers: true,
    overdueNoticeEnabled: true,
    overdueNoticeChannel: 'IN_APP',
    overdueNoticeWeekday: 6,
    overdueRepeatDays: 7,
    opacEnabled: true,
    opacAllowReservation: true,
    autoPostAccounting: true,
    clearanceBlockExit: false,
  };

  const COPY = {
    id: 'copy-1',
    accessionNo: 'ACC-26-00001',
    status: 'AVAILABLE',
    book: { id: 'book-1', title: 'Physics', price: 400 },
  };

  const MEMBER = {
    id: 'member-1',
    cardNo: 'LIB-26-00001',
    personType: 'STUDENT',
    personId: 'student-1',
    status: 'ACTIVE',
    maxBooks: 2,
  };

  const CLEAN_STANDING = {
    openLoans: 0,
    overdueLoans: 0,
    outstandingFine: 0,
    heldBookIds: new Set<string>(),
  };

  beforeEach(() => {
    issues = {
      // `withTransaction` runs the callback with a fake tx client — the
      // repositories are mocked, so the client is only a token.
      withTransaction: jest.fn((fn: (tx: unknown) => unknown) => fn('tx')),
      create: jest.fn().mockResolvedValue({
        id: 'issue-1',
        memberId: MEMBER.id,
        dueAt: new Date('2026-03-08T10:00:00Z'),
      }),
      update: jest.fn(),
      findDetail: jest.fn(),
      findOpenForCopy: jest.fn().mockResolvedValue(null),
      findMany: jest.fn(),
    };
    reservations = {
      findHeldCopy: jest.fn().mockResolvedValue(null),
      queueFor: jest.fn().mockResolvedValue([]),
      countLiveForBookExcluding: jest.fn().mockResolvedValue(0),
      update: jest.fn(),
    };
    copies = {
      findDetail: jest.fn().mockResolvedValue(COPY),
      findByAccession: jest.fn().mockResolvedValue(COPY),
      setStatus: jest.fn(),
      update: jest.fn(),
    };
    members = {
      findByIdOrFail: jest.fn().mockResolvedValue(MEMBER),
      findByCard: jest.fn().mockResolvedValue(MEMBER),
      findByPerson: jest.fn().mockResolvedValue(MEMBER),
      standing: jest.fn().mockResolvedValue(CLEAN_STANDING),
    };
    membersService = { ensureMember: jest.fn().mockResolvedValue(MEMBER) };
    calendar = { workingDays: jest.fn().mockResolvedValue([]) };
    permissions = { getUserPermissionCodes: jest.fn().mockResolvedValue([]) };
    config = {
      load: jest.fn().mockResolvedValue(CONFIG),
      loanDaysFor: jest.fn(
        (cfg: typeof CONFIG, type: 'STUDENT' | 'TEACHER' | 'STAFF') =>
          cfg.loanDays[type],
      ),
    };

    service = new CirculationService(
      issues as never,
      reservations as never,
      copies as never,
      members as never,
      membersService as never,
      calendar as never,
      permissions as never,
      config as never,
      { set: jest.fn() } as never,
    );

    issues.findDetail.mockResolvedValue({
      id: 'issue-1',
      schoolId: SCHOOL,
      copyId: COPY.id,
      memberId: MEMBER.id,
      returnedAt: null,
      dueAt: new Date('2026-03-08T10:00:00Z'),
      issuedAt: new Date('2026-03-01T10:00:00Z'),
      renewCount: 0,
      fineAmount: 0,
      fineCollected: 0,
      fineWaived: 0,
      remarks: null,
      copy: COPY,
      member: MEMBER,
    });
  });

  describe('issue', () => {
    it('writes the loan and marks the copy ISSUED in one transaction', async () => {
      await service.issue(
        { accessionNo: 'ACC-26-00001', cardNo: 'LIB-26-00001' },
        actor,
      );

      expect(issues.create).toHaveBeenCalledWith(
        expect.objectContaining({ copyId: 'copy-1', memberId: 'member-1' }),
        'tx',
      );
      expect(copies.setStatus).toHaveBeenCalledWith(
        'copy-1',
        'ISSUED',
        'user-1',
        'tx',
      );
    });

    it('gives a student a 7-day loan and a teacher a 14-day one', async () => {
      await service.issue({ copyId: 'copy-1', memberId: 'member-1' }, actor);
      const calls = issues.create.mock.calls as Array<
        [{ dueAt: Date; issuedAt: Date }]
      >;
      const student = calls[0][0];
      expect(
        Math.round(
          (student.dueAt.getTime() - student.issuedAt.getTime()) / 86_400_000,
        ),
      ).toBe(7);

      members.findByIdOrFail.mockResolvedValue({
        ...MEMBER,
        personType: 'TEACHER',
      });
      await service.issue({ copyId: 'copy-1', memberId: 'member-1' }, actor);
      const teacher = (
        issues.create.mock.calls as Array<[{ dueAt: Date; issuedAt: Date }]>
      )[1][0];
      expect(
        Math.round(
          (teacher.dueAt.getTime() - teacher.issuedAt.getTime()) / 86_400_000,
        ),
      ).toBe(14);
    });

    it('refuses a copy that is already on loan, and writes nothing', async () => {
      copies.findDetail.mockResolvedValue({ ...COPY, status: 'ISSUED' });

      await expect(
        service.issue({ copyId: 'copy-1', memberId: 'member-1' }, actor),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(issues.create).not.toHaveBeenCalled();
      expect(copies.setStatus).not.toHaveBeenCalled();
    });

    /**
     * The two-tier split (M13/M14): a copy physically in somebody else's
     * hands is a fact, and `override` does not change facts.
     */
    it('ignores an override on a structural refusal', async () => {
      copies.findDetail.mockResolvedValue({ ...COPY, status: 'ISSUED' });
      permissions.getUserPermissionCodes.mockResolvedValue([
        'library.issue.override',
      ]);

      await expect(
        service.issue(
          { copyId: 'copy-1', memberId: 'member-1', override: true },
          actor,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(issues.create).not.toHaveBeenCalled();
    });

    it('refuses an over-limit member without an override', async () => {
      members.standing.mockResolvedValue({ ...CLEAN_STANDING, openLoans: 2 });

      await expect(
        service.issue({ copyId: 'copy-1', memberId: 'member-1' }, actor),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses the override itself when the caller lacks the code', async () => {
      members.standing.mockResolvedValue({ ...CLEAN_STANDING, openLoans: 2 });

      await expect(
        service.issue(
          { copyId: 'copy-1', memberId: 'member-1', override: true },
          actor,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(issues.create).not.toHaveBeenCalled();
    });

    it('lets an override-holder past a policy refusal', async () => {
      members.standing.mockResolvedValue({ ...CLEAN_STANDING, openLoans: 2 });
      permissions.getUserPermissionCodes.mockResolvedValue([
        'library.issue.override',
      ]);

      await service.issue(
        { copyId: 'copy-1', memberId: 'member-1', override: true },
        actor,
      );
      expect(issues.create).toHaveBeenCalled();
    });

    it('closes the hold as FULFILLED when the holder collects their copy', async () => {
      copies.findDetail.mockResolvedValue({ ...COPY, status: 'RESERVED' });
      reservations.findHeldCopy.mockResolvedValue({
        id: 'res-1',
        memberId: MEMBER.id,
      });

      await service.issue({ copyId: 'copy-1', memberId: 'member-1' }, actor);
      expect(reservations.update).toHaveBeenCalledWith(
        'res-1',
        expect.objectContaining({ status: 'FULFILLED', heldCopyId: null }),
        'tx',
      );
    });

    it('refuses a copy held for somebody else', async () => {
      copies.findDetail.mockResolvedValue({ ...COPY, status: 'RESERVED' });
      reservations.findHeldCopy.mockResolvedValue({
        id: 'res-1',
        memberId: 'member-2',
      });

      await expect(
        service.issue({ copyId: 'copy-1', memberId: 'member-1' }, actor),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('auto-provisions a card when the person has none', async () => {
      members.findByPerson.mockResolvedValue(null);

      await service.issue(
        { copyId: 'copy-1', personType: 'STUDENT', personId: 'student-9' },
        actor,
      );
      expect(membersService.ensureMember).toHaveBeenCalledWith(
        SCHOOL,
        'STUDENT',
        'student-9',
        'user-1',
        undefined,
        'tx',
      );
    });

    it('refuses to auto-provision when the school switched it off', async () => {
      members.findByPerson.mockResolvedValue(null);
      config.load.mockResolvedValue({
        ...CONFIG,
        autoProvisionMembers: false,
      });

      await expect(
        service.issue(
          { copyId: 'copy-1', personType: 'STUDENT', personId: 'student-9' },
          actor,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('return', () => {
    const returnedIssue = (over: Record<string, unknown> = {}) => ({
      id: 'issue-1',
      schoolId: SCHOOL,
      copyId: COPY.id,
      memberId: MEMBER.id,
      returnedAt: null,
      issuedAt: new Date('2026-03-01T10:00:00Z'),
      dueAt: new Date('2026-03-08T10:00:00Z'),
      renewCount: 0,
      fineAmount: 0,
      fineCollected: 0,
      fineWaived: 0,
      remarks: null,
      copy: COPY,
      member: MEMBER,
      ...over,
    });

    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-03-13T10:00:00Z'));
      issues.findOpenForCopy.mockResolvedValue(returnedIssue());
      issues.findDetail.mockResolvedValue(returnedIssue());
    });

    afterEach(() => jest.useRealTimers());

    it('charges five days at the daily rate and puts the copy back', async () => {
      const result = await service.return_({ copyId: 'copy-1' }, actor);

      expect(result.fine.daysLate).toBe(5);
      expect(result.fine.amount).toBe(10);
      expect(issues.update).toHaveBeenCalledWith(
        'issue-1',
        expect.objectContaining({
          fineAmount: 10,
          fineReason: 'OVERDUE',
          overdueDays: 5,
          finePaid: false,
        }),
        'tx',
      );
      expect(copies.setStatus).toHaveBeenCalledWith(
        'copy-1',
        'AVAILABLE',
        'user-1',
        'tx',
      );
    });

    /**
     * `fine_paid` is derived, and it must agree with the arithmetic
     * beside it or `chk_book_issues_fine_paid` refuses the write. A clean
     * return therefore stores `true`, not `false`.
     */
    it('marks a clean return settled', async () => {
      issues.findOpenForCopy.mockResolvedValue(
        returnedIssue({ dueAt: new Date('2026-03-20T10:00:00Z') }),
      );

      const result = await service.return_({ copyId: 'copy-1' }, actor);
      expect(result.fine.amount).toBe(0);
      expect(issues.update).toHaveBeenCalledWith(
        'issue-1',
        expect.objectContaining({ finePaid: true, fineReason: 'NONE' }),
        'tx',
      );
    });

    it('adds the damage charge on top of the overdue', async () => {
      const result = await service.return_(
        { copyId: 'copy-1', condition: 'DAMAGED' },
        actor,
      );
      // 5 days × 2 BDT, plus 400 × 0.5 for the damage.
      expect(result.fine.amount).toBe(210);
      expect(result.fine.reason).toBe('DAMAGED');
    });

    it('takes the librarian’s figure over the computed one', async () => {
      const result = await service.return_(
        {
          copyId: 'copy-1',
          fineOverride: 3,
          fineReason: 'Bus strike, waived four days',
        },
        actor,
      );
      expect(result.fine.amount).toBe(3);
    });

    it('refuses a hand-set fine with no reason', async () => {
      await expect(
        service.return_({ copyId: 'copy-1', fineOverride: 3 }, actor),
      ).rejects.toThrow(/reason/i);
    });

    it('refuses to collect at the desk without library.fine.collect', async () => {
      await expect(
        service.return_({ copyId: 'copy-1', collectFine: true }, actor),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('records the collection when the caller may take money', async () => {
      permissions.getUserPermissionCodes.mockResolvedValue([
        'library.fine.collect',
      ]);

      const result = await service.return_(
        { copyId: 'copy-1', collectFine: true },
        actor,
      );
      expect(result.fine.collected).toBe(10);
      expect(result.fine.outstanding).toBe(0);
      expect(issues.update).toHaveBeenCalledWith(
        'issue-1',
        expect.objectContaining({ fineCollected: 10, finePaid: true }),
        'tx',
      );
    });

    it('holds the copy for the next member in the queue instead of shelving it', async () => {
      reservations.queueFor.mockResolvedValue([
        { id: 'res-9', memberId: 'member-2', status: 'ACTIVE' },
      ]);

      const result = await service.return_({ copyId: 'copy-1' }, actor);

      expect(result.heldFor).toEqual({
        reservationId: 'res-9',
        memberId: 'member-2',
      });
      expect(copies.setStatus).toHaveBeenCalledWith(
        'copy-1',
        'RESERVED',
        'user-1',
        'tx',
      );
      expect(copies.setStatus).not.toHaveBeenCalledWith(
        'copy-1',
        'AVAILABLE',
        'user-1',
        'tx',
      );
    });

    it('refuses a copy that is not on loan', async () => {
      issues.findOpenForCopy.mockResolvedValue(null);
      await expect(
        service.return_({ copyId: 'copy-1' }, actor),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    /**
     * A calendar that cannot be read must not stop a book coming back.
     * Charging the un-forgiven fine and letting somebody waive it beats
     * a return desk that refuses returns.
     */
    it('still accepts the return when the holiday lookup fails', async () => {
      config.load.mockResolvedValue({
        ...CONFIG,
        fine: { ...CONFIG.fine, holidayAware: true },
      });
      calendar.workingDays.mockRejectedValue(new Error('database is away'));

      const result = await service.return_({ copyId: 'copy-1' }, actor);
      expect(result.fine.amount).toBe(10);
      expect(result.fine.holidayDays).toBe(0);
    });
  });

  describe('renew', () => {
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-03-05T10:00:00Z'));
    });
    afterEach(() => jest.useRealTimers());

    it('moves the due date forward from today and counts the renewal', async () => {
      await service.renew('issue-1', {}, actor);
      expect(issues.update).toHaveBeenCalledWith(
        'issue-1',
        expect.objectContaining({
          renewCount: 1,
          dueAt: new Date('2026-03-12T10:00:00Z'),
        }),
      );
    });

    it('refuses while another member is waiting for the title', async () => {
      reservations.countLiveForBookExcluding.mockResolvedValue(1);
      await expect(service.renew('issue-1', {}, actor)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('refuses an overdue loan — renewing it would erase the fine', async () => {
      issues.findDetail.mockResolvedValue({
        id: 'issue-1',
        schoolId: SCHOOL,
        copyId: COPY.id,
        memberId: MEMBER.id,
        returnedAt: null,
        dueAt: new Date('2026-03-01T10:00:00Z'),
        renewCount: 0,
        copy: COPY,
        member: MEMBER,
      });
      await expect(service.renew('issue-1', {}, actor)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('refuses a loan that has already come back', async () => {
      issues.findDetail.mockResolvedValue({
        id: 'issue-1',
        schoolId: SCHOOL,
        returnedAt: new Date('2026-03-04T10:00:00Z'),
        dueAt: new Date('2026-03-08T10:00:00Z'),
        renewCount: 0,
        copy: COPY,
        member: MEMBER,
      });
      await expect(service.renew('issue-1', {}, actor)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });
});
