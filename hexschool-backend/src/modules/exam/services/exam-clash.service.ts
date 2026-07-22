import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { UserType } from '../../../common/constants';
import { timeColumnMinutes } from '../../../common/utils/clock.util';
import { isoDate } from '../../academic/calendar/date.util';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { PermissionsService } from '../../rbac/services/permissions.service';
import {
  ClashOptions,
  detectClashes,
  ExamClash,
  Sitting,
  splitByOverridability,
} from '../calc/exam-clash.engine';
import {
  ExamSubjectsRepository,
  ExamSubjectWithRelations,
} from '../repositories/exam-subjects.repository';
import type { ExamWithRelations } from '../repositories/exams.repository';
import { ExamSettingsService } from './exam-settings.service';

/**
 * One place that assembles the clash engine's inputs and applies the
 * two-tier override policy, so the bulk paper save, the single-sitting
 * edit, the postponement tool and the pre-flight probe cannot drift
 * apart in what they consider legal.
 */
@Injectable()
export class ExamClashService {
  constructor(
    private readonly examSubjects: ExamSubjectsRepository,
    private readonly config: ExamSettingsService,
    private readonly permissions: PermissionsService,
  ) {}

  /** Scheduled sittings of OTHER live exams competing for the same rooms. */
  async competition(exam: ExamWithRelations): Promise<Sitting[]> {
    const rows = await this.examSubjects.findScheduledForSession(
      exam.schoolId,
      exam.sessionId,
      exam.id,
    );
    return rows.map((row) => this.toSitting(row)).filter(isScheduled);
  }

  async options(exam: ExamWithRelations): Promise<ClashOptions> {
    const config = await this.config.load(exam.schoolId);
    return {
      checkRooms: config.checkRooms,
      allowMultiplePapersPerDay: config.allowMultiplePapersPerDay,
      window: {
        startDate: isoDate(exam.startDate),
        endDate: isoDate(exam.endDate),
      },
    };
  }

  async detect(
    exam: ExamWithRelations,
    candidates: Sitting[],
  ): Promise<ExamClash[]> {
    const [competition, options] = await Promise.all([
      this.competition(exam),
      this.options(exam),
    ]);
    return detectClashes(candidates, competition, options);
  }

  /**
   * Refuse the save unless the routine is clean — or, for the waivable
   * same-day policy only, unless the caller both asked for an override
   * and holds `exam.schedule.override`.
   *
   * Structural clashes (a class in two halls, a room double-booked, a
   * date outside the exam) are never waivable: overriding them produces
   * a routine nobody can actually sit.
   */
  async assertScheduleAllowed(
    exam: ExamWithRelations,
    candidates: Sitting[],
    override: boolean,
    actor: AccessTokenPayload,
  ): Promise<ExamClash[]> {
    const clashes = await this.detect(exam, candidates);
    const { structural, waivable } = splitByOverridability(clashes);

    if (structural.length > 0) {
      // `details` is the envelope slot the global filter surfaces — the
      // routine grid paints its red cells from this list.
      throw new ConflictException({
        message: `${structural.length} scheduling clash(es) — nothing was saved`,
        details: { clashes: structural, waivable },
      });
    }

    if (waivable.length > 0) {
      if (!override) {
        throw new ConflictException({
          message: `${waivable.length} scheduling warning(s) — pass override=true to schedule anyway`,
          details: { clashes: [], waivable },
        });
      }
      await this.assertOverridePermission(actor);
    }

    return waivable;
  }

  /** Runtime permission check (M08 convention); Super Admin bypasses. */
  private async assertOverridePermission(
    actor: AccessTokenPayload,
  ): Promise<void> {
    if (actor.userType === UserType.SUPER_ADMIN) return;
    const codes = await this.permissions.getUserPermissionCodes(actor.sub);
    if (!codes.includes('exam.schedule.override')) {
      throw new ForbiddenException(
        'Overriding a scheduling warning requires exam.schedule.override',
      );
    }
  }

  /** A saved paper → an engine Sitting. Unscheduled papers become nulls. */
  toSitting(row: ExamSubjectWithRelations): Sitting {
    const startMinutes = row.startTime ? timeColumnMinutes(row.startTime) : 0;
    return {
      examSubjectId: row.id,
      examId: row.examId,
      classId: row.classId,
      classLabel: row.class.name,
      subjectId: row.subjectId,
      subjectName: row.subject.name,
      date: row.examDate ? isoDate(row.examDate) : '',
      startMinutes,
      endMinutes: startMinutes + (row.durationMin ?? 0),
      room: row.room,
    };
  }
}

/** Only scheduled sittings can clash — an undated paper occupies nothing. */
export function isScheduled(sitting: Sitting): boolean {
  return sitting.date !== '' && sitting.endMinutes > sitting.startMinutes;
}
