import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BookCopyStatus,
  BookReservationStatus,
  LibraryMemberStatus,
} from '@prisma/client';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import type { CreateReservationDto, ReservationQueryDto } from '../dto';
import { BookCopiesRepository } from '../repositories/book-copies.repository';
import { BooksRepository } from '../repositories/catalog.repository';
import { BookReservationsRepository } from '../repositories/circulation.repository';
import { LibraryMembersRepository } from '../repositories/library-members.repository';
import { LibrarySettingsService } from './library-settings.service';

/**
 * Holds on a **title**, not on a copy — a member wants the book, any
 * copy of it.
 *
 * Roadmap §3 put `RESERVED` in the copy-status enum and §4 asks the
 * renew path to make a "no-reservation check", which is only decidable
 * against a queue. This is that queue, and the copy status is its
 * shadow: a copy is RESERVED exactly while a READY hold points at it.
 *
 * Placing a hold on a title that has a copy on the shelf is refused
 * rather than queued. The book is *there* — a hold would put a member in
 * a queue of one behind a book they could pick up now, and would take
 * the copy out of circulation for three days while they did not.
 */
@Injectable()
export class ReservationsService {
  constructor(
    private readonly reservations: BookReservationsRepository,
    private readonly copies: BookCopiesRepository,
    private readonly books: BooksRepository,
    private readonly members: LibraryMembersRepository,
    private readonly config: LibrarySettingsService,
    private readonly audit: AuditContextService,
  ) {}

  async list(query: ReservationQueryDto, actor: AccessTokenPayload) {
    const { page, limit } = query;
    const { rows, total } = await this.reservations.findMany(
      actor.schoolId,
      {
        bookId: query.bookId,
        memberId: query.memberId,
        status: query.status,
        liveOnly: query.liveOnly,
      },
      page,
      limit,
    );
    return { rows, total, page, limit };
  }

  async create(
    dto: CreateReservationDto,
    memberId: string,
    actor: AccessTokenPayload,
  ) {
    const cfg = await this.config.load(actor.schoolId);
    if (!cfg.enabled) {
      throw new ConflictException(
        'The library is switched off for this school',
      );
    }

    const book = await this.books.findByIdOrFail(dto.bookId, actor.schoolId);
    const member = await this.members.findByIdOrFail(memberId, actor.schoolId);
    if (member.status !== LibraryMemberStatus.ACTIVE) {
      throw new ConflictException(
        `This card is ${member.status.toLowerCase()} and cannot reserve`,
      );
    }

    const existing = await this.reservations.findLiveFor(
      dto.bookId,
      memberId,
      actor.schoolId,
    );
    if (existing) {
      throw new ConflictException(`You already have a hold on "${book.title}"`);
    }

    const available = await this.copies.firstAvailable(
      actor.schoolId,
      dto.bookId,
    );
    if (available) {
      throw new ConflictException(
        `"${book.title}" is on the shelf (${available.accessionNo}) — borrow it rather than reserving it`,
      );
    }

    const created = await this.reservations.create({
      schoolId: actor.schoolId,
      bookId: dto.bookId,
      memberId,
      status: BookReservationStatus.ACTIVE,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'BookReservation',
      entityId: created.id,
      newValues: { book: book.title, memberId },
    });

    const queue = await this.reservations.queueFor(dto.bookId, actor.schoolId);
    return {
      reservation: created,
      position: queue.findIndex((r) => r.id === created.id) + 1,
      queueLength: queue.length,
    };
  }

  async cancel(id: string, actor: AccessTokenPayload, byMemberId?: string) {
    const reservation = await this.reservations.findDetail(id, actor.schoolId);
    if (!reservation) {
      throw new NotFoundException(`Reservation ${id} not found`);
    }
    // A portal caller may only cancel their own — the same ownership
    // chokepoint M18 applies to every portal read.
    if (byMemberId && reservation.memberId !== byMemberId) {
      throw new NotFoundException(`Reservation ${id} not found`);
    }
    if (
      reservation.status !== BookReservationStatus.ACTIVE &&
      reservation.status !== BookReservationStatus.READY
    ) {
      throw new ConflictException(
        `This hold is already ${reservation.status.toLowerCase()}`,
      );
    }

    const now = new Date();
    await this.reservations.withTransaction(async (tx) => {
      await this.reservations.update(
        id,
        {
          status: BookReservationStatus.CANCELLED,
          heldCopyId: null,
          closedAt: now,
          updatedBy: actor.sub,
        },
        tx,
      );
      // Cancelling a READY hold releases the copy — to the next member
      // in the queue if there is one, otherwise back to the shelf.
      if (reservation.heldCopyId) {
        await this.releaseHeldCopy(
          reservation.bookId,
          reservation.heldCopyId,
          actor,
          now,
          tx,
        );
      }
    });

    this.audit.set({
      entityType: 'BookReservation',
      entityId: id,
      oldValues: { status: reservation.status },
      newValues: { status: BookReservationStatus.CANCELLED },
    });
    return this.reservations.findDetail(id, actor.schoolId);
  }

  /**
   * The expiry sweep: a READY hold nobody collected. The copy passes to
   * the next member in the queue rather than going straight back to the
   * shelf — otherwise the third person in a queue of three would watch
   * the book become available and be taken by a passer-by.
   */
  async expireLapsed(
    schoolId: string,
    actorId: string,
    now = new Date(),
  ): Promise<number> {
    const lapsed = await this.reservations.findLapsed(schoolId, now);
    let count = 0;
    for (const reservation of lapsed) {
      await this.reservations.withTransaction(async (tx) => {
        await this.reservations.update(
          reservation.id,
          {
            status: BookReservationStatus.EXPIRED,
            heldCopyId: null,
            closedAt: now,
            updatedBy: actorId,
          },
          tx,
        );
        if (reservation.heldCopyId) {
          await this.releaseHeldCopy(
            reservation.bookId,
            reservation.heldCopyId,
            { sub: actorId, schoolId },
            now,
            tx,
          );
        }
      });
      count++;
    }
    return count;
  }

  private async releaseHeldCopy(
    bookId: string,
    copyId: string,
    actor: Pick<AccessTokenPayload, 'sub' | 'schoolId'>,
    now: Date,
    tx: Parameters<
      Parameters<BookReservationsRepository['withTransaction']>[0]
    >[0],
  ): Promise<void> {
    const cfg = await this.config.load(actor.schoolId);
    const queue = await this.reservations.queueFor(bookId, actor.schoolId, tx);
    const next = queue.find((r) => r.status === BookReservationStatus.ACTIVE);

    if (!next) {
      await this.copies.setStatus(
        copyId,
        BookCopyStatus.AVAILABLE,
        actor.sub,
        tx,
      );
      return;
    }

    await this.reservations.update(
      next.id,
      {
        status: BookReservationStatus.READY,
        heldCopyId: copyId,
        readyAt: now,
        expiresAt: new Date(now.getTime() + cfg.reservationDays * 86_400_000),
        updatedBy: actor.sub,
      },
      tx,
    );
  }
}
