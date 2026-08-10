import type { ReportFormat, ReportOutput, ReportParam } from '../calc/types';

/**
 * The report catalog — roadmap M29 §3's `report_definitions`, and the
 * successor to M18's `portal/reports/report.registry.ts`.
 *
 * **The table replaces the file's storage, not its authority.** This file
 * is still the source of truth and a seeder syncs it into
 * `report_definitions` (the `permission.registry.ts` / `settings.registry.ts`
 * arrangement, third use), because the alternative — rows a developer
 * inserts by hand — has no code review, no diff and no way for `tsc` to
 * notice that a report points at a permission nobody defines. Append-only,
 * and `report.registry.spec.ts` enforces both of those.
 *
 * What M29 adds to each entry over M18's version:
 *
 *   - **`params`** is now a real schema the engine validates against and
 *     the hub generates a form from (roadmap §5's "param forms
 *     auto-generated from params_schema") — one description, two
 *     consumers, so the form cannot offer what the engine refuses.
 *   - **`output`** — how the hub renders it (roadmap §3).
 *   - **`runnable`** — whether an async executor exists. A report without
 *     one keeps its deep link and hides the Run button, rather than
 *     queueing a job that can only fail (the M18 `{available:false}`
 *     honesty rule).
 *   - **`sensitivePermission`** — roadmap §6's column-level data
 *     permission. The columns themselves carry it; this is the copy the
 *     catalog can show before the report has been run.
 *   - **`freshness`** — roadmap §8. A report served from a materialized
 *     view is up to 24 h stale and has to say so on its own face.
 */

export interface ReportDefinition {
  code: string;
  name: string;
  module: string;
  description: string;
  /** Permission required to run it (matches the endpoint's guard). */
  permission: string;
  /** The synchronous endpoint that returns the report JSON, if any. */
  endpoint?: string;
  params: ReportParam[];
  output: ReportOutput;
  /** File formats a run may ask for. */
  formats: ReportFormat[];
  /** True when `executors/` binds an async executor for this code. */
  runnable: boolean;
  sensitivePermission?: string;
  /** Null/absent is live; otherwise the staleness the reader must know. */
  freshness?: string;
}

// ── Reusable parameter descriptors ────────────────────────────────────

const P = {
  session: {
    key: 'sessionId',
    label: 'Session',
    type: 'session',
    required: true,
  } as ReportParam,
  sessionOpt: {
    key: 'sessionId',
    label: 'Session',
    type: 'session',
    required: false,
    help: 'Defaults to the current session',
  } as ReportParam,
  classOpt: {
    key: 'classId',
    label: 'Class',
    type: 'class',
    required: false,
  } as ReportParam,
  sectionOpt: {
    key: 'sectionId',
    label: 'Section',
    type: 'section',
    required: false,
  } as ReportParam,
  section: {
    key: 'sectionId',
    label: 'Section',
    type: 'section',
    required: true,
  } as ReportParam,
  month: {
    key: 'month',
    label: 'Month',
    type: 'month',
    required: true,
  } as ReportParam,
  monthOpt: {
    key: 'month',
    label: 'Month',
    type: 'month',
    required: false,
    help: 'Defaults to this month',
  } as ReportParam,
  date: {
    key: 'date',
    label: 'Date',
    type: 'date',
    required: true,
  } as ReportParam,
  from: {
    key: 'from',
    label: 'From',
    type: 'date',
    required: false,
  } as ReportParam,
  to: {
    key: 'to',
    label: 'To',
    type: 'date',
    required: false,
  } as ReportParam,
  exam: {
    key: 'examId',
    label: 'Exam',
    type: 'exam',
    required: true,
  } as ReportParam,
  route: {
    key: 'routeId',
    label: 'Route',
    type: 'route',
    required: true,
  } as ReportParam,
  item: {
    key: 'itemId',
    label: 'Item',
    type: 'item',
    required: true,
  } as ReportParam,
  account: {
    key: 'accountId',
    label: 'Account',
    type: 'account',
    required: true,
  } as ReportParam,
  vehicleOpt: {
    key: 'vehicleId',
    label: 'Vehicle',
    type: 'vehicle',
    required: false,
  } as ReportParam,
  hostelOpt: {
    key: 'hostelId',
    label: 'Hostel',
    type: 'hostel',
    required: false,
  } as ReportParam,
  supplierOpt: {
    key: 'supplierId',
    label: 'Supplier',
    type: 'supplier',
    required: false,
  } as ReportParam,
  // M21's payroll reports are grained in MONTHS, not days — a payroll run
  // belongs to a month and there is no half of one. Declaring that here is
  // what makes the hub render a month picker and the engine reject a date.
  fromMonth: {
    key: 'from',
    label: 'From month',
    type: 'month',
    required: false,
    help: 'Defaults to this month',
  } as ReportParam,
  toMonth: {
    key: 'to',
    label: 'To month',
    type: 'month',
    required: false,
    help: 'Defaults to this month',
  } as ReportParam,
} as const;

const SHEET: ReportFormat[] = ['XLSX', 'CSV'];
const SHEET_AND_PRINT: ReportFormat[] = ['XLSX', 'CSV', 'PDF'];

export const REPORT_REGISTRY: ReadonlyArray<ReportDefinition> = [
  // ── Attendance (M12) ────────────────────────────────────────────────
  {
    code: 'attendance.daily',
    name: 'Daily attendance',
    module: 'Attendance',
    description: 'One day’s attendance across sections.',
    permission: 'attendance.report',
    endpoint: '/attendance/reports/daily',
    params: [P.date, P.sectionOpt],
    output: 'TABLE',
    formats: SHEET_AND_PRINT,
    runnable: true,
  },
  {
    code: 'attendance.monthly',
    name: 'Monthly register',
    module: 'Attendance',
    description: 'A section’s month-long attendance register.',
    permission: 'attendance.report',
    endpoint: '/attendance/reports/monthly',
    params: [P.section, P.month],
    output: 'TABLE',
    formats: SHEET_AND_PRINT,
    runnable: true,
  },
  {
    code: 'attendance.late',
    name: 'Late analysis',
    module: 'Attendance',
    description: 'Students flagged for repeated lateness.',
    permission: 'attendance.report',
    endpoint: '/attendance/reports/late',
    params: [P.month, P.sectionOpt],
    output: 'TABLE',
    formats: SHEET,
    runnable: true,
  },
  {
    code: 'attendance.summary',
    name: 'Attendance summary',
    module: 'Attendance',
    description: 'Per-section attendance percentage over a window.',
    permission: 'attendance.report',
    endpoint: '/attendance/reports/summary',
    params: [P.sessionOpt, P.from, P.to],
    output: 'TABLE',
    formats: SHEET,
    runnable: true,
  },
  {
    code: 'attendance.staff',
    name: 'Staff attendance',
    module: 'Attendance',
    description: 'Employee attendance for a month, with the working days.',
    permission: 'attendance.report',
    endpoint: '/attendance/reports/staff',
    params: [P.month],
    output: 'TABLE',
    formats: SHEET,
    runnable: true,
  },
  // ── Results (M15) ───────────────────────────────────────────────────
  {
    code: 'result.tabulation',
    name: 'Tabulation sheet',
    module: 'Results',
    description: 'Whole-exam tabulation across candidates.',
    permission: 'result.export',
    endpoint: '/exams/:examId/results/tabulation',
    params: [P.exam, P.sectionOpt],
    output: 'TABLE',
    formats: SHEET_AND_PRINT,
    runnable: true,
  },
  {
    code: 'result.report-cards',
    name: 'Report cards',
    module: 'Results',
    description: 'Per-candidate report cards for an exam.',
    permission: 'result.export',
    endpoint: '/exams/:examId/results/report-cards',
    params: [P.exam],
    output: 'PDF',
    formats: ['PDF'],
    runnable: false,
  },
  {
    code: 'result.trend',
    name: 'Result trend',
    module: 'Results',
    description: 'Pass rate and average GPA per published exam, oldest first.',
    permission: 'result.view',
    endpoint: '/analytics/results',
    params: [P.sessionOpt],
    output: 'CHART',
    formats: SHEET,
    runnable: true,
    freshness: 'Refreshed nightly — up to 24 hours old',
  },
  // ── Fees (M16) ──────────────────────────────────────────────────────
  {
    code: 'fee.dues',
    name: 'Dues & aging',
    module: 'Fees',
    description: 'Outstanding dues with aging buckets and a defaulter list.',
    permission: 'fee.report',
    endpoint: '/fee-reports/dues',
    params: [P.sessionOpt, P.classOpt],
    output: 'TABLE',
    formats: SHEET,
    runnable: true,
  },
  {
    code: 'fee.daily',
    name: 'Daily collection',
    module: 'Fees',
    description: 'Money received by method and day.',
    permission: 'fee.report',
    endpoint: '/fee-reports/daily',
    params: [P.from, P.to],
    output: 'TABLE',
    formats: SHEET,
    runnable: true,
  },
  {
    code: 'fee.head-wise',
    name: 'Head-wise income',
    module: 'Fees',
    description: 'Income split by fee head.',
    permission: 'fee.report',
    endpoint: '/fee-reports/head-wise',
    params: [P.sessionOpt],
    output: 'TABLE',
    formats: SHEET,
    runnable: true,
  },
  {
    code: 'fee.defaulters',
    name: 'Defaulters',
    module: 'Fees',
    description: 'Students with outstanding dues.',
    permission: 'fee.report',
    endpoint: '/fee-reports/defaulters',
    params: [P.sessionOpt, P.classOpt],
    output: 'TABLE',
    formats: SHEET,
    runnable: true,
  },
  {
    code: 'fee.monthly',
    name: 'Billed vs collected',
    module: 'Fees',
    description: 'Month-by-month billing against collection for a session.',
    permission: 'fee.report',
    endpoint: '/fee-reports/monthly',
    params: [P.sessionOpt],
    output: 'CHART',
    formats: SHEET,
    runnable: true,
  },
  // ── Accounting (M20) ────────────────────────────────────────────────
  {
    code: 'accounting.cash-book',
    name: 'Cash book',
    module: 'Accounting',
    description: 'Receipts and payments through every cash account.',
    permission: 'accounting.report',
    endpoint: '/accounting/reports/cash-book',
    params: [P.from, P.to],
    output: 'TABLE',
    formats: SHEET,
    runnable: true,
  },
  {
    code: 'accounting.bank-book',
    name: 'Bank book',
    module: 'Accounting',
    description: 'Receipts and payments through a bank account.',
    permission: 'accounting.report',
    endpoint: '/accounting/reports/bank-book',
    params: [P.from, P.to],
    output: 'TABLE',
    formats: SHEET,
    runnable: true,
  },
  {
    code: 'accounting.ledger',
    name: 'General ledger',
    module: 'Accounting',
    description: 'One account’s movements with a running balance.',
    permission: 'accounting.report',
    endpoint: '/accounting/reports/ledger',
    params: [P.account, P.from, P.to],
    output: 'TABLE',
    formats: SHEET,
    runnable: true,
  },
  {
    code: 'accounting.trial-balance',
    name: 'Trial balance',
    module: 'Accounting',
    description: 'Every account’s closing balance, proving debits = credits.',
    permission: 'accounting.report',
    endpoint: '/accounting/reports/trial-balance',
    params: [P.from, P.to],
    output: 'TABLE',
    formats: SHEET_AND_PRINT,
    runnable: true,
  },
  {
    code: 'accounting.income-statement',
    name: 'Income & expenditure',
    module: 'Accounting',
    description: 'Income against expenditure for a period, with the surplus.',
    permission: 'accounting.report',
    endpoint: '/accounting/reports/income-statement',
    params: [P.from, P.to],
    output: 'TABLE',
    formats: SHEET_AND_PRINT,
    runnable: true,
  },
  {
    code: 'accounting.balance-sheet',
    name: 'Balance sheet',
    module: 'Accounting',
    description: 'Closing position: assets against liabilities and fund.',
    permission: 'accounting.report',
    endpoint: '/accounting/reports/balance-sheet',
    params: [P.from, P.to],
    output: 'TABLE',
    formats: SHEET_AND_PRINT,
    runnable: true,
  },
  {
    code: 'accounting.receipts-payments',
    name: 'Receipts & payments',
    module: 'Accounting',
    description: 'Cash-basis summary of what came in and what went out.',
    permission: 'accounting.report',
    endpoint: '/accounting/reports/receipts-payments',
    params: [P.from, P.to],
    output: 'TABLE',
    formats: SHEET_AND_PRINT,
    runnable: true,
  },
  {
    code: 'accounting.budget-vs-actual',
    name: 'Budget vs actual',
    module: 'Accounting',
    description: 'Planned against actual income and spend, with variance.',
    permission: 'accounting.report',
    endpoint: '/accounting/reports/budget-vs-actual',
    params: [P.session, P.from, P.to],
    output: 'TABLE',
    formats: SHEET,
    runnable: true,
  },
  // ── HR & Payroll (M21) ──────────────────────────────────────────────
  //
  // Every payroll report names `payroll.view` as its sensitive
  // permission: the register's money columns are exactly roadmap §6's
  // "salary" example, and a school office assistant who may run the
  // headcount should get the headcount without the pay.
  {
    code: 'payroll.register',
    name: 'Monthly payroll register',
    module: 'HR & Payroll',
    description:
      'Every employee’s pay for a month: basic, allowances, deductions and net.',
    permission: 'payroll.report',
    endpoint: '/payroll/reports/register',
    params: [P.fromMonth, P.toMonth],
    output: 'TABLE',
    formats: SHEET_AND_PRINT,
    runnable: true,
    sensitivePermission: 'payroll.view',
  },
  {
    code: 'payroll.pf',
    name: 'Provident fund',
    module: 'HR & Payroll',
    description:
      'Contributions, withdrawals and the closing balance per employee.',
    permission: 'payroll.report',
    endpoint: '/payroll/reports/pf',
    params: [],
    output: 'TABLE',
    formats: SHEET,
    runnable: true,
    sensitivePermission: 'payroll.view',
  },
  {
    code: 'payroll.tax',
    name: 'Tax deduction summary',
    module: 'HR & Payroll',
    description: 'Income tax deducted at source per employee over a window.',
    permission: 'payroll.report',
    endpoint: '/payroll/reports/tax',
    params: [P.fromMonth, P.toMonth],
    output: 'TABLE',
    formats: SHEET,
    runnable: true,
    sensitivePermission: 'payroll.view',
  },
  {
    code: 'payroll.grades',
    name: 'Salary-grade distribution',
    module: 'HR & Payroll',
    description:
      'Headcount and monthly cost per salary structure, from the live assignments.',
    permission: 'payroll.report',
    endpoint: '/payroll/reports/grades',
    params: [],
    output: 'TABLE',
    formats: SHEET,
    runnable: true,
    sensitivePermission: 'payroll.view',
  },
  // ── Communication (M17) ─────────────────────────────────────────────
  {
    code: 'communication.log',
    name: 'Delivery log',
    module: 'Communication',
    description: 'Every SMS/email/in-app message and its delivery state.',
    permission: 'notification.view',
    endpoint: '/notifications',
    params: [P.from, P.to],
    output: 'TABLE',
    formats: SHEET,
    runnable: true,
  },
  // ── Library (M23) ───────────────────────────────────────────────────
  {
    code: 'library.overdue',
    name: 'Overdue books',
    module: 'Library',
    description:
      'Every loan past its due date, with the borrower, the days late and the fine so far.',
    permission: 'library.report',
    endpoint: '/library/reports/overdue',
    params: [],
    output: 'TABLE',
    formats: SHEET,
    runnable: true,
  },
  {
    code: 'library.issued',
    name: 'Books on loan',
    module: 'Library',
    description: 'Everything currently out, due soonest first.',
    permission: 'library.report',
    endpoint: '/library/reports/issued',
    params: [],
    output: 'TABLE',
    formats: SHEET,
    runnable: true,
  },
  {
    code: 'library.popular',
    name: 'Popular titles',
    module: 'Library',
    description: 'Most-borrowed titles over a window.',
    permission: 'library.report',
    endpoint: '/library/reports/popular',
    params: [P.from, P.to],
    output: 'TABLE',
    formats: SHEET,
    runnable: true,
  },
  {
    code: 'library.stock',
    name: 'Category stock',
    module: 'Library',
    description:
      'Titles and copies per category, split by available / on loan / written off.',
    permission: 'library.report',
    endpoint: '/library/reports/stock',
    params: [],
    output: 'TABLE',
    formats: SHEET,
    runnable: true,
  },
  // ── Transport (M25) ─────────────────────────────────────────────────
  {
    code: 'transport.roster',
    name: 'Route roster (driver’s sheet)',
    module: 'Transport',
    description:
      'Riders per stop with guardian phone numbers, in the order the bus drives.',
    permission: 'transport.report',
    endpoint: '/transport/reports/roster/:routeId',
    params: [P.route],
    output: 'TABLE',
    formats: SHEET_AND_PRINT,
    runnable: true,
  },
  {
    code: 'transport.expenses',
    name: 'Vehicle expenses',
    module: 'Transport',
    description:
      'Fuel, maintenance and repairs by vehicle and month, with cost per kilometre.',
    permission: 'transport.report',
    endpoint: '/transport/reports/expenses',
    params: [P.vehicleOpt, P.from, P.to],
    output: 'TABLE',
    formats: SHEET,
    runnable: true,
  },
  {
    code: 'transport.utilization',
    name: 'Capacity utilization',
    module: 'Transport',
    description: 'Seats against riders, per route and across the fleet.',
    permission: 'transport.report',
    endpoint: '/transport/reports/utilization',
    params: [],
    output: 'TABLE',
    formats: SHEET,
    runnable: true,
  },
  {
    code: 'transport.collection',
    name: 'Transport fee collection',
    module: 'Transport',
    description:
      'Expected, invoiced and collected transport fees per route for a month.',
    permission: 'transport.report',
    endpoint: '/transport/reports/collection',
    params: [P.monthOpt],
    output: 'TABLE',
    formats: SHEET,
    runnable: true,
  },
  // ── Inventory (M24) ─────────────────────────────────────────────────
  {
    code: 'inventory.stock',
    name: 'Current stock & valuation',
    module: 'Inventory',
    description:
      'Balance per item with its value at the last price paid, and what is at or below reorder level.',
    permission: 'inventory.report',
    endpoint: '/inventory/reports/stock',
    params: [],
    output: 'TABLE',
    formats: SHEET,
    runnable: true,
  },
  {
    code: 'inventory.ledger',
    name: 'Item ledger',
    module: 'Inventory',
    description:
      'Every movement of one item — in, out and corrected — with the running balance beside it.',
    permission: 'inventory.report',
    endpoint: '/inventory/reports/ledger/:itemId',
    params: [P.item, P.from, P.to],
    output: 'TABLE',
    formats: SHEET,
    runnable: true,
  },
  {
    code: 'inventory.purchases',
    name: 'Purchases by supplier',
    module: 'Inventory',
    description: 'Received deliveries totalled per supplier and per month.',
    permission: 'inventory.report',
    endpoint: '/inventory/reports/purchases',
    params: [P.supplierOpt, P.from, P.to],
    output: 'TABLE',
    formats: SHEET,
    runnable: true,
  },
  {
    code: 'inventory.assets',
    name: 'Asset register',
    module: 'Inventory',
    description:
      'Tagged units by location, custodian and status — written-off units excluded.',
    permission: 'inventory.report',
    endpoint: '/inventory/reports/assets',
    params: [],
    output: 'TABLE',
    formats: SHEET_AND_PRINT,
    runnable: true,
  },
  {
    code: 'inventory.warranty',
    name: 'Warranties expiring',
    module: 'Inventory',
    description:
      'Assets whose warranty has lapsed, is about to, or was never recorded.',
    permission: 'inventory.report',
    endpoint: '/inventory/reports/warranty',
    params: [],
    output: 'TABLE',
    formats: SHEET,
    runnable: true,
  },
  {
    code: 'inventory.consumption',
    name: 'Consumption by department',
    module: 'Inventory',
    description:
      'What each department, person and room consumed over a window, net of returns.',
    permission: 'inventory.report',
    endpoint: '/inventory/reports/consumption',
    params: [P.from, P.to],
    output: 'TABLE',
    formats: SHEET,
    runnable: true,
  },
  // ── Hostel (M26) ────────────────────────────────────────────────────
  {
    code: 'hostel.occupancy',
    name: 'Occupancy',
    module: 'Hostel',
    description:
      'Beds taken, free and out of service — by hostel, by floor and by room.',
    permission: 'hostel.report',
    endpoint: '/hostel/reports/occupancy',
    params: [P.hostelOpt],
    output: 'TABLE',
    formats: SHEET,
    runnable: true,
  },
  {
    code: 'hostel.residents',
    name: 'Resident register',
    module: 'Hostel',
    description:
      'Who sleeps where, with the guardian to ring — the register a warden carries.',
    permission: 'hostel.report',
    endpoint: '/hostel/reports/residents',
    params: [P.hostelOpt, P.sessionOpt],
    output: 'TABLE',
    formats: SHEET_AND_PRINT,
    runnable: true,
  },
  {
    code: 'hostel.dues',
    name: 'Resident fee dues',
    module: 'Hostel',
    description: 'What each boarder still owes, read from the fee ledger.',
    permission: 'hostel.report',
    endpoint: '/hostel/reports/dues',
    params: [P.hostelOpt, P.sessionOpt],
    output: 'TABLE',
    formats: SHEET,
    runnable: true,
  },
  {
    code: 'hostel.mealoffs',
    name: 'Meal-off summary',
    module: 'Hostel',
    description:
      'Days claimed, approved and credited per boarder over a window.',
    permission: 'hostel.report',
    endpoint: '/hostel/reports/meal-offs',
    params: [P.hostelOpt, P.from, P.to],
    output: 'TABLE',
    formats: SHEET,
    runnable: true,
  },
  // ── Certificates (M27) ──────────────────────────────────────────────
  {
    code: 'certificate.register',
    name: 'Issuance register',
    module: 'Certificates',
    description:
      'Every certificate issued over a window — number, type, student, who signed it, and whether it still stands.',
    permission: 'certificate.export',
    endpoint: '/certificates/reports/register',
    params: [P.from, P.to],
    output: 'TABLE',
    formats: SHEET_AND_PRINT,
    runnable: true,
  },
  {
    code: 'certificate.summary',
    name: 'Certificates by type',
    module: 'Certificates',
    description:
      'How many of each type were issued, duplicated and revoked over a window.',
    permission: 'certificate.export',
    endpoint: '/certificates/reports/summary',
    params: [P.from, P.to],
    output: 'TABLE',
    formats: SHEET,
    runnable: true,
  },
  // ── Complaints, visitors & alumni (M28) ─────────────────────────────
  {
    code: 'ticket.register',
    name: 'Complaints register',
    module: 'Complaints',
    description:
      'Every ticket raised over a window — who raised it, who took it, and how it ended.',
    permission: 'ticket.export',
    endpoint: '/tickets/reports/register',
    params: [P.from, P.to],
    output: 'TABLE',
    formats: SHEET,
    runnable: true,
    sensitivePermission: 'ticket.sensitive.view',
  },
  {
    code: 'ticket.summary',
    name: 'Complaints summary',
    module: 'Complaints',
    description:
      'Volume by category and status, average resolution time, and SLA compliance.',
    permission: 'ticket.report',
    endpoint: '/tickets/reports/summary',
    params: [P.from, P.to],
    output: 'TABLE',
    formats: SHEET,
    runnable: true,
  },
  {
    code: 'visitor.register',
    name: 'Visitor register',
    module: 'Visitors',
    description:
      'Who came, who they saw, when they arrived and when they left — the daily gate book.',
    permission: 'visitor.export',
    endpoint: '/visitors/reports/register',
    params: [P.from, P.to],
    output: 'TABLE',
    formats: SHEET_AND_PRINT,
    runnable: true,
  },
  {
    code: 'donation.register',
    name: 'Donation register',
    module: 'Alumni',
    description:
      'Every donation received over a window, with its receipt number and whether it still stands.',
    permission: 'alumni.export',
    endpoint: '/donations/reports/register',
    params: [P.from, P.to],
    output: 'TABLE',
    formats: SHEET,
    runnable: true,
  },
  {
    code: 'donation.summary',
    name: 'Donation summary',
    module: 'Alumni',
    description:
      'What was raised, by purpose, by method and month by month, and who gave most.',
    permission: 'alumni.report',
    endpoint: '/donations/reports/summary',
    params: [P.from, P.to],
    output: 'TABLE',
    formats: SHEET,
    runnable: true,
  },
  {
    code: 'alumni.directory',
    name: 'Alumni directory',
    module: 'Alumni',
    description: 'Approved alumni by batch, with profession and contact.',
    permission: 'alumni.export',
    endpoint: '/alumni/reports/directory',
    params: [],
    output: 'TABLE',
    formats: SHEET,
    runnable: true,
  },
  // ── Analytics (M29's own) ───────────────────────────────────────────
  {
    code: 'analytics.enrollment-trend',
    name: 'Enrollment trend (year on year)',
    module: 'Analytics',
    description:
      'Active enrollment per month against the same months a year earlier.',
    permission: 'analytics.view',
    endpoint: '/analytics/enrollment',
    params: [P.sessionOpt],
    output: 'CHART',
    formats: SHEET,
    runnable: true,
  },
  {
    code: 'analytics.attendance-heatmap',
    name: 'Attendance heatmap (section × month)',
    module: 'Analytics',
    description:
      'Attendance percentage per section per month; a section with no register is blank, not zero.',
    permission: 'analytics.view',
    endpoint: '/analytics/attendance-heatmap',
    params: [P.sessionOpt],
    output: 'CHART',
    formats: SHEET,
    runnable: true,
    freshness: 'Refreshed nightly — up to 24 hours old',
  },
  {
    code: 'analytics.website',
    name: 'Website traffic',
    module: 'Analytics',
    description:
      'Page views, unique visitors and top pages per day for the public site.',
    permission: 'analytics.website',
    endpoint: '/analytics/website',
    params: [P.from, P.to],
    output: 'CHART',
    formats: SHEET,
    runnable: true,
  },
];

export const REPORT_CODES: ReadonlySet<string> = new Set(
  REPORT_REGISTRY.map((r) => r.code),
);

export function reportDefinition(code: string): ReportDefinition | undefined {
  return REPORT_REGISTRY.find((r) => r.code === code);
}
