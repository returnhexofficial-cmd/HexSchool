import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { UserStatus, UserType } from '../../../common/constants';
import { PaginatedResult } from '../../../common/dto/paginated.dto';
import {
  NOTIFICATIONS_QUEUE,
  NotificationJob,
} from '../../../queues/queues.constants';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { RefreshTokensRepository } from '../../auth/repositories/refresh-tokens.repository';
import {
  UsersRepository,
  UserWithAdminRelations,
} from '../../auth/repositories/users.repository';
import { PasswordService } from '../../auth/services/password.service';
import { UpdateUserStatusDto, UsersQueryDto } from '../dto';
import { generateTempPassword } from '../staff.utils';

export interface AdminUserRow {
  id: string;
  email: string | null;
  phone: string | null;
  userType: UserType;
  status: UserStatus;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  roles: Array<{ id: string; name: string; slug: string }>;
  staffProfile: {
    id: string;
    employeeId: string;
    firstName: string;
    lastName: string;
  } | null;
}

/**
 * User administration (roadmap M07 §4): list all account types, status
 * control, admin-initiated password reset. Role assignment stays with the
 * M03 endpoints (/users/:id/roles).
 */
@Injectable()
export class UsersAdminService {
  constructor(
    private readonly users: UsersRepository,
    private readonly refreshTokens: RefreshTokensRepository,
    private readonly passwords: PasswordService,
    private readonly auditContext: AuditContextService,
    @InjectQueue(NOTIFICATIONS_QUEUE)
    private readonly notifications: Queue<NotificationJob>,
  ) {}

  async list(
    query: UsersQueryDto,
    schoolId: string,
  ): Promise<PaginatedResult<AdminUserRow>> {
    const result = await this.users.paginateAdminList(query, schoolId);
    return { data: result.data.map((u) => this.toRow(u)), meta: result.meta };
  }

  /** Activate/deactivate/suspend. Deactivation kills every session
   *  immediately (roadmap M07 §6). */
  async updateStatus(
    userId: string,
    dto: UpdateUserStatusDto,
    actor: AccessTokenPayload,
  ): Promise<void> {
    const user = await this.users.findByIdOrFail(userId, actor.schoolId);
    if (user.id === actor.sub) {
      throw new BadRequestException('You cannot change your own status');
    }
    if (user.status === dto.status) {
      throw new BadRequestException(`User is already ${dto.status}`);
    }
    if (
      user.userType === UserType.SUPER_ADMIN &&
      dto.status !== UserStatus.ACTIVE &&
      (await this.users.countOtherActiveSuperAdmins(user.id)) === 0
    ) {
      throw new ConflictException(
        'Cannot deactivate the last active Super Admin',
      );
    }

    await this.users.update(userId, {
      status: dto.status,
      updatedBy: actor.sub,
    });
    if (dto.status !== UserStatus.ACTIVE) {
      await this.refreshTokens.revokeAllForUser(userId);
    }

    this.auditContext.set({
      entityType: 'User',
      entityId: userId,
      oldValues: { status: user.status },
      newValues: { status: dto.status, reason: dto.reason ?? null },
    });
  }

  /** Admin-initiated reset: temp password (forced change on login), all
   *  sessions revoked, credentials delivered via SMS/email. The temp
   *  password is also returned once so the admin can hand it over. */
  async resetPassword(
    userId: string,
    actor: AccessTokenPayload,
  ): Promise<{ tempPassword: string }> {
    const user = await this.users.findByIdOrFail(userId, actor.schoolId);

    const tempPassword = generateTempPassword();
    await this.users.setTempPassword(
      userId,
      await this.passwords.hash(tempPassword),
    );
    await this.refreshTokens.revokeAllForUser(userId);

    // Delivery is best-effort and deliberately NOT awaited: the admin gets
    // the password in the response either way, and with Redis down an
    // awaited add() blocks forever (BullMQ buffers commands client-side).
    const text = `HexSchool: your password was reset by an administrator. Temporary password: ${tempPassword} — you must change it after signing in.`;
    const job: NotificationJob | null = user.phone
      ? { type: 'sms', to: user.phone, text }
      : user.email
        ? {
            type: 'email',
            to: user.email,
            subject: 'Your HexSchool password was reset',
            text,
          }
        : null;
    if (job) {
      void this.notifications.add(job.type, job).catch(() => undefined);
    }

    this.auditContext.set({
      entityType: 'User',
      entityId: userId,
      newValues: { passwordReset: true },
    });
    return { tempPassword };
  }

  private toRow(user: UserWithAdminRelations): AdminUserRow {
    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      userType: user.userType,
      status: user.status,
      mustChangePassword: user.mustChangePassword,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      roles: user.userRoles.map((ur) => ur.role),
      staffProfile: user.staffProfile,
    };
  }
}
