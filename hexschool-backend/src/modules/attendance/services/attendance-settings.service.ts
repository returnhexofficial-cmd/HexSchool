import { Injectable } from '@nestjs/common';
import { SettingsService } from '../../school/services/settings.service';
import { minutesOfDayOr } from '../../../common/utils/clock.util';

/** Resolved `attendance.*` settings (M04 registry group). */
export interface AttendanceConfig {
  /** 'daily' until M13 ships periods; 'period' opts into per-period rows. */
  mode: 'daily' | 'period';
  defaultStartMinutes: number;
  lateAfterMinutes: number;
  halfDayAfterMinutes: number;
  editWindowDays: number;
  lateAlertThreshold: number;
  qrDuplicateWindowMinutes: number;
  autoAbsentEnabled: boolean;
  autoAbsentMinutes: number;
  absentSmsEnabled: boolean;
  absentSmsMinutes: number;
  absentSmsDailyCap: number;
}

/**
 * One place that reads the attendance settings group, so services and
 * jobs never sprinkle `getValue` calls (and inherit the M04 Redis cache
 * for free). Malformed HH:mm values fall back to the registry default
 * instead of 500-ing the marking sheet.
 */
@Injectable()
export class AttendanceSettingsService {
  constructor(private readonly settings: SettingsService) {}

  async load(schoolId: string): Promise<AttendanceConfig> {
    const get = <T>(key: string) => this.settings.getValue<T>(schoolId, key);
    const [
      mode,
      defaultStartTime,
      lateAfterMinutes,
      halfDayAfterMinutes,
      editWindowDays,
      lateAlertThreshold,
      qrDuplicateWindowMinutes,
      autoAbsentEnabled,
      autoAbsentTime,
      absentSmsEnabled,
      absentSmsTime,
      absentSmsDailyCap,
    ] = await Promise.all([
      get<string>('attendance.mode'),
      get<string>('attendance.default_start_time'),
      get<number>('attendance.late_after_minutes'),
      get<number>('attendance.half_day_after_minutes'),
      get<number>('attendance.edit_window_days'),
      get<number>('attendance.late_alert_threshold'),
      get<number>('attendance.qr_duplicate_window_minutes'),
      get<boolean>('attendance.auto_absent_enabled'),
      get<string>('attendance.auto_absent_time'),
      get<boolean>('attendance.absent_sms_enabled'),
      get<string>('attendance.absent_sms_time'),
      get<number>('attendance.absent_sms_daily_cap'),
    ]);

    return {
      mode: mode === 'period' ? 'period' : 'daily',
      defaultStartMinutes: minutesOfDayOr(defaultStartTime, '08:00'),
      lateAfterMinutes: Number(lateAfterMinutes) || 0,
      halfDayAfterMinutes: Number(halfDayAfterMinutes) || 0,
      editWindowDays: Number(editWindowDays) || 0,
      lateAlertThreshold: Number(lateAlertThreshold) || 0,
      qrDuplicateWindowMinutes: Number(qrDuplicateWindowMinutes) || 0,
      autoAbsentEnabled: Boolean(autoAbsentEnabled),
      autoAbsentMinutes: minutesOfDayOr(autoAbsentTime, '11:00'),
      absentSmsEnabled: Boolean(absentSmsEnabled),
      absentSmsMinutes: minutesOfDayOr(absentSmsTime, '12:00'),
      absentSmsDailyCap: Number(absentSmsDailyCap) || 0,
    };
  }
}
