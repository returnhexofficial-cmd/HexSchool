import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { DEFAULT_SCHOOL_ID } from '../../../common/constants';
import { Public } from '../../../common/decorators/public.decorator';
import { SkipAudit } from '../../audit/decorators/audit.decorator';
import {
  PublicAlumniRegisterDto,
  PublicDirectoryQueryDto,
  PublicTicketDto,
} from '../dto';
import { AlumniEventsService } from '../services/alumni-events.service';
import { AlumniService } from '../services/alumni.service';
import { TicketsService } from '../services/tickets.service';

/** Anonymous writes are the abuse-prone surface; reads are cheap. */
const READ_THROTTLE = { default: { limit: 120, ttl: 60_000 } };
const WRITE_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

/**
 * The unauthenticated surface (roadmap §4's `POST /public/tickets` and
 * `POST /public/alumni/register`, plus the directory §5 asks for).
 *
 * Everything here is `@Public()` and throttled, and like every other
 * public surface in this project it resolves `DEFAULT_SCHOOL_ID` —
 * multi-tenant public routing is an M31 concern (the M10/M15/M16/M19
 * precedent).
 *
 * The complaint form carries the M19 contact-form defences: reCAPTCHA,
 * this route throttle, and a per-IP hourly cap in the service. **The IP
 * cap does not apply to an anonymous submission**, because an IP address
 * is a contact detail and storing one beside a complaint the school
 * promised not to trace would break the promise by a different name.
 * That is the deliberate price of offering the box at all.
 */
@ApiTags('community-public')
@Controller('public')
export class PublicCommunityController {
  constructor(
    private readonly tickets: TicketsService,
    private readonly alumni: AlumniService,
    private readonly events: AlumniEventsService,
  ) {}

  @Post('tickets')
  @Public()
  @SkipAudit()
  @Throttle(WRITE_THROTTLE)
  @ApiOperation({ summary: 'File a complaint, suggestion or feedback' })
  submitTicket(@Body() dto: PublicTicketDto, @Req() req: Request) {
    return this.tickets.submitPublic(DEFAULT_SCHOOL_ID, dto, req.ip);
  }

  @Post('alumni/register')
  @Public()
  @SkipAudit()
  @Throttle(WRITE_THROTTLE)
  @ApiOperation({ summary: 'Register as a former student' })
  registerAlumni(@Body() dto: PublicAlumniRegisterDto, @Req() req: Request) {
    return this.alumni.registerPublic(DEFAULT_SCHOOL_ID, dto, req.ip);
  }

  /**
   * The public directory. Two locks: the repository filters on
   * `is_public_profile` AND APPROVED, and `alumni.engine`'s
   * `publicProfile` decides the shape — which never carries a phone
   * number, an email or an address.
   */
  @Get('alumni')
  @Public()
  @Throttle(READ_THROTTLE)
  @ApiOperation({ summary: 'The alumni directory — opted-in fields only' })
  directory(@Query() query: PublicDirectoryQueryDto) {
    return this.alumni.publicDirectory(DEFAULT_SCHOOL_ID, query);
  }

  @Get('alumni/batches')
  @Public()
  @Throttle(READ_THROTTLE)
  @ApiOperation({ summary: 'Batch years present in the public directory' })
  batches() {
    return this.alumni.publicBatchYears(DEFAULT_SCHOOL_ID);
  }

  @Get('alumni/events')
  @Public()
  @Throttle(READ_THROTTLE)
  @ApiOperation({ summary: 'Published, upcoming alumni events' })
  publicEvents() {
    return this.events.publicList(DEFAULT_SCHOOL_ID);
  }
}
