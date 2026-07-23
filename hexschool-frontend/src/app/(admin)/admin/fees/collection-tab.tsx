"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { EmptyState } from "@/components/shared/empty-state";
import { Spinner } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useDebounce } from "@/lib/hooks/use-debounce";
import { apiErrorMessage } from "@/lib/api/auth";
import {
  formatBDT,
  invoiceApi,
  ledgerApi,
  paymentApi,
  OFFLINE_METHODS,
  type CollectionResult,
  type Invoice,
} from "@/lib/api/fee";
import {
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_VARIANT,
  PAYMENT_METHOD_LABELS,
  collectPaymentSchema,
} from "@/lib/validations/fee";

const OUTSTANDING = new Set(["UNPAID", "PARTIAL", "OVERDUE"]);
const outstanding = (inv: Invoice) =>
  Number(inv.payable) - Number(inv.paidTotal);
const studentName = (inv: Invoice) =>
  `${inv.enrollment.student.firstName} ${inv.enrollment.student.lastName}`.trim();

export function CollectionTab({ sessionId }: { sessionId: string | null }) {
  const [term, setTerm] = useState("");
  const search = useDebounce(term, 300);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<CollectionResult | null>(null);

  const invoices = useQuery({
    queryKey: ["collection-invoices", sessionId, search],
    queryFn: () =>
      invoiceApi.list({
        sessionId: sessionId ?? undefined,
        search: search || undefined,
      }),
    enabled: !!sessionId && search.trim().length >= 2,
  });

  const dueInvoices = (invoices.data ?? []).filter(
    (inv) => OUTSTANDING.has(inv.status) && outstanding(inv) > 0,
  );

  const chosen = dueInvoices.filter((inv) => selected.has(inv.id));
  const selectedTotal = chosen.reduce((sum, inv) => sum + outstanding(inv), 0);
  const studentId = chosen[0]?.enrollment.student.id ?? null;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <div className="space-y-1">
          <Label className="text-xs">Find outstanding invoices</Label>
          <Input
            placeholder="Student name, UID or invoice number"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </div>

        {!sessionId ? (
          <EmptyState
            title="Pick a session"
            description="Use the header session switcher first."
          />
        ) : search.trim().length < 2 ? (
          <EmptyState
            title="Search for a student"
            description="Type at least two characters to pull up their dues."
          />
        ) : invoices.isPending ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : dueInvoices.length === 0 ? (
          <EmptyState
            title="No dues found"
            description="No outstanding invoice matches that search."
          />
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>Invoice</TableHead>
                  <TableHead>Student</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dueInvoices.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell>
                      <Checkbox
                        checked={selected.has(inv.id)}
                        onCheckedChange={() => toggle(inv.id)}
                      />
                    </TableCell>
                    <TableCell className="font-medium">
                      {inv.invoiceNo}
                    </TableCell>
                    <TableCell>
                      {studentName(inv)}
                      <span className="block text-xs text-muted-foreground">
                        {inv.enrollment.class.name} ·{" "}
                        {inv.enrollment.student.studentUid}
                      </span>
                    </TableCell>
                    <TableCell>{inv.dueDate.slice(0, 10)}</TableCell>
                    <TableCell className="text-right">
                      {formatBDT(outstanding(inv))}
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

        {studentId && sessionId ? (
          <LedgerPanel studentId={studentId} sessionId={sessionId} />
        ) : null}
      </div>

      <aside className="space-y-4">
        <CollectPanel
          invoiceIds={chosen.map((c) => c.id)}
          suggested={selectedTotal}
          onCollected={(res) => {
            setResult(res);
            setSelected(new Set());
            void invoices.refetch();
          }}
        />

        {result ? <ReceiptsPanel result={result} /> : null}
      </aside>
    </div>
  );
}

// ── collect ─────────────────────────────────────────────────────────────

function CollectPanel({
  invoiceIds,
  suggested,
  onCollected,
}: {
  invoiceIds: string[];
  suggested: number;
  onCollected: (result: CollectionResult) => void;
}) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<(typeof OFFLINE_METHODS)[number]>("CASH");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);

  const effectiveAmount = amount === "" ? suggested : Number(amount);

  const collect = useMutation({
    mutationFn: () => {
      const parsed = collectPaymentSchema.safeParse({
        amount: effectiveAmount,
        method,
        reference: reference.trim() || undefined,
      });
      if (!parsed.success) {
        return Promise.reject(
          new Error(parsed.error.issues[0]?.message ?? "Invalid input"),
        );
      }
      return paymentApi.collect({ ...parsed.data, invoiceIds });
    },
    onSuccess: (result) => {
      toast.success(`Collected ${formatBDT(result.totalCollected)}.`);
      void qc.invalidateQueries({ queryKey: ["collection-invoices"] });
      setAmount("");
      setReference("");
      onCollected(result);
    },
    onError: (err: Error) =>
      setError(err.message.length < 80 ? err.message : apiErrorMessage(err)),
  });

  return (
    <div className="space-y-3 rounded-md border p-4">
      <h3 className="font-semibold">Collection desk</h3>
      {invoiceIds.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Select one or more invoices to take a payment. One sum is allocated
          oldest-due-first.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {invoiceIds.length} invoice(s) · outstanding{" "}
            {formatBDT(suggested)}
          </p>
          <div className="space-y-1">
            <Label htmlFor="collect-amount">Amount</Label>
            <Input
              id="collect-amount"
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={String(suggested)}
            />
          </div>
          <div className="space-y-1">
            <Label>Method</Label>
            <Select
              value={method}
              onValueChange={(v) =>
                setMethod(v as (typeof OFFLINE_METHODS)[number])
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OFFLINE_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {PAYMENT_METHOD_LABELS[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="collect-ref">Reference (optional)</Label>
            <Input
              id="collect-ref"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Cheque no, slip ref…"
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Can
            permission="fee.collect"
            fallback={
              <p className="text-sm text-muted-foreground">
                You do not have permission to collect payments.
              </p>
            }
          >
            <Button
              className="w-full"
              disabled={collect.isPending || effectiveAmount <= 0}
              onClick={() => {
                setError(null);
                collect.mutate();
              }}
            >
              {collect.isPending ? <Spinner className="mr-1 size-4" /> : null}
              Take {formatBDT(effectiveAmount || 0)}
            </Button>
          </Can>
        </>
      )}
    </div>
  );
}

function ReceiptsPanel({ result }: { result: CollectionResult }) {
  return (
    <div className="space-y-2 rounded-md border p-4">
      <h3 className="font-semibold">Receipts</h3>
      {result.allocations.map((a) => (
        <div key={a.invoiceNo} className="flex justify-between text-sm">
          <span>{a.invoiceNo}</span>
          <span>{formatBDT(a.amount)}</span>
        </div>
      ))}
      <div className="space-y-1 pt-2">
        {result.payments.map((p) => (
          <div key={p.id} className="flex items-center gap-2">
            <span className="text-sm">{p.paymentNo}</span>
            <Can permission="fee.export">
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                onClick={() =>
                  void paymentApi
                    .downloadReceipt(p.id)
                    .catch((err) => toast.error(apiErrorMessage(err)))
                }
              >
                A5 receipt
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void paymentApi
                    .downloadReceipt(p.id, "thermal")
                    .catch((err) => toast.error(apiErrorMessage(err)))
                }
              >
                Thermal
              </Button>
            </Can>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── ledger ──────────────────────────────────────────────────────────────

function LedgerPanel({
  studentId,
  sessionId,
}: {
  studentId: string;
  sessionId: string;
}) {
  const [open, setOpen] = useState(false);
  const ledger = useQuery({
    queryKey: ["ledger", studentId, sessionId],
    queryFn: () => ledgerApi.ledger(studentId, sessionId),
    enabled: open,
  });

  const summary = useMemo(() => ledger.data, [ledger.data]);

  return (
    <div className="rounded-md border">
      <button
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium"
        onClick={() => setOpen((o) => !o)}
      >
        <span>Student ledger</span>
        <span className="text-muted-foreground">{open ? "Hide" : "Show"}</span>
      </button>
      {open ? (
        ledger.isPending ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : ledger.isError || !summary ? (
          <p className="px-4 pb-4 text-sm text-destructive">
            Could not load the ledger.
          </p>
        ) : (
          <div className="space-y-3 px-4 pb-4">
            <div className="flex gap-4 text-sm">
              <span>
                Billed <strong>{formatBDT(summary.totalBilled)}</strong>
              </span>
              <span>
                Paid <strong>{formatBDT(summary.totalPaid)}</strong>
              </span>
              <span className="ml-auto">
                Outstanding{" "}
                <strong>{formatBDT(summary.outstanding)}</strong>
              </span>
            </div>
            <div className="max-h-64 overflow-y-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.entries.map((e, i) => (
                    <TableRow key={`${e.reference}-${i}`}>
                      <TableCell>{e.date.slice(0, 10)}</TableCell>
                      <TableCell>{e.description}</TableCell>
                      <TableCell className="text-right">
                        {e.debit ? formatBDT(e.debit) : ""}
                      </TableCell>
                      <TableCell className="text-right">
                        {e.credit ? formatBDT(e.credit) : ""}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatBDT(e.balance)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )
      ) : null}
    </div>
  );
}
