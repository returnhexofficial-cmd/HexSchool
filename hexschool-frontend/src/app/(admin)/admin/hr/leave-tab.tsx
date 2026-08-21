"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
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
  employeeApi,
  leaveApi,
  leaveTypeApi,
  LEAVE_STATUS_LABELS,
  type LeaveStatus,
  type PersonType,
} from "@/lib/api/hr";
import { LEAVE_STATUS_VARIANT } from "@/lib/validations/hr";
import { useAcademicSession } from "@/lib/hooks/use-academic-session";
import { formatDate } from "@/lib/utils/date";

const ALL = "__all__";

/**
 * The leave inbox — teachers and staff in one list, which is the whole
 * point of M21 replacing M08's teacher-only table.
 *
 * The balance strip under the apply form is deliberately loaded before
 * anything is submitted: approving past somebody's quota is possible, but
 * it needs an override, and the person filing should be able to see that
 * coming rather than discover it in a 409.
 */
export function LeaveTab() {
  const qc = useQueryClient();
  const { selected: session } = useAcademicSession();
  const [status, setStatus] = useState<string>("PENDING");
  const [personType, setPersonType] = useState<string>(ALL);
  const [applying, setApplying] = useState(false);
  const [decision, setDecision] = useState<{
    id: string;
    action: "approve" | "reject" | "cancel";
    name: string;
  } | null>(null);

  const list = useQuery({
    queryKey: ["leave-applications", status, personType],
    queryFn: () =>
      leaveApi.list({
        status: status === ALL ? undefined : (status as LeaveStatus),
        personType: personType === ALL ? undefined : (personType as PersonType),
        limit: 50,
      }),
  });

  const allocate = useMutation({
    mutationFn: () =>
      leaveApi.allocate({ sessionId: session!.id, prorate: true }),
    onSuccess: (result) => {
      toast.success(
        `Allocated: ${result.rowsCreated} new, ${result.rowsUpdated} updated across ${result.employees} employee(s).`,
      );
      void qc.invalidateQueries({ queryKey: ["leave-balances"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-44 space-y-1">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All</SelectItem>
                {(
                  ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const
                ).map((value) => (
                  <SelectItem key={value} value={value}>
                    {LEAVE_STATUS_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-44 space-y-1">
            <Label>Employee type</Label>
            <Select value={personType} onValueChange={setPersonType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Everyone</SelectItem>
                <SelectItem value="TEACHER">Teachers</SelectItem>
                <SelectItem value="STAFF">Staff</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex gap-2">
          <Can permission="leave.balance.manage">
            <Button
              variant="outline"
              disabled={!session || allocate.isPending}
              onClick={() => allocate.mutate()}
            >
              {allocate.isPending ? "Allocating…" : "Allocate yearly quotas"}
            </Button>
          </Can>
          <Can permission="leave.apply">
            <Button onClick={() => setApplying(true)}>File leave</Button>
          </Can>
        </div>
      </div>

      {list.isPending ? (
        <LoadingBlock />
      ) : list.isError ? (
        <ErrorState onRetry={() => void list.refetch()} />
      ) : list.data.rows.length === 0 ? (
        <EmptyState
          title="Nothing here"
          description="No leave applications match these filters."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>From</TableHead>
              <TableHead>To</TableHead>
              <TableHead className="text-right">Days</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Decision</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.data.rows.map(({ application, employee }) => (
              <TableRow key={application.id}>
                <TableCell className="font-medium">
                  {employee?.name ?? "(removed)"}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {application.personType}
                  </span>
                </TableCell>
                <TableCell>
                  {application.leaveType.name}
                  {application.leaveType.isPaid ? null : (
                    <Badge variant="destructive" className="ml-2">
                      Unpaid
                    </Badge>
                  )}
                </TableCell>
                <TableCell>{formatDate(application.fromDate)}</TableCell>
                <TableCell>{formatDate(application.toDate)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {Number(application.days)}
                </TableCell>
                <TableCell className="max-w-56 truncate text-muted-foreground">
                  {application.reason}
                </TableCell>
                <TableCell>
                  <Badge variant={LEAVE_STATUS_VARIANT[application.status]}>
                    {LEAVE_STATUS_LABELS[application.status]}
                  </Badge>
                </TableCell>
                <TableCell className="space-x-1 text-right">
                  <Can permission="leave.approve">
                    {application.status === "PENDING" ? (
                      <>
                        <Button
                          size="sm"
                          onClick={() =>
                            setDecision({
                              id: application.id,
                              action: "approve",
                              name: employee?.name ?? "",
                            })
                          }
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setDecision({
                              id: application.id,
                              action: "reject",
                              name: employee?.name ?? "",
                            })
                          }
                        >
                          Reject
                        </Button>
                      </>
                    ) : application.status === "APPROVED" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setDecision({
                            id: application.id,
                            action: "cancel",
                            name: employee?.name ?? "",
                          })
                        }
                      >
                        Withdraw
                      </Button>
                    ) : null}
                  </Can>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {applying ? <ApplyDialog onClose={() => setApplying(false)} /> : null}
      {decision ? (
        <DecisionDialog
          decision={decision}
          onClose={() => setDecision(null)}
        />
      ) : null}
    </div>
  );
}

function ApplyDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [personType, setPersonType] = useState<PersonType>("TEACHER");
  const [personId, setPersonId] = useState("");
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [halfDay, setHalfDay] = useState(false);
  const [reason, setReason] = useState("");

  const employees = useQuery({
    queryKey: ["hr-employees", personType],
    queryFn: () => employeeApi.list({ personType }),
  });
  const types = useQuery({ queryKey: ["leave-types"], queryFn: leaveTypeApi.list });
  const balances = useQuery({
    queryKey: ["leave-balances", personType, personId],
    queryFn: () => leaveApi.balances(personType, personId),
    enabled: personId !== "",
  });

  const applicable = useMemo(
    () =>
      (types.data ?? []).filter(
        (type) =>
          type.isActive &&
          (type.applicableTo === "ALL" || type.applicableTo === personType),
      ),
    [types.data, personType],
  );

  const create = useMutation({
    mutationFn: () =>
      leaveApi.create({
        personType,
        personId,
        leaveTypeId,
        fromDate,
        toDate: halfDay ? fromDate : toDate,
        halfDay,
        reason,
      }),
    onSuccess: () => {
      toast.success("Leave application filed.");
      void qc.invalidateQueries({ queryKey: ["leave-applications"] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const selectedBalance = balances.data?.find(
    (row) => row.leaveType.id === leaveTypeId,
  );

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>File a leave application</DialogTitle>
          <DialogDescription>
            Days are counted against the working calendar — a leave spanning a
            weekend does not burn quota for days nobody was expected to work.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Employee type</Label>
            <Select
              value={personType}
              onValueChange={(v) => {
                setPersonType(v as PersonType);
                setPersonId("");
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TEACHER">Teacher</SelectItem>
                <SelectItem value="STAFF">Staff</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Employee</Label>
            <Select value={personId} onValueChange={setPersonId}>
              <SelectTrigger>
                <SelectValue placeholder="Pick a person" />
              </SelectTrigger>
              <SelectContent>
                {(employees.data ?? []).map((employee) => (
                  <SelectItem key={employee.personId} value={employee.personId}>
                    {employee.name} ({employee.employeeId})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Leave type</Label>
            <Select value={leaveTypeId} onValueChange={setLeaveTypeId}>
              <SelectTrigger>
                <SelectValue placeholder="Pick a type" />
              </SelectTrigger>
              <SelectContent>
                {applicable.map((type) => (
                  <SelectItem key={type.id} value={type.id}>
                    {type.name}
                    {type.isPaid ? "" : " (unpaid)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedBalance ? (
              <p className="text-xs text-muted-foreground">
                {selectedBalance.available} day(s) available —{" "}
                {selectedBalance.allocated + selectedBalance.carried} allocated,{" "}
                {selectedBalance.used} used.
              </p>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label>From</Label>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>To</Label>
            <Input
              type="date"
              value={halfDay ? fromDate : toDate}
              disabled={halfDay}
              onChange={(e) => setToDate(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2 sm:col-span-2">
            <Checkbox
              id="half-day"
              checked={halfDay}
              onCheckedChange={(v) => setHalfDay(v === true)}
            />
            <Label htmlFor="half-day" className="text-sm font-normal">
              Half day (one date only)
            </Label>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Reason</Label>
            <Textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              !personId ||
              !leaveTypeId ||
              !fromDate ||
              reason.trim().length < 3 ||
              create.isPending
            }
            onClick={() => create.mutate()}
          >
            {create.isPending ? "Filing…" : "File"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DecisionDialog({
  decision,
  onClose,
}: {
  decision: { id: string; action: "approve" | "reject" | "cancel"; name: string };
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [override, setOverride] = useState(false);

  const act = useMutation({
    mutationFn: () =>
      decision.action === "approve"
        ? leaveApi.approve(decision.id, { note, override })
        : decision.action === "reject"
          ? leaveApi.reject(decision.id, note)
          : leaveApi.cancel(decision.id, note),
    onSuccess: () => {
      toast.success("Recorded.");
      void qc.invalidateQueries({ queryKey: ["leave-applications"] });
      void qc.invalidateQueries({ queryKey: ["leave-balances"] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const verb =
    decision.action === "approve"
      ? "Approve"
      : decision.action === "reject"
        ? "Reject"
        : "Withdraw";

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {verb} leave — {decision.name}
          </DialogTitle>
          <DialogDescription>
            {decision.action === "approve"
              ? "Approving consumes the balance and marks those days LEAVE on the attendance register."
              : decision.action === "cancel"
                ? "Withdrawing an approved leave hands the days back to the balance."
                : "A rejected application never consumed any quota."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Note (optional)</Label>
            <Textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          {decision.action === "approve" ? (
            <div className="flex items-center gap-2">
              <Checkbox
                id="override"
                checked={override}
                onCheckedChange={(v) => setOverride(v === true)}
              />
              <Label htmlFor="override" className="text-sm font-normal">
                Allow past the remaining balance (needs
                <code className="mx-1 text-xs">leave.approve.override</code>)
              </Label>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={act.isPending} onClick={() => act.mutate()}>
            {act.isPending ? "Saving…" : verb}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
