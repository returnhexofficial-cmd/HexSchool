import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { NewsCategory } from '../../../common/constants';
import {
  ContactMessageQueryDto,
  CreateCareerDto,
  CreateCmsPageDto,
  CreateCommitteeMemberDto,
  CreateDownloadDto,
  CreateFaqDto,
  CreateGalleryDto,
  CreateNewsPostDto,
  PreviewTokenDto,
  PublishDto,
  UpdateCareerApplicationDto,
  UpdateCareerDto,
  UpdateCmsPageDto,
  UpdateCommitteeMemberDto,
  UpdateContactMessageStatusDto,
  UpdateDownloadDto,
  UpdateFaqDto,
  UpdateGalleryDto,
  UpdateNewsPostDto,
} from '../dto';
import { CareerService } from '../services/career.service';
import { CmsPageService } from '../services/cms-page.service';
import { ContactService } from '../services/contact.service';
import { DownloadService } from '../services/download.service';
import { GalleryService } from '../services/gallery.service';
import { NewsService } from '../services/news.service';
import { PreviewTokenService } from '../services/preview-token.service';
import { SiteContentService } from '../services/site-content.service';

/**
 * The Website CMS admin API (roadmap M19 §4 "CRUD for all entities,
 * admin-guarded"). One controller per content type would be nine files of
 * five identical routes; they are grouped here by resource path instead,
 * each carrying its own permission code.
 */
@ApiTags('website-cms')
@ApiBearerAuth()
@Controller('cms')
export class CmsController {
  constructor(
    private readonly pages: CmsPageService,
    private readonly news: NewsService,
    private readonly galleries: GalleryService,
    private readonly downloads: DownloadService,
    private readonly careers: CareerService,
    private readonly content: SiteContentService,
    private readonly contact: ContactService,
    private readonly preview: PreviewTokenService,
  ) {}

  // ── pages ───────────────────────────────────────────────────────────

  @Get('pages')
  @RequirePermissions('website.view')
  listPages(
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.pages.list(user.schoolId, query);
  }

  @Get('pages/:id')
  @RequirePermissions('website.view')
  getPage(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.pages.get(id, user.schoolId);
  }

  @Post('pages')
  @RequirePermissions('website.page.manage')
  createPage(
    @Body() dto: CreateCmsPageDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.pages.create(dto, user);
  }

  @Put('pages/:id')
  @RequirePermissions('website.page.manage')
  updatePage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCmsPageDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.pages.update(id, dto, user);
  }

  @Put('pages/:id/publish')
  @RequirePermissions('website.page.manage')
  publishPage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PublishDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.pages.setPublished(id, dto.publish, user);
  }

  @Delete('pages/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('website.page.manage')
  async removePage(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.pages.remove(id, user);
  }

  // ── news ────────────────────────────────────────────────────────────

  @Get('news')
  @RequirePermissions('website.view')
  listNews(
    @Query() query: PaginationQueryDto,
    @Query('category') category: NewsCategory | undefined,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.news.list(user.schoolId, query, category);
  }

  @Get('news/:id')
  @RequirePermissions('website.view')
  getNews(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.news.get(id, user.schoolId);
  }

  @Post('news')
  @RequirePermissions('website.news.manage')
  createNews(
    @Body() dto: CreateNewsPostDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.news.create(dto, user);
  }

  @Put('news/:id')
  @RequirePermissions('website.news.manage')
  updateNews(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNewsPostDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.news.update(id, dto, user);
  }

  @Put('news/:id/publish')
  @RequirePermissions('website.news.manage')
  publishNews(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PublishDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.news.setPublished(id, dto.publish, user);
  }

  @Delete('news/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('website.news.manage')
  async removeNews(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.news.remove(id, user);
  }

  // ── galleries ───────────────────────────────────────────────────────

  @Get('galleries')
  @RequirePermissions('website.view')
  listGalleries(
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.galleries.list(user.schoolId, query);
  }

  @Get('galleries/:id')
  @RequirePermissions('website.view')
  getGallery(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.galleries.get(id, user.schoolId);
  }

  @Post('galleries')
  @RequirePermissions('website.gallery.manage')
  createGallery(
    @Body() dto: CreateGalleryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.galleries.create(dto, user);
  }

  @Put('galleries/:id')
  @RequirePermissions('website.gallery.manage')
  updateGallery(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGalleryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.galleries.update(id, dto, user);
  }

  @Put('galleries/:id/publish')
  @RequirePermissions('website.gallery.manage')
  publishGallery(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PublishDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.galleries.setPublished(id, dto.publish, user);
  }

  @Delete('galleries/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('website.gallery.manage')
  async removeGallery(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.galleries.remove(id, user);
  }

  // ── downloads ───────────────────────────────────────────────────────

  @Get('downloads')
  @RequirePermissions('website.view')
  listDownloads(
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.downloads.list(user.schoolId, query);
  }

  @Post('downloads/upload')
  @RequirePermissions('website.download.manage')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: 'Upload a file, then create the download row' })
  uploadDownload(@UploadedFile() file: Express.Multer.File | undefined) {
    return this.downloads.upload(file);
  }

  @Post('downloads')
  @RequirePermissions('website.download.manage')
  createDownload(
    @Body() dto: CreateDownloadDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.downloads.create(dto, user);
  }

  @Put('downloads/:id')
  @RequirePermissions('website.download.manage')
  updateDownload(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDownloadDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.downloads.update(id, dto, user);
  }

  @Delete('downloads/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('website.download.manage')
  async removeDownload(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.downloads.remove(id, user);
  }

  // ── careers ─────────────────────────────────────────────────────────

  @Get('careers')
  @RequirePermissions('website.view')
  listCareers(
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.careers.list(user.schoolId, query);
  }

  @Post('careers')
  @RequirePermissions('website.career.manage')
  createCareer(
    @Body() dto: CreateCareerDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.careers.create(dto, user);
  }

  @Put('careers/:id')
  @RequirePermissions('website.career.manage')
  updateCareer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCareerDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.careers.update(id, dto, user);
  }

  @Delete('careers/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('website.career.manage')
  async removeCareer(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.careers.remove(id, user);
  }

  @Get('careers/:id/applications')
  @RequirePermissions('website.career.manage')
  listApplications(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.careers.listApplications(user.schoolId, id, query);
  }

  @Put('career-applications/:id')
  @RequirePermissions('website.career.manage')
  updateApplication(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCareerApplicationDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.careers.updateApplication(id, dto, user);
  }

  // ── FAQs ────────────────────────────────────────────────────────────

  @Get('faqs')
  @RequirePermissions('website.view')
  listFaqs(
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.content.listFaqs(user.schoolId, query);
  }

  @Post('faqs')
  @RequirePermissions('website.faq.manage')
  createFaq(
    @Body() dto: CreateFaqDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.content.createFaq(dto, user);
  }

  @Put('faqs/:id')
  @RequirePermissions('website.faq.manage')
  updateFaq(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFaqDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.content.updateFaq(id, dto, user);
  }

  @Delete('faqs/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('website.faq.manage')
  async removeFaq(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.content.removeFaq(id, user);
  }

  // ── committee ───────────────────────────────────────────────────────

  @Get('committee')
  @RequirePermissions('website.view')
  listCommittee(
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.content.listCommittee(user.schoolId, query);
  }

  @Post('committee')
  @RequirePermissions('website.committee.manage')
  createMember(
    @Body() dto: CreateCommitteeMemberDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.content.createMember(dto, user);
  }

  @Put('committee/:id')
  @RequirePermissions('website.committee.manage')
  updateMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCommitteeMemberDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.content.updateMember(id, dto, user);
  }

  @Delete('committee/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('website.committee.manage')
  async removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.content.removeMember(id, user);
  }

  // ── contact inbox ───────────────────────────────────────────────────

  @Get('contact-messages')
  @RequirePermissions('website.message.view')
  listMessages(
    @Query() query: ContactMessageQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.contact.list(user.schoolId, query);
  }

  @Get('contact-messages/:id')
  @RequirePermissions('website.message.view')
  getMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.contact.get(id, user.schoolId);
  }

  @Put('contact-messages/:id/status')
  @RequirePermissions('website.message.manage')
  setMessageStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContactMessageStatusDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.contact.setStatus(id, dto, user);
  }

  @Delete('contact-messages/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('website.message.manage')
  async removeMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.contact.remove(id, user);
  }

  // ── draft preview ───────────────────────────────────────────────────

  @Post('preview-token')
  @RequirePermissions('website.view')
  @ApiOperation({
    summary: 'Mint a 30-minute signed link that reveals one draft row',
  })
  previewToken(@Body() dto: PreviewTokenDto) {
    // Signing is synchronous — the token holds no DB row (see the service).
    return { token: this.preview.sign(dto.type, dto.id), expiresIn: '30m' };
  }
}
