import { Module } from '@nestjs/common';
import { AcademicModule } from '../academic/academic.module';
import { AssignmentModule } from '../assignment/assignment.module';
import { LibraryModule } from '../library/library.module';
import { CommunicationModule } from '../communication/communication.module';
import { NoticesRepository } from '../communication/repositories/notices.repository';
import { NotificationsRepository } from '../communication/repositories/notifications.repository';
import { EnrollmentModule } from '../enrollment/enrollment.module';
import { FeeModule } from '../fee/fee.module';
import { HrModule } from '../hr/hr.module';
import { RbacModule } from '../rbac/rbac.module';
import { ResultModule } from '../result/result.module';
import { SchoolModule } from '../school/school.module';
import { SchoolsRepository } from '../school/repositories/schools.repository';
import { StudentModule } from '../student/student.module';
import { TeacherModule } from '../teacher/teacher.module';
import { TimetableModule } from '../timetable/timetable.module';
import { WebsiteModule } from '../website/website.module';
import { DashboardController } from './controllers/dashboard.controller';
import { PortalController } from './controllers/portal.controller';
import { ReportsController } from './controllers/reports.controller';
import { OwnershipGuard } from './guards/ownership.guard';
import { DashboardRepository } from './repositories/dashboard.repository';
import { DashboardService } from './services/dashboard.service';
import { PortalActionsService } from './services/portal-actions.service';
import { PortalMessagesService } from './services/portal-messages.service';
import { PortalResolverService } from './services/portal-resolver.service';
import { ReportsService } from './services/reports.service';
import { EmployeePortalService } from './services/employee-portal.service';
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
 * modules is cycle-free. The three stateless repositories it needs directly
 * (`NoticesRepository`, `NotificationsRepository`, `SchoolsRepository`) are
 * re-provisions, the established M07/M16 convention.
 *
 * `WebsiteModule` is imported for one thing: the portal "Contact School"
 * form files into the M19 office inbox rather than a second one, and
 * `HrModule` (M21) for the employee self-service panels.
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
    TeacherModule,
    WebsiteModule,
    // M21 — the employee self-service panels (my leave, my payslips) and
    // the teacher portal's leave list, which now reads the unified HR
    // table rather than M08's retired `teacher_leaves`.
    HrModule,
    // M22 — the student/parent assignment panels. The composition split
    // is the usual one: AssignmentModule decides what a candidate may see
    // and whether they may still submit; PortalModule answers only "which
    // student is this account?" through `PortalResolverService`.
    AssignmentModule,
    // M23 — the OPAC and "my loans" panels. Same shape as the M22 edge:
    // LibraryModule decides what a member may see and do, PortalModule
    // resolves whose card is asking. A library card belongs to a person
    // rather than to a student, so these routes serve teachers and staff
    // through the same service.
    LibraryModule,
  ],
  controllers: [PortalController, DashboardController, ReportsController],
  providers: [
    PortalResolverService,
    StudentPortalService,
    TeacherPortalService,
    EmployeePortalService,
    PortalMessagesService,
    DashboardService,
    DashboardRepository,
    ReportsService,
    PortalActionsService,
    OwnershipGuard,
    // Stateless re-provisions (only need PrismaService).
    NoticesRepository,
    NotificationsRepository,
    SchoolsRepository,
  ],
})
export class PortalModule {}
