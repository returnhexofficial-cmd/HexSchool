import { Module } from '@nestjs/common';
import { AcademicModule } from '../academic/academic.module';
import { CommunicationModule } from '../communication/communication.module';
import { NoticesRepository } from '../communication/repositories/notices.repository';
import { EnrollmentModule } from '../enrollment/enrollment.module';
import { FeeModule } from '../fee/fee.module';
import { RbacModule } from '../rbac/rbac.module';
import { ResultModule } from '../result/result.module';
import { SchoolModule } from '../school/school.module';
import { SchoolsRepository } from '../school/repositories/schools.repository';
import { StudentModule } from '../student/student.module';
import { TimetableModule } from '../timetable/timetable.module';
import { DashboardController } from './controllers/dashboard.controller';
import { PortalController } from './controllers/portal.controller';
import { ReportsController } from './controllers/reports.controller';
import { OwnershipGuard } from './guards/ownership.guard';
import { DashboardRepository } from './repositories/dashboard.repository';
import { DashboardService } from './services/dashboard.service';
import { PortalActionsService } from './services/portal-actions.service';
import { PortalResolverService } from './services/portal-resolver.service';
import { ReportsService } from './services/reports.service';
import { StudentPortalService } from './services/student-portal.service';
import { TeacherPortalService } from './services/teacher-portal.service';

/**
 * Module 18 — Portals & Dashboards + Reports v1 (Phase 1 capstone). A
 * pure **aggregator**: it imports the feature modules and composes their
 * already-scoped, exported services into role experiences (student /
 * parent / teacher portals), the admin + accountant dashboards, and the
 * reports catalog. It owns no business tables — dashboards are cached in
 * Redis (best-effort), and every portal read is gated by `OwnershipGuard`
 * + `PortalResolverService` rather than a permission code.
 *
 * PortalModule is a leaf (nothing imports it), so importing this many
 * modules is cycle-free. The two stateless repositories it needs directly
 * (`NoticesRepository`, `SchoolsRepository`) are re-provisions, the
 * established M07/M16 convention.
 */
@Module({
  imports: [
    AcademicModule,
    EnrollmentModule,
    TimetableModule,
    StudentModule,
    FeeModule,
    ResultModule,
    CommunicationModule,
    RbacModule,
    SchoolModule,
  ],
  controllers: [PortalController, DashboardController, ReportsController],
  providers: [
    PortalResolverService,
    StudentPortalService,
    TeacherPortalService,
    DashboardService,
    DashboardRepository,
    ReportsService,
    PortalActionsService,
    OwnershipGuard,
    // Stateless re-provisions (only need PrismaService).
    NoticesRepository,
    SchoolsRepository,
  ],
})
export class PortalModule {}
