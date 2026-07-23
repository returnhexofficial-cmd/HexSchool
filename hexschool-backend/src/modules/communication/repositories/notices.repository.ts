import { Injectable } from '@nestjs/common';
import { Notice, Prisma } from '@prisma/client';
import { BaseRepository } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

/** Notices / circulars (soft-deleted business entity). */
@Injectable()
export class NoticesRepository extends BaseRepository<
  Notice,
  Prisma.NoticeWhereInput,
  Prisma.NoticeUncheckedCreateInput,
  Prisma.NoticeUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.notice, 'Notice');
  }

  /** Published feed for portals / website, pinned first then newest. */
  async publishedFeed(
    schoolId: string,
    opts: { websiteOnly?: boolean; take?: number } = {},
  ): Promise<Notice[]> {
    return this.prisma.notice.findMany({
      where: {
        schoolId,
        deletedAt: null,
        isPublished: true,
        ...(opts.websiteOnly ? { isWebsiteVisible: true } : {}),
      },
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
      take: opts.take ?? 50,
    });
  }

  /** Scheduled notices whose publish time has arrived (job input). */
  async findDuePublications(schoolId: string, now: Date): Promise<Notice[]> {
    return this.prisma.notice.findMany({
      where: {
        schoolId,
        deletedAt: null,
        isPublished: false,
        publishAt: { not: null, lte: now },
      },
    });
  }
}
