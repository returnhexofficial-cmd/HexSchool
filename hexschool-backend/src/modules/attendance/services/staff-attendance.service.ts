import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import {
  AttendanceMethod,
  AttendancePersonType,
  AttendanceStatus,
  HolidayAppliesTo,
  UserType,
} from '../../../common/constants';
import { parseDate } from '../../academic/calendar/date.util';
import { CalendarService } from '../../academic/services/calendar.service';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { PermissionsService } from '../../rbac/services/permissions.service';
import { dhakaToday } from '../calc/clock.util';
import { MarkStaffAttendanceDto, StaffAttendanceQueryDto } from '../dto';
import { EmployeeDirectoryRepository } from '../repositories/employee-directory.repository';
import { StaffAttendancesRepository } from '../repositories/staff-attendances.repository';

export interface StaffAttendanceRow {
  personType: AttendancePersonType;
  personId: string;
  employeeId: string;
  name: string;
  designation: string;
  departmentId: string | null;
  status: AttendanceStatus | null;
  checkInTime: Date | null;
  checkOutTime: Date | null;
  remarks: string | null;
}

export interface StaffAttendanceSheet {
  date: string;
  holiday: { holiday: boolean; reason?: string; title?: string };
  marked: boolean;
  editable: boolean;
  lockReason?: string;
  rows: StaffAttendanceRow[];
}

/**
 * Employee attendance (roadmap M12 §3–4). The person list is the union
 * of the two employee tables — `person_type` says which one a row points
 * at, so teachers and non-teaching staff keep the independent lifecycles
 * M08 chose. Only ACTIVE/ON_LEAVE employees appear on the sheet.
 */
@Injectable()
export class StaffAttendanceService {
  constructor(
    private readonly attendances: StaffAttendancesRepository,
    private readonly directory: EmployeeDirectoryRepository,
    private readonly calendar: CalendarService,
    private readonly permissions: PermissionsService,
    private readonly auditContext: AuditContextService,
  ) {}

  async getSheet(
    query: StaffAttendanceQueryDto,
    actor: AccessTokenPayload,
  ): Promise<StaffAttendanceSheet> {
    const schoolId = actor.schoolId;
    const date = parseDate(query.date);

    const [people, existing, holiday] = await Promise.all([
      this.directory.findMarkable(
        schoolId,
        query.personType,
        query.departmentId,
      ),
      this.attendances.findForDate(schoolId, date, query.personType),
      this.calendar.isHoliday(schoolId, date, HolidayAppliesTo.STAFF),
    ]);

    const byPerson = new Map(
      existing.map((row) => [`${row.personType}:${row.personId}`, row]),
    );
    const future = date.getTime() > parseDate(dhakaToday()).getTime();

    return {
      date: query.date,
      holiday,
      marked: existing.length > 0,
      editable: !future,
      ...(future
        ? { lockReason: 'Attendance cannot be taken for a future date' }
        : {}),
      rows: people.map((person) => {
        const row = byPerson.get(`${person.personType}:${person.personId}`);
        return {
          ...person,
          status: row?.status ?? null,
          checkInTime: row?.checkInTime ?? null,
          checkOutTime: row?.checkOutTime ?? null,
          remarks: row?.remarks ?? null,
        };
      }),
    };
  }

  async mark(
    dto: MarkStaffAttendanceDto,
    actor: AccessTokenPayload,
  ): Promise<{ saved: number }> {
    const schoolId = actor.schoolId;
    const date = parseDate(dto.date);
    if (date.getTime() > parseDate(dhakaToday()).getTime()) {
      throw new BadRequestException(
        'Attendance cannot be taken for a future date',
      );
    }

    const holiday = await this.calendar.isHoliday(
      schoolId,
      date,
      HolidayAppliesTo.STAFF,
    );
    if (holiday.holiday) {
      if (!dto.overrideHoliday) {
        throw new BadRequestException(
          `${holiday.title ?? 'This date'} is a holiday — pass overrideHoliday=true (requires attendance.holiday.override)`,
        );
      }
      if (actor.userType !== UserType.SUPER_ADMIN) {
        const codes = await this.permissions.getUserPermissionCodes(actor.sub);
        if (!codes.includes('attendance.holiday.override')) {
          throw new ForbiddenException(
            'Marking staff attendance on a holiday requires attendance.holiday.override',
          );
        }
      }
    }

    const known = new Set(
      (await this.directory.findMarkable(schoolId)).map(
        (p) => `${p.personType}:${p.personId}`,
      ),
    );

    let saved = 0;
    await this.attendances.withTransaction(async (tx) => {
      for (const entry of dto.entries) {
        if (!known.has(`${entry.personType}:${entry.personId}`)) {
          throw new BadRequestException(
            `${entry.personType} ${entry.personId} is not an active employee of this school`,
          );
        }
        await this.attendances.upsertEntry(
          {
            personType: entry.personType,
            personId: entry.personId,
            date,
          },
          {
            schoolId,
            status: entry.status,
            checkInTime: entry.checkInTime ? new Date(entry.checkInTime) : null,
            checkOutTime: entry.checkOutTime
              ? new Date(entry.checkOutTime)
              : null,
            method: AttendanceMethod.MANUAL,
            remarks: entry.remarks ?? null,
            markedBy: actor.sub,
            createdBy: actor.sub,
            updatedBy: actor.sub,
          },
          tx,
        );
        saved += 1;
      }
    });

    this.auditContext.set({
      entityType: 'StaffAttendance',
      entityId: schoolId,
      newValues: { action: 'MARK', date: dto.date, saved },
    });
    return { saved };
  }

  /**
   * Marks a person LEAVE over a date range — the hook the
   * `teacher.leave.approved` listener (M08) calls. Existing rows are
   * overwritten; the method is idempotent.
   */
  async markLeaveRange(
    schoolId: string,
    personType: AttendancePersonType,
    personId: string,
    from: Date,
    to: Date,
    remarks: string,
  ): Promise<number> {
    let marked = 0;
    for (
      let cursor = new Date(from.getTime());
      cursor.getTime() <= to.getTime();
      cursor = new Date(cursor.getTime() + 86_400_000)
    ) {
      const holiday = await this.calendar.isHoliday(
        schoolId,
        cursor,
        HolidayAppliesTo.STAFF,
      );
      if (holiday.holiday) continue;
      await this.attendances.upsertEntry(
        { personType, personId, date: new Date(cursor.getTime()) },
        {
          schoolId,
          status: AttendanceStatus.LEAVE,
          method: AttendanceMethod.AUTO,
          remarks,
        },
      );
      marked += 1;
    }
    return marked;
  }
}
