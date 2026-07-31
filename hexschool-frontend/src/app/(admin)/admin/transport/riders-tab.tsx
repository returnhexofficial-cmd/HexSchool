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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiErrorMessage } from "@/lib/api/auth";
import { enrollmentApi } from "@/lib/api/enrollment";
import { structureApi } from "@/lib/api/structure";
import {
  ASSIGNMENT_STATUS_LABELS,
  assignmentApi,
  formatBdt,
  routeApi,
  type Assignment,
  type AssignmentStatus,
  type Route,
} from "@/lib/api/transport";
import { useAcademicSession } from "@/lib/hooks/use-academic-session";

/**
 * Who is on which bus. Three actions live here, and each of them writes a
 * DATE rather than only a status — suspending, resuming and ending are
 * what M16 reads to decide what a family owes for the month.
 */
export function RidersTab() {
  const qc = useQueryClient();
  const { selected } = useAcademicSession();
  const sessionId = selected?.id;
  const [search, setSearch] = useState("");
  const [routeId, setRouteId] = useState("");
  const [status, setStatus] = useState<AssignmentStatus | "">("");
  const [assigning, setAssigning] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [reassigning, setReassigning] = useState(false);
  const [acting, setActing] = useState<{
    assignment: Assignment;
    action: "suspend" | "end";
  } | null>(null);

  const routes = useQuery({
    queryKey: ["transport-routes"],
    queryFn: () => routeApi.list(),
  });

  const list = useQuery({
    queryKey: ["transport-riders", search, routeId, status, sessionId],
    queryFn: () =>
      assignmentApi.list({
        search: search.trim() || undefined,
        routeId: routeId || undefined,
        status: status || undefined,
        sessionId,
        limit: 100,
      }),
  });

  const resume = useMutation({
    mutationFn: (id: string) => assignmentApi.resume(id),
    onSuccess: () => {
      toast.success("Back on the bus — billing resumes from today.");
      void qc.invalidateQueries({ queryKey: ["transport-riders"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const rows = list.data?.rows ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-56 space-y-1">
            <Label htmlFor="rider-search">Student</Label>
            <Input
              id="rider-search"
              placeholder="Name or student ID"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="w-56 space-y-1">
            <Label htmlFor="rider-route">Route</Label>
            <select
              id="rider-route"
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              value={routeId}
              onChange={(event) => setRouteId(event.target.value)}
            >
              <option value="">All routes</option>
              {(routes.data ?? []).map((route) => (
                <option key={route.id} value={route.id}>
                  {route.name}
                </option>
              ))}
            </select>
          </div>
          <div className="w-40 space-y-1">
            <Label htmlFor="rider-status">Status</Label>
            <select
              id="rider-status"
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as AssignmentStatus | "")
              }
            >
              <option value="">All</option>
              <option value="ACTIVE">Riding</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="ENDED">Ended</option>
            </select>
          </div>
        </div>
        <Can permission="transport.assign">
          <div className="space-x-2">
            <Button variant="outline" onClick={() => setReassigning(true)}>
              Move a route
            </Button>
            <Button variant="outline" onClick={() => setBulk(true)}>
              Assign a section
            </Button>
            <Button onClick={() => setAssigning(true)}>Assign a student</Button>
          </div>
        </Can>
      </div>

      {list.isLoading ? (
        <LoadingBlock />
      ) : list.isError ? (
        <ErrorState onRetry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nobody on a bus yet"
          description="Assign a student, or put a whole section on one stop at once."
        />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                <TableHead>Class</TableHead>
                <TableHead>Route</TableHead>
                <TableHead>Stop</TableHead>
                <TableHead>Times</TableHead>
                <TableHead className="text-right">Monthly fare</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-40" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((rider) => (
                <TableRow key={rider.id}>
                  <TableCell className="font-medium">
                    {rider.enrollment.student.firstName}{" "}
                    {rider.enrollment.student.lastName}
                    <span className="block text-xs text-muted-foreground">
                      {rider.enrollment.student.studentUid}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">
                    {rider.enrollment.class.name}
                    {rider.enrollment.section
                      ? ` ${rider.enrollment.section.name}`
                      : ""}{" "}
                    · roll {rider.enrollment.rollNo}
                  </TableCell>
                  <TableCell className="text-sm">{rider.route.name}</TableCell>
                  <TableCell className="text-sm">{rider.stop.name}</TableCell>
                  <TableCell className="text-sm">
                    {rider.stop.pickupTime ?? "—"} / {rider.stop.dropTime ?? "—"}
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    ৳{formatBdt(rider.stop.monthlyFee)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        rider.status === "ACTIVE"
                          ? "default"
                          : rider.status === "SUSPENDED"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {ASSIGNMENT_STATUS_LABELS[rider.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="space-x-1 text-right">
                    <Can permission="transport.assign">
                      {rider.status === "ACTIVE" && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setActing({ assignment: rider, action: "suspend" })
                            }
                          >
                            Suspend
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setActing({ assignment: rider, action: "end" })
                            }
                          >
                            End
                          </Button>
                        </>
                      )}
                      {rider.status === "SUSPENDED" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => resume.mutate(rider.id)}
                        >
                          Resume
                        </Button>
                      )}
                    </Can>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {assigning && (
        <AssignDialog routes={routes.data ?? []} onClose={() => setAssigning(false)} />
      )}
      {bulk && (
        <BulkAssignDialog routes={routes.data ?? []} onClose={() => setBulk(false)} />
      )}
      {reassigning && (
        <ReassignDialog
          routes={routes.data ?? []}
          onClose={() => setReassigning(false)}
        />
      )}
      {acting && (
        <LifecycleDialog
          assignment={acting.assignment}
          action={acting.action}
          onClose={() => setActing(null)}
        />
      )}
    </div>
  );
}

/** Route → stop picker showing the fare (roadmap §5). */
function RouteStopPicker({
  routes,
  routeId,
  stopId,
  onChange,
}: {
  routes: Route[];
  routeId: string;
  stopId: string;
  onChange: (next: { routeId: string; stopId: string }) => void;
}) {
  const route = routes.find((candidate) => candidate.id === routeId);
  const stop = route?.stops.find((candidate) => candidate.id === stopId);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1">
        <Label htmlFor="pick-route">Route</Label>
        <select
          id="pick-route"
          className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
          value={routeId}
          onChange={(event) =>
            onChange({ routeId: event.target.value, stopId: "" })
          }
        >
          <option value="">— pick a route —</option>
          {routes.map((candidate) => (
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
        <Label htmlFor="pick-stop">Stop</Label>
        <select
          id="pick-stop"
          className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
          value={stopId}
          onChange={(event) => onChange({ routeId, stopId: event.target.value })}
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
    </div>
  );
}

function AssignDialog({
  routes,
  onClose,
}: {
  routes: Route[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { selected } = useAcademicSession();
  const sessionId = selected?.id;
  const [pick, setPick] = useState({ routeId: "", stopId: "" });
  const [search, setSearch] = useState("");
  const [enrollmentId, setEnrollmentId] = useState("");

  const candidates = useQuery({
    queryKey: ["transport-assignable", search, sessionId],
    queryFn: () =>
      enrollmentApi.list({
        sessionId,
        search: search.trim() || undefined,
        status: "ACTIVE",
        limit: 25,
      }),
    enabled: Boolean(sessionId),
  });

  const save = useMutation({
    mutationFn: () =>
      assignmentApi.create({
        enrollmentId,
        routeId: pick.routeId,
        stopId: pick.stopId,
      }),
    onSuccess: (result) => {
      toast.success("On the bus.");
      for (const warning of result.warnings) toast.warning(warning);
      void qc.invalidateQueries({ queryKey: ["transport-riders"] });
      void qc.invalidateQueries({ queryKey: ["transport-routes"] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Assign a student</DialogTitle>
          <DialogDescription>
            The fare comes from the stop, so picking the stop is picking the
            price.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="assign-search">Student</Label>
            <Input
              id="assign-search"
              placeholder="Search by name or student ID"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <select
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              value={enrollmentId}
              onChange={(event) => setEnrollmentId(event.target.value)}
            >
              <option value="">— pick a student —</option>
              {(candidates.data?.data ?? []).map((enrollment) => (
                <option key={enrollment.id} value={enrollment.id}>
                  {enrollment.student.firstName} {enrollment.student.lastName} —{" "}
                  {enrollment.class.name} {enrollment.section.name}, roll{" "}
                  {enrollment.rollNo}
                </option>
              ))}
            </select>
          </div>

          <RouteStopPicker
            routes={routes}
            routeId={pick.routeId}
            stopId={pick.stopId}
            onChange={setPick}
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={!enrollmentId || !pick.stopId || save.isPending}
          >
            Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BulkAssignDialog({
  routes,
  onClose,
}: {
  routes: Route[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { selected } = useAcademicSession();
  const sessionId = selected?.id;
  const [pick, setPick] = useState({ routeId: "", stopId: "" });
  const [sectionId, setSectionId] = useState("");

  const sections = useQuery({
    queryKey: ["sections", sessionId],
    queryFn: () =>
      structureApi.sections.list({ sessionId, limit: 100 }),
    enabled: Boolean(sessionId),
  });

  const roster = useQuery({
    queryKey: ["section-roster", sectionId],
    queryFn: () => enrollmentApi.sectionRoster(sectionId),
    enabled: Boolean(sectionId),
  });

  const save = useMutation({
    mutationFn: () =>
      assignmentApi.bulk({
        routeId: pick.routeId,
        stopId: pick.stopId,
        enrollmentIds: (roster.data ?? []).map((row) => row.id),
      }),
    onSuccess: (result) => {
      toast.success(`${result.assigned} student(s) put on the route.`);
      for (const warning of result.warnings) toast.warning(warning);
      for (const skip of result.skipped.slice(0, 5)) {
        toast.info(`Skipped: ${skip.reason}`);
      }
      void qc.invalidateQueries({ queryKey: ["transport-riders"] });
      void qc.invalidateQueries({ queryKey: ["transport-routes"] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const count = roster.data?.length ?? 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Assign a whole section</DialogTitle>
          <DialogDescription>
            Students already on a bus are skipped and listed — nobody gets two
            assignments.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="bulk-section">Section</Label>
            <select
              id="bulk-section"
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              value={sectionId}
              onChange={(event) => setSectionId(event.target.value)}
            >
              <option value="">— pick a section —</option>
              {(sections.data?.data ?? []).map((section) => (
                <option key={section.id} value={section.id}>
                  {section.class?.name ?? ""} {section.name}
                </option>
              ))}
            </select>
            {sectionId && (
              <p className="text-xs text-muted-foreground">
                {count} student(s) in this section.
              </p>
            )}
          </div>

          <RouteStopPicker
            routes={routes}
            routeId={pick.routeId}
            stopId={pick.stopId}
            onChange={setPick}
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={!pick.stopId || count === 0 || save.isPending}
          >
            Assign {count || ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Roadmap §8's route split / merge, fare-preserving. */
function ReassignDialog({
  routes,
  onClose,
}: {
  routes: Route[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [fromRouteId, setFrom] = useState("");
  const [toRouteId, setTo] = useState("");
  const [reason, setReason] = useState("");

  const move = useMutation({
    mutationFn: () =>
      assignmentApi.reassign({ fromRouteId, toRouteId, reason: reason.trim() }),
    onSuccess: (result) => {
      toast.success(`${result.moved} rider(s) moved.`);
      for (const warning of result.warnings) toast.warning(warning);
      for (const row of result.unmatched.slice(0, 5)) toast.info(row.reason);
      void qc.invalidateQueries({ queryKey: ["transport-riders"] });
      void qc.invalidateQueries({ queryKey: ["transport-routes"] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move riders between routes</DialogTitle>
          <DialogDescription>
            Stops are matched by name, so a family keeps paying what they paid.
            A rider whose stop has no counterpart is reported rather than moved
            somewhere cheaper or dearer.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="move-from">From</Label>
            <select
              id="move-from"
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              value={fromRouteId}
              onChange={(event) => setFrom(event.target.value)}
            >
              <option value="">— pick a route —</option>
              {routes.map((route) => (
                <option key={route.id} value={route.id}>
                  {route.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="move-to">To</Label>
            <select
              id="move-to"
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              value={toRouteId}
              onChange={(event) => setTo(event.target.value)}
            >
              <option value="">— pick a route —</option>
              {routes
                .filter((route) => route.id !== fromRouteId)
                .map((route) => (
                  <option key={route.id} value={route.id}>
                    {route.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="move-reason">Reason</Label>
            <Input
              id="move-reason"
              placeholder="Route split for the new bus"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => move.mutate()}
            disabled={
              !fromRouteId || !toRouteId || reason.trim().length < 3 || move.isPending
            }
          >
            Move riders
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LifecycleDialog({
  assignment,
  action,
  onClose,
}: {
  assignment: Assignment;
  action: "suspend" | "end";
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [date, setDate] = useState("");

  const label = action === "suspend" ? "Suspend" : "End";

  const act = useMutation({
    mutationFn: () =>
      action === "suspend"
        ? assignmentApi.suspend(assignment.id, {
            reason: reason.trim(),
            effectiveDate: date || undefined,
          })
        : assignmentApi.end(assignment.id, {
            reason: reason.trim(),
            endDate: date || undefined,
          }),
    onSuccess: () => {
      toast.success(
        action === "suspend"
          ? "Suspended — billing stops on that date."
          : "Ended — the month is billed up to that date and no further.",
      );
      void qc.invalidateQueries({ queryKey: ["transport-riders"] });
      void qc.invalidateQueries({ queryKey: ["transport-routes"] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const student = assignment.enrollment.student;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {label} {student.firstName} {student.lastName}
          </DialogTitle>
          <DialogDescription>
            The date is what the fee engine reads: this month is charged up to
            it, and nothing after.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="life-date">
              {action === "suspend" ? "Suspended from" : "Last day"}
            </Label>
            <Input
              id="life-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Leave blank for today.
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="life-reason">Reason</Label>
            <Input
              id="life-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => act.mutate()}
            disabled={reason.trim().length < 3 || act.isPending}
          >
            {label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
