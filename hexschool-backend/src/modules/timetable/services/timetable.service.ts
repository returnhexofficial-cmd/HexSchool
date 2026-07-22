import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PeriodSlot, Timetable } from '@prisma/client';
import {
  PeriodSlotType,
  SessionStatus,
  TimetableStatus,
  UserType,
  Weekday,
} from '../../../common/constants';
import { timeColumnMinutes } from '../../../common/utils/clock.util';
import { isoDate, parseDate } from '../../academic/calendar/date.util';
import { ClassSubjectsRepository } from '../../academic/repositories/class-subjects.repository';
import { SectionsRepository } from '../../academic/repositories/sections.repository';
import { SubjectsRepository } from '../../academic/repositories/subjects.repository';
import { SessionsService } from '../../academic/services/sessions.service';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { PermissionsService } from '../../rbac/services/permissions.service';
import { TeacherAssignmentsRepository } from '../../teacher/repositories/teacher-assignments.repository';
import { TeachersRepository } from '../../teacher/repositories/teachers.repository';
import { Booking, Conflict, detectConflicts } from '../calc/conflict.engine';
import { minutesLabel } from '../calc/slot-schedule.util';
import {
  ConflictQueryDto,
  CreateTimetableDto,
  PublishTimetableDto,
  ReplaceEntriesDto,
  TimetableEntryInputDto,
  TimetableListQueryDto,
} from '../dto';
import { PeriodSlotsRepository } from '../repositories/period-slots.repository';
import {
  EntryWithRelations,
  TimetableEntriesRepository,
} from '../repositories/timetable-entries.repository';
import {
  TimetablesRepository,
  TimetableWithSection,
} from '../repositories/timetables.repository';
import { TimetableSettingsService } from './timetable-settings.service';

/** Statuses that occupy a teacher: a draft holds no one to anything. */
const LIVE_STATUSES = [TimetableStatus.PUBLISHED];

export interface ReplaceEntriesResult {
  saved: number;
  conflicts: Conflict[];
  /** Cells saved despite the teacher not holding that section+subject. */
  unassignedOverrides: Array<{
    day: Weekday;
    periodSlotId: string;
    teacherId: string;
    subjectId: string;
  }>;
}

export interface TimetableDetail {
  timetable: TimetableWithSection;
  slots: PeriodSlot[];
  days: Weekday[];
  entries: EntryWithRelations[];
  /** Conflicts the CURRENT saved grid has — recomputed on read so a
   *  routine that became invalid (a slot moved, another section
   *  published over it) shows red without needing a re-save. */
  conflicts: Conflict[];
}

/**
 * The routine builder (roadmap M13 §4): draft creation, bulk cell
 * replacement behind the conflict engine, and publish/versioning.
 *
 * Two rule tiers, deliberately different:
 *   - **structural** rules can never be overridden — a BREAK slot cannot
 *     hold a lesson, a subject must be on the class's curriculum map, a
 *     teacher cannot be in two rooms at once. Overriding those produces
 *     a routine nobody can actually teach.
 *   - the **assignment** rule (M08 says teacher X owns section+subject)
 *     IS overridable with `timetable.assign.override`, because schools
 *     legitimately run substitutes and guest lessons the assignment
 *     matrix has not caught up with.
 */
@Injectable()
export class TimetableService {
  constructor(
    private readonly timetables: TimetablesRepository,
    private readonly entries: TimetableEntriesRepository,
    private readonly slots: PeriodSlotsRepository,
    private readonly sections: SectionsRepository,
    private readonly subjects: SubjectsRepository,
    private readonly classSubjects: ClassSubjectsRepository,
    private readonly teachers: TeachersRepository,
    private readonly assignments: TeacherAssignmentsRepository,
    private readonly sessions: SessionsService,
    private readonly config: TimetableSettingsService,
    private readonly permissions: PermissionsService,
    private readonly auditContext: AuditContextService,
  ) {}

  // ── read ────────────────────────────────────────────────────────────

  async list(
    query: TimetableListQueryDto,
    schoolId: string,
  ): Promise<TimetableWithSection[]> {
    const sessionId = await this.resolveSessionId(query.sessionId, schoolId);
    return this.timetables.findForSession(schoolId, sessionId, {
      ...(query.status ? { status: query.status } : {}),
      ...(query.classId ? { classId: query.classId } : {}),
      ...(query.sectionId ? { sectionIds: [query.sectionId] } : {}),
    });
  }

  async getDetail(id: string, schoolId: string): Promise<TimetableDetail> {
    const timetable = await this.loadTimetable(id, schoolId);
    const [slots, entries, config] = await Promise.all([
      this.slotsOfSection(timetable, schoolId),
      this.entries.findForTimetable(id),
      this.config.load(schoolId),
    ]);

    const competition = await this.entries.findForSession(
      schoolId,
      timetable.sessionId,
      LIVE_STATUSES,
      { excludeTimetableId: id },
    );

    return {
      timetable,
      slots,
      days: config.workingDays,
      entries,
      conflicts: detectConflicts(
        entries.map((e) => this.toBooking(e)),
        competition.map((e) => this.toBooking(e)),
        config,
      ),
    };
  }

  async versions(
    sectionId: string,
    sessionId: string | undefined,
    schoolId: string,
  ): Promise<Timetable[]> {
    const section = await this.loadSection(sectionId, schoolId);
    return this.timetables.findVersions(
      sessionId ?? section.sessionId,
      sectionId,
      schoolId,
    );
  }

  /** Cell-editor probe: "is this teacher/room free here?" (roadmap M13 §5). */
  async probeConflicts(
    query: ConflictQueryDto,
    schoolId: string,
  ): Promise<Conflict[]> {
    await this.sessions.getById(query.sessionId, schoolId);
    const [slot] = await this.slots.findByIds([query.periodSlotId], schoolId);
    if (!slot) {
      throw new NotFoundException(
        `Period slot ${query.periodSlotId} not found`,
      );
    }
    const teacher = await this.teachers.findByIdOrFail(
      query.teacherId,
      schoolId,
    );
    const config = await this.config.load(schoolId);

    const existing = await this.entries.findForSession(
      schoolId,
      query.sessionId,
      LIVE_STATUSES,
    );
    const candidate: Booking = {
      timetableId: 'probe',
      sectionId: query.sectionId ?? 'probe',
      sectionLabel: 'this section',
      day: query.day,
      slotId: slot.id,
      slotName: slot.name,
      startMinutes: timeColumnMinutes(slot.startTime),
      endMinutes: timeColumnMinutes(slot.endTime),
      teacherId: query.teacherId,
      teacherName: `${teacher.firstName} ${teacher.lastName}`,
      roomNo: query.roomNo ?? null,
      combinedWithSectionId: null,
    };

    return detectConflicts(
      [candidate],
      existing
        .filter((e) => e.timetable.sectionId !== query.sectionId)
        .map((e) => this.toBooking(e)),
      config,
    );
  }

  // ── draft lifecycle ─────────────────────────────────────────────────

  async createDraft(
    dto: CreateTimetableDto,
    actor: AccessTokenPayload,
  ): Promise<TimetableWithSection> {
    const schoolId = actor.schoolId;
    const section = await this.loadSection(dto.sectionId, schoolId);
    const sessionId = dto.sessionId ?? section.sessionId;
    if (sessionId !== section.sessionId) {
      throw new BadRequestException(
        'Section does not belong to the given session',
      );
    }
    const session = await this.sessions.getById(sessionId, schoolId);
    this.assertSessionWritable(session);

    const existingDraft = await this.timetables.findLive(
      sessionId,
      dto.sectionId,
      TimetableStatus.DRAFT,
    );
    if (existingDraft) {
      throw new ConflictException(
        `${section.class.name} — ${section.name} already has a draft routine; edit it instead`,
      );
    }

    // effective_from must land inside the session — a routine that starts
    // before the year does cannot be reconciled with attendance dates.
    const effectiveFrom = dto.effectiveFrom
      ? parseDate(dto.effectiveFrom)
      : this.defaultEffectiveFrom(session.startDate, session.endDate);
    if (
      effectiveFrom.getTime() < session.startDate.getTime() ||
      effectiveFrom.getTime() > session.endDate.getTime()
    ) {
      throw new BadRequestException(
        `Effective date must fall inside session ${session.name}`,
      );
    }

    const published = await this.timetables.findLive(
      sessionId,
      dto.sectionId,
      TimetableStatus.PUBLISHED,
    );

    const draft = await this.timetables.withTransaction(async (tx) => {
      const created = await this.timetables.create(
        {
          schoolId,
          sessionId,
          sectionId: dto.sectionId,
          status: TimetableStatus.DRAFT,
          effectiveFrom,
          version:
            (await this.timetables.maxVersion(sessionId, dto.sectionId)) + 1,
          notes: dto.notes ?? null,
          createdBy: actor.sub,
          updatedBy: actor.sub,
        },
        tx,
      );
      if (dto.copyFromPublished && published) {
        await this.entries.cloneInto(published.id, created.id, actor.sub, tx);
      }
      return created;
    });

    this.auditContext.set({
      entityType: 'Timetable',
      entityId: draft.id,
      newValues: {
        sectionId: dto.sectionId,
        sessionId,
        status: TimetableStatus.DRAFT,
        version: draft.version,
        effectiveFrom: isoDate(effectiveFrom),
        copiedFrom: dto.copyFromPublished ? (published?.id ?? null) : null,
      },
    });

    return (await this.timetables.findDetail(draft.id, schoolId))!;
  }

  /**
   * Full replacement of a draft's grid. Validation runs over the whole
   * payload before anything is written, so a rejected save leaves the
   * previous draft exactly as it was.
   */
  async replaceEntries(
    id: string,
    dto: ReplaceEntriesDto,
    actor: AccessTokenPayload,
  ): Promise<ReplaceEntriesResult> {
    const schoolId = actor.schoolId;
    const timetable = await this.loadTimetable(id, schoolId);
    if (timetable.status !== TimetableStatus.DRAFT) {
      throw new BadRequestException(
        `Routine is ${timetable.status} — create a new draft to change it`,
      );
    }
    const session = await this.sessions.getById(timetable.sessionId, schoolId);
    this.assertSessionWritable(session);

    const config = await this.config.load(schoolId);
    const slots = await this.slotsOfSection(timetable, schoolId);
    const slotById = new Map(slots.map((s) => [s.id, s]));
    const previousCount = await this.entries.countForTimetable(id);

    const curriculum = await this.classSubjects.findForClassSession(
      timetable.section.classId,
      timetable.sessionId,
      schoolId,
    );
    // A section in a group studies its group's subjects plus the
    // group-agnostic ones (M06 mapping semantics).
    const allowedSubjects = new Set(
      curriculum
        .filter(
          (row) =>
            row.groupId === null || row.groupId === timetable.section.groupId,
        )
        .map((row) => row.subjectId),
    );

    const unassignedOverrides: ReplaceEntriesResult['unassignedOverrides'] = [];
    const candidates: Booking[] = [];

    for (const entry of dto.entries) {
      const slot = slotById.get(entry.periodSlotId);
      if (!slot) {
        throw new BadRequestException(
          `Period ${entry.periodSlotId} does not belong to this section's shift`,
        );
      }
      if (slot.type !== PeriodSlotType.CLASS) {
        throw new BadRequestException(
          `"${slot.name}" is a ${slot.type.toLowerCase()} slot and cannot hold a lesson`,
        );
      }
      if (!config.workingDays.includes(entry.day)) {
        throw new BadRequestException(
          `${entry.day} is a weekly holiday — remove it from general.weekly_holidays to teach on it`,
        );
      }
      if (!allowedSubjects.has(entry.subjectId)) {
        const subject = await this.subjects.findById(entry.subjectId, schoolId);
        throw new BadRequestException(
          `${subject?.name ?? entry.subjectId} is not on ${timetable.section.class.name}'s curriculum for this session`,
        );
      }
      if (entry.combinedWithSectionId) {
        await this.assertCombinable(
          entry,
          timetable,
          schoolId,
          config.allowCombined,
        );
      }

      const teacher = await this.teachers.findById(entry.teacherId, schoolId);
      if (!teacher) {
        throw new BadRequestException(`Teacher ${entry.teacherId} not found`);
      }

      const holder = await this.assignments.findBySlot(
        timetable.sessionId,
        timetable.sectionId,
        entry.subjectId,
      );
      if (!holder || holder.teacherId !== entry.teacherId) {
        await this.assertOverrideAllowed(dto.override ?? false, actor);
        unassignedOverrides.push({
          day: entry.day,
          periodSlotId: entry.periodSlotId,
          teacherId: entry.teacherId,
          subjectId: entry.subjectId,
        });
      }

      candidates.push({
        timetableId: id,
        sectionId: timetable.sectionId,
        sectionLabel: `${timetable.section.class.name} — ${timetable.section.name}`,
        day: entry.day,
        slotId: slot.id,
        slotName: slot.name,
        startMinutes: timeColumnMinutes(slot.startTime),
        endMinutes: timeColumnMinutes(slot.endTime),
        teacherId: entry.teacherId,
        teacherName: `${teacher.firstName} ${teacher.lastName}`,
        roomNo: this.roomOf(entry, timetable),
        combinedWithSectionId: entry.combinedWithSectionId ?? null,
      });
    }

    const competition = await this.entries.findForSession(
      schoolId,
      timetable.sessionId,
      LIVE_STATUSES,
      { excludeTimetableId: id },
    );
    const conflicts = detectConflicts(
      candidates,
      competition.map((e) => this.toBooking(e)),
      config,
    );
    if (conflicts.length > 0) {
      // `details` is the envelope slot the global filter surfaces — the
      // builder paints its red cells from this list, so the conflicts
      // must travel with the 409 and not just as prose.
      throw new ConflictException({
        message: `${conflicts.length} scheduling conflict(s) — nothing was saved`,
        details: { conflicts },
      });
    }

    const saved = await this.entries.replaceForTimetable(
      id,
      dto.entries.map((entry) => ({
        schoolId,
        timetableId: id,
        day: entry.day,
        periodSlotId: entry.periodSlotId,
        subjectId: entry.subjectId,
        teacherId: entry.teacherId,
        roomNo: this.roomOf(entry, timetable),
        combinedWithSectionId: entry.combinedWithSectionId ?? null,
        createdBy: actor.sub,
        updatedBy: actor.sub,
      })),
    );

    this.auditContext.set({
      entityType: 'Timetable',
      entityId: id,
      oldValues: { cells: previousCount },
      newValues: {
        action: 'REPLACE_ENTRIES',
        cells: saved,
        ...(unassignedOverrides.length > 0
          ? { unassignedOverrides: unassignedOverrides.length, override: true }
          : {}),
      },
    });

    return { saved, conflicts: [], unassignedOverrides };
  }

  /**
   * Promote the draft. The routine it replaces becomes ARCHIVED rather
   * than being deleted, so `effective_from` + `version` still answer
   * "which routine was in force on 12 March" after the change.
   */
  async publish(
    id: string,
    dto: PublishTimetableDto,
    actor: AccessTokenPayload,
  ): Promise<TimetableWithSection> {
    const schoolId = actor.schoolId;
    const timetable = await this.loadTimetable(id, schoolId);
    if (timetable.status !== TimetableStatus.DRAFT) {
      throw new BadRequestException(`Routine is already ${timetable.status}`);
    }
    const session = await this.sessions.getById(timetable.sessionId, schoolId);
    this.assertSessionWritable(session);

    const entries = await this.entries.findForTimetable(id);
    if (entries.length === 0) {
      throw new BadRequestException(
        'An empty routine cannot be published — add at least one lesson',
      );
    }

    // Re-run the engine at publish time: another section may have gone
    // live since this draft was last saved (roadmap M13 §5 "publish with
    // validation summary").
    const config = await this.config.load(schoolId);
    const competition = await this.entries.findForSession(
      schoolId,
      timetable.sessionId,
      LIVE_STATUSES,
      { excludeTimetableId: id },
    );
    const conflicts = detectConflicts(
      entries.map((e) => this.toBooking(e)),
      competition.map((e) => this.toBooking(e)),
      config,
    );
    if (conflicts.length > 0) {
      throw new ConflictException({
        message: `${conflicts.length} conflict(s) appeared since this draft was saved — resolve them before publishing`,
        details: { conflicts },
      });
    }

    const effectiveFrom = dto.effectiveFrom
      ? parseDate(dto.effectiveFrom)
      : timetable.effectiveFrom;
    if (
      effectiveFrom.getTime() < session.startDate.getTime() ||
      effectiveFrom.getTime() > session.endDate.getTime()
    ) {
      throw new BadRequestException(
        `Effective date must fall inside session ${session.name}`,
      );
    }

    const superseded = await this.timetables.findLive(
      timetable.sessionId,
      timetable.sectionId,
      TimetableStatus.PUBLISHED,
    );

    await this.timetables.withTransaction(async (tx) => {
      // Archive FIRST — uq_timetables_live_version permits only one
      // non-archived row per (session, section, status).
      if (superseded) {
        await this.timetables.setStatus(
          superseded.id,
          { status: TimetableStatus.ARCHIVED, updatedBy: actor.sub },
          tx,
        );
      }
      await this.timetables.setStatus(
        id,
        {
          status: TimetableStatus.PUBLISHED,
          effectiveFrom,
          publishedAt: new Date(),
          publishedBy: actor.sub,
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          updatedBy: actor.sub,
        },
        tx,
      );
    });

    this.auditContext.set({
      entityType: 'Timetable',
      entityId: id,
      oldValues: { status: TimetableStatus.DRAFT },
      newValues: {
        status: TimetableStatus.PUBLISHED,
        version: timetable.version,
        effectiveFrom: isoDate(effectiveFrom),
        cells: entries.length,
        supersededId: superseded?.id ?? null,
      },
    });

    return (await this.timetables.findDetail(id, schoolId))!;
  }

  /** Discard a draft. Published and archived versions are never deleted. */
  async remove(id: string, actor: AccessTokenPayload): Promise<void> {
    const timetable = await this.loadTimetable(id, actor.schoolId);
    if (timetable.status !== TimetableStatus.DRAFT) {
      throw new ConflictException(
        `Only drafts can be deleted — ${timetable.status} routines are the section's history`,
      );
    }
    await this.timetables.softDelete(id);
    this.auditContext.set({
      entityType: 'Timetable',
      entityId: id,
      oldValues: {
        sectionId: timetable.sectionId,
        version: timetable.version,
        status: timetable.status,
      },
    });
  }

  // ── internals ───────────────────────────────────────────────────────

  private async loadTimetable(
    id: string,
    schoolId: string,
  ): Promise<TimetableWithSection> {
    const timetable = await this.timetables.findDetail(id, schoolId);
    if (!timetable) throw new NotFoundException(`Timetable ${id} not found`);
    return timetable;
  }

  private async loadSection(sectionId: string, schoolId: string) {
    const section = await this.sections.findDetail(sectionId, schoolId);
    if (!section) throw new NotFoundException(`Section ${sectionId} not found`);
    return section;
  }

  /**
   * The bell schedule a section runs on. A section without a shift has no
   * schedule of its own — the school runs a single implicit shift, so the
   * only defined slots are used.
   */
  private async slotsOfSection(
    timetable: TimetableWithSection,
    schoolId: string,
  ): Promise<PeriodSlot[]> {
    if (timetable.section.shiftId) {
      return this.slots.findForShift(timetable.section.shiftId, schoolId);
    }
    const all = await this.slots.findAllWithShift(schoolId);
    const shiftIds = new Set(all.map((s) => s.shiftId));
    if (shiftIds.size > 1) {
      throw new BadRequestException(
        `${timetable.section.class.name} — ${timetable.section.name} has no shift, but the school defines ${shiftIds.size} bell schedules; assign the section a shift first`,
      );
    }
    return all;
  }

  /** A combined class must name a DIFFERENT, real section of the session. */
  private async assertCombinable(
    entry: TimetableEntryInputDto,
    timetable: TimetableWithSection,
    schoolId: string,
    allowed: boolean,
  ): Promise<void> {
    if (!allowed) {
      throw new BadRequestException(
        'Combined classes are disabled (academic.timetable_allow_combined_classes)',
      );
    }
    if (entry.combinedWithSectionId === timetable.sectionId) {
      throw new BadRequestException(
        'A combined class must point at a different section',
      );
    }
    const other = await this.loadSection(
      entry.combinedWithSectionId!,
      schoolId,
    );
    if (other.sessionId !== timetable.sessionId) {
      throw new BadRequestException(
        'The combined section belongs to a different academic session',
      );
    }
  }

  /** Explicit room wins; otherwise the section's own room (M06 `room_no`). */
  private roomOf(
    entry: TimetableEntryInputDto,
    timetable: TimetableWithSection,
  ): string | null {
    return entry.roomNo?.trim() || timetable.section.roomNo || null;
  }

  private toBooking(entry: EntryWithRelations): Booking {
    return {
      timetableId: entry.timetableId,
      sectionId: entry.timetable.sectionId,
      sectionLabel: `${entry.timetable.section.class.name} — ${entry.timetable.section.name}`,
      day: entry.day,
      slotId: entry.periodSlotId,
      slotName: `${entry.periodSlot.name} ${minutesLabel(timeColumnMinutes(entry.periodSlot.startTime))}`,
      startMinutes: timeColumnMinutes(entry.periodSlot.startTime),
      endMinutes: timeColumnMinutes(entry.periodSlot.endTime),
      teacherId: entry.teacherId,
      teacherName: `${entry.teacher.firstName} ${entry.teacher.lastName}`,
      roomNo: entry.roomNo,
      combinedWithSectionId: entry.combinedWithSectionId,
    };
  }

  private defaultEffectiveFrom(start: Date, end: Date): Date {
    const today = parseDate(new Date().toISOString().slice(0, 10));
    if (today.getTime() < start.getTime()) return start;
    if (today.getTime() > end.getTime()) return end;
    return today;
  }

  /** The M05 read-only rule, as enforced by M12 attendance. */
  private assertSessionWritable(session: {
    name: string;
    status: SessionStatus;
  }): void {
    if (
      session.status === SessionStatus.COMPLETED ||
      session.status === SessionStatus.ARCHIVED
    ) {
      throw new BadRequestException(
        `Session ${session.name} is ${session.status} — routines are read-only`,
      );
    }
  }

  private async resolveSessionId(
    sessionId: string | undefined,
    schoolId: string,
  ): Promise<string> {
    if (sessionId) {
      await this.sessions.getById(sessionId, schoolId);
      return sessionId;
    }
    const current = await this.sessions.getCurrent(schoolId);
    if (!current) {
      throw new BadRequestException(
        'No current academic session — pass sessionId explicitly',
      );
    }
    return current.id;
  }

  /** Runtime permission check (M08 convention); Super Admin bypasses. */
  private async assertOverrideAllowed(
    override: boolean,
    actor: AccessTokenPayload,
  ): Promise<void> {
    if (!override) {
      throw new ConflictException(
        'A teacher is placed in a section-subject they are not assigned to — pass override=true (requires timetable.assign.override)',
      );
    }
    if (actor.userType === UserType.SUPER_ADMIN) return;
    const codes = await this.permissions.getUserPermissionCodes(actor.sub);
    if (!codes.includes('timetable.assign.override')) {
      throw new ForbiddenException(
        'Placing an unassigned teacher requires timetable.assign.override',
      );
    }
  }
}
