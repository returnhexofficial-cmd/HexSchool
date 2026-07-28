import { Injectable } from '@nestjs/common';
import {
  Career,
  CareerApplication,
  CmsPage,
  CommitteeMember,
  ContactMessage,
  Download,
  Faq,
  Gallery,
  GalleryItem,
  NewsPost,
  Prisma,
  WebContentStatus,
} from '@prisma/client';
import { BaseRepository } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

/**
 * One repository per CMS entity (roadmap global convention: every entity
 * gets a repository extending BaseRepository). They live in one file
 * because each is a thin, near-identical soft-deleted master over the
 * generic base — splitting nine four-line classes across nine files would
 * add navigation cost without adding structure.
 *
 * Every read the PUBLIC site performs goes through the `published*`
 * helpers here, which pin `status = PUBLISHED` and `deleted_at IS NULL`
 * inside the repository — so a public endpoint cannot accidentally forget
 * the filter (roadmap M19 §6, and what the e2e privacy suite asserts).
 */

const PUBLISHED = WebContentStatus.PUBLISHED;

@Injectable()
export class CmsPagesRepository extends BaseRepository<
  CmsPage,
  Prisma.CmsPageWhereInput,
  Prisma.CmsPageUncheckedCreateInput,
  Prisma.CmsPageUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.cmsPage, 'CmsPage');
  }

  findBySlug(schoolId: string, slug: string): Promise<CmsPage | null> {
    return this.prisma.cmsPage.findFirst({
      where: { schoolId, slug, deletedAt: null },
    });
  }

  publishedBySlug(schoolId: string, slug: string): Promise<CmsPage | null> {
    return this.prisma.cmsPage.findFirst({
      where: { schoolId, slug, status: PUBLISHED, deletedAt: null },
    });
  }

  /** Published pages, menu-ordered — the site navigation and the sitemap. */
  publishedPages(
    schoolId: string,
    opts: { menuOnly?: boolean } = {},
  ): Promise<CmsPage[]> {
    return this.prisma.cmsPage.findMany({
      where: {
        schoolId,
        status: PUBLISHED,
        deletedAt: null,
        ...(opts.menuOnly ? { showInMenu: true } : {}),
      },
      orderBy: [{ displayOrder: 'asc' }, { title: 'asc' }],
    });
  }

  /** Slugs already taken (the uniqueness pass for `uniqueSlug`). */
  async takenSlugs(schoolId: string): Promise<Set<string>> {
    const rows = await this.prisma.cmsPage.findMany({
      where: { schoolId, deletedAt: null },
      select: { slug: true },
    });
    return new Set(rows.map((r) => r.slug));
  }
}

@Injectable()
export class NewsPostsRepository extends BaseRepository<
  NewsPost,
  Prisma.NewsPostWhereInput,
  Prisma.NewsPostUncheckedCreateInput,
  Prisma.NewsPostUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.newsPost, 'NewsPost');
  }

  findBySlug(schoolId: string, slug: string): Promise<NewsPost | null> {
    return this.prisma.newsPost.findFirst({
      where: { schoolId, slug, deletedAt: null },
    });
  }

  publishedBySlug(schoolId: string, slug: string): Promise<NewsPost | null> {
    return this.prisma.newsPost.findFirst({
      where: { schoolId, slug, status: PUBLISHED, deletedAt: null },
    });
  }

  /** Newest-first published feed, optionally filtered by category/search. */
  async publishedFeed(
    schoolId: string,
    opts: {
      category?: NewsPost['category'];
      search?: string;
      skip?: number;
      take?: number;
    } = {},
  ): Promise<{ items: NewsPost[]; total: number }> {
    const where: Prisma.NewsPostWhereInput = {
      schoolId,
      status: PUBLISHED,
      deletedAt: null,
      ...(opts.category ? { category: opts.category } : {}),
      ...(opts.search
        ? {
            OR: [
              { title: { contains: opts.search, mode: 'insensitive' } },
              { excerpt: { contains: opts.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.newsPost.findMany({
        where,
        orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
        skip: opts.skip ?? 0,
        take: opts.take ?? 9,
      }),
      this.prisma.newsPost.count({ where }),
    ]);
    return { items, total };
  }

  async takenSlugs(schoolId: string): Promise<Set<string>> {
    const rows = await this.prisma.newsPost.findMany({
      where: { schoolId, deletedAt: null },
      select: { slug: true },
    });
    return new Set(rows.map((r) => r.slug));
  }
}

@Injectable()
export class GalleriesRepository extends BaseRepository<
  Gallery,
  Prisma.GalleryWhereInput,
  Prisma.GalleryUncheckedCreateInput,
  Prisma.GalleryUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.gallery, 'Gallery');
  }

  publishedList(schoolId: string, take?: number): Promise<Gallery[]> {
    return this.prisma.gallery.findMany({
      where: { schoolId, status: PUBLISHED, deletedAt: null },
      orderBy: [{ displayOrder: 'asc' }, { eventDate: 'desc' }],
      ...(take ? { take } : {}),
    });
  }

  publishedById(schoolId: string, id: string): Promise<Gallery | null> {
    return this.prisma.gallery.findFirst({
      where: { id, schoolId, status: PUBLISHED, deletedAt: null },
    });
  }
}

@Injectable()
export class GalleryItemsRepository extends BaseRepository<
  GalleryItem,
  Prisma.GalleryItemWhereInput,
  Prisma.GalleryItemUncheckedCreateInput,
  Prisma.GalleryItemUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    // Hard-deleted: an album's items are replaced as a set (see the
    // model doc), so there is no `deleted_at` column to scope by.
    super(prisma, (client) => client.galleryItem, 'GalleryItem', {
      softDeletable: false,
    });
  }

  /** Paginated (roadmap §8: a very large album loads its items in pages). */
  async listForGallery(
    galleryId: string,
    opts: { skip?: number; take?: number } = {},
  ): Promise<{ items: GalleryItem[]; total: number }> {
    const where: Prisma.GalleryItemWhereInput = { galleryId };
    const [items, total] = await Promise.all([
      this.prisma.galleryItem.findMany({
        where,
        orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
        skip: opts.skip ?? 0,
        take: opts.take ?? 24,
      }),
      this.prisma.galleryItem.count({ where }),
    ]);
    return { items, total };
  }

  /**
   * Cover fallback + item counts for a set of galleries, in one query:
   * ids and urls only, ordered, so the caller can take the first IMAGE of
   * each as its cover and count the rest without a second round trip.
   */
  coverCandidates(
    galleryIds: string[],
  ): Promise<Array<Pick<GalleryItem, 'galleryId' | 'type' | 'url'>>> {
    if (galleryIds.length === 0) return Promise.resolve([]);
    return this.prisma.galleryItem.findMany({
      where: { galleryId: { in: galleryIds } },
      select: { galleryId: true, type: true, url: true },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }
}

@Injectable()
export class DownloadsRepository extends BaseRepository<
  Download,
  Prisma.DownloadWhereInput,
  Prisma.DownloadUncheckedCreateInput,
  Prisma.DownloadUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.download, 'Download');
  }

  publishedList(schoolId: string): Promise<Download[]> {
    return this.prisma.download.findMany({
      where: { schoolId, status: PUBLISHED, deletedAt: null },
      orderBy: [{ displayOrder: 'asc' }, { title: 'asc' }],
    });
  }

  publishedById(schoolId: string, id: string): Promise<Download | null> {
    return this.prisma.download.findFirst({
      where: { id, schoolId, status: PUBLISHED, deletedAt: null },
    });
  }

  /**
   * Atomic `+1`. The counter is the one column an anonymous visitor can
   * move, so it is incremented in the database rather than read-modify-
   * written in the service — two simultaneous downloads must count twice.
   */
  async incrementCounter(schoolId: string, id: string): Promise<number> {
    const rows = await this.prisma.download.updateManyAndReturn({
      where: { id, schoolId, status: PUBLISHED, deletedAt: null },
      data: { downloadCount: { increment: 1 } },
      select: { downloadCount: true },
    });
    return rows[0]?.downloadCount ?? 0;
  }
}

@Injectable()
export class CareersRepository extends BaseRepository<
  Career,
  Prisma.CareerWhereInput,
  Prisma.CareerUncheckedCreateInput,
  Prisma.CareerUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.career, 'Career');
  }

  /** Published openings whose deadline has not passed (or have none). */
  publishedOpenings(schoolId: string, today: Date): Promise<Career[]> {
    return this.prisma.career.findMany({
      where: {
        schoolId,
        status: PUBLISHED,
        deletedAt: null,
        OR: [{ deadline: null }, { deadline: { gte: today } }],
      },
      orderBy: [{ displayOrder: 'asc' }, { deadline: 'asc' }],
    });
  }

  publishedById(schoolId: string, id: string): Promise<Career | null> {
    return this.prisma.career.findFirst({
      where: { id, schoolId, status: PUBLISHED, deletedAt: null },
    });
  }
}

@Injectable()
export class CareerApplicationsRepository extends BaseRepository<
  CareerApplication,
  Prisma.CareerApplicationWhereInput,
  Prisma.CareerApplicationUncheckedCreateInput,
  Prisma.CareerApplicationUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.careerApplication, 'CareerApplication');
  }
}

@Injectable()
export class FaqsRepository extends BaseRepository<
  Faq,
  Prisma.FaqWhereInput,
  Prisma.FaqUncheckedCreateInput,
  Prisma.FaqUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.faq, 'Faq');
  }

  publishedList(schoolId: string): Promise<Faq[]> {
    return this.prisma.faq.findMany({
      where: { schoolId, status: PUBLISHED, deletedAt: null },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }
}

@Injectable()
export class CommitteeMembersRepository extends BaseRepository<
  CommitteeMember,
  Prisma.CommitteeMemberWhereInput,
  Prisma.CommitteeMemberUncheckedCreateInput,
  Prisma.CommitteeMemberUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.committeeMember, 'CommitteeMember');
  }

  publishedList(schoolId: string): Promise<CommitteeMember[]> {
    return this.prisma.committeeMember.findMany({
      where: { schoolId, status: PUBLISHED, deletedAt: null },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
  }
}

@Injectable()
export class ContactMessagesRepository extends BaseRepository<
  ContactMessage,
  Prisma.ContactMessageWhereInput,
  Prisma.ContactMessageUncheckedCreateInput,
  Prisma.ContactMessageUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.contactMessage, 'ContactMessage');
  }

  /** Submissions from one IP inside a window — the anti-flood check. */
  countRecentFromIp(
    schoolId: string,
    ip: string,
    since: Date,
  ): Promise<number> {
    return this.prisma.contactMessage.count({
      where: { schoolId, ip, createdAt: { gte: since } },
    });
  }
}
