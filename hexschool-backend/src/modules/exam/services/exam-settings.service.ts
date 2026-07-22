import { Injectable } from '@nestjs/common';
import { SeatPlanStrategy } from '../../../common/constants';
import { minutesOfDayOr } from '../../../common/utils/clock.util';
import { SettingsService } from '../../school/services/settings.service';

export interface ExamConfig {
  /** Fallback when a class-subject declares no `full_marks_default`. */
  defaultFullMarks: number;
  defaultPassMark: number;
  defaultDurationMin: number;
  /** Minutes since midnight. */
  defaultStartMinutes: number;
  allowMultiplePapersPerDay: boolean;
  checkRooms: boolean;
  seatPlanDefaultCapacity: number;
  seatPlanDefaultStrategy: SeatPlanStrategy;
  blockAdmitCardOnDues: boolean;
  admitCardInstructions: string;
}

/**
 * One place that resolves the `exam.*` knobs, so no service reads
 * settings directly and they all inherit the M04 Redis cache for free
 * (the M13 `TimetableSettingsService` pattern).
 */
@Injectable()
export class ExamSettingsService {
  constructor(private readonly settings: SettingsService) {}

  async load(schoolId: string): Promise<ExamConfig> {
    const get = <T>(key: string) => this.settings.getValue<T>(schoolId, key);
    const [
      fullMarks,
      passMark,
      duration,
      startTime,
      multiPerDay,
      checkRooms,
      capacity,
      strategy,
      blockDues,
      instructions,
    ] = await Promise.all([
      get<number>('exam.default_full_marks'),
      get<number>('exam.default_pass_mark'),
      get<number>('exam.default_duration_min'),
      get<string>('exam.default_start_time'),
      get<boolean>('exam.allow_multiple_papers_per_day'),
      get<boolean>('exam.room_conflict_check'),
      get<number>('exam.seat_plan_default_capacity'),
      get<string>('exam.seat_plan_default_strategy'),
      get<boolean>('exam.admit_card_block_dues'),
      get<string>('exam.admit_card_instructions'),
    ]);

    return {
      defaultFullMarks: positive(fullMarks, 100),
      defaultPassMark: positive(passMark, 33),
      defaultDurationMin: positive(duration, 180),
      defaultStartMinutes: minutesOfDayOr(startTime, '10:00'),
      allowMultiplePapersPerDay: Boolean(multiPerDay),
      checkRooms: Boolean(checkRooms),
      seatPlanDefaultCapacity: positive(capacity, 30),
      seatPlanDefaultStrategy:
        String(strategy).toUpperCase() === SeatPlanStrategy.INTERLEAVE
          ? SeatPlanStrategy.INTERLEAVE
          : SeatPlanStrategy.SERPENTINE,
      blockAdmitCardOnDues: Boolean(blockDues),
      admitCardInstructions:
        typeof instructions === 'string' ? instructions : '',
    };
  }
}

/** A misconfigured number never silently becomes 0 marks or a 0-minute exam. */
function positive(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
