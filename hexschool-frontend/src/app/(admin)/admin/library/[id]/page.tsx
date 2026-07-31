"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { PageHeader } from "@/components/shared/page-header";
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
  bookApi,
  copyApi,
  CONDITIONS,
  COPY_STATUS_LABELS,
  COPY_STATUS_VARIANT,
  formatBdt,
  formatLibraryDate,
  WRITE_OFF_STATUSES,
  type BookCondition,
  type BookCopy,
  type BookCopyStatus,
} from "@/lib/api/library";

/**
 * One title and its physical copies. The copies tab is where accession
 * numbers are generated, labels are printed and a volume is written off.
 */
export default function BookDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [marking, setMarking] = useState<BookCopy | null>(null);
  const [deleting, setDeleting] = useState<BookCopy | null>(null);
  const qc = useQueryClient();

  const book = useQuery({
    queryKey: ["library-book", id],
    queryFn: () => bookApi.detail(id),
  });

  const copies = useQuery({
    queryKey: ["library-copies", id],
    queryFn: () => copyApi.list({ bookId: id, limit: 200 }),
  });

  const remove = useMutation({
    mutationFn: (copyId: string) => copyApi.remove(copyId),
    onSuccess: () => {
      toast.success("Copy removed.");
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ["library-copies", id] });
      void qc.invalidateQueries({ queryKey: ["library-book", id] });
    },
    onError: (err) => {
      setDeleting(null);
      toast.error(apiErrorMessage(err));
    },
  });

  const printLabels = useMutation({
    mutationFn: (copyIds: string[]) => copyApi.labels(copyIds),
    onSuccess: () => toast.success("Label sheet downloaded."),
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  if (book.isLoading) return <LoadingBlock />;
  if (book.isError || !book.data) {
    return (
      <main className="flex-1 p-8">
        <ErrorState onRetry={() => void book.refetch()} />
      </main>
    );
  }

  const rows = copies.data?.rows ?? [];
  const toggle = (copyId: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(copyId)) next.delete(copyId);
      else next.add(copyId);
      return next;
    });

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title={book.data.title}
        description={[
          book.data.authors.map((a) => a.author.name).join(", "),
          book.data.category.name,
          book.data.edition,
          book.data.isbn,
        ]
          .filter(Boolean)
          .join(" · ")}
      >
        <Button asChild variant="outline">
          <Link href="/admin/library">Back to the catalogue</Link>
        </Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Copies"
          value={String(book.data.copies.total)}
          hint="In stock — written-off copies excluded"
        />
        <StatCard
          title="Available"
          value={String(book.data.copies.available)}
          hint="On the shelf right now"
        />
        <StatCard
          title="Rack"
          value={book.data.rackNo ?? "—"}
          hint="Where it lives"
        />
        <StatCard
          title="Replacement price"
          value={book.data.price ? formatBdt(book.data.price) : "—"}
          hint="What a lost copy is charged against"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium">Copies</h2>
        <div className="flex gap-2">
          <Can permission="library.export">
            <Button
              variant="outline"
              size="sm"
              disabled={selected.size === 0 || printLabels.isPending}
              onClick={() => printLabels.mutate([...selected])}
            >
              Print {selected.size || ""} label{selected.size === 1 ? "" : "s"}
            </Button>
          </Can>
          <Can permission="library.copy.manage">
            <Button size="sm" onClick={() => setGenerating(true)}>
              Add copies
            </Button>
          </Can>
        </div>
      </div>

      {copies.isLoading ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No copies yet"
          description="Generate them — each gets a sequential accession number and a Code 128 barcode."
        />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Accession</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Condition</TableHead>
                <TableHead>Added</TableHead>
                <TableHead className="w-40" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((copy) => (
                <TableRow key={copy.id}>
                  <TableCell>
                    <Checkbox
                      checked={selected.has(copy.id)}
                      onCheckedChange={() => toggle(copy.id)}
                      aria-label={`Select ${copy.accessionNo}`}
                    />
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {copy.accessionNo}
                  </TableCell>
                  <TableCell>
                    <Badge variant={COPY_STATUS_VARIANT[copy.status]}>
                      {COPY_STATUS_LABELS[copy.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {copy.condition}
                    {copy.conditionNote && (
                      <div className="text-xs text-muted-foreground">
                        {copy.conditionNote}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {formatLibraryDate(copy.addedAt)}
                  </TableCell>
                  <TableCell className="space-x-1 text-right">
                    <Can permission="library.copy.manage">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setMarking(copy)}
                      >
                        Write off
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleting(copy)}
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

      {generating && (
        <GenerateDialog bookId={id} onClose={() => setGenerating(false)} />
      )}
      {marking && (
        <MarkDialog copy={marking} onClose={() => setMarking(null)} />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.accessionNo ?? ""}?`}
        description="Only for a cataloguing mistake. A copy that has ever been on loan is part of somebody's history — write it off as WITHDRAWN instead."
        confirmLabel="Delete"
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id);
        }}
      />
    </main>
  );
}

function GenerateDialog({
  bookId,
  onClose,
}: {
  bookId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [count, setCount] = useState("5");
  const [condition, setCondition] = useState<BookCondition>("NEW");
  const [price, setPrice] = useState("");

  const generate = useMutation({
    mutationFn: () =>
      bookApi.generateCopies(bookId, {
        count: Number(count),
        condition,
        purchasePrice: price.trim() === "" ? undefined : Number(price),
      }),
    onSuccess: (created) => {
      toast.success(
        `${created.length} copies added — ${created[0]?.accessionNo} to ${
          created.at(-1)?.accessionNo
        }.`,
      );
      void qc.invalidateQueries({ queryKey: ["library-copies", bookId] });
      void qc.invalidateQueries({ queryKey: ["library-book", bookId] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const invalid = !Number(count) || Number(count) < 1 || Number(count) > 200;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add copies</DialogTitle>
          <DialogDescription>
            Each copy gets the next accession number from the school&apos;s
            sequence. The numbers are gap-free: if this fails halfway, none of
            them are burnt.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="count">How many?</Label>
            <Input
              id="count"
              type="number"
              min={1}
              max={200}
              value={count}
              onChange={(event) => setCount(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Up to 200 at a time — run a second batch for a bigger donation.
            </p>
          </div>

          <div className="space-y-1">
            <Label>Condition</Label>
            <Select
              value={condition}
              onValueChange={(value) => setCondition(value as BookCondition)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONDITIONS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="purchase-price">Purchase price (BDT)</Label>
            <Input
              id="purchase-price"
              type="number"
              step="0.01"
              placeholder="Leave blank for a donation"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => generate.mutate()}
            disabled={invalid || generate.isPending}
          >
            Generate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MarkDialog({
  copy,
  onClose,
}: {
  copy: BookCopy;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<BookCopyStatus>("LOST");
  const [reason, setReason] = useState("");
  const [fineAmount, setFineAmount] = useState("");

  const mark = useMutation({
    mutationFn: () =>
      copyApi.mark(copy.id, {
        status,
        reason: reason.trim(),
        fineAmount: fineAmount.trim() === "" ? undefined : Number(fineAmount),
      }),
    onSuccess: (result) => {
      toast.success(
        result.chargedMemberId
          ? `Written off — ${formatBdt(result.charge)} charged to the borrower.`
          : "Written off.",
      );
      void qc.invalidateQueries({ queryKey: ["library-copies"] });
      void qc.invalidateQueries({ queryKey: ["library-book"] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Write off {copy.accessionNo}</DialogTitle>
          <DialogDescription>
            {copy.book.title}. If it is on loan, the loan is closed and the
            replacement charge lands on the borrower&apos;s card.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label>What happened?</Label>
            <Select
              value={status}
              onValueChange={(value) => setStatus(value as BookCopyStatus)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WRITE_OFF_STATUSES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {COPY_STATUS_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="mark-reason">Reason</Label>
            <Textarea
              id="mark-reason"
              rows={3}
              placeholder="Reported missing by the student on 12 March"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>

          {status !== "WITHDRAWN" && (
            <div className="space-y-1">
              <Label htmlFor="mark-fine">Charge (BDT)</Label>
              <Input
                id="mark-fine"
                type="number"
                step="0.01"
                min="0"
                placeholder="Computed from the price and the multiplier"
                value={fineAmount}
                onChange={(event) => setFineAmount(event.target.value)}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => mark.mutate()}
            disabled={reason.trim().length < 3 || mark.isPending}
          >
            Write off
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
