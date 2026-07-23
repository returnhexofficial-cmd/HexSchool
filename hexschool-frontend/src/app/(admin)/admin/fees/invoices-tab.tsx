"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock, Spinner } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiErrorMessage } from "@/lib/api/auth";
import {
  formatBDT,
  invoiceApi,
  paymentApi,
  type GenerationResult,
  type Invoice,
  type InvoiceStatus,
  type Payment,
} from "@/lib/api/fee";
import { structureApi } from "@/lib/api/structure";
import {
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_VARIANT,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_VARIANT,
  refundSchema,
} from "@/lib/validations/fee";

const STATUSES: InvoiceStatus[] = [
  "UNPAID",
  "PARTIAL",
  "PAID",
  "OVERDUE",
  "CANCELLED",
  "REFUNDED",
];

const studentName = (inv: Invoice) =>
  `${inv.enrollment.student.firstName} ${inv.enrollment.student.lastName}`.trim();

export function InvoicesTab({ sessionId }: { sessionId: string | null }) {
  const [classId, setClassId] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [month, setMonth] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [generating, setGenerating] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const classes = useQuery({
    queryKey: ["structure-classes"],
    queryFn: () =>
      structureApi.classes.list({ limit: 100, sort: "numericLevel:asc" }),
  });

  const invoices = useQuery({
    queryKey: ["invoices", sessionId, classId, status, month, search],
    queryFn: () =>
      invoiceApi.list({
        sessionId: sessionId ?? undefined,
        classId: classId || undefined,
        status: (status || undefined) as InvoiceStatus | undefined,
        billingMonth: month || undefined,
        search: search || undefined,
      }),
    enabled: !!sessionId,
  });

  if (!sessionId) {
    return (
      <EmptyState
        title="Pick a session"
        description="Use the session switcher in the header to view its invoices."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Class</Label>
          <Select value={classId || "all"} onValueChange={(v) => setClassId(v === "all" ? "" : v)}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="All classes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All classes</SelectItem>
              {(classes.data?.data ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Status</Label>
          <Select value={status || "all"} onValueChange={(v) => setStatus(v === "all" ? "" : v)}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Any status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any status</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {INVOICE_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Month</Label>
          <Input
            type="month"
            className="w-40"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </div>
        <div className="flex-1 space-y-1">
          <Label className="text-xs">Search</Label>
          <Input
            placeholder="Invoice no, student name or UID"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Can permission="fee.invoice.generate">
          <Button onClick={() => setGenerating(true)}>Generate invoices</Button>
        </Can>
      </div>

      {invoices.isPending ? (
        <LoadingBlock />
      ) : invoices.isError ? (
        <ErrorState onRetry={() => void invoices.refetch()} />
      ) : invoices.data.length === 0 ? (
        <EmptyState
          title="No invoices match"
          description="Generate a month's batch, or widen the filters."
        />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Student</TableHead>
                <TableHead>Class</TableHead>
                <TableHead>Month</TableHead>
                <TableHead className="text-right">Payable</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.data.map((inv) => (
                <TableRow
                  key={inv.id}
                  className="cursor-pointer"
                  onClick={() => setDetailId(inv.id)}
                >
                  <TableCell className="font-medium">{inv.invoiceNo}</TableCell>
                  <TableCell>
                    {studentName(inv)}
                    <span className="block text-xs text-muted-foreground">
                      {inv.enrollment.student.studentUid}
                    </span>
                  </TableCell>
                  <TableCell>{inv.enrollment.class.name}</TableCell>
                  <TableCell>{inv.billingMonth?.slice(0, 7) ?? "Ad-hoc"}</TableCell>
                  <TableCell className="text-right">
                    {formatBDT(inv.payable)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatBDT(inv.paidTotal)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={INVOICE_STATUS_VARIANT[inv.status]}>
                      {INVOICE_STATUS_LABELS[inv.status]}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {generating ? (
        <GenerateDialog
          sessionId={sessionId}
          classes={(classes.data?.data ?? []).map((c) => ({
            id: c.id,
            name: c.name,
          }))}
          onClose={() => setGenerating(false)}
        />
      ) : null}

      {detailId ? (
        <InvoiceDetailDialog
          invoiceId={detailId}
          onClose={() => setDetailId(null)}
        />
      ) : null}
    </div>
  );
}

// ── generate (with dry-run preview) ─────────────────────────────────────

function GenerateDialog({
  sessionId,
  classes,
  onClose,
}: {
  sessionId: string;
  classes: Array<{ id: string; name: string }>;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [billingMonth, setBillingMonth] = useState(defaultMonth);
  const [classId, setClassId] = useState<string>("");
  const [preview, setPreview] = useState<GenerationResult | null>(null);

  const run = useMutation({
    mutationFn: (dryRun: boolean) =>
      invoiceApi.generate({
        sessionId,
        billingMonth,
        classId: classId || undefined,
        dryRun,
      }),
    onSuccess: (result) => {
      if (result.dryRun) {
        setPreview(result);
      } else {
        toast.success(`Generated ${result.generated} invoice(s).`);
        void qc.invalidateQueries({ queryKey: ["invoices"] });
        onClose();
      }
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Generate monthly invoices</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap gap-3">
          <div className="space-y-1">
            <Label htmlFor="gen-month">Billing month</Label>
            <Input
              id="gen-month"
              type="month"
              className="w-44"
              value={billingMonth}
              onChange={(e) => {
                setBillingMonth(e.target.value);
                setPreview(null);
              }}
            />
          </div>
          <div className="space-y-1">
            <Label>Class (optional)</Label>
            <Select
              value={classId || "all"}
              onValueChange={(v) => {
                setClassId(v === "all" ? "" : v);
                setPreview(null);
              }}
            >
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All classes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All classes</SelectItem>
                {classes.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          Every recurring head is billed, prorated for mid-month joiners.
          Re-running never bills a candidate twice.
        </p>

        {preview ? (
          <div className="space-y-2">
            <div className="flex items-center gap-4 text-sm">
              <span>
                Would bill <strong>{preview.generated}</strong>
              </span>
              <span className="text-muted-foreground">
                Skipping {preview.skipped}
              </span>
              <span className="ml-auto font-medium">
                {formatBDT(preview.totalPayable)}
              </span>
            </div>
            <div className="max-h-64 overflow-y-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Roll</TableHead>
                    <TableHead>Student</TableHead>
                    <TableHead className="text-right">Payable</TableHead>
                    <TableHead>Note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.map((r) => (
                    <TableRow key={r.enrollmentId}>
                      <TableCell>{r.rollNo}</TableCell>
                      <TableCell>{r.studentName}</TableCell>
                      <TableCell className="text-right">
                        {formatBDT(r.payable)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.skipped ?? (r.prorated ? "Prorated" : "")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={run.isPending}>
            Cancel
          </Button>
          <Button
            variant="outline"
            disabled={run.isPending}
            onClick={() => run.mutate(true)}
          >
            {run.isPending ? <Spinner className="mr-1 size-4" /> : null}
            Preview
          </Button>
          <Button
            disabled={run.isPending || !preview || preview.generated === 0}
            onClick={() => run.mutate(false)}
          >
            Generate {preview ? preview.generated : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── detail ──────────────────────────────────────────────────────────────

function InvoiceDetailDialog({
  invoiceId,
  onClose,
}: {
  invoiceId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");

  const detail = useQuery({
    queryKey: ["invoice", invoiceId],
    queryFn: () => invoiceApi.get(invoiceId),
  });

  const cancel = useMutation({
    mutationFn: () => invoiceApi.cancel(invoiceId, reason.trim()),
    onSuccess: () => {
      toast.success("Invoice cancelled.");
      void qc.invalidateQueries({ queryKey: ["invoices"] });
      void qc.invalidateQueries({ queryKey: ["invoice", invoiceId] });
      setCancelling(false);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {detail.data ? detail.data.invoiceNo : "Invoice"}
          </DialogTitle>
        </DialogHeader>

        {detail.isPending ? (
          <LoadingBlock />
        ) : detail.isError || !detail.data ? (
          <ErrorState onRetry={() => void detail.refetch()} />
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-sm">
              <div>
                <div className="font-medium">{studentName(detail.data)}</div>
                <div className="text-muted-foreground">
                  {detail.data.enrollment.class.name}
                  {detail.data.enrollment.section
                    ? ` · ${detail.data.enrollment.section.name}`
                    : ""}{" "}
                  · Roll {detail.data.enrollment.rollNo}
                </div>
              </div>
              <Badge variant={INVOICE_STATUS_VARIANT[detail.data.status]}>
                {INVOICE_STATUS_LABELS[detail.data.status]}
              </Badge>
            </div>

            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Line</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Discount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(detail.data.items ?? []).map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.description}</TableCell>
                      <TableCell className="text-right">
                        {formatBDT(item.amount)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatBDT(item.discount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <dl className="space-y-1 text-sm">
              <Row label="Subtotal" value={formatBDT(detail.data.subtotal)} />
              <Row label="Discount" value={formatBDT(detail.data.discountTotal)} />
              <Row label="Late fine" value={formatBDT(detail.data.fineTotal)} />
              <Row label="Payable" value={formatBDT(detail.data.payable)} strong />
              <Row label="Paid" value={formatBDT(detail.data.paidTotal)} />
              <Row
                label="Due date"
                value={detail.data.dueDate.slice(0, 10)}
              />
            </dl>

            {(detail.data.payments ?? []).length > 0 ? (
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Payments</h3>
                {(detail.data.payments ?? []).map((p) => (
                  <PaymentRow key={p.id} payment={p} invoiceId={invoiceId} />
                ))}
              </div>
            ) : null}

            <div className="flex flex-wrap justify-end gap-2">
              <Can permission="fee.export">
                <Button
                  variant="outline"
                  onClick={() =>
                    void invoiceApi
                      .downloadPdf(invoiceId)
                      .catch((err) => toast.error(apiErrorMessage(err)))
                  }
                >
                  Download PDF
                </Button>
              </Can>
              {detail.data.status !== "CANCELLED" &&
              Number(detail.data.paidTotal) === 0 ? (
                <Can permission="fee.invoice.cancel">
                  <Button
                    variant="outline"
                    onClick={() => setCancelling(true)}
                  >
                    Cancel invoice
                  </Button>
                </Can>
              ) : null}
            </div>
          </div>
        )}
      </DialogContent>

      {cancelling ? (
        <Dialog open onOpenChange={(open) => !open && setCancelling(false)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Cancel this invoice?</DialogTitle>
            </DialogHeader>
            <div className="space-y-1">
              <Label htmlFor="cancel-reason">Reason</Label>
              <Textarea
                id="cancel-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is this invoice being cancelled?"
              />
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setCancelling(false)}
                disabled={cancel.isPending}
              >
                Keep it
              </Button>
              <Button
                variant="destructive"
                disabled={reason.trim().length < 3 || cancel.isPending}
                onClick={() => cancel.mutate()}
              >
                {cancel.isPending ? <Spinner className="mr-1 size-4" /> : null}
                Cancel invoice
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </Dialog>
  );
}

function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={strong ? "font-semibold" : ""}>{value}</dd>
    </div>
  );
}

function PaymentRow({
  payment,
  invoiceId,
}: {
  payment: Payment;
  invoiceId: string;
}) {
  const [refunding, setRefunding] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm">
      <span className="font-medium">{payment.paymentNo}</span>
      <Badge variant={PAYMENT_STATUS_VARIANT[payment.status]}>
        {payment.status}
      </Badge>
      <span className="text-muted-foreground">
        {PAYMENT_METHOD_LABELS[payment.method]}
      </span>
      <span className="ml-auto font-medium">{formatBDT(payment.amount)}</span>
      {payment.status === "SUCCESS" ? (
        <>
          <Can permission="fee.export">
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void paymentApi
                  .downloadReceipt(payment.id)
                  .catch((err) => toast.error(apiErrorMessage(err)))
              }
            >
              Receipt
            </Button>
          </Can>
          <Can permission="fee.refund">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setRefunding(true)}
            >
              Refund
            </Button>
          </Can>
        </>
      ) : null}

      {refunding ? (
        <RefundDialog
          payment={payment}
          invoiceId={invoiceId}
          onClose={() => setRefunding(false)}
        />
      ) : null}
    </div>
  );
}

function RefundDialog({
  payment,
  invoiceId,
  onClose,
}: {
  payment: Payment;
  invoiceId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState(String(Number(payment.amount)));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refund = useMutation({
    mutationFn: () => {
      const parsed = refundSchema.safeParse({
        amount: Number(amount),
        reason: reason.trim(),
      });
      if (!parsed.success) {
        return Promise.reject(
          new Error(parsed.error.issues[0]?.message ?? "Invalid input"),
        );
      }
      return paymentApi.refund(payment.id, parsed.data);
    },
    onSuccess: () => {
      toast.success("Refund recorded.");
      void qc.invalidateQueries({ queryKey: ["invoice", invoiceId] });
      void qc.invalidateQueries({ queryKey: ["invoices"] });
      onClose();
    },
    onError: (err: Error) =>
      setError(err.message.length < 80 ? err.message : apiErrorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Refund {payment.paymentNo}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          A non-refundable head refuses this, and you cannot refund more than
          was paid.
        </p>
        <div className="space-y-1">
          <Label htmlFor="refund-amount">Amount</Label>
          <Input
            id="refund-amount"
            type="number"
            min={0}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="refund-reason">Reason</Label>
          <Textarea
            id="refund-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this being refunded?"
          />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={refund.isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={refund.isPending || reason.trim().length < 3}
            onClick={() => {
              setError(null);
              refund.mutate();
            }}
          >
            {refund.isPending ? <Spinner className="mr-1 size-4" /> : null}
            Refund
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
