import { Module } from '@nestjs/common';
import { QueuesModule } from '../../queues/queues.module';
import { AcademicModule } from '../academic/academic.module';
import { ClassesRepository } from '../academic/repositories/classes.repository';
import { AuthModule } from '../auth/auth.module';
import { RefreshTokensRepository } from '../auth/repositories/refresh-tokens.repository';
import { UsersRepository } from '../auth/repositories/users.repository';
import { RbacModule } from '../rbac/rbac.module';
import { RolesRepository } from '../rbac/repositories/roles.repository';
import { UserRolesRepository } from '../rbac/repositories/user-roles.repository';
import { SchoolModule } from '../school/school.module';
import { SchoolsRepository } from '../school/repositories/schools.repository';
import { SequenceModule } from '../sequence/sequence.module';
import { GuardiansController } from './controllers/guardians.controller';
import { StudentsController } from './controllers/students.controller';
import { StudentListener } from './events/student.listener';
import { GuardiansRepository } from './repositories/guardians.repository';
import { StudentDocumentsRepository } from './repositories/student-documents.repository';
import { StudentGuardiansRepository } from './repositories/student-guardians.repository';
import { StudentMedicalRepository } from './repositories/student-medical.repository';
import { StudentStatusHistoryRepository } from './repositories/student-status-history.repository';
import { StudentsRepository } from './repositories/students.repository';
import { GuardiansService } from './services/guardians.service';
import { IdCardService } from './services/id-card.service';
import { StudentAccountsService } from './services/student-accounts.service';
import { StudentDocumentsService } from './services/student-documents.service';
import { StudentImportService } from './services/student-import.service';
import { StudentsService } from './services/students.service';

/**
 * Module 09 — Student & Guardian Management: the student master record
 * (permanent UID via SequenceService, warn-only duplicate detection,
 * status lifecycle + portal cascade), shared guardians (phone-deduped,
 * one primary per student), permission-gated medical records, documents,
 * lazy portal accounts, CR80 ID-card PDFs (rotatable QR), and XLSX bulk
 * import. Cross-module repositories are stateless re-provisions (M07
 * convention). Section-scoped rosters (batch ID cards per section,
 * enrollment) arrive with M11.
 */
@Module({
  imports: [
    AuthModule, // PasswordService
    RbacModule,
    SchoolModule, // SettingsService (UID pattern)
    AcademicModule,
    SequenceModule,
    QueuesModule, // notifications queue (portal credentials)
  ],
  controllers: [StudentsController, GuardiansController],
  providers: [
    StudentsService,
    GuardiansService,
    StudentAccountsService,
    StudentDocumentsService,
    IdCardService,
    StudentImportService,
    StudentListener,
    StudentsRepository,
    GuardiansRepository,
    StudentGuardiansRepository,
    StudentMedicalRepository,
    StudentDocumentsRepository,
    StudentStatusHistoryRepository,
    // Stateless re-provisions (see class doc).
    UsersRepository,
    RefreshTokensRepository,
    RolesRepository,
    UserRolesRepository,
    SchoolsRepository,
    ClassesRepository,
  ],
  exports: [StudentsRepository, GuardiansRepository],
})
export class StudentModule {}
