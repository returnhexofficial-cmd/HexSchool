import { StaffStatus } from '../constants';
import { dhakaToday } from './clock.util';

/**
 * Statuses that mean somebody has left the school's payroll.
 *
 * Added in M21: payroll needs to prorate a leaver's final month, and M07
 * and M08 recorded the status CHANGE without ever recording the date it
 * took effect. Shared here because both employee tables answer the same
 * question the same way.
 */
export const EXIT_STATUSES: readonly StaffStatus[] = [
  StaffStatus.RESIGNED,
  StaffStatus.TERMINATED,
  StaffStatus.RETIRED,
];

export function isExitStatus(status: StaffStatus): boolean {
  return EXIT_STATUSES.includes(status);
}

/**
 * The `exit_date` a status change should write.
 *
 * Moving to an exit status stamps the last working day (defaulting to
 * today, because most resignations are processed on the day). Moving back
 * to ACTIVE or ON_LEAVE **clears** it — a re-hire who kept a stale exit
 * date would have every future payslip prorated to nothing, silently.
 */
export function exitDateFor(
  status: StaffStatus,
  effectiveDate?: string,
): Date | null {
  if (!isExitStatus(status)) return null;
  return new Date(`${effectiveDate ?? dhakaToday()}T00:00:00.000Z`);
}
