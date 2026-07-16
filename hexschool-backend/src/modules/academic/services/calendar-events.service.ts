import { BadRequestException, Injectable } from '@nestjs/common';
import { CalendarEvent } from '@prisma/client';
import { PaginatedResult } from '../../../common/dto/paginated.dto';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { isoDate as iso, parseDate as day } from '../calendar/date.util';
import {
  CreateCalendarEventDto,
  SessionScopedListQueryDto,
  UpdateCalendarEventDto,
} from '../dto';
import { AcademicSessionsRepository } from '../repositories/academic-sessions.repository';
import { CalendarEventsRepository } from '../repositories/calendar-events.repository';

/** Calendar event CRUD — end ≥ start (M05 §7); soft-deleted. */
@Injectable()
export class CalendarEventsService {
  constructor(
    private readonly events: CalendarEventsRepository,
    private readonly sessions: AcademicSessionsRepository,
    private readonly auditContext: AuditContextService,
  ) {}

  async list(
    query: SessionScopedListQueryDto,
    schoolId: string,
  ): Promise<PaginatedResult<CalendarEvent>> {
    return this.events.paginate(query, {
      schoolId,
      searchColumns: ['title', 'description'],
      sortableColumns: ['title', 'startDate', 'endDate', 'type', 'createdAt'],
      where: query.sessionId ? { sessionId: query.sessionId } : undefined,
    });
  }

  async create(
    dto: CreateCalendarEventDto,
    actor: AccessTokenPayload,
  ): Promise<CalendarEvent> {
    const startDate = day(dto.startDate);
    const endDate = day(dto.endDate);
    this.assertRange(startDate, endDate);
    await this.sessions.findByIdOrFail(dto.sessionId, actor.schoolId);

    const event = await this.events.create({
      schoolId: actor.schoolId,
      sessionId: dto.sessionId,
      title: dto.title,
      description: dto.description,
      startDate,
      endDate,
      type: dto.type,
      isPublic: dto.isPublic,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });
    this.auditContext.set({
      entityType: 'CalendarEvent',
      entityId: event.id,
      newValues: this.snapshot(event),
    });
    return event;
  }

  async update(
    id: string,
    dto: UpdateCalendarEventDto,
    actor: AccessTokenPayload,
  ): Promise<CalendarEvent> {
    const existing = await this.events.findByIdOrFail(id, actor.schoolId);
    const startDate = dto.startDate ? day(dto.startDate) : existing.startDate;
    const endDate = dto.endDate ? day(dto.endDate) : existing.endDate;
    this.assertRange(startDate, endDate);

    const updated = await this.events.update(id, {
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.description !== undefined
        ? { description: dto.description }
        : {}),
      ...(dto.startDate ? { startDate } : {}),
      ...(dto.endDate ? { endDate } : {}),
      ...(dto.type !== undefined ? { type: dto.type } : {}),
      ...(dto.isPublic !== undefined ? { isPublic: dto.isPublic } : {}),
      updatedBy: actor.sub,
    });
    this.auditContext.set({
      entityType: 'CalendarEvent',
      entityId: id,
      oldValues: this.snapshot(existing),
      newValues: this.snapshot(updated),
    });
    return updated;
  }

  async remove(id: string, actor: AccessTokenPayload): Promise<void> {
    const event = await this.events.findByIdOrFail(id, actor.schoolId);
    await this.events.softDelete(id);
    this.auditContext.set({
      entityType: 'CalendarEvent',
      entityId: id,
      oldValues: this.snapshot(event),
    });
  }

  private assertRange(startDate: Date, endDate: Date): void {
    if (startDate.getTime() > endDate.getTime()) {
      throw new BadRequestException('startDate must not be after endDate');
    }
  }

  private snapshot(event: CalendarEvent) {
    return {
      title: event.title,
      startDate: iso(event.startDate),
      endDate: iso(event.endDate),
      type: event.type,
      isPublic: event.isPublic,
    };
  }
}
