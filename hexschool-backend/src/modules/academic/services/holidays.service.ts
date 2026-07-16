import { BadRequestException, Injectable } from '@nestjs/common';
import { Holiday, HolidayAppliesTo, HolidayType } from '@prisma/client';
import { PaginatedResult } from '../../../common/dto/paginated.dto';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { isoDate as iso, parseDate as day } from '../calendar/date.util';
import {
  CreateHolidayDto,
  SessionScopedListQueryDto,
  UpdateHolidayDto,
} from '../dto';
import { AcademicSessionsRepository } from '../repositories/academic-sessions.repository';
import { HolidaysRepository } from '../repositories/holidays.repository';

export interface HolidayImportReport {
  imported: number;
  errors: Array<{ line: number; message: string }>;
}

const CSV_HEADER = ['title', 'start_date', 'end_date', 'type', 'applies_to'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Holiday CRUD + CSV bulk import (roadmap M05 §4/§8 — BD government
 * holidays are announced late and arrive in batches). Ranges must fall
 * within their session (M05 §7). Rows are hard-deleted per spec; the
 * audit trail preserves history.
 */
@Injectable()
export class HolidaysService {
  constructor(
    private readonly holidays: HolidaysRepository,
    private readonly sessions: AcademicSessionsRepository,
    private readonly auditContext: AuditContextService,
  ) {}

  async list(
    query: SessionScopedListQueryDto,
    schoolId: string,
  ): Promise<PaginatedResult<Holiday>> {
    return this.holidays.paginate(query, {
      schoolId,
      searchColumns: ['title'],
      sortableColumns: ['title', 'startDate', 'endDate', 'type', 'createdAt'],
      where: query.sessionId ? { sessionId: query.sessionId } : undefined,
    });
  }

  async create(
    dto: CreateHolidayDto,
    actor: AccessTokenPayload,
  ): Promise<Holiday> {
    const startDate = day(dto.startDate);
    const endDate = day(dto.endDate);
    await this.assertWithinSession(
      dto.sessionId,
      actor.schoolId,
      startDate,
      endDate,
    );

    const holiday = await this.holidays.create({
      schoolId: actor.schoolId,
      sessionId: dto.sessionId,
      title: dto.title,
      startDate,
      endDate,
      type: dto.type,
      appliesTo: dto.appliesTo,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });
    this.auditContext.set({
      entityType: 'Holiday',
      entityId: holiday.id,
      newValues: this.snapshot(holiday),
    });
    return holiday;
  }

  async update(
    id: string,
    dto: UpdateHolidayDto,
    actor: AccessTokenPayload,
  ): Promise<Holiday> {
    const existing = await this.holidays.findByIdOrFail(id, actor.schoolId);
    const startDate = dto.startDate ? day(dto.startDate) : existing.startDate;
    const endDate = dto.endDate ? day(dto.endDate) : existing.endDate;
    await this.assertWithinSession(
      existing.sessionId,
      actor.schoolId,
      startDate,
      endDate,
    );

    const updated = await this.holidays.update(id, {
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.startDate ? { startDate } : {}),
      ...(dto.endDate ? { endDate } : {}),
      ...(dto.type !== undefined ? { type: dto.type } : {}),
      ...(dto.appliesTo !== undefined ? { appliesTo: dto.appliesTo } : {}),
      updatedBy: actor.sub,
    });
    this.auditContext.set({
      entityType: 'Holiday',
      entityId: id,
      oldValues: this.snapshot(existing),
      newValues: this.snapshot(updated),
    });
    return updated;
  }

  async remove(id: string, actor: AccessTokenPayload): Promise<void> {
    const holiday = await this.holidays.findByIdOrFail(id, actor.schoolId);
    await this.holidays.hardDelete(id);
    this.auditContext.set({
      entityType: 'Holiday',
      entityId: id,
      oldValues: this.snapshot(holiday),
    });
  }

  /**
   * CSV import: header `title,start_date,end_date,type,applies_to`
   * (last two optional per row). Valid rows import; invalid rows are
   * reported with their line number and skipped. Simple comma format —
   * quoted commas are not supported (documented limitation).
   */
  async importCsv(
    sessionId: string,
    csv: string,
    actor: AccessTokenPayload,
  ): Promise<HolidayImportReport> {
    const session = await this.sessions.findByIdOrFail(
      sessionId,
      actor.schoolId,
    );

    const lines = csv
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) {
      throw new BadRequestException('CSV is empty');
    }
    const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
    if (header.slice(0, 3).join(',') !== CSV_HEADER.slice(0, 3).join(',')) {
      throw new BadRequestException(
        `CSV header must start with: ${CSV_HEADER.slice(0, 3).join(',')}`,
      );
    }

    const errors: HolidayImportReport['errors'] = [];
    let imported = 0;

    for (let i = 1; i < lines.length; i += 1) {
      const lineNo = i + 1;
      const cols = lines[i].split(',').map((c) => c.trim());
      const [title, start, end, type, appliesTo] = cols;

      const fail = (message: string) => errors.push({ line: lineNo, message });
      if (!title || title.length < 2) {
        fail('title is required (min 2 chars)');
        continue;
      }
      if (!DATE_RE.test(start ?? '') || !DATE_RE.test(end ?? '')) {
        fail('start_date/end_date must be YYYY-MM-DD');
        continue;
      }
      let startDate: Date;
      let endDate: Date;
      try {
        startDate = day(start);
        endDate = day(end);
      } catch {
        fail('start_date/end_date must be valid dates (YYYY-MM-DD)');
        continue;
      }
      if (startDate.getTime() > endDate.getTime()) {
        fail('start_date is after end_date');
        continue;
      }
      if (
        startDate.getTime() < session.startDate.getTime() ||
        endDate.getTime() > session.endDate.getTime()
      ) {
        fail('range falls outside the session');
        continue;
      }
      if (type && !(type in HolidayType)) {
        fail(`type must be one of ${Object.keys(HolidayType).join('|')}`);
        continue;
      }
      if (appliesTo && !(appliesTo in HolidayAppliesTo)) {
        fail(
          `applies_to must be one of ${Object.keys(HolidayAppliesTo).join('|')}`,
        );
        continue;
      }

      await this.holidays.create({
        schoolId: actor.schoolId,
        sessionId,
        title,
        startDate,
        endDate,
        ...(type ? { type: type as HolidayType } : {}),
        ...(appliesTo ? { appliesTo: appliesTo as HolidayAppliesTo } : {}),
        createdBy: actor.sub,
        updatedBy: actor.sub,
      });
      imported += 1;
    }

    this.auditContext.set({
      entityType: 'Holiday',
      entityId: sessionId,
      action: 'CREATE',
      newValues: { csvImport: { imported, errorLines: errors.length } },
    });
    return { imported, errors };
  }

  // ── internals ─────────────────────────────────────────────────────

  private async assertWithinSession(
    sessionId: string,
    schoolId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<void> {
    if (startDate.getTime() > endDate.getTime()) {
      throw new BadRequestException('startDate must not be after endDate');
    }
    const session = await this.sessions.findByIdOrFail(sessionId, schoolId);
    if (
      startDate.getTime() < session.startDate.getTime() ||
      endDate.getTime() > session.endDate.getTime()
    ) {
      throw new BadRequestException(
        `Holiday must fall within session "${session.name}" (${iso(
          session.startDate,
        )} – ${iso(session.endDate)})`,
      );
    }
  }

  private snapshot(holiday: Holiday) {
    return {
      title: holiday.title,
      startDate: iso(holiday.startDate),
      endDate: iso(holiday.endDate),
      type: holiday.type,
      appliesTo: holiday.appliesTo,
    };
  }
}
