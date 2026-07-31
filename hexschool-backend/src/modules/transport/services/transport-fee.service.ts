import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { SettingsService } from '../../school/services/settings.service';
import {
  chargeDescription,
  monthlyCharge,
  serviceWindow,
  type AssignmentDates,
} from '../calc/transport-fee.engine';
import type {
  TransportCharge,
  TransportFeeSource,
} from '../transport.constants';

/**
 * **The M16 integration, and the only part of this module M16 knows
 * about.**
 *
 * Bound to `TRANSPORT_FEE_SOURCE` **inside FeeModule**, over
 * `PrismaService` and `SettingsService` alone — the M13
 * `RoutineConflictChecker` / M23 `LibraryClearanceService` pattern.
 * FeeModule importing TransportModule would close a cycle: Transport →
 * Accounting (the expense voucher) → Fee.
 *
 * Three properties matter to the caller and are worth stating plainly:
 *
 *   1. **The amount is already prorated.** The invoice engine must add
 *      the line with `prorated: false`, or a mid-month joiner would be
 *      prorated twice — 21/31 of 21/31 — which is the kind of error
 *      nobody spots because the number still looks plausible.
 *   2. **A rider with no live assignment is ABSENT from the map, not a
 *      zero.** A zero would put an empty "Transport — ৳0.00" line on the
 *      bill of every family that does not use the bus.
 *   3. **Nothing here throws.** A misconfigured fee head, transport
 *      switched off, an empty fleet — all return an empty map, because
 *      the alternative is a school's entire monthly invoice run failing
 *      over a module it may not even use. Failures are logged
 *      (the M20 "an auto-post failure is logged, never rethrown" rule,
 *      applied one level up).
 */
@Injectable()
export class TransportFeeService implements TransportFeeSource {
  private readonly logger = new Logger(TransportFeeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async monthlyCharges(
    schoolId: string,
    enrollmentIds: string[],
    month: string,
  ): Promise<Map<string, TransportCharge>> {
    const charges = new Map<string, TransportCharge>();
    if (enrollmentIds.length === 0) return charges;

    try {
      const [enabled, autoInvoice, prorate, feeHeadId, feeHeadName] =
        await Promise.all([
          this.settings.getValue<boolean>(schoolId, 'transport.enabled'),
          this.settings.getValue<boolean>(schoolId, 'transport.auto_invoice'),
          this.settings.getValue<boolean>(
            schoolId,
            'transport.prorate_enabled',
          ),
          this.settings.getValue<string>(schoolId, 'transport.fee_head_id'),
          this.settings.getValue<string>(schoolId, 'transport.fee_head_name'),
        ]);

      if (enabled === false || autoInvoice === false) return charges;

      const head = await this.resolveFeeHead(
        schoolId,
        String(feeHeadId ?? ''),
        String(feeHeadName ?? 'Transport'),
      );
      if (!head) {
        this.logger.warn(
          `Transport riders exist but no "${feeHeadName ?? 'Transport'}" fee head is configured — no transport line was billed. Create the head, or set transport.fee_head_id.`,
        );
        return charges;
      }

      const assignments = await this.prisma.transportAssignment.findMany({
        where: {
          schoolId,
          deletedAt: null,
          enrollmentId: { in: enrollmentIds },
        },
        select: {
          enrollmentId: true,
          startDate: true,
          endDate: true,
          suspendedAt: true,
          resumedAt: true,
          status: true,
          route: { select: { name: true } },
          stop: { select: { name: true, monthlyFee: true } },
        },
      });

      for (const assignment of assignments) {
        const window = serviceWindow(toDates(assignment));
        const charge = monthlyCharge({
          monthlyFee: Number(assignment.stop.monthlyFee),
          month,
          window,
          prorate: prorate !== false,
        });
        if (charge.amount <= 0) continue;

        // The one-live-assignment index makes a second row for the same
        // enrollment impossible among ACTIVE/SUSPENDED, but an ENDED row
        // and a new one can both touch the same month — a rider who
        // changed route mid-month. Adding them is right: they travelled
        // on both.
        const existing = charges.get(assignment.enrollmentId);
        if (existing) {
          existing.amount = round(existing.amount + charge.amount);
          existing.servedDays += charge.servedDays;
          existing.description = `${existing.description}; ${chargeDescription(
            assignment.route.name,
            assignment.stop.name,
            charge,
          )}`;
          continue;
        }

        charges.set(assignment.enrollmentId, {
          enrollmentId: assignment.enrollmentId,
          feeHeadId: head.id,
          amount: charge.amount,
          description: chargeDescription(
            assignment.route.name,
            assignment.stop.name,
            charge,
          ),
          routeName: assignment.route.name,
          stopName: assignment.stop.name,
          servedDays: charge.servedDays,
          daysInMonth: charge.daysInMonth,
        });
      }
    } catch (error) {
      this.logger.error(
        `Transport charges for ${month} could not be computed — invoices were generated WITHOUT a transport line: ${(error as Error).message}`,
      );
      return new Map();
    }

    return charges;
  }

  /**
   * The configured head first, then a live head whose name matches — the
   * M20 posting-map fallback shape, so a school that simply created a
   * head called "Transport" bills correctly with nothing configured.
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

function toDates(row: {
  startDate: Date;
  endDate: Date | null;
  suspendedAt: Date | null;
  resumedAt: Date | null;
  status: string;
}): AssignmentDates {
  return {
    startDate: iso(row.startDate),
    endDate: row.endDate ? iso(row.endDate) : null,
    suspendedAt: row.suspendedAt ? iso(row.suspendedAt) : null,
    resumedAt: row.resumedAt ? iso(row.resumedAt) : null,
    status: row.status as AssignmentDates['status'],
  };
}

function iso(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
