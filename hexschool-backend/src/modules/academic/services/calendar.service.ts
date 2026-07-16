import { BadRequestException, Injectable } from '@nestjs/common';
import { CalendarEvent, Holiday, HolidayAppliesTo } from '@prisma/client';
import { SettingsService } from '../../school/services/settings.service';
import { buildIcs } from '../calendar/ics.util';
import { CalendarQueryDto } from '../dto';
import { AcademicSessionsRepository } from '../repositories/academic-sessions.repository';
import { CalendarEventsRepository } from '../repositories/calendar-events.repository';
import { HolidaysRepository } from '../repositories/holidays.repository';

const WEEKDAYS = [
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
] as const;

export interface IsHolidayResult {
  holiday: boolean;
  /** WEEKLY = recurring weekly off-day from settings; RANGE = holidays row. */
  reason?: 'WEEKLY' | 'RANGE';
  title?: string;
}

export interface CalendarMonth {
  from: string;
  to: string;
  weeklyHolidays: string[];
  holidays: Holiday[];
  events: CalendarEvent[];
}

/**
 * Read-side calendar queries: the month aggregate feeding the grid UI,
 * `isHoliday(date)` for Attendance (M12) and Payroll (M21), and the
 * iCal export. Weekly off-days come from the M04 setting
 * `general.weekly_holidays` (default ["FRIDAY"], configurable per school).
 */
@Injectable()
export class CalendarService {
  constructor(
    private readonly holidays: HolidaysRepository,
    private readonly events: CalendarEventsRepository,
    private readonly sessions: AcademicSessionsRepository,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Shared service contract (roadmap M05 §4). `appliesTo` narrows to
   * student- or staff-only holidays (ALL always matches).
   */
  async isHoliday(
    schoolId: string,
    date: Date,
    appliesTo?: HolidayAppliesTo,
  ): Promise<IsHolidayResult> {
    const weekly = await this.weeklyHolidays(schoolId);
    const weekday = WEEKDAYS[date.getUTCDay()];
    if (weekly.includes(weekday)) {
      return { holiday: true, reason: 'WEEKLY', title: `Weekly (${weekday})` };
    }
    const row = await this.holidays.findCovering(schoolId, date, appliesTo);
    if (row) {
      return { holiday: true, reason: 'RANGE', title: row.title };
    }
    return { holiday: false };
  }

  /** `GET /calendar?month=YYYY-MM&sessionId=` — month grid payload. */
  async month(
    query: CalendarQueryDto,
    schoolId: string,
  ): Promise<CalendarMonth> {
    const { from, to } = await this.resolveRange(query, schoolId);
    const [weeklyHolidays, holidays, events] = await Promise.all([
      this.weeklyHolidays(schoolId),
      this.holidays.findInRange(schoolId, from, to),
      this.events.findInRange(schoolId, from, to),
    ]);
    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      weeklyHolidays,
      holidays,
      events,
    };
  }

  /** iCal export of holidays + events (roadmap M05 §4). */
  async ics(query: CalendarQueryDto, schoolId: string): Promise<string> {
    const { from, to } = await this.resolveRange(query, schoolId);
    const [holidays, events] = await Promise.all([
      this.holidays.findInRange(schoolId, from, to),
      this.events.findInRange(schoolId, from, to),
    ]);
    return buildIcs('HexSchool Academic Calendar', [
      ...holidays.map((h) => ({
        uid: h.id,
        title: h.title,
        start: h.startDate,
        end: h.endDate,
        categories: `HOLIDAY,${h.type}`,
      })),
      ...events.map((e) => ({
        uid: e.id,
        title: e.title,
        description: e.description,
        start: e.startDate,
        end: e.endDate,
        categories: e.type,
      })),
    ]);
  }

  // ── internals ─────────────────────────────────────────────────────

  private async weeklyHolidays(schoolId: string): Promise<string[]> {
    const value = await this.settings.getValue<string[]>(
      schoolId,
      'general.weekly_holidays',
    );
    return Array.isArray(value)
      ? value.map((d) => String(d).toUpperCase())
      : [];
  }

  /** month=YYYY-MM → that month; sessionId → session span; else current month. */
  private async resolveRange(
    query: CalendarQueryDto,
    schoolId: string,
  ): Promise<{ from: Date; to: Date }> {
    if (query.month) {
      const [year, month] = query.month.split('-').map(Number);
      const from = new Date(Date.UTC(year, month - 1, 1));
      const to = new Date(Date.UTC(year, month, 0)); // last day of month
      return { from, to };
    }
    if (query.sessionId) {
      const session = await this.sessions.findByIdOrFail(
        query.sessionId,
        schoolId,
      );
      return { from: session.startDate, to: session.endDate };
    }
    const now = new Date();
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const to = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
    );
    if (!from || !to) {
      throw new BadRequestException('Provide month=YYYY-MM or sessionId');
    }
    return { from, to };
  }
}
