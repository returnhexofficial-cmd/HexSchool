import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Appointment, AppointmentStatus, Visitor } from '@prisma/client';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import { SequenceService } from '../../sequence/sequence.service';
import {
  appointmentAdmits,
  canMoveAppointment,
  isInside,
  passLengthRefusal,
  visitDurationMinutes,
} from '../calc/visitor.engine';
import {
  AppointmentQueryDto,
  CheckInVisitorDto,
  CheckOutVisitorDto,
  DecideAppointmentDto,
  UpdateVisitorDto,
  UpsertAppointmentDto,
  VisitorQueryDto,
} from '../dto';
import { CommunityDirectoryRepository } from '../repositories/community-directory.repository';
import {
  AppointmentsRepository,
  VisitorsRepository,
} from '../repositories/visitors.repository';
import { CommunityNotificationsService } from './community-notifications.service';
import { CommunitySettingsService } from './community-settings.service';

export interface VisitorView extends Visitor {
  hostName: string | null;
  inside: boolean;
  durationMinutes: number;
}

/**
 * The gate desk (roadmap M28 §4, §6, §8).
 *
 * The whole third of the module answers one question at any moment:
 * **who is in the building right now.** So a visit is a row with an open
 * `check_out`, the live board is that predicate, and there is deliberately
 * no status column that could disagree with it.
 *
 * Two rules are worth stating:
 *
 * **A gate pass number is claimed inside the check-in transaction** and
 * never reused (`uq_visitors_gate_pass` ignores `deleted_at`) — it is
 * printed on a card somebody is carrying around a building full of
 * children, and handing the same number to two people on one day defeats
 * the only thing a pass does.
 *
 * **The multi-day pass is OFFICIAL-only and bounded.** Roadmap §8's
 * external invigilator should not queue at the gate three mornings
 * running; everybody else is recorded per visit, because a pass that
 * admits a vendor for a fortnight is the thing a gate register exists to
 * prevent.
 */
@Injectable()
export class VisitorsService {
  constructor(
    private readonly visitors: VisitorsRepository,
    private readonly appointments: AppointmentsRepository,
    private readonly directory: CommunityDirectoryRepository,
    private readonly config: CommunitySettingsService,
    private readonly notifications: CommunityNotificationsService,
    private readonly sequences: SequenceService,
    private readonly schools: SchoolsRepository,
    private readonly audit: AuditContextService,
  ) {}

  // ── reads ───────────────────────────────────────────────────────────

  async list(query: VisitorQueryDto, user: AccessTokenPayload) {
    const { rows, total } = await this.visitors.findMany(
      user.schoolId,
      {
        purpose: query.purpose,
        hostType: query.hostType,
        hostId: query.hostId,
        inside: query.inside,
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
        search: query.search,
      },
      query.page,
      query.limit,
    );

    return {
      data: await this.decorate(rows, user.schoolId),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  /** The live board — everybody signed in and not signed out. */
  async inside(user: AccessTokenPayload): Promise<VisitorView[]> {
    const rows = await this.visitors.findInside(user.schoolId);
    return this.decorate(rows, user.schoolId);
  }

  async get(id: string, user: AccessTokenPayload): Promise<VisitorView> {
    const visitor = await this.visitors.findDetail(id, user.schoolId);
    if (!visitor) throw new NotFoundException(`Visitor ${id} not found`);
    const [view] = await this.decorate([visitor], user.schoolId);
    return view;
  }

  /** Everybody a visitor could ask for, both employee rolls. */
  hosts(user: AccessTokenPayload) {
    return this.directory.hosts(user.schoolId);
  }

  // ── writes ──────────────────────────────────────────────────────────

  async checkIn(
    dto: CheckInVisitorDto,
    user: AccessTokenPayload,
  ): Promise<VisitorView> {
    const cfg = await this.config.load(user.schoolId);
    if (!cfg.enabled) {
      throw new BadRequestException(
        'The complaints, visitor and alumni module is switched off for this school',
      );
    }

    if ((dto.hostType && !dto.hostId) || (!dto.hostType && dto.hostId)) {
      throw new BadRequestException(
        'Name the person being visited, or leave the host blank and write who they asked for',
      );
    }
    if (dto.hostType && dto.hostId) {
      const host = await this.directory.host(
        user.schoolId,
        dto.hostType,
        dto.hostId,
      );
      if (!host) {
        throw new NotFoundException('That member of staff is not on file');
      }
    }
    if (cfg.visitorPhotoRequired && !dto.photoUrl) {
      throw new BadRequestException(
        'This school requires a photograph at check-in',
      );
    }

    const checkIn = new Date();
    const validUntil = dto.validUntil ? new Date(dto.validUntil) : null;
    const passRefusal = passLengthRefusal(
      dto.purpose,
      checkIn,
      validUntil,
      cfg.visitorMaxPassDays,
    );
    if (passRefusal) throw new BadRequestException(passRefusal);

    if (dto.appointmentId) {
      const appointment = await this.appointments.findDetail(
        dto.appointmentId,
        user.schoolId,
      );
      if (!appointment) {
        throw new NotFoundException('That appointment is not on file');
      }
      if (!appointmentAdmits(appointment.status)) {
        throw new ConflictException(
          `This appointment is ${appointment.status} — only an approved appointment admits a visitor`,
        );
      }
    }

    const school = await this.schools.findByIdOrFail(user.schoolId);
    const visitor = await this.visitors.withTransaction(async (tx) => {
      // The number is claimed INSIDE the transaction, so a rolled-back
      // check-in never burns one (the M07 gap-free guarantee).
      const gatePassNo = cfg.visitorGatePassRequired
        ? await this.sequences.nextDocumentNumber({
            schoolId: user.schoolId,
            counterKey: `gatepass:${checkIn.getUTCFullYear() % 100}${String(checkIn.getUTCMonth() + 1).padStart(2, '0')}`,
            pattern: cfg.visitorGatePassPattern,
            schoolCode: school.code,
            date: checkIn,
            tx,
          })
        : null;

      return this.visitors.create(
        {
          schoolId: user.schoolId,
          name: dto.name,
          phone: dto.phone,
          nid: dto.nid ?? null,
          address: dto.address ?? null,
          purpose: dto.purpose,
          hostType: dto.hostType ?? null,
          hostId: dto.hostId ?? null,
          whomToMeet: dto.whomToMeet ?? null,
          cardNo: dto.cardNo ?? null,
          photoUrl: dto.photoUrl ?? null,
          gatePassNo,
          checkIn,
          validUntil,
          appointmentId: dto.appointmentId ?? null,
          remarks: dto.remarks ?? null,
          createdBy: user.sub,
        },
        tx,
      );
    });

    this.audit.set({
      entityType: 'Visitor',
      entityId: visitor.id,
      newValues: {
        name: visitor.name,
        purpose: visitor.purpose,
        gatePassNo: visitor.gatePassNo,
      },
    });

    // An appointment kept is COMPLETED — the register must be able to
    // distinguish that from the one nobody turned up for (NO_SHOW).
    if (visitor.appointmentId) {
      await this.appointments.update(visitor.appointmentId, {
        status: AppointmentStatus.COMPLETED,
      });
    }

    const [view] = await this.decorate([visitor], user.schoolId);
    return view;
  }

  async checkOut(
    id: string,
    dto: CheckOutVisitorDto,
    user: AccessTokenPayload,
  ): Promise<VisitorView> {
    const visitor = await this.visitors.findDetail(id, user.schoolId);
    if (!visitor) throw new NotFoundException(`Visitor ${id} not found`);
    if (visitor.checkOut) {
      throw new ConflictException(
        `${visitor.name} was already signed out at ${visitor.checkOut.toISOString().slice(11, 16)}`,
      );
    }

    const updated = await this.visitors.update(id, {
      checkOut: new Date(),
      // A human signed them out. `auto_checked_out` stays false, so the
      // register can tell "left at 16:40" from "was still signed in when
      // we locked up" — see the day-end sweep.
      autoCheckedOut: false,
      ...(dto.remarks ? { remarks: dto.remarks } : {}),
      updatedBy: user.sub,
    });

    this.audit.set({
      entityType: 'Visitor',
      entityId: id,
      oldValues: { checkOut: null },
      newValues: { checkOut: updated.checkOut },
    });

    const [view] = await this.decorate([updated], user.schoolId);
    return view;
  }

  async update(
    id: string,
    dto: UpdateVisitorDto,
    user: AccessTokenPayload,
  ): Promise<VisitorView> {
    await this.get(id, user);
    const updated = await this.visitors.update(id, {
      ...(dto.whomToMeet !== undefined ? { whomToMeet: dto.whomToMeet } : {}),
      ...(dto.cardNo !== undefined ? { cardNo: dto.cardNo } : {}),
      ...(dto.photoUrl !== undefined ? { photoUrl: dto.photoUrl } : {}),
      ...(dto.remarks !== undefined ? { remarks: dto.remarks } : {}),
      updatedBy: user.sub,
    });
    const [view] = await this.decorate([updated], user.schoolId);
    return view;
  }

  async remove(id: string, user: AccessTokenPayload): Promise<void> {
    const visitor = await this.get(id, user);
    await this.visitors.softDelete(id);
    this.audit.set({
      entityType: 'Visitor',
      entityId: id,
      oldValues: { name: visitor.name, checkIn: visitor.checkIn },
    });
  }

  // ── appointments ────────────────────────────────────────────────────

  async listAppointments(query: AppointmentQueryDto, user: AccessTokenPayload) {
    const { rows, total } = await this.appointments.findMany(
      user.schoolId,
      {
        status: query.status,
        hostType: query.hostType,
        hostId: query.hostId,
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
        search: query.search,
      },
      query.page,
      query.limit,
    );

    const names = await this.hostNames(user.schoolId, rows);
    return {
      data: rows.map((row) => ({
        ...row,
        hostName: names.get(`${row.hostType}:${row.hostId}`) ?? null,
      })),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  async getAppointment(
    id: string,
    user: AccessTokenPayload,
  ): Promise<Appointment> {
    const appointment = await this.appointments.findDetail(id, user.schoolId);
    if (!appointment)
      throw new NotFoundException(`Appointment ${id} not found`);
    return appointment;
  }

  async createAppointment(
    dto: UpsertAppointmentDto,
    user: AccessTokenPayload,
  ): Promise<Appointment> {
    const host = await this.directory.host(
      user.schoolId,
      dto.hostType,
      dto.hostId,
    );
    if (!host)
      throw new NotFoundException('That member of staff is not on file');

    const created = await this.appointments.create({
      schoolId: user.schoolId,
      visitorName: dto.visitorName,
      phone: dto.phone,
      email: dto.email ?? null,
      purpose: dto.purpose,
      hostType: dto.hostType,
      hostId: dto.hostId,
      scheduledAt: new Date(dto.scheduledAt),
      notes: dto.notes ?? null,
      createdBy: user.sub,
    });

    this.audit.set({
      entityType: 'Appointment',
      entityId: created.id,
      newValues: {
        visitorName: created.visitorName,
        scheduledAt: created.scheduledAt,
      },
    });
    return created;
  }

  async updateAppointment(
    id: string,
    dto: UpsertAppointmentDto,
    user: AccessTokenPayload,
  ): Promise<Appointment> {
    const existing = await this.getAppointment(id, user);
    if (existing.status !== AppointmentStatus.PENDING) {
      throw new ConflictException(
        `A ${existing.status} appointment cannot be edited — record the outcome instead`,
      );
    }
    return this.appointments.update(id, {
      visitorName: dto.visitorName,
      phone: dto.phone,
      email: dto.email ?? null,
      purpose: dto.purpose,
      hostType: dto.hostType,
      hostId: dto.hostId,
      scheduledAt: new Date(dto.scheduledAt),
      notes: dto.notes ?? null,
      updatedBy: user.sub,
    });
  }

  async decideAppointment(
    id: string,
    dto: DecideAppointmentDto,
    user: AccessTokenPayload,
  ): Promise<Appointment> {
    const existing = await this.getAppointment(id, user);
    const verdict = canMoveAppointment(existing.status, dto.status);
    if (!verdict.allowed) throw new ConflictException(verdict.reason);

    if (dto.status === AppointmentStatus.REJECTED && !dto.note?.trim()) {
      // The CHECK demands it, and so does the visitor: "no" is the answer
      // somebody will ring back about.
      throw new BadRequestException(
        'Say why the appointment was refused — the visitor will ask',
      );
    }

    const decided =
      dto.status === AppointmentStatus.APPROVED ||
      dto.status === AppointmentStatus.REJECTED;

    const updated = await this.appointments.update(id, {
      status: dto.status,
      ...(decided ? { decidedBy: user.sub, decidedAt: new Date() } : {}),
      ...(dto.note !== undefined ? { decidedNote: dto.note } : {}),
      updatedBy: user.sub,
    });

    this.audit.set({
      entityType: 'Appointment',
      entityId: id,
      oldValues: { status: existing.status },
      newValues: { status: dto.status },
    });

    if (decided) {
      const cfg = await this.config.load(user.schoolId);
      await this.notifications.announceAppointmentDecision(updated, cfg);
    }
    return updated;
  }

  async removeAppointment(id: string, user: AccessTokenPayload): Promise<void> {
    const existing = await this.getAppointment(id, user);
    await this.appointments.softDelete(id);
    this.audit.set({
      entityType: 'Appointment',
      entityId: id,
      oldValues: { visitorName: existing.visitorName },
    });
  }

  // ── internals ───────────────────────────────────────────────────────

  private async decorate(
    rows: Visitor[],
    schoolId: string,
  ): Promise<VisitorView[]> {
    const names = await this.hostNames(schoolId, rows);
    const now = new Date();
    return rows.map((visitor) => ({
      ...visitor,
      hostName:
        visitor.hostType && visitor.hostId
          ? (names.get(`${visitor.hostType}:${visitor.hostId}`) ?? null)
          : (visitor.whomToMeet ?? null),
      inside: isInside(visitor),
      durationMinutes: visitDurationMinutes(visitor, now),
    }));
  }

  private async hostNames(
    schoolId: string,
    rows: Array<{ hostType: string | null; hostId: string | null }>,
  ): Promise<Map<string, string>> {
    const needed = rows.some((row) => row.hostType && row.hostId);
    if (!needed) return new Map();
    const hosts = await this.directory.hosts(schoolId);
    return new Map(
      hosts.map((host) => [`${host.hostType}:${host.hostId}`, host.name]),
    );
  }
}
