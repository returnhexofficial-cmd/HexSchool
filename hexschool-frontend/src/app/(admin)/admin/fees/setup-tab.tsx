"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock, Spinner } from "@/components/shared/spinner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { apiErrorMessage } from "@/lib/api/auth";
import {
  feeHeadApi,
  feeStructureApi,
  type FeeHead,
} from "@/lib/api/fee";
import { structureApi } from "@/lib/api/structure";
import {
  FEE_HEAD_TYPE_LABELS,
  FEE_HEAD_TYPES,
  feeHeadSchema,
} from "@/lib/validations/fee";

export function FeeSetupTab({ sessionId }: { sessionId: string | null }) {
  return (
    <div className="space-y-10">
      <FeeHeadsSection />
      <FeeStructureSection sessionId={sessionId} />
    </div>
  );
}

// ── fee heads ───────────────────────────────────────────────────────────

function FeeHeadsSection() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<FeeHead | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<FeeHead | null>(null);

  const heads = useQuery({ queryKey: ["fee-heads"], queryFn: feeHeadApi.list });

  const remove = useMutation({
    mutationFn: (id: string) => feeHeadApi.remove(id),
    onSuccess: () => {
      toast.success("Fee head deleted.");
      void qc.invalidateQueries({ queryKey: ["fee-heads"] });
      setDeleting(null);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Fee heads</h2>
          <p className="text-sm text-muted-foreground">
            The chargeable items — tuition, admission, exam. Monthly heads are
            billed by the invoice generator; a non-refundable head refuses
            refunds outright.
          </p>
        </div>
        <Can permission="fee.setup">
          <Button onClick={() => setCreating(true)}>New fee head</Button>
        </Can>
      </header>

      {heads.isPending ? (
        <LoadingBlock />
      ) : heads.isError ? (
        <ErrorState onRetry={() => void heads.refetch()} />
      ) : heads.data.length === 0 ? (
        <EmptyState
          title="No fee heads yet"
          description="Add one — every invoice line hangs off a head."
        />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Refundable</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {heads.data.map((head) => (
                <TableRow key={head.id}>
                  <TableCell className="font-medium">{head.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {head.code ?? "—"}
                  </TableCell>
                  <TableCell>{FEE_HEAD_TYPE_LABELS[head.type]}</TableCell>
                  <TableCell>{head.isRefundable ? "Yes" : "No"}</TableCell>
                  <TableCell className="text-right">
                    <Can permission="fee.setup">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditing(head)}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDeleting(head)}
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

      {creating || editing ? (
        <FeeHeadDialog
          head={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      ) : null}

      {deleting ? (
        <ConfirmDialog
          open
          destructive
          title={`Delete "${deleting.name}"?`}
          description="A head that has ever been billed cannot be deleted."
          confirmLabel="Delete"
          isPending={remove.isPending}
          onConfirm={() => remove.mutate(deleting.id)}
          onOpenChange={(open) => !open && setDeleting(null)}
        />
      ) : null}
    </section>
  );
}

function FeeHeadDialog({
  head,
  onClose,
}: {
  head: FeeHead | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(head?.name ?? "");
  const [code, setCode] = useState(head?.code ?? "");
  const [type, setType] = useState(head?.type ?? "RECURRING_MONTHLY");
  const [isRefundable, setIsRefundable] = useState(head?.isRefundable ?? true);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const parsed = feeHeadSchema.safeParse({
        name: name.trim(),
        code: code.trim() || undefined,
        type,
        isRefundable,
      });
      if (!parsed.success) {
        return Promise.reject(
          new Error(parsed.error.issues[0]?.message ?? "Invalid input"),
        );
      }
      return head
        ? feeHeadApi.update(head.id, parsed.data)
        : feeHeadApi.create(parsed.data);
    },
    onSuccess: () => {
      toast.success(head ? "Fee head updated." : "Fee head created.");
      void qc.invalidateQueries({ queryKey: ["fee-heads"] });
      onClose();
    },
    onError: (err: Error) =>
      setError(
        err.message.length < 80 && !head ? err.message : apiErrorMessage(err),
      ),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{head ? "Edit fee head" : "New fee head"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="head-name">Name</Label>
          <Input
            id="head-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tuition fee"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="head-code">Code (optional)</Label>
          <Input
            id="head-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="TUI"
          />
        </div>
        <div className="space-y-1">
          <Label>Type</Label>
          <Select value={type} onValueChange={(v) => setType(v as FeeHead["type"])}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FEE_HEAD_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {FEE_HEAD_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={isRefundable}
            onCheckedChange={(v) => setIsRefundable(v === true)}
          />
          Refundable
        </label>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim() || save.isPending}
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

// ── fee structure matrix ────────────────────────────────────────────────

function FeeStructureSection({ sessionId }: { sessionId: string | null }) {
  const qc = useQueryClient();

  const classes = useQuery({
    queryKey: ["structure-classes"],
    queryFn: () => structureApi.classes.list({ limit: 100, sort: "numericLevel:asc" }),
  });
  const heads = useQuery({ queryKey: ["fee-heads"], queryFn: feeHeadApi.list });
  const structures = useQuery({
    queryKey: ["fee-structures", sessionId],
    queryFn: () => feeStructureApi.list({ sessionId: sessionId ?? undefined }),
    enabled: !!sessionId,
  });

  // The saved matrix, flattened to `classId:headId → amount`.
  const saved = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of structures.data ?? []) {
      map[`${s.classId}:${s.feeHeadId}`] = String(Number(s.amount));
    }
    return map;
  }, [structures.data]);

  // Seed the editable grid from the saved matrix as it (re)loads, using
  // React's render-time reset rather than an effect (no cascading render).
  const [draft, setDraft] = useState<Record<string, string>>(saved);
  const savedKey = JSON.stringify(saved);
  const [seededFrom, setSeededFrom] = useState(savedKey);
  if (seededFrom !== savedKey) {
    setDraft(saved);
    setSeededFrom(savedKey);
  }

  const save = useMutation({
    mutationFn: () => {
      const rows = Object.entries(draft)
        .map(([key, value]) => {
          const [classId, feeHeadId] = key.split(":");
          return { classId, feeHeadId, amount: Number(value) };
        })
        .filter((r) => Number.isFinite(r.amount) && r.amount > 0);
      return feeStructureApi.save({
        sessionId: sessionId ?? undefined,
        structures: rows,
      });
    },
    onSuccess: () => {
      toast.success("Fee structure saved.");
      void qc.invalidateQueries({ queryKey: ["fee-structures", sessionId] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  if (!sessionId) {
    return (
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Fee structure</h2>
        <EmptyState
          title="Pick a session"
          description="Use the session switcher in the header to price a session's fees."
        />
      </section>
    );
  }

  const monthlyHeads = (heads.data ?? []).filter(
    (h) => h.type === "RECURRING_MONTHLY" || h.type === "ONE_TIME",
  );
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Fee structure</h2>
          <p className="text-sm text-muted-foreground">
            What each class pays per head this session. Blank cells are not
            billed. The generator prorates a mid-month joiner from these.
          </p>
        </div>
        <Can permission="fee.setup">
          <Button
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? <Spinner className="mr-1 size-4" /> : null}
            Save structure
          </Button>
        </Can>
      </header>

      {classes.isPending || heads.isPending || structures.isPending ? (
        <LoadingBlock />
      ) : classes.isError || heads.isError || structures.isError ? (
        <ErrorState onRetry={() => void structures.refetch()} />
      ) : monthlyHeads.length === 0 ? (
        <EmptyState
          title="Add a fee head first"
          description="Create at least one recurring or one-time head to price it."
        />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 bg-background">Class</TableHead>
                {monthlyHeads.map((head) => (
                  <TableHead key={head.id} className="min-w-32">
                    {head.name}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(classes.data?.data ?? []).map((cls) => (
                <TableRow key={cls.id}>
                  <TableCell className="sticky left-0 bg-background font-medium">
                    {cls.name}
                  </TableCell>
                  {monthlyHeads.map((head) => {
                    const key = `${cls.id}:${head.id}`;
                    return (
                      <TableCell key={head.id}>
                        <Input
                          type="number"
                          min={0}
                          inputMode="decimal"
                          className="h-8 w-28"
                          value={draft[key] ?? ""}
                          onChange={(e) =>
                            setDraft((d) => ({ ...d, [key]: e.target.value }))
                          }
                          placeholder="—"
                        />
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
