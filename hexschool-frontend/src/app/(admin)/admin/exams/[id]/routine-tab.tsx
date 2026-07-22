"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock, Spinner } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiErrorMessage } from "@/lib/api/auth";
import { clashesFromError, examApi } from "@/lib/api/exam";
import { cn } from "@/lib/utils";
import {
  CLASH_KIND_LABELS,
  indexClashes,
  shiftDaySchema,
  splitClashes,
} from "@/lib/validations/exam";

/**
 * The exam routine, grouped by sitting date. Clashes are recomputed on
 * every read rather than trusted from save time — another exam may have
 * booked a room since, and the grid should show that in red without
 * needing a pointless re-save.
 */
export function RoutineTab({ examId }: { examId: string }) {
  const [shiftFrom, setShiftFrom] = useState<string | null>(null);

  const routine = useQuery({
    queryKey: ["exam-routine", examId],
    queryFn: () => examApi.routine(examId),
  });

  if (routine.isPending) return <LoadingBlock />;
  if (routine.isError) {
    return <ErrorState onRetry={() => void routine.refetch()} />;
  }

  const data = routine.data;
  const byPaper = indexClashes(data.clashes);
  const { structural, waivable } = splitClashes(data.clashes);

  return (
    <div className="space-y-4">
      {data.clashes.length > 0 ? (
        <div
          className={cn(
            "rounded-md border p-4 text-sm",
            structural.length > 0
              ? "border-destructive/40 bg-destructive/5"
              : "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950",
          )}
        >
          <p className="font-medium">
            {structural.length > 0
              ? `${structural.length} clash(es) in this routine`
              : `${waivable.length} scheduling warning(s)`}
          </p>
          <ul className="mt-2 list-inside list-disc text-muted-foreground">
            {data.clashes.slice(0, 6).map((clash, i) => (
              <li key={`${clash.kind}-${clash.subjectId}-${i}`}>
                <span className="font-medium">
                  {CLASH_KIND_LABELS[clash.kind]}:
                </span>{" "}
                {clash.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {data.unscheduled.length > 0 ? (
        <div className="rounded-md border p-4 text-sm">
          <p className="font-medium">
            {data.unscheduled.length} paper(s) not yet scheduled
          </p>
          <p className="mt-1 text-muted-foreground">
            {data.unscheduled
              .slice(0, 8)
              .map((u) => `${u.className} — ${u.subjectName}`)
              .join(", ")}
            {data.unscheduled.length > 8 ? " …" : ""}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Set their date and time on the Papers &amp; marks tab. The exam
            cannot be scheduled until every paper has a sitting.
          </p>
        </div>
      ) : null}

      {data.days.length === 0 ? (
        <EmptyState
          title="Nothing scheduled yet"
          description="Give the papers a date, a start time and a duration on the Papers & marks tab."
        />
      ) : (
        data.days.map((day) => (
          <div key={day.date} className="rounded-md border">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2">
              <div className="flex items-center gap-2">
                <span className="font-medium">{day.date}</span>
                {day.holiday ? (
                  <Badge variant="destructive">
                    {day.holidayTitle ?? "Holiday"}
                  </Badge>
                ) : null}
                <span className="text-sm text-muted-foreground">
                  {day.sittings.length} sitting(s)
                </span>
              </div>
              <Can permission="exam.schedule">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShiftFrom(day.date)}
                >
                  Postpone this day
                </Button>
              </Can>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Class</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Room</TableHead>
                  <TableHead>Marks</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {day.sittings.map((sitting) => {
                  const clashes = byPaper.get(sitting.examSubjectId) ?? [];
                  return (
                    <TableRow
                      key={sitting.examSubjectId}
                      className={cn(clashes.length > 0 && "bg-destructive/5")}
                    >
                      <TableCell>{sitting.className}</TableCell>
                      <TableCell className="font-medium">
                        {sitting.subjectName}
                        {clashes.length > 0 ? (
                          <div className="text-xs text-destructive">
                            {clashes[0].message}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {sitting.startTime} – {sitting.endTime}
                        <span className="ml-1 text-xs text-muted-foreground">
                          ({sitting.durationMin}m)
                        </span>
                      </TableCell>
                      <TableCell>{sitting.room ?? "—"}</TableCell>
                      <TableCell>
                        {sitting.fullMarks}
                        <span className="text-xs text-muted-foreground">
                          {" "}
                          (pass {sitting.passMarks})
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ))
      )}

      {shiftFrom ? (
        <ShiftDayDialog
          examId={examId}
          fromDate={shiftFrom}
          onClose={() => setShiftFrom(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * The postponement tool (roadmap §8). A strike or a cyclone moves an
 * exam day often enough in Bangladesh that doing it as 30 individual
 * edits is a real source of mistakes.
 */
function ShiftDayDialog({
  examId,
  fromDate,
  onClose,
}: {
  examId: string;
  fromDate: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [toDate, setToDate] = useState("");
  const [extend, setExtend] = useState(false);
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState("");
  const [clashes, setClashes] = useState<string[]>([]);

  const shift = useMutation({
    mutationFn: () => {
      const parsed = shiftDaySchema.safeParse({ fromDate, toDate });
      if (!parsed.success) {
        return Promise.reject(
          new Error(parsed.error.issues[0]?.message ?? "Invalid input"),
        );
      }
      return examApi.shiftDay(examId, {
        fromDate,
        toDate,
        extendExamWindow: extend,
        override,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
    },
    onSuccess: (result) => {
      toast.success(`${result.moved} sitting(s) moved to ${toDate}.`);
      void qc.invalidateQueries({ queryKey: ["exam-routine", examId] });
      void qc.invalidateQueries({ queryKey: ["exam-subjects", examId] });
      void qc.invalidateQueries({ queryKey: ["exam", examId] });
      onClose();
    },
    onError: (err: Error) => {
      const found = clashesFromError(err);
      const all = [...found.clashes, ...found.waivable];
      setClashes(all.map((c) => c.message));
      if (all.length === 0) toast.error(apiErrorMessage(err) || err.message);
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Postpone {fromDate}</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Every sitting scheduled for {fromDate} moves to the new date in one
          audited operation.
        </p>

        <div className="space-y-1">
          <Label htmlFor="shift-to">New date</Label>
          <Input
            id="shift-to"
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </div>

        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            checked={extend}
            onCheckedChange={(v) => setExtend(v === true)}
          />
          <span>
            Extend the exam window if needed
            <span className="block text-xs text-muted-foreground">
              Required when the new date falls past the exam&apos;s end date.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            checked={override}
            onCheckedChange={(v) => setOverride(v === true)}
          />
          <span>
            Accept a same-day warning
            <span className="block text-xs text-muted-foreground">
              Only waives the &quot;two papers in one day&quot; policy. Room and
              double-booking clashes are always refused.
            </span>
          </span>
        </label>

        <div className="space-y-1">
          <Label htmlFor="shift-reason">Reason</Label>
          <Textarea
            id="shift-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Hartal / weather / board notice"
          />
        </div>

        {clashes.length > 0 ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
            <p className="font-medium text-destructive">
              The move was refused — nothing changed
            </p>
            <ul className="mt-1 list-inside list-disc text-muted-foreground">
              {clashes.slice(0, 5).map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={shift.isPending}>
            Cancel
          </Button>
          <Button
            disabled={!toDate || shift.isPending}
            onClick={() => {
              setClashes([]);
              shift.mutate();
            }}
          >
            {shift.isPending ? <Spinner className="mr-1 size-4" /> : null}
            Move sittings
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
