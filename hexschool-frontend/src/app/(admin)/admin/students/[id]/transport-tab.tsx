"use client";

import { useState } from "react";
import Link from "next/link";
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
import { Label } from "@/components/ui/label";
import { apiErrorMessage } from "@/lib/api/auth";
import { enrollmentApi } from "@/lib/api/enrollment";
import {
  ASSIGNMENT_STATUS_LABELS,
  assignmentApi,
  formatBdt,
  routeApi,
} from "@/lib/api/transport";
import { useAcademicSession } from "@/lib/hooks/use-academic-session";
import { formatDate } from "@/lib/utils/date";

/**
 * Roadmap M25 §5's "assignment flow from student profile (route→stop
 * picker showing fee)".
 *
 * The picker shows the fare beside every stop, because **picking the stop
 * is picking the price** — the fare lives on the stop, not the route, and
 * an office clerk choosing "Kazipara" is committing a family to ৳1,500 a
 * month.
 */
export function StudentTransportTab({ studentId }: { studentId: string }) {
  const qc = useQueryClient();
  const { selected } = useAcademicSession();
  const sessionId = selected?.id;
  const [assigning, setAssigning] = useState(false);

  const assignment = useQuery({
    queryKey: ["student-transport", studentId, sessionId],
    queryFn: () => assignmentApi.forStudent(studentId, sessionId),
  });

  if (assignment.isLoading) return <LoadingBlock />;
  if (assignment.isError) {
    return <ErrorState onRetry={() => void assignment.refetch()} />;
  }

  const rider = assignment.data;

  return (
    <div className="space-y-4">
      {!rider ? (
        <EmptyState
          title="Not on a school bus"
          description="Assign a route and stop — the monthly fare comes from the stop and is billed with the monthly fees."
          action={
            <Can permission="transport.assign">
              <Button onClick={() => setAssigning(true)}>Assign transport</Button>
            </Can>
          }
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard title="Route" value={rider.route.name} hint={rider.route.vehicle?.regNo ?? "No vehicle attached"} />
            <StatCard
              title="Stop"
              value={rider.stop.name}
              hint={`Pickup ${rider.stop.pickupTime ?? "—"} · drop ${rider.stop.dropTime ?? "—"}`}
            />
            <StatCard
              title="Monthly fare"
              value={`৳${formatBdt(rider.stop.monthlyFee)}`}
              hint="Billed with the monthly fees"
            />
            <StatCard
              title="Status"
              value={ASSIGNMENT_STATUS_LABELS[rider.status]}
              hint={`From ${formatDate(rider.startDate)}`}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {rider.route.driver && (
              <Badge variant="outline">
                Driver: {rider.route.driver.name} · {rider.route.driver.phone}
              </Badge>
            )}
            {rider.statusReason && (
              <Badge variant="secondary">{rider.statusReason}</Badge>
            )}
            <Button variant="ghost" size="sm" asChild>
              <Link href="/admin/transport">Open the transport workspace</Link>
            </Button>
          </div>

          {rider.remarks && (
            <p className="text-sm text-muted-foreground">Note: {rider.remarks}</p>
          )}
        </>
      )}

      {assigning && (
        <AssignFromProfileDialog
          studentId={studentId}
          sessionId={sessionId}
          onClose={() => setAssigning(false)}
          onAssigned={() => {
            void qc.invalidateQueries({ queryKey: ["student-transport"] });
            setAssigning(false);
          }}
        />
      )}
    </div>
  );
}

function AssignFromProfileDialog({
  studentId,
  sessionId,
  onClose,
  onAssigned,
}: {
  studentId: string;
  sessionId?: string;
  onClose: () => void;
  onAssigned: () => void;
}) {
  const [routeId, setRouteId] = useState("");
  const [stopId, setStopId] = useState("");

  const routes = useQuery({
    queryKey: ["transport-routes"],
    queryFn: () => routeApi.list({ status: "ACTIVE" }),
  });

  // The rider is an ENROLLMENT, never a student — the M11 rule.
  const enrollment = useQuery({
    queryKey: ["student-enrollment", studentId, sessionId],
    queryFn: () => enrollmentApi.list({ studentId, sessionId, limit: 1 }),
    enabled: Boolean(sessionId),
  });

  const enrollmentId = enrollment.data?.data[0]?.id;
  const route = (routes.data ?? []).find((r) => r.id === routeId);
  const stop = route?.stops.find((s) => s.id === stopId);

  const assign = useMutation({
    mutationFn: () =>
      assignmentApi.create({ enrollmentId: enrollmentId!, routeId, stopId }),
    onSuccess: (result) => {
      toast.success("On the bus.");
      for (const warning of result.warnings) toast.warning(warning);
      onAssigned();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign transport</DialogTitle>
          <DialogDescription>
            The fare comes from the stop, so picking the stop is picking the
            price.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="sp-route">Route</Label>
            <select
              id="sp-route"
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              value={routeId}
              onChange={(event) => {
                setRouteId(event.target.value);
                setStopId("");
              }}
            >
              <option value="">— pick a route —</option>
              {(routes.data ?? []).map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                  {candidate.capacity.capacity === null
                    ? " (no vehicle)"
                    : ` (${candidate.capacity.assigned}/${candidate.capacity.capacity})`}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="sp-stop">Stop</Label>
            <select
              id="sp-stop"
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              value={stopId}
              onChange={(event) => setStopId(event.target.value)}
              disabled={!route}
            >
              <option value="">— pick a stop —</option>
              {(route?.stops ?? []).map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name} — ৳{formatBdt(candidate.monthlyFee)}
                </option>
              ))}
            </select>
            {stop && (
              <p className="text-xs text-muted-foreground">
                Pickup {stop.pickupTime ?? "—"} · drop {stop.dropTime ?? "—"} ·
                ৳{formatBdt(stop.monthlyFee)} a month
              </p>
            )}
          </div>
          {!enrollmentId && (
            <p className="text-xs text-destructive">
              This student has no active enrollment in the selected session —
              enroll them first.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => assign.mutate()}
            disabled={!enrollmentId || !stopId || assign.isPending}
          >
            Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
