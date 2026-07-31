/**
 * Module 25's cross-module contract, kept in a bare constants file with
 * no Nest imports beyond the token symbol — the M12 `hr.leave.approved`
 * and M23 `LIBRARY_CLEARANCE` trick that lets a *consumer* depend on the
 * shape without importing the module that owns it.
 */

/** DI token for the transport line on a monthly fee invoice. */
export const TRANSPORT_FEE_SOURCE = Symbol('TRANSPORT_FEE_SOURCE');

/** One rider's charge for one month, ready to become an invoice line. */
export interface TransportCharge {
  enrollmentId: string;
  /** The M16 fee head the line is billed under. */
  feeHeadId: string;
  /** Already prorated against the service window — do NOT prorate again. */
  amount: number;
  description: string;
  routeName: string;
  stopName: string;
  servedDays: number;
  daysInMonth: number;
}

/**
 * What M16's invoice generation asks the transport module, once per
 * monthly batch.
 *
 * The implementation is `TransportFeeService` — but it is **bound inside
 * FeeModule over PrismaService and SettingsService alone**, exactly as
 * M23's `LibraryClearanceService` is bound inside StudentModule. The
 * alternative, FeeModule importing TransportModule, would close a cycle:
 * TransportModule reaches AccountingModule for the expense voucher, and
 * AccountingModule imports FeeModule.
 *
 * The token is **always bound**, never conditional — the M08/M14 lesson
 * that the call site is the part that is easy to forget. A school with
 * no routes, no riders or no configured fee head gets an empty map, and
 * invoice generation is unchanged.
 */
export interface TransportFeeSource {
  /**
   * The transport charge for each of these enrollments in `month`
   * (`YYYY-MM`). Enrollments with no live assignment are absent from the
   * map rather than present with a zero — a zero would put an empty line
   * on the bill.
   */
  monthlyCharges(
    schoolId: string,
    enrollmentIds: string[],
    month: string,
  ): Promise<Map<string, TransportCharge>>;
}

/** The empty answer: no routes, no riders, or transport switched off. */
export const NO_TRANSPORT_CHARGES = new Map<string, TransportCharge>();
