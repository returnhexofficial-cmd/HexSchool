import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AlumniEvent,
  AlumniEventRegistration,
  AlumniRegistrationStatus,
  AlumniStatus,
} from '@prisma/client';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { parseDate } from '../../academic/calendar/date.util';
import {
  capacityWarning,
  registrationClosedRefusal,
  seatsFor,
} from '../calc/alumni.engine';
import {
  AlumniEventQueryDto,
  RegisterForEventDto,
  UpdateRegistrationDto,
  UpsertAlumniEventDto,
} from '../dto';
import {
  AlumniEventRegistrationsRepository,
  AlumniEventsRepository,
  AlumniRepository,
} from '../repositories/alumni.repository';
import { CommunitySettingsService } from './community-settings.service';

export interface EventView extends AlumniEvent {
  seatsTaken: number;
  seatsLeft: number | null;
  registrations: number;
}

/**
 * Alumni events and who is coming (roadmap M28 §4, §5).
 *
 * Two decisions worth reading:
 *
 * **Over capacity warns, it does not refuse** — the M25 bus rule. A
 * reunion that seats a hundred and has a hundred and two people wanting to
 * come is a real thing, and a system that made it unrecordable would
 * simply be lied to. The warning comes back in the response so the
 * committee sees it and decides.
 *
 * **Only an APPROVED alumnus may register.** The event list is the one
 * place the directory turns into a guest list at the door, and a PENDING
 * claim is somebody the school has not yet agreed is who they say.
 */
@Injectable()
export class AlumniEventsService {
  constructor(
    private readonly events: AlumniEventsRepository,
    private readonly registrations: AlumniEventRegistrationsRepository,
    private readonly alumni: AlumniRepository,
    private readonly config: CommunitySettingsService,
    private readonly audit: AuditContextService,
  ) {}

  async list(query: AlumniEventQueryDto, user: AccessTokenPayload) {
    const { rows, total } = await this.events.findMany(
      user.schoolId,
      { upcomingOnly: query.upcomingOnly },
      query.page,
      query.limit,
    );

    return {
      data: await Promise.all(
        rows.map((event) => this.decorate(event, user.schoolId)),
      ),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  /** The public "what's on" list — published events only. */
  async publicList(schoolId: string) {
    const cfg = await this.config.load(schoolId);
    if (!cfg.enabled) return [];

    const { rows } = await this.events.findMany(
      schoolId,
      { publishedOnly: true, upcomingOnly: true },
      1,
      50,
    );
    // The SELECT list is the policy (M19): a visitor sees what the event
    // is and what it costs, never who is coming.
    return rows.map((event) => ({
      id: event.id,
      title: event.title,
      eventDate: event.eventDate,
      venue: event.venue,
      description: event.description,
      fee: event.fee,
      registrationDeadline: event.registrationDeadline,
    }));
  }

  async get(id: string, user: AccessTokenPayload): Promise<EventView> {
    const event = await this.events.findDetail(id, user.schoolId);
    if (!event) throw new NotFoundException(`Event ${id} not found`);
    return this.decorate(event, user.schoolId);
  }

  async create(
    dto: UpsertAlumniEventDto,
    user: AccessTokenPayload,
  ): Promise<EventView> {
    this.assertDates(dto);
    const created = await this.events.create({
      schoolId: user.schoolId,
      ...this.body(dto),
      createdBy: user.sub,
    });
    this.audit.set({
      entityType: 'AlumniEvent',
      entityId: created.id,
      newValues: { title: created.title, eventDate: created.eventDate },
    });
    return this.decorate(created, user.schoolId);
  }

  async update(
    id: string,
    dto: UpsertAlumniEventDto,
    user: AccessTokenPayload,
  ): Promise<EventView> {
    const existing = await this.get(id, user);
    this.assertDates(dto);

    const updated = await this.events.update(id, {
      ...this.body(dto),
      updatedBy: user.sub,
    });
    this.audit.set({
      entityType: 'AlumniEvent',
      entityId: id,
      oldValues: { title: existing.title, eventDate: existing.eventDate },
      newValues: { title: updated.title, eventDate: updated.eventDate },
    });
    return this.decorate(updated, user.schoolId);
  }

  async remove(id: string, user: AccessTokenPayload): Promise<void> {
    const event = await this.get(id, user);
    if (event.registrations > 0) {
      // The M14/M15/M22 "blocked once somebody has committed" guard: a
      // reunion sixty people signed up for is cancelled and told about,
      // not deleted out from under them.
      throw new ConflictException(
        `${event.registrations} alumni have registered for this event. Unpublish it and tell them rather than deleting it.`,
      );
    }
    await this.events.softDelete(id);
    this.audit.set({
      entityType: 'AlumniEvent',
      entityId: id,
      oldValues: { title: event.title },
    });
  }

  // ── registrations ───────────────────────────────────────────────────

  async listRegistrations(
    eventId: string,
    user: AccessTokenPayload,
  ): Promise<AlumniEventRegistration[]> {
    await this.get(eventId, user);
    return this.registrations.findForEvent(eventId, user.schoolId);
  }

  async register(
    eventId: string,
    dto: RegisterForEventDto,
    user: AccessTokenPayload,
  ): Promise<{
    registration: AlumniEventRegistration;
    warning: string | null;
  }> {
    const event = await this.get(eventId, user);

    const alumnus = await this.alumni.findDetail(dto.alumniId, user.schoolId);
    if (!alumnus)
      throw new NotFoundException('That alumni profile is not on file');
    if (alumnus.status !== AlumniStatus.APPROVED) {
      throw new ConflictException(
        'Only an approved alumni profile can be registered for an event',
      );
    }

    const closed = registrationClosedRefusal(
      event.registrationDeadline,
      event.eventDate,
      new Date(),
    );
    if (closed) throw new ConflictException(closed);

    const existing = await this.registrations.findLive(
      eventId,
      dto.alumniId,
      user.schoolId,
    );
    if (existing) {
      throw new ConflictException(
        `${alumnus.name} is already registered for this event`,
      );
    }

    const seats = seatsFor(dto.guests ?? 0);
    const warning = capacityWarning(
      { capacity: event.capacity, taken: event.seatsTaken },
      seats,
    );

    const registration = await this.registrations.create({
      schoolId: user.schoolId,
      eventId,
      alumniId: dto.alumniId,
      guests: dto.guests ?? 0,
      amountPaid: dto.amountPaid ?? 0,
      notes: dto.notes ?? null,
      createdBy: user.sub,
    });

    this.audit.set({
      entityType: 'AlumniEventRegistration',
      entityId: registration.id,
      newValues: {
        eventId,
        alumniId: dto.alumniId,
        guests: registration.guests,
      },
    });

    return { registration, warning };
  }

  async updateRegistration(
    id: string,
    dto: UpdateRegistrationDto,
    user: AccessTokenPayload,
  ): Promise<AlumniEventRegistration> {
    const existing = await this.registrations.findByIdOrFail(id, user.schoolId);
    const updated = await this.registrations.update(id, {
      status: dto.status,
      ...(dto.amountPaid !== undefined ? { amountPaid: dto.amountPaid } : {}),
      updatedBy: user.sub,
    });

    this.audit.set({
      entityType: 'AlumniEventRegistration',
      entityId: id,
      oldValues: { status: existing.status },
      newValues: { status: updated.status },
    });
    return updated;
  }

  // ── internals ───────────────────────────────────────────────────────

  private body(dto: UpsertAlumniEventDto) {
    return {
      title: dto.title,
      eventDate: parseDate(dto.eventDate.slice(0, 10)),
      venue: dto.venue ?? null,
      description: dto.description ?? null,
      // `undefined` is a free event; 0 is an event priced at nothing. The
      // two read differently in the accounts, so they stay distinct.
      fee: dto.fee ?? null,
      capacity: dto.capacity ?? null,
      registrationDeadline: dto.registrationDeadline
        ? parseDate(dto.registrationDeadline.slice(0, 10))
        : null,
      isPublished: dto.isPublished === true,
    };
  }

  private assertDates(dto: UpsertAlumniEventDto): void {
    if (!dto.registrationDeadline) return;
    const deadline = parseDate(dto.registrationDeadline.slice(0, 10));
    const eventDate = parseDate(dto.eventDate.slice(0, 10));
    if (deadline.getTime() > eventDate.getTime()) {
      throw new BadRequestException(
        'Registration cannot close after the event has happened',
      );
    }
  }

  private async decorate(
    event: AlumniEvent,
    schoolId: string,
  ): Promise<EventView> {
    const [seatsTaken, rows] = await Promise.all([
      this.registrations.seatsTaken(event.id, schoolId),
      this.registrations.findForEvent(event.id, schoolId),
    ]);
    const live = rows.filter(
      (row) => row.status !== AlumniRegistrationStatus.CANCELLED,
    );

    return {
      ...event,
      seatsTaken,
      seatsLeft: event.capacity === null ? null : event.capacity - seatsTaken,
      registrations: live.length,
    };
  }
}
