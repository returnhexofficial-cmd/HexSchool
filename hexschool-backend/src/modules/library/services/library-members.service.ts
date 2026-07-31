import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  LibraryMember,
  LibraryMemberStatus,
  LibraryMemberType,
} from '@prisma/client';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import { SequenceService } from '../../sequence/sequence.service';
import type { PrismaClientLike } from '../../../common/database/base.repository';
import type { EnrolMemberDto, MemberQueryDto, UpdateMemberDto } from '../dto';
import { LIBRARY_SEQUENCES } from '../library.constants';
import { BookIssuesRepository } from '../repositories/circulation.repository';
import {
  LibraryDirectoryRepository,
  type DirectoryPerson,
} from '../repositories/library-directory.repository';
import {
  LibraryMembersRepository,
  type MemberStanding,
} from '../repositories/library-members.repository';
import { LibrarySettingsService } from './library-settings.service';

export interface MemberView extends LibraryMember {
  person: DirectoryPerson | null;
  standing: MemberStanding & { outstandingFine: number };
}

@Injectable()
export class LibraryMembersService {
  constructor(
    private readonly members: LibraryMembersRepository,
    private readonly directory: LibraryDirectoryRepository,
    private readonly issues: BookIssuesRepository,
    private readonly sequences: SequenceService,
    private readonly schools: SchoolsRepository,
    private readonly config: LibrarySettingsService,
    private readonly audit: AuditContextService,
  ) {}

  async list(query: MemberQueryDto, actor: AccessTokenPayload) {
    const { page, limit } = query;
    const { rows, total } = await this.members.findMany(
      actor.schoolId,
      {
        personType: query.personType,
        status: query.status,
        search: query.search,
      },
      page,
      limit,
    );
    return {
      rows: await this.decorate(rows, actor.schoolId),
      total,
      page,
      limit,
    };
  }

  async getDetail(id: string, schoolId: string): Promise<MemberView> {
    const member = await this.members.findById(id, schoolId);
    if (!member) throw new NotFoundException(`Library member ${id} not found`);
    const [view] = await this.decorate([member], schoolId);
    return view;
  }

  /** The desk's card-number lookup. */
  async byCard(cardNo: string, schoolId: string): Promise<MemberView> {
    const member = await this.members.findByCard(schoolId, cardNo.trim());
    if (!member) {
      throw new NotFoundException(`No library card "${cardNo.trim()}"`);
    }
    const [view] = await this.decorate([member], schoolId);
    return view;
  }

  async enrol(dto: EnrolMemberDto, actor: AccessTokenPayload) {
    const member = await this.ensureMember(
      actor.schoolId,
      dto.personType,
      dto.personId,
      actor.sub,
      dto.maxBooks,
    );
    this.audit.set({
      entityType: 'LibraryMember',
      entityId: member.id,
      newValues: {
        cardNo: member.cardNo,
        personType: member.personType,
        personId: member.personId,
      },
    });
    return this.getDetail(member.id, actor.schoolId);
  }

  /**
   * Roadmap §4's "member auto-provision on first issue (or explicit
   * enroll)" — one path, used by both. The card number comes from
   * `SequenceService` inside the caller's transaction so an issue that
   * fails afterwards does not burn a card number (the M07 gap-free
   * guarantee), and the person is verified against the directory first:
   * a card for a `personId` that is not a real student is a card that
   * can never be handed to anybody.
   */
  async ensureMember(
    schoolId: string,
    personType: LibraryMemberType,
    personId: string,
    actorId: string,
    maxBooksOverride?: number,
    tx?: PrismaClientLike,
  ): Promise<LibraryMember> {
    const existing = await this.members.findByPerson(
      schoolId,
      personType,
      personId,
      tx,
    );
    if (existing) {
      if (maxBooksOverride && maxBooksOverride !== existing.maxBooks) {
        return this.members.update(
          existing.id,
          { maxBooks: maxBooksOverride, updatedBy: actorId },
          tx,
        );
      }
      return existing;
    }

    const person = await this.directory.lookup(schoolId, personType, personId);
    if (!person) {
      throw new NotFoundException(
        `No ${personType.toLowerCase()} with id ${personId} in this school`,
      );
    }

    const cfg = await this.config.load(schoolId);
    const school = await this.schools.findByIdOrFail(schoolId);
    const now = new Date();
    const cardNo = await this.sequences.nextDocumentNumber({
      schoolId,
      counterKey: LIBRARY_SEQUENCES.card(String(now.getUTCFullYear()).slice(2)),
      pattern: cfg.cardNoPattern,
      schoolCode: school.code,
      date: now,
      tx,
    });

    return this.members.create(
      {
        schoolId,
        personType,
        personId,
        cardNo,
        maxBooks: maxBooksOverride ?? cfg.maxBooks[personType],
        status: LibraryMemberStatus.ACTIVE,
        createdBy: actorId,
        updatedBy: actorId,
      },
      tx,
    );
  }

  async update(id: string, dto: UpdateMemberDto, actor: AccessTokenPayload) {
    const existing = await this.members.findByIdOrFail(id, actor.schoolId);

    // Closing a card with books still out would strand them: the loans
    // stay open, nothing chases them, and the member cannot return them
    // through a card the desk refuses to look up.
    if (dto.status === LibraryMemberStatus.CLOSED) {
      const standing = await this.members.standing(id, new Date());
      if (standing.openLoans > 0) {
        throw new ConflictException(
          `${standing.openLoans} book(s) are still on loan against this card — take them back before closing it`,
        );
      }
    }

    await this.members.update(id, {
      ...(dto.maxBooks !== undefined ? { maxBooks: dto.maxBooks } : {}),
      ...(dto.status ? { status: dto.status } : {}),
      ...(dto.statusReason !== undefined
        ? { statusReason: dto.statusReason?.trim() || null }
        : {}),
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'LibraryMember',
      entityId: id,
      oldValues: { status: existing.status, maxBooks: existing.maxBooks },
      newValues: {
        status: dto.status,
        maxBooks: dto.maxBooks,
        reason: dto.statusReason,
      },
    });
    return this.getDetail(id, actor.schoolId);
  }

  /**
   * Roadmap §4's "member history" — every loan this card has ever taken,
   * newest first, with what is still owed on each.
   */
  async history(id: string, schoolId: string, page: number, limit: number) {
    await this.members.findByIdOrFail(id, schoolId);
    return this.issues.findMany(schoolId, { memberId: id }, page, limit);
  }

  /** The desk's "who is this?" box, when nobody has their card. */
  async searchPeople(term: string, schoolId: string) {
    const people = await this.directory.search(schoolId, term);
    if (people.length === 0) return [];

    // Attach the card each person already has, so the desk can tell an
    // existing member from somebody who needs enrolling.
    const byType = new Map<LibraryMemberType, string[]>();
    for (const person of people) {
      byType.set(person.personType, [
        ...(byType.get(person.personType) ?? []),
        person.personId,
      ]);
    }
    const cards = new Map<string, LibraryMember>();
    for (const [personType, ids] of byType) {
      const { rows } = await this.members.findMany(
        schoolId,
        { personType, personIds: ids },
        1,
        100,
      );
      for (const row of rows)
        cards.set(`${row.personType}:${row.personId}`, row);
    }

    return people.map((person) => ({
      ...person,
      member: cards.get(`${person.personType}:${person.personId}`) ?? null,
    }));
  }

  private async decorate(
    rows: LibraryMember[],
    schoolId: string,
  ): Promise<MemberView[]> {
    if (rows.length === 0) return [];
    const now = new Date();

    const byType = new Map<LibraryMemberType, string[]>();
    for (const row of rows) {
      byType.set(row.personType, [
        ...(byType.get(row.personType) ?? []),
        row.personId,
      ]);
    }

    const people = new Map<string, DirectoryPerson>();
    for (const [personType, ids] of byType) {
      const found = await this.directory.lookupMany(schoolId, personType, ids);
      for (const [id, person] of found) {
        people.set(`${personType}:${id}`, person);
      }
    }

    const standings = await this.members.standings(
      rows.map((r) => r.id),
      now,
    );

    return rows.map((row) => ({
      ...row,
      person: people.get(`${row.personType}:${row.personId}`) ?? null,
      standing: standings.get(row.id) ?? {
        openLoans: 0,
        overdueLoans: 0,
        outstandingFine: 0,
        heldBookIds: new Set<string>(),
      },
    }));
  }
}
