import { LibraryClearanceService } from './library-clearance.service';

/**
 * The M09/M27 hook.
 *
 * The case that matters most is the boring one: a person who never
 * borrowed anything is **cleared**, without an error and without a
 * second query. Most of a school is in that state, and an exit flow that
 * threw on them would be a worse bug than the one this check prevents.
 */
describe('LibraryClearanceService', () => {
  const SCHOOL = 'school-1';
  let prisma: {
    libraryMember: { findFirst: jest.Mock };
    bookIssue: { findMany: jest.Mock };
  };
  let service: LibraryClearanceService;

  beforeEach(() => {
    prisma = {
      libraryMember: { findFirst: jest.fn() },
      bookIssue: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new LibraryClearanceService(prisma as never);
  });

  const loan = (over: Record<string, unknown> = {}) => ({
    returnedAt: new Date('2026-03-01T10:00:00Z'),
    dueAt: new Date('2026-02-25T10:00:00Z'),
    fineAmount: 0,
    fineCollected: 0,
    fineWaived: 0,
    finePaid: true,
    copy: { accessionNo: 'ACC-26-00001', book: { title: 'Physics' } },
    ...over,
  });

  it('clears a person with no library card without touching the loans table', async () => {
    prisma.libraryMember.findFirst.mockResolvedValue(null);

    const result = await service.clearanceForPerson(SCHOOL, 'STUDENT', 's-1');

    expect(result).toEqual({
      cleared: true,
      booksOut: 0,
      outstandingFine: 0,
      details: [],
    });
    expect(prisma.bookIssue.findMany).not.toHaveBeenCalled();
  });

  it('clears a card with everything returned and paid', async () => {
    prisma.libraryMember.findFirst.mockResolvedValue({
      id: 'member-1',
      cardNo: 'LIB-26-00001',
    });

    const result = await service.clearanceForPerson(SCHOOL, 'STUDENT', 's-1');
    expect(result.cleared).toBe(true);
  });

  it('reports a book still out, naming it', async () => {
    prisma.libraryMember.findFirst.mockResolvedValue({ id: 'member-1' });
    prisma.bookIssue.findMany.mockResolvedValue([loan({ returnedAt: null })]);

    const result = await service.clearanceForPerson(SCHOOL, 'STUDENT', 's-1');

    expect(result.cleared).toBe(false);
    expect(result.booksOut).toBe(1);
    expect(result.details[0]).toContain('Physics');
    expect(result.details[0]).toContain('ACC-26-00001');
  });

  it('reports an unpaid fine on a book that WAS returned', async () => {
    prisma.libraryMember.findFirst.mockResolvedValue({ id: 'member-1' });
    prisma.bookIssue.findMany.mockResolvedValue([
      loan({ fineAmount: 40, finePaid: false }),
    ]);

    const result = await service.clearanceForPerson(SCHOOL, 'STUDENT', 's-1');

    expect(result.cleared).toBe(false);
    expect(result.booksOut).toBe(0);
    expect(result.outstandingFine).toBe(40);
    expect(result.details.at(-1)).toContain('40.00 BDT');
  });

  it('nets collections and waivers off the outstanding total', async () => {
    prisma.libraryMember.findFirst.mockResolvedValue({ id: 'member-1' });
    prisma.bookIssue.findMany.mockResolvedValue([
      loan({
        fineAmount: 100,
        fineCollected: 30,
        fineWaived: 20,
        finePaid: false,
      }),
    ]);

    const result = await service.clearanceForPerson(SCHOOL, 'STUDENT', 's-1');
    expect(result.outstandingFine).toBe(50);
  });

  it('sums across several loans', async () => {
    prisma.libraryMember.findFirst.mockResolvedValue({ id: 'member-1' });
    prisma.bookIssue.findMany.mockResolvedValue([
      loan({ returnedAt: null }),
      loan({ returnedAt: null }),
      loan({ fineAmount: 25, finePaid: false }),
    ]);

    const result = await service.clearanceForPerson(SCHOOL, 'STUDENT', 's-1');
    expect(result.booksOut).toBe(2);
    expect(result.outstandingFine).toBe(25);
    expect(result.details).toHaveLength(3);
  });

  it('answers for teachers and staff the same way', async () => {
    prisma.libraryMember.findFirst.mockResolvedValue({ id: 'member-1' });
    prisma.bookIssue.findMany.mockResolvedValue([loan({ returnedAt: null })]);

    for (const type of ['TEACHER', 'STAFF'] as const) {
      const result = await service.clearanceForPerson(SCHOOL, type, 'p-1');
      expect(result.cleared).toBe(false);
    }
    const lookups = prisma.libraryMember.findFirst.mock.calls as Array<
      [{ where: { personType: string } }]
    >;
    expect(lookups.map(([arg]) => arg.where.personType)).toContain('STAFF');
  });
});
