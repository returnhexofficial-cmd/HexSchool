"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { apiErrorMessage } from "@/lib/api/auth";
import { feeReportApi, formatBDT } from "@/lib/api/fee";
import { PAYMENT_METHOD_LABELS } from "@/lib/validations/fee";

const REPORTS = [
  ["dues", "Dues & aging"],
  ["daily", "Daily collection"],
  ["head-wise", "Head-wise income"],
] as const;

type ReportKey = (typeof REPORTS)[number][0];

const today = () => new Date().toISOString().slice(0, 10);

export function FeeReportsTab({ sessionId }: { sessionId: string | null }) {
  const [report, setReport] = useState<ReportKey>("dues");

  if (!sessionId) {
    return (
      <EmptyState
        title="Pick a session"
        description="Use the header session switcher to report on its fees."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1">
        {REPORTS.map(([key, label]) => (
          <Button
            key={key}
            variant={report === key ? "secondary" : "ghost"}
            size="sm"
            className={cn(report === key && "font-semibold")}
            onClick={() => setReport(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      {report === "dues" ? (
        <DuesReport sessionId={sessionId} />
      ) : report === "daily" ? (
        <DailyReport />
      ) : (
        <HeadWiseReport sessionId={sessionId} />
      )}
    </div>
  );
}

function download(promise: Promise<void>) {
  promise.catch((err) => toast.error(apiErrorMessage(err)));
}

// ── dues ────────────────────────────────────────────────────────────────

function DuesReport({ sessionId }: { sessionId: string }) {
  const dues = useQuery({
    queryKey: ["fee-report-dues", sessionId],
    queryFn: () => feeReportApi.dues({ sessionId }),
  });

  if (dues.isPending) return <LoadingBlock />;
  if (dues.isError) return <ErrorState onRetry={() => void dues.refetch()} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Total outstanding{" "}
          <strong className="text-foreground">
            {formatBDT(dues.data.totalOutstanding)}
          </strong>
        </p>
        <Can permission="fee.export">
          <Button
            variant="outline"
            onClick={() => download(feeReportApi.downloadDues(sessionId))}
          >
            Export XLSX
          </Button>
        </Can>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {dues.data.buckets.map((b) => (
          <div key={b.bucket} className="rounded-md border p-4">
            <div className="text-xs text-muted-foreground">{b.bucket} days</div>
            <div className="text-lg font-semibold">{formatBDT(b.amount)}</div>
            <div className="text-xs text-muted-foreground">
              {b.invoices} invoice(s)
            </div>
          </div>
        ))}
      </div>

      <h3 className="text-sm font-medium">Defaulters — largest first</h3>
      {dues.data.defaulters.length === 0 ? (
        <EmptyState title="Nobody owes anything" />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                <TableHead>Class</TableHead>
                <TableHead>Roll</TableHead>
                <TableHead>Oldest due</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dues.data.defaulters.map((d) => (
                <TableRow key={d.enrollmentId}>
                  <TableCell>
                    {d.studentName}
                    <span className="block text-xs text-muted-foreground">
                      {d.studentUid}
                    </span>
                  </TableCell>
                  <TableCell>
                    {d.className}
                    {d.sectionName ? ` · ${d.sectionName}` : ""}
                  </TableCell>
                  <TableCell>{d.rollNo}</TableCell>
                  <TableCell>{d.oldestDueDate?.slice(0, 10) ?? "—"}</TableCell>
                  <TableCell className="text-right font-medium">
                    {formatBDT(d.outstanding)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ── daily collection ────────────────────────────────────────────────────

function DailyReport() {
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());

  const daily = useQuery({
    queryKey: ["fee-report-daily", from, to],
    queryFn: () => feeReportApi.daily({ from, to }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">From</Label>
          <Input
            type="date"
            className="w-40"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">To</Label>
          <Input
            type="date"
            className="w-40"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <Can permission="fee.export">
          <Button
            variant="outline"
            onClick={() => download(feeReportApi.downloadDaily(from, to))}
          >
            Export XLSX
          </Button>
        </Can>
      </div>

      {daily.isPending ? (
        <LoadingBlock />
      ) : daily.isError ? (
        <ErrorState onRetry={() => void daily.refetch()} />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Collected{" "}
            <strong className="text-foreground">
              {formatBDT(daily.data.total)}
            </strong>{" "}
            over {from} → {to}
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-md border">
              <div className="border-b px-4 py-2 text-sm font-medium">
                By method
              </div>
              <Table>
                <TableBody>
                  {daily.data.byMethod.map((m) => (
                    <TableRow key={m.method}>
                      <TableCell>{PAYMENT_METHOD_LABELS[m.method]}</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {m.count}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatBDT(m.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {daily.data.byMethod.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={3}
                        className="text-center text-muted-foreground"
                      >
                        Nothing collected in this range.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
            <div className="rounded-md border">
              <div className="border-b px-4 py-2 text-sm font-medium">
                By day
              </div>
              <Table>
                <TableBody>
                  {daily.data.byDay.map((d) => (
                    <TableRow key={d.date}>
                      <TableCell>{d.date.slice(0, 10)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {d.count}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatBDT(d.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── head-wise ───────────────────────────────────────────────────────────

function HeadWiseReport({ sessionId }: { sessionId: string }) {
  const head = useQuery({
    queryKey: ["fee-report-head-wise", sessionId],
    queryFn: () => feeReportApi.headWise({ sessionId }),
  });

  if (head.isPending) return <LoadingBlock />;
  if (head.isError) return <ErrorState onRetry={() => void head.refetch()} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Net income{" "}
          <strong className="text-foreground">
            {formatBDT(head.data.totalNet)}
          </strong>{" "}
          (billed {formatBDT(head.data.totalBilled)}, discounted{" "}
          {formatBDT(head.data.totalDiscounted)})
        </p>
        <Can permission="fee.export">
          <Button
            variant="outline"
            onClick={() => download(feeReportApi.downloadHeadWise(sessionId))}
          >
            Export XLSX
          </Button>
        </Can>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fee head</TableHead>
              <TableHead className="text-right">Billed</TableHead>
              <TableHead className="text-right">Discounted</TableHead>
              <TableHead className="text-right">Net</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {head.data.rows.map((r) => (
              <TableRow key={r.feeHeadId ?? r.feeHeadName}>
                <TableCell className="font-medium">{r.feeHeadName}</TableCell>
                <TableCell className="text-right">
                  {formatBDT(r.billed)}
                </TableCell>
                <TableCell className="text-right">
                  {formatBDT(r.discounted)}
                </TableCell>
                <TableCell className="text-right font-medium">
                  {formatBDT(r.net)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
