import { Injectable } from '@nestjs/common';
import { LibraryMemberType } from '@prisma/client';
import { money } from '../../fee/calc/money.util';
import { outstandingFine } from '../calc/fine.engine';
import { BookCopiesRepository } from '../repositories/book-copies.repository';
import { BooksRepository } from '../repositories/catalog.repository';
import { BookIssuesRepository } from '../repositories/circulation.repository';
import {
  LibraryDirectoryRepository,
  type DirectoryPerson,
} from '../repositories/library-directory.repository';
import { LibraryMembersRepository } from '../repositories/library-members.repository';

export interface OverdueRow {
  issueId: string;
  accessionNo: string;
  title: string;
  cardNo: string;
  memberName: string;
  memberContext: string | null;
  personType: LibraryMemberType;
  dueAt: Date;
  daysOverdue: number;
  outstandingFine: number;
}

/**
 * Roadmap §4's report set: issued/overdue lists, popular titles,
 * category stock, member history and the stock-check diff.
 *
 * Report *shapes* live here and the XLSX/PDF rendering lives in
 * `LibraryExportService` — the M12 reports/export split, so a report can
 * be read as JSON by the admin UI and rendered to a file by the same
 * numbers rather than a second query.
 */
@Injectable()
export class LibraryReportsService {
  constructor(
    private readonly issues: BookIssuesRepository,
    private readonly books: BooksRepository,
    private readonly copies: BookCopiesRepository,
    private readonly members: LibraryMembersRepository,
    private readonly directory: LibraryDirectoryRepository,
  ) {}

  /** Every loan out past its due date, worst first. */
  async overdue(schoolId: string, now = new Date()): Promise<OverdueRow[]> {
    const rows = await this.issues.findAllFor(
      schoolId,
      { overdueOnly: true },
      now,
    );
    const people = await this.peopleFor(
      schoolId,
      rows.map((r) => r.member),
    );

    return rows.map((row) => {
      const person = people.get(
        `${row.member.personType}:${row.member.personId}`,
      );
      return {
        issueId: row.id,
        accessionNo: row.copy.accessionNo,
        title: row.copy.book.title,
        cardNo: row.member.cardNo,
        memberName: person?.name ?? '—',
        memberContext: person?.context ?? null,
        personType: row.member.personType,
        dueAt: row.dueAt,
        daysOverdue: Math.max(
          0,
          Math.floor((now.getTime() - row.dueAt.getTime()) / 86_400_000),
        ),
        outstandingFine: outstandingFine({
          fineAmount: Number(row.fineAmount),
          fineCollected: Number(row.fineCollected),
          fineWaived: Number(row.fineWaived),
        }),
      };
    });
  }

  /** Everything currently on loan, due soonest first. */
  async issued(schoolId: string, now = new Date()) {
    const rows = await this.issues.findAllFor(
      schoolId,
      { openOnly: true },
      now,
    );
    const people = await this.peopleFor(
      schoolId,
      rows.map((r) => r.member),
    );
    return rows.map((row) => ({
      issueId: row.id,
      accessionNo: row.copy.accessionNo,
      title: row.copy.book.title,
      cardNo: row.member.cardNo,
      memberName:
        people.get(`${row.member.personType}:${row.member.personId}`)?.name ??
        '—',
      issuedAt: row.issuedAt,
      dueAt: row.dueAt,
      renewCount: row.renewCount,
      overdue: row.dueAt.getTime() < now.getTime(),
    }));
  }

  async popular(schoolId: string, from: Date, to: Date, limit = 20) {
    const rows = await this.books.popularTitles(schoolId, from, to, limit);
    return rows.map(({ book, issues }) => ({
      bookId: book.id,
      title: book.title,
      category: book.category.name,
      authors: book.authors.map((a) => a.author.name),
      issues,
    }));
  }

  /** Category stock plus the school-wide copy-status totals. */
  async stock(schoolId: string) {
    const [byCategory, totals] = await Promise.all([
      this.books.stockByCategory(schoolId),
      this.copies.statusTotals(schoolId),
    ]);
    return {
      byCategory,
      totals,
      /** Roadmap §6 — LOST copies are excluded from stock counts. */
      inStock: totals.AVAILABLE + totals.ISSUED + totals.RESERVED,
      writtenOff: totals.LOST + totals.DAMAGED + totals.WITHDRAWN,
    };
  }

  /** One card's whole borrowing history, plus what it still owes. */
  async memberHistory(memberId: string, schoolId: string, now = new Date()) {
    const member = await this.members.findByIdOrFail(memberId, schoolId);
    const [person, standing, loans] = await Promise.all([
      this.directory.lookup(schoolId, member.personType, member.personId),
      this.members.standing(memberId, now),
      this.issues.findAllFor(schoolId, { memberId }, now),
    ]);

    return {
      member,
      person,
      standing: { ...standing, heldBookIds: [...standing.heldBookIds] },
      loans: loans.map((row) => ({
        issueId: row.id,
        accessionNo: row.copy.accessionNo,
        title: row.copy.book.title,
        issuedAt: row.issuedAt,
        dueAt: row.dueAt,
        returnedAt: row.returnedAt,
        renewCount: row.renewCount,
        fineAmount: Number(row.fineAmount),
        outstandingFine: outstandingFine({
          fineAmount: Number(row.fineAmount),
          fineCollected: Number(row.fineCollected),
          fineWaived: Number(row.fineWaived),
        }),
        fineReason: row.fineReason,
      })),
    };
  }

  /** The desk's daily figures — issues, returns and money. */
  async summary(schoolId: string, from: Date, to: Date, now = new Date()) {
    const [issuedInWindow, fines, open, overdue, totals] = await Promise.all([
      this.issues.findAllFor(schoolId, { issuedFrom: from, issuedTo: to }, now),
      this.issues.fineTotals(schoolId, from, to),
      this.issues.findAllFor(schoolId, { openOnly: true }, now),
      this.issues.findAllFor(schoolId, { overdueOnly: true }, now),
      this.copies.statusTotals(schoolId),
    ]);

    const returnedInWindow = issuedInWindow.filter(
      (row) =>
        row.returnedAt !== null &&
        row.returnedAt >= from &&
        row.returnedAt <= to,
    );

    return {
      window: { from, to },
      issued: issuedInWindow.length,
      returned: returnedInWindow.length,
      onLoan: open.length,
      overdue: overdue.length,
      fines: {
        assessed: money(fines.assessed),
        collected: money(fines.collected),
        waived: money(fines.waived),
        outstanding: money(fines.assessed - fines.collected - fines.waived),
      },
      copies: totals,
    };
  }

  private async peopleFor(
    schoolId: string,
    members: Array<{ personType: LibraryMemberType; personId: string }>,
  ): Promise<Map<string, DirectoryPerson>> {
    const byType = new Map<LibraryMemberType, string[]>();
    for (const member of members) {
      byType.set(member.personType, [
        ...(byType.get(member.personType) ?? []),
        member.personId,
      ]);
    }
    const out = new Map<string, DirectoryPerson>();
    for (const [personType, ids] of byType) {
      const found = await this.directory.lookupMany(schoolId, personType, ids);
      for (const [id, person] of found) {
        out.set(`${personType}:${id}`, person);
      }
    }
    return out;
  }
}
