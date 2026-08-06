import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { DEFAULT_SCHOOL_ID } from '../../../common/constants';
import { Public } from '../../../common/decorators/public.decorator';
import { SkipEnvelope } from '../../../common/decorators/skip-envelope.decorator';
import { SkipAudit } from '../../audit/decorators/audit.decorator';
import {
  PreviewQueryDto,
  PublicCareerApplyDto,
  PublicContactDto,
  PublicFeedQueryDto,
  PublicVerifyStudentDto,
} from '../dto';
import { CareerService } from '../services/career.service';
import { ContactService } from '../services/contact.service';
import { PublicSiteService } from '../services/public-site.service';
import { SitemapService } from '../services/sitemap.service';

/** Public reads are cached; the writes are the abuse-prone surface. */
const READ_THROTTLE = { default: { limit: 120, ttl: 60_000 } };
const WRITE_THROTTLE = { default: { limit: 5, ttl: 60_000 } };
/** Roadmap §6: verification is heavily rate-limited to prevent scraping. */
const VERIFY_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

/**
 * The unauthenticated website API (roadmap M19 §4). Everything here is
 * `@Public()`, throttled, and — for reads — served from the module's
 * Redis cache. Like every other public surface in this project it
 * resolves `DEFAULT_SCHOOL_ID`; multi-tenant public routing is an M31
 * concern (the M10/M15/M16 precedent).
 */
@ApiTags('website-public')
@Controller('public')
export class PublicSiteController {
  constructor(
    private readonly site: PublicSiteService,
    private readonly contact: ContactService,
    private readonly careers: CareerService,
    private readonly feeds: SitemapService,
  ) {}

  // ── chrome & landing ────────────────────────────────────────────────

  @Get('config')
  @Public()
  @Throttle(READ_THROTTLE)
  @ApiOperation({ summary: 'Site identity, navigation, socials, features' })
  config() {
    return this.site.siteConfig(DEFAULT_SCHOOL_ID);
  }

  @Get('home')
  @Public()
  @Throttle(READ_THROTTLE)
  @ApiOperation({ summary: 'Home page payload (hero, notices, news, stats)' })
  home() {
    return this.site.home(DEFAULT_SCHOOL_ID);
  }

  // ── content ─────────────────────────────────────────────────────────

  @Get('pages/:slug')
  @Public()
  @Throttle(READ_THROTTLE)
  @ApiOperation({
    summary: 'A published CMS page (or a token-previewed draft)',
  })
  page(@Param('slug') slug: string, @Query() query: PreviewQueryDto) {
    return this.site.page(DEFAULT_SCHOOL_ID, slug, query);
  }

  @Get('news')
  @Public()
  @Throttle(READ_THROTTLE)
  news(@Query() query: PublicFeedQueryDto) {
    return this.site.newsFeed(DEFAULT_SCHOOL_ID, query);
  }

  @Get('news/:slug')
  @Public()
  @Throttle(READ_THROTTLE)
  newsPost(@Param('slug') slug: string, @Query() query: PreviewQueryDto) {
    return this.site.newsPost(DEFAULT_SCHOOL_ID, slug, query);
  }

  @Get('notices')
  @Public()
  @Throttle(READ_THROTTLE)
  notices(@Query() query: PublicFeedQueryDto) {
    return this.site.notices(DEFAULT_SCHOOL_ID, query);
  }

  @Get('notices/:id')
  @Public()
  @Throttle(READ_THROTTLE)
  notice(@Param('id', ParseUUIDPipe) id: string) {
    return this.site.notice(DEFAULT_SCHOOL_ID, id);
  }

  @Get('events')
  @Public()
  @Throttle(READ_THROTTLE)
  @ApiOperation({ summary: 'Public calendar events (is_public only)' })
  events() {
    return this.site.events(DEFAULT_SCHOOL_ID);
  }

  @Get('galleries')
  @Public()
  @Throttle(READ_THROTTLE)
  galleries() {
    return this.site.galleryList(DEFAULT_SCHOOL_ID);
  }

  @Get('galleries/:id')
  @Public()
  @Throttle(READ_THROTTLE)
  gallery(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PublicFeedQueryDto,
  ) {
    return this.site.gallery(DEFAULT_SCHOOL_ID, id, query);
  }

  @Get('downloads')
  @Public()
  @Throttle(READ_THROTTLE)
  downloads() {
    return this.site.downloadList(DEFAULT_SCHOOL_ID);
  }

  @Post('downloads/:id/hit')
  @Public()
  @Throttle(READ_THROTTLE)
  @SkipAudit() // a click is not an administrative act
  @ApiOperation({ summary: 'Count a download and return its file URL' })
  downloadHit(@Param('id', ParseUUIDPipe) id: string) {
    return this.site.registerDownloadHit(DEFAULT_SCHOOL_ID, id);
  }

  @Get('faqs')
  @Public()
  @Throttle(READ_THROTTLE)
  faqs() {
    return this.site.faqList(DEFAULT_SCHOOL_ID);
  }

  @Get('committee')
  @Public()
  @Throttle(READ_THROTTLE)
  committee() {
    return this.site.committeeList(DEFAULT_SCHOOL_ID);
  }

  @Get('teachers')
  @Public()
  @Throttle(READ_THROTTLE)
  @ApiOperation({
    summary: 'Teacher & staff directory (no phone/email — roadmap §6)',
  })
  teachers() {
    return this.site.teacherDirectory(DEFAULT_SCHOOL_ID);
  }

  @Get('careers')
  @Public()
  @Throttle(READ_THROTTLE)
  careersList() {
    return this.site.careerList(DEFAULT_SCHOOL_ID);
  }

  // ── public writes ───────────────────────────────────────────────────

  @Post('contact')
  @Public()
  @Throttle(WRITE_THROTTLE)
  @SkipAudit()
  @ApiOperation({ summary: 'Contact form (reCAPTCHA + per-IP hourly cap)' })
  submitContact(@Body() dto: PublicContactDto, @Req() req: Request) {
    return this.contact.submit(DEFAULT_SCHOOL_ID, dto, req.ip);
  }

  @Post('careers/:id/apply')
  @Public()
  @Throttle(WRITE_THROTTLE)
  @SkipAudit()
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        name: { type: 'string' },
        phone: { type: 'string' },
        email: { type: 'string' },
        note: { type: 'string' },
      },
    },
  })
  @ApiOperation({ summary: 'Apply to a job opening (CV PDF)' })
  applyToCareer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PublicCareerApplyDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.careers.apply(DEFAULT_SCHOOL_ID, id, dto, file);
  }

  // ── verification ────────────────────────────────────────────────────

  @Post('verify/student')
  @Public()
  @Throttle(VERIFY_THROTTLE)
  @SkipAudit()
  @ApiOperation({
    summary: 'Verify a student by UID or QR token (privacy-limited fields)',
  })
  verifyStudent(@Body() dto: PublicVerifyStudentDto, @Req() req: Request) {
    return this.site.verifyStudent(
      DEFAULT_SCHOOL_ID,
      dto.identifier,
      dto.recaptchaToken,
      req.ip,
    );
  }

  @Get('verify/certificate')
  @Public()
  @Throttle(VERIFY_THROTTLE)
  @ApiOperation({
    summary: 'Verify a certificate by its printed code (VALID/REVOKED)',
  })
  verifyCertificate(@Query('code') code: string) {
    return this.site.verifyCertificate(code ?? '');
  }

  // ── crawler artifacts ───────────────────────────────────────────────

  @Get('sitemap.xml')
  @Public()
  @SkipEnvelope()
  @Throttle(READ_THROTTLE)
  async sitemapXml(@Res({ passthrough: true }) res: Response) {
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    return this.feeds.sitemap(DEFAULT_SCHOOL_ID);
  }

  @Get('sitemap-urls')
  @Public()
  @Throttle(READ_THROTTLE)
  @ApiOperation({
    summary: 'Path list the frontend renders as its own sitemap.xml',
  })
  sitemapUrls() {
    return this.feeds.sitemapUrls(DEFAULT_SCHOOL_ID);
  }

  @Get('robots.txt')
  @Public()
  @SkipEnvelope()
  @Throttle(READ_THROTTLE)
  async robotsTxt(@Res({ passthrough: true }) res: Response) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return this.feeds.robots(DEFAULT_SCHOOL_ID);
  }

  @Get('rss.xml')
  @Public()
  @SkipEnvelope()
  @Throttle(READ_THROTTLE)
  async rssXml(@Res({ passthrough: true }) res: Response) {
    res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
    return this.feeds.rss(DEFAULT_SCHOOL_ID);
  }
}
