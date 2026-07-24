import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { InitOnlinePaymentDto } from '../../fee/dto';
import { OwnsStudent } from '../decorators/portal-scope.decorator';
import { OwnershipGuard } from '../guards/ownership.guard';
import { PortalActionsService } from '../services/portal-actions.service';
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
