import { api, ApiEnvelope } from "./axios";

/**
 * Mirrors the backend HR & Payroll API (Module 21): the unified employee
 * list over teachers and staff, the leave system that replaced M08's
 * interim teacher-only table, salary structures and their history,
 * payroll runs and payslips, bonuses, the provident fund and the five
 * reports.
 */

// ── enums (kept in step with prisma/schema.prisma) ──────────────────────

export type PersonType = "TEACHER" | "STAFF";
export type LeaveApplicableTo = "ALL" | "TEACHER" | "STAFF";
export type LeaveStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
export type ComponentType = "ALLOWANCE" | "DEDUCTION";
export type ComponentCalc = "FLAT" | "PERCENT_OF_BASIC";
export type PaymentMode = "BANK" | "CASH" | "MOBILE_BANKING";
export type PayrollRunStatus =
  | "DRAFT"
  | "GENERATED"
  | "APPROVED"
  | "DISBURSED"
  | "CANCELLED";
export type PayslipStatus = "PENDING" | "PAID" | "HELD";
export type BonusType = "FESTIVAL" | "PERFORMANCE" | "OTHER";
export type BonusBasis = "PERCENT_OF_BASIC" | "FLAT";
export type PfEntryType = "CONTRIBUTION" | "WITHDRAWAL" | "ADJUSTMENT";

export const PERSON_TYPES: PersonType[] = ["TEACHER", "STAFF"];

export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Withdrawn",
};

/**
 * The run lifecycle, in order — the tab strip and the wizard both read
 * this rather than hard-coding the sequence in two places.
 */
export const RUN_STATUSES: PayrollRunStatus[] = [
  "DRAFT",
  "GENERATED",
  "APPROVED",
  "DISBURSED",
];

export const RUN_STATUS_LABELS: Record<PayrollRunStatus, string> = {
  DRAFT: "Draft",
  GENERATED: "Generated",
  APPROVED: "Approved",
  DISBURSED: "Disbursed",
  CANCELLED: "Cancelled",
};

const taka = new Intl.NumberFormat("en-BD", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** `1234.5` → `1,234.50`. Amounts here are already 2-decimal BDT. */
export function formatAmount(
  value: string | number | null | undefined,
): string {
  if (value === null || value === undefined || value === "") return "—";
  return taka.format(Number(value));
}

/** `2027-03-01` (or a Date) → `2027-03`, the month a run is keyed on. */
export function monthOf(value: string | Date): string {
  const iso = typeof value === "string" ? value : value.toISOString();
  return iso.slice(0, 7);
}

// ── shapes ──────────────────────────────────────────────────────────────

export interface Employee {
  personType: PersonType;
  personId: string;
  userId: string;
  employeeId: string;
  name: string;
  designation: string;
  departmentId: string | null;
  joiningDate: string;
  exitDate: string | null;
  status: string;
  employmentType: string | null;
  photoUrl: string | null;
  phone: string | null;
  email: string | null;
}

export interface LeaveType {
  id: string;
  name: string;
  code: string;
  annualQuota: string;
  carryForward: boolean;
  maxCarry: string;
  isPaid: boolean;
  applicableTo: LeaveApplicableTo;
  isActive: boolean;
  displayOrder: number;
}

export interface LeaveApplication {
  id: string;
  personType: PersonType;
  personId: string;
  leaveTypeId: string;
  fromDate: string;
  toDate: string;
  halfDay: boolean;
  days: string;
  reason: string;
  status: LeaveStatus;
  decisionNote: string | null;
  approvedAt: string | null;
  attachmentUrl: string | null;
  leaveType: LeaveType;
}

export interface LeaveListItem {
  application: LeaveApplication;
  employee: Employee | null;
}

export interface LeaveBalance {
  leaveType: LeaveType;
  allocated: number;
  used: number;
  carried: number;
  available: number;
}

export interface SalaryComponent {
  id?: string;
  name: string;
  type: ComponentType;
  calc: ComponentCalc;
  value: string | number;
  isTaxable: boolean;
  isPfBase: boolean;
  displayOrder?: number;
}

export interface ComputedComponent extends SalaryComponent {
  amount: number;
}

export interface StructureComputation {
  basic: number;
  components: ComputedComponent[];
  allowanceTotal: number;
  deductionTotal: number;
  gross: number;
  taxableGross: number;
  pfBase: number;
}

export interface SalaryStructure {
  id: string;
  name: string;
  grade: string | null;
  basic: string;
  description: string | null;
  isActive: boolean;
  components: SalaryComponent[];
  computed: StructureComputation;
}

export interface BankAccount {
  bankName?: string;
  branchName?: string;
  accountNo?: string;
  accountName?: string;
  routingNo?: string;
}

export interface EmployeeSalary {
  id: string;
  personType: PersonType;
  personId: string;
  structureId: string;
  basicOverride: string | null;
  effectiveFrom: string;
  bankAccount: BankAccount | null;
  paymentMode: PaymentMode;
  note: string | null;
  structure: SalaryStructure;
}

export interface PayrollRun {
  id: string;
  month: string;
  status: PayrollRunStatus;
  note: string | null;
  workingDays: number | null;
  grossTotal: string;
  netTotal: string;
  generatedAt: string | null;
  approvedAt: string | null;
  disbursedAt: string | null;
  voucherId: string | null;
  cancelReason: string | null;
}

export interface BreakdownLine {
  label: string;
  kind: "EARNING" | "DEDUCTION";
  amount: number;
  note?: string | null;
}

export interface Payslip {
  id: string;
  payrollRunId: string;
  personType: PersonType;
  personId: string;
  personName: string;
  employeeId: string;
  designation: string | null;
  basic: string;
  totalAllowances: string;
  gross: string;
  totalDeductions: string;
  attendanceDeduction: string;
  tax: string;
  pfEmployee: string;
  pfEmployer: string;
  bonus: string;
  netPayable: string;
  daysPresent: string;
  daysLeavePaid: string;
  daysAbsent: string;
  daysUnpaidLeave: string;
  workingDays: number;
  status: PayslipStatus;
  holdReason: string | null;
  paymentMode: PaymentMode;
  editReason: string | null;
  breakdown: { lines?: BreakdownLine[] } | null;
}

export type RunDetail = PayrollRun & { payslips: Payslip[] };

export interface GenerationWarning {
  code: "UNMARKED_ATTENDANCE" | "NO_SALARY" | "ZERO_PAY";
  message: string;
  details?: { days?: string[] };
}

export interface GenerationResult {
  run: RunDetail;
  generated: number;
  skipped: number;
  warnings: GenerationWarning[];
}

export interface DisbursementResult {
  run: RunDetail;
  paid: number;
  held: number;
  netTotal: number;
  voucherNo: string | null;
  pfEntries: number;
  notified: number;
}

export interface BonusRun {
  id: string;
  name: string;
  type: BonusType;
  basis: BonusBasis;
  value: string;
  monthPaidWith: string | null;
  minServiceMonths: number;
  prorate: boolean;
  applicableTo: LeaveApplicableTo;
  isActive: boolean;
}

export interface PfEntry {
  id: string;
  personType: PersonType;
  personId: string;
  month: string;
  type: PfEntryType;
  employeeAmt: string;
  employerAmt: string;
  balanceAfter: string;
  note: string | null;
  createdAt: string;
}

export interface PfStatement {
  employee: Employee;
  entries: PfEntry[];
  employeeTotal: number;
  employerTotal: number;
  withdrawn: number;
  balance: number;
}

// ── report shapes ───────────────────────────────────────────────────────

export interface RegisterRow {
  personType: PersonType;
  personId: string;
  employeeId: string;
  name: string;
  designation: string | null;
  basic: number;
  allowances: number;
  gross: number;
  attendanceDeduction: number;
  otherDeductions: number;
  pfEmployee: number;
  tax: number;
  bonus: number;
  netPayable: number;
  daysPresent: number;
  daysAbsent: number;
  workingDays: number;
  status: string;
}

export interface RegisterReport {
  from: string;
  to: string;
  runs: Array<{ id: string; month: string; status: string }>;
  rows: RegisterRow[];
  totals: {
    basic: number;
    allowances: number;
    gross: number;
    attendanceDeduction: number;
    otherDeductions: number;
    pfEmployee: number;
    tax: number;
    bonus: number;
    netPayable: number;
  };
}

export interface PfReportRow {
  personType: PersonType;
  personId: string;
  employeeId: string;
  name: string;
  employeeTotal: number;
  employerTotal: number;
  withdrawn: number;
  balance: number;
}

export interface TaxReportRow {
  personType: PersonType;
  personId: string;
  employeeId: string;
  name: string;
  taxableGross: number;
  taxDeducted: number;
  months: number;
}

export interface GradeDistributionRow {
  structureId: string;
  structureName: string;
  grade: string | null;
  basic: number;
  gross: number;
  headcount: number;
}

export interface YtdReport {
  from: string;
  to: string;
  employee: {
    personType: PersonType;
    personId: string;
    name: string;
    employeeId: string;
  };
  rows: Array<{
    month: string;
    runId: string;
    gross: number;
    deductions: number;
    pfEmployee: number;
    tax: number;
    bonus: number;
    netPayable: number;
    status: string;
  }>;
  totals: {
    gross: number;
    deductions: number;
    pfEmployee: number;
    tax: number;
    bonus: number;
    netPayable: number;
  };
}

// ── helpers ─────────────────────────────────────────────────────────────

const params = (query: object): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(query).filter(
      ([, value]) => value !== undefined && value !== "" && value !== null,
    ),
  );

async function downloadHrFile(
  path: string,
  query: object = {},
  fallback = "payroll.xlsx",
): Promise<void> {
  const res = await api.get<Blob>(path, {
    params: params(query),
    responseType: "blob",
  });
  const disposition = String(res.headers["content-disposition"] ?? "");
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const url = URL.createObjectURL(res.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = match?.[1] ?? fallback;
  link.click();
  URL.revokeObjectURL(url);
}

// ── API objects ─────────────────────────────────────────────────────────

export const employeeApi = {
  async list(
    query: {
      personType?: PersonType;
      departmentId?: string;
      search?: string;
      includeInactive?: boolean;
    } = {},
  ): Promise<Employee[]> {
    const res = await api.get<ApiEnvelope<Employee[]>>("/employees", {
      params: params(query),
    });
    return res.data.data;
  },

  async salaryHistory(
    personType: PersonType,
    personId: string,
  ): Promise<{
    employee: Employee;
    current: EmployeeSalary | null;
    history: EmployeeSalary[];
  }> {
    const res = await api.get<
      ApiEnvelope<{
        employee: Employee;
        current: EmployeeSalary | null;
        history: EmployeeSalary[];
      }>
    >(`/employees/${personType}/${personId}/salary`);
    return res.data.data;
  },

  async assignSalary(
    personId: string,
    input: {
      personType: PersonType;
      structureId: string;
      basicOverride?: number;
      effectiveFrom: string;
      paymentMode?: PaymentMode;
      bankAccount?: BankAccount;
      note?: string;
    },
  ): Promise<EmployeeSalary> {
    const res = await api.put<ApiEnvelope<EmployeeSalary>>(
      `/employees/${personId}/salary`,
      input,
    );
    return res.data.data;
  },

  async removeSalary(id: string): Promise<void> {
    await api.delete(`/employees/salary/${id}`);
  },

  async payslips(
    personType: PersonType,
    personId: string,
  ): Promise<Array<Payslip & { payrollRun: PayrollRun }>> {
    const res = await api.get<
      ApiEnvelope<Array<Payslip & { payrollRun: PayrollRun }>>
    >(`/employees/${personType}/${personId}/payslips`);
    return res.data.data;
  },
};

export const leaveTypeApi = {
  async list(): Promise<LeaveType[]> {
    const res = await api.get<ApiEnvelope<LeaveType[]>>("/leave-types");
    return res.data.data;
  },
  async create(input: Partial<LeaveType>): Promise<LeaveType> {
    const res = await api.post<ApiEnvelope<LeaveType>>("/leave-types", input);
    return res.data.data;
  },
  async update(id: string, input: Partial<LeaveType>): Promise<LeaveType> {
    const res = await api.patch<ApiEnvelope<LeaveType>>(
      `/leave-types/${id}`,
      input,
    );
    return res.data.data;
  },
  async remove(id: string): Promise<void> {
    await api.delete(`/leave-types/${id}`);
  },
};

export const leaveApi = {
  /**
   * The transform interceptor lifts `meta` to the top level and leaves
   * the rows in `data` — one unwrap, not two (the M18 lesson).
   */
  async list(
    query: {
      personType?: PersonType;
      personId?: string;
      leaveTypeId?: string;
      status?: LeaveStatus;
      from?: string;
      to?: string;
      page?: number;
      limit?: number;
    } = {},
  ): Promise<{ rows: LeaveListItem[]; total: number }> {
    const res = await api.get<
      ApiEnvelope<LeaveListItem[]> & { meta?: { total: number } }
    >("/leave-applications", { params: params(query) });
    return { rows: res.data.data, total: res.data.meta?.total ?? 0 };
  },

  async create(input: {
    personType: PersonType;
    personId: string;
    leaveTypeId: string;
    fromDate: string;
    toDate: string;
    halfDay?: boolean;
    reason: string;
  }): Promise<LeaveApplication> {
    const res = await api.post<ApiEnvelope<LeaveApplication>>(
      "/leave-applications",
      input,
    );
    return res.data.data;
  },

  async approve(
    id: string,
    body: { note?: string; override?: boolean } = {},
  ): Promise<LeaveApplication> {
    const res = await api.post<ApiEnvelope<LeaveApplication>>(
      `/leave-applications/${id}/approve`,
      body,
    );
    return res.data.data;
  },

  async reject(id: string, note?: string): Promise<LeaveApplication> {
    const res = await api.post<ApiEnvelope<LeaveApplication>>(
      `/leave-applications/${id}/reject`,
      { note },
    );
    return res.data.data;
  },

  async cancel(id: string, note?: string): Promise<LeaveApplication> {
    const res = await api.post<ApiEnvelope<LeaveApplication>>(
      `/leave-applications/${id}/cancel`,
      { note },
    );
    return res.data.data;
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/leave-applications/${id}`);
  },

  async balances(
    personType: PersonType,
    personId: string,
    sessionId?: string,
  ): Promise<LeaveBalance[]> {
    const res = await api.get<ApiEnvelope<LeaveBalance[]>>(
      `/leave-balances/${personType}/${personId}`,
      { params: params({ sessionId }) },
    );
    return res.data.data;
  },

  async allocate(input: {
    sessionId: string;
    prorate?: boolean;
    carryForward?: boolean;
    personType?: PersonType;
  }): Promise<{
    employees: number;
    rowsCreated: number;
    rowsUpdated: number;
  }> {
    const res = await api.post<
      ApiEnvelope<{
        employees: number;
        rowsCreated: number;
        rowsUpdated: number;
      }>
    >("/leave-balances/allocate", input);
    return res.data.data;
  },

  async adjust(input: {
    sessionId: string;
    personType: PersonType;
    personId: string;
    leaveTypeId: string;
    allocated: number;
    carried?: number;
  }): Promise<{ allocated: number; carried: number }> {
    const res = await api.post<
      ApiEnvelope<{ allocated: number; carried: number }>
    >("/leave-balances/adjust", input);
    return res.data.data;
  },
};

export const structureApi = {
  async list(
    query: { activeOnly?: boolean; search?: string } = {},
  ): Promise<SalaryStructure[]> {
    const res = await api.get<ApiEnvelope<SalaryStructure[]>>(
      "/salary-structures",
      { params: params(query) },
    );
    return res.data.data;
  },
  async get(id: string): Promise<SalaryStructure> {
    const res = await api.get<ApiEnvelope<SalaryStructure>>(
      `/salary-structures/${id}`,
    );
    return res.data.data;
  },
  /** The live builder preview — the same engine the payslip runs through. */
  async preview(input: {
    basic: number;
    components: SalaryComponent[];
  }): Promise<{
    computed: StructureComputation;
    problems: Array<{ index: number; name: string; message: string }>;
  }> {
    const res = await api.post<
      ApiEnvelope<{
        computed: StructureComputation;
        problems: Array<{ index: number; name: string; message: string }>;
      }>
    >("/salary-structures/preview", input);
    return res.data.data;
  },
  async create(input: {
    name: string;
    grade?: string;
    basic: number;
    description?: string;
    components: SalaryComponent[];
  }): Promise<SalaryStructure> {
    const res = await api.post<ApiEnvelope<SalaryStructure>>(
      "/salary-structures",
      input,
    );
    return res.data.data;
  },
  async update(
    id: string,
    input: Partial<{
      name: string;
      grade: string;
      basic: number;
      description: string;
      isActive: boolean;
      components: SalaryComponent[];
    }>,
  ): Promise<SalaryStructure> {
    const res = await api.patch<ApiEnvelope<SalaryStructure>>(
      `/salary-structures/${id}`,
      input,
    );
    return res.data.data;
  },
  async remove(id: string): Promise<void> {
    await api.delete(`/salary-structures/${id}`);
  },
};

export const payrollApi = {
  async list(
    query: { status?: PayrollRunStatus; year?: number; page?: number } = {},
  ): Promise<{ rows: PayrollRun[]; total: number }> {
    const res = await api.get<
      ApiEnvelope<PayrollRun[]> & { meta?: { total: number } }
    >("/payroll-runs", { params: params(query) });
    return { rows: res.data.data, total: res.data.meta?.total ?? 0 };
  },
  async get(id: string): Promise<RunDetail> {
    const res = await api.get<ApiEnvelope<RunDetail>>(`/payroll-runs/${id}`);
    return res.data.data;
  },
  async create(input: { month: string; note?: string }): Promise<RunDetail> {
    const res = await api.post<ApiEnvelope<RunDetail>>("/payroll-runs", input);
    return res.data.data;
  },
  async generate(
    id: string,
    input: { personType?: PersonType; force?: boolean } = {},
  ): Promise<GenerationResult> {
    const res = await api.post<ApiEnvelope<GenerationResult>>(
      `/payroll-runs/${id}/generate`,
      input,
    );
    return res.data.data;
  },
  async approve(id: string): Promise<RunDetail> {
    const res = await api.post<ApiEnvelope<RunDetail>>(
      `/payroll-runs/${id}/approve`,
      {},
    );
    return res.data.data;
  },
  async disburse(
    id: string,
    input: { paidOn?: string; payslipIds?: string[] } = {},
  ): Promise<DisbursementResult> {
    const res = await api.post<ApiEnvelope<DisbursementResult>>(
      `/payroll-runs/${id}/disburse`,
      input,
    );
    return res.data.data;
  },
  async cancel(id: string, reason: string): Promise<RunDetail> {
    const res = await api.post<ApiEnvelope<RunDetail>>(
      `/payroll-runs/${id}/cancel`,
      { reason },
    );
    return res.data.data;
  },
  bankAdvice: (id: string) =>
    downloadHrFile(
      `/payroll-runs/${id}/bank-advice.xlsx`,
      {},
      "bank-advice.xlsx",
    ),
};

export const payslipApi = {
  async get(id: string): Promise<Payslip> {
    const res = await api.get<ApiEnvelope<Payslip>>(`/payslips/${id}`);
    return res.data.data;
  },
  async edit(
    id: string,
    input: {
      reason: string;
      adHoc?: Array<{ label: string; type: ComponentType; amount: number }>;
      bonus?: number;
      paymentMode?: PaymentMode;
    },
  ): Promise<Payslip> {
    const res = await api.patch<ApiEnvelope<Payslip>>(`/payslips/${id}`, input);
    return res.data.data;
  },
  async hold(id: string, reason: string): Promise<Payslip> {
    const res = await api.post<ApiEnvelope<Payslip>>(`/payslips/${id}/hold`, {
      reason,
    });
    return res.data.data;
  },
  async release(id: string): Promise<Payslip> {
    const res = await api.post<ApiEnvelope<Payslip>>(
      `/payslips/${id}/release`,
      {},
    );
    return res.data.data;
  },
  pdf: (id: string) => downloadHrFile(`/payslips/${id}/pdf`, {}, "payslip.pdf"),
};

export const bonusApi = {
  async list(): Promise<BonusRun[]> {
    const res = await api.get<ApiEnvelope<BonusRun[]>>("/bonus-runs");
    return res.data.data;
  },
  async create(input: Partial<BonusRun>): Promise<BonusRun> {
    const res = await api.post<ApiEnvelope<BonusRun>>("/bonus-runs", input);
    return res.data.data;
  },
  async update(id: string, input: Partial<BonusRun>): Promise<BonusRun> {
    const res = await api.patch<ApiEnvelope<BonusRun>>(
      `/bonus-runs/${id}`,
      input,
    );
    return res.data.data;
  },
  async remove(id: string): Promise<void> {
    await api.delete(`/bonus-runs/${id}`);
  },
};

export const pfApi = {
  async statement(
    personType: PersonType,
    personId: string,
  ): Promise<PfStatement> {
    const res = await api.get<ApiEnvelope<PfStatement>>(
      `/payroll/pf/${personType}/${personId}`,
    );
    return res.data.data;
  },
  async record(input: {
    personType: PersonType;
    personId: string;
    month: string;
    type: PfEntryType;
    employeeAmt?: number;
    employerAmt?: number;
    note: string;
  }): Promise<PfEntry> {
    const res = await api.post<ApiEnvelope<PfEntry>>("/payroll/pf", input);
    return res.data.data;
  },
};

type PayrollReportQuery = {
  runId?: string;
  from?: string;
  to?: string;
  personType?: PersonType;
  personId?: string;
};

export const payrollReportApi = {
  async register(query: PayrollReportQuery): Promise<RegisterReport> {
    const res = await api.get<ApiEnvelope<RegisterReport>>(
      "/payroll/reports/register",
      { params: params(query) },
    );
    return res.data.data;
  },
  async pf(): Promise<{
    rows: PfReportRow[];
    totals: { employeeTotal: number; employerTotal: number; balance: number };
  }> {
    const res = await api.get<
      ApiEnvelope<{
        rows: PfReportRow[];
        totals: {
          employeeTotal: number;
          employerTotal: number;
          balance: number;
        };
      }>
    >("/payroll/reports/pf");
    return res.data.data;
  },
  async tax(query: PayrollReportQuery): Promise<{
    window: { from: string; to: string };
    rows: TaxReportRow[];
    total: number;
  }> {
    const res = await api.get<
      ApiEnvelope<{
        window: { from: string; to: string };
        rows: TaxReportRow[];
        total: number;
      }>
    >("/payroll/reports/tax", { params: params(query) });
    return res.data.data;
  },
  async grades(): Promise<{
    rows: GradeDistributionRow[];
    headcount: number;
    monthlyCost: number;
  }> {
    const res = await api.get<
      ApiEnvelope<{
        rows: GradeDistributionRow[];
        headcount: number;
        monthlyCost: number;
      }>
    >("/payroll/reports/grades");
    return res.data.data;
  },
  async ytd(query: PayrollReportQuery): Promise<YtdReport> {
    const res = await api.get<ApiEnvelope<YtdReport>>("/payroll/reports/ytd", {
      params: params(query),
    });
    return res.data.data;
  },

  download: (
    name: "register" | "pf" | "tax" | "grades" | "ytd",
    format: "xlsx" | "pdf",
    query: PayrollReportQuery = {},
  ) =>
    downloadHrFile(
      `/payroll/reports/${name}.${format}`,
      query,
      `${name}.${format}`,
    ),
};
