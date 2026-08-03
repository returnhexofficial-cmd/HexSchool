import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { SettingsService } from '../../school/services/settings.service';
import { billableHeads, monthlyLines } from '../calc/hostel-fee.engine';
import { residencyWindow } from '../calc/residency.engine';
import { firstOfMonth, MONTH_SHAPE } from '../calc/types';
import type { HostelCharge, HostelFeeSource } from '../hostel.constants';

/**
 * **The M16 integration, and the only part of this module M16 knows
 * about.**
 *
 * Bound to `HOSTEL_FEE_SOURCE` **inside FeeModule**, over `PrismaService`
 * and `SettingsService` alone — the M13 `RoutineConflictChecker` / M23
 * `LibraryClearanceService` / M25 `TransportFeeService` pattern, fourth
 * use. FeeModule importing HostelModule would close a cycle: HostelModule
 * imports FeeModule for the vacate dues gate and AccountingModule for the
 * deposit voucher, and AccountingModule imports FeeModule.
 *
 * Four properties matter to the caller:
 *
 *   1. **The amounts are already prorated.** M16 must add these lines
 *      with `prorated: false`, or a mid-month arrival would be prorated
 *      twice — 21/31 of 21/31 — which is the kind of error nobody spots
 *      because the number still looks plausible (the M25 rule).
 *   2. **Two lines, not one.** Seat rent and mess are separate fee heads
 *      because they move independently and a parent asks about one or
 *      the other. The meal-off credit is netted into the mess line, so a
 *      "credit" head never appears in the school's fee reports as an
 *      income line that is always negative.
 *   3. **A day student is ABSENT from the map, not a zero.** A zero would
 *      put an empty "Hostel — ৳0.00" line on the bill of every family
 *      whose child lives at home.
 *   4. **Nothing here throws.** A misconfigured fee head, the hostel
 *      switched off, an empty building — all return an empty map, because
 *      the alternative is a school's entire monthly invoice run failing
 *      over a module it may not even use (the M20 "an auto-post failure
 *      is logged, never rethrown" rule, one level up).
 */
@Injectable()
export class HostelFeeService implements HostelFeeSource {
  private readonly logger = new Logger(HostelFeeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async monthlyCharges(
    schoolId: string,
    enrollmentIds: string[],
    month: string,
  ): Promise<Map<string, HostelCharge>> {
    const charges = new Map<string, HostelCharge>();
    if (enrollmentIds.length === 0 || !MONTH_SHAPE.test(month)) return charges;

    try {
      const [
        enabled,
        autoInvoice,
        prorate,
        rentHeadId,
        rentHeadName,
        messHeadId,
        messHeadName,
        dayRate,
      ] = await Promise.all([
        this.settings.getValue<boolean>(schoolId, 'hostel.enabled'),
        this.settings.getValue<boolean>(schoolId, 'hostel.auto_invoice'),
        this.settings.getValue<boolean>(schoolId, 'hostel.prorate_enabled'),
        this.settings.getValue<string>(schoolId, 'hostel.fee_head_id'),
        this.settings.getValue<string>(schoolId, 'hostel.fee_head_name'),
        this.settings.getValue<string>(schoolId, 'hostel.mess_fee_head_id'),
        this.settings.getValue<string>(schoolId, 'hostel.mess_fee_head_name'),
        this.settings.getValue<number>(schoolId, 'hostel.mess_day_rate'),
      ]);

      if (enabled === false || autoInvoice === false) return charges;

      const rentHead = await this.resolveFeeHead(
        schoolId,
        String(rentHeadId ?? ''),
        String(rentHeadName ?? 'Hostel'),
      );
      if (!rentHead) {
        this.logger.warn(
          `Boarders exist but no "${rentHeadName ?? 'Hostel'}" fee head is configured — no hostel line was billed. Create the head, or set hostel.fee_head_id.`,
        );
        return charges;
      }
      // The mess head is optional: a school that charges one combined
      // figure simply has no mess plans, and falling back to the rent
      // head would silently merge two things the module keeps apart.
      const messHead = await this.resolveFeeHead(
        schoolId,
        String(messHeadId ?? ''),
        String(messHeadName ?? 'Mess'),
      );

      const allocations = await this.prisma.hostelAllocation.findMany({
        where: {
          schoolId,
          deletedAt: null,
          enrollmentId: { in: enrollmentIds },
          // VACATED rows are INCLUDED deliberately: a boarder who left on
          // the 12th still owes for the first eleven nights, and the
          // window arithmetic decides that — not the status.
        },
        select: {
          id: true,
          enrollmentId: true,
          startDate: true,
          endDate: true,
          suspendedAt: true,
          resumedAt: true,
          status: true,
          hostel: { select: { name: true } },
          bed: {
            select: {
              bedNo: true,
              room: { select: { roomNo: true, monthlyFee: true } },
            },
          },
          messEnrollments: {
            where: { deletedAt: null },
            select: {
              startDate: true,
              endDate: true,
              plan: { select: { name: true, monthlyCharge: true } },
            },
          },
        },
      });
      if (allocations.length === 0) return charges;

      // The credit month is a stored fact decided at approval — see
      // `MessService.decideMealOff`. That makes this a plain equality and
      // regenerating a month give the same answer.
      const creditRows = await this.prisma.mealOff.findMany({
        where: {
          schoolId,
          deletedAt: null,
          status: 'APPROVED',
          creditMonth: new Date(`${firstOfMonth(month)}T00:00:00.000Z`),
          allocationId: { in: allocations.map((a) => a.id) },
        },
        select: { allocationId: true, fromDate: true, toDate: true },
      });
      const creditsByAllocation = new Map<
        string,
        Array<{ fromDate: string; toDate: string }>
      >();
      for (const row of creditRows) {
        const list = creditsByAllocation.get(row.allocationId) ?? [];
        list.push({ fromDate: iso(row.fromDate), toDate: iso(row.toDate) });
        creditsByAllocation.set(row.allocationId, list);
      }

      for (const allocation of allocations) {
        const window = residencyWindow({
          startDate: iso(allocation.startDate),
          endDate: allocation.endDate ? iso(allocation.endDate) : null,
          suspendedAt: allocation.suspendedAt
            ? iso(allocation.suspendedAt)
            : null,
          resumedAt: allocation.resumedAt ? iso(allocation.resumedAt) : null,
          status: allocation.status,
        });

        // The mess enrolment covering this month, if any. A boarder who
        // changed plan mid-month has two rows; the one whose window
        // reaches furthest into the month is the one billed, and the
        // engine's intersection prorates it.
        const mess = pickMess(allocation.messEnrollments, month);
        const credits = (creditsByAllocation.get(allocation.id) ?? []).map(
          (entry) => ({
            ...entry,
            monthlyCharge: mess ? Number(mess.plan.monthlyCharge) : 0,
          }),
        );

        const built = monthlyLines({
          month,
          hostelName: allocation.hostel.name,
          roomNo: allocation.bed.room.roomNo,
          roomFee: Number(allocation.bed.room.monthlyFee),
          residency: window,
          mess:
            mess && messHead
              ? {
                  planName: mess.plan.name,
                  monthlyCharge: Number(mess.plan.monthlyCharge),
                  window: {
                    from: iso(mess.startDate),
                    to: mess.endDate ? iso(mess.endDate) : null,
                  },
                }
              : null,
          mealOffs: credits,
          messDayRate: Number(dayRate ?? 0),
          prorate: prorate !== false,
        });

        const heads = billableHeads(built);
        if (heads.length === 0) continue;

        const lines = heads.map((head) => ({
          feeHeadId:
            head.kind === 'RENT' ? rentHead.id : (messHead?.id ?? rentHead.id),
          amount: head.amount,
          description: head.description,
        }));

        const rentLine = built.lines.find((line) => line.kind === 'RENT');

        // Two allocations can touch one month — a boarder who moved
        // between buildings. Adding them is right: they slept in both.
        const existing = charges.get(allocation.enrollmentId);
        if (existing) {
          existing.lines.push(...lines);
          existing.total = round(existing.total + built.total);
          existing.creditDays += built.credit.days;
          continue;
        }

        charges.set(allocation.enrollmentId, {
          enrollmentId: allocation.enrollmentId,
          lines,
          total: built.total,
          hostelName: allocation.hostel.name,
          roomNo: allocation.bed.room.roomNo,
          bedNo: allocation.bed.bedNo,
          residentDays: rentLine?.days ?? 0,
          daysInMonth: rentLine?.daysInMonth ?? 0,
          creditDays: built.credit.days,
        });
      }
    } catch (error) {
      this.logger.error(
        `Hostel charges for ${month} could not be computed — invoices were generated WITHOUT hostel lines: ${(error as Error).message}`,
      );
      return new Map();
    }

    return charges;
  }

  /**
   * The configured head first, then a live head whose name matches — the
   * M20 posting-map fallback shape, so a school that simply created a
   * head called "Hostel" bills correctly with nothing configured.
   */
  private async resolveFeeHead(
    schoolId: string,
    configuredId: string,
    fallbackName: string,
  ): Promise<{ id: string; name: string } | null> {
    if (/^[0-9a-f-]{36}$/i.test(configuredId)) {
      const byId = await this.prisma.feeHead.findFirst({
        where: { id: configuredId, schoolId, deletedAt: null },
        select: { id: true, name: true },
      });
      if (byId) return byId;
    }
    return this.prisma.feeHead.findFirst({
      where: {
        schoolId,
        deletedAt: null,
        name: { equals: fallbackName, mode: 'insensitive' },
      },
      select: { id: true, name: true },
    });
  }
}

/**
 * The mess enrolment that governs this month. A boarder who switched
 * plans on the 12th has a closed window and an open one; the later start
 * wins, because it is the plan they are on now and its window is what the
 * engine intersects. Windows that ended before the month began are
 * dropped outright.
 */
function pickMess<T extends { startDate: Date; endDate: Date | null }>(
  rows: T[],
  month: string,
): T | null {
  const monthStart = `${month}-01`;
  const candidates = rows.filter(
    (row) => row.endDate === null || iso(row.endDate) >= monthStart,
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((latest, row) =>
    iso(row.startDate) > iso(latest.startDate) ? row : latest,
  );
}

function iso(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
