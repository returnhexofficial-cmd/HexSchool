"use client";

import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils/date";
import {
  ALLOCATION_STATUS_LABELS,
  ALLOCATION_STATUS_VARIANT,
  allocationApi,
  formatBdt,
} from "@/lib/api/hostel";

/**
 * The hostel card on a student's profile (M09), filled by M26.
 *
 * It reads the **live** allocation rather than the history: the office
 * question this answers is "where does this child sleep", and a list of
 * every bed they have ever had belongs on a report, not on a profile.
 * Every action on the residency lives on the Hostel workspace, where the
 * occupancy grid is — a profile page is the wrong place to be moving
 * somebody between buildings.
 */
export function StudentHostelTab({ studentId }: { studentId: string }) {
  const query = useQuery({
    queryKey: ["student-hostel", studentId],
    queryFn: () => allocationApi.list({ studentId, limit: 5 }),
  });

  if (query.isLoading) return <LoadingBlock />;
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />;

  const rows = query.data?.data ?? [];
  const live = rows.find((row) => row.status !== "VACATED");

  if (!live) {
    return (
      <EmptyState
        title="Not living in the hostel"
        description={
          rows.length > 0
            ? "This student has moved out. Allocate a bed from the Hostel workspace if they are coming back."
            : "Allocate a bed from the Hostel workspace — click a free bed on the occupancy grid."
        }
      />
    );
  }

  const mess = live.messEnrollments.find((row) => !row.endDate);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">{live.hostel.name}</p>
          <p className="text-sm text-muted-foreground">
            Room {live.bed.room.roomNo} · bed {live.bed.bedNo} ·{" "}
            {live.bed.room.floor === 0
              ? "ground floor"
              : `floor ${live.bed.room.floor}`}
          </p>
        </div>
        <Badge variant={ALLOCATION_STATUS_VARIANT[live.status]}>
          {ALLOCATION_STATUS_LABELS[live.status]}
        </Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-md border p-3">
          <p className="text-xs uppercase text-muted-foreground">Living in since</p>
          <p className="font-medium">{formatDate(live.startDate)}</p>
        </div>
        <div className="rounded-md border p-3">
          <p className="text-xs uppercase text-muted-foreground">Seat rent</p>
          <p className="font-medium">
            ৳{formatBdt(live.bed.room.monthlyFee)}/month
          </p>
        </div>
        <div className="rounded-md border p-3">
          <p className="text-xs uppercase text-muted-foreground">Mess</p>
          <p className="font-medium">{mess?.plan.name ?? "No plan"}</p>
          {mess && (
            <p className="text-sm text-muted-foreground">
              ৳{formatBdt(mess.plan.monthlyCharge)}/month
            </p>
          )}
        </div>
        <div className="rounded-md border p-3">
          <p className="text-xs uppercase text-muted-foreground">Deposit held</p>
          <p className="font-medium">৳{formatBdt(live.securityDeposit)}</p>
        </div>
      </div>

      {live.status === "SUSPENDED" && (
        <p className="rounded-md bg-muted px-3 py-2 text-sm">
          Billing is paused from {live.suspendedAt ?? "—"} and the bed is being
          held.
          {live.statusReason ? ` Reason: ${live.statusReason}` : ""}
        </p>
      )}

      {live.remarks && (
        <p className="text-sm text-muted-foreground">Note: {live.remarks}</p>
      )}
    </div>
  );
}
