"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Can } from "@/components/shared/can";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
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
import { formatAmount, payrollReportApi } from "@/lib/api/hr";

type ReportKey = "register" | "pf" | "tax" | "grades";

const REPORTS: Array<[ReportKey, string]> = [
  ["register", "Payroll register"],
  ["pf", "Provident fund"],
  ["tax", "Tax deducted"],
  ["grades", "Salary grades"],
];

const thisMonth = () => new Date().toISOString().slice(0, 7);
const yearStart = () => `${new Date().getUTCFullYear()}-01`;

/**
 * The four school-wide payroll reports (the fifth, year-to-date, is
 * per-employee and lives on the employee's own page).
 *
 * The register reports whatever a run currently says; the tax and
 * provident-fund reports read **disbursed** runs only — a generated run
 * is a proposal, and a tax summary that counted proposals would report
 * deductions the revenue board never received.
 */
export function HrReportsTab() {
  const [report, setReport] = useState<ReportKey>("register");
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(thisMonth());

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-56 space-y-1">
          <Label>Report</Label>
          <Select
            value={report}
            onValueChange={(v) => setReport(v as ReportKey)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REPORTS.map(([key, label]) => (
                <SelectItem key={key} value={key}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {report === "register" || report === "tax" ? (
          <>
            <div className="w-40 space-y-1">
              <Label>From</Label>
              <Input
                type="month"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="w-40 space-y-1">
              <Label>To</Label>
              <Input
                type="month"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          </>
        ) : null}

        <Can permission="payroll.export">
          <Button
            variant="outline"
            onClick={() =>
              void payrollReportApi.download(report, "xlsx", { from, to })
            }
          >
            Export XLSX
          </Button>
          {report === "register" ? (
            <Button
              variant="outline"
              onClick={() =>
                void payrollReportApi.download("register", "pdf", { from, to })
              }
            >
              Export PDF
            </Button>
          ) : null}
        </Can>
      </div>

      {report === "register" ? (
        <RegisterReport from={from} to={to} />
      ) : report === "pf" ? (
        <PfReport />
      ) : report === "tax" ? (
        <TaxReport from={from} to={to} />
      ) : (
        <GradesReport />
      )}
    </div>
  );
}

function RegisterReport({ from, to }: { from: string; to: string }) {
  const query = useQuery({
    queryKey: ["payroll-register", from, to],
    queryFn: () => payrollReportApi.register({ from, to }),
  });

  if (query.isPending) return <LoadingBlock />;
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />;
  if (query.data.rows.length === 0) {
    return (
      <EmptyState
        title="Nothing in this window"
        description="No payroll runs cover these months."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Employee</TableHead>
            <TableHead className="text-right">Basic</TableHead>
            <TableHead className="text-right">Allowances</TableHead>
            <TableHead className="text-right">Gross</TableHead>
            <TableHead className="text-right">Attendance</TableHead>
            <TableHead className="text-right">PF</TableHead>
            <TableHead className="text-right">Tax</TableHead>
            <TableHead className="text-right">Bonus</TableHead>
            <TableHead className="text-right">Net</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {query.data.rows.map((row) => (
            <TableRow key={`${row.personId}:${row.employeeId}:${row.netPayable}`}>
              <TableCell className="font-medium">
                {row.name}
                <span className="ml-2 font-mono text-xs text-muted-foreground">
                  {row.employeeId}
                </span>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatAmount(row.basic)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatAmount(row.allowances)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatAmount(row.gross)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatAmount(row.attendanceDeduction)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatAmount(row.pfEmployee)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatAmount(row.tax)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatAmount(row.bonus)}
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {formatAmount(row.netPayable)}
              </TableCell>
            </TableRow>
          ))}
          <TableRow className="font-semibold">
            <TableCell>Total</TableCell>
            <TableCell className="text-right tabular-nums">
              {formatAmount(query.data.totals.basic)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatAmount(query.data.totals.allowances)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatAmount(query.data.totals.gross)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatAmount(query.data.totals.attendanceDeduction)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatAmount(query.data.totals.pfEmployee)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatAmount(query.data.totals.tax)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatAmount(query.data.totals.bonus)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatAmount(query.data.totals.netPayable)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

function PfReport() {
  const query = useQuery({
    queryKey: ["payroll-pf-report"],
    queryFn: payrollReportApi.pf,
  });

  if (query.isPending) return <LoadingBlock />;
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />;
  if (query.data.rows.length === 0) {
    return (
      <EmptyState
        title="No fund movements yet"
        description="Contributions are written when a payroll run is disbursed."
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Employee</TableHead>
          <TableHead className="text-right">Employee side</TableHead>
          <TableHead className="text-right">Employer side</TableHead>
          <TableHead className="text-right">Withdrawn</TableHead>
          <TableHead className="text-right">Balance</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {query.data.rows.map((row) => (
          <TableRow key={`${row.personType}:${row.personId}`}>
            <TableCell className="font-medium">{row.name}</TableCell>
            <TableCell className="text-right tabular-nums">
              {formatAmount(row.employeeTotal)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatAmount(row.employerTotal)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatAmount(row.withdrawn)}
            </TableCell>
            <TableCell className="text-right font-medium tabular-nums">
              {formatAmount(row.balance)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function TaxReport({ from, to }: { from: string; to: string }) {
  const query = useQuery({
    queryKey: ["payroll-tax-report", from, to],
    queryFn: () => payrollReportApi.tax({ from, to }),
  });

  if (query.isPending) return <LoadingBlock />;
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />;
  if (query.data.rows.length === 0) {
    return (
      <EmptyState
        title="No tax deducted"
        description="Either tax is switched off, or no disbursed payslip in this window carried a deduction."
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Employee</TableHead>
          <TableHead className="text-right">Months</TableHead>
          <TableHead className="text-right">Gross paid</TableHead>
          <TableHead className="text-right">Tax deducted</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {query.data.rows.map((row) => (
          <TableRow key={`${row.personType}:${row.personId}`}>
            <TableCell className="font-medium">{row.name}</TableCell>
            <TableCell className="text-right tabular-nums">
              {row.months}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatAmount(row.taxableGross)}
            </TableCell>
            <TableCell className="text-right font-medium tabular-nums">
              {formatAmount(row.taxDeducted)}
            </TableCell>
          </TableRow>
        ))}
        <TableRow className="font-semibold">
          <TableCell colSpan={3}>Total</TableCell>
          <TableCell className="text-right tabular-nums">
            {formatAmount(query.data.total)}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

function GradesReport() {
  const query = useQuery({
    queryKey: ["payroll-grades-report"],
    queryFn: payrollReportApi.grades,
  });

  if (query.isPending) return <LoadingBlock />;
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />;
  if (query.data.rows.length === 0) {
    return (
      <EmptyState
        title="No salary scales"
        description="Create a scale and assign it to somebody first."
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {query.data.headcount} employee(s) on a scale ·{" "}
        <strong>{formatAmount(query.data.monthlyCost)}</strong> committed per
        month at full attendance.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Structure</TableHead>
            <TableHead>Grade</TableHead>
            <TableHead className="text-right">Basic</TableHead>
            <TableHead className="text-right">Gross</TableHead>
            <TableHead className="text-right">Headcount</TableHead>
            <TableHead className="text-right">Monthly cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {query.data.rows.map((row) => (
            <TableRow key={row.structureId}>
              <TableCell className="font-medium">{row.structureName}</TableCell>
              <TableCell className="text-muted-foreground">
                {row.grade ?? "—"}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatAmount(row.basic)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatAmount(row.gross)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.headcount}
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {formatAmount(row.gross * row.headcount)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
