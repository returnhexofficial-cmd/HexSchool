"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
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
import { formatDate } from "@/lib/utils/date";
import {
  accountApi,
  budgetApi,
  fiscalPeriodApi,
  formatAmount,
  type Budget,
  type BudgetPeriod,
  type FiscalPeriod,
} from "@/lib/api/accounting";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Budgets and fiscal periods (roadmap M20 §5 "Budget editor" and §4
 * "Period close").
 *
 * The close is the one destructive-feeling action in the module, so the
 * UI says exactly what it does — locks everything dated inside — and the
 * reopen is a separate button that demands a reason, because it is a
 * separate permission for a reason.
 */
export function BudgetsTab({ sessionId }: { sessionId: string | null }) {
  return (
    <div className="space-y-10">
      <BudgetSection sessionId={sessionId} />
      <FiscalPeriodSection />
    </div>
  );
}

// ── budgets ─────────────────────────────────────────────────────────────

function BudgetSection({ sessionId }: { sessionId: string | null }) {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Budget | null>(null);

  const budgets = useQuery({
    queryKey: ["budgets", sessionId],
    queryFn: () => budgetApi.list(sessionId as string),
    enabled: sessionId !== null,
  });

  const remove = useMutation({
    mutationFn: (id: string) => budgetApi.remove(id),
    onSuccess: () => {
      toast.success("Budget line removed.");
      void qc.invalidateQueries({ queryKey: ["budgets"] });
      setDeleting(null);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Budgets</h2>
          <p className="text-sm text-muted-foreground">
            Planned income and spend per account for the session. Only income
            and expense accounts carry a budget — the variance report compares
            a plan against a flow.
          </p>
        </div>
        <Can permission="budget.manage">
          <Button disabled={!sessionId} onClick={() => setCreating(true)}>
            New budget line
          </Button>
        </Can>
      </header>

      {!sessionId ? (
        <EmptyState
          title="Pick an academic session"
          description="Use the switcher in the header — budgets are set per session."
        />
      ) : budgets.isPending ? (
        <LoadingBlock />
      ) : budgets.isError ? (
        <ErrorState onRetry={() => void budgets.refetch()} />
      ) : budgets.data.length === 0 ? (
        <EmptyState
          title="No budget lines yet"
          description="Add one to start tracking budget vs actual."
        />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Code</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Note</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {budgets.data.map((budget) => (
                <TableRow key={budget.id}>
                  <TableCell className="font-mono text-xs">
                    {budget.account.code}
                  </TableCell>
                  <TableCell>{budget.account.name}</TableCell>
                  <TableCell>
                    {budget.period === "MONTHLY" && budget.month
                      ? MONTHS[budget.month - 1]
                      : "Yearly"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatAmount(budget.amount)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {budget.note ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Can permission="budget.manage">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleting(budget)}
                      >
                        Delete
                      </Button>
                    </Can>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {creating && sessionId ? (
        <BudgetDialog sessionId={sessionId} onClose={() => setCreating(false)} />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Remove this budget line?"
        description="The variance report will stop showing this account."
        confirmLabel="Remove"
        destructive
        isPending={remove.isPending}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id);
        }}
      />
    </section>
  );
}

function BudgetDialog({
  sessionId,
  onClose,
}: {
  sessionId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [accountId, setAccountId] = useState("");
  const [period, setPeriod] = useState<BudgetPeriod>("YEARLY");
  const [month, setMonth] = useState("1");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const accounts = useQuery({
    queryKey: ["accounts", "budgetable"],
    queryFn: async () => {
      const all = await accountApi.list({ postableOnly: true });
      return all.filter(
        (account) => account.group === "INCOME" || account.group === "EXPENSE",
      );
    },
  });

  const save = useMutation({
    mutationFn: () =>
      budgetApi.create({
        sessionId,
        accountId,
        period,
        month: period === "MONTHLY" ? Number(month) : undefined,
        amount: Number(amount) || 0,
        note: note.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success("Budget line added.");
      void qc.invalidateQueries({ queryKey: ["budgets"] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New budget line</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label>Account</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger>
                <SelectValue placeholder="Pick an income or expense account" />
              </SelectTrigger>
              <SelectContent>
                {(accounts.data ?? []).map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.code} — {account.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Period</Label>
              <Select
                value={period}
                onValueChange={(value) => setPeriod(value as BudgetPeriod)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="YEARLY">Yearly</SelectItem>
                  <SelectItem value="MONTHLY">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {period === "MONTHLY" ? (
              <div className="space-y-1.5">
                <Label>Month</Label>
                <Select value={month} onValueChange={setMonth}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((name, index) => (
                      <SelectItem key={name} value={String(index + 1)}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="b-amount">Amount</Label>
            <Input
              id="b-amount"
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="b-note">Note</Label>
            <Input
              id="b-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={save.isPending || !accountId || !amount}
          >
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── fiscal periods ──────────────────────────────────────────────────────

function FiscalPeriodSection() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [closing, setClosing] = useState<FiscalPeriod | null>(null);
  const [reopening, setReopening] = useState<FiscalPeriod | null>(null);
  const [reason, setReason] = useState("");

  const periods = useQuery({
    queryKey: ["fiscal-periods"],
    queryFn: fiscalPeriodApi.list,
  });

  const close = useMutation({
    mutationFn: (id: string) => fiscalPeriodApi.close(id),
    onSuccess: () => {
      toast.success("Period closed.");
      void qc.invalidateQueries({ queryKey: ["fiscal-periods"] });
      setClosing(null);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const reopen = useMutation({
    mutationFn: (id: string) => fiscalPeriodApi.reopen(id, reason.trim()),
    onSuccess: () => {
      toast.success("Period reopened.");
      void qc.invalidateQueries({ queryKey: ["fiscal-periods"] });
      setReopening(null);
      setReason("");
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Fiscal periods</h2>
          <p className="text-sm text-muted-foreground">
            Closing a period locks every voucher dated inside it — which is
            what makes last year&apos;s trial balance a fixed number. A payment
            that arrives late still posts, into the next open period, with a
            note saying why.
          </p>
        </div>
        <Can permission="accounting.period.manage">
          <Button onClick={() => setCreating(true)}>New period</Button>
        </Can>
      </header>

      {periods.isPending ? (
        <LoadingBlock />
      ) : periods.isError ? (
        <ErrorState onRetry={() => void periods.refetch()} />
      ) : periods.data.length === 0 ? (
        <EmptyState
          title="No fiscal periods defined"
          description="Vouchers still post — periods are opt-in until you set them up."
        />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {periods.data.map((period) => (
                <TableRow key={period.id}>
                  <TableCell className="font-medium">{period.name}</TableCell>
                  <TableCell>{formatDate(period.startDate)}</TableCell>
                  <TableCell>{formatDate(period.endDate)}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        period.status === "OPEN" ? "default" : "secondary"
                      }
                    >
                      {period.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {period.status === "OPEN" ? (
                      <Can permission="accounting.period.manage">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setClosing(period)}
                        >
                          Close
                        </Button>
                      </Can>
                    ) : (
                      <Can permission="accounting.period.reopen">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setReopening(period)}
                        >
                          Reopen
                        </Button>
                      </Can>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {creating ? (
        <FiscalPeriodDialog onClose={() => setCreating(false)} />
      ) : null}

      <ConfirmDialog
        open={closing !== null}
        onOpenChange={(open) => !open && setClosing(null)}
        title={`Close ${closing?.name}?`}
        description="Every voucher dated inside it is locked. Any draft in the range must be posted or deleted first."
        confirmLabel="Close period"
        isPending={close.isPending}
        onConfirm={() => {
          if (closing) close.mutate(closing.id);
        }}
      />

      {reopening ? (
        <Dialog open onOpenChange={(open) => !open && setReopening(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reopen {reopening.name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="reopen-reason">Why is it being reopened?</Label>
              <Textarea
                id="reopen-reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Recorded on the period and in the audit log.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setReopening(null)}>
                Cancel
              </Button>
              <Button
                disabled={reopen.isPending || reason.trim().length < 3}
                onClick={() => reopen.mutate(reopening.id)}
              >
                Reopen
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </section>
  );
}

function FiscalPeriodDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const year = new Date().getUTCFullYear();
  const [name, setName] = useState(`FY ${year}`);
  const [startDate, setStartDate] = useState(`${year}-01-01`);
  const [endDate, setEndDate] = useState(`${year}-12-31`);

  const save = useMutation({
    mutationFn: () => fiscalPeriodApi.create({ name, startDate, endDate }),
    onSuccess: () => {
      toast.success("Fiscal period created.");
      void qc.invalidateQueries({ queryKey: ["fiscal-periods"] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New fiscal period</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="fp-name">Name</Label>
            <Input
              id="fp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="fp-start">From</Label>
              <Input
                id="fp-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fp-end">To</Label>
              <Input
                id="fp-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Periods may not overlap — every date belongs to exactly one.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={save.isPending || endDate < startDate}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
