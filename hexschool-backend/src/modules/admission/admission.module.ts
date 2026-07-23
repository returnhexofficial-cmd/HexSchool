import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AcademicModule } from '../academic/academic.module';
import { AcademicSessionsRepository } from '../academic/repositories/academic-sessions.repository';
import { ClassesRepository } from '../academic/repositories/classes.repository';
import { AuthModule } from '../auth/auth.module';
import { CommunicationModule } from '../communication/communication.module';
import { SchoolModule } from '../school/school.module';
import { SchoolsRepository } from '../school/repositories/schools.repository';
import { SequenceModule } from '../sequence/sequence.module';
import { StudentModule } from '../student/student.module';
import { AdmissionApplicationsController } from './controllers/admission-applications.controller';
import { AdmissionCyclesController } from './controllers/admission-cycles.controller';
import { AdmissionPublicController } from './controllers/admission-public.controller';
import { AdmissionReportsController } from './controllers/admission-reports.controller';
import { AdmissionListener } from './events/admission.listener';
import { AdmissionExpiryJob } from './jobs/admission-expiry.job';
import { AdmissionApplicationsRepository } from './repositories/admission-applications.repository';
import { AdmissionCyclesRepository } from './repositories/admission-cycles.repository';
import { AdmissionTestsRepository } from './repositories/admission-tests.repository';
import { AdmissionApplicationsService } from './services/admission-applications.service';
import { AdmissionCyclesService } from './services/admission-cycles.service';
import { AdmissionPublicService } from './services/admission-public.service';
import { AdmissionReportsService } from './services/admission-reports.service';
import { AdmissionTestsService } from './services/admission-tests.service';
import { AdmissionTokenService } from './services/admission-token.service';
import { AdmitCardService } from './services/admit-card.service';
import { MeritListService } from './services/merit-list.service';
import { RecaptchaService } from './services/recaptcha.service';

/**
 * Module 10 — Admission Management: public online applications (OTP
 * phone verification + reCAPTCHA), cycles with per-class seats/fees,
 * offline fee recording (gateway wiring arrives with M16), admission
 * tests + bulk marks, merit/waiting lists with deadline expiry +
 * waitlist promotion, admit-card PDFs, and approval → student
 * conversion through the M09 registration path. Cross-module
 * repositories are stateless re-provisions (M07 convention).
 */
@Module({
  imports: [
    JwtModule.register({}), // phone-verification tokens (per-sign secret)
    CommunicationModule, // M17: applicant status SMS via NotificationService
    AuthModule, // OtpService
    SchoolModule, // SettingsService
    AcademicModule,
    SequenceModule, // application numbers
    StudentModule, // StudentsService (conversion), StudentsRepository
  ],
  controllers: [
    AdmissionCyclesController,
    AdmissionApplicationsController,
    AdmissionPublicController,
    AdmissionReportsController,
  ],
  providers: [
    AdmissionCyclesService,
    AdmissionApplicationsService,
    AdmissionTestsService,
    MeritListService,
    AdmissionPublicService,
    AdmissionReportsService,
    AdmitCardService,
    AdmissionTokenService,
    RecaptchaService,
    AdmissionListener,
    AdmissionExpiryJob,
    AdmissionCyclesRepository,
    AdmissionApplicationsRepository,
    AdmissionTestsRepository,
    // Stateless re-provisions (see class doc).
    SchoolsRepository,
    ClassesRepository,
    AcademicSessionsRepository,
  ],
})
export class AdmissionModule {}
