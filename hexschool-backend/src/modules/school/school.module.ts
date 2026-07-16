import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { GradingSystemsController } from './controllers/grading-systems.controller';
import { SchoolController } from './controllers/school.controller';
import { SettingsController } from './controllers/settings.controller';
import { GradingSystemsRepository } from './repositories/grading-systems.repository';
import { SchoolSettingsRepository } from './repositories/school-settings.repository';
import { SchoolsRepository } from './repositories/schools.repository';
import { GradingSystemsService } from './services/grading-systems.service';
import { SchoolService } from './services/school.service';
import { SettingsCryptoService } from './services/settings-crypto.service';
import { SettingsService } from './services/settings.service';
import { SettingsTestService } from './services/settings-test.service';

/**
 * Module 04 — School Setup & Settings. Exports SettingsService: the
 * generic, cached, encrypted key-value config consumed via DI by every
 * later module (attendance rules, gateway creds, exam defaults, …).
 */
@Module({
  imports: [StorageModule],
  controllers: [SchoolController, SettingsController, GradingSystemsController],
  providers: [
    SchoolService,
    SettingsService,
    SettingsCryptoService,
    SettingsTestService,
    GradingSystemsService,
    SchoolsRepository,
    SchoolSettingsRepository,
    GradingSystemsRepository,
  ],
  exports: [SettingsService],
})
export class SchoolModule {}
