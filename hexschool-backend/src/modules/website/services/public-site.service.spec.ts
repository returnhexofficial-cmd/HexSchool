import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { WebContentStatus } from '../../../common/constants';
import { PublicSiteService } from './public-site.service';

/**
 * The privacy rules of the public API, unit-side. The e2e suite proves
 * the same things over HTTP; these tests pin the branches that are hard
 * to reach there (a disabled site, a rotated setting, a preview token).
 */
describe('PublicSiteService', () => {
  const SCHOOL = 'school-1';

  let pages: Record<string, jest.Mock>;
  let news: Record<string, jest.Mock>;
  let site: Record<string, jest.Mock>;
  let config: { load: jest.Mock };
  let preview: { authorises: jest.Mock };
  let cache: { wrap: jest.Mock };
  let recaptcha: { assertValid: jest.Mock };
  let service: PublicSiteService;

  const defaults = {
    enabled: true,
    siteUrl: 'https://school.edu.bd',
    siteTitle: 'Demo School',
    siteTitleBn: '',
    tagline: '',
    metaDescription: '',
    ogImageUrl: '',
    indexable: true,
    analyticsId: '',
    heroSlides: [],
    quickLinks: [],
    footerText: '',
    social: { facebook: '', youtube: '', linkedin: '', x: '' },
    mapEmbedUrl: '',
    contactEmail: '',
    defaultLanguage: 'en',
    languageToggle: true,
    cacheTtlSeconds: 60,
    newsPageSize: 9,
    teacherDirectoryEnabled: true,
    studentVerificationEnabled: true,
    studentVerificationFields: ['name', 'class', 'status', 'photo'],
    careerCvMaxMb: 5,
  };

  beforeEach(() => {
    pages = { findBySlug: jest.fn(), publishedPages: jest.fn() };
    news = { findBySlug: jest.fn(), publishedFeed: jest.fn() };
    site = {
      verifyStudent: jest.fn(),
      teacherDirectory: jest.fn().mockResolvedValue([]),
    };
    config = { load: jest.fn().mockResolvedValue({ ...defaults }) };
    preview = { authorises: jest.fn().mockReturnValue(false) };
    // Pass-through cache: these tests are about the payload, not Redis.
    cache = {
      wrap: jest.fn((_school, _name, _ttl, compute: () => unknown) =>
        compute(),
      ),
    };
    recaptcha = { assertValid: jest.fn().mockResolvedValue(undefined) };

    service = new PublicSiteService(
      pages as never,
      news as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      site as never,
      {} as never,
      config as never,
      preview as never,
      cache as never,
      recaptcha as never,
    );
  });

  describe('drafts', () => {
    const draft = {
      id: 'page-1',
      slug: 'about',
      title: 'About',
      status: WebContentStatus.DRAFT,
      content: '<p>secret</p>',
    };

    it('404s a draft page for an anonymous visitor', async () => {
      pages.findBySlug.mockResolvedValue(draft);
      await expect(service.page(SCHOOL, 'about', {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns the same 404 for a missing page as for a draft', async () => {
      pages.findBySlug.mockResolvedValue(null);
      const missing = await service
        .page(SCHOOL, 'nope', {})
        .catch((err: Error) => err.message);
      pages.findBySlug.mockResolvedValue(draft);
      const hidden = await service
        .page(SCHOOL, 'about', {})
        .catch((err: Error) => err.message);
      expect(missing).toBe(hidden);
    });

    it('serves a draft when a valid preview token names that exact row', async () => {
      pages.findBySlug.mockResolvedValue(draft);
      preview.authorises.mockImplementation(
        (token: string, type: string, id: string) =>
          token === 'tok' && type === 'page' && id === 'page-1',
      );
      const result = await service.page(SCHOOL, 'about', { preview: 'tok' });
      expect(result.isDraft).toBe(true);
      expect(result.content).toBe('<p>secret</p>');
    });

    it('ignores a preview token minted for a different row', async () => {
      pages.findBySlug.mockResolvedValue(draft);
      preview.authorises.mockImplementation(
        (_token: string, _type: string, id: string) => id === 'other-page',
      );
      await expect(
        service.page(SCHOOL, 'about', { preview: 'tok' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('404s a draft news post the same way', async () => {
      news.findBySlug.mockResolvedValue({
        id: 'n1',
        slug: 'x',
        status: WebContentStatus.DRAFT,
      });
      await expect(service.newsPost(SCHOOL, 'x', {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('site disabled', () => {
    it('403s every public read when website.enabled is false', async () => {
      config.load.mockResolvedValue({ ...defaults, enabled: false });
      await expect(service.home(SCHOOL)).rejects.toThrow(ForbiddenException);
      await expect(service.siteConfig(SCHOOL)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.page(SCHOOL, 'about', {})).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('student verification', () => {
    const found = {
      student: {
        id: 's1',
        studentUid: 'DS-202600001',
        firstName: 'Rafi',
        lastName: 'Ahmed',
        status: 'ACTIVE',
        photoUrl: 'https://cdn/photo.png',
      },
      enrollment: {
        rollNo: 12,
        status: 'ACTIVE',
        class: { name: 'Six' },
        section: { name: 'A' },
        session: { name: '2026', isCurrent: true },
      },
    };

    it('returns only the configured fields', async () => {
      config.load.mockResolvedValue({
        ...defaults,
        studentVerificationFields: ['name', 'status'],
      });
      site.verifyStudent.mockResolvedValue(found);

      const result = await service.verifyStudent(SCHOOL, 'DS-202600001', 'tok');
      expect(result).toEqual({
        verified: true,
        studentUid: 'DS-202600001',
        name: 'Rafi Ahmed',
        status: 'ACTIVE',
      });
      expect(result).not.toHaveProperty('photoUrl');
      expect(result).not.toHaveProperty('class');
    });

    it('never reveals a photo when the setting excludes it', async () => {
      config.load.mockResolvedValue({
        ...defaults,
        studentVerificationFields: ['name'],
      });
      site.verifyStudent.mockResolvedValue(found);
      const result = await service.verifyStudent(SCHOOL, 'x', undefined);
      expect(result).not.toHaveProperty('photoUrl');
    });

    it('404s when the feature is switched off — same message as a miss', async () => {
      site.verifyStudent.mockResolvedValue(null);
      const miss = await service
        .verifyStudent(SCHOOL, 'x', undefined)
        .catch((err: Error) => err.message);

      config.load.mockResolvedValue({
        ...defaults,
        studentVerificationEnabled: false,
      });
      const disabled = await service
        .verifyStudent(SCHOOL, 'x', undefined)
        .catch((err: Error) => err.message);

      expect(miss).toBe(disabled);
      // and the lookup was never even attempted when disabled
      expect(site.verifyStudent).toHaveBeenCalledTimes(1);
    });

    it('verifies the captcha before touching the database', async () => {
      recaptcha.assertValid.mockRejectedValue(new Error('captcha'));
      await expect(service.verifyStudent(SCHOOL, 'x', 'bad')).rejects.toThrow();
      expect(site.verifyStudent).not.toHaveBeenCalled();
    });

    it('omits class details for a student who has never been enrolled', async () => {
      site.verifyStudent.mockResolvedValue({
        student: found.student,
        enrollment: null,
      });
      const result = await service.verifyStudent(SCHOOL, 'x', undefined);
      expect(result).not.toHaveProperty('class');
      expect(result).toHaveProperty('name');
    });
  });

  describe('teacher directory', () => {
    it('returns an empty list when the directory is switched off', async () => {
      config.load.mockResolvedValue({
        ...defaults,
        teacherDirectoryEnabled: false,
      });
      await expect(service.teacherDirectory(SCHOOL)).resolves.toEqual([]);
      expect(site.teacherDirectory).not.toHaveBeenCalled();
    });

    it('exposes no contact details', async () => {
      site.teacherDirectory.mockResolvedValue([
        {
          id: 't1',
          firstName: 'Nasreen',
          lastName: 'Akter',
          designation: 'SENIOR_TEACHER',
          specialization: 'Physics',
          photoUrl: null,
          joiningDate: new Date('2015-01-01'),
          qualifications: [
            { degree: 'MSc', institution: 'DU', passingYear: 2012 },
          ],
          subjects: [{ subject: { name: 'Physics' } }],
        },
      ]);
      const [entry] = await service.teacherDirectory(SCHOOL);
      expect(entry).toEqual({
        id: 't1',
        name: 'Nasreen Akter',
        designation: 'SENIOR_TEACHER',
        specialization: 'Physics',
        photoUrl: null,
        since: new Date('2015-01-01'),
        qualifications: ['MSc, DU (2012)'],
        subjects: ['Physics'],
      });
      expect(JSON.stringify(entry)).not.toMatch(/phone|email|nid/i);
    });
  });

  describe('certificate verification', () => {
    it('describes itself as unavailable until Module 27', () => {
      const result = service.verifyCertificate('TC-26-0001');
      expect(result.available).toBe(false);
      expect(result.code).toBe('TC-26-0001');
      expect(result.reason).toContain('27');
    });
  });
});
