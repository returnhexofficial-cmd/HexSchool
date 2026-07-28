"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Can } from "@/components/shared/can";
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
import {
  accountApi,
  formatAmount,
  voucherApi,
  VOUCHER_TYPE_LABELS,
  type Account,
  type Voucher,
  type VoucherStatus,
  type VoucherType,
} from "@/lib/api/accounting";
import {
  balanceDifference,
  sumSide,
  VOUCHER_STATUS_VARIANT,
  VOUCHER_TYPE_HINTS,
  VOUCHER_TYPES,
} from "@/lib/validations/accounting";

const today = () => new Date().toISOString().slice(0, 10);

interface DraftLine {
  accountId: string;
  debit: string;
  credit: string;
  narration: string;
}

const emptyLine = (): DraftLine => ({
  accountId: "",
  debit: "",
  credit: "",
  narration: "",
});

/**
 * The voucher register plus the entry screen (roadmap M20 §5).
 *
 * The entry screen's defining feature is the **live balance indicator**:
 * the Post button stays disabled until debits and credits match to the
 * paisa, with a running "out by X" readout. That is the client mirror of
 * `balanceError` in `accounting/calc/voucher.engine.ts` — the server
 * re-checks and is the authority, but making the operator discover the
 * imbalance on submit would be a bad way to enter a fifteen-line journal.
 */
export function VouchersTab() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<VoucherStatus | "ALL">("ALL");
  const [type, setType] = useState<VoucherType | "ALL">("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [entering, setEntering] = useState(false);
  const [viewing, setViewing] = useState<Voucher | null>(null);

  const vouchers = useQuery({
    queryKey: ["vouchers", status, type, from, to, search],
    queryFn: () =>
      voucherApi.list({
        status: status === "ALL" ? undefined : status,
        type: type === "ALL" ? undefined : type,
        from: from || undefined,
        to: to || undefined,
        search: search || undefined,
        limit: 50,
      }),
  });

  const post = useMutation({
    mutationFn: (id: string) => voucherApi.post(id),
    onSuccess: (voucher) => {
      toast.success(`${voucher.voucherNo} posted.`);
      void qc.invalidateQueries({ queryKey: ["vouchers"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="v-from" className="text-xs">
              From
            </Label>
            <Input
              id="v-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="v-to" className="text-xs">
              To
            </Label>
            <Input
              id="v-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Type</Label>
            <Select
              value={type}
              onValueChange={(value) => setType(value as VoucherType | "ALL")}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All types</SelectItem>
                {VOUCHER_TYPES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {VOUCHER_TYPE_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Status</Label>
            <Select
              value={status}
              onValueChange={(value) =>
                setStatus(value as VoucherStatus | "ALL")
              }
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All</SelectItem>
                <SelectItem value="DRAFT">Draft</SelectItem>
                <SelectItem value="POSTED">Posted</SelectItem>
                <SelectItem value="CANCELLED">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Input
            placeholder="Voucher no. or narration"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56"
          />
        </div>

        <Can permission="voucher.create">
          <Button onClick={() => setEntering(true)}>New voucher</Button>
        </Can>
      </header>

      {vouchers.isPending ? (
        <LoadingBlock />
      ) : vouchers.isError ? (
        <ErrorState onRetry={() => void vouchers.refetch()} />
      ) : vouchers.data.rows.length === 0 ? (
        <EmptyState
          title="No vouchers here"
          description="Raise one, or take a fee payment — receipts post themselves."
        />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Voucher</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Narration</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-40" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {vouchers.data.rows.map((voucher) => (
                <TableRow key={voucher.id}>
                  <TableCell className="font-mono text-xs">
                    {voucher.voucherNo}
                    {voucher.source !== "MANUAL" ? (
                      <Badge variant="secondary" className="ml-2">
                        auto
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>{voucher.date.slice(0, 10)}</TableCell>
                  <TableCell>{VOUCHER_TYPE_LABELS[voucher.type]}</TableCell>
                  <TableCell className="max-w-md truncate">
                    {voucher.narration}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatAmount(
                      voucher.entries.reduce(
                        (sum, entry) => sum + Number(entry.debit),
                        0,
                      ),
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={VOUCHER_STATUS_VARIANT[voucher.status]}>
                      {voucher.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setViewing(voucher)}
                    >
                      Open
                    </Button>
                    {voucher.status === "DRAFT" ? (
                      <Can permission="voucher.post">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={post.isPending}
                          onClick={() => post.mutate(voucher.id)}
                        >
                          Post
                        </Button>
                      </Can>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {entering ? <VoucherEntryDialog onClose={() => setEntering(false)} /> : null}
      {viewing ? (
        <VoucherDetailDialog
          voucher={viewing}
          onClose={() => setViewing(null)}
        />
      ) : null}
    </div>
  );
}

// ── entry screen ────────────────────────────────────────────────────────

function VoucherEntryDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [type, setType] = useState<VoucherType>("CREDIT");
  const [date, setDate] = useState(today());
  const [narration, setNarration] = useState("");
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([emptyLine(), emptyLine()]);

  const accounts = useQuery({
    queryKey: ["accounts", "postable"],
    queryFn: () => accountApi.list({ postableOnly: true }),
  });

  const numeric = useMemo(
    () =>
      lines.map((line) => ({
        debit: Number(line.debit) || 0,
        credit: Number(line.credit) || 0,
      })),
    [lines],
  );
  const debitTotal = sumSide(numeric, "debit");
  const creditTotal = sumSide(numeric, "credit");
  const difference = balanceDifference(numeric);
  const filled = lines.filter(
    (line) => line.accountId && (Number(line.debit) || Number(line.credit)),
  );
  const canPost =
    difference === 0 &&
    filled.length >= 2 &&
    narration.trim().length >= 2 &&
    debitTotal > 0;

  const save = useMutation({
    mutationFn: (post: boolean) =>
      voucherApi.create({
        type,
        date,
        narration: narration.trim(),
        reference: reference.trim() || undefined,
        entries: filled.map((line) => ({
          accountId: line.accountId,
          debit: Number(line.debit) || 0,
          credit: Number(line.credit) || 0,
          narration: line.narration.trim() || undefined,
        })),
        post,
      }),
    onSuccess: (voucher) => {
      toast.success(
        voucher.status === "POSTED"
          ? `${voucher.voucherNo} posted.`
          : `${voucher.voucherNo} saved as a draft.`,
      );
      void qc.invalidateQueries({ queryKey: ["vouchers"] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const setLine = (index: number, patch: Partial<DraftLine>) =>
    setLines((prev) =>
      prev.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>New voucher</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select
                value={type}
                onValueChange={(value) => setType(value as VoucherType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VOUCHER_TYPES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {VOUCHER_TYPE_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {VOUCHER_TYPE_HINTS[type]}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ve-date">Date</Label>
              <Input
                id="ve-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ve-ref">Reference</Label>
              <Input
                id="ve-ref"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Cheque no., bill no…"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ve-narration">Narration</Label>
            <Textarea
              id="ve-narration"
              rows={2}
              value={narration}
              onChange={(e) => setNarration(e.target.value)}
              placeholder="What this voucher records"
            />
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[38%]">Account</TableHead>
                  <TableHead>Line narration</TableHead>
                  <TableHead className="w-32 text-right">Debit</TableHead>
                  <TableHead className="w-32 text-right">Credit</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line, index) => (
                  <TableRow key={index}>
                    <TableCell>
                      <Select
                        value={line.accountId}
                        onValueChange={(value) =>
                          setLine(index, { accountId: value })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Pick an account" />
                        </SelectTrigger>
                        <SelectContent>
                          {(accounts.data ?? []).map((account: Account) => (
                            <SelectItem key={account.id} value={account.id}>
                              {account.code} — {account.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input
                        value={line.narration}
                        onChange={(e) =>
                          setLine(index, { narration: e.target.value })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        className="text-right"
                        value={line.debit}
                        onChange={(e) =>
                          // Typing in one column clears the other: a line
                          // carrying both is refused by the engine and by a
                          // DB CHECK, so the grid never lets one exist.
                          setLine(index, { debit: e.target.value, credit: "" })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        className="text-right"
                        value={line.credit}
                        onChange={(e) =>
                          setLine(index, { credit: e.target.value, debit: "" })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={lines.length <= 2}
                        onClick={() =>
                          setLines((prev) => prev.filter((_, i) => i !== index))
                        }
                        aria-label="Remove line"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLines((prev) => [...prev, emptyLine()])}
            >
              <Plus className="mr-1 size-4" /> Add line
            </Button>

            {/* The live balance indicator — roadmap §5 "must hit 0 to post". */}
            <div className="flex items-center gap-6 text-sm">
              <span>
                Debit{" "}
                <strong className="tabular-nums">
                  {formatAmount(debitTotal)}
                </strong>
              </span>
              <span>
                Credit{" "}
                <strong className="tabular-nums">
                  {formatAmount(creditTotal)}
                </strong>
              </span>
              <span
                className={
                  difference === 0
                    ? "font-semibold text-emerald-600"
                    : "font-semibold text-destructive"
                }
              >
                {difference === 0
                  ? "Balanced"
                  : `Out by ${formatAmount(Math.abs(difference))} ${
                      difference > 0 ? "(debit heavy)" : "(credit heavy)"
                    }`}
              </span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            disabled={save.isPending || filled.length < 2}
            onClick={() => save.mutate(false)}
          >
            Save draft
          </Button>
          <Can permission="voucher.post">
            <Button
              disabled={save.isPending || !canPost}
              onClick={() => save.mutate(true)}
            >
              Post
            </Button>
          </Can>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── detail / cancel ─────────────────────────────────────────────────────

function VoucherDetailDialog({
  voucher,
  onClose,
}: {
  voucher: Voucher;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [cancelling, setCancelling] = useState(false);

  const detail = useQuery({
    queryKey: ["voucher", voucher.id],
    queryFn: () => voucherApi.get(voucher.id),
    initialData: voucher,
  });

  const cancel = useMutation({
    mutationFn: () => voucherApi.cancel(voucher.id, reason.trim()),
    onSuccess: (result) => {
      toast.success(
        result.reversal
          ? `Cancelled — reversal ${result.reversal.voucherNo} posted.`
          : "Draft removed.",
      );
      void qc.invalidateQueries({ queryKey: ["vouchers"] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const row = detail.data;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-mono">{row.voucherNo}</span>
            <Badge variant={VOUCHER_STATUS_VARIANT[row.status]}>
              {row.status}
            </Badge>
            {row.source !== "MANUAL" ? (
              <Badge variant="secondary">auto · {row.source}</Badge>
            ) : null}
          </DialogTitle>
        </DialogHeader>

        <dl className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Date</dt>
            <dd>{row.date.slice(0, 10)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Type</dt>
            <dd>{VOUCHER_TYPE_LABELS[row.type]}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Reference</dt>
            <dd>{row.reference ?? "—"}</dd>
          </div>
          <div className="col-span-3">
            <dt className="text-xs text-muted-foreground">Narration</dt>
            <dd>{row.narration}</dd>
          </div>
        </dl>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Narration</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Credit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {row.entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>
                    <span className="font-mono text-xs text-muted-foreground">
                      {entry.account.code}
                    </span>{" "}
                    {entry.account.name}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {entry.narration ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {Number(entry.debit) ? formatAmount(entry.debit) : ""}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {Number(entry.credit) ? formatAmount(entry.credit) : ""}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {row.cancelReason ? (
          <p className="text-sm text-destructive">
            Cancelled: {row.cancelReason}
          </p>
        ) : null}

        {cancelling ? (
          <div className="space-y-2 rounded-md border border-destructive/40 p-3">
            <Label htmlFor="v-cancel-reason">
              Why is this being cancelled?
            </Label>
            <Textarea
              id="v-cancel-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              A posted voucher is never deleted — cancelling writes a
              mirror-image reversal so the ledger keeps both sides.
            </p>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Can permission="accounting.export">
            <Button
              variant="secondary"
              onClick={() => void voucherApi.print(row.id)}
            >
              Print
            </Button>
          </Can>
          {row.status !== "CANCELLED" ? (
            <Can permission="voucher.cancel">
              {cancelling ? (
                <Button
                  variant="destructive"
                  disabled={cancel.isPending || reason.trim().length < 3}
                  onClick={() => cancel.mutate()}
                >
                  Confirm cancel
                </Button>
              ) : (
                <Button
                  variant="destructive"
                  onClick={() => setCancelling(true)}
                >
                  Cancel voucher
                </Button>
              )}
            </Can>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
