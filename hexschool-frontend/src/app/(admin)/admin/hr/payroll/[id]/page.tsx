"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ErrorState } from "@/components/shared/error-state";
import { PageHeader } from "@/components/shared/page-header";
import { LoadingBlock } from "@/components/shared/spinner";
import { StatCard } from "@/components/shared/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";
import { apiErrorMessage } from "@/lib/api/auth";
import {
  formatAmount,
  monthOf,
  payrollApi,
  payslipApi,
  RUN_STATUSES,
  RUN_STATUS_LABELS,
  type GenerationWarning,
  type Payslip,
} from "@/lib/api/hr";
import {
  PAYSLIP_STATUS_VARIANT,
  RUN_STATUS_VARIANT,
} from "@/lib/validations/hr";
import { cn } from "@/lib/utils";

/**
 * The payroll run wizard (roadmap M21 §5): month → generate → review grid
 * with a per-person expandable breakdown → approve → disburse, plus the
 * bank advice download.
 *
 * The stepper across the top is not decoration: each step is a different
 * permission and a different person in a real school, and the page makes
 * that visible rather than presenting one "Run payroll" button that quietly
 * does all four.
 */
export default function PayrollRunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: runId } = use(params);
  const qc = useQueryClient();

  const [warnings, setWarnings] = useState<GenerationWarning[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<Payslip | null>(null);
  const [holding, setHolding] = useState<Payslip | null>(null);
  const [confirming, setConfirming] = useState<"approve" | "disburse" | null>(
    null,
  );

  const run = useQuery({
    queryKey: ["payroll-run", runId],
    queryFn: () => payrollApi.get(runId),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["payroll-run", runId] });
    void qc.invalidateQueries({ queryKey: ["payroll-runs"] });
  };

  const generate = useMutation({
    mutationFn: (force: boolean) => payrollApi.generate(runId, { force }),
    onSuccess: (result) => {
      setWarnings(result.warnings);
      toast.success(
        `${result.generated} payslip(s) generated${result.skipped > 0 ? `, ${result.skipped} skipped` : ""}.`,
      );
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const approve = useMutation({
    mutationFn: () => payrollApi.approve(runId),
    onSuccess: () => {
      toast.success("Payroll approved — the payslips are now frozen.");
      setConfirming(null);
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const disburse = useMutation({
    mutationFn: () => payrollApi.disburse(runId, {}),
    onSuccess: (result) => {
      toast.success(
        `${result.paid} payslip(s) paid${result.voucherNo ? ` · voucher ${result.voucherNo}` : ""}${result.held > 0 ? ` · ${result.held} held` : ""}.`,
      );
      setConfirming(null);
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  if (run.isPending) return <LoadingBlock />;
  if (run.isError)
    return (
      <main className="flex-1 p-8">
        <ErrorState onRetry={() => void run.refetch()} />
      </main>
    );

  const data = run.data;
  const editable = data.status === "DRAFT" || data.status === "GENERATED";
  const stepIndex = RUN_STATUSES.indexOf(
    data.status === "CANCELLED" ? "DRAFT" : data.status,
  );

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title={`Payroll — ${monthOf(data.month)}`}
        description={
          data.workingDays
            ? `${data.workingDays} working day(s) · ${data.payslips.length} payslip(s)`
            : "Not generated yet."
        }
      >
        <Button variant="outline" asChild>
          <Link href="/admin/hr">Back</Link>
        </Button>
      </PageHeader>

      {/* The lifecycle, spelled out. */}
      <div className="flex flex-wrap items-center gap-2">
        {RUN_STATUSES.map((status, index) => (
          <div key={status} className="flex items-center gap-2">
            <Badge
              variant={
                index <= stepIndex ? RUN_STATUS_VARIANT[status] : "outline"
              }
              className={cn(index > stepIndex && "opacity-50")}
            >
              {index + 1}. {RUN_STATUS_LABELS[status]}
            </Badge>
            {index < RUN_STATUSES.length - 1 ? (
              <span className="text-muted-foreground">→</span>
            ) : null}
          </div>
        ))}
        {data.status === "CANCELLED" ? (
          <Badge variant="destructive">Cancelled — {data.cancelReason}</Badge>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard title="Gross" value={formatAmount(data.grossTotal)} />
        <StatCard title="Net payable" value={formatAmount(data.netTotal)} />
        <StatCard
          title="Held"
          value={String(
            data.payslips.filter((slip) => slip.status === "HELD").length,
          )}
        />
        <StatCard
          title="Working days"
          value={String(data.workingDays ?? "—")}
        />
      </div>

      {warnings.length > 0 ? (
        <div className="space-y-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">Generation warnings</p>
          <ul className="list-inside list-disc space-y-1">
            {warnings.map((warning, index) => (
              <li key={index}>{warning.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {editable ? (
          <Can permission="payroll.generate">
            <Button
              disabled={generate.isPending}
              onClick={() => generate.mutate(false)}
            >
              {generate.isPending
                ? "Generating…"
                : data.payslips.length > 0
                  ? "Regenerate"
                  : "Generate payslips"}
            </Button>
            <Button
              variant="outline"
              disabled={generate.isPending}
              onClick={() => generate.mutate(true)}
              title="Generate despite unmarked attendance (needs payroll.generate.force)"
            >
              Generate anyway
            </Button>
          </Can>
        ) : null}

        {data.status === "GENERATED" ? (
          <Can permission="payroll.approve">
            <Button onClick={() => setConfirming("approve")}>Approve</Button>
          </Can>
        ) : null}

        {data.status === "APPROVED" ? (
          <Can permission="payroll.disburse">
            <Button onClick={() => setConfirming("disburse")}>Disburse</Button>
          </Can>
        ) : null}

        {data.payslips.length > 0 ? (
          <Can permission="payroll.export">
            <Button
              variant="outline"
              onClick={() => void payrollApi.bankAdvice(runId)}
            >
              Bank advice (XLSX)
            </Button>
          </Can>
        ) : null}
      </div>

      {data.payslips.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No payslips yet. Generating reads each employee&rsquo;s salary in
          force, the staff attendance register and their approved leave.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead className="text-right">Basic</TableHead>
              <TableHead className="text-right">Gross</TableHead>
              <TableHead className="text-right">Deductions</TableHead>
              <TableHead className="text-right">Bonus</TableHead>
              <TableHead className="text-right">Net</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.payslips.map((slip) => (
              <>
                <TableRow
                  key={slip.id}
                  className="cursor-pointer"
                  onClick={() =>
                    setExpanded(expanded === slip.id ? null : slip.id)
                  }
                >
                  <TableCell className="font-medium">
                    {slip.personName}
                    <span className="ml-2 font-mono text-xs text-muted-foreground">
                      {slip.employeeId}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatAmount(slip.basic)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatAmount(slip.gross)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatAmount(slip.totalDeductions)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatAmount(slip.bonus)}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatAmount(slip.netPayable)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={PAYSLIP_STATUS_VARIANT[slip.status]}>
                      {slip.status}
                    </Badge>
                  </TableCell>
                  <TableCell
                    className="space-x-1 text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {editable ? (
                      <Can permission="payroll.payslip.edit">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditing(slip)}
                        >
                          Adjust
                        </Button>
                      </Can>
                    ) : null}
                    <Can permission="payroll.payslip.hold">
                      {slip.status === "HELD" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            payslipApi
                              .release(slip.id)
                              .then(() => {
                                toast.success("Released.");
                                invalidate();
                              })
                              .catch((err) =>
                                toast.error(apiErrorMessage(err)),
                              )
                          }
                        >
                          Release
                        </Button>
                      ) : slip.status === "PENDING" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setHolding(slip)}
                        >
                          Hold
                        </Button>
                      ) : null}
                    </Can>
                    <Can permission="payroll.export">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void payslipApi.pdf(slip.id)}
                      >
                        PDF
                      </Button>
                    </Can>
                  </TableCell>
                </TableRow>
                {expanded === slip.id ? (
                  <TableRow key={`${slip.id}-detail`}>
                    <TableCell colSpan={8} className="bg-muted/40">
                      <BreakdownPanel slip={slip} />
                    </TableCell>
                  </TableRow>
                ) : null}
              </>
            ))}
          </TableBody>
        </Table>
      )}

      {editing ? (
        <AdjustDialog
          slip={editing}
          onClose={() => setEditing(null)}
          onSaved={invalidate}
        />
      ) : null}

      {holding ? (
        <HoldDialog
          slip={holding}
          onClose={() => setHolding(null)}
          onSaved={invalidate}
        />
      ) : null}

      <ConfirmDialog
        open={confirming === "approve"}
        title="Approve this payroll?"
        description="Approving freezes every payslip. Corrections after this go on next month's run as an adjustment line — the same rule as a published result or a posted voucher."
        confirmLabel="Approve"
        isPending={approve.isPending}
        onConfirm={() => approve.mutate()}
        onOpenChange={(open) => (open ? null : setConfirming(null))}
      />

      <ConfirmDialog
        open={confirming === "disburse"}
        title="Disburse salaries?"
        description="This marks the payslips paid, credits the provident fund and posts the salary voucher to the ledger. Held payslips are excluded. It cannot be undone — a disbursed run is corrected by next month's adjustment."
        confirmLabel="Disburse"
        isPending={disburse.isPending}
        onConfirm={() => disburse.mutate()}
        onOpenChange={(open) => (open ? null : setConfirming(null))}
      />
    </main>
  );
}

function BreakdownPanel({ slip }: { slip: Payslip }) {
  const lines = slip.breakdown?.lines ?? [];
  const earnings = lines.filter((line) => line.kind === "EARNING");
  const deductions = lines.filter((line) => line.kind === "DEDUCTION");

  return (
    <div className="grid gap-6 py-2 sm:grid-cols-3">
      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">
          Earnings
        </p>
        <ul className="space-y-1 text-sm">
          {earnings.map((line, index) => (
            <li key={index} className="flex justify-between gap-4">
              <span>
                {line.label}
                {line.note ? (
                  <span className="ml-1 text-xs text-muted-foreground">
                    ({line.note})
                  </span>
                ) : null}
              </span>
              <span className="tabular-nums">{formatAmount(line.amount)}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">
          Deductions
        </p>
        <ul className="space-y-1 text-sm">
          {deductions.length === 0 ? (
            <li className="text-muted-foreground">None</li>
          ) : (
            deductions.map((line, index) => (
              <li key={index} className="flex justify-between gap-4">
                <span>
                  {line.label}
                  {line.note ? (
                    <span className="ml-1 text-xs text-muted-foreground">
                      ({line.note})
                    </span>
                  ) : null}
                </span>
                <span className="tabular-nums">
                  {formatAmount(line.amount)}
                </span>
              </li>
            ))
          )}
        </ul>
      </div>
      <div className="space-y-1 text-sm">
        <p className="text-xs font-medium text-muted-foreground">Attendance</p>
        <p>
          {Number(slip.daysPresent)} present · {Number(slip.daysLeavePaid)} paid
          leave · {Number(slip.daysUnpaidLeave)} unpaid leave ·{" "}
          {Number(slip.daysAbsent)} absent, of {slip.workingDays} working days
        </p>
        {slip.holdReason ? (
          <p className="text-destructive">Held: {slip.holdReason}</p>
        ) : null}
        {slip.editReason ? (
          <p className="text-muted-foreground">Adjusted: {slip.editReason}</p>
        ) : null}
      </div>
    </div>
  );
}

function AdjustDialog({
  slip,
  onClose,
  onSaved,
}: {
  slip: Payslip;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [reason, setReason] = useState("");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [type, setType] = useState<"ALLOWANCE" | "DEDUCTION">("ALLOWANCE");

  const save = useMutation({
    mutationFn: () =>
      payslipApi.edit(slip.id, {
        reason,
        adHoc:
          label && amount
            ? [{ label, type, amount: Number(amount) }]
            : undefined,
      }),
    onSuccess: () => {
      toast.success("Payslip adjusted.");
      onSaved();
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust — {slip.personName}</DialogTitle>
          <DialogDescription>
            The payslip is <strong>recomputed</strong> through the same engine,
            not hand-written: that is what keeps its own lines adding up to its
            total, and the salary voucher balancing.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Reason (audited)</Label>
            <Textarea
              rows={2}
              value={reason}
              placeholder="Exam committee duty allowance for SSC 2027"
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="space-y-1 sm:col-span-2">
              <Label>One-off line (optional)</Label>
              <Input
                value={label}
                placeholder="Exam committee"
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Amount</Label>
              <Input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>
          <div className="flex gap-2">
            {(["ALLOWANCE", "DEDUCTION"] as const).map((value) => (
              <Button
                key={value}
                size="sm"
                variant={type === value ? "default" : "outline"}
                onClick={() => setType(value)}
              >
                {value === "ALLOWANCE" ? "Add to pay" : "Withhold"}
              </Button>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={reason.trim().length < 5 || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : "Apply"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HoldDialog({
  slip,
  onClose,
  onSaved,
}: {
  slip: Payslip;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [reason, setReason] = useState("");

  const save = useMutation({
    mutationFn: () => payslipApi.hold(slip.id, reason),
    onSuccess: () => {
      toast.success("Payslip held.");
      onSaved();
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Hold — {slip.personName}</DialogTitle>
          <DialogDescription>
            A held payslip stays in the run but is excluded from the
            disbursement, the bank advice and the salary voucher until it is
            released.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label>Reason (the employee will ask)</Label>
          <Textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={reason.trim().length < 5 || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : "Hold"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
