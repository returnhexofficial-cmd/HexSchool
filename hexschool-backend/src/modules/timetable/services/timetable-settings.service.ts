import { Injectable } from '@nestjs/common';
import { Weekday } from '../../../common/constants';
import { SettingsService } from '../../school/services/settings.service';
import type { ConflictOptions } from '../calc/conflict.engine';

/** Weekday enum ordered as the routine grid prints it (SAT → FRI). */
export const ROUTINE_DAYS: readonly Weekday[] = [
  Weekday.SAT,
  Weekday.SUN,
  Weekday.MON,
  Weekday.TUE,
  Weekday.WED,
  Weekday.THU,
  Weekday.FRI,
];

/** `general.weekly_holidays` stores full names; the routine uses codes. */
const WEEKDAY_BY_NAME: Record<string, Weekday> = {
  SATURDAY: Weekday.SAT,
  SUNDAY: Weekday.SUN,
  MONDAY: Weekday.MON,
  TUESDAY: Weekday.TUE,
  WEDNESDAY: Weekday.WED,
  THURSDAY: Weekday.THU,
  FRIDAY: Weekday.FRI,
};

export interface TimetableConfig extends ConflictOptions {
  /** Days a routine may hold entries — the school week minus its off-days. */
  workingDays: Weekday[];
  /** The excluded days, so the UI can explain why they are missing. */
  weeklyHolidays: Weekday[];
}

/**
 * One place that resolves the `academic.timetable_*` knobs plus the
 * derived school week, so the conflict engine and the builder never read
 * settings directly (and inherit the M04 Redis cache for free).
 *
 * Which DAYS exist is deliberately NOT its own setting: it is derived
 * from `general.weekly_holidays` (roadmap M13 §6), so a school that moves
 * its weekend changes one value and the calendar, attendance and routine
 * all follow.
 */
@Injectable()
export class TimetableSettingsService {
  constructor(private readonly settings: SettingsService) {}

  async load(schoolId: string): Promise<TimetableConfig> {
    const get = <T>(key: string) => this.settings.getValue<T>(schoolId, key);
    const [weekly, maxPerDay, allowCombined, checkRooms] = await Promise.all([
      get<string[]>('general.weekly_holidays'),
      get<number>('academic.timetable_max_periods_per_teacher_per_day'),
      get<boolean>('academic.timetable_allow_combined_classes'),
      get<boolean>('academic.timetable_room_conflict_check'),
    ]);

    const weeklyHolidays = (Array.isArray(weekly) ? weekly : [])
      .map((name) => WEEKDAY_BY_NAME[String(name).toUpperCase()])
      .filter((day): day is Weekday => Boolean(day));

    return {
      weeklyHolidays,
      workingDays: ROUTINE_DAYS.filter((d) => !weeklyHolidays.includes(d)),
      maxPeriodsPerTeacherPerDay: Number(maxPerDay) || 0,
      allowCombined: Boolean(allowCombined),
      checkRooms: Boolean(checkRooms),
    };
  }
}
