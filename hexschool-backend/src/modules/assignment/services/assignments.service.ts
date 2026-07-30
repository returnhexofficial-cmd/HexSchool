import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AssignmentStatus, AssignmentType, Prisma } from '@prisma/client';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { EnrollmentsService } from '../../enrollment/services/enrollments.service';
import { sanitizeHtml } from '../../website/calc/html-sanitize.util';
import { attachmentSetIssues } from '../calc/attachment.util';
import {
  summarizeAssignment,
  type StatSubmission,
} from '../calc/assignment-stats.engine';
import type {
  AttachmentDto,
  CreateAssignmentDto,
  UpdateAssignmentDto,
} from '../dto';
import { AssignmentQueryDto } from '../dto';
import {
  AssignmentsRepository,
  type AssignmentWithRelations,
} from '../repositories/assignments.repository';
import { SubmissionsRepository } from '../repositories/submissions.repository';
import { AssignmentNotificationsService } from './assignment-notifications.service';
import { AssignmentPolicyService } from './assignment-policy.service';
import { AssignmentSettingsService } from './assignment-settings.service';

@Injectable()
export class AssignmentsService {
  constructor(
    private readonly assignments: AssignmentsRepository,
    private readonly submissions: SubmissionsRepository,
    private readonly policy: AssignmentPolicyService,
    private readonly config: AssignmentSettingsService,
    private readonly enrollments: EnrollmentsService,
    private readonly notifications: AssignmentNotificationsService,
    private readonly audit: AuditContextService,
  ) {}

  // ── reads ───────────────────────────────────────────────────────────

  async list(query: AssignmentQueryDto, actor: AccessTokenPayload) {
    const resolved = await this.policy.resolveActor(actor);
    const { page, limit } = query;

    // A teacher without `assignment.all` sees their own work plus every
    // section-subject they currently hold — the live roster again, so a
    // teacher who inherits 8B sees the homework already set for it.
    let sectionIds: string[] | undefined;
    let teacherId = query.teacherId;
    if (!resolved.seesAll) {
      if (!resolved.teacherId) {
        return { rows: [], total: 0, page, limit };
      }
      if (query.mine) {
        teacherId = resolved.teacherId;
      } else {
        const slots = await this.policy.slotsFor(
          resolved.teacherId,
          actor.schoolId,
          query.sessionId,
        );
        sectionIds = [...new Set(slots.map((s) => s.sectionId))];
        if (query.sectionId && !sectionIds.includes(query.sectionId)) {
          return { rows: [], total: 0, page, limit };
        }
      }
    } else if (query.mine) {
      teacherId = resolved.teacherId ?? query.teacherId;
    }

    const { rows, total } = await this.assignments.findMany(
      actor.schoolId,
      {
        sessionId: query.sessionId,
        sectionId: query.sectionId,
        sectionIds: query.sectionId ? undefined : sectionIds,
        subjectId: query.subjectId,
        teacherId,
        type: query.type,
        status: query.status,
        search: query.search,
      },
      page,
      limit,
    );

    return { rows, total, page, limit };
  }

  async getDetail(id: string, actor: AccessTokenPayload) {
    const assignment = await this.findOrFail(id, actor.schoolId);
    await this.policy.assertMayTouch(actor, assignment);
    return assignment;
  }

  /** Roadmap §4 — per-assignment submission %, feeding the portals too. */
  async stats(id: string, actor: AccessTokenPayload) {
    const assignment = await this.findOrFail(id, actor.schoolId);
    await this.policy.assertMayTouch(actor, assignment);
    return this.statsFor(assignment);
  }

  async statsFor(assignment: AssignmentWithRelations) {
    const [roster, submissions] = await Promise.all([
      this.enrollments.getSectionStudents(
        assignment.sectionId,
        assignment.schoolId,
      ),
      this.submissions.findForAssignment(assignment.id, assignment.schoolId),
    ]);

    const stats: StatSubmission[] = submissions.map((s) => ({
      enrollmentId: s.enrollmentId,
      status: s.status,
      isLate: s.isLate,
      marks: s.marks === null ? null : Number(s.marks),
    }));

    return summarizeAssignment(
      roster.map((e) => e.id),
      stats,
    );
  }

  // ── writes ──────────────────────────────────────────────────────────

  async create(dto: CreateAssignmentDto, actor: AccessTokenPayload) {
    const cfg = await this.config.load(actor.schoolId);
    this.assertEnabled(cfg.enabled);

    const teacherId = await this.policy.assertMayActOn(
      actor,
      {
        sessionId: dto.sessionId,
        sectionId: dto.sectionId,
        subjectId: dto.subjectId,
      },
      dto.teacherId,
    );

    const assignedAt = dto.assignedAt ? new Date(dto.assignedAt) : new Date();
    const dueAt = new Date(dto.dueAt);
    this.assertWindow(assignedAt, dueAt);
    const attachments = this.validateAttachments(dto.attachments, cfg);

    const created = await this.assignments.create({
      schoolId: actor.schoolId,
      sessionId: dto.sessionId,
      sectionId: dto.sectionId,
      subjectId: dto.subjectId,
      teacherId,
      type: dto.type ?? AssignmentType.ASSIGNMENT,
      title: dto.title.trim(),
      instructions: sanitizeHtml(dto.instructions) || null,
      attachmentUrls: attachments as unknown as Prisma.InputJsonValue,
      assignedAt,
      dueAt,
      fullMarks: dto.fullMarks ?? null,
      allowLate: dto.allowLate ?? cfg.allowLateDefault,
      status: AssignmentStatus.DRAFT,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'Assignment',
      entityId: created.id,
      newValues: { title: created.title, status: created.status },
    });

    return this.findOrFail(created.id, actor.schoolId);
  }

  async update(
    id: string,
    dto: UpdateAssignmentDto,
    actor: AccessTokenPayload,
  ) {
    const cfg = await this.config.load(actor.schoolId);
    const existing = await this.findOrFail(id, actor.schoolId);
    await this.policy.assertMayTouch(actor, existing);

    if (existing.status === AssignmentStatus.CLOSED) {
      throw new ConflictException(
        'A closed assignment cannot be edited — reopen it first',
      );
    }

    const assignedAt = dto.assignedAt
      ? new Date(dto.assignedAt)
      : existing.assignedAt;
    const dueAt = dto.dueAt ? new Date(dto.dueAt) : existing.dueAt;
    this.assertWindow(assignedAt, dueAt);

    // Marks that have already been given must not be left dangling above
    // a lowered ceiling — the report would print 18/15 and nobody would
    // be able to say which figure was wrong.
    if (dto.fullMarks !== undefined && dto.fullMarks !== null) {
      const over = await this.submissions.findForAssignment(id, actor.schoolId);
      const worst = over
        .filter((s) => s.marks !== null)
        .map((s) => Number(s.marks))
        .reduce((max, m) => Math.max(max, m), 0);
      if (worst > dto.fullMarks) {
        throw new ConflictException(
          `A submission is already marked ${worst} — full marks cannot be lowered to ${dto.fullMarks}`,
        );
      }
    }

    const attachments =
      dto.attachments === undefined
        ? undefined
        : this.validateAttachments(dto.attachments, cfg);

    await this.assignments.update(id, {
      ...(dto.type ? { type: dto.type } : {}),
      ...(dto.title ? { title: dto.title.trim() } : {}),
      ...(dto.instructions !== undefined
        ? { instructions: sanitizeHtml(dto.instructions) || null }
        : {}),
      ...(attachments
        ? { attachmentUrls: attachments as unknown as Prisma.InputJsonValue }
        : {}),
      ...(dto.assignedAt ? { assignedAt } : {}),
      ...(dto.dueAt ? { dueAt } : {}),
      ...(dto.fullMarks !== undefined ? { fullMarks: dto.fullMarks } : {}),
      ...(dto.allowLate !== undefined ? { allowLate: dto.allowLate } : {}),
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'Assignment',
      entityId: id,
      oldValues: {
        title: existing.title,
        dueAt: existing.dueAt,
        fullMarks: existing.fullMarks,
      },
      newValues: {
        title: dto.title,
        dueAt: dto.dueAt,
        fullMarks: dto.fullMarks,
      },
    });

    return this.findOrFail(id, actor.schoolId);
  }

  async publish(id: string, actor: AccessTokenPayload) {
    const cfg = await this.config.load(actor.schoolId);
    const existing = await this.findOrFail(id, actor.schoolId);
    await this.policy.assertMayTouch(actor, existing);

    if (existing.status !== AssignmentStatus.DRAFT) {
      throw new ConflictException(
        `Only a draft can be published (this one is ${existing.status})`,
      );
    }
    // Publishing work that is already overdue tells a class nothing it
    // can act on, and it would immediately trip the zero-submission
    // nudge. Move the date first.
    if (existing.dueAt.getTime() <= Date.now()) {
      throw new ConflictException(
        'The due date has already passed — move it before publishing',
      );
    }

    await this.assignments.update(id, {
      status: AssignmentStatus.PUBLISHED,
      publishedAt: new Date(),
      updatedBy: actor.sub,
    });

    const published = await this.findOrFail(id, actor.schoolId);

    // Fire-and-forget, the M07 credential rule: a school's SMS gateway
    // being down must not make "publish" fail and leave the teacher
    // unable to tell whether the work went out.
    if (cfg.publishNotification) {
      await this.notifications.announcePublished(published, cfg);
    }

    this.audit.set({
      entityType: 'Assignment',
      entityId: id,
      oldValues: { status: existing.status },
      newValues: { status: AssignmentStatus.PUBLISHED },
    });

    return published;
  }

  async close(id: string, actor: AccessTokenPayload) {
    const existing = await this.findOrFail(id, actor.schoolId);
    await this.policy.assertMayTouch(actor, existing);

    if (existing.status !== AssignmentStatus.PUBLISHED) {
      throw new ConflictException(
        `Only a published assignment can be closed (this one is ${existing.status})`,
      );
    }

    await this.assignments.update(id, {
      status: AssignmentStatus.CLOSED,
      closedAt: new Date(),
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'Assignment',
      entityId: id,
      oldValues: { status: existing.status },
      newValues: { status: AssignmentStatus.CLOSED },
    });

    return this.findOrFail(id, actor.schoolId);
  }

  /**
   * CLOSED → PUBLISHED. The M14 status-machine rule: a mis-click needs
   * undoing, and closing an assignment is not the irreversible act
   * publishing a result is. `closed_at` is cleared because the column
   * means "when this was closed", and leaving a stale value would make
   * the audit trail read as though it were still shut.
   */
  async reopen(id: string, actor: AccessTokenPayload) {
    const existing = await this.findOrFail(id, actor.schoolId);
    await this.policy.assertMayTouch(actor, existing);

    if (existing.status !== AssignmentStatus.CLOSED) {
      throw new ConflictException(
        `Only a closed assignment can be reopened (this one is ${existing.status})`,
      );
    }

    await this.assignments.update(id, {
      status: AssignmentStatus.PUBLISHED,
      closedAt: null,
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'Assignment',
      entityId: id,
      oldValues: { status: AssignmentStatus.CLOSED },
      newValues: { status: AssignmentStatus.PUBLISHED },
    });

    return this.findOrFail(id, actor.schoolId);
  }

  async remove(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.findOrFail(id, actor.schoolId);
    await this.policy.assertMayTouch(actor, existing);

    // The FK cascades, so a delete would take real student work with it.
    // The school's route is to close the assignment, not to erase what a
    // class handed in (the M14/M15 "blocked once marks exist" guard).
    const submissions = await this.assignments.countSubmissions(id);
    if (submissions > 0) {
      throw new ConflictException(
        `${submissions} student${submissions === 1 ? ' has' : 's have'} already submitted — close the assignment instead of deleting it`,
      );
    }

    await this.assignments.softDelete(id);
    this.audit.set({
      entityType: 'Assignment',
      entityId: id,
      oldValues: { title: existing.title, status: existing.status },
    });
  }

  // ── helpers ─────────────────────────────────────────────────────────

  async findOrFail(
    id: string,
    schoolId: string,
  ): Promise<AssignmentWithRelations> {
    const found = await this.assignments.findDetail(id, schoolId);
    if (!found) throw new NotFoundException(`Assignment ${id} not found`);
    return found;
  }

  private assertEnabled(enabled: boolean): void {
    if (!enabled) {
      throw new ConflictException(
        'Assignments are switched off for this school (assignment.enabled)',
      );
    }
  }

  private assertWindow(assignedAt: Date, dueAt: Date): void {
    if (Number.isNaN(assignedAt.getTime()) || Number.isNaN(dueAt.getTime())) {
      throw new BadRequestException('assignedAt and dueAt must be valid dates');
    }
    if (dueAt.getTime() <= assignedAt.getTime()) {
      throw new BadRequestException(
        'The due date must be after the date the work is set',
      );
    }
  }

  private validateAttachments(
    attachments: AttachmentDto[] | undefined,
    cfg: { limits: Parameters<typeof attachmentSetIssues>[1] },
  ): AttachmentDto[] {
    const files = attachments ?? [];
    const issues = attachmentSetIssues(files, cfg.limits);
    if (issues.length > 0) {
      throw new BadRequestException({
        message: 'Some attachments were refused',
        details: { issues },
      });
    }
    return files;
  }
}
