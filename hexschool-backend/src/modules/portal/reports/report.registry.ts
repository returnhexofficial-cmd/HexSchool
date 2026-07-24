/**
 * The consolidated reports catalog (roadmap M18 §4 "Reports index
 * registry: every existing report registered with code, permission,
 * params schema → GET /reports powers a unified Reports page").
 *
 * A code registry, like permissions/settings — the actual report
 * endpoints already live in their feature modules; this is the metadata a
 * single Reports hub renders (what it is, who may run it, where it lives,
 * what parameters it takes, which formats it exports). Append-only.
 */

export interface ReportParam {
  key: string;
  label: string;
  type: 'session' | 'class' | 'section' | 'month' | 'date' | 'text' | 'exam';
  required: boolean;
}

export interface ReportDefinition {
  code: string;
  name: string;
  module: string;
  description: string;
  /** Permission required to run it (matches the endpoint's guard). */
  permission: string;
  /** GET endpoint that returns the report JSON. */
  endpoint: string;
  params: ReportParam[];
  /** Export formats the endpoint offers (xlsx/pdf suffix routes). */
  formats: Array<'xlsx' | 'pdf' | 'csv'>;
}

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
  month: {
    key: 'month',
    label: 'Month',
    type: 'month',
    required: true,
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
  to: { key: 'to', label: 'To', type: 'date', required: false } as ReportParam,
  exam: {
    key: 'examId',
    label: 'Exam',
    type: 'exam',
    required: true,
  } as ReportParam,
};

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
    formats: ['xlsx', 'pdf'],
  },
  {
    code: 'attendance.monthly',
    name: 'Monthly register',
    module: 'Attendance',
    description: 'A section’s month-long attendance register.',
    permission: 'attendance.report',
    endpoint: '/attendance/reports/monthly',
    params: [P.sectionOpt, P.month],
    formats: ['xlsx', 'pdf'],
  },
  {
    code: 'attendance.late',
    name: 'Late analysis',
    module: 'Attendance',
    description: 'Students flagged for repeated lateness.',
    permission: 'attendance.report',
    endpoint: '/attendance/reports/late',
    params: [P.sessionOpt, P.month],
    formats: ['xlsx'],
  },
  // ── Results (M15) ───────────────────────────────────────────────────
  {
    code: 'result.tabulation',
    name: 'Tabulation sheet',
    module: 'Results',
    description: 'Whole-exam tabulation across candidates.',
    permission: 'result.export',
    endpoint: '/exams/:examId/results/tabulation',
    params: [P.exam],
    formats: ['xlsx', 'pdf'],
  },
  {
    code: 'result.report-cards',
    name: 'Report cards',
    module: 'Results',
    description: 'Per-candidate report cards for an exam.',
    permission: 'result.export',
    endpoint: '/exams/:examId/results/report-cards',
    params: [P.exam],
    formats: ['pdf'],
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
    formats: ['xlsx'],
  },
  {
    code: 'fee.daily',
    name: 'Daily collection',
    module: 'Fees',
    description: 'Money received by method and day.',
    permission: 'fee.report',
    endpoint: '/fee-reports/daily',
    params: [P.from, P.to],
    formats: ['xlsx'],
  },
  {
    code: 'fee.head-wise',
    name: 'Head-wise income',
    module: 'Fees',
    description: 'Income split by fee head.',
    permission: 'fee.report',
    endpoint: '/fee-reports/head-wise',
    params: [P.sessionOpt],
    formats: ['xlsx'],
  },
  {
    code: 'fee.defaulters',
    name: 'Defaulters',
    module: 'Fees',
    description: 'Students with outstanding dues.',
    permission: 'fee.report',
    endpoint: '/fee-reports/defaulters',
    params: [P.sessionOpt],
    formats: ['xlsx'],
  },
  // ── Communication (M17) ─────────────────────────────────────────────
  {
    code: 'communication.log',
    name: 'Delivery log',
    module: 'Communication',
    description: 'Every SMS/email/in-app message and its delivery state.',
    permission: 'notification.view',
    endpoint: '/notifications',
    params: [],
    formats: [],
  },
];

export const REPORT_CODES: ReadonlySet<string> = new Set(
  REPORT_REGISTRY.map((r) => r.code),
);
