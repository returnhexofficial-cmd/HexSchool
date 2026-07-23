import { Injectable } from '@nestjs/common';
import { FeeStructure, Prisma } from '@prisma/client';
import { PrismaClientLike } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

const RELATIONS = {
  feeHead: {
    select: { id: true, name: true, code: true, type: true, isRefundable: true },
  },
  class: { select: { id: true, name: true, numericLevel: true } },
  group: { select: { id: true, name: true } },
} satisfies Prisma.FeeStructureInclude;

export type FeeStructureWithRelations = Prisma.FeeStructureGetPayload<{
  include: typeof RELATIONS;
}>;

/**
 * What each head costs per (session, class, group). The identity unique
 * is a hand-written COALESCE index because `group_id` is nullable, so
 * upserts go through an explicit find-then-write rather than Prisma's
 * `upsert` (which cannot target an expression index).
 */
@Injectable()
export class FeeStructuresRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findForSession(
    schoolId: string,
    sessionId: string,
    filter: { classId?: string; feeHeadId?: string } = {},
  ): Promise<FeeStructureWithRelations[]> {
    return this.prisma.feeStructure.findMany({
      where: {
        schoolId,
        sessionId,
        deletedAt: null,
        ...(filter.classId ? { classId: filter.classId } : {}),
        ...(filter.feeHeadId ? { feeHeadId: filter.feeHeadId } : {}),
      },
      include: RELATIONS,
      orderBy: [
        { class: { numericLevel: 'asc' } },
        { feeHead: { displayOrder: 'asc' } },
      ],
    });
  }

  /**
   * The heads billable to one candidate: their class's structures,
   * narrowed to rows that are either group-agnostic or match the
   * candidate's own group.
   */
  async findBillable(
    schoolId: string,
    sessionId: string,
    classId: string,
    groupId: string | null,
  ): Promise<FeeStructureWithRelations[]> {
    return this.prisma.feeStructure.findMany({
      where: {
        schoolId,
        sessionId,
        classId,
        deletedAt: null,
        OR: [{ groupId: null }, ...(groupId ? [{ groupId }] : [])],
      },
      include: RELATIONS,
      orderBy: { feeHead: { displayOrder: 'asc' } },
    });
  }

  async findById(
    id: string,
    schoolId: string,
  ): Promise<FeeStructureWithRelations | null> {
    return this.prisma.feeStructure.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: RELATIONS,
    });
  }

  /** Identity lookup — the COALESCE unique's application-side twin. */
  async findIdentity(
    sessionId: string,
    classId: string,
    feeHeadId: string,
    groupId: string | null,
  ): Promise<FeeStructure | null> {
    return this.prisma.feeStructure.findFirst({
      where: { sessionId, classId, feeHeadId, groupId, deletedAt: null },
    });
  }

  async create(
    data: Prisma.FeeStructureUncheckedCreateInput,
    tx?: PrismaClientLike,
  ): Promise<FeeStructure> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.feeStructure.create({ data });
  }

  async update(
    id: string,
    data: Prisma.FeeStructureUncheckedUpdateInput,
    tx?: PrismaClientLike,
  ): Promise<FeeStructure> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.feeStructure.update({ where: { id }, data });
  }

  async softDelete(id: string, actorId: string): Promise<void> {
    await this.prisma.feeStructure.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: actorId },
    });
  }

  /** Distinct class ids that have any structure — the matrix's rows. */
  async findClassIds(schoolId: string, sessionId: string): Promise<string[]> {
    const rows = await this.prisma.feeStructure.findMany({
      where: { schoolId, sessionId, deletedAt: null },
      distinct: ['classId'],
      select: { classId: true },
    });
    return rows.map((r) => r.classId);
  }

  async withTransaction<R>(
    fn: (tx: Prisma.TransactionClient) => Promise<R>,
  ): Promise<R> {
    return this.prisma.$transaction(fn);
  }
}
