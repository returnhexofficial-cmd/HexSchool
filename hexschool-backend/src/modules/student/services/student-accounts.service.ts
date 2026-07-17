import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UserType } from '../../../common/constants';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { UsersRepository } from '../../auth/repositories/users.repository';
import { PasswordService } from '../../auth/services/password.service';
import { RolesRepository } from '../../rbac/repositories/roles.repository';
import { UserRolesRepository } from '../../rbac/repositories/user-roles.repository';
import { generateTempPassword } from '../../staff/staff.utils';
import { CreatePortalAccountDto } from '../dto';
import { STUDENT_EVENTS } from '../events/student.events';
import type { PortalAccountCreatedEvent } from '../events/student.events';
import { GuardiansRepository } from '../repositories/guardians.repository';
import { StudentsRepository } from '../repositories/students.repository';

export interface AccountCreatedResult {
  userId: string;
  phone: string | null;
  email: string | null;
  /** Handed to the admin (M07 convention) AND queued via SMS/email. */
  tempPassword: string;
}

/**
 * Lazy portal provisioning (roadmap M09 §4): students/guardians exist
 * without accounts until someone needs portal access. Contact uniqueness
 * is checked PER user type (M09 §8 — a guardian may share their phone
 * with their own staff account, but not with another parent account).
 */
@Injectable()
export class StudentAccountsService {
  constructor(
    private readonly students: StudentsRepository,
    private readonly guardians: GuardiansRepository,
    private readonly users: UsersRepository,
    private readonly roles: RolesRepository,
    private readonly userRoles: UserRolesRepository,
    private readonly passwords: PasswordService,
    private readonly auditContext: AuditContextService,
    private readonly events: EventEmitter2,
  ) {}

  async createStudentAccount(
    studentId: string,
    dto: CreatePortalAccountDto,
    actor: AccessTokenPayload,
  ): Promise<AccountCreatedResult> {
    const student = await this.students.findByIdOrFail(
      studentId,
      actor.schoolId,
    );
    if (student.userId) {
      throw new ConflictException('Student already has a portal account');
    }
    const contact = this.normalizeContact(dto);
    await this.assertContactFree(contact, UserType.STUDENT, actor.schoolId);

    const tempPassword = generateTempPassword();
    const passwordHash = await this.passwords.hash(tempPassword);
    const role = await this.roles.findBySlug(actor.schoolId, 'student');

    const userId = await this.students.withTransaction(async (tx) => {
      const user = await this.users.create(
        {
          schoolId: actor.schoolId,
          email: contact.email ?? null,
          phone: contact.phone ?? null,
          passwordHash,
          userType: UserType.STUDENT,
          mustChangePassword: true,
          createdBy: actor.sub,
          updatedBy: actor.sub,
        },
        tx,
      );
      if (role) await this.userRoles.assignRole(user.id, role.id, tx);
      await this.students.update(
        studentId,
        { userId: user.id, updatedBy: actor.sub },
        tx,
      );
      return user.id;
    });

    this.events.emit(STUDENT_EVENTS.ACCOUNT_CREATED, {
      userId,
      schoolId: actor.schoolId,
      holder: 'student',
      name: `${student.firstName} ${student.lastName}`,
      phone: contact.phone ?? null,
      email: contact.email ?? null,
      tempPassword,
    } satisfies PortalAccountCreatedEvent);

    this.auditContext.set({
      entityType: 'Student',
      entityId: studentId,
      newValues: {
        portalAccount: 'created',
        phone: contact.phone ?? null,
        email: contact.email ?? null,
      },
    });

    return {
      userId,
      phone: contact.phone ?? null,
      email: contact.email ?? null,
      tempPassword,
    };
  }

  async createGuardianAccount(
    guardianId: string,
    dto: CreatePortalAccountDto,
    actor: AccessTokenPayload,
  ): Promise<AccountCreatedResult> {
    const guardian = await this.guardians.findByIdOrFail(
      guardianId,
      actor.schoolId,
    );
    if (guardian.userId) {
      throw new ConflictException('Guardian already has a portal account');
    }
    // Default to the guardian's stored phone (phone-based login, M09 §4).
    const contact = this.normalizeContact({
      phone: dto.phone ?? guardian.phone,
      email: dto.email ?? guardian.email ?? undefined,
    });
    await this.assertContactFree(contact, UserType.PARENT, actor.schoolId);

    const tempPassword = generateTempPassword();
    const passwordHash = await this.passwords.hash(tempPassword);
    const role = await this.roles.findBySlug(actor.schoolId, 'parent');

    const userId = await this.guardians.withTransaction(async (tx) => {
      const user = await this.users.create(
        {
          schoolId: actor.schoolId,
          email: contact.email ?? null,
          phone: contact.phone ?? null,
          passwordHash,
          userType: UserType.PARENT,
          mustChangePassword: true,
          createdBy: actor.sub,
          updatedBy: actor.sub,
        },
        tx,
      );
      if (role) await this.userRoles.assignRole(user.id, role.id, tx);
      await this.guardians.update(
        guardianId,
        { userId: user.id, updatedBy: actor.sub },
        tx,
      );
      return user.id;
    });

    this.events.emit(STUDENT_EVENTS.GUARDIAN_ACCOUNT_CREATED, {
      userId,
      schoolId: actor.schoolId,
      holder: 'guardian',
      name: guardian.name,
      phone: contact.phone ?? null,
      email: contact.email ?? null,
      tempPassword,
    } satisfies PortalAccountCreatedEvent);

    this.auditContext.set({
      entityType: 'Guardian',
      entityId: guardianId,
      newValues: {
        portalAccount: 'created',
        phone: contact.phone ?? null,
        email: contact.email ?? null,
      },
    });

    return {
      userId,
      phone: contact.phone ?? null,
      email: contact.email ?? null,
      tempPassword,
    };
  }

  private normalizeContact(dto: CreatePortalAccountDto): {
    email?: string;
    phone?: string;
  } {
    const contact = {
      ...(dto.email ? { email: dto.email.trim().toLowerCase() } : {}),
      ...(dto.phone ? { phone: dto.phone.trim() } : {}),
    };
    if (!contact.email && !contact.phone) {
      throw new BadRequestException('Provide a phone number or an email');
    }
    return contact;
  }

  /** Per-type availability: (school, user_type, contact) is the unique. */
  private async assertContactFree(
    contact: { email?: string; phone?: string },
    userType: UserType,
    schoolId: string,
  ): Promise<void> {
    if (contact.email) {
      const holder = await this.users.findOne(
        { email: contact.email, userType },
        schoolId,
      );
      if (holder) {
        throw new ConflictException(
          `A ${userType.toLowerCase()} account with email ${contact.email} already exists`,
        );
      }
    }
    if (contact.phone) {
      const holder = await this.users.findOne(
        { phone: contact.phone, userType },
        schoolId,
      );
      if (holder) {
        throw new ConflictException(
          `A ${userType.toLowerCase()} account with phone ${contact.phone} already exists`,
        );
      }
    }
  }
}
