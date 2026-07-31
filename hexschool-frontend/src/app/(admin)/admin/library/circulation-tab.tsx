"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { StatCard } from "@/components/shared/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  circulationApi,
  daysUntil,
  fineApi,
  formatBdt,
  formatLibraryDate,
  libraryReportApi,
  type BookIssue,
} from "@/lib/api/library";

/**
 * What is out and what is owed — the two lists a librarian looks at
 * between visitors. The desk itself lives at `/admin/library/circulation`.
 */
export function CirculationTab() {
  const [view, setView] = useState<"open" | "overdue" | "fines">("open");

  const summary = useQuery({
    queryKey: ["library-summary"],
    queryFn: () => libraryReportApi.summary(),
  });

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="On loan"
          value={String(summary.data?.onLoan ?? "—")}
          hint="Books currently in somebody's bag"
        />
        <StatCard
          title="Overdue"
          value={String(summary.data?.overdue ?? "—")}
          hint="Past their due date"
        />
        <StatCard
          title="Fines owed"
          value={
            summary.data ? formatBdt(summary.data.fines.outstanding) : "—"
          }
          hint="Assessed, not yet collected or waived"
        />
        <StatCard
          title="Collected (30 d)"
          value={summary.data ? formatBdt(summary.data.fines.collected) : "—"}
          hint="Fine income this month"
        />
      </div>

      <div className="flex flex-wrap gap-1">
        {(
          [
            ["open", "On loan"],
            ["overdue", "Overdue"],
            ["fines", "Unpaid fines"],
          ] as const
        ).map(([key, label]) => (
          <Button
            key={key}
            size="sm"
            variant={view === key ? "secondary" : "ghost"}
            onClick={() => setView(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      {view === "fines" ? <FinesList /> : <LoansList overdueOnly={view === "overdue"} />}
    </div>
  );
}

function LoansList({ overdueOnly }: { overdueOnly: boolean }) {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["library-issues", overdueOnly],
    queryFn: () =>
      circulationApi.issues({
        openOnly: !overdueOnly,
        overdueOnly: overdueOnly || undefined,
        limit: 100,
      }),
  });

  const renew = useMutation({
    mutationFn: (id: string) => circulationApi.renew(id),
    onSuccess: (issue) => {
      toast.success(`Renewed to ${formatLibraryDate(issue.dueAt)}.`);
      void qc.invalidateQueries({ queryKey: ["library-issues"] });
      void qc.invalidateQueries({ queryKey: ["library-summary"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  if (list.isLoading) return <LoadingBlock />;
  if (list.isError) return <ErrorState onRetry={() => void list.refetch()} />;
  if ((list.data?.rows.length ?? 0) === 0) {
    return (
      <EmptyState
        title={overdueOnly ? "Nothing overdue" : "Nothing on loan"}
        description={
          overdueOnly
            ? "Every book is back or still inside its loan period."
            : "The shelves are full — issue something at the desk."
        }
      />
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Accession</TableHead>
            <TableHead>Title</TableHead>
            <TableHead>Card</TableHead>
            <TableHead>Due</TableHead>
            <TableHead className="text-right">Renewals</TableHead>
            <TableHead className="w-28" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {(list.data?.rows ?? []).map((issue) => {
            const days = daysUntil(issue.dueAt);
            return (
              <TableRow key={issue.id}>
                <TableCell className="font-mono text-xs">
                  {issue.copy.accessionNo}
                </TableCell>
                <TableCell className="text-sm">
                  {issue.copy.book.title}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {issue.member.cardNo}
                </TableCell>
                <TableCell className="text-sm">
                  {formatLibraryDate(issue.dueAt)}
                  <div
                    className={
                      days < 0
                        ? "text-xs text-destructive"
                        : "text-xs text-muted-foreground"
                    }
                  >
                    {days < 0
                      ? `${Math.abs(days)} day(s) overdue`
                      : `${days} day(s) left`}
                  </div>
                </TableCell>
                <TableCell className="text-right text-sm">
                  {issue.renewCount}
                </TableCell>
                <TableCell className="text-right">
                  <Can permission="library.issue">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={renew.isPending}
                      onClick={() => renew.mutate(issue.id)}
                    >
                      Renew
                    </Button>
                  </Can>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function FinesList() {
  const [acting, setActing] = useState<{
    issue: BookIssue;
    mode: "collect" | "waive";
  } | null>(null);

  const list = useQuery({
    queryKey: ["library-fines"],
    queryFn: () => fineApi.outstanding({ limit: 100 }),
  });

  if (list.isLoading) return <LoadingBlock />;
  if (list.isError) return <ErrorState onRetry={() => void list.refetch()} />;
  if ((list.data?.rows.length ?? 0) === 0) {
    return (
      <EmptyState
        title="Nothing owed"
        description="Every fine has been collected or written off."
      />
    );
  }

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Card</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead className="text-right">Assessed</TableHead>
              <TableHead className="text-right">Owed</TableHead>
              <TableHead className="w-44" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(list.data?.rows ?? []).map((issue) => (
              <TableRow key={issue.id}>
                <TableCell className="font-mono text-xs">
                  {issue.member.cardNo}
                </TableCell>
                <TableCell className="text-sm">
                  {issue.copy.book.title}
                  <div className="text-xs text-muted-foreground">
                    {issue.copy.accessionNo}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{issue.fineReason}</Badge>
                </TableCell>
                <TableCell className="text-right text-sm">
                  {formatBdt(issue.fineAmount)}
                </TableCell>
                <TableCell className="text-right text-sm font-medium">
                  {formatBdt(issue.outstanding ?? 0)}
                </TableCell>
                <TableCell className="space-x-1 text-right">
                  <Can permission="library.fine.collect">
                    <Button
                      size="sm"
                      onClick={() => setActing({ issue, mode: "collect" })}
                    >
                      Collect
                    </Button>
                  </Can>
                  {/*
                    Deliberately a different permission from Collect: the
                    person taking the money is not the person who decides
                    it is not owed. The seeded Librarian holds one and not
                    the other, so this button is usually invisible to them.
                  */}
                  <Can permission="library.fine.waive">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setActing({ issue, mode: "waive" })}
                    >
                      Waive
                    </Button>
                  </Can>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {acting && (
        <FineDialog
          issue={acting.issue}
          mode={acting.mode}
          onClose={() => setActing(null)}
        />
      )}
    </>
  );
}

export function FineDialog({
  issue,
  mode,
  onClose,
}: {
  issue: BookIssue;
  mode: "collect" | "waive";
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const owed =
    issue.outstanding ??
    Math.max(
      0,
      Number(issue.fineAmount) -
        Number(issue.fineCollected) -
        Number(issue.fineWaived),
    );
  const [amount, setAmount] = useState(owed.toFixed(2));
  const [reason, setReason] = useState("");
  const [partial, setPartial] = useState(false);

  const act = useMutation({
    mutationFn: async (): Promise<{ outstanding: number }> => {
      const value = partial ? Number(amount) : undefined;
      return mode === "collect"
        ? fineApi.collect(issue.id, { amount: value })
        : fineApi.waive(issue.id, { amount: value, reason: reason.trim() });
    },
    onSuccess: () => {
      toast.success(mode === "collect" ? "Receipted." : "Written off.");
      void qc.invalidateQueries({ queryKey: ["library-fines"] });
      void qc.invalidateQueries({ queryKey: ["library-summary"] });
      void qc.invalidateQueries({ queryKey: ["library-members"] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const reasonMissing = mode === "waive" && reason.trim().length < 3;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === "collect" ? "Collect fine" : "Waive fine"}
          </DialogTitle>
          <DialogDescription>
            {issue.copy.book.title} — {formatBdt(owed)} outstanding on card{" "}
            {issue.member.cardNo}.
            {mode === "collect" &&
              " A receipt posts to the ledger as library income."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Checkbox
              id="partial"
              checked={partial}
              onCheckedChange={(value) => setPartial(value === true)}
            />
            <Label htmlFor="partial" className="text-sm font-normal">
              {mode === "collect" ? "Part-payment" : "Waive part of it"}
            </Label>
          </div>

          {partial && (
            <div className="space-y-1">
              <Label htmlFor="fine-amount">Amount (BDT)</Label>
              <Input
                id="fine-amount"
                type="number"
                step="0.01"
                min="0.01"
                max={owed}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                The balance stays on the loan.
              </p>
            </div>
          )}

          {mode === "waive" && (
            <div className="space-y-1">
              <Label htmlFor="waive-reason">Reason</Label>
              <Textarea
                id="waive-reason"
                rows={3}
                placeholder="Book damaged in the flood; family cannot pay"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Mandatory — the database refuses a write-off with nobody&apos;s name
                and no explanation on it.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => act.mutate()}
            disabled={act.isPending || reasonMissing}
          >
            {mode === "collect" ? "Take payment" : "Write off"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
