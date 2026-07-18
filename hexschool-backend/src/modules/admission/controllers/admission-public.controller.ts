import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
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
  PublicApplyDto,
  PublicPhotoUploadDto,
  RequestOtpDto,
  TrackApplicationQueryDto,
  VerifyAdmissionOtpDto,
} from '../dto';
import { AdmissionPublicService } from '../services/admission-public.service';
import { AdmitCardService } from '../services/admit-card.service';

/** Public endpoints are abuse-prone — throttled like credential routes. */
const OTP_THROTTLE = { default: { limit: 5, ttl: 60_000 } };
const APPLY_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

/**
 * Unauthenticated admission portal API (roadmap M10 §4): reCAPTCHA +
 * OTP phone verification guard the write endpoints; tracking requires
 * application number + phone (both must match — no enumeration).
 */
@ApiTags('admission-public')
@Controller('public/admissions')
export class AdmissionPublicController {
  constructor(
    private readonly service: AdmissionPublicService,
    private readonly admitCards: AdmitCardService,
  ) {}

  @Get('cycles')
  @Public()
  @ApiOperation({ summary: 'Open admission cycles (landing page data)' })
  async cycles() {
    return this.service.openCycles();
  }

  @Post('request-otp')
  @Public()
  @Throttle(OTP_THROTTLE)
  @SkipAudit()
  @ApiOperation({ summary: 'Send a phone-verification OTP (reCAPTCHA)' })
  async requestOtp(@Body() dto: RequestOtpDto, @Req() req: Request) {
    await this.service.requestOtp(dto, req.ip);
    return { message: 'Verification code sent' };
  }

  @Post('verify-otp')
  @Public()
  @Throttle(OTP_THROTTLE)
  @SkipAudit()
  @ApiOperation({
    summary: 'Verify the OTP → 30-min phone verification token',
  })
  async verifyOtp(@Body() dto: VerifyAdmissionOtpDto) {
    return this.service.verifyOtp(dto);
  }

  @Post('photo')
  @Public()
  @Throttle(APPLY_THROTTLE)
  @SkipAudit()
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        verificationToken: { type: 'string' },
      },
    },
  })
  @ApiOperation({ summary: 'Applicant photo upload (≤1 MB jpg/png)' })
  async uploadPhoto(
    @Body() dto: PublicPhotoUploadDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.service.uploadPhoto(dto.verificationToken, file);
  }

  @Post('apply')
  @Public()
  @Throttle(APPLY_THROTTLE)
  @ApiOperation({
    summary:
      'Submit an application (phone token + reCAPTCHA; duplicate/age rules hard-checked)',
  })
  async apply(@Body() dto: PublicApplyDto, @Req() req: Request) {
    return this.service.apply(dto, req.ip);
  }

  @Get('track')
  @Public()
  @Throttle(APPLY_THROTTLE)
  @ApiOperation({ summary: 'Track an application (app no + phone)' })
  async track(@Query() query: TrackApplicationQueryDto) {
    return this.service.track(query.appNo, query.phone);
  }

  @Get('admit-card')
  @Public()
  @Throttle(APPLY_THROTTLE)
  @SkipEnvelope()
  @ApiOperation({ summary: 'Admit card PDF (app no + phone)' })
  async admitCard(
    @Query() query: TrackApplicationQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const pdf = await this.admitCards.generateForApplicant(
      query.appNo,
      query.phone,
      DEFAULT_SCHOOL_ID,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="admit-card-${query.appNo}.pdf"`,
    );
    return new StreamableFile(pdf);
  }
}
