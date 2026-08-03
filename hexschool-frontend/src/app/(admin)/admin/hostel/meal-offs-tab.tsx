"use client";

import { useState } from "react";
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
import { apiErrorMessage } from "@/lib/api/auth";
import {
  MEAL_OFF_STATUS_LABELS,
  MEAL_OFF_VARIANT,
  allocationApi,
  hostelApi,
  mealOffApi,
  type MealOff,
  type MealOffStatus,
} from "@/lib/api/hostel";

/**
 * The meal-off inbox (roadmap §5).
 *
 * **Approving fixes which month's invoice carries the credit** — the
 * month after the later of the last day away and today — and the decided
 * row shows it, because "when will I see this back" is the question a
 * parent asks next. A request is decided once: an approved one cannot be
 * refused later, because the credit month has already been promised.
 */
export function MealOffsTab() {
  const [status, setStatus] = useState<MealOffStatus | "">("PENDING");
  const [hostelId, setHostelId] = useState("");
  const [deciding, setDeciding] = useState<{
    mealOff: MealOff;
    approve: boolean;
  } | null>(null);
  const [requesting, setRequesting] = useState(false);

  const hostels = useQuery({
    queryKey: ["hostels"],
    queryFn: () => hostelApi.list(),
  });

  const list = useQuery({
    queryKey: ["meal-offs", { status, hostelId }],
    queryFn: () =>
      mealOffApi.list({
        limit: 100,
        status: status || undefined,
        hostelId: hostelId || undefined,
      }),
  });

  const rows = list.data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="mo-hostel">Hostel</Label>
          <select
            id="mo-hostel"
            className="h-9 rounded-md border bg-transparent px-3 text-sm"
            value={hostelId}
            onChange={(e) => setHostelId(e.target.value)}
          >
            <option value="">All hostels</option>
            {(hostels.data ?? []).map((summary) => (
              <option key={summary.hostel.id} value={summary.hostel.id}>
                {summary.hostel.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="mo-status">Status</Label>
          <select
            id="mo-status"
            className="h-9 rounded-md border bg-transparent px-3 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value as MealOffStatus | "")}
          >
            <option value="PENDING">Waiting</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Refused</option>
            <option value="CANCELLED">Withdrawn</option>
            <option value="">All</option>
          </select>
        </div>

        <div className="ml-auto">
          <Can permission="hostel.mess.manage">
            <Button onClick={() => setRequesting(true)}>
              Record a request
            </Button>
          </Can>
        </div>
      </div>

      {list.isLoading ? (
        <LoadingBlock />
      ) : list.isError ? (
        <ErrorState onRetry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nothing here"
          description="A meal-off tells the kitchen not to cook for somebody, and credits their next bill for the days they were away."
        />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="p-3 font-medium">Student</th>
                <th className="p-3 font-medium">Hostel</th>
                <th className="p-3 font-medium">Away</th>
                <th className="p-3 font-medium">Days</th>
                <th className="p-3 font-medium">Reason</th>
                <th className="p-3 font-medium">Credit lands on</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="p-3">
                    <div className="font-medium">
                      {row.allocation.enrollment.student.firstName}{" "}
                      {row.allocation.enrollment.student.lastName}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {row.allocation.enrollment.student.studentUid}
                    </div>
                  </td>
                  <td className="p-3">{row.allocation.hostel.name}</td>
                  <td className="p-3">
                    {row.fromDate} → {row.toDate}
                  </td>
                  <td className="p-3">{row.days}</td>
                  <td className="p-3 max-w-[16rem] truncate" title={row.reason}>
                    {row.reason}
                  </td>
                  <td className="p-3">
                    {row.creditMonth ? (
                      row.creditMonth.slice(0, 7)
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="p-3">
                    <Badge variant={MEAL_OFF_VARIANT[row.status]}>
                      {MEAL_OFF_STATUS_LABELS[row.status]}
                    </Badge>
                  </td>
                  <td className="p-3">
                    {row.status === "PENDING" && (
                      <Can permission="hostel.mealoff.approve">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            onClick={() =>
                              setDeciding({ mealOff: row, approve: true })
                            }
                          >
                            Approve
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setDeciding({ mealOff: row, approve: false })
                            }
                          >
                            Refuse
                          </Button>
                        </div>
                      </Can>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {deciding && (
        <DecideDialog
          mealOff={deciding.mealOff}
          approve={deciding.approve}
          onClose={() => setDeciding(null)}
        />
      )}
      {requesting && <RequestDialog onClose={() => setRequesting(false)} />}
    </div>
  );
}

function DecideDialog({
  mealOff,
  approve,
  onClose,
}: {
  mealOff: MealOff;
  approve: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");

  const decide = useMutation({
    mutationFn: () =>
      mealOffApi.decide(mealOff.id, { approve, note: note || undefined }),
    onSuccess: (row) => {
      toast.success(
        approve
          ? `Approved — the credit lands on the ${row.creditMonth?.slice(0, 7) ?? "next"} invoice`
          : "Refused",
      );
      void qc.invalidateQueries({ queryKey: ["meal-offs"] });
      onClose();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const student = `${mealOff.allocation.enrollment.student.firstName} ${mealOff.allocation.enrollment.student.lastName}`;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {approve ? "Approve" : "Refuse"} {student}&rsquo;s meal-off
          </DialogTitle>
          <DialogDescription>
            {mealOff.fromDate} to {mealOff.toDate} — {mealOff.days} day(s).
            {approve
              ? " Approving fixes the month whose invoice carries the credit; it cannot be undone."
              : " A refusal is recorded with your name on it."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-1.5">
          <Label htmlFor="decide-note">Note (optional)</Label>
          <Input
            id="decide-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => decide.mutate()} disabled={decide.isPending}>
            {decide.isPending ? "Saving…" : approve ? "Approve" : "Refuse"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RequestDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [allocationId, setAllocationId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [reason, setReason] = useState("");

  const boarders = useQuery({
    queryKey: ["hostel-allocations", { status: "ACTIVE" }],
    queryFn: () => allocationApi.list({ status: "ACTIVE", limit: 100 }),
  });

  const create = useMutation({
    mutationFn: () =>
      mealOffApi.create({ allocationId, fromDate, toDate, reason }),
    onSuccess: () => {
      toast.success("Request recorded");
      void qc.invalidateQueries({ queryKey: ["meal-offs"] });
      onClose();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record a meal-off request</DialogTitle>
          <DialogDescription>
            The kitchen buys ahead, so a request shorter than the school&rsquo;s
            minimum is refused. Dates that overlap a request already on file
            are refused too — the credit would otherwise be paid twice.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="req-boarder">Boarder</Label>
            <select
              id="req-boarder"
              className="h-9 rounded-md border bg-transparent px-3 text-sm"
              value={allocationId}
              onChange={(e) => setAllocationId(e.target.value)}
            >
              <option value="">Pick a boarder…</option>
              {(boarders.data?.data ?? []).map((row) => (
                <option key={row.id} value={row.id}>
                  {row.enrollment.student.firstName}{" "}
                  {row.enrollment.student.lastName} · {row.hostel.name} room{" "}
                  {row.bed.room.roomNo}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="req-from">From</Label>
              <Input
                id="req-from"
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="req-to">To</Label>
              <Input
                id="req-to"
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="req-reason">Reason</Label>
            <Input
              id="req-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Going home for Eid"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => create.mutate()}
            disabled={
              create.isPending ||
              !allocationId ||
              !fromDate ||
              !toDate ||
              reason.trim().length < 3 ||
              toDate < fromDate
            }
          >
            {create.isPending ? "Saving…" : "Record"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
