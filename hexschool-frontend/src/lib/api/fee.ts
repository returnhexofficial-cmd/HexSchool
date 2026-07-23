import { api, ApiEnvelope } from "./axios";

/**
 * Mirrors the backend Fees & Payments API (Module 16): fee heads and the
 * class × head structure matrix, per-student overrides, invoice
 * generation, the collection desk, refunds and the money reports.
 */

// ── enums (kept in step with prisma/schema.prisma) ──────────────────────

export type FeeHeadType = "RECURRING_MONTHLY" | "ONE_TIME" | "ON_DEMAND";

export type FeeOverrideType =
  | "DISCOUNT_PERCENT"
  | "DISCOUNT_FLAT"
  | "WAIVER"
  | "SCHOLARSHIP";

export type InvoiceStatus =
  | "UNPAID"
  | "PARTIAL"
  | "PAID"
  | "OVERDUE"
  | "CANCELLED"
  | "REFUNDED";

export type PaymentMethod =
  | "CASH"
  | "BANK"
  | "SSLCOMMERZ"
  | "BKASH"
  | "NAGAD"
  | "ROCKET"
  | "CHEQUE"
  | "ADJUSTMENT";

export type PaymentStatus =
  | "PENDING"
  | "SUCCESS"
  | "FAILED"
  | "REFUNDED"
  | "CANCELLED";

/** Methods the counter may record directly (the rest need a gateway). */
export const OFFLINE_METHODS: PaymentMethod[] = [
  "CASH",
  "BANK",
  "CHEQUE",
  "ADJUSTMENT",
];

const taka = new Intl.NumberFormat("en-BD", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Render an amount (string or number) as `BDT 1,234.00`. */
export function formatBDT(value: string | number): string {
  return `BDT ${taka.format(Number(value))}`;
}

// ── shapes ──────────────────────────────────────────────────────────────

export interface FeeHead {
  id: string;
  name: string;
  code: string | null;
  type: FeeHeadType;
  isRefundable: boolean;
  displayOrder: number;
}

export interface FeeStructure {
  id: string;
  sessionId: string;
  classId: string;
  feeHeadId: string;
  groupId: string | null;
  amount: string;
  dueDay: number | null;
  class?: { id: string; name: string };
  feeHead?: { id: string; name: string };
}

export interface FeeOverride {
  id: string;
  enrollmentId: string;
  feeHeadId: string;
  type: FeeOverrideType;
  value: string;
  reason: string;
  validFrom: string | null;
  validTo: string | null;
  feeHead?: { id: string; name: string };
}

export interface InvoiceItem {
  id: string;
  feeHeadId: string | null;
  description: string;
  amount: string;
  discount: string;
}

interface EnrollmentRef {
  id: string;
  rollNo: number;
  student: {
    id: string;
    studentUid: string;
    firstName: string;
    lastName: string;
  };
  class: { id: string; name: string };
  section: { id: string; name: string } | null;
}

export interface Invoice {
  id: string;
  invoiceNo: string;
  sessionId: string;
  enrollmentId: string;
  billingMonth: string | null;
  issueDate: string;
  dueDate: string;
  subtotal: string;
  discountTotal: string;
  fineTotal: string;
  paidTotal: string;
  payable: string;
  status: InvoiceStatus;
  remarks: string | null;
  enrollment: EnrollmentRef;
  items?: InvoiceItem[];
  payments?: Payment[];
}

export interface Payment {
  id: string;
  paymentNo: string;
  invoiceId: string;
  amount: string;
  method: PaymentMethod;
  status: PaymentStatus;
  reference: string | null;
  paidAt: string | null;
  verifiedAt: string | null;
  createdAt: string;
  invoice?: Invoice;
}

export interface GenerationPreviewRow {
  enrollmentId: string;
  studentUid: string;
  studentName: string;
  rollNo: number;
  className: string;
  subtotal: number;
  discountTotal: number;
  payable: number;
  prorated: boolean;
  skipped?: string;
}

export interface GenerationResult {
  dryRun: boolean;
  billingMonth: string | null;
  generated: number;
  skipped: number;
  totalPayable: number;
  rows: GenerationPreviewRow[];
}

export interface CollectionResult {
  payments: Payment[];
  totalCollected: number;
  allocations: Array<{ invoiceNo: string; amount: number; remaining: number }>;
}

export interface LedgerEntry {
  date: string;
  type: "INVOICE" | "PAYMENT" | "REFUND";
  reference: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface StudentLedger {
  studentId: string;
  enrollments: string[];
  entries: LedgerEntry[];
  totalBilled: number;
  totalPaid: number;
  outstanding: number;
}

export interface CollectionReport {
  from: string;
  to: string;
  total: number;
  byMethod: Array<{ method: PaymentMethod; amount: number; count: number }>;
  byCollector: Array<{ collectorId: string; amount: number; count: number }>;
  byDay: Array<{ date: string; amount: number; count: number }>;
  rows: Array<{
    paymentNo: string;
    paidAt: string;
    studentName: string;
    studentUid: string;
    className: string;
    invoiceNo: string;
    method: PaymentMethod;
    amount: number;
  }>;
}

export interface DuesReport {
  totalOutstanding: number;
  buckets: Array<{ bucket: string; amount: number; invoices: number }>;
  byClass: Array<{
    classId: string;
    className: string;
    outstanding: number;
    students: number;
  }>;
  defaulters: Array<{
    enrollmentId: string;
    studentUid: string;
    studentName: string;
    className: string;
    sectionName: string;
    rollNo: number;
    outstanding: number;
    oldestDueDate: string;
    bucket: string;
  }>;
}

export interface HeadWiseIncome {
  rows: Array<{
    feeHeadId: string | null;
    feeHeadName: string;
    billed: number;
    discounted: number;
    net: number;
  }>;
  totalBilled: number;
  totalDiscounted: number;
  totalNet: number;
}

// ── request bodies ──────────────────────────────────────────────────────

export interface FeeHeadInput {
  name: string;
  code?: string;
  type?: FeeHeadType;
  isRefundable?: boolean;
  displayOrder?: number;
}

export interface FeeOverrideInput {
  enrollmentId: string;
  feeHeadId: string;
  type: FeeOverrideType;
  value: number;
  reason: string;
  validFrom?: string | null;
  validTo?: string | null;
}

export interface GenerateInvoicesInput {
  sessionId?: string;
  billingMonth?: string;
  classId?: string;
  sectionId?: string;
  enrollmentIds?: string[];
  lines?: Array<{ feeHeadId: string; description?: string; amount: number }>;
  dueDate?: string;
  remarks?: string;
  dryRun?: boolean;
}

export interface CollectPaymentInput {
  invoiceIds: string[];
  amount: number;
  method: PaymentMethod;
  reference?: string;
  paidOn?: string;
  remarks?: string;
}

export interface RefundInput {
  amount: number;
  reason: string;
  method?: PaymentMethod;
}

const params = (query: object) =>
  Object.fromEntries(
    Object.entries(query).filter(([, v]) => v !== undefined && v !== ""),
  );

/** Streams an XLSX/PDF endpoint straight to a browser download. */
async function download(
  path: string,
  query: object = {},
  fallback = "fee-report.xlsx",
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

export const feeHeadApi = {
  async list(): Promise<FeeHead[]> {
    const res = await api.get<ApiEnvelope<FeeHead[]>>("/fee-heads");
    return res.data.data;
  },
  async create(input: FeeHeadInput): Promise<FeeHead> {
    const res = await api.post<ApiEnvelope<FeeHead>>("/fee-heads", input);
    return res.data.data;
  },
  async update(id: string, input: FeeHeadInput): Promise<FeeHead> {
    const res = await api.put<ApiEnvelope<FeeHead>>(`/fee-heads/${id}`, input);
    return res.data.data;
  },
  async remove(id: string): Promise<void> {
    await api.delete(`/fee-heads/${id}`);
  },
};

export const feeStructureApi = {
  async list(query: {
    sessionId?: string;
    classId?: string;
  }): Promise<FeeStructure[]> {
    const res = await api.get<ApiEnvelope<FeeStructure[]>>("/fee-structures", {
      params: params(query),
    });
    return res.data.data;
  },
  async save(input: {
    sessionId?: string;
    structures: Array<{
      classId: string;
      feeHeadId: string;
      groupId?: string | null;
      amount: number;
      dueDay?: number | null;
    }>;
  }): Promise<FeeStructure[]> {
    const res = await api.put<ApiEnvelope<FeeStructure[]>>(
      "/fee-structures",
      input,
    );
    return res.data.data;
  },
  async remove(id: string): Promise<void> {
    await api.delete(`/fee-structures/${id}`);
  },
};

export const feeOverrideApi = {
  async list(enrollmentId: string): Promise<FeeOverride[]> {
    const res = await api.get<ApiEnvelope<FeeOverride[]>>("/fee-overrides", {
      params: { enrollmentId },
    });
    return res.data.data;
  },
  async create(input: FeeOverrideInput): Promise<FeeOverride> {
    const res = await api.post<ApiEnvelope<FeeOverride>>(
      "/fee-overrides",
      input,
    );
    return res.data.data;
  },
  async remove(id: string): Promise<void> {
    await api.delete(`/fee-overrides/${id}`);
  },
};

export const invoiceApi = {
  async list(query: {
    sessionId?: string;
    classId?: string;
    status?: InvoiceStatus;
    billingMonth?: string;
    search?: string;
  }): Promise<Invoice[]> {
    const res = await api.get<ApiEnvelope<Invoice[]>>("/invoices", {
      params: params(query),
    });
    return res.data.data;
  },
  async get(id: string): Promise<Invoice> {
    const res = await api.get<ApiEnvelope<Invoice>>(`/invoices/${id}`);
    return res.data.data;
  },
  async generate(input: GenerateInvoicesInput): Promise<GenerationResult> {
    const res = await api.post<ApiEnvelope<GenerationResult>>(
      "/invoices/generate",
      input,
    );
    return res.data.data;
  },
  async cancel(id: string, reason: string): Promise<Invoice> {
    const res = await api.post<ApiEnvelope<Invoice>>(`/invoices/${id}/cancel`, {
      reason,
    });
    return res.data.data;
  },
  downloadPdf(id: string): Promise<void> {
    return download(`/invoices/${id}/pdf`, {}, `invoice-${id}.pdf`);
  },
};

export const paymentApi = {
  async collect(input: CollectPaymentInput): Promise<CollectionResult> {
    const res = await api.post<ApiEnvelope<CollectionResult>>(
      "/payments/collect",
      input,
    );
    return res.data.data;
  },
  async get(id: string): Promise<Payment> {
    const res = await api.get<ApiEnvelope<Payment>>(`/payments/${id}`);
    return res.data.data;
  },
  async refund(id: string, input: RefundInput): Promise<Payment> {
    const res = await api.post<ApiEnvelope<Payment>>(
      `/payments/${id}/refund`,
      input,
    );
    return res.data.data;
  },
  downloadReceipt(id: string, layout?: "thermal"): Promise<void> {
    return download(
      `/payments/${id}/receipt.pdf`,
      layout ? { layout } : {},
      `receipt-${id}.pdf`,
    );
  },
};

export const ledgerApi = {
  async ledger(studentId: string, sessionId?: string): Promise<StudentLedger> {
    const res = await api.get<ApiEnvelope<StudentLedger>>(
      `/students/${studentId}/ledger`,
      { params: params({ sessionId }) },
    );
    return res.data.data;
  },
};

export const feeReportApi = {
  async dues(query: { sessionId?: string }): Promise<DuesReport> {
    const res = await api.get<ApiEnvelope<DuesReport>>("/fee-reports/dues", {
      params: params(query),
    });
    return res.data.data;
  },
  async daily(query: { from?: string; to?: string }): Promise<CollectionReport> {
    const res = await api.get<ApiEnvelope<CollectionReport>>(
      "/fee-reports/daily",
      { params: params(query) },
    );
    return res.data.data;
  },
  async headWise(query: { sessionId?: string }): Promise<HeadWiseIncome> {
    const res = await api.get<ApiEnvelope<HeadWiseIncome>>(
      "/fee-reports/head-wise",
      { params: params(query) },
    );
    return res.data.data;
  },
  downloadDues(sessionId?: string): Promise<void> {
    return download("/fee-reports/dues.xlsx", { sessionId }, "dues.xlsx");
  },
  downloadDaily(from?: string, to?: string): Promise<void> {
    return download(
      "/fee-reports/daily.xlsx",
      { from, to },
      "collection.xlsx",
    );
  },
  downloadHeadWise(sessionId?: string): Promise<void> {
    return download(
      "/fee-reports/head-wise.xlsx",
      { sessionId },
      "head-wise.xlsx",
    );
  },
};
