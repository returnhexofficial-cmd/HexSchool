import { Module } from '@nestjs/common';
import { SchoolModule } from '../school/school.module';
import { CalendarController } from './controllers/calendar.controller';
import { CalendarEventsController } from './controllers/calendar-events.controller';
import { HolidaysController } from './controllers/holidays.controller';
import { SessionsController } from './controllers/sessions.controller';
import { AcademicSessionsRepository } from './repositories/academic-sessions.repository';
import { CalendarEventsRepository } from './repositories/calendar-events.repository';
import { HolidaysRepository } from './repositories/holidays.repository';
import { CalendarService } from './services/calendar.service';
import { CalendarEventsService } from './services/calendar-events.service';
import { HolidaysService } from './services/holidays.service';
import { SessionsService } from './services/sessions.service';

/**
 * Module 05 — Academic Session & Calendar. Hosts the `src/modules/
 * academic` namespace (Module 06 adds classes/sections/subjects here).
 * Exports CalendarService (`isHoliday` for Attendance/Payroll) and
 * SessionsService (current-session resolution for session-scoped
 * modules from M11 on).
 */
@Module({
  imports: [SchoolModule], // SettingsService → weekly holidays
  controllers: [
    SessionsController,
    HolidaysController,
    CalendarEventsController,
    CalendarController,
  ],
  providers: [
    SessionsService,
    HolidaysService,
    CalendarEventsService,
    CalendarService,
    AcademicSessionsRepository,
    HolidaysRepository,
    CalendarEventsRepository,
  ],
  exports: [SessionsService, CalendarService],
})
export class AcademicModule {}
