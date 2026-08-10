import { Injectable } from '@nestjs/common';
import {
  Prisma,
  Ticket,
  TicketCategory,
  TicketComment,
  TicketPriority,
  TicketRaiserType,
  TicketStatus,
} from '@prisma/client';
import {
  BaseRepository,
  PrismaClientLike,
} from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

export interface TicketFilter {
  type?: string;
  category?: TicketCategory;
  status?: TicketStatus;
  priority?: TicketPriority;
  assignedTo?: string;
  raisedByType?: TicketRaiserType;
  raisedById?: string;
  from?: Date;
  to?: Date;
  search?: string;
  /**
   * **The privacy filter, and it is a WHERE clause rather than a
   * post-hoc trim.** Roadmap §8 restricts a complaint that names a member
   * of staff to senior staff, and the M19 rule applies: a caller without
   * `ticket.sensitive.view` must never receive the row, not receive it
   * and have fields blanked. Default `false` is the safe direction — a
   * call site that forgets to pass it sees less, not more.
   */
  includeSensitive?: boolean;
}

@Injectable()
export class TicketsRepository extends BaseRepository<
  Ticket,
  Prisma.TicketWhereInput,
  Prisma.TicketUncheckedCreateInput,
  Prisma.TicketUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.ticket, 'Ticket');
  }

  private where(
    schoolId: string,
    filter: TicketFilter,
  ): Prisma.TicketWhereInput {
    return {
      schoolId,
      deletedAt: null,
      ...(filter.includeSensitive ? {} : { isSensitive: false }),
      ...(filter.type ? { type: filter.type as Ticket['type'] } : {}),
      ...(filter.category ? { category: filter.category } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.priority ? { priority: filter.priority } : {}),
      ...(filter.assignedTo ? { assignedTo: filter.assignedTo } : {}),
      ...(filter.raisedByType ? { raisedByType: filter.raisedByType } : {}),
      ...(filter.raisedById ? { raisedById: filter.raisedById } : {}),
      ...(filter.from || filter.to
        ? {
            createdAt: {
              ...(filter.from ? { gte: filter.from } : {}),
              ...(filter.to ? { lte: filter.to } : {}),
            },
          }
        : {}),
      ...(filter.search
        ? {
            OR: [
              { ticketNo: { contains: filter.search, mode: 'insensitive' } },
              { subject: { contains: filter.search, mode: 'insensitive' } },
              { description: { contains: filter.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
  }

  async findMany(
    schoolId: string,
    filter: TicketFilter,
    page: number,
    limit: number,
  ): Promise<{ rows: Ticket[]; total: number }> {
    const where = this.where(schoolId, filter);
    const [rows, total] = await Promise.all([
      this.prisma.ticket.findMany({
        where,
        // Urgent first, then oldest first inside a priority: the thing
        // that has been waiting longest at the top of the worst pile is
        // what an inbox should show, not the newest arrival.
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.ticket.count({ where }),
    ]);
    return { rows, total };
  }

  async findAllFor(schoolId: string, filter: TicketFilter): Promise<Ticket[]> {
    return this.prisma.ticket.findMany({
      where: this.where(schoolId, filter),
      orderBy: [{ createdAt: 'asc' }],
    });
  }

  /**
   * One ticket, sensitivity NOT applied — the service decides, because it
   * is the only layer that knows whether the caller holds
   * `ticket.sensitive.view` and it must be able to 404 rather than 403
   * (the M19/M22 rule that a read must not confirm what the caller may
   * not see).
   */
  async findDetail(id: string, schoolId: string): Promise<Ticket | null> {
    return this.prisma.ticket.findFirst({
      where: { id, schoolId, deletedAt: null },
    });
  }

  async findByNumber(
    schoolId: string,
    ticketNo: string,
  ): Promise<Ticket | null> {
    return this.prisma.ticket.findFirst({
      where: { schoolId, ticketNo, deletedAt: null },
    });
  }

  /** The M19 per-IP hourly cap, for the public complaint form. */
  async countRecentFromIp(
    schoolId: string,
    ip: string,
    since: Date,
  ): Promise<number> {
    return this.prisma.ticket.count({
      where: { schoolId, ip, createdAt: { gte: since } },
    });
  }

  /** Everything a named requester raised — the portal's own list. */
  async findForRaiser(
    schoolId: string,
    raisedByType: TicketRaiserType,
    raisedById: string,
    take = 50,
  ): Promise<Ticket[]> {
    return this.prisma.ticket.findMany({
      where: { schoolId, raisedByType, raisedById, deletedAt: null },
      orderBy: [{ createdAt: 'desc' }],
      take,
    });
  }

  /**
   * The SLA sweep's candidate set: live tickets only, and deliberately
   * **including sensitive ones** — a complaint about a teacher going
   * unanswered for four days is precisely the one the head must be told
   * about. The escalation names counts and ticket numbers, never subjects.
   */
  async findLiveForSla(schoolId: string): Promise<Ticket[]> {
    return this.prisma.ticket.findMany({
      where: {
        schoolId,
        deletedAt: null,
        status: {
          in: [
            TicketStatus.OPEN,
            TicketStatus.IN_PROGRESS,
            TicketStatus.REOPENED,
          ],
        },
      },
    });
  }

  async countByStatus(
    schoolId: string,
    includeSensitive: boolean,
  ): Promise<Array<{ status: TicketStatus; count: number }>> {
    const rows = await this.prisma.ticket.groupBy({
      by: ['status'],
      where: {
        schoolId,
        deletedAt: null,
        ...(includeSensitive ? {} : { isSensitive: false }),
      },
      _count: { _all: true },
    });
    return rows.map((row) => ({ status: row.status, count: row._count._all }));
  }

  async withTransaction<R>(
    fn: (tx: PrismaClientLike) => Promise<R>,
  ): Promise<R> {
    return this.prisma.$transaction((tx) => fn(tx));
  }
}

/**
 * The thread. **Append-only** — the table has no `deleted_at` and no
 * `updated_at`, so this repository deliberately offers no update and no
 * delete path (the M03 audit / M17 notifications / M20 ledger / M24
 * stock-ledger precedent).
 */
@Injectable()
export class TicketCommentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    data: Prisma.TicketCommentUncheckedCreateInput,
    tx?: PrismaClientLike,
  ): Promise<TicketComment> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.ticketComment.create({ data });
  }

  /**
   * `includeInternal` is the second privacy boundary in this module. An
   * internal note is what the office says to itself while it works out
   * what to tell a parent; the portal thread must never carry one, and
   * the filter lives in the query for the same reason the sensitivity one
   * does.
   */
  async findForTicket(
    ticketId: string,
    schoolId: string,
    includeInternal: boolean,
  ): Promise<TicketComment[]> {
    return this.prisma.ticketComment.findMany({
      where: {
        ticketId,
        schoolId,
        ...(includeInternal ? {} : { isInternal: false }),
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async countForTicket(ticketId: string, schoolId: string): Promise<number> {
    return this.prisma.ticketComment.count({ where: { ticketId, schoolId } });
  }
}
