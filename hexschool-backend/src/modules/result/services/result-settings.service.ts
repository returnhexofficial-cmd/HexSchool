import { Injectable } from '@nestjs/common';
import { SettingsService } from '../../school/services/settings.service';
import { MeritTiebreak } from '../calc/merit.engine';

export interface ResultConfig {
  /** Most marks grace may add to any one subject. */
  graceMarks: number;
  /** In how many subjects grace may be spent at all. */
  graceMaxSubjects: number;
  /** 4th-subject points above this become the bonus (NCTB: 2.00). */
  optionalBonusBase: number;
  meritTiebreak: MeritTiebreak;
  requireLockedMarks: boolean;
  smsTemplate: string;
  publicSearchEnabled: boolean;
  reportCardFooter: string;
  reportCardShowAttendance: boolean;
}

/**
 * One typed read of every knob this module honours (the M12/M13/M14
 * settings-service pattern), so no service reads `SettingsService`
 * directly and they all inherit the M04 Redis cache for free.
 *
 * The M15 keys live in the `exam` settings group and carry the `exam.`
 * prefix, because results are the back half of the exam cycle rather
 * than a separate configuration surface for an administrator to find.
 */
@Injectable()
export class ResultSettingsService {
  constructor(private readonly settings: SettingsService) {}

  async load(schoolId: string): Promise<ResultConfig> {
    const get = <T>(key: string) => this.settings.getValue<T>(schoolId, key);
    const [
      graceMarks,
      graceMaxSubjects,
      optionalBonusBase,
      tiebreak,
      requireLocked,
      smsTemplate,
      publicSearch,
      footer,
      showAttendance,
    ] = await Promise.all([
      get<number>('exam.grace_marks'),
      get<number>('exam.grace_max_subjects'),
      get<number>('exam.optional_bonus_base'),
      get<string>('exam.merit_tiebreak'),
      get<boolean>('exam.require_locked_marks'),
      get<string>('exam.result_sms_template'),
      get<boolean>('exam.public_result_search'),
      get<string>('exam.report_card_footer'),
      get<boolean>('exam.report_card_show_attendance'),
    ]);

    return {
      graceMarks: nonNegative(graceMarks, 0),
      graceMaxSubjects: nonNegative(graceMaxSubjects, 1),
      optionalBonusBase: nonNegative(optionalBonusBase, 2),
      meritTiebreak:
        String(tiebreak).toUpperCase() === 'ROLL_ASC' ? 'ROLL_ASC' : 'NONE',
      // A misconfigured value must not silently let unlocked marks
      // through — this one fails CLOSED.
      requireLockedMarks: requireLocked !== false,
      smsTemplate:
        typeof smsTemplate === 'string' && smsTemplate.trim() !== ''
          ? smsTemplate
          : '{name}: {exam} result published. GPA {gpa} ({grade}).',
      publicSearchEnabled: publicSearch !== false,
      reportCardFooter: typeof footer === 'string' ? footer : '',
      reportCardShowAttendance: showAttendance !== false,
    };
  }
}

/** A misconfigured number never becomes NaN grace or a NaN bonus base. */
function nonNegative(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
