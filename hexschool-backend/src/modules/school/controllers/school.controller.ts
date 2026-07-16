import {
  Body,
  Controller,
  Get,
  Post,
  Put,
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
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { UpdateSchoolDto } from '../dto';
import { SchoolService } from '../services/school.service';

@ApiTags('school')
@ApiBearerAuth()
@Controller('school')
export class SchoolController {
  constructor(private readonly school: SchoolService) {}

  /** Identity data every signed-in user needs (headers, portals) — auth-only. */
  @Get()
  @ApiOperation({ summary: 'School profile (+ signed logo URL)' })
  async get(@CurrentUser() user: AccessTokenPayload) {
    const school = await this.school.get(user.schoolId);
    return { ...school, logoUrl: await this.school.logoSignedUrl(school) };
  }

  @Put()
  @RequirePermissions('school.update')
  @ApiOperation({ summary: 'Update the school profile' })
  async update(
    @Body() dto: UpdateSchoolDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    const school = await this.school.update(dto, user);
    return { ...school, logoUrl: await this.school.logoSignedUrl(school) };
  }

  @Post('logo')
  @RequirePermissions('school.update')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: 'Upload the school logo (≤2 MB, resized to 512px)' })
  async uploadLogo(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    const school = await this.school.uploadLogo(file, user);
    return { ...school, logoUrl: await this.school.logoSignedUrl(school) };
  }
}
