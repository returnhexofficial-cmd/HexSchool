"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { PageHeader } from "@/components/shared/page-header";
import { Spinner } from "@/components/shared/spinner";
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
import { apiErrorMessage } from "@/lib/api/auth";
import {
  studentLeaveApi,
  type LeaveStatus,
  type StudentLeave,
} from "@/lib/api/attendance";
import { studentsApi } from "@/lib/api/students";
import { useAcademicSession } from "@/lib/hooks/use-academic-session";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { LEAVE_STATUSES, dhakaToday } from "@/lib/validations/attendance";

const STATUS_VARIANT: Record<LeaveStatus, "default" | "secondary" | "outline"> =
  {
    PENDING: "default",
    APPROVED: "secondary",
    REJECTED: "outline",
  };

export default function StudentLeavesPage() {
  const qc = useQueryClient();
  const { selected: session } = useAcademicSession();
  const [status, setStatus] = useState<LeaveStatus | "ALL">("PENDING");
  const [createOpen, setCreateOpen] = useState(false);
  const [decideFor, setDecideFor] = useState<{
    leave: StudentLeave;
    action: "approve" | "reject";
  } | null>(null);

  const leaves = useQuery({
    queryKey: ["student-leaves", { status, sessionId: session?.id }],
    queryFn: () =>
      studentLeaveApi.list({
        limit: 50,
        status: status === "ALL" ? undefined : status,
        sessionId: session?.id,
      }),
  });

  const refresh = () =>
    void qc.invalidateQueries({ queryKey: ["student-leaves"] });

  const decide = useMutation({
    mutationFn: async ({
      leave,
      action,
      note,
    }: {
      leave: StudentLeave;
      action: "approve" | "reject";
      note: string;
    }): Promise<{ correctedDays: number }> => {
      if (action === "reject") {
        await studentLeaveApi.reject(leave.id, note || undefined);
        return { correctedDays: 0 };
      }
      return studentLeaveApi.approve(leave.id, note || undefined);
    },
    onSuccess: ({ correctedDays }) => {
      toast.success(
        correctedDays > 0
          ? `Approved — ${correctedDays} recorded absence(s) corrected to Leave.`
          : "Leave application decided.",
      );
      setDecideFor(null);
      refresh();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title="Student leave"
        description="Approving a leave retro-marks already-recorded absences in the range as Leave."
      >
        <Can permission="student.leave.manage">
          <Button onClick={() => setCreateOpen(true)}>New application</Button>
        </Can>
      </PageHeader>

      <div className="w-52 space-y-1">
        <Label>Status</Label>
        <Select
          value={status}
          onValueChange={(v) => setStatus(v as LeaveStatus | "ALL")}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All</SelectItem>
            {LEAVE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {leaves.isPending ? (
        <div className="flex justify-center py-12">
          <Spinner className="size-6" />
        </div>
      ) : leaves.isError ? (
        <ErrorState onRetry={() => void leaves.refetch()} />
      ) : leaves.data && leaves.data.data.length > 0 ? (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                <TableHead>UID</TableHead>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leaves.data.data.map((leave) => (
                <TableRow key={leave.id}>
                  <TableCell>
                    {leave.student.firstName} {leave.student.lastName}
                  </TableCell>
                  <TableCell>{leave.student.studentUid}</TableCell>
                  <TableCell>{leave.fromDate.slice(0, 10)}</TableCell>
                  <TableCell>{leave.toDate.slice(0, 10)}</TableCell>
                  <TableCell className="max-w-64 truncate">
                    {leave.reason}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[leave.status]}>
                      {leave.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="space-x-2 text-right">
                    {leave.status === "PENDING" ? (
                      <Can permission="student.leave.approve">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setDecideFor({ leave, action: "approve" })
                          }
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() =>
                            setDecideFor({ leave, action: "reject" })
                          }
                        >
                          Reject
                        </Button>
                      </Can>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {leave.decisionNote ?? "—"}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState
          title="No leave applications"
          description="Applications raised here (or from the parent portal later) show up in this inbox."
        />
      )}

      {createOpen ? (
        <CreateLeaveDialog
          sessionId={session?.id}
          onClose={() => setCreateOpen(false)}
          onDone={() => {
            setCreateOpen(false);
            refresh();
          }}
        />
      ) : null}

      {decideFor ? (
        <DecideDialog
          leave={decideFor.leave}
          action={decideFor.action}
          isPending={decide.isPending}
          onClose={() => setDecideFor(null)}
          onConfirm={(note) =>
            decide.mutate({ ...decideFor, note })
          }
        />
      ) : null}
    </main>
  );
}

function CreateLeaveDialog({
  sessionId,
  onClose,
  onDone,
}: {
  sessionId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [search, setSearch] = useState("");
  const debounced = useDebounce(search, 300);
  const [studentId, setStudentId] = useState("");
  const [fromDate, setFromDate] = useState(dhakaToday());
  const [toDate, setToDate] = useState(dhakaToday());
  const [reason, setReason] = useState("");

  const students = useQuery({
    queryKey: ["students", "leave-picker", debounced],
    queryFn: () => studentsApi.list({ search: debounced, limit: 20 }),
    enabled: debounced.length > 1,
  });

  const create = useMutation({
    mutationFn: () =>
      studentLeaveApi.create({
        studentId,
        sessionId,
        fromDate,
        toDate,
        reason,
      }),
    onSuccess: () => {
      toast.success("Leave application created (pending approval).");
      onDone();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const invalidRange = fromDate > toDate;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New leave application</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Student</Label>
            <Input
              placeholder="Search by name or UID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="max-h-40 overflow-y-auto rounded-md border">
              {(students.data?.data ?? []).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`flex w-full items-center justify-between px-2 py-1.5 text-left text-sm hover:bg-muted ${
                    studentId === s.id ? "bg-muted" : ""
                  }`}
                  onClick={() => setStudentId(s.id)}
                >
                  <span>
                    {s.firstName} {s.lastName}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {s.studentUid}
                  </span>
                </button>
              ))}
              {debounced.length > 1 && students.data?.data.length === 0 ? (
                <p className="p-2 text-center text-sm text-muted-foreground">
                  No students match.
                </p>
              ) : null}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
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
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>
          </div>
          {invalidRange ? (
            <p className="text-sm text-destructive">
              The end date cannot be before the start date.
            </p>
          ) : null}
          <div className="space-y-1">
            <Label>Reason</Label>
            <Input
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Fever, family emergency…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button
            disabled={
              !studentId ||
              invalidRange ||
              reason.trim().length < 3 ||
              create.isPending
            }
            onClick={() => create.mutate()}
          >
            {create.isPending ? <Spinner className="mr-1 size-4" /> : null}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DecideDialog({
  leave,
  action,
  isPending,
  onClose,
  onConfirm,
}: {
  leave: StudentLeave;
  action: "approve" | "reject";
  isPending: boolean;
  onClose: () => void;
  onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {action === "approve" ? "Approve" : "Reject"} leave —{" "}
            {leave.student.firstName} {leave.student.lastName}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {leave.fromDate.slice(0, 10)} → {leave.toDate.slice(0, 10)}.{" "}
          {action === "approve"
            ? "Any absence already recorded in this range is corrected to Leave."
            : "Recorded attendance is left untouched."}
        </p>
        <div className="space-y-1">
          <Label>Note (optional)</Label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button disabled={isPending} onClick={() => onConfirm(note)}>
            {isPending ? <Spinner className="mr-1 size-4" /> : null}
            {action === "approve" ? "Approve" : "Reject"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
