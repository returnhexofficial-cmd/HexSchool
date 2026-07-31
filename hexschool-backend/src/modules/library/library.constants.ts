/**
 * Module 23's cross-module contract, kept in a bare constants file with
 * no Nest imports beyond the token symbol — the M12 `hr.leave.approved`
 * trick that lets a *consumer* depend on the shape without importing the
 * module that owns it.
 */

/** DI token for the library half of a person's school clearance. */
export const LIBRARY_CLEARANCE = Symbol('LIBRARY_CLEARANCE');

export interface LibraryClearanceResult {
  /** True when nothing is out and nothing is owed. */
  cleared: boolean;
  /** Books still on loan. */
  booksOut: number;
  /** Unsettled fines across every loan, open or closed (BDT). */
  outstandingFine: number;
  /** One line per problem, ready to show in the office's warning list. */
  details: string[];
}

/**
 * What M09 (student exit statuses) and M27 (certificates) ask the
 * library.
 *
 * The implementation lives in `LibraryClearanceService` — but it is
 * **bound inside StudentModule over PrismaService alone**, exactly as
 * M13's `RoutineConflictChecker` is bound inside TeacherModule. The
 * alternative, StudentModule importing LibraryModule, would close a
 * cycle: LibraryModule reaches AccountingModule for the fine voucher,
 * AccountingModule imports FeeModule, and FeeModule imports
 * StudentModule.
 *
 * A `null` binding is not possible — the token is always bound, because
 * the M08/M14 lesson is that the call site is the part that is easy to
 * forget. The consumer calls it unconditionally and the library decides
 * whether it has anything to say.
 */
export interface LibraryClearanceChecker {
  clearanceForPerson(
    schoolId: string,
    personType: 'STUDENT' | 'TEACHER' | 'STAFF',
    personId: string,
  ): Promise<LibraryClearanceResult>;
}

/** Nothing owed, nothing out — the answer for a person with no card. */
export const CLEAR: LibraryClearanceResult = {
  cleared: true,
  booksOut: 0,
  outstandingFine: 0,
  details: [],
};

/** Counter keys for `SequenceService`, one per document kind. */
export const LIBRARY_SEQUENCES = {
  accession: (year: string) => `library-accession:${year}`,
  card: (year: string) => `library-card:${year}`,
} as const;
