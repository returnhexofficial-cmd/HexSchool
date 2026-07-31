import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { UserType } from '../../../common/constants';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { SkipEnvelope } from '../../../common/decorators/skip-envelope.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import {
  PortalAssignmentQueryDto,
  SubmitAssignmentDto,
} from '../../assignment/dto';
import { AssignmentUploadsService } from '../../assignment/services/assignment-uploads.service';
import { StudentAssignmentsService } from '../../assignment/services/student-assignments.service';
import { InitOnlinePaymentDto } from '../../fee/dto';
import { CreateReservationDto, OpacQueryDto } from '../../library/dto';
import { OpacService } from '../../library/services/opac.service';
import type { ExportFile } from '../../result/services/result-export.service';
import { TransportPortalService } from '../../transport/services/transport-portal.service';
import { OwnsStudent } from '../decorators/portal-scope.decorator';
import { PortalContactDto, PortalLeaveDto } from '../dto';
import { OwnershipGuard } from '../guards/ownership.guard';
import { PortalActionsService } from '../services/portal-actions.service';
import { PortalMessagesService } from '../services/portal-messages.service';
import { PortalResolverService } from '../services/portal-resolver.service';
import { EmployeePortalService } from '../services/employee-portal.service';
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
    private readonly employeePortal: EmployeePortalService,
    private readonly assignments: StudentAssignmentsService,
    private readonly uploads: AssignmentUploadsService,
    private readonly opac: OpacService,
    private readonly transport: TransportPortalService,
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

  // ── assignments & homework (M22) ────────────────────────────────────
  //
  // The roadmap's own paths. Ownership is resolved here and the
  // assignment rules live in AssignmentModule — this controller never
  // decides what a student may see, only which student is asking.

  @Get('assignments')
  @ApiOperation({ summary: 'My assignments — pending, submitted, evaluated' })
  async studentAssignments(
    @Query() query: PortalAssignmentQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    const id = await this.selfStudentId(user);
    return this.assignments.list(id, user.schoolId, query);
  }

  @Get('assignments/:id')
  @ApiOperation({ summary: 'One assignment, with my submission on it' })
  async studentAssignment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    const studentId = await this.selfStudentId(user);
    return this.assignments.detail(studentId, user.schoolId, id);
  }

  @Post('assignments/:id/submit')
  @ApiOperation({ summary: 'Hand work in (students only — never a parent)' })
  async submitAssignment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitAssignmentDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    const studentId = await this.selfStudentId(user);
    return this.assignments.submit(studentId, id, dto, user, {
      isStudentSelf: user.userType === UserType.STUDENT,
    });
  }

  @Post('assignments/attachments')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a file to attach to a submission' })
  async uploadSubmissionFile(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    // Resolving the student first is what stops a parent (or any other
    // account) using the portal as an open upload endpoint.
    await this.selfStudentId(user);
    return this.uploads.upload(file, 'submission', user.schoolId);
  }

  @Get('materials')
  @ApiOperation({ summary: 'My class notes and slides, filterable by subject' })
  async studentMaterials(
    @Query('subjectId') subjectId: string | undefined,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    const id = await this.selfStudentId(user);
    return this.assignments.materialsFor(id, user.schoolId, { subjectId });
  }

  @Get('parent/child/:childId/assignments')
  @OwnsStudent('childId')
  @ApiOperation({ summary: "A child's pending / late assignment overview" })
  childAssignments(
    @Param('childId', ParseUUIDPipe) childId: string,
    @Query() query: PortalAssignmentQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.assignments.list(childId, user.schoolId, query);
  }

  @Get('parent/child/:childId/materials')
  @OwnsStudent('childId')
  childMaterials(
    @Param('childId', ParseUUIDPipe) childId: string,
    @Query('subjectId') subjectId: string | undefined,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.assignments.materialsFor(childId, user.schoolId, { subjectId });
  }

  // ── library / OPAC (M23) ────────────────────────────────────────────
  //
  // Same split as the assignments block above: LibraryModule decides
  // what a member may see and whether they may still reserve, this
  // controller answers only "whose card is this?".
  //
  // Note what these routes do NOT resolve through `selfStudentId`: a
  // library card belongs to a *person*, and a teacher or an office
  // assistant borrows books too. The card is resolved from the logged-in
  // user id, so the same three routes serve every kind of reader.

  @Get('library/catalogue')
  @ApiOperation({ summary: 'Search the catalogue, with an availability badge' })
  opacSearch(
    @Query() query: OpacQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.opac.search(query, user.schoolId);
  }

  @Get('library/me')
  @ApiOperation({
    summary: 'My loans, holds and fines — empty rather than 404 with no card',
  })
  myLibrary(@CurrentUser() user: AccessTokenPayload) {
    return this.opac.myLibrary(user.schoolId, user.sub);
  }

  @Post('library/reservations')
  @ApiOperation({ summary: 'Place a hold on a title I cannot borrow today' })
  reserve(
    @Body() dto: CreateReservationDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.opac.reserve(dto, user);
  }

  @Delete('library/reservations/:id')
  @ApiOperation({ summary: 'Cancel my own hold — anybody else’s 404s' })
  cancelReservation(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.opac.cancelReservation(id, user);
  }

  @Get('parent/child/:childId/library')
  @OwnsStudent('childId')
  @ApiOperation({
    summary: "A child's library loans — read-only, the card is theirs",
  })
  childLibrary(
    @Param('childId', ParseUUIDPipe) childId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.opac.childLibrary(user.schoolId, childId);
  }

  // ── transport (M25) ─────────────────────────────────────────────────
  //
  // Roadmap M25 §5's "parent portal shows child's route/stop/times". The
  // projection is deliberately thin — the stop, the two times and a
  // number to ring — and a student who does not ride gets a
  // self-describing `{ assigned: false, reason }` rather than an empty
  // card (the M09/M19 stub shape).

  @Get('transport')
  @ApiOperation({ summary: 'My bus route, stop and times' })
  async myTransport(@CurrentUser() user: AccessTokenPayload) {
    const id = await this.selfStudentId(user);
    return this.transport.forStudent(user.schoolId, id);
  }

  @Get('parent/child/:childId/transport')
  @OwnsStudent('childId')
  @ApiOperation({ summary: "A child's bus route, stop and times" })
  childTransport(
    @Param('childId', ParseUUIDPipe) childId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.transport.forStudent(user.schoolId, childId);
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
  @ApiOperation({ summary: 'Apply for leave (every M21 rule still applies)' })
  async teacherApplyLeave(
    @Body() dto: PortalLeaveDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    const id = await this.teacherId(user);
    return this.teacherPortal.applyForLeave(id, dto, user);
  }

  // ── employee self-service (M21 §5) ──────────────────────────────────
  //
  // Authorized by ownership like every other portal route: the person is
  // resolved from the logged-in user, never from a parameter, so there is
  // no id to tamper with and no permission code to grant. That matters
  // more here than anywhere else in the portal — a payslip is the most
  // sensitive per-person document the system holds.

  @Get('employee/me')
  @ApiOperation({ summary: 'The employee record behind this account' })
  async employeeMe(@CurrentUser() user: AccessTokenPayload) {
    return this.employeePortal.me(user);
  }

  @Get('employee/leave-balances')
  @ApiOperation({ summary: 'My remaining leave entitlement, per type' })
  async employeeLeaveBalances(@CurrentUser() user: AccessTokenPayload) {
    return this.employeePortal.myBalances(user);
  }

  @Get('employee/leaves')
  @ApiOperation({ summary: 'My leave applications (teacher or staff)' })
  async employeeLeaves(@CurrentUser() user: AccessTokenPayload) {
    return this.employeePortal.myLeaves(user);
  }

  @Post('employee/leaves')
  @ApiOperation({ summary: 'Apply for leave from the portal' })
  async employeeApplyLeave(
    @Body() dto: PortalLeaveDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.employeePortal.applyForLeave(dto, user);
  }

  @Get('employee/payslips')
  @ApiOperation({ summary: 'My payslip history (disbursed months only)' })
  async employeePayslips(@CurrentUser() user: AccessTokenPayload) {
    return this.employeePortal.myPayslips(user);
  }

  @Get('employee/payslips/:id/pdf')
  @SkipEnvelope()
  @ApiOperation({ summary: 'My own payslip as a PDF' })
  async employeePayslipPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.employeePortal.myPayslipPdf(id, user);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.filename}"`,
    );
    return new StreamableFile(file.buffer);
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
