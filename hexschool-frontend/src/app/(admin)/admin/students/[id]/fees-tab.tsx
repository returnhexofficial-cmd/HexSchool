"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock, Spinner } from "@/components/shared/spinner";
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
import { useAcademicSession } from "@/lib/hooks/use-academic-session";
import { apiErrorMessage } from "@/lib/api/auth";
import {
  feeHeadApi,
  feeOverrideApi,
  formatBDT,
  ledgerApi,
  type FeeOverride,
  type FeeOverrideType,
} from "@/lib/api/fee";
import {
  FEE_OVERRIDE_TYPE_LABELS,
  FEE_OVERRIDE_TYPES,
  feeOverrideSchema,
} from "@/lib/validations/fee";

/**
 * The student's money page (roadmap M16 §5): what they have been billed
 * and paid this session, the concessions in force, and a running ledger.
 * Concessions key on the student's enrollment for the selected session,
 * which the ledger resolves for us.
 */
export function StudentFeesTab({ studentId }: { studentId: string }) {
  const { selected: session } = useAcademicSession();

  const ledger = useQuery({
    queryKey: ["student-ledger", studentId, session?.id],
    queryFn: () => ledgerApi.ledger(studentId, session?.id),
    enabled: !!session,
  });

  if (!session) {
    return (
      <EmptyState
        title="Pick a session"
        description="Use the header session switcher to see this student's fees."
      />
    );
  }
  if (ledger.isPending) return <LoadingBlock />;
  if (ledger.isError) return <ErrorState onRetry={() => void ledger.refetch()} />;

  const enrollmentId = ledger.data.enrollments[0] ?? null;

  return (
    <div className="space-y-8">
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard label="Billed" value={formatBDT(ledger.data.totalBilled)} />
        <SummaryCard label="Paid" value={formatBDT(ledger.data.totalPaid)} />
        <SummaryCard
          label="Outstanding"
          value={formatBDT(ledger.data.outstanding)}
          emphasis={ledger.data.outstanding > 0}
        />
      </div>

      <OverridesSection enrollmentId={enrollmentId} sessionName={session.name} />

      <section className="space-y-3">
        <h3 className="text-sm font-medium">Ledger</h3>
        {ledger.data.entries.length === 0 ? (
          <EmptyState
            title="No entries yet"
            description="No invoice or payment recorded for this session."
          />
        ) : (
          <div className="rounded-md border">
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
                {ledger.data.entries.map((e, i) => (
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
        )}
      </section>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-md border p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`text-lg font-semibold ${emphasis ? "text-destructive" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

// ── overrides ───────────────────────────────────────────────────────────

function OverridesSection({
  enrollmentId,
  sessionName,
}: {
  enrollmentId: string | null;
  sessionName: string;
}) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<FeeOverride | null>(null);

  const overrides = useQuery({
    queryKey: ["fee-overrides", enrollmentId],
    queryFn: () => feeOverrideApi.list(enrollmentId!),
    enabled: !!enrollmentId,
  });

  const remove = useMutation({
    mutationFn: (id: string) => feeOverrideApi.remove(id),
    onSuccess: () => {
      toast.success("Concession removed.");
      void qc.invalidateQueries({ queryKey: ["fee-overrides", enrollmentId] });
      setDeleting(null);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Concessions</h3>
          <p className="text-xs text-muted-foreground">
            Discounts, waivers and scholarships in force for {sessionName}.
            Applied at invoice generation; every one is audited with its reason.
          </p>
        </div>
        {enrollmentId ? (
          <Can permission="fee.override.manage">
            <Button size="sm" onClick={() => setAdding(true)}>
              Add concession
            </Button>
          </Can>
        ) : null}
      </header>

      {!enrollmentId ? (
        <EmptyState
          title="Not enrolled this session"
          description="A concession attaches to a session enrollment; enrol the student first."
        />
      ) : overrides.isPending ? (
        <LoadingBlock />
      ) : overrides.isError ? (
        <ErrorState onRetry={() => void overrides.refetch()} />
      ) : overrides.data.length === 0 ? (
        <EmptyState title="No concessions" description="This student pays the full structure." />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fee head</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {overrides.data.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">
                    {o.feeHead?.name ?? "—"}
                  </TableCell>
                  <TableCell>{FEE_OVERRIDE_TYPE_LABELS[o.type]}</TableCell>
                  <TableCell className="text-right">
                    {o.type === "DISCOUNT_PERCENT"
                      ? `${Number(o.value)}%`
                      : o.type === "WAIVER"
                        ? "Full"
                        : formatBDT(o.value)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {o.reason}
                  </TableCell>
                  <TableCell className="text-right">
                    <Can permission="fee.override.manage">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDeleting(o)}
                      >
                        Remove
                      </Button>
                    </Can>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {adding && enrollmentId ? (
        <OverrideDialog
          enrollmentId={enrollmentId}
          onClose={() => setAdding(false)}
        />
      ) : null}

      {deleting ? (
        <ConfirmDialog
          open
          destructive
          title={`Remove the ${FEE_OVERRIDE_TYPE_LABELS[deleting.type].toLowerCase()}?`}
          description={`On ${deleting.feeHead?.name ?? "this head"}. Future invoices bill the full amount.`}
          confirmLabel="Remove"
          isPending={remove.isPending}
          onConfirm={() => remove.mutate(deleting.id)}
          onOpenChange={(open) => !open && setDeleting(null)}
        />
      ) : null}
    </section>
  );
}

function OverrideDialog({
  enrollmentId,
  onClose,
}: {
  enrollmentId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [feeHeadId, setFeeHeadId] = useState("");
  const [type, setType] = useState<FeeOverrideType>("DISCOUNT_PERCENT");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const heads = useQuery({ queryKey: ["fee-heads"], queryFn: feeHeadApi.list });

  const save = useMutation({
    mutationFn: () => {
      const parsed = feeOverrideSchema.safeParse({
        feeHeadId,
        type,
        value: type === "WAIVER" ? 0 : Number(value),
        reason: reason.trim(),
      });
      if (!parsed.success) {
        return Promise.reject(
          new Error(parsed.error.issues[0]?.message ?? "Invalid input"),
        );
      }
      return feeOverrideApi.create({ ...parsed.data, enrollmentId });
    },
    onSuccess: () => {
      toast.success("Concession recorded.");
      void qc.invalidateQueries({ queryKey: ["fee-overrides", enrollmentId] });
      onClose();
    },
    onError: (err: Error) =>
      setError(err.message.length < 80 ? err.message : apiErrorMessage(err)),
  });

  const isWaiver = type === "WAIVER";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a concession</DialogTitle>
        </DialogHeader>
        <div className="space-y-1">
          <Label>Fee head</Label>
          <Select value={feeHeadId} onValueChange={setFeeHeadId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Which head is discounted?" />
            </SelectTrigger>
            <SelectContent>
              {(heads.data ?? []).map((h) => (
                <SelectItem key={h.id} value={h.id}>
                  {h.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Type</Label>
          <Select
            value={type}
            onValueChange={(v) => setType(v as FeeOverrideType)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FEE_OVERRIDE_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {FEE_OVERRIDE_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {!isWaiver ? (
          <div className="space-y-1">
            <Label htmlFor="override-value">
              {type === "DISCOUNT_PERCENT" ? "Percent (0–100)" : "Amount"}
            </Label>
            <Input
              id="override-value"
              type="number"
              min={0}
              max={type === "DISCOUNT_PERCENT" ? 100 : undefined}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
        ) : null}
        <div className="space-y-1">
          <Label htmlFor="override-reason">Reason</Label>
          <Textarea
            id="override-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this concession granted?"
          />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            disabled={
              !feeHeadId ||
              reason.trim().length < 3 ||
              (!isWaiver && value === "") ||
              save.isPending
            }
            onClick={() => {
              setError(null);
              save.mutate();
            }}
          >
            {save.isPending ? <Spinner className="mr-1 size-4" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
