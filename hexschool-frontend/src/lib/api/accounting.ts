import { api, ApiEnvelope } from "./axios";

/**
 * Mirrors the backend Accounting & Finance API (Module 20): the chart of
 * accounts, double-entry vouchers, the fee-head → account posting map,
 * budgets, fiscal periods and the eight reports.
 */

// ── enums (kept in step with prisma/schema.prisma) ──────────────────────

export type AccountGroup =
  | "ASSET"
  | "LIABILITY"
  | "EQUITY"
  | "INCOME"
  | "EXPENSE";

export type AccountType =
  | "CASH"
  | "BANK"
  | "RECEIVABLE"
  | "PAYABLE"
  | "INCOME"
  | "EXPENSE"
  | "EQUITY"
  | "OTHER";

export type VoucherType = "DEBIT" | "CREDIT" | "JOURNAL" | "CONTRA";
export type VoucherStatus = "DRAFT" | "POSTED" | "CANCELLED";
export type VoucherSource =
  | "MANUAL"
  | "FEES"
  | "PAYROLL"
  | "INVENTORY"
  | "ADMISSION";
export type BudgetPeriod = "YEARLY" | "MONTHLY";
export type FiscalPeriodStatus = "OPEN" | "CLOSED";
export type PostingMapKind = "FEE_HEAD" | "PAYMENT_METHOD" | "SYSTEM";
export type EntrySide = "DEBIT" | "CREDIT";

export const ACCOUNT_GROUPS: AccountGroup[] = [
  "ASSET",
  "LIABILITY",
  "EQUITY",
  "INCOME",
  "EXPENSE",
];

/** How each group reads on a statement — the sidebar and tree headings. */
export const GROUP_LABELS: Record<AccountGroup, string> = {
  ASSET: "Assets",
  LIABILITY: "Liabilities",
  EQUITY: "Equity & Fund",
  INCOME: "Income",
  EXPENSE: "Expenditure",
};

export const VOUCHER_TYPE_LABELS: Record<VoucherType, string> = {
  CREDIT: "Receipt (CV)",
  DEBIT: "Payment (DV)",
  JOURNAL: "Journal (JV)",
  CONTRA: "Contra (CN)",
};

/**
 * The system posting slots. Mirrors `SYSTEM_SLOTS` in
 * `accounting/calc/posting.engine.ts` — the posting-map page renders one
 * row per slot so a school can see what auto-posting will do before any
 * money moves.
 */
export const SYSTEM_SLOTS: Array<{ key: string; label: string; hint: string }> =
  [
    {
      key: "FEE_INCOME_DEFAULT",
      label: "Default fee income",
      hint: "Where a fee head with no mapping of its own is credited",
    },
    {
      key: "LATE_FINE_INCOME",
      label: "Late fine income",
      hint: "The fine portion of an invoice",
    },
    {
      key: "CASH_DEFAULT",
      label: "Default cash account",
      hint: "Where a payment method with no mapping lands",
    },
    {
      key: "GATEWAY_CHARGES",
      label: "Gateway charges",
      hint: "The commission a gateway keeps at settlement",
    },
    {
      key: "OPENING_EQUITY",
      label: "Opening equity",
      hint: "The balancing side of the opening-balance journal",
    },
  ];

const taka = new Intl.NumberFormat("en-BD", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** `1234.5` → `1,234.50`. Amounts here are already 2-decimal BDT. */
export function formatAmount(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return taka.format(Number(value));
}

// ── shapes ──────────────────────────────────────────────────────────────

export interface Account {
  id: string;
  parentId: string | null;
  group: AccountGroup;
  type: AccountType;
  code: string;
  name: string;
  nameBn: string | null;
  openingBalance: string;
  bankAccountNo: string | null;
  bankName: string | null;
  branchName: string | null;
  isGroup: boolean;
  isSystem: boolean;
  isActive: boolean;
  description: string | null;
  displayOrder: number;
}

export interface AccountTreeNode {
  account: Account & { raw: Account };
  children: AccountTreeNode[];
  depth: number;
}

export interface AccountTree {
  groups: Array<{ group: AccountGroup; roots: AccountTreeNode[] }>;
  flat: Array<{ id: string; code: string; name: string; depth: number }>;
}

export interface VoucherEntry {
  id: string;
  accountId: string;
  debit: string;
  credit: string;
  narration: string | null;
  displayOrder: number;
  account: {
    id: string;
    code: string;
    name: string;
    group: AccountGroup;
    type: AccountType;
  };
}

export interface Voucher {
  id: string;
  voucherNo: string;
  type: VoucherType;
  source: VoucherSource;
  status: VoucherStatus;
  date: string;
  narration: string;
  reference: string | null;
  sourceRef: string | null;
  postedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  reversalOfVoucherId: string | null;
  entries: VoucherEntry[];
}

export interface PostingMapRow {
  id: string;
  kind: PostingMapKind;
  refKey: string;
  accountId: string;
  account: {
    id: string;
    code: string;
    name: string;
    group: AccountGroup;
    type: AccountType;
  };
}

export interface Budget {
  id: string;
  sessionId: string;
  accountId: string;
  period: BudgetPeriod;
  month: number | null;
  amount: string;
  note: string | null;
  account: { id: string; code: string; name: string; group: AccountGroup };
}

export interface FiscalPeriod {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: FiscalPeriodStatus;
  closedAt: string | null;
  reopenedAt: string | null;
  closingNote: string | null;
}

// ── report shapes ───────────────────────────────────────────────────────

export interface ReportWindow {
  from: string;
  to: string;
}

export interface LedgerRow {
  date: string;
  voucherId: string;
  voucherNo: string;
  voucherType: VoucherType;
  narration: string;
  contra?: string[];
  debit: number;
  credit: number;
  balance: number;
  balanceSide: EntrySide;
}

export interface LedgerReport extends ReportWindow {
  account: { id: string; code: string; name: string; group: AccountGroup };
  openingBalance: number;
  openingSide: EntrySide;
  rows: LedgerRow[];
  debitTotal: number;
  creditTotal: number;
  closingBalance: number;
  closingSide: EntrySide;
}

export interface BookRow {
  date: string;
  voucherNo: string;
  narration: string;
  particulars: string;
  receipt: number;
  payment: number;
  balance: number;
}

export interface BookReport extends ReportWindow {
  account: { id: string; code: string; name: string };
  openingBalance: number;
  rows: BookRow[];
  receiptTotal: number;
  paymentTotal: number;
  closingBalance: number;
}

export interface TrialBalanceReport extends ReportWindow {
  rows: Array<{
    accountId: string;
    code: string;
    name: string;
    group: AccountGroup;
    debit: number;
    credit: number;
  }>;
  debitTotal: number;
  creditTotal: number;
  difference: number;
  balanced: boolean;
}

export interface StatementLine {
  accountId: string;
  code: string;
  name: string;
  amount: number;
}

export interface IncomeStatementReport extends ReportWindow {
  income: StatementLine[];
  expense: StatementLine[];
  incomeTotal: number;
  expenseTotal: number;
  surplus: number;
}

export interface BalanceSheetReport extends ReportWindow {
  assets: StatementLine[];
  liabilities: StatementLine[];
  equity: StatementLine[];
  assetTotal: number;
  liabilityTotal: number;
  equityTotal: number;
  surplus: number;
  fundedTotal: number;
  difference: number;
  balanced: boolean;
}

export interface ReceiptsPaymentsReport extends ReportWindow {
  openingCash: number;
  receipts: StatementLine[];
  payments: StatementLine[];
  receiptTotal: number;
  paymentTotal: number;
  closingCash: number;
}

export interface BudgetVarianceReport extends ReportWindow {
  sessionId: string;
  rows: Array<{
    accountId: string;
    code: string;
    name: string;
    group: AccountGroup;
    budget: number;
    actual: number;
    variance: number;
    usedPercent: number | null;
    favourable: boolean;
  }>;
  budgetTotal: number;
  actualTotal: number;
  variance: number;
}

// ── request bodies ──────────────────────────────────────────────────────

export interface AccountInput {
  group?: AccountGroup;
  type?: AccountType;
  code?: string;
  name?: string;
  nameBn?: string;
  parentId?: string | null;
  isGroup?: boolean;
  isActive?: boolean;
  openingBalance?: number;
  bankAccountNo?: string;
  bankName?: string;
  branchName?: string;
  description?: string;
  displayOrder?: number;
}

export interface VoucherEntryInput {
  accountId: string;
  debit: number;
  credit: number;
  narration?: string;
}

export interface VoucherInput {
  type: VoucherType;
  date: string;
  narration: string;
  reference?: string;
  attachmentUrl?: string;
  entries: VoucherEntryInput[];
  post?: boolean;
}

export interface BudgetInput {
  sessionId: string;
  accountId: string;
  period?: BudgetPeriod;
  month?: number;
  amount: number;
  note?: string;
}

export interface SettlementInput {
  clearingAccountId: string;
  bankAccountId: string;
  gross: number;
  charges: number;
  date: string;
  reference?: string;
}

export interface OpeningBalancesInput {
  date: string;
  lines: Array<{ accountId: string; debit: number; credit: number }>;
  narration?: string;
}

const params = (query: object) =>
  Object.fromEntries(
    Object.entries(query).filter(([, v]) => v !== undefined && v !== ""),
  );

/** Streams an XLSX/PDF endpoint straight to a browser download. */
export async function downloadAccountingFile(
  path: string,
  query: object = {},
  fallback = "accounting-report.xlsx",
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

export const accountApi = {
  async list(query: {
    group?: AccountGroup;
    type?: AccountType;
    search?: string;
    postableOnly?: boolean;
    activeOnly?: boolean;
  } = {}): Promise<Account[]> {
    const res = await api.get<ApiEnvelope<Account[]>>("/accounts", {
      params: params(query),
    });
    return res.data.data;
  },
  async tree(): Promise<AccountTree> {
    const res = await api.get<ApiEnvelope<AccountTree>>("/accounts/tree");
    return res.data.data;
  },
  async suggestCode(query: {
    group: AccountGroup;
    parentId?: string;
  }): Promise<{ code: string }> {
    const res = await api.get<ApiEnvelope<{ code: string }>>(
      "/accounts/suggest-code",
      { params: params(query) },
    );
    return res.data.data;
  },
  async create(input: AccountInput): Promise<Account> {
    const res = await api.post<ApiEnvelope<Account>>("/accounts", input);
    return res.data.data;
  },
  async update(id: string, input: AccountInput): Promise<Account> {
    const res = await api.patch<ApiEnvelope<Account>>(`/accounts/${id}`, input);
    return res.data.data;
  },
  async remove(id: string): Promise<void> {
    await api.delete(`/accounts/${id}`);
  },
};

export const voucherApi = {
  /**
   * The transform interceptor lifts `meta` to the top level and leaves
   * the rows in `data` — one unwrap, not two (the M18 lesson).
   */
  async list(query: {
    type?: VoucherType;
    status?: VoucherStatus;
    source?: VoucherSource;
    from?: string;
    to?: string;
    accountId?: string;
    search?: string;
    page?: number;
    limit?: number;
  } = {}): Promise<{ rows: Voucher[]; total: number }> {
    const res = await api.get<
      ApiEnvelope<Voucher[]> & { meta?: { total: number } }
    >("/vouchers", { params: params(query) });
    return { rows: res.data.data, total: res.data.meta?.total ?? 0 };
  },
  async get(id: string): Promise<Voucher> {
    const res = await api.get<ApiEnvelope<Voucher>>(`/vouchers/${id}`);
    return res.data.data;
  },
  async create(input: VoucherInput): Promise<Voucher> {
    const res = await api.post<ApiEnvelope<Voucher>>("/vouchers", input);
    return res.data.data;
  },
  async update(id: string, input: Partial<VoucherInput>): Promise<Voucher> {
    const res = await api.patch<ApiEnvelope<Voucher>>(`/vouchers/${id}`, input);
    return res.data.data;
  },
  async post(id: string): Promise<Voucher> {
    const res = await api.post<ApiEnvelope<Voucher>>(`/vouchers/${id}/post`, {});
    return res.data.data;
  },
  async cancel(
    id: string,
    reason: string,
  ): Promise<{ voucher: Voucher; reversal: Voucher | null }> {
    const res = await api.post<
      ApiEnvelope<{ voucher: Voucher; reversal: Voucher | null }>
    >(`/vouchers/${id}/cancel`, { reason });
    return res.data.data;
  },
  print(id: string): Promise<void> {
    return downloadAccountingFile(`/vouchers/${id}/print.pdf`, {}, "voucher.pdf");
  },
  async settlement(input: SettlementInput): Promise<Voucher> {
    const res = await api.post<ApiEnvelope<Voucher>>(
      "/vouchers/tools/settlement",
      input,
    );
    return res.data.data;
  },
  async openingBalances(input: OpeningBalancesInput): Promise<Voucher> {
    const res = await api.post<ApiEnvelope<Voucher>>(
      "/vouchers/tools/opening-balances",
      input,
    );
    return res.data.data;
  },
};

export const postingMapApi = {
  async list(): Promise<PostingMapRow[]> {
    const res = await api.get<ApiEnvelope<PostingMapRow[]>>(
      "/accounting/posting-map",
    );
    return res.data.data;
  },
  async update(
    mappings: Array<{
      kind: PostingMapKind;
      refKey: string;
      accountId?: string | null;
    }>,
  ): Promise<PostingMapRow[]> {
    const res = await api.put<ApiEnvelope<PostingMapRow[]>>(
      "/accounting/posting-map",
      { mappings },
    );
    return res.data.data;
  },
};

export const budgetApi = {
  async list(sessionId: string): Promise<Budget[]> {
    const res = await api.get<ApiEnvelope<Budget[]>>("/budgets", {
      params: { sessionId },
    });
    return res.data.data;
  },
  async create(input: BudgetInput): Promise<Budget> {
    const res = await api.post<ApiEnvelope<Budget>>("/budgets", input);
    return res.data.data;
  },
  async update(
    id: string,
    input: { amount?: number; note?: string },
  ): Promise<Budget> {
    const res = await api.patch<ApiEnvelope<Budget>>(`/budgets/${id}`, input);
    return res.data.data;
  },
  async remove(id: string): Promise<void> {
    await api.delete(`/budgets/${id}`);
  },
};

export const fiscalPeriodApi = {
  async list(): Promise<FiscalPeriod[]> {
    const res = await api.get<ApiEnvelope<FiscalPeriod[]>>("/fiscal-periods");
    return res.data.data;
  },
  async create(input: {
    name: string;
    startDate: string;
    endDate: string;
  }): Promise<FiscalPeriod> {
    const res = await api.post<ApiEnvelope<FiscalPeriod>>(
      "/fiscal-periods",
      input,
    );
    return res.data.data;
  },
  async close(id: string, note?: string): Promise<FiscalPeriod> {
    const res = await api.post<ApiEnvelope<FiscalPeriod>>(
      `/fiscal-periods/${id}/close`,
      { note },
    );
    return res.data.data;
  },
  async reopen(id: string, reason: string): Promise<FiscalPeriod> {
    const res = await api.post<ApiEnvelope<FiscalPeriod>>(
      `/fiscal-periods/${id}/reopen`,
      { reason },
    );
    return res.data.data;
  },
  async remove(id: string): Promise<void> {
    await api.delete(`/fiscal-periods/${id}`);
  },
};

type ReportQuery = {
  from?: string;
  to?: string;
  accountId?: string;
  sessionId?: string;
  month?: number;
};

const report = async <T>(name: string, query: ReportQuery): Promise<T> => {
  const res = await api.get<ApiEnvelope<T>>(`/accounting/reports/${name}`, {
    params: params(query),
  });
  return res.data.data;
};

export const accountingReportApi = {
  cashBook: (query: ReportQuery) => report<BookReport>("cash-book", query),
  bankBook: (query: ReportQuery) => report<BookReport>("bank-book", query),
  ledger: (query: ReportQuery) => report<LedgerReport>("ledger", query),
  trialBalance: (query: ReportQuery) =>
    report<TrialBalanceReport>("trial-balance", query),
  incomeStatement: (query: ReportQuery) =>
    report<IncomeStatementReport>("income-statement", query),
  balanceSheet: (query: ReportQuery) =>
    report<BalanceSheetReport>("balance-sheet", query),
  receiptsPayments: (query: ReportQuery) =>
    report<ReceiptsPaymentsReport>("receipts-payments", query),
  budgetVsActual: (query: ReportQuery) =>
    report<BudgetVarianceReport>("budget-vs-actual", query),

  download: (name: string, format: "xlsx" | "pdf", query: ReportQuery) =>
    downloadAccountingFile(
      `/accounting/reports/${name}.${format}`,
      query,
      `${name}.${format}`,
    ),
};
