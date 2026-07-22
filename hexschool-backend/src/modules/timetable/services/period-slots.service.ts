import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PeriodSlot, Shift } from '@prisma/client';
import { PeriodSlotType } from '../../../common/constants';
import {
  minutesOfDay,
  timeColumnMinutes,
} from '../../../common/utils/clock.util';
import { ShiftsRepository } from '../../academic/repositories/shifts.repository';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import {
  findOverlap,
  minutesLabel,
  SlotWindow,
  withinShift,
} from '../calc/slot-schedule.util';
import { CreatePeriodSlotDto, UpdatePeriodSlotDto } from '../dto';
import { PeriodSlotsRepository } from '../repositories/period-slots.repository';

/** A slot as the API returns it — times are HH:mm, not TIME columns. */
export interface PeriodSlotView {
  id: string;
  shiftId: string;
  shiftName?: string;
  name: string;
  startTime: string;
  endTime: string;
  startMinutes: number;
  endMinutes: number;
  type: PeriodSlotType;
  displayOrder: number;
}

/**
 * The bell schedule of each shift (roadmap M13 §4). Slots are validated
 * against their shift's working window and against each other — an
 * overlapping pair would make "which period is it now" ambiguous and let
 * the conflict engine disagree with itself.
 *
 * A `TIME(0)` column round-trips through Prisma as a 1970-01-01 Date, so
 * everything here converts to minutes-of-day at the boundary and the
 * arithmetic stays in plain integers.
 */
@Injectable()
export class PeriodSlotsService {
  constructor(
    private readonly slots: PeriodSlotsRepository,
    private readonly shifts: ShiftsRepository,
    private readonly auditContext: AuditContextService,
  ) {}

  // ── read ────────────────────────────────────────────────────────────

  async list(
    shiftId: string | undefined,
    schoolId: string,
  ): Promise<PeriodSlotView[]> {
    if (shiftId) {
      await this.loadShift(shiftId, schoolId);
      const rows = await this.slots.findForShift(shiftId, schoolId);
      return rows.map((row) => this.toView(row));
    }
    const rows = await this.slots.findAllWithShift(schoolId);
    return rows.map((row) => ({
      ...this.toView(row),
      shiftName: row.shift.name,
    }));
  }

  async getById(id: string, schoolId: string): Promise<PeriodSlotView> {
    return this.toView(await this.loadSlot(id, schoolId));
  }

  // ── write ───────────────────────────────────────────────────────────

  async create(
    dto: CreatePeriodSlotDto,
    actor: AccessTokenPayload,
  ): Promise<PeriodSlotView> {
    const schoolId = actor.schoolId;
    const shift = await this.loadShift(dto.shiftId, schoolId);
    const siblings = await this.slots.findForShift(dto.shiftId, schoolId);

    const displayOrder =
      dto.displayOrder ??
      Math.max(0, ...siblings.map((s) => s.displayOrder)) + 1;

    await this.assertPlaceable(
      {
        id: 'new',
        name: dto.name,
        startMinutes: minutesOfDay(dto.startTime),
        endMinutes: minutesOfDay(dto.endTime),
      },
      shift,
      siblings,
      { shiftId: dto.shiftId, name: dto.name, displayOrder },
    );

    const created = await this.slots.create({
      schoolId,
      shiftId: dto.shiftId,
      name: dto.name,
      startTime: this.timeValue(dto.startTime),
      endTime: this.timeValue(dto.endTime),
      type: dto.type ?? PeriodSlotType.CLASS,
      displayOrder,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'PeriodSlot',
      entityId: created.id,
      newValues: {
        shiftId: dto.shiftId,
        name: dto.name,
        startTime: dto.startTime,
        endTime: dto.endTime,
        type: created.type,
        displayOrder,
      },
    });
    return this.toView(created);
  }

  async update(
    id: string,
    dto: UpdatePeriodSlotDto,
    actor: AccessTokenPayload,
  ): Promise<PeriodSlotView> {
    const schoolId = actor.schoolId;
    const slot = await this.loadSlot(id, schoolId);
    const shift = await this.loadShift(slot.shiftId, schoolId);
    const siblings = (
      await this.slots.findForShift(slot.shiftId, schoolId)
    ).filter((s) => s.id !== id);

    const startMinutes = dto.startTime
      ? minutesOfDay(dto.startTime)
      : timeColumnMinutes(slot.startTime);
    const endMinutes = dto.endTime
      ? minutesOfDay(dto.endTime)
      : timeColumnMinutes(slot.endTime);
    const name = dto.name ?? slot.name;
    const displayOrder = dto.displayOrder ?? slot.displayOrder;

    await this.assertPlaceable(
      { id, name, startMinutes, endMinutes },
      shift,
      siblings,
      { shiftId: slot.shiftId, name, displayOrder, excludeId: id },
    );

    // Moving a slot's times silently re-dates attendance that was marked
    // against it, so require the period to be unused for a time change.
    if (dto.startTime || dto.endTime) {
      const marked = await this.slots.countAttendance(id);
      if (marked > 0) {
        throw new ConflictException(
          `${marked} attendance record(s) were marked in this period — retiring it and adding a new slot keeps that history honest`,
        );
      }
    }

    const updated = await this.slots.update(id, {
      name,
      ...(dto.startTime ? { startTime: this.timeValue(dto.startTime) } : {}),
      ...(dto.endTime ? { endTime: this.timeValue(dto.endTime) } : {}),
      ...(dto.type ? { type: dto.type } : {}),
      displayOrder,
      updatedBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'PeriodSlot',
      entityId: id,
      oldValues: {
        name: slot.name,
        startTime: minutesLabel(timeColumnMinutes(slot.startTime)),
        endTime: minutesLabel(timeColumnMinutes(slot.endTime)),
        type: slot.type,
        displayOrder: slot.displayOrder,
      },
      newValues: {
        name,
        startTime: minutesLabel(startMinutes),
        endTime: minutesLabel(endMinutes),
        type: updated.type,
        displayOrder,
      },
    });
    return this.toView(updated);
  }

  /**
   * Soft delete, guarded: a slot still holding routine cells or backing
   * attendance rows stays, with an explanatory 409 (the M06 convention).
   */
  async remove(id: string, actor: AccessTokenPayload): Promise<void> {
    const slot = await this.loadSlot(id, actor.schoolId);

    const [entries, marked] = await Promise.all([
      this.slots.countEntries(id),
      this.slots.countAttendance(id),
    ]);
    if (entries > 0) {
      throw new ConflictException(
        `${entries} routine cell(s) use this period — clear them first`,
      );
    }
    if (marked > 0) {
      throw new ConflictException(
        `${marked} attendance record(s) were marked in this period — it cannot be deleted`,
      );
    }

    await this.slots.softDelete(id);
    this.auditContext.set({
      entityType: 'PeriodSlot',
      entityId: id,
      oldValues: { shiftId: slot.shiftId, name: slot.name },
    });
  }

  // ── internals ───────────────────────────────────────────────────────

  private async loadSlot(id: string, schoolId: string): Promise<PeriodSlot> {
    const slot = await this.slots.findById(id, schoolId);
    if (!slot) throw new NotFoundException(`Period slot ${id} not found`);
    return slot;
  }

  private async loadShift(id: string, schoolId: string): Promise<Shift> {
    const shift = await this.shifts.findById(id, schoolId);
    if (!shift) throw new NotFoundException(`Shift ${id} not found`);
    return shift;
  }

  /**
   * The two structural rules (roadmap M13 §7): inside the shift's window
   * and not overlapping a sibling. Name/order duplicates are checked here
   * too so the caller gets a readable 409 instead of a raw unique-index
   * violation from `uq_period_slots_name` / `_order`.
   */
  private async assertPlaceable(
    candidate: SlotWindow,
    shift: Shift,
    siblings: PeriodSlot[],
    identity: {
      shiftId: string;
      name: string;
      displayOrder: number;
      excludeId?: string;
    },
  ): Promise<void> {
    if (candidate.startMinutes >= candidate.endMinutes) {
      throw new BadRequestException('Start time must be before end time');
    }

    const bounds = {
      startMinutes: timeColumnMinutes(shift.startTime),
      endMinutes: timeColumnMinutes(shift.endTime),
    };
    if (!withinShift(candidate, bounds)) {
      throw new BadRequestException(
        `Period must sit inside the ${shift.name} shift (${minutesLabel(bounds.startMinutes)}–${minutesLabel(bounds.endMinutes)})`,
      );
    }

    const clash = findOverlap(
      candidate,
      siblings.map((s) => ({
        id: s.id,
        name: s.name,
        startMinutes: timeColumnMinutes(s.startTime),
        endMinutes: timeColumnMinutes(s.endTime),
      })),
    );
    if (clash) {
      throw new ConflictException(
        `Overlaps "${clash.name}" (${minutesLabel(clash.startMinutes)}–${minutesLabel(clash.endMinutes)})`,
      );
    }

    const byName = await this.slots.findByIdentity({
      shiftId: identity.shiftId,
      name: identity.name,
      ...(identity.excludeId ? { excludeId: identity.excludeId } : {}),
    });
    if (byName) {
      throw new ConflictException(
        `This shift already has a period named "${identity.name}"`,
      );
    }

    const byOrder = await this.slots.findByIdentity({
      shiftId: identity.shiftId,
      displayOrder: identity.displayOrder,
      ...(identity.excludeId ? { excludeId: identity.excludeId } : {}),
    });
    if (byOrder) {
      throw new ConflictException(
        `Position ${identity.displayOrder} is taken by "${byOrder.name}"`,
      );
    }
  }

  /** HH:mm → the 1970-01-01 Date a `TIME(0)` column round-trips as. */
  private timeValue(value: string): Date {
    return new Date(`1970-01-01T${value}:00.000Z`);
  }

  private toView(slot: PeriodSlot): PeriodSlotView {
    const startMinutes = timeColumnMinutes(slot.startTime);
    const endMinutes = timeColumnMinutes(slot.endTime);
    return {
      id: slot.id,
      shiftId: slot.shiftId,
      name: slot.name,
      startTime: minutesLabel(startMinutes),
      endTime: minutesLabel(endMinutes),
      startMinutes,
      endMinutes,
      type: slot.type,
      displayOrder: slot.displayOrder,
    };
  }
}
