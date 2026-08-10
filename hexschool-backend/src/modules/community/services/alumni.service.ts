import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Alumni, AlumniStatus } from '@prisma/client';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { RecaptchaService } from '../../admission/services/recaptcha.service';
import {
  batchYearRefusal,
  claimConflictRefusal,
  matchHints,
  publicDirectory,
  type MatchHint,
} from '../calc/alumni.engine';
import {
  AlumniDecisionDto,
  AlumniQueryDto,
  PublicAlumniRegisterDto,
  PublicDirectoryQueryDto,
  UpsertAlumniDto,
} from '../dto';
import { AlumniRepository } from '../repositories/alumni.repository';
import { CommunityDirectoryRepository } from '../repositories/community-directory.repository';
import { CommunityNotificationsService } from './community-notifications.service';
import { CommunitySettingsService } from './community-settings.service';

/**
 * The alumni directory and its approval queue (roadmap M28 §4, §6, §8).
 *
 * **The privacy rule has two locks and both are deliberate.** The public
 * directory query filters on `is_public_profile` and APPROVED in the
 * WHERE clause — the M19 rule that the SELECT list is the policy — and
 * `alumni.engine`'s `publicProfile` decides the shape that leaves the
 * building, which never carries a phone number, an email or an address.
 * The failure mode is a former student's mobile on a public page, and
 * there is no taking that back.
 *
 * **Roadmap §8's conflict queue needs no queue table.** A second person
 * claiming a student record may register and sits PENDING — that IS the
 * queue, and reviewing it is exactly the human judgement the situation
 * needs. What is refused is the *approval*, by this service with a
 * readable message and by `uq_alumni_student` underneath it, so two
 * people can never both be approved as the same person.
 */
@Injectable()
export class AlumniService {
  constructor(
    private readonly alumni: AlumniRepository,
    private readonly directory: CommunityDirectoryRepository,
    private readonly config: CommunitySettingsService,
    private readonly notifications: CommunityNotificationsService,
    private readonly recaptcha: RecaptchaService,
    private readonly audit: AuditContextService,
  ) {}

  // ── reads ───────────────────────────────────────────────────────────

  async list(query: AlumniQueryDto, user: AccessTokenPayload) {
    const { rows, total } = await this.alumni.findMany(
      user.schoolId,
      {
        status: query.status,
        batchYear: query.batchYear,
        search: query.search,
      },
      query.page,
      query.limit,
    );

    // The approval queue's whole job: show the reviewer that this claim
    // collides with one already approved (roadmap §8).
    const claimed = await this.alumni.claimedStudentIds(user.schoolId);
    return {
      data: rows.map((row) => ({
        ...row,
        claimConflict:
          row.status !== AlumniStatus.APPROVED &&
          row.studentId !== null &&
          claimed.has(row.studentId),
      })),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  async get(id: string, user: AccessTokenPayload): Promise<Alumni> {
    const row = await this.alumni.findDetail(id, user.schoolId);
    if (!row) throw new NotFoundException(`Alumni ${id} not found`);
    return row;
  }

  /**
   * Roadmap §4's "match hint against past GRADUATED students". It ranks;
   * it never links. "Md. Rahman, batch 2015" describes several real
   * people at any BD school of size, and the approver is the one who
   * knows which.
   */
  async matchHints(id: string, user: AccessTokenPayload): Promise<MatchHint[]> {
    const row = await this.get(id, user);
    const [graduates, claimed] = await Promise.all([
      this.directory.graduates(user.schoolId),
      this.alumni.claimedStudentIds(user.schoolId),
    ]);

    return matchHints(
      { name: row.name, batchYear: row.batchYear, phone: row.phone },
      graduates,
      claimed,
    );
  }

  /** The public directory. Two locks — the query, then the shape. */
  async publicDirectory(schoolId: string, query: PublicDirectoryQueryDto) {
    const cfg = await this.config.load(schoolId);
    if (!cfg.enabled || !cfg.alumniDirectoryPublic) {
      // The M19 rule: a switched-off feature answers exactly as an empty
      // one does. A public endpoint never confirms that something exists.
      return {
        data: [],
        meta: { page: 1, limit: query.limit, total: 0, totalPages: 1 },
      };
    }

    const { rows, total } = await this.alumni.findMany(
      schoolId,
      { publicOnly: true, batchYear: query.batchYear, search: query.search },
      query.page,
      query.limit,
    );

    return {
      data: publicDirectory(rows),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  async publicBatchYears(schoolId: string) {
    const cfg = await this.config.load(schoolId);
    if (!cfg.enabled || !cfg.alumniDirectoryPublic) return [];
    return this.alumni.batchYears(schoolId, true);
  }

  // ── writes ──────────────────────────────────────────────────────────

  async create(
    dto: UpsertAlumniDto,
    user: AccessTokenPayload,
  ): Promise<Alumni> {
    const cfg = await this.config.load(user.schoolId);
    await this.assertShape(dto, cfg.alumniMinBatchYear, user.schoolId);

    const created = await this.alumni.create({
      schoolId: user.schoolId,
      ...this.body(dto),
      // Entered by the office, so it is approved on arrival: somebody with
      // `alumni.manage` typed it, which is what the queue is for.
      status: AlumniStatus.APPROVED,
      approvedBy: user.sub,
      approvedAt: new Date(),
      createdBy: user.sub,
    });

    this.audit.set({
      entityType: 'Alumni',
      entityId: created.id,
      newValues: { name: created.name, batchYear: created.batchYear },
    });
    return created;
  }

  async update(
    id: string,
    dto: UpsertAlumniDto,
    user: AccessTokenPayload,
  ): Promise<Alumni> {
    const existing = await this.get(id, user);
    const cfg = await this.config.load(user.schoolId);
    await this.assertShape(dto, cfg.alumniMinBatchYear, user.schoolId);

    if (
      dto.studentId &&
      dto.studentId !== existing.studentId &&
      existing.status === AlumniStatus.APPROVED
    ) {
      const claimed = await this.alumni.claimedStudentIds(user.schoolId);
      const refusal = claimConflictRefusal({
        studentId: dto.studentId,
        claimedStudentIds: claimed,
        ownStudentId: existing.studentId,
      });
      if (refusal) throw new ConflictException(refusal);
    }

    const updated = await this.alumni.update(id, {
      ...this.body(dto),
      updatedBy: user.sub,
    });

    this.audit.set({
      entityType: 'Alumni',
      entityId: id,
      oldValues: {
        name: existing.name,
        isPublicProfile: existing.isPublicProfile,
      },
      newValues: {
        name: updated.name,
        isPublicProfile: updated.isPublicProfile,
      },
    });
    return updated;
  }

  /**
   * Roadmap §4's `POST /public/alumni/register` — a former student
   * claiming their place in the directory.
   *
   * It lands PENDING unless a school has explicitly switched
   * `alumni_auto_approve` on, and even then a claim on an already-claimed
   * student record is held back: auto-approving into a conflict is
   * exactly the thing the queue exists to prevent.
   */
  async registerPublic(
    schoolId: string,
    dto: PublicAlumniRegisterDto,
    ip?: string,
  ): Promise<{ message: string; status: AlumniStatus }> {
    const cfg = await this.config.load(schoolId);
    if (!cfg.enabled || !cfg.alumniPublicRegistration) {
      throw new BadRequestException(
        'The school is not accepting alumni registrations at the moment',
      );
    }
    if (!dto.phone && !dto.email) {
      throw new BadRequestException(
        'Leave a phone number or an email address so the school can reach you',
      );
    }

    await this.recaptcha.assertValid(dto.recaptchaToken, ip);

    const yearRefusal = batchYearRefusal(
      dto.batchYear,
      new Date().getUTCFullYear(),
      cfg.alumniMinBatchYear,
    );
    if (yearRefusal) throw new BadRequestException(yearRefusal);

    const created = await this.alumni.create({
      schoolId,
      ...this.body(dto),
      // A self-registration never links itself to a student record. The
      // match is the approver's judgement — see `matchHints`.
      studentId: null,
      status: cfg.alumniAutoApprove
        ? AlumniStatus.APPROVED
        : AlumniStatus.PENDING,
      ...(cfg.alumniAutoApprove ? { approvedAt: new Date() } : {}),
    });

    return {
      message: cfg.alumniAutoApprove
        ? 'Welcome back — your profile is live in the alumni directory.'
        : 'Thank you — the school will review your registration and be in touch.',
      status: created.status,
    };
  }

  async decide(
    id: string,
    dto: AlumniDecisionDto,
    user: AccessTokenPayload,
  ): Promise<Alumni> {
    const existing = await this.get(id, user);
    if (dto.status === AlumniStatus.PENDING) {
      throw new BadRequestException(
        'Approve or reject the registration — it is already pending',
      );
    }
    if (dto.status === AlumniStatus.REJECTED && !dto.reason?.trim()) {
      throw new BadRequestException(
        'Say why the registration was refused — the applicant will ask',
      );
    }

    const studentId = dto.studentId ?? existing.studentId;

    if (dto.status === AlumniStatus.APPROVED && studentId) {
      // Roadmap §8. The engine gives the readable refusal;
      // `uq_alumni_student` is what makes it true no matter what a service
      // forgets.
      const claimed = await this.alumni.claimedStudentIds(user.schoolId);
      const refusal = claimConflictRefusal({
        studentId,
        claimedStudentIds: claimed,
        ownStudentId: existing.studentId,
      });
      if (refusal) throw new ConflictException(refusal);

      const student = await this.directory.student(user.schoolId, studentId);
      if (!student) {
        throw new NotFoundException('That student record is not on file');
      }
    }

    const updated = await this.alumni.update(id, {
      status: dto.status,
      studentId: studentId ?? null,
      ...(dto.status === AlumniStatus.APPROVED
        ? { approvedBy: user.sub, approvedAt: new Date(), rejectedReason: null }
        : { rejectedReason: dto.reason ?? null }),
      updatedBy: user.sub,
    });

    this.audit.set({
      entityType: 'Alumni',
      entityId: id,
      oldValues: { status: existing.status, studentId: existing.studentId },
      newValues: { status: updated.status, studentId: updated.studentId },
    });

    if (dto.status === AlumniStatus.APPROVED) {
      const cfg = await this.config.load(user.schoolId);
      await this.notifications.announceAlumniApproved(updated, cfg);
    }
    return updated;
  }

  async remove(id: string, user: AccessTokenPayload): Promise<void> {
    const existing = await this.get(id, user);
    await this.alumni.softDelete(id);
    this.audit.set({
      entityType: 'Alumni',
      entityId: id,
      oldValues: { name: existing.name, batchYear: existing.batchYear },
    });
  }

  // ── internals ───────────────────────────────────────────────────────

  private body(dto: UpsertAlumniDto | PublicAlumniRegisterDto) {
    return {
      name: dto.name,
      batchYear: dto.batchYear,
      lastClass: dto.lastClass ?? null,
      phone: dto.phone ?? null,
      email: dto.email ?? null,
      address: dto.address ?? null,
      profession: dto.profession ?? null,
      organization: dto.organization ?? null,
      photoUrl: dto.photoUrl ?? null,
      bio: dto.bio ?? null,
      isPublicProfile: dto.isPublicProfile === true,
      ...('studentId' in dto && dto.studentId
        ? { studentId: dto.studentId }
        : {}),
    };
  }

  private async assertShape(
    dto: UpsertAlumniDto,
    minYear: number,
    schoolId: string,
  ): Promise<void> {
    if (!dto.phone && !dto.email) {
      throw new BadRequestException(
        'An alumni profile needs a phone number or an email — a directory entry nobody can reach is one nobody uses',
      );
    }
    // The exact bound lives here, not in the CHECK: a constraint over
    // `CURRENT_DATE` is not IMMUTABLE and would make a January restore
    // reject rows that were legal when they were written.
    const refusal = batchYearRefusal(
      dto.batchYear,
      new Date().getUTCFullYear(),
      minYear,
    );
    if (refusal) throw new BadRequestException(refusal);

    if (dto.studentId) {
      const student = await this.directory.student(schoolId, dto.studentId);
      if (!student) {
        throw new NotFoundException('That student record is not on file');
      }
    }
  }
}
