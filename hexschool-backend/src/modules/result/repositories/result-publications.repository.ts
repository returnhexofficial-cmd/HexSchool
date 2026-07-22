import { Injectable } from '@nestjs/common';
import { Prisma, ResultPublication } from '@prisma/client';
import { PrismaClientLike } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

/**
 * Publication versions. Append-only in spirit: unpublishing flips
 * `is_active` and stamps the revocation rather than deleting, and a
 * republish after a correction writes version N+1 with its own note —
 * which is what "corrections create a new publication version with a
 * visible changelog" (roadmap M15 §6) actually means on disk.
 *
 * A partial unique index guarantees at most one ACTIVE version per exam,
 * because "the active publication" is what the portal and the public
 * search resolve against and it has to be singular.
 */
@Injectable()
export class ResultPublicationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findActive(examId: string): Promise<ResultPublication | null> {
    return this.prisma.resultPublication.findFirst({
      where: { examId, isActive: true },
    });
  }

  async findHistory(examId: string): Promise<ResultPublication[]> {
    return this.prisma.resultPublication.findMany({
      where: { examId },
      orderBy: { version: 'desc' },
    });
  }

  async nextVersion(examId: string, tx?: PrismaClientLike): Promise<number> {
    const client = (tx ?? this.prisma) as PrismaService;
    const latest = await client.resultPublication.findFirst({
      where: { examId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    return (latest?.version ?? 0) + 1;
  }

  async create(
    data: Prisma.ResultPublicationUncheckedCreateInput,
    tx?: PrismaClientLike,
  ): Promise<ResultPublication> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.resultPublication.create({ data });
  }

  /** Retire whatever is live so a new version can take the active slot. */
  async revokeActive(
    examId: string,
    revokedBy: string,
    tx?: PrismaClientLike,
  ): Promise<number> {
    const client = (tx ?? this.prisma) as PrismaService;
    const { count } = await client.resultPublication.updateMany({
      where: { examId, isActive: true },
      data: { isActive: false, revokedBy, revokedAt: new Date() },
    });
    return count;
  }

  /** Is this exam's result visible to portals and the public search? */
  async isPublished(examId: string): Promise<boolean> {
    const active = await this.findActive(examId);
    return active !== null;
  }

  /** Unit-of-work helper (BaseRepository's, re-exposed for this repo). */
  async withTransaction<R>(
    fn: (tx: Prisma.TransactionClient) => Promise<R>,
  ): Promise<R> {
    return this.prisma.$transaction(fn);
  }
}
