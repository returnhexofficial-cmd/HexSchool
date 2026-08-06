import { Injectable } from '@nestjs/common';
import {
  ArchiveFile,
  ArchiveFolder,
  ArchiveLinkType,
  Prisma,
} from '@prisma/client';
import { BaseRepository } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

@Injectable()
export class ArchiveFoldersRepository extends BaseRepository<
  ArchiveFolder,
  Prisma.ArchiveFolderWhereInput,
  Prisma.ArchiveFolderUncheckedCreateInput,
  Prisma.ArchiveFolderUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.archiveFolder, 'ArchiveFolder');
  }

  /**
   * Every live folder in one query — the tree is assembled in the service.
   *
   * A recursive walk would be N queries deep for a cabinet a school
   * reorganises twice a year and never nests more than three levels; one
   * flat read plus an in-memory build is both faster and the only shape
   * that can detect a cycle before writing one (the M20 `coa.engine`
   * `wouldCycle` precedent).
   */
  async findAllLive(schoolId: string): Promise<ArchiveFolder[]> {
    return this.prisma.archiveFolder.findMany({
      where: { schoolId, deletedAt: null },
      orderBy: [{ name: 'asc' }],
    });
  }

  async findByName(
    schoolId: string,
    parentId: string | null,
    name: string,
    excludeId?: string,
  ): Promise<ArchiveFolder | null> {
    return this.prisma.archiveFolder.findFirst({
      where: {
        schoolId,
        parentId,
        deletedAt: null,
        name: { equals: name.trim(), mode: 'insensitive' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
  }

  async countChildren(folderId: string): Promise<number> {
    return this.prisma.archiveFolder.count({
      where: { parentId: folderId, deletedAt: null },
    });
  }

  async countFiles(folderId: string): Promise<number> {
    return this.prisma.archiveFile.count({
      where: { folderId, deletedAt: null },
    });
  }

  /** File counts for every folder at once — the tree's badges. */
  async fileCounts(schoolId: string): Promise<Map<string, number>> {
    const rows = await this.prisma.archiveFile.groupBy({
      by: ['folderId'],
      where: { schoolId, deletedAt: null },
      _count: { _all: true },
    });
    return new Map(rows.map((row) => [row.folderId, row._count._all]));
  }
}

export interface ArchiveFileFilter {
  folderId?: string;
  /** Every tag must be present — an AND, because a filter that ORs tags
   *  gets wider as you refine it, which is the opposite of a filter. */
  tags?: string[];
  linkedType?: ArchiveLinkType;
  linkedId?: string;
  search?: string;
}

@Injectable()
export class ArchiveFilesRepository extends BaseRepository<
  ArchiveFile,
  Prisma.ArchiveFileWhereInput,
  Prisma.ArchiveFileUncheckedCreateInput,
  Prisma.ArchiveFileUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.archiveFile, 'ArchiveFile');
  }

  private where(
    schoolId: string,
    filter: ArchiveFileFilter,
  ): Prisma.ArchiveFileWhereInput {
    return {
      schoolId,
      deletedAt: null,
      ...(filter.folderId ? { folderId: filter.folderId } : {}),
      ...(filter.tags && filter.tags.length > 0
        ? { tags: { hasEvery: filter.tags } }
        : {}),
      ...(filter.linkedType ? { linkedType: filter.linkedType } : {}),
      ...(filter.linkedId ? { linkedId: filter.linkedId } : {}),
      ...(filter.search
        ? {
            OR: [
              { title: { contains: filter.search, mode: 'insensitive' } },
              { notes: { contains: filter.search, mode: 'insensitive' } },
              { tags: { has: filter.search.toLowerCase() } },
            ],
          }
        : {}),
    };
  }

  async findMany(
    schoolId: string,
    filter: ArchiveFileFilter,
    page: number,
    limit: number,
  ): Promise<{ rows: ArchiveFile[]; total: number }> {
    const where = this.where(schoolId, filter);
    const [rows, total] = await Promise.all([
      this.prisma.archiveFile.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.archiveFile.count({ where }),
    ]);
    return { rows, total };
  }

  /**
   * Every tag in use, with how many files carry it — the filter chips.
   *
   * `unnest` rather than reading every row and folding in JS: the cabinet
   * grows without bound and the chip list is rendered on every page load.
   */
  async tagCloud(
    schoolId: string,
  ): Promise<Array<{ tag: string; count: number }>> {
    const rows = await this.prisma.$queryRaw<
      Array<{ tag: string; count: bigint }>
    >`
      SELECT unnest("tags") AS tag, COUNT(*) AS count
      FROM "archive_files"
      WHERE "school_id" = ${schoolId}::uuid AND "deleted_at" IS NULL
      GROUP BY tag
      ORDER BY count DESC, tag ASC
      LIMIT 100
    `;
    return rows.map((row) => ({ tag: row.tag, count: Number(row.count) }));
  }
}
