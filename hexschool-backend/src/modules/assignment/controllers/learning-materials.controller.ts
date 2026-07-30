import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { CreateMaterialDto, MaterialQueryDto, UpdateMaterialDto } from '../dto';
import { AssignmentUploadsService } from '../services/assignment-uploads.service';
import { LearningMaterialsService } from '../services/learning-materials.service';

@ApiTags('learning-materials')
@ApiBearerAuth()
@Controller('learning-materials')
export class LearningMaterialsController {
  constructor(
    private readonly materials: LearningMaterialsService,
    private readonly uploads: AssignmentUploadsService,
  ) {}

  @Get()
  @RequirePermissions('material.view')
  async list(
    @Query() query: MaterialQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    const { rows, total, page, limit } = await this.materials.list(query, user);
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

  @Post('files')
  @RequirePermissions('material.manage')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a note or slide deck; returns the key' })
  uploadFile(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.uploads.upload(file, 'material', user.schoolId);
  }

  @Get(':id')
  @RequirePermissions('material.view')
  detail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.materials.getDetail(id, user.schoolId);
  }

  @Post()
  @RequirePermissions('material.manage')
  create(
    @Body() dto: CreateMaterialDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.materials.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('material.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMaterialDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.materials.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('material.manage')
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.materials.remove(id, user);
  }
}
