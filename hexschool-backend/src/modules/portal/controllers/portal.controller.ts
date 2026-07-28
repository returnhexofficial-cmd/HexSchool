import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { SkipEnvelope } from '../../../common/decorators/skip-envelope.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { InitOnlinePaymentDto } from '../../fee/dto';
import type { ExportFile } from '../../result/services/result-export.service';
import { OwnsStudent } from '../decorators/portal-scope.decorator';
import { PortalContactDto, PortalLeaveDto } from '../dto';
import { OwnershipGuard } from '../guards/ownership.guard';
import { PortalActionsService } from '../services/portal-actions.service';
import { PortalMessagesService } from '../services/portal-messages.service';
import { PortalResolverService } from '../services/portal-resolver.service';
import { StudentPortalService } from '../services/student-portal.service';
import { TeacherPortalService } from '../services/teacher-portal.service';

/**
 * The portal API (roadmap M18 §4/§5). Every route is **me-scoped**: a
 * student reads only their own record, a parent only a linked child (the
 * `OwnershipGuard` + `assertOwnsStudent` refuse any other id), a teacher
 * only what they teach. There are no `student.view`-style permission gates
 * here — ownership *is* the authorization.
 */
@ApiTags('portal')
@ApiBearerAuth()
@Controller('portal')
@UseGuards(OwnershipGuard)
export class PortalController {
  constructor(
    private readonly resolver: PortalResolverService,
    private readonly studentPortal: StudentPortalService,
    private readonly teacherPortal: TeacherPortalService,
    private readonly actions: PortalActionsService,
    private readonly messages: PortalMessagesService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'Who the portal user is + their children' })
  me(@CurrentUser() user: AccessTokenPayload) {
    return this.resolver.principal(user);
  }

  // ── student (self) ──────────────────────────────────────────────────

  @Get('student/overview')
  async studentOverview(@CurrentUser() user: AccessTokenPayload) {
    const id = await this.selfStudentId(user);
    return this.studentPortal.overview(id, user.schoolId);
  }

  @Get('student/attendance')
  async studentAttendance(@CurrentUser() user: AccessTokenPayload) {
    const id = await this.selfStudentId(user);
    return this.studentPortal.attendance(id, user.schoolId);
  }

  @Get('student/results')
  async studentResults(@CurrentUser() user: AccessTokenPayload) {
    const id = await this.selfStudentId(user);
    return this.studentPortal.results(id, user.schoolId);
  }

  @Get('student/dues')
  async studentDues(@CurrentUser() user: AccessTokenPayload) {
    const id = await this.selfStudentId(user);
    return this.studentPortal.dues(id, user.schoolId);
  }

  @Get('student/routine')
  async studentRoutine(@CurrentUser() user: AccessTokenPayload) {
    const id = await this.selfStudentId(user);
    return this.studentPortal.routineFor(id, user.schoolId);
  }

  @Get('student/profile')
  async studentProfile(@CurrentUser() user: AccessTokenPayload) {
    const id = await this.selfStudentId(user);
    return this.studentPortal.profile(id, user.schoolId);
  }

  @Get('student/documents')
  async studentDocuments(@CurrentUser() user: AccessTokenPayload) {
    const id = await this.selfStudentId(user);
    return this.studentPortal.documents(id, user.schoolId);
  }

  @Get('student/report-card/:examId')
  @SkipEnvelope()
  @ApiOperation({ summary: 'Own report card PDF for a published exam' })
  async studentReportCard(
    @Param('examId', ParseUUIDPipe) examId: string,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const id = await this.selfStudentId(user);
    return stream(
      res,
      await this.studentPortal.reportCard(id, examId, user.schoolId),
    );
  }

  @Post('student/pay')
  @ApiOperation({ summary: 'Pay Now — open a gateway checkout for own dues' })
  async studentPay(
    @Body() dto: InitOnlinePaymentDto,
    @CurrentUser() user: AccessTokenPayload,
    @Req() req: Request,
  ) {
    const id = await this.selfStudentId(user);
    return this.actions.payDues(id, dto, user, this.baseUrl(req));
  }

  // ── parent (per child) ──────────────────────────────────────────────

  @Get('parent/overview')
  @ApiOperation({ summary: 'A card per linked child' })
  async parentOverview(@CurrentUser() user: AccessTokenPayload) {
    const principal = await this.resolver.principal(user);
    const cards = await Promise.all(
      principal.children.map((c) =>
        this.studentPortal.overview(c.studentId, user.schoolId),
      ),
    );
    return { children: cards };
  }

  @Get('parent/child/:childId/overview')
  @OwnsStudent('childId')
  childOverview(
    @Param('childId', ParseUUIDPipe) childId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.studentPortal.overview(childId, user.schoolId);
  }

  @Get('parent/child/:childId/attendance')
  @OwnsStudent('childId')
  childAttendance(
    @Param('childId', ParseUUIDPipe) childId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.studentPortal.attendance(childId, user.schoolId);
  }

  @Get('parent/child/:childId/results')
  @OwnsStudent('childId')
  childResults(
    @Param('childId', ParseUUIDPipe) childId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.studentPortal.results(childId, user.schoolId);
  }

  @Get('parent/child/:childId/dues')
  @OwnsStudent('childId')
  childDues(
    @Param('childId', ParseUUIDPipe) childId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.studentPortal.dues(childId, user.schoolId);
  }

  @Get('parent/child/:childId/routine')
  @OwnsStudent('childId')
  childRoutine(
    @Param('childId', ParseUUIDPipe) childId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.studentPortal.routineFor(childId, user.schoolId);
  }

  @Post('parent/child/:childId/pay')
  @OwnsStudent('childId')
  childPay(
    @Param('childId', ParseUUIDPipe) childId: string,
    @Body() dto: InitOnlinePaymentDto,
    @CurrentUser() user: AccessTokenPayload,
    @Req() req: Request,
  ) {
    return this.actions.payDues(childId, dto, user, this.baseUrl(req));
  }

  @Get('parent/child/:childId/profile')
  @OwnsStudent('childId')
  childProfile(
    @Param('childId', ParseUUIDPipe) childId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.studentPortal.profile(childId, user.schoolId);
  }

  @Get('parent/child/:childId/documents')
  @OwnsStudent('childId')
  childDocuments(
    @Param('childId', ParseUUIDPipe) childId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.studentPortal.documents(childId, user.schoolId);
  }

  @Get('parent/child/:childId/report-card/:examId')
  @OwnsStudent('childId')
  @SkipEnvelope()
  @ApiOperation({ summary: "A child's report card PDF for a published exam" })
  async childReportCard(
    @Param('childId', ParseUUIDPipe) childId: string,
    @Param('examId', ParseUUIDPipe) examId: string,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return stream(
      res,
      await this.studentPortal.reportCard(childId, examId, user.schoolId),
    );
  }

  // ── payment return (student + parent) ───────────────────────────────

  @Get('payment-status')
  @ApiOperation({
    summary: 'What the M16 server-side verify concluded for a checkout',
  })
  async paymentStatus(
    @Query('reference') reference: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    if (!reference) throw new NotFoundException('reference is required');
    const principal = await this.resolver.principal(user);
    return this.actions.paymentStatus(
      principal.children.map((c) => c.studentId),
      reference,
      user.schoolId,
    );
  }

  // ── messages (student + parent) ─────────────────────────────────────

  @Get('messages')
  @ApiOperation({ summary: 'SMS/email the school has sent this account' })
  messageHistory(@CurrentUser() user: AccessTokenPayload) {
    return this.messages.history(user);
  }

  @Post('contact-school')
  @ApiOperation({ summary: 'Write to the office inbox (M28 replaces this)' })
  contactSchool(
    @Body() dto: PortalContactDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.messages.contactSchool(user, dto);
  }

  // ── teacher ─────────────────────────────────────────────────────────

  @Get('teacher/overview')
  async teacherOverview(@CurrentUser() user: AccessTokenPayload) {
    const id = await this.teacherId(user);
    return this.teacherPortal.overview(id, user.schoolId);
  }

  @Get('teacher/routine')
  async teacherRoutine(@CurrentUser() user: AccessTokenPayload) {
    const id = await this.teacherId(user);
    return this.teacherPortal.routineFor(id, user.schoolId);
  }

  @Get('teacher/section/:sectionId/roster')
  async teacherRoster(
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    const id = await this.teacherId(user);
    return this.teacherPortal.sectionRoster(id, sectionId, user.schoolId);
  }

  @Get('teacher/leaves')
  @ApiOperation({ summary: 'My own leave history' })
  async teacherLeaves(@CurrentUser() user: AccessTokenPayload) {
    const id = await this.teacherId(user);
    return this.teacherPortal.myLeaves(id, user.schoolId);
  }

  @Post('teacher/leaves')
  @ApiOperation({ summary: 'Apply for leave (M08 rules still apply)' })
  async teacherApplyLeave(
    @Body() dto: PortalLeaveDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    const id = await this.teacherId(user);
    return this.teacherPortal.applyForLeave(id, dto, user);
  }

  // ── helpers ─────────────────────────────────────────────────────────

  private async selfStudentId(user: AccessTokenPayload): Promise<string> {
    const principal = await this.resolver.principal(user);
    if (!principal.studentId) {
      throw new NotFoundException('No student profile for this account');
    }
    return principal.studentId;
  }

  private async teacherId(user: AccessTokenPayload): Promise<string> {
    const principal = await this.resolver.principal(user);
    if (!principal.teacherId) {
      throw new NotFoundException('No teacher profile for this account');
    }
    return principal.teacherId;
  }

  private baseUrl(req: Request): string {
    return `${req.protocol}://${req.get('host')}/api/v1`;
  }
}

/** Same download contract as the M15 export routes. */
function stream(res: Response, file: ExportFile): StreamableFile {
  res.setHeader('Content-Type', file.contentType);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${file.filename}"`,
  );
  return new StreamableFile(file.buffer);
}
