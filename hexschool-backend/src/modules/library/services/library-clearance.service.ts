import { Injectable } from '@nestjs/common';
import { LibraryMemberType } from '@prisma/client';
import { PrismaService } from '../../../database/prisma/prisma.service';
import {
  CLEAR,
  type LibraryClearanceChecker,
  type LibraryClearanceResult,
} from '../library.constants';

/**
 * "Has this person given the books back?" — roadmap §6's "student
 * leaving school (status change) → library clearance check hooks into
 * Module 09".
 *
 * **This service depends on PrismaService and nothing else**, and that
 * is the whole point. It is provided twice: once inside LibraryModule
 * (for the library's own screens and, later, M27's certificate
 * clearance) and once inside StudentModule, bound to the
 * `LIBRARY_CLEARANCE` token — the M13 `RoutineConflictChecker` pattern,
 * where the checker's code lives in the module that owns the domain but
 * is *instantiated* inside the module that consults it.
 *
 * The alternative — StudentModule importing LibraryModule — would close
 * a cycle: LibraryModule → AccountingModule → FeeModule → StudentModule.
 * Two stateless instances is the cost of keeping the graph acyclic, and
 * it is the cost M15's `ResultReadinessGate` already pays.
 *
 * A person with no library card is **cleared**, not an error. Most of a
 * school never borrows anything, and an exit flow that 404s on them
 * would be a worse bug than the one this prevents.
 */
@Injectable()
export class LibraryClearanceService implements LibraryClearanceChecker {
  constructor(private readonly prisma: PrismaService) {}

  async clearanceForPerson(
    schoolId: string,
    personType: LibraryMemberType,
    personId: string,
  ): Promise<LibraryClearanceResult> {
    const member = await this.prisma.libraryMember.findFirst({
      where: { schoolId, personType, personId, deletedAt: null },
      select: { id: true, cardNo: true },
    });
    if (!member) return CLEAR;

    const rows = await this.prisma.bookIssue.findMany({
      where: {
        memberId: member.id,
        OR: [{ returnedAt: null }, { finePaid: false }],
      },
      select: {
        returnedAt: true,
        dueAt: true,
        fineAmount: true,
        fineCollected: true,
        fineWaived: true,
        finePaid: true,
        copy: {
          select: { accessionNo: true, book: { select: { title: true } } },
        },
      },
      orderBy: { dueAt: 'asc' },
    });

    const details: string[] = [];
    let booksOut = 0;
    let outstandingFine = 0;

    for (const row of rows) {
      if (row.returnedAt === null) {
        booksOut++;
        details.push(
          `"${row.copy.book.title}" (${row.copy.accessionNo}) is still on loan, due ${row.dueAt.toISOString().slice(0, 10)}`,
        );
      }
      if (!row.finePaid) {
        outstandingFine += Math.max(
          0,
          Number(row.fineAmount) -
            Number(row.fineCollected) -
            Number(row.fineWaived),
        );
      }
    }

    outstandingFine = Math.round(outstandingFine * 100) / 100;
    if (outstandingFine > 0) {
      details.push(
        `${outstandingFine.toFixed(2)} BDT of library fines is unpaid`,
      );
    }

    return {
      cleared: booksOut === 0 && outstandingFine <= 0,
      booksOut,
      outstandingFine,
      details,
    };
  }
}
