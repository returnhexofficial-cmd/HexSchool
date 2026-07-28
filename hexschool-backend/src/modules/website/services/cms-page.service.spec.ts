import { BadRequestException, ConflictException } from '@nestjs/common';
import { UserType, WebContentStatus } from '../../../common/constants';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { CmsPageService } from './cms-page.service';

describe('CmsPageService', () => {
  const actor: AccessTokenPayload = {
    sub: 'actor-1',
    schoolId: 'school-1',
    userType: UserType.ADMIN,
  };

  let pages: Record<string, jest.Mock>;
  let service: CmsPageService;

  beforeEach(() => {
    pages = {
      paginate: jest.fn(),
      findById: jest.fn(),
      findBySlug: jest.fn().mockResolvedValue(null),
      takenSlugs: jest.fn().mockResolvedValue(new Set<string>()),
      create: jest
        .fn()
        .mockImplementation((data: object) =>
          Promise.resolve({ id: 'page-new', ...data }),
        ),
      update: jest
        .fn()
        .mockImplementation((id: string, data: object) =>
          Promise.resolve({ id, ...data }),
        ),
      softDelete: jest.fn(),
    };
    service = new CmsPageService(
      pages as never,
      { set: jest.fn() } as never,
      { bust: jest.fn() } as never,
    );
  });

  const base = { title: 'About Us', content: '<p>Hello</p>' };

  it('derives a kebab-case slug from the title', async () => {
    const created = await service.create(base, actor);
    expect(created).toMatchObject({ slug: 'about-us' });
  });

  it('suffixes a derived slug that is already taken', async () => {
    pages.takenSlugs.mockResolvedValue(new Set(['about-us']));
    const created = await service.create(base, actor);
    expect(created).toMatchObject({ slug: 'about-us-2' });
  });

  it('refuses a reserved slug', async () => {
    await expect(
      service.create({ ...base, slug: 'admin' }, actor),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses a slug that is not kebab-case', async () => {
    await expect(
      service.create({ ...base, slug: 'About Us' }, actor),
    ).rejects.toThrow(/kebab-case/);
  });

  it('409s when another live page already holds the slug', async () => {
    pages.findBySlug.mockResolvedValue({ id: 'other' });
    await expect(
      service.create({ ...base, slug: 'about' }, actor),
    ).rejects.toThrow(ConflictException);
  });

  it('lets a page keep its own slug on update', async () => {
    pages.findById.mockResolvedValue({
      id: 'p1',
      slug: 'about',
      title: 'About',
      status: WebContentStatus.DRAFT,
      publishedAt: null,
    });
    pages.findBySlug.mockResolvedValue({ id: 'p1' }); // itself
    await expect(
      service.update('p1', { slug: 'about' }, actor),
    ).resolves.toBeDefined();
  });

  it('asks for an explicit slug when the title has no ASCII to derive from', async () => {
    await expect(
      service.create({ ...base, title: 'শিক্ষক পরিচিতি' }, actor),
    ).rejects.toThrow(/supply one explicitly/);
  });

  it('sanitizes content on write — a script tag never reaches the row', async () => {
    const created = (await service.create(
      { ...base, content: '<p>Hi</p><script>steal()</script>' },
      actor,
    )) as unknown as { content: string };
    expect(created.content).toBe('<p>Hi</p>');
  });

  it('sanitizes the Bangla content too', async () => {
    const created = (await service.create(
      { ...base, contentBn: '<p onclick="x">বাংলা</p>' },
      actor,
    )) as unknown as { contentBn: string };
    expect(created.contentBn).toBe('<p>বাংলা</p>');
  });

  it('derives a meta description from the content when none is given', async () => {
    const created = (await service.create(
      { ...base, content: '<p>Founded in 1972 by the community.</p>' },
      actor,
    )) as unknown as { metaDescription: string };
    expect(created.metaDescription).toBe('Founded in 1972 by the community.');
  });

  it('stamps published_at the first time a page is published', async () => {
    const created = (await service.create(
      { ...base, status: WebContentStatus.PUBLISHED },
      actor,
    )) as unknown as { publishedAt: Date | null };
    expect(created.publishedAt).toBeInstanceOf(Date);
  });

  it('leaves published_at NULL for a draft', async () => {
    const created = (await service.create(base, actor)) as unknown as {
      publishedAt: Date | null;
    };
    expect(created.publishedAt).toBeNull();
  });

  it('keeps the original published_at when a page is re-published', async () => {
    const first = new Date('2026-01-01T00:00:00.000Z');
    pages.findById.mockResolvedValue({
      id: 'p1',
      slug: 'about',
      title: 'About',
      status: WebContentStatus.DRAFT,
      publishedAt: first,
    });
    const updated = (await service.setPublished(
      'p1',
      true,
      actor,
    )) as unknown as { publishedAt: Date };
    expect(updated.publishedAt).toEqual(first);
  });

  it('keeps published_at when a page is unpublished (no feed jump on re-publish)', async () => {
    const first = new Date('2026-01-01T00:00:00.000Z');
    pages.findById.mockResolvedValue({
      id: 'p1',
      slug: 'about',
      title: 'About',
      status: WebContentStatus.PUBLISHED,
      publishedAt: first,
    });
    const updated = (await service.setPublished(
      'p1',
      false,
      actor,
    )) as unknown as { publishedAt: Date; status: WebContentStatus };
    expect(updated.status).toBe(WebContentStatus.DRAFT);
    expect(updated.publishedAt).toEqual(first);
  });
});
