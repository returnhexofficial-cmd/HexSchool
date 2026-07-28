"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Can } from "@/components/shared/can";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  accountApi,
  accountingReportApi,
  formatAmount,
  type BalanceSheetReport,
  type BookReport,
  type BudgetVarianceReport,
  type IncomeStatementReport,
  type LedgerReport,
  type ReceiptsPaymentsReport,
  type StatementLine,
  type TrialBalanceReport,
} from "@/lib/api/accounting";

type ReportKey =
  | "trial-balance"
  | "income-statement"
  | "balance-sheet"
  | "cash-book"
  | "bank-book"
  | "ledger"
  | "receipts-payments"
  | "budget-vs-actual";

const REPORTS: Array<{ key: ReportKey; label: string; needsAccount?: boolean }> =
  [
    { key: "trial-balance", label: "Trial balance" },
    { key: "income-statement", label: "Income & expenditure" },
    { key: "balance-sheet", label: "Balance sheet" },
    { key: "cash-book", label: "Cash book" },
    { key: "bank-book", label: "Bank book" },
    { key: "ledger", label: "General ledger", needsAccount: true },
    { key: "receipts-payments", label: "Receipts & payments" },
    { key: "budget-vs-actual", label: "Budget vs actual" },
  ];

/** Every shape the parameter bar can produce; `ReportBody` narrows it. */
type ReportResult =
  | TrialBalanceReport
  | IncomeStatementReport
  | BalanceSheetReport
  | BookReport
  | LedgerReport
  | ReceiptsPaymentsReport
  | BudgetVarianceReport;

const PDF_REPORTS: ReportKey[] = [
  "trial-balance",
  "income-statement",
  "balance-sheet",
  "receipts-payments",
];

const firstOfMonth = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
};

/**
 * The report pages (roadmap M20 §5: "parameter bar + tabular results +
 * drill-down, export/print").
 *
 * The drill-down chain the roadmap asks for is here: a trial-balance row
 * jumps to that account's ledger, and a ledger row names its voucher —
 * which is how somebody chasing a number gets from "the total looks wrong"
 * to the document that caused it.
 */
export function AccountingReportsTab({ sessionId }: { sessionId: string | null }) {
  const [report, setReport] = useState<ReportKey>("trial-balance");
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [accountId, setAccountId] = useState<string>("");

  const accounts = useQuery({
    queryKey: ["accounts", "postable"],
    queryFn: () => accountApi.list({ postableOnly: true }),
  });

  const definition = REPORTS.find((r) => r.key === report);
  const query = { from, to, accountId: accountId || undefined, sessionId: sessionId ?? undefined };

  const result = useQuery<ReportResult>({
    queryKey: ["accounting-report", report, from, to, accountId, sessionId],
    queryFn: (): Promise<ReportResult> => {
      switch (report) {
        case "trial-balance":
          return accountingReportApi.trialBalance(query);
        case "income-statement":
          return accountingReportApi.incomeStatement(query);
        case "balance-sheet":
          return accountingReportApi.balanceSheet(query);
        case "cash-book":
          return accountingReportApi.cashBook(query);
        case "bank-book":
          return accountingReportApi.bankBook(query);
        case "ledger":
          return accountingReportApi.ledger(query);
        case "receipts-payments":
          return accountingReportApi.receiptsPayments(query);
        default:
          return accountingReportApi.budgetVsActual(query);
      }
    },
    enabled:
      (!definition?.needsAccount || accountId !== "") &&
      (report !== "budget-vs-actual" || sessionId !== null),
  });

  /** The drill-down: jump to one account's ledger for the same window. */
  const drillTo = (id: string) => {
    setAccountId(id);
    setReport("ledger");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
        <div className="space-y-1">
          <Label className="text-xs">Report</Label>
          <Select
            value={report}
            onValueChange={(value) => setReport(value as ReportKey)}
          >
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REPORTS.map((entry) => (
                <SelectItem key={entry.key} value={entry.key}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="r-from" className="text-xs">
            From
          </Label>
          <Input
            id="r-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-40"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="r-to" className="text-xs">
            To
          </Label>
          <Input
            id="r-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-40"
          />
        </div>

        {report === "ledger" || report === "cash-book" || report === "bank-book" ? (
          <div className="space-y-1">
            <Label className="text-xs">Account</Label>
            <Select
              value={accountId || "__all__"}
              onValueChange={(value) =>
                setAccountId(value === "__all__" ? "" : value)
              }
            >
              <SelectTrigger className="w-72">
                <SelectValue placeholder="Pick an account" />
              </SelectTrigger>
              <SelectContent>
                {report !== "ledger" ? (
                  <SelectItem value="__all__">All accounts</SelectItem>
                ) : null}
                {(accounts.data ?? []).map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.code} — {account.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        <div className="ml-auto flex gap-2">
          <Can permission="accounting.export">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void accountingReportApi.download(report, "xlsx", query)
              }
            >
              XLSX
            </Button>
            {PDF_REPORTS.includes(report) ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void accountingReportApi.download(report, "pdf", query)
                }
              >
                PDF
              </Button>
            ) : null}
          </Can>
        </div>
      </div>

      {definition?.needsAccount && !accountId ? (
        <EmptyState
          title="Pick an account"
          description="A general ledger is one account's story."
        />
      ) : report === "budget-vs-actual" && !sessionId ? (
        <EmptyState
          title="Pick an academic session"
          description="Budgets are set per session — use the session switcher in the header."
        />
      ) : result.isPending ? (
        <LoadingBlock />
      ) : result.isError ? (
        <ErrorState onRetry={() => void result.refetch()} />
      ) : (
        <ReportBody
          report={report}
          data={result.data}
          onDrillDown={drillTo}
        />
      )}
    </div>
  );
}

function ReportBody({
  report,
  data,
  onDrillDown,
}: {
  report: ReportKey;
  data: unknown;
  onDrillDown: (accountId: string) => void;
}) {
  switch (report) {
    case "trial-balance":
      return (
        <TrialBalanceView
          data={data as TrialBalanceReport}
          onDrillDown={onDrillDown}
        />
      );
    case "income-statement":
      return (
        <IncomeStatementView
          data={data as IncomeStatementReport}
          onDrillDown={onDrillDown}
        />
      );
    case "balance-sheet":
      return (
        <BalanceSheetView
          data={data as BalanceSheetReport}
          onDrillDown={onDrillDown}
        />
      );
    case "cash-book":
    case "bank-book":
      return <BookView data={data as BookReport} />;
    case "ledger":
      return <LedgerView data={data as LedgerReport} />;
    case "receipts-payments":
      return <ReceiptsPaymentsView data={data as ReceiptsPaymentsReport} />;
    default:
      return <BudgetVarianceView data={data as BudgetVarianceReport} />;
  }
}

// ── views ───────────────────────────────────────────────────────────────

function BalanceBanner({ balanced, difference }: { balanced: boolean; difference: number }) {
  return (
    <Badge variant={balanced ? "default" : "destructive"}>
      {balanced ? "Balanced" : `Out of balance by ${formatAmount(Math.abs(difference))}`}
    </Badge>
  );
}

function TrialBalanceView({
  data,
  onDrillDown,
}: {
  data: TrialBalanceReport;
  onDrillDown: (accountId: string) => void;
}) {
  if (data.rows.length === 0)
    return <EmptyState title="Nothing posted in this window" />;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-semibold">
          Trial balance {data.from} → {data.to}
        </h3>
        <BalanceBanner balanced={data.balanced} difference={data.difference} />
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Code</TableHead>
              <TableHead>Account</TableHead>
              <TableHead className="text-right">Debit</TableHead>
              <TableHead className="text-right">Credit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((row) => (
              <TableRow
                key={row.accountId}
                className="cursor-pointer"
                onClick={() => onDrillDown(row.accountId)}
                title="Open this account's ledger"
              >
                <TableCell className="font-mono text-xs">{row.code}</TableCell>
                <TableCell>{row.name}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.debit ? formatAmount(row.debit) : ""}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.credit ? formatAmount(row.credit) : ""}
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="font-semibold">
              <TableCell colSpan={2}>Total</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatAmount(data.debitTotal)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatAmount(data.creditTotal)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function StatementSection({
  heading,
  lines,
  total,
  totalLabel,
  onDrillDown,
}: {
  heading: string;
  lines: StatementLine[];
  total: number;
  totalLabel: string;
  onDrillDown?: (accountId: string) => void;
}) {
  return (
    <div className="rounded-md border">
      <h4 className="border-b bg-muted/40 px-3 py-2 text-sm font-semibold">
        {heading}
      </h4>
      <Table>
        <TableBody>
          {lines.length === 0 ? (
            <TableRow>
              <TableCell className="text-muted-foreground">Nothing here</TableCell>
              <TableCell />
            </TableRow>
          ) : (
            lines.map((line) => (
              <TableRow
                key={line.accountId}
                className={onDrillDown ? "cursor-pointer" : undefined}
                onClick={() => onDrillDown?.(line.accountId)}
              >
                <TableCell>
                  <span className="font-mono text-xs text-muted-foreground">
                    {line.code}
                  </span>{" "}
                  {line.name}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatAmount(line.amount)}
                </TableCell>
              </TableRow>
            ))
          )}
          <TableRow className="font-semibold">
            <TableCell>{totalLabel}</TableCell>
            <TableCell className="text-right tabular-nums">
              {formatAmount(total)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

function IncomeStatementView({
  data,
  onDrillDown,
}: {
  data: IncomeStatementReport;
  onDrillDown: (accountId: string) => void;
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">
        Income &amp; expenditure {data.from} → {data.to}
      </h3>
      <div className="grid gap-3 md:grid-cols-2">
        <StatementSection
          heading="Income"
          lines={data.income}
          total={data.incomeTotal}
          totalLabel="Total income"
          onDrillDown={onDrillDown}
        />
        <StatementSection
          heading="Expenditure"
          lines={data.expense}
          total={data.expenseTotal}
          totalLabel="Total expenditure"
          onDrillDown={onDrillDown}
        />
      </div>
      <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm font-semibold">
        {data.surplus >= 0 ? "Surplus" : "Deficit"} for the period:{" "}
        <span className="tabular-nums">
          {formatAmount(Math.abs(data.surplus))}
        </span>
      </div>
    </div>
  );
}

function BalanceSheetView({
  data,
  onDrillDown,
}: {
  data: BalanceSheetReport;
  onDrillDown: (accountId: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-semibold">Balance sheet as at {data.to}</h3>
        <BalanceBanner balanced={data.balanced} difference={data.difference} />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <StatementSection
          heading="Assets"
          lines={data.assets}
          total={data.assetTotal}
          totalLabel="Total assets"
          onDrillDown={onDrillDown}
        />
        <div className="space-y-3">
          <StatementSection
            heading="Liabilities"
            lines={data.liabilities}
            total={data.liabilityTotal}
            totalLabel="Total liabilities"
            onDrillDown={onDrillDown}
          />
          <StatementSection
            heading="Equity & fund"
            lines={[
              ...data.equity,
              {
                accountId: "__surplus__",
                code: "",
                name: "Surplus for the period",
                amount: data.surplus,
              },
            ]}
            total={data.fundedTotal}
            totalLabel="Total equity & liabilities"
          />
        </div>
      </div>
    </div>
  );
}

function BookView({ data }: { data: BookReport }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">
        {data.account.name} · {data.from} → {data.to} · opening{" "}
        {formatAmount(data.openingBalance)}
      </h3>
      {data.rows.length === 0 ? (
        <EmptyState title="No movements in this window" />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Date</TableHead>
                <TableHead className="w-28">Voucher</TableHead>
                <TableHead>Particulars</TableHead>
                <TableHead className="text-right">Receipt</TableHead>
                <TableHead className="text-right">Payment</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((row, index) => (
                <TableRow key={`${row.voucherNo}-${index}`}>
                  <TableCell>{row.date}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {row.voucherNo}
                  </TableCell>
                  <TableCell>
                    <div>{row.particulars || row.narration}</div>
                    {row.particulars ? (
                      <div className="text-xs text-muted-foreground">
                        {row.narration}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.receipt ? formatAmount(row.receipt) : ""}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.payment ? formatAmount(row.payment) : ""}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatAmount(row.balance)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="font-semibold">
                <TableCell colSpan={3}>Total</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatAmount(data.receiptTotal)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatAmount(data.paymentTotal)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatAmount(data.closingBalance)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function LedgerView({ data }: { data: LedgerReport }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">
        <span className="font-mono text-xs text-muted-foreground">
          {data.account.code}
        </span>{" "}
        {data.account.name} · {data.from} → {data.to}
        <span className="ml-3 font-normal text-muted-foreground">
          opening {formatAmount(data.openingBalance)} {data.openingSide}
        </span>
      </h3>
      {data.rows.length === 0 ? (
        <EmptyState title="No movements in this window" />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Date</TableHead>
                <TableHead className="w-28">Voucher</TableHead>
                <TableHead>Particulars</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Credit</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((row, index) => (
                <TableRow key={`${row.voucherNo}-${index}`}>
                  <TableCell>{row.date}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {row.voucherNo}
                  </TableCell>
                  <TableCell>
                    <div>{(row.contra ?? []).join(", ") || row.narration}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.narration}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.debit ? formatAmount(row.debit) : ""}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.credit ? formatAmount(row.credit) : ""}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatAmount(row.balance)}{" "}
                    <span className="text-xs text-muted-foreground">
                      {row.balanceSide === "DEBIT" ? "Dr" : "Cr"}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="font-semibold">
                <TableCell colSpan={3}>Total</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatAmount(data.debitTotal)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatAmount(data.creditTotal)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatAmount(data.closingBalance)}{" "}
                  <span className="text-xs">
                    {data.closingSide === "DEBIT" ? "Dr" : "Cr"}
                  </span>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function ReceiptsPaymentsView({ data }: { data: ReceiptsPaymentsReport }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">
        Receipts &amp; payments {data.from} → {data.to}
      </h3>
      <div className="grid gap-3 md:grid-cols-2">
        <StatementSection
          heading="Receipts"
          lines={[
            {
              accountId: "__opening__",
              code: "",
              name: "Opening cash & bank",
              amount: data.openingCash,
            },
            ...data.receipts,
          ]}
          total={data.receiptTotal}
          totalLabel="Total receipts"
        />
        <StatementSection
          heading="Payments"
          lines={data.payments}
          total={data.paymentTotal}
          totalLabel="Total payments"
        />
      </div>
      <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm font-semibold">
        Closing cash &amp; bank:{" "}
        <span className="tabular-nums">{formatAmount(data.closingCash)}</span>
      </div>
    </div>
  );
}

function BudgetVarianceView({ data }: { data: BudgetVarianceReport }) {
  if (data.rows.length === 0)
    return (
      <EmptyState
        title="No budget lines for this session"
        description="Set them under Budgets & periods."
      />
    );
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">
        Budget vs actual {data.from} → {data.to}
      </h3>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Code</TableHead>
              <TableHead>Account</TableHead>
              <TableHead className="text-right">Budget</TableHead>
              <TableHead className="text-right">Actual</TableHead>
              <TableHead className="text-right">Variance</TableHead>
              <TableHead className="text-right">Used</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((row) => (
              <TableRow key={row.accountId}>
                <TableCell className="font-mono text-xs">{row.code}</TableCell>
                <TableCell>{row.name}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatAmount(row.budget)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatAmount(row.actual)}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right tabular-nums",
                    row.favourable ? "text-emerald-600" : "text-destructive",
                  )}
                >
                  {row.variance > 0 ? "+" : ""}
                  {formatAmount(row.variance)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.usedPercent === null ? "—" : `${row.usedPercent}%`}
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="font-semibold">
              <TableCell colSpan={2}>Total</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatAmount(data.budgetTotal)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatAmount(data.actualTotal)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatAmount(data.variance)}
              </TableCell>
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
