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
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  LogoutDto,
  RefreshDto,
  ResetPasswordDto,
  VerifyOtpDto,
} from '../dto';
import type { AccessTokenPayload } from '../interfaces/token-payload.interface';
import { AuthService } from '../services/auth.service';
import type { AuthTokens, RequestContext } from '../services/auth.service';

export const REFRESH_COOKIE = 'hs_refresh';

/** 5/min per IP on credential-bearing routes (roadmap M02 §Guards). */
const CREDENTIAL_THROTTLE = { default: { limit: 5, ttl: 60_000 } };
/** Refresh is machine-driven (multi-tab) — stricter than global, looser than 5. */
const REFRESH_THROTTLE = { default: { limit: 30, ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly cookieSecure: boolean;

  constructor(
    private readonly auth: AuthService,
    config: ConfigService,
  ) {
    this.cookieSecure = config.getOrThrow<string>('app.env') === 'production';
  }

  @Public()
  @Throttle(CREDENTIAL_THROTTLE)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email/phone + password' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, tokens } = await this.auth.login(dto, this.ctx(req));
    this.setRefreshCookie(res, tokens);
    return { user, accessToken: tokens.accessToken };
  }

  @Public()
  @Throttle(REFRESH_THROTTLE)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate the refresh token, mint a new access token',
  })
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const presented = this.readRefreshToken(req, dto);
    const { user, tokens } = await this.auth.refresh(presented, this.ctx(req));
    this.setRefreshCookie(res, tokens);
    return { user, accessToken: tokens.accessToken };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout this device (or all devices)' })
  async logout(
    @Body() dto: LogoutDto,
    @CurrentUser() user: AccessTokenPayload,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logout(
      user.sub,
      this.tryReadRefreshToken(req),
      dto,
      this.ctx(req),
    );
    this.clearRefreshCookie(res);
    return { message: 'Logged out' };
  }

  @Public()
  @Throttle(CREDENTIAL_THROTTLE)
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request a password-reset OTP (never reveals account existence)',
  })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.auth.forgotPassword(dto.identifier);
    return {
      message: 'If the account exists, a verification code has been sent',
    };
  }

  @Public()
  @Throttle(CREDENTIAL_THROTTLE)
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify the reset OTP, receive a short-lived reset token',
  })
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyOtp(dto.identifier, dto.code);
  }

  @Public()
  @Throttle(CREDENTIAL_THROTTLE)
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set a new password using the reset token' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto);
    return { message: 'Password updated — please sign in' };
  }

  @Throttle(CREDENTIAL_THROTTLE)
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Change password (authenticated); other sessions are revoked',
  })
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: AccessTokenPayload,
    @Req() req: Request,
  ) {
    await this.auth.changePassword(
      user.sub,
      dto,
      this.tryReadRefreshToken(req),
      this.ctx(req),
    );
    return { message: 'Password changed' };
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Current user profile + permission codes' })
  async me(@CurrentUser() user: AccessTokenPayload) {
    return this.auth.me(user.sub);
  }

  @Get('sessions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List active device sessions' })
  async sessions(@CurrentUser() user: AccessTokenPayload, @Req() req: Request) {
    return this.auth.listSessions(user.sub, this.tryReadRefreshToken(req));
  }

  @Delete('sessions/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke one device session' })
  async revokeSession(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.auth.revokeSession(user.sub, id);
    return { message: 'Session revoked' };
  }

  // ── internals ─────────────────────────────────────────────────────

  private ctx(req: Request): RequestContext {
    return {
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    };
  }

  /**
   * Web clients present the refresh token via the httpOnly cookie;
   * body delivery is reserved for future mobile clients (M02 §APIs).
   */
  private readRefreshToken(req: Request, dto?: RefreshDto): string {
    const token = this.tryReadRefreshToken(req) ?? dto?.refreshToken;
    if (!token) {
      throw new UnauthorizedException('Missing refresh token');
    }
    return token;
  }

  private tryReadRefreshToken(req: Request): string | undefined {
    // cookie-parser types `req.cookies` as any — narrow it explicitly.
    const cookies = (req as unknown as { cookies?: Record<string, unknown> })
      .cookies;
    const token = cookies?.[REFRESH_COOKIE];
    return typeof token === 'string' ? token : undefined;
  }

  private setRefreshCookie(res: Response, tokens: AuthTokens): void {
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
      httpOnly: true,
      secure: this.cookieSecure,
      sameSite: 'lax',
      path: '/api/v1/auth',
      expires: tokens.refreshExpiresAt,
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  }
}
