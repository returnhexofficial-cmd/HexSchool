import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { AcademicSession } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { PaginatedResult } from '../../../common/dto/paginated.dto';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { isoDate as iso, parseDate as day } from '../calendar/date.util';
import { CreateSessionDto, UpdateSessionDto } from '../dto';
import { AcademicSessionsRepository } from '../repositories/academic-sessions.repository';

/**
 * Academic session lifecycle (roadmap M05 §6): exactly one current
 * session per school (transactional activate + partial unique index),
 * no overlapping date ranges, names unique per school, deletion blocked
 * for the current session or once anything references it (holidays/
 * events now; enrollment/attendance/exams extend the guard from M11 on
 * — archive instead), date corrections only while nothing falls outside
 * the new range.
 */
@Injectable()
export class SessionsService {
  constructor(
    private readonly sessions: AcademicSessionsRepository,
    private readonly auditContext: AuditContextService,
  ) {}

  async list(
    query: PaginationQueryDto,
    schoolId: string,
  ): Promise<PaginatedResult<AcademicSession>> {
    return this.sessions.paginate(query, {
      schoolId,
      searchColumns: ['name'],
      sortableColumns: ['name', 'startDate', 'endDate', 'status', 'createdAt'],
    });
  }

  async getById(id: string, schoolId: string): Promise<AcademicSession> {
    return this.sessions.findByIdOrFail(id, schoolId);
  }

  async getCurrent(schoolId: string): Promise<AcademicSession | null> {
    return this.sessions.findCurrent(schoolId);
  }

  async create(
    dto: CreateSessionDto,
    actor: AccessTokenPayload,
  ): Promise<AcademicSession> {
    const startDate = day(dto.startDate);
    const endDate = day(dto.endDate);
    await this.assertValidRange(actor.schoolId, dto.name, startDate, endDate);

    const session = await this.sessions.create({
      schoolId: actor.schoolId,
      name: dto.name,
      startDate,
      endDate,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });
    this.auditContext.set({
      entityType: 'AcademicSession',
      entityId: session.id,
      newValues: this.snapshot(session),
    });
    return session;
  }

  async update(
    id: string,
    dto: UpdateSessionDto,
    actor: AccessTokenPayload,
  ): Promise<AcademicSession> {
    const existing = await this.sessions.findByIdOrFail(id, actor.schoolId);

    const startDate = dto.startDate ? day(dto.startDate) : existing.startDate;
    const endDate = dto.endDate ? day(dto.endDate) : existing.endDate;
    await this.assertValidRange(
      actor.schoolId,
      dto.name ?? existing.name,
      startDate,
      endDate,
      id,
    );

    // Mid-year date correction (M05 §8): nothing may fall outside the
    // new range. Holidays/events checked now; attendance/exam checks
    // join this guard when those modules land.
    if (dto.startDate || dto.endDate) {
      const outside = await this.sessions.countAttachmentsOutsideRange(
        id,
        startDate,
        endDate,
      );
      if (outside > 0) {
        throw new ConflictException(
          `${outside} holiday(s)/event(s) would fall outside the new dates — move or delete them first`,
        );
      }
    }

    const updated = await this.sessions.update(id, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.startDate ? { startDate } : {}),
      ...(dto.endDate ? { endDate } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      updatedBy: actor.sub,
    });
    this.auditContext.set({
      entityType: 'AcademicSession',
      entityId: id,
      oldValues: this.snapshot(existing),
      newValues: this.snapshot(updated),
    });
    return updated;
  }

  /** Transactional current-session switch (demote old, promote target). */
  async activate(
    id: string,
    actor: AccessTokenPayload,
  ): Promise<AcademicSession> {
    const target = await this.sessions.findByIdOrFail(id, actor.schoolId);
    if (target.isCurrent) return target;

    const previous = await this.sessions.findCurrent(actor.schoolId);
    const activated = await this.sessions.activate(id, actor.schoolId);

    this.auditContext.set({
      entityType: 'AcademicSession',
      entityId: id,
      oldValues: { current: previous?.name ?? null },
      newValues: { current: activated.name },
    });
    return activated;
  }

  async remove(id: string, actor: AccessTokenPayload): Promise<void> {
    const session = await this.sessions.findByIdOrFail(id, actor.schoolId);
    if (session.isCurrent) {
      throw new ConflictException(
        'The current session cannot be deleted — activate another session first',
      );
    }
    const { holidays, events } = await this.sessions.countAttachments(id);
    if (holidays + events > 0) {
      throw new ConflictException(
        `Session has ${holidays} holiday(s) and ${events} event(s) — archive it instead`,
      );
    }
    await this.sessions.softDelete(id);
    this.auditContext.set({
      entityType: 'AcademicSession',
      entityId: id,
      oldValues: this.snapshot(session),
    });
  }

  // ── internals ─────────────────────────────────────────────────────

  private async assertValidRange(
    schoolId: string,
    name: string,
    startDate: Date,
    endDate: Date,
    excludeId?: string,
  ): Promise<void> {
    if (startDate.getTime() >= endDate.getTime()) {
      throw new BadRequestException('startDate must be before endDate');
    }
    const sameName = await this.sessions.findOne({ name }, schoolId);
    if (sameName && sameName.id !== excludeId) {
      throw new ConflictException(`Session "${name}" already exists`);
    }
    const overlapping = await this.sessions.findOverlapping(
      schoolId,
      startDate,
      endDate,
      excludeId,
    );
    if (overlapping.length > 0) {
      throw new BadRequestException(
        `Dates overlap session "${overlapping[0].name}" (${iso(
          overlapping[0].startDate,
        )} – ${iso(overlapping[0].endDate)})`,
      );
    }
  }

  private snapshot(session: AcademicSession) {
    return {
      name: session.name,
      startDate: iso(session.startDate),
      endDate: iso(session.endDate),
      status: session.status,
      isCurrent: session.isCurrent,
    };
  }
}
