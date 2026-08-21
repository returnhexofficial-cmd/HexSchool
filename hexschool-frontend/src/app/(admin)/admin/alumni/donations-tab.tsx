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
import { Textarea } from "@/components/ui/textarea";
import { apiErrorMessage } from "@/lib/api/auth";
import { formatDate } from "@/lib/utils/date";
import { MAX_PAGE_LIMIT } from "@/lib/constants/pagination";
import {
  DONATION_METHODS,
  DONATION_METHOD_LABELS,
  alumniApi,
  donationApi,
  type Donation,
  type DonationMethod,
} from "@/lib/api/community";

/**
 * The donation register (roadmap §5's "donation entry + receipts;
 * donation dashboard").
 *
 * **There is no edit button, and there never will be.** Roadmap §6 makes a
 * receipt immutable: a mistyped amount is cancelled with a reason and
 * stays in the register, carrying its cancellation across the reprinted
 * receipt. That is the M15 re-issue / M20 reversal / M24 purchase-
 * cancellation / M27 certificate rule arriving in a fifth ledger, and the
 * absence of the button is how the screen says so.
 */
export function DonationsTab() {
  const queryClient = useQueryClient();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [recording, setRecording] = useState(false);
  const [cancelling, setCancelling] = useState<Donation | null>(null);
  const [reason, setReason] = useState("");

  const params = { from: from || undefined, to: to || undefined };

  const list = useQuery({
    queryKey: ["donations", params],
    queryFn: () => donationApi.list({ limit: MAX_PAGE_LIMIT, ...params }),
  });

  const summary = useQuery({
    queryKey: ["donations", "summary", params],
    queryFn: () => donationApi.summary(params),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["donations"] });

  const cancel = useMutation({
    mutationFn: (input: { id: string; reason: string }) =>
      donationApi.cancel(input.id, { reason: input.reason }),
    onSuccess: (donation) => {
      toast.success(`Receipt ${donation.receiptNo} cancelled`);
      setCancelling(null);
      setReason("");
      invalidate();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  if (list.isLoading) return <LoadingBlock />;
  if (list.isError) return <ErrorState onRetry={() => void list.refetch()} />;

  const donations = list.data?.data ?? [];
  const totals = summary.data?.totals;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="d-from">From</Label>
          <Input
            id="d-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="d-to">To</Label>
          <Input
            id="d-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <div className="ml-auto flex gap-2">
          <Can permission="alumni.export">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void donationApi.downloadSummary(params)}
            >
              Summary (XLSX)
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void donationApi.downloadRegister(params)}
            >
              Register (XLSX)
            </Button>
          </Can>
          <Can permission="alumni.donation.create">
            <Button size="sm" onClick={() => setRecording(true)}>
              Record a donation
            </Button>
          </Can>
        </div>
      </div>

      {totals && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Raised"
            value={`BDT ${totals.total.toLocaleString()}`}
            hint={`${totals.received} receipt(s)`}
          />
          <StatCard
            title="From alumni"
            value={`BDT ${totals.fromAlumniAmount.toLocaleString()}`}
            hint={`${totals.fromAlumni} gift(s)`}
          />
          <StatCard
            title="Largest gift"
            value={`BDT ${totals.largest.toLocaleString()}`}
          />
          <StatCard
            title="Cancelled"
            value={String(totals.cancelled)}
            hint={`BDT ${totals.cancelledAmount.toLocaleString()} not counted`}
          />
        </div>
      )}

      {summary.data && summary.data.byPurpose.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <PurposeBreakdown rows={summary.data.byPurpose} />
          <div className="space-y-3 rounded-lg border p-4">
            <p className="text-sm font-medium">Top donors</p>
            {summary.data.topDonors.map((donor) => (
              <div key={donor.name} className="flex justify-between text-sm">
                <span>
                  {donor.name}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {donor.count} gift{donor.count === 1 ? "" : "s"}
                  </span>
                </span>
                <span className="text-muted-foreground">
                  BDT {donor.amount.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {donations.length === 0 ? (
        <EmptyState
          title="No donations in this window"
          description="Gifts recorded at the desk appear here with their receipt numbers."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="p-3">Receipt</th>
                <th className="p-3">Date</th>
                <th className="p-3">Donor</th>
                <th className="p-3">Amount</th>
                <th className="p-3">Method</th>
                <th className="p-3">Purpose</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {donations.map((donation) => (
                <tr
                  key={donation.id}
                  className={donation.cancelledAt ? "border-t opacity-60" : "border-t"}
                >
                  <td className="p-3 font-mono text-xs">
                    {donation.receiptNo}
                  </td>
                  <td className="p-3">
                    {formatDate(donation.receivedAt)}
                  </td>
                  <td className="p-3 font-medium">{donation.donorName}</td>
                  <td className="p-3">
                    BDT {Number(donation.amount).toFixed(2)}
                  </td>
                  <td className="p-3">
                    {DONATION_METHOD_LABELS[donation.method]}
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {donation.purpose ?? "—"}
                  </td>
                  <td className="p-3 text-right">
                    <div className="flex justify-end gap-2">
                      {donation.cancelledAt ? (
                        <Badge variant="destructive">Cancelled</Badge>
                      ) : (
                        <Can permission="alumni.donation.cancel">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setCancelling(donation)}
                          >
                            Cancel
                          </Button>
                        </Can>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          void donationApi.printReceipt(
                            donation.id,
                            donation.receiptNo,
                          )
                        }
                      >
                        Receipt
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={cancelling !== null}
        onOpenChange={(open) => !open && setCancelling(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Cancel receipt {cancelling?.receiptNo}
            </DialogTitle>
            <DialogDescription>
              The receipt <strong>stays in the register</strong> carrying this
              reason, and the reprinted copy says CANCELLED across it. If it
              was posted to the ledger, the accountant reverses that voucher
              separately.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="cancel-reason">Why?</Label>
            <Textarea
              id="cancel-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelling(null)}>
              Keep it
            </Button>
            <Button
              disabled={reason.trim().length < 3 || cancel.isPending}
              onClick={() =>
                cancelling &&
                cancel.mutate({ id: cancelling.id, reason })
              }
            >
              Cancel the receipt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {recording && (
        <RecordDonationDialog
          onClose={() => setRecording(false)}
          onSaved={invalidate}
        />
      )}
    </div>
  );
}

function PurposeBreakdown({
  rows,
}: {
  rows: Array<{ label: string; amount: number; percent: number }>;
}) {
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <p className="text-sm font-medium">By purpose</p>
      {rows.map((row) => (
        <div key={row.label} className="space-y-1">
          <div className="flex justify-between text-sm">
            <span>{row.label}</span>
            <span className="text-muted-foreground">
              BDT {row.amount.toLocaleString()} ({row.percent}%)
            </span>
          </div>
          <div className="h-1.5 w-full rounded bg-muted">
            <div
              className="h-1.5 rounded bg-primary"
              style={{ width: `${row.percent}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function RecordDonationDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [alumniId, setAlumniId] = useState("");
  const [donorName, setDonorName] = useState("");
  const [donorPhone, setDonorPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState("");
  const [method, setMethod] = useState<DonationMethod>("CASH");
  const [remarks, setRemarks] = useState("");

  const alumni = useQuery({
    queryKey: ["alumni", { status: "APPROVED", forDonation: true }],
    queryFn: () => alumniApi.list({ status: "APPROVED", limit: MAX_PAGE_LIMIT }),
  });

  const save = useMutation({
    mutationFn: () =>
      donationApi.create({
        alumniId: alumniId || undefined,
        donorName,
        donorPhone: donorPhone || undefined,
        amount: Number(amount),
        purpose: purpose || undefined,
        method,
        remarks: remarks || undefined,
      }),
    onSuccess: (donation) => {
      toast.success(`Receipt ${donation.receiptNo} issued`);
      onSaved();
      onClose();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const valid = donorName.trim().length >= 2 && Number(amount) > 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Record a donation</DialogTitle>
          <DialogDescription>
            A receipt number is issued on save and cannot be changed
            afterwards — a mistake is cancelled with a reason.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="don-alumni">From an alumnus (optional)</Label>
            <select
              id="don-alumni"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={alumniId}
              onChange={(e) => {
                setAlumniId(e.target.value);
                const found = (alumni.data?.data ?? []).find(
                  (a) => a.id === e.target.value,
                );
                if (found && !donorName) setDonorName(found.name);
                if (found?.phone && !donorPhone) setDonorPhone(found.phone);
              }}
            >
              <option value="">Not an alumnus</option>
              {(alumni.data?.data ?? []).map((alumnus) => (
                <option key={alumnus.id} value={alumnus.id}>
                  {alumnus.name} ({alumnus.batchYear})
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="don-name">Donor name</Label>
              <Input
                id="don-name"
                value={donorName}
                onChange={(e) => setDonorName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="don-phone">Mobile</Label>
              <Input
                id="don-phone"
                placeholder="01XXXXXXXXX"
                value={donorPhone}
                onChange={(e) => setDonorPhone(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="don-amount">Amount (BDT)</Label>
              <Input
                id="don-amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="don-method">Method</Label>
              <select
                id="don-method"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={method}
                onChange={(e) => setMethod(e.target.value as DonationMethod)}
              >
                {DONATION_METHODS.map((value) => (
                  <option key={value} value={value}>
                    {DONATION_METHOD_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {method === "IN_KIND" && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
              A gift in kind is receipted and reported but <strong>not
              posted to cash</strong> — twenty donated benches are not twenty
              thousand taka in the cash box. The accountant capitalizes it
              against the right asset account.
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="don-purpose">Purpose</Label>
            <Input
              id="don-purpose"
              placeholder="Library fund, scholarship, general…"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="don-remarks">Remarks</Label>
            <Textarea
              id="don-remarks"
              rows={2}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Issue receipt"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
