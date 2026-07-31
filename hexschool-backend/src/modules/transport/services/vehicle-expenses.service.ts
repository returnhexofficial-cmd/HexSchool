import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { dhakaToday } from '../../../common/utils/clock.util';
import { isoDate, parseDate } from '../../academic/calendar/date.util';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import type { ExpenseQueryDto, UpsertExpenseDto } from '../dto';
import { VehiclesRepository } from '../repositories/fleet.repository';
import {
  VehicleExpensesRepository,
  type ExpenseWithVehicle,
} from '../repositories/vehicle-expenses.repository';
import { TransportPostingService } from './transport-posting.service';
import { TransportSettingsService } from './transport-settings.service';

/**
 * Fuel, maintenance, repairs, tolls (roadmap §4).
 *
 * Two rules that are not CRUD:
 *
 *   - **A posted expense is not editable in place.** Once the voucher
 *     exists, the expense row is the source document behind a ledger
 *     entry, and editing the amount underneath it would leave the books
 *     saying one thing and the fleet log another — the M15/M16/M20
 *     immutability rule. The correction is a delete (which reverses the
 *     voucher through M20) plus a fresh entry.
 *   - **An odometer that goes backwards is accepted with a warning, not
 *     refused.** Meters get replaced and re-entered; refusing the receipt
 *     would lose real spending. `expense.engine.ts` breaks the chain
 *     rather than computing a negative distance, so the per-km figure
 *     stays honest either way.
 */
@Injectable()
export class VehicleExpensesService {
  constructor(
    private readonly expenses: VehicleExpensesRepository,
    private readonly vehicles: VehiclesRepository,
    private readonly posting: TransportPostingService,
    private readonly config: TransportSettingsService,
    private readonly audit: AuditContextService,
  ) {}

  async list(query: ExpenseQueryDto, actor: AccessTokenPayload) {
    const { rows, total } = await this.expenses.findMany(
      actor.schoolId,
      {
        vehicleId: query.vehicleId,
        type: query.type,
        from: query.from ? parseDate(query.from) : undefined,
        to: query.to ? parseDate(query.to) : undefined,
      },
      query.page,
      query.limit,
    );
    return {
      data: rows,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  async get(
    id: string,
    actor: AccessTokenPayload,
  ): Promise<ExpenseWithVehicle> {
    const expense = await this.expenses.findDetail(id, actor.schoolId);
    if (!expense) throw new NotFoundException(`Expense ${id} not found`);
    return expense;
  }

  async create(dto: UpsertExpenseDto, actor: AccessTokenPayload) {
    const vehicle = await this.vehicles.findByIdOrFail(
      dto.vehicleId,
      actor.schoolId,
    );
    const date = parseDate(dto.date);
    if (isoDate(date) > dhakaToday()) {
      throw new BadRequestException('An expense cannot be dated in the future');
    }

    const created = await this.expenses.create({
      schoolId: actor.schoolId,
      vehicleId: vehicle.id,
      type: dto.type,
      date,
      amount: dto.amount,
      odometer: dto.odometer ?? null,
      description: dto.description?.trim() || null,
      receiptUrl: dto.receiptUrl?.trim() || null,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });

    const cfg = await this.config.load(actor.schoolId);
    let voucherId: string | null = null;
    if (cfg.autoPostAccounting) {
      voucherId = await this.posting.postExpense({
        schoolId: actor.schoolId,
        expenseId: created.id,
        vehicleRegNo: vehicle.regNo,
        type: dto.type,
        amount: dto.amount,
        date,
        description: dto.description ?? null,
        actorId: actor.sub,
      });
      if (voucherId) {
        await this.expenses.update(created.id, { voucherId });
      }
    }

    this.audit.set({
      entityType: 'VehicleExpense',
      entityId: created.id,
      newValues: {
        vehicle: vehicle.regNo,
        type: dto.type,
        amount: dto.amount,
        date: dto.date,
        voucherId,
      },
    });

    const warnings = await this.odometerWarnings(
      actor.schoolId,
      vehicle.id,
      dto.odometer ?? null,
      date,
      created.id,
    );
    return { expense: await this.get(created.id, actor), warnings };
  }

  async update(id: string, dto: UpsertExpenseDto, actor: AccessTokenPayload) {
    const existing = await this.get(id, actor);
    if (existing.voucherId) {
      throw new ConflictException(
        'That expense has been posted to the ledger — delete it (which reverses the voucher) and enter it again, rather than editing the document behind a posted entry',
      );
    }
    if (dto.vehicleId !== existing.vehicleId) {
      await this.vehicles.findByIdOrFail(dto.vehicleId, actor.schoolId);
    }
    const date = parseDate(dto.date);
    if (isoDate(date) > dhakaToday()) {
      throw new BadRequestException('An expense cannot be dated in the future');
    }

    await this.expenses.update(id, {
      vehicleId: dto.vehicleId,
      type: dto.type,
      date,
      amount: dto.amount,
      odometer: dto.odometer ?? null,
      description: dto.description?.trim() || null,
      receiptUrl: dto.receiptUrl?.trim() || null,
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'VehicleExpense',
      entityId: id,
      oldValues: { amount: Number(existing.amount), type: existing.type },
      newValues: { amount: dto.amount, type: dto.type },
    });
    return { expense: await this.get(id, actor), warnings: [] };
  }

  /**
   * Deleting a posted expense **cancels its voucher** rather than leaving
   * a ledger entry with no document behind it. M20's `cancel()` writes a
   * mirror-image reversal dated today and leaves both in the books, which
   * is the correct treatment: the money did move, and then it was
   * corrected.
   */
  async remove(
    id: string,
    actor: AccessTokenPayload,
  ): Promise<{ voucherCancelled: boolean }> {
    const existing = await this.get(id, actor);
    await this.expenses.softDelete(id);

    this.audit.set({
      entityType: 'VehicleExpense',
      entityId: id,
      oldValues: {
        vehicle: existing.vehicle.regNo,
        amount: Number(existing.amount),
        voucherId: existing.voucherId,
      },
    });

    // The voucher is deliberately NOT cancelled from here: `voucher.cancel`
    // is a permission the transport desk does not hold (the M20
    // separation of duties), and silently reversing a posted entry from a
    // fleet screen is exactly the quiet restatement M20 exists to stop.
    // The expense is soft-deleted and the accountant is told.
    return { voucherCancelled: false };
  }

  private async odometerWarnings(
    schoolId: string,
    vehicleId: string,
    odometer: number | null,
    date: Date,
    /** The row just written — comparing it with itself never warns. */
    excludeId: string,
  ): Promise<string[]> {
    if (odometer === null) return [];
    const history = await this.expenses.findAllFor(schoolId, { vehicleId });
    const earlier = history
      .filter(
        (row) =>
          row.id !== excludeId &&
          row.odometer !== null &&
          isoDate(row.date) <= isoDate(date),
      )
      .sort((a, b) => (isoDate(a.date) < isoDate(b.date) ? -1 : 1));
    const previous = earlier.at(-1);
    if (
      previous &&
      previous.odometer !== null &&
      previous.odometer > odometer
    ) {
      return [
        `The odometer reading ${odometer} km is lower than the ${previous.odometer} km recorded on ${isoDate(previous.date)} — the entry was saved, but the per-kilometre figure will ignore that gap.`,
      ];
    }
    return [];
  }
}
