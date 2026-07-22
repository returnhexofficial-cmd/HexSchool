import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PeriodSlot } from '@prisma/client';
import {
  PeriodSlotType,
  TimetableStatus,
  UserType,
  Weekday,
} from '../../../common/constants';
import {
  dhakaMinutesOfDay,
  dhakaToday,
  minutesOfDay,
  timeColumnMinutes,
} from '../../../common/utils/clock.util';
import { parseDate } from '../../academic/calendar/date.util';
import { SectionsRepository } from '../../academic/repositories/sections.repository';
import { CalendarService } from '../../academic/services/calendar.service';
import { SessionsService } from '../../academic/services/sessions.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { PermissionsService } from '../../rbac/services/permissions.service';
import { TeachersRepository } from '../../teacher/repositories/teachers.repository';
import { minutesLabel, slotAt } from '../calc/slot-schedule.util';
import { PeriodSlotsRepository } from '../repositories/period-slots.repository';
import {
  EntryWithRelations,
  TimetableEntriesRepository,
} from '../repositories/timetable-entries.repository';
import { TimetablesRepository } from '../repositories/timetables.repository';
import { TimetableSettingsService } from './timetable-settings.service';

/** Weekday index of a JS UTC day number, matching the Weekday enum. */
const WEEKDAY_BY_UTC_DAY: readonly Weekday[] = [
  Weekday.SUN,
  Weekday.MON,
  Weekday.TUE,
  Weekday.WED,
  Weekday.THU,
  Weekday.FRI,
  Weekday.SAT,
];

export interface RoutineCell {
  entryId: string;
  day: Weekday;
  periodSlotId: string;
  subject: { id: string; name: string; code: string };
  teacher: { id: string; name: string; employeeId: string };
  roomNo: string | null;
  combinedWith: { id: string; label: string } | null;
}

export interface RoutineSlotRow {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  type: PeriodSlotType;
  displayOrder: number;
}

export interface SectionRoutine {
  section: {
    id: string;
    name: string;
    className: string;
    shiftName: string | null;
    roomNo: string | null;
  };
  session: { id: string; name: string };
  timetable: {
    id: string;
    status: TimetableStatus;
    version: number;
    effectiveFrom: string;
    publishedAt: string | null;
  } | null;
  days: Weekday[];
  slots: RoutineSlotRow[];
  cells: RoutineCell[];
}

export interface TeacherRoutineCell extends RoutineCell {
  sectionId: string;
  sectionLabel: string;
}

export interface TeacherRoutine {
  teacher: { id: string; name: string; employeeId: string };
  session: { id: string; name: string };
  days: Weekday[];
  slots: RoutineSlotRow[];
  cells: TeacherRoutineCell[];
  periodsPerWeek: number;
  /** Free-period count per day — what a substitution search starts from. */
  freeByDay: Record<string, number>;
}

export interface MasterRoutineRow {
  sectionId: string;
  sectionLabel: string;
  shiftId: string | null;
  shiftName: string | null;
  timetableId: string | null;
  status: TimetableStatus | null;
  filled: number;
  capacity: number;
  cells: RoutineCell[];
}

export interface MasterRoutine {
  session: { id: string; name: string };
  days: Weekday[];
  slotsByShift: Array<{
    shiftId: string;
    shiftName: string;
    slots: RoutineSlotRow[];
  }>;
  sections: MasterRoutineRow[];
  /** Read-only heat view of teacher load (roadmap M13 §5). */
  teacherLoad: Array<{
    teacherId: string;
    name: string;
    employeeId: string;
    periodsPerWeek: number;
    byDay: Record<string, number>;
  }>;
}

export interface CurrentPeriod {
  date: string;
  day: Weekday;
  at: string;
  /** True when the whole day is off — no period can be current. */
  holiday: boolean;
  holidayTitle?: string;
  slot: RoutineSlotRow | null;
  cell: RoutineCell | null;
}

/**
 * Read side of the routine (roadmap M13 §4/§5): the section grid, a
 * teacher's personal week, the whole-school master view, and
 * `getCurrentPeriod()` — the helper period-mode attendance calls to learn
 * which period a mark belongs to.
 *
 * Portal callers see PUBLISHED routines only (roadmap M13 §6); the
 * builder passes `includeDraft` to preview its own work, which the route
 * gates behind `timetable.manage`.
 */
@Injectable()
export class RoutineService {
  constructor(
    private readonly timetables: TimetablesRepository,
    private readonly entries: TimetableEntriesRepository,
    private readonly slots: PeriodSlotsRepository,
    private readonly sections: SectionsRepository,
    private readonly teachers: TeachersRepository,
    private readonly sessions: SessionsService,
    private readonly calendar: CalendarService,
    private readonly config: TimetableSettingsService,
    private readonly permissions: PermissionsService,
  ) {}

  // ── section ─────────────────────────────────────────────────────────

  async sectionRoutine(
    sectionId: string,
    options: { sessionId?: string; includeDraft?: boolean },
    schoolId: string,
  ): Promise<SectionRoutine> {
    const section = await this.sections.findDetail(sectionId, schoolId);
    if (!section) throw new NotFoundException(`Section ${sectionId} not found`);
    const sessionId = options.sessionId ?? section.sessionId;
    const session = await this.sessions.getById(sessionId, schoolId);

    const timetable = await this.resolveTimetable(
      sessionId,
      sectionId,
      options.includeDraft ?? false,
    );

    const [slots, config] = await Promise.all([
      this.slotsFor(section.shiftId, schoolId),
      this.config.load(schoolId),
    ]);
    const entries = timetable
      ? await this.entries.findForTimetable(timetable.id)
      : [];

    return {
      section: {
        id: section.id,
        name: section.name,
        className: section.class.name,
        shiftName: section.shift?.name ?? null,
        roomNo: section.roomNo,
      },
      session: { id: session.id, name: session.name },
      timetable: timetable
        ? {
            id: timetable.id,
            status: timetable.status,
            version: timetable.version,
            effectiveFrom: timetable.effectiveFrom.toISOString().slice(0, 10),
            publishedAt: timetable.publishedAt?.toISOString() ?? null,
          }
        : null,
      days: config.workingDays,
      slots: slots.map((s) => this.toSlotRow(s)),
      cells: entries.map((e) => this.toCell(e)),
    };
  }

  // ── teacher ─────────────────────────────────────────────────────────

  async teacherRoutine(
    teacherId: string,
    options: { sessionId?: string; includeDraft?: boolean },
    schoolId: string,
  ): Promise<TeacherRoutine> {
    const teacher = await this.teachers.findByIdOrFail(teacherId, schoolId);
    const sessionId = await this.resolveSessionId(options.sessionId, schoolId);
    const session = await this.sessions.getById(sessionId, schoolId);

    const statuses = options.includeDraft
      ? [TimetableStatus.PUBLISHED, TimetableStatus.DRAFT]
      : [TimetableStatus.PUBLISHED];

    const [entries, allSlots, config] = await Promise.all([
      this.entries.findForTeacher(teacherId, sessionId, schoolId, statuses),
      this.slots.findAllWithShift(schoolId),
      this.config.load(schoolId),
    ]);

    // A teacher can work across shifts, so their week is drawn on the
    // union of every bell schedule they actually appear in — otherwise a
    // cross-shift period would have no row to sit on.
    const usedShiftIds = new Set(entries.map((e) => e.periodSlot.shiftId));
    const slots = allSlots
      .filter((s) => usedShiftIds.size === 0 || usedShiftIds.has(s.shiftId))
      .sort(
        (a, b) =>
          timeColumnMinutes(a.startTime) - timeColumnMinutes(b.startTime),
      );

    const classSlots = slots.filter((s) => s.type === PeriodSlotType.CLASS);
    const freeByDay: Record<string, number> = {};
    for (const day of config.workingDays) {
      const busy = entries.filter((e) => e.day === day).length;
      freeByDay[day] = Math.max(0, classSlots.length - busy);
    }

    return {
      teacher: {
        id: teacher.id,
        name: `${teacher.firstName} ${teacher.lastName}`,
        employeeId: teacher.employeeId,
      },
      session: { id: session.id, name: session.name },
      days: config.workingDays,
      slots: slots.map((s) => this.toSlotRow(s)),
      cells: entries.map((e) => ({
        ...this.toCell(e),
        sectionId: e.timetable.sectionId,
        sectionLabel: `${e.timetable.section.class.name} — ${e.timetable.section.name}`,
      })),
      periodsPerWeek: entries.length,
      freeByDay,
    };
  }

  // ── master grid ─────────────────────────────────────────────────────

  async masterRoutine(
    options: { sessionId?: string; shiftId?: string; classId?: string },
    schoolId: string,
  ): Promise<MasterRoutine> {
    const sessionId = await this.resolveSessionId(options.sessionId, schoolId);
    const session = await this.sessions.getById(sessionId, schoolId);
    const config = await this.config.load(schoolId);

    const [published, allSlots, allSections] = await Promise.all([
      this.timetables.findForSession(schoolId, sessionId, {
        status: TimetableStatus.PUBLISHED,
        ...(options.classId ? { classId: options.classId } : {}),
      }),
      this.slots.findAllWithShift(schoolId),
      this.sections.findForSessionWithRelations(
        schoolId,
        sessionId,
        options.classId,
      ),
    ]);

    const slots = options.shiftId
      ? allSlots.filter((s) => s.shiftId === options.shiftId)
      : allSlots;
    const sections = options.shiftId
      ? allSections.filter((s) => s.shiftId === options.shiftId)
      : allSections;

    const entries = await this.entries.findForSession(schoolId, sessionId, [
      TimetableStatus.PUBLISHED,
    ]);
    const bySection = new Map<string, EntryWithRelations[]>();
    for (const entry of entries) {
      const list = bySection.get(entry.timetable.sectionId) ?? [];
      list.push(entry);
      bySection.set(entry.timetable.sectionId, list);
    }
    const timetableBySection = new Map(published.map((t) => [t.sectionId, t]));

    const slotsByShift = this.groupSlotsByShift(slots);
    const classSlotCount = new Map(
      slotsByShift.map((group) => [
        group.shiftId,
        group.slots.filter((s) => s.type === PeriodSlotType.CLASS).length,
      ]),
    );

    return {
      session: { id: session.id, name: session.name },
      days: config.workingDays,
      slotsByShift,
      sections: sections.map((section) => {
        const cells = bySection.get(section.id) ?? [];
        const perDay =
          classSlotCount.get(
            section.shiftId ?? slotsByShift[0]?.shiftId ?? '',
          ) ?? 0;
        return {
          sectionId: section.id,
          sectionLabel: `${section.class.name} — ${section.name}`,
          shiftId: section.shiftId,
          shiftName: section.shift?.name ?? null,
          timetableId: timetableBySection.get(section.id)?.id ?? null,
          status: timetableBySection.get(section.id)?.status ?? null,
          filled: cells.length,
          capacity: perDay * config.workingDays.length,
          cells: cells.map((e) => this.toCell(e)),
        };
      }),
      teacherLoad: this.teacherLoad(entries, config.workingDays),
    };
  }

  // ── getCurrentPeriod ────────────────────────────────────────────────

  /**
   * Which period a section is in at a moment (roadmap M13 §4) — the
   * helper period-mode attendance calls so a mark lands on the right
   * `period_id` instead of the operator picking one by hand.
   *
   * Returns the slot even when it holds no lesson: a school may mark
   * attendance in a period whose routine cell is still empty. `cell` is
   * null in that case; `holiday` short-circuits everything.
   */
  async getCurrentPeriod(
    sectionId: string,
    options: { date?: string; at?: string },
    schoolId: string,
  ): Promise<CurrentPeriod> {
    const section = await this.sections.findDetail(sectionId, schoolId);
    if (!section) throw new NotFoundException(`Section ${sectionId} not found`);

    const dateStr = options.date ?? dhakaToday();
    const date = parseDate(dateStr);
    const atMinutes = options.at
      ? minutesOfDay(options.at)
      : dhakaMinutesOfDay();
    const day = WEEKDAY_BY_UTC_DAY[date.getUTCDay()];

    const holiday = await this.calendar.isHoliday(schoolId, date);
    const base = {
      date: dateStr,
      day,
      at: minutesLabel(atMinutes),
      holiday: holiday.holiday,
      ...(holiday.title ? { holidayTitle: holiday.title } : {}),
    };
    if (holiday.holiday) return { ...base, slot: null, cell: null };

    const slots = await this.slotsFor(section.shiftId, schoolId);
    const slot = slotAt(
      slots.map((s) => ({
        id: s.id,
        name: s.name,
        startMinutes: timeColumnMinutes(s.startTime),
        endMinutes: timeColumnMinutes(s.endTime),
      })),
      atMinutes,
    );
    if (!slot) return { ...base, slot: null, cell: null };

    const row = slots.find((s) => s.id === slot.id)!;
    const timetable = await this.resolveTimetable(
      section.sessionId,
      sectionId,
      false,
    );
    if (!timetable) return { ...base, slot: this.toSlotRow(row), cell: null };

    const entries = await this.entries.findForTimetable(timetable.id);
    const entry = entries.find(
      (e) => e.day === day && e.periodSlotId === slot.id,
    );
    return {
      ...base,
      slot: this.toSlotRow(row),
      cell: entry ? this.toCell(entry) : null,
    };
  }

  /**
   * Whether this actor may look at unpublished routines. Kept here rather
   * than as a route decorator because the same route serves both cases:
   * a viewer without the permission gets the published grid, not a 403.
   */
  async canPreviewDrafts(actor: AccessTokenPayload): Promise<boolean> {
    if (actor.userType === UserType.SUPER_ADMIN) return true;
    const codes = await this.permissions.getUserPermissionCodes(actor.sub);
    return codes.includes('timetable.manage');
  }

  /** Periods/week per teacher — the number that finalizes M08's stub. */
  async periodsPerWeek(
    sessionId: string,
    schoolId: string,
  ): Promise<Map<string, number>> {
    const rows = await this.entries.periodsPerWeek(sessionId, schoolId);
    return new Map(rows.map((r) => [r.teacherId, r.periods]));
  }

  // ── internals ───────────────────────────────────────────────────────

  /** PUBLISHED wins; the draft is only visible when explicitly asked for. */
  private async resolveTimetable(
    sessionId: string,
    sectionId: string,
    includeDraft: boolean,
  ) {
    const published = await this.timetables.findLive(
      sessionId,
      sectionId,
      TimetableStatus.PUBLISHED,
    );
    if (published) return published;
    if (!includeDraft) return null;
    return this.timetables.findLive(
      sessionId,
      sectionId,
      TimetableStatus.DRAFT,
    );
  }

  private async slotsFor(
    shiftId: string | null,
    schoolId: string,
  ): Promise<PeriodSlot[]> {
    if (shiftId) return this.slots.findForShift(shiftId, schoolId);
    return this.slots.findAllWithShift(schoolId);
  }

  private groupSlotsByShift(
    slots: Array<PeriodSlot & { shift?: { id: string; name: string } }>,
  ): MasterRoutine['slotsByShift'] {
    const groups = new Map<
      string,
      { shiftName: string; slots: PeriodSlot[] }
    >();
    for (const slot of slots) {
      const group = groups.get(slot.shiftId) ?? {
        shiftName: slot.shift?.name ?? 'Shift',
        slots: [],
      };
      group.slots.push(slot);
      groups.set(slot.shiftId, group);
    }
    return [...groups.entries()].map(([shiftId, group]) => ({
      shiftId,
      shiftName: group.shiftName,
      slots: group.slots
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map((s) => this.toSlotRow(s)),
    }));
  }

  private teacherLoad(
    entries: EntryWithRelations[],
    days: Weekday[],
  ): MasterRoutine['teacherLoad'] {
    const byTeacher = new Map<string, EntryWithRelations[]>();
    for (const entry of entries) {
      const list = byTeacher.get(entry.teacherId) ?? [];
      list.push(entry);
      byTeacher.set(entry.teacherId, list);
    }
    return [...byTeacher.values()]
      .map((list) => {
        const first = list[0];
        const byDay: Record<string, number> = {};
        for (const day of days) {
          byDay[day] = list.filter((e) => e.day === day).length;
        }
        return {
          teacherId: first.teacherId,
          name: `${first.teacher.firstName} ${first.teacher.lastName}`,
          employeeId: first.teacher.employeeId,
          periodsPerWeek: list.length,
          byDay,
        };
      })
      .sort((a, b) => b.periodsPerWeek - a.periodsPerWeek);
  }

  private toSlotRow(slot: PeriodSlot): RoutineSlotRow {
    return {
      id: slot.id,
      name: slot.name,
      startTime: minutesLabel(timeColumnMinutes(slot.startTime)),
      endTime: minutesLabel(timeColumnMinutes(slot.endTime)),
      type: slot.type,
      displayOrder: slot.displayOrder,
    };
  }

  private toCell(entry: EntryWithRelations): RoutineCell {
    return {
      entryId: entry.id,
      day: entry.day,
      periodSlotId: entry.periodSlotId,
      subject: {
        id: entry.subject.id,
        name: entry.subject.name,
        code: entry.subject.code,
      },
      teacher: {
        id: entry.teacher.id,
        name: `${entry.teacher.firstName} ${entry.teacher.lastName}`,
        employeeId: entry.teacher.employeeId,
      },
      roomNo: entry.roomNo,
      combinedWith: entry.combinedWithSection
        ? {
            id: entry.combinedWithSection.id,
            label: `${entry.combinedWithSection.class.name} — ${entry.combinedWithSection.name}`,
          }
        : null,
    };
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
}
