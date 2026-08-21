"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
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
import { apiErrorMessage } from "@/lib/api/auth";
import { formatDate } from "@/lib/utils/date";
import {
  bonusApi,
  formatAmount,
  monthOf,
  payrollApi,
  RUN_STATUS_LABELS,
  type BonusRun,
} from "@/lib/api/hr";
import {
  BONUS_BASES,
  BONUS_BASIS_LABELS,
  BONUS_TYPES,
  LEAVE_APPLICABLE_TO,
  RUN_STATUS_VARIANT,
} from "@/lib/validations/hr";

/**
 * The payroll month list and the bonus rounds attached to it.
 *
 * Bonuses live here rather than on their own page because a festival
 * bonus is not a separate payment in a BD school — it rides along with a
 * chosen month's salary, and seeing the two lists side by side is what
 * makes "which month is Eid paid with?" answerable at a glance.
 */
export function PayrollTab() {
  const [creating, setCreating] = useState(false);

  const runs = useQuery({
    queryKey: ["payroll-runs"],
    queryFn: () => payrollApi.list({}),
  });

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Payroll runs</h2>
          <Can permission="payroll.generate">
            <Button onClick={() => setCreating(true)}>Open a month</Button>
          </Can>
        </div>

        {runs.isPending ? (
          <LoadingBlock />
        ) : runs.isError ? (
          <ErrorState onRetry={() => void runs.refetch()} />
        ) : runs.data.rows.length === 0 ? (
          <EmptyState
            title="No payroll runs yet"
            description="Open a month, generate its payslips, approve them, then disburse."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Working days</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead>Disbursed</TableHead>
                <TableHead className="text-right"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.data.rows.map((run) => (
                <TableRow key={run.id}>
                  <TableCell className="font-medium">
                    {monthOf(run.month)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={RUN_STATUS_VARIANT[run.status]}>
                      {RUN_STATUS_LABELS[run.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {run.workingDays ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatAmount(run.grossTotal)}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatAmount(run.netTotal)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(run.disbursedAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/admin/hr/payroll/${run.id}`}>Open</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <BonusSection />

      {creating ? <NewRunDialog onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

function NewRunDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [note, setNote] = useState("");

  const create = useMutation({
    mutationFn: () => payrollApi.create({ month, note: note || undefined }),
    onSuccess: () => {
      toast.success(`Payroll opened for ${month}.`);
      void qc.invalidateQueries({ queryKey: ["payroll-runs"] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Open a payroll month</DialogTitle>
          <DialogDescription>
            One live run per month. Generating computes every payslip from
            the salary in force, the attendance register and approved leave.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Month</Label>
            <Input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Note (optional)</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? "Opening…" : "Open"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BonusSection() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);

  const bonuses = useQuery({ queryKey: ["bonus-runs"], queryFn: bonusApi.list });

  const remove = useMutation({
    mutationFn: (id: string) => bonusApi.remove(id),
    onSuccess: () => {
      toast.success("Bonus round removed.");
      void qc.invalidateQueries({ queryKey: ["bonus-runs"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Bonus rounds</h2>
        <Can permission="bonus.manage">
          <Button variant="outline" onClick={() => setCreating(true)}>
            New bonus
          </Button>
        </Can>
      </div>

      {bonuses.isPending ? (
        <LoadingBlock />
      ) : bonuses.isError ? (
        <ErrorState onRetry={() => void bonuses.refetch()} />
      ) : bonuses.data.length === 0 ? (
        <EmptyState
          title="No bonus rounds"
          description="A festival bonus is attached to the month it is paid with, and resolved per employee at generation."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Basis</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead>Paid with</TableHead>
              <TableHead className="text-right">Min service</TableHead>
              <TableHead>Prorate</TableHead>
              <TableHead className="text-right"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bonuses.data.map((bonus) => (
              <TableRow key={bonus.id}>
                <TableCell className="font-medium">{bonus.name}</TableCell>
                <TableCell>{bonus.type}</TableCell>
                <TableCell>{BONUS_BASIS_LABELS[bonus.basis]}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {bonus.basis === "PERCENT_OF_BASIC"
                    ? `${Number(bonus.value)}%`
                    : formatAmount(bonus.value)}
                </TableCell>
                <TableCell>
                  {bonus.monthPaidWith ? monthOf(bonus.monthPaidWith) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {bonus.minServiceMonths} mo
                </TableCell>
                <TableCell>{bonus.prorate ? "Yes" : "No"}</TableCell>
                <TableCell className="text-right">
                  <Can permission="bonus.manage">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => remove.mutate(bonus.id)}
                    >
                      Delete
                    </Button>
                  </Can>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {creating ? <BonusDialog onClose={() => setCreating(false)} /> : null}
    </section>
  );
}

function BonusDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Partial<BonusRun> & { value: string }>({
    name: "",
    type: "FESTIVAL",
    basis: "PERCENT_OF_BASIC",
    value: "100",
    monthPaidWith: "",
    minServiceMonths: 6,
    prorate: false,
    applicableTo: "ALL",
  });

  const create = useMutation({
    mutationFn: () =>
      bonusApi.create({
        ...draft,
        value: draft.value as unknown as string,
        monthPaidWith: draft.monthPaidWith || undefined,
      } as Partial<BonusRun>),
    onSuccess: () => {
      toast.success("Bonus round created.");
      void qc.invalidateQueries({ queryKey: ["bonus-runs"] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New bonus round</DialogTitle>
          <DialogDescription>
            Eligibility is resolved per employee when the month is
            generated — somebody hired in March still gets the right Eid
            bonus without anyone re-entering it.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label>Name</Label>
            <Input
              value={draft.name ?? ""}
              placeholder="Eid-ul-Fitr Bonus 2027"
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label>Type</Label>
            <Select
              value={draft.type}
              onValueChange={(v) =>
                setDraft({ ...draft, type: v as BonusRun["type"] })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BONUS_TYPES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Basis</Label>
            <Select
              value={draft.basis}
              onValueChange={(v) =>
                setDraft({ ...draft, basis: v as BonusRun["basis"] })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BONUS_BASES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {BONUS_BASIS_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Value</Label>
            <Input
              inputMode="decimal"
              value={draft.value}
              onChange={(e) => setDraft({ ...draft, value: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label>Paid with month</Label>
            <Input
              type="month"
              value={draft.monthPaidWith ?? ""}
              onChange={(e) =>
                setDraft({ ...draft, monthPaidWith: e.target.value })
              }
            />
          </div>
          <div className="space-y-1">
            <Label>Minimum service (months)</Label>
            <Input
              inputMode="numeric"
              value={String(draft.minServiceMonths ?? 0)}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  minServiceMonths: Number(e.target.value) || 0,
                })
              }
            />
          </div>
          <div className="space-y-1">
            <Label>Offered to</Label>
            <Select
              value={draft.applicableTo}
              onValueChange={(v) =>
                setDraft({
                  ...draft,
                  applicableTo: v as BonusRun["applicableTo"],
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEAVE_APPLICABLE_TO.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!draft.name || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? "Saving…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
