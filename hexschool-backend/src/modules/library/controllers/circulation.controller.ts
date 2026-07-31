import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import {
  CollectFineDto,
  CreateReservationDto,
  EnrolMemberDto,
  IssueBookDto,
  IssueQueryDto,
  MemberQueryDto,
  RenewIssueDto,
  ReservationQueryDto,
  ReturnBookDto,
  UpdateMemberDto,
  WaiveFineDto,
} from '../dto';
import { CirculationService } from '../services/circulation.service';
import { LibraryFinesService } from '../services/library-fines.service';
import { LibraryMembersService } from '../services/library-members.service';
import { ReservationsService } from '../services/reservations.service';

@ApiTags('library')
@ApiBearerAuth()
@Controller('library')
export class CirculationController {
  constructor(
    private readonly circulation: CirculationService,
    private readonly fines: LibraryFinesService,
    private readonly members: LibraryMembersService,
    private readonly reservations: ReservationsService,
  ) {}

  // ── members ─────────────────────────────────────────────────────────

  @Get('members')
  @RequirePermissions('library.view')
  listMembers(
    @Query() query: MemberQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.paginated(this.members.list(query, user));
  }

  @Get('members/search-people')
  @RequirePermissions('library.view')
  @ApiOperation({
    summary:
      'Find a student/teacher/staff member by name or ID, with the card they already hold',
  })
  searchPeople(@Query('q') q: string, @CurrentUser() user: AccessTokenPayload) {
    return this.members.searchPeople(q ?? '', user.schoolId);
  }

  @Get('members/by-card/:cardNo')
  @RequirePermissions('library.view')
  byCard(
    @Param('cardNo') cardNo: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.members.byCard(cardNo, user.schoolId);
  }

  @Get('members/:id')
  @RequirePermissions('library.view')
  memberDetail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.members.getDetail(id, user.schoolId);
  }

  @Get('members/:id/history')
  @RequirePermissions('library.view')
  memberHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: MemberQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.members.history(id, user.schoolId, query.page, query.limit);
  }

  @Post('members')
  @RequirePermissions('library.member.manage')
  enrol(@Body() dto: EnrolMemberDto, @CurrentUser() user: AccessTokenPayload) {
    return this.members.enrol(dto, user);
  }

  @Patch('members/:id')
  @RequirePermissions('library.member.manage')
  updateMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMemberDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.members.update(id, dto, user);
  }

  // ── the desk ────────────────────────────────────────────────────────

  @Post('issue/preview')
  @RequirePermissions('library.issue')
  @ApiOperation({
    summary:
      'The issue decision without committing it — the desk button reads this verdict',
  })
  previewIssue(
    @Body() dto: IssueBookDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.circulation.previewIssue(dto, user);
  }

  @Post('issue')
  @RequirePermissions('library.issue')
  issue(@Body() dto: IssueBookDto, @CurrentUser() user: AccessTokenPayload) {
    return this.circulation.issue(dto, user);
  }

  @Post('return')
  @RequirePermissions('library.issue')
  @ApiOperation({
    summary: 'Return a copy — assesses the fine and releases or holds the copy',
  })
  returnBook(
    @Body() dto: ReturnBookDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.circulation.return_(dto, user);
  }

  @Post('issues/:id/renew')
  @RequirePermissions('library.issue')
  renew(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenewIssueDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.circulation.renew(id, dto, user);
  }

  @Get('issues')
  @RequirePermissions('library.view')
  listIssues(
    @Query() query: IssueQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.paginated(
      this.circulation.list(
        {
          memberId: query.memberId,
          bookId: query.bookId,
          openOnly: query.openOnly,
          overdueOnly: query.overdueOnly,
          unpaidFineOnly: query.unpaidFineOnly,
          issuedFrom: query.from ? new Date(query.from) : undefined,
          issuedTo: query.to ? new Date(query.to) : undefined,
        },
        user.schoolId,
        query.page,
        query.limit,
      ),
    );
  }

  @Get('issues/:id')
  @RequirePermissions('library.view')
  issueDetail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.circulation.detail(id, user.schoolId);
  }

  // ── fines ───────────────────────────────────────────────────────────

  @Get('fines/outstanding')
  @RequirePermissions('library.view')
  outstandingFines(
    @Query() query: MemberQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.paginated(
      this.fines.outstanding(user.schoolId, query.page, query.limit),
    );
  }

  @Post('fines/:issueId/collect')
  @RequirePermissions('library.fine.collect')
  collect(
    @Param('issueId', ParseUUIDPipe) issueId: string,
    @Body() dto: CollectFineDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.fines.collect(issueId, dto, user);
  }

  @Post('fines/:issueId/waive')
  @RequirePermissions('library.fine.waive')
  @ApiOperation({
    summary:
      'Write a fine off — a separate code from collecting it, deliberately',
  })
  waive(
    @Param('issueId', ParseUUIDPipe) issueId: string,
    @Body() dto: WaiveFineDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.fines.waive(issueId, dto, user);
  }

  // ── reservations ────────────────────────────────────────────────────

  @Get('reservations')
  @RequirePermissions('library.view')
  listReservations(
    @Query() query: ReservationQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.paginated(this.reservations.list(query, user));
  }

  @Post('reservations')
  @RequirePermissions('library.reservation.manage')
  reserve(
    @Body() dto: CreateReservationDto & { memberId: string },
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reservations.create(dto, dto.memberId, user);
  }

  @Delete('reservations/:id')
  @RequirePermissions('library.reservation.manage')
  cancelReservation(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reservations.cancel(id, user);
  }

  private async paginated<T>(
    promise: Promise<{ rows: T[]; total: number; page: number; limit: number }>,
  ) {
    const { rows, total, page, limit } = await promise;
    return {
      data: rows,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }
}
