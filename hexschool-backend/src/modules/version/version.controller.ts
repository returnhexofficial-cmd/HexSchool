import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('version')
@Public() // build metadata is non-sensitive; used by deploy smoke tests
@Controller('version')
export class VersionController {
  constructor(private readonly config: ConfigService) {}

  @Get()
  version(): { sha: string; buildTime: string; env: string } {
    return {
      sha: this.config.getOrThrow<string>('app.buildSha'),
      buildTime: this.config.getOrThrow<string>('app.buildTime'),
      env: this.config.getOrThrow<string>('app.env'),
    };
  }
}
