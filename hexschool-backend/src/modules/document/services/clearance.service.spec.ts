import { ClearanceService } from './clearance.service';

/**
 * The aggregate three modules have been pointing at since M16.
 *
 * The cases that matter are the failure ones. A student who owes nothing
 * is easy; a **library that is down** is the case where the obvious
 * implementation silently reports CLEARED, and a transfer certificate goes
 * out over an unreturned textbook with nobody told.
 */
describe('ClearanceService', () => {
  const SCHOOL = 'school-1';
  const STUDENT = 'student-1';

  let ledger: { outstandingFor: jest.Mock };
  let enrollments: { findAll: jest.Mock };
  let library: { clearanceForPerson: jest.Mock };
  let hostel: { clearanceForStudent: jest.Mock };
  let config: { load: jest.Mock };
  let service: ClearanceService;

  const configure = (overrides: Record<string, unknown> = {}) => ({
    clearanceRequiredTypes: ['TRANSFER'],
    clearanceIncludeLibrary: true,
    clearanceIncludeHostel: true,
    ...overrides,
  });

  beforeEach(() => {
    ledger = { outstandingFor: jest.fn().mockResolvedValue(new Map()) };
    enrollments = {
      findAll: jest.fn().mockResolvedValue([{ id: 'enr-1' }, { id: 'enr-2' }]),
    };
    library = {
      clearanceForPerson: jest.fn().mockResolvedValue({
        cleared: true,
        booksOut: 0,
        outstandingFine: 0,
        details: [],
      }),
    };
    hostel = {
      clearanceForStudent: jest.fn().mockResolvedValue({
        cleared: true,
        bedsHeld: 0,
        depositHeld: 0,
        details: [],
      }),
    };
    config = { load: jest.fn().mockResolvedValue(configure()) };

    service = new ClearanceService(
      ledger as never,
      enrollments as never,
      library as never,
      hostel as never,
      config as never,
    );
  });

  const check = (type = 'TRANSFER', override = false) =>
    service.check({
      schoolId: SCHOOL,
      studentId: STUDENT,
      type: type as never,
      override,
    });

  it('clears a student who owes nothing anywhere', async () => {
    const verdict = await check();
    expect(verdict).toMatchObject({
      cleared: true,
      allowed: true,
      complete: true,
      totalOutstanding: 0,
    });
  });

  /**
   * Every enrollment the student ever had, not only the live one: a family
   * that left last year's tuition unpaid and re-enrolled still owes it,
   * and a check scoped to the current session would clear them.
   */
  it('sums dues across every enrollment the student ever had', async () => {
    ledger.outstandingFor.mockResolvedValue(
      new Map([
        ['enr-1', 1200],
        ['enr-2', 300.5],
      ]),
    );

    const verdict = await check();

    expect(ledger.outstandingFor).toHaveBeenCalledWith(
      ['enr-1', 'enr-2'],
      SCHOOL,
    );
    expect(verdict.totalOutstanding).toBe(1500.5);
    expect(verdict.allowed).toBe(false);
  });

  it('reads dues through LedgerService, the single dues source', async () => {
    await check();
    expect(ledger.outstandingFor).toHaveBeenCalledTimes(1);
  });

  it('skips the ledger entirely for a student with no enrollment', async () => {
    enrollments.findAll.mockResolvedValue([]);
    const verdict = await check();
    expect(ledger.outstandingFor).not.toHaveBeenCalled();
    expect(verdict.cleared).toBe(true);
  });

  it('folds the library into the same verdict', async () => {
    library.clearanceForPerson.mockResolvedValue({
      cleared: false,
      booksOut: 2,
      outstandingFine: 40,
      details: ['"Physics I" is still on loan'],
    });

    const verdict = await check();

    expect(verdict.allowed).toBe(false);
    expect(verdict.blockers).toContainEqual({
      source: 'LIBRARY',
      amount: 40,
      items: 2,
      details: ['"Physics I" is still on loan'],
    });
  });

  /**
   * The deposit is money the SCHOOL owes. It is reported as a detail line,
   * never as an amount the family has to settle — a school does not refuse
   * a certificate over a refund it has not got round to paying.
   */
  it('reports a held bed as an item and the deposit only as a detail', async () => {
    hostel.clearanceForStudent.mockResolvedValue({
      cleared: false,
      bedsHeld: 1,
      depositHeld: 3000,
      details: ['Bed B-2 is still occupied', 'The school holds 3000.00 BDT'],
    });

    const verdict = await check();

    expect(verdict.blockers).toContainEqual({
      source: 'HOSTEL',
      amount: 0,
      items: 1,
      details: ['Bed B-2 is still occupied', 'The school holds 3000.00 BDT'],
    });
    expect(verdict.totalOutstanding).toBe(0);
  });

  describe('sources the school switched off', () => {
    it('does not ask the library when it is excluded', async () => {
      config.load.mockResolvedValue(
        configure({ clearanceIncludeLibrary: false }),
      );
      await check();
      expect(library.clearanceForPerson).not.toHaveBeenCalled();
    });

    it('does not ask the hostel when it is excluded', async () => {
      config.load.mockResolvedValue(
        configure({ clearanceIncludeHostel: false }),
      );
      await check();
      expect(hostel.clearanceForStudent).not.toHaveBeenCalled();
    });
  });

  describe('a source that fails', () => {
    /**
     * **The defect this exists to prevent.** A failed read returns no
     * amount and no items, which is indistinguishable from "nothing owed"
     * — so a library that is down would otherwise read as a student who
     * has returned every book, and the verdict would say CLEARED.
     */
    it('never reports the student as cleared when the library errors', async () => {
      library.clearanceForPerson.mockRejectedValue(new Error('down'));

      const verdict = await check();

      expect(verdict.cleared).toBe(false);
      expect(verdict.complete).toBe(false);
    });

    it('warns loudly rather than refusing — the office must keep working', async () => {
      library.clearanceForPerson.mockRejectedValue(new Error('down'));

      const verdict = await check();

      expect(verdict.allowed).toBe(true);
      expect(verdict.reason).toBeNull();
      expect(verdict.warnings.join(' ')).toContain('could not be checked');
    });

    it('does the same for the hostel and for the fee ledger', async () => {
      hostel.clearanceForStudent.mockRejectedValue(new Error('down'));
      expect((await check()).complete).toBe(false);

      hostel.clearanceForStudent.mockResolvedValue({
        cleared: true,
        bedsHeld: 0,
        depositHeld: 0,
        details: [],
      });
      ledger.outstandingFor.mockRejectedValue(new Error('down'));
      expect((await check()).complete).toBe(false);
    });

    it('still refuses on the sources that DID read', async () => {
      ledger.outstandingFor.mockResolvedValue(new Map([['enr-1', 500]]));
      library.clearanceForPerson.mockRejectedValue(new Error('down'));

      const verdict = await check();

      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toContain('500.00 BDT owed to fees');
    });
  });

  describe('which types are gated', () => {
    it('refuses an unclear TRANSFER', async () => {
      ledger.outstandingFor.mockResolvedValue(new Map([['enr-1', 100]]));
      expect((await check('TRANSFER')).allowed).toBe(false);
    });

    it('lets an unclear CHARACTER certificate through, still reporting it', async () => {
      ledger.outstandingFor.mockResolvedValue(new Map([['enr-1', 100]]));
      const verdict = await check('CHARACTER');
      expect(verdict.allowed).toBe(true);
      expect(verdict.cleared).toBe(false);
      expect(verdict.blockers).toHaveLength(1);
    });
  });

  it('passes the override through to the engine', async () => {
    ledger.outstandingFor.mockResolvedValue(new Map([['enr-1', 100]]));

    expect((await check('TRANSFER', false)).allowed).toBe(false);
    expect((await check('TRANSFER', true)).allowed).toBe(true);
    expect((await check('TRANSFER', true)).cleared).toBe(false);
  });
});
