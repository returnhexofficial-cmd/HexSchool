/**
 * Module 26's cross-module contract, kept in a bare constants file with
 * no Nest imports beyond the token symbol — the M12 `hr.leave.approved` /
 * M23 `LIBRARY_CLEARANCE` / M25 `TRANSPORT_FEE_SOURCE` trick that lets a
 * *consumer* depend on the shape without importing the module that owns
 * it.
 */

/** DI token for the hostel lines on a monthly fee invoice. */
export const HOSTEL_FEE_SOURCE = Symbol('HOSTEL_FEE_SOURCE');

/** One billable component of a boarder's month. */
export interface HostelChargeLine {
  /** The M16 fee head this line is billed under. */
  feeHeadId: string;
  /** Already prorated against the residency window — do NOT prorate again. */
  amount: number;
  description: string;
}

/**
 * What a boarder owes for one month, ready to become invoice lines.
 *
 * **Two lines, not one** (see `hostel-fee.engine.ts`): a hostel bill is a
 * room charge and a food charge, they move independently, and a parent
 * querying a bill asks about one or the other. A merged figure would also
 * make the meal-off credit impossible to show.
 */
export interface HostelCharge {
  enrollmentId: string;
  lines: HostelChargeLine[];
  /** Rent + mess, net of any meal-off credit. */
  total: number;
  hostelName: string;
  roomNo: string;
  bedNo: string;
  residentDays: number;
  daysInMonth: number;
  /** Days credited back from approved meal-offs, if any. */
  creditDays: number;
}

/**
 * What M16's invoice generation asks the hostel module, once per monthly
 * batch.
 *
 * The implementation is `HostelFeeService` — but it is **bound inside
 * FeeModule over PrismaService and SettingsService alone**, exactly as
 * M23's `LibraryClearanceService` is bound inside StudentModule and M25's
 * `TransportFeeService` inside FeeModule. The alternative, FeeModule
 * importing HostelModule, would close a cycle: HostelModule reaches
 * FeeModule for the vacate dues gate and AccountingModule for the deposit
 * voucher, and AccountingModule imports FeeModule.
 *
 * The token is **always bound**, never conditional — the M08/M14 lesson
 * that the call site is the part that is easy to forget. A school with no
 * hostel, no boarders or no configured fee head gets an empty map, and
 * invoice generation is unchanged.
 */
export interface HostelFeeSource {
  /**
   * The hostel charges for each of these enrollments in `month`
   * (`YYYY-MM`). Enrollments with no allocation touching the month are
   * absent from the map rather than present with a zero — a zero would
   * put an empty line on the bill of every family whose child lives at
   * home.
   */
  monthlyCharges(
    schoolId: string,
    enrollmentIds: string[],
    month: string,
  ): Promise<Map<string, HostelCharge>>;
}

/** The empty answer: no hostel, no boarders, or hostel switched off. */
export const NO_HOSTEL_CHARGES = new Map<string, HostelCharge>();
