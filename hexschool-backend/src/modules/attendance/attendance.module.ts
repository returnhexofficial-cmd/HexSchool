import { Module } from '@nestjs/common';
import { AcademicModule } from '../academic/academic.module';
import { AcademicSessionsRepository } from '../academic/repositories/academic-sessions.repository';
import { SectionsRepository } from '../academic/repositories/sections.repository';
import { ShiftsRepository } from '../academic/repositories/shifts.repository';
import { CommunicationModule } from '../communication/communication.module';
import { EnrollmentModule } from '../enrollment/enrollment.module';
import { RbacModule } from '../rbac/rbac.module';
import { SchoolModule } from '../school/school.module';
import { SchoolsRepository } from '../school/repositories/schools.repository';
import { StorageModule } from '../storage/storage.module';
import { StudentModule } from '../student/student.module';
import { StudentGuardiansRepository } from '../student/repositories/student-guardians.repository';
import { TimetableModule } from '../timetable/timetable.module';
import { AttendanceReportsController } from './controllers/attendance-reports.controller';
import { StaffAttendanceController } from './controllers/staff-attendance.controller';
import { StudentAttendanceController } from './controllers/student-attendance.controller';
import { StudentLeavesController } from './controllers/student-leaves.controller';
import { AttendanceListener } from './events/attendance.listener';
import { AbsentSmsJob } from './jobs/absent-sms.job';
import { AutoAbsentJob } from './jobs/auto-absent.job';
import { EmployeeDirectoryRepository } from './repositories/employee-directory.repository';
import { StaffAttendancesRepository } from './repositories/staff-attendances.repository';
import { StudentAttendancesRepository } from './repositories/student-attendances.repository';
import { StudentLeaveApplicationsRepository } from './repositories/student-leave-applications.repository';
import { AttendanceExportService } from './services/attendance-export.service';
import { AttendanceReportsService } from './services/attendance-reports.service';
import { AttendanceSettingsService } from './services/attendance-settings.service';
import { QrCheckinService } from './services/qr-checkin.service';
import { StaffAttendanceService } from './services/staff-attendance.service';
import { StudentAttendanceService } from './services/student-attendance.service';
import { StudentLeavesService } from './services/student-leaves.service';

/**
 * Module 12 — Attendance Management: daily student attendance per
 * section (manual grid + QR check-in), employee attendance across
 * teachers and staff, student leave applications with retroactive LEAVE
 * correction, the auto-absent and absent-SMS jobs, and the report/export
 * suite. Every student row keys on the M11 `enrollment_id` and every
 * roster comes from the canonical `EnrollmentsService.getSectionStudents`.
 *
 * EnrollmentModule supplies the roster service + repository;
 * AcademicModule the calendar (`isHoliday`, `workingDays`) and sections;
 * StudentModule students/guardians; RbacModule the runtime permission
 * checks behind the holiday and past-edit overrides. The remaining
 * repositories are stateless re-provisions (M07 convention).
 */
@Module({
  imports: [
    AcademicModule,
    EnrollmentModule,
    StudentModule,
    SchoolModule,
    RbacModule,
    StorageModule,
    // M17: NotificationService — the absent-SMS job sends through the
    // single entry point (ABSENT_ALERT template) instead of a raw queue job.
    CommunicationModule,
    // M13: RoutineService.getCurrentPeriod + PeriodSlotsRepository turn
    // period-mode marking on. One-directional — TimetableModule knows
    // nothing about attendance.
    TimetableModule,
  ],
  controllers: [
    StudentAttendanceController,
    StaffAttendanceController,
    StudentLeavesController,
    AttendanceReportsController,
  ],
  providers: [
    StudentAttendanceService,
    StaffAttendanceService,
    QrCheckinService,
    StudentLeavesService,
    AttendanceReportsService,
    AttendanceExportService,
    AttendanceSettingsService,
    AttendanceListener,
    AutoAbsentJob,
    AbsentSmsJob,
    StudentAttendancesRepository,
    StaffAttendancesRepository,
    StudentLeaveApplicationsRepository,
    EmployeeDirectoryRepository,
    // Stateless re-provisions (only need PrismaService).
    AcademicSessionsRepository,
    SectionsRepository,
    ShiftsRepository,
    SchoolsRepository,
    StudentGuardiansRepository,
  ],
  // Exported for M18 dashboards/portals and M21 payroll.
  exports: [
    AttendanceReportsService,
    StudentAttendancesRepository,
    StaffAttendancesRepository,
  ],
})
export class AttendanceModule {}
