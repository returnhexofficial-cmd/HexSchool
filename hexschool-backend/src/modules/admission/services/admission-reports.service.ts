import { Injectable, NotFoundException } from '@nestjs/common';
import { AdmissionApplicationStatus } from '../../../common/constants';
import { AdmissionApplicationsRepository } from '../repositories/admission-applications.repository';
import { AdmissionCyclesRepository } from '../repositories/admission-cycles.repository';

/** Statuses that count as "paid interest" in the funnel. */
const FUNNEL_PAID = new Set<AdmissionApplicationStatus>([
  AdmissionApplicationStatus.SUBMITTED,
  AdmissionApplicationStatus.UNDER_REVIEW,
  AdmissionApplicationStatus.TEST_SCHEDULED,
  AdmissionApplicationStatus.PASSED,
  AdmissionApplicationStatus.FAILED,
  AdmissionApplicationStatus.SELECTED,
  AdmissionApplicationStatus.WAITLISTED,
  AdmissionApplicationStatus.ADMITTED,
]);

/**
 * Admission funnel reporting (roadmap M10 §4): applied → paid →
 * selected → admitted, per cycle and per class, with fee totals.
 */
@Injectable()
export class AdmissionReportsService {
  constructor(
    private readonly applications: AdmissionApplicationsRepository,
    private readonly cycles: AdmissionCyclesRepository,
  ) {}

  async summary(schoolId: string, cycleId?: string) {
    const statusCounts = await this.applications.countByStatus(
      schoolId,
      cycleId,
    );
    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const row of statusCounts) {
      byStatus[row.status] = row.count;
      total += row.count;
    }

    const funnel = {
      applied: total,
      processed: statusCounts
        .filter((r) => FUNNEL_PAID.has(r.status))
        .reduce((sum, r) => sum + r.count, 0),
      selected:
        (byStatus[AdmissionApplicationStatus.SELECTED] ?? 0) +
        (byStatus[AdmissionApplicationStatus.ADMITTED] ?? 0),
      admitted: byStatus[AdmissionApplicationStatus.ADMITTED] ?? 0,
      waitlisted: byStatus[AdmissionApplicationStatus.WAITLISTED] ?? 0,
    };

    if (!cycleId) return { funnel, byStatus, classes: [] };

    const cycle = await this.cycles.findDetail(cycleId, schoolId);
    if (!cycle) {
      throw new NotFoundException(`Admission cycle ${cycleId} not found`);
    }
    const breakdown = await this.applications.classBreakdown(schoolId, cycleId);

    const classes = cycle.classes.map((cycleClass) => {
      const rows = breakdown.filter((r) => r.classId === cycleClass.classId);
      const count = (status: AdmissionApplicationStatus) =>
        rows.find((r) => r.status === status)?.count ?? 0;
      return {
        classId: cycleClass.classId,
        className: cycleClass.class.name,
        seats: cycleClass.seats,
        applicationFee: Number(cycleClass.applicationFee),
        applied: rows.reduce((sum, r) => sum + r.count, 0),
        paymentPending: count(AdmissionApplicationStatus.PAYMENT_PENDING),
        testScheduled: count(AdmissionApplicationStatus.TEST_SCHEDULED),
        passed: count(AdmissionApplicationStatus.PASSED),
        failed: count(AdmissionApplicationStatus.FAILED),
        selected: count(AdmissionApplicationStatus.SELECTED),
        waitlisted: count(AdmissionApplicationStatus.WAITLISTED),
        admitted: count(AdmissionApplicationStatus.ADMITTED),
        feesCollected: rows.reduce((sum, r) => sum + r.paidAmount, 0),
      };
    });

    return { funnel, byStatus, classes };
  }
}
