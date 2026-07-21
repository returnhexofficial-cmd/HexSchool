"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
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
  attendanceApi,
  type AttendanceStatus,
  type AttendanceSheetRow,
} from "@/lib/api/attendance";
import { structureApi } from "@/lib/api/structure";
import { useAcademicSession } from "@/lib/hooks/use-academic-session";
import {
  ATTENDANCE_STATUS_LABELS,
  MARKABLE_STATUSES,
  dhakaToday,
} from "@/lib/validations/attendance";

/** Toggle order when tapping a row: the common corrections, in order. */
const CYCLE: AttendanceStatus[] = ["PRESENT", "ABSENT", "LATE", "HALF_DAY"];

const STATUS_STYLES: Record<string, string> = {
  PRESENT: "bg-emerald-600 text-white hover:bg-emerald-700",
  ABSENT: "bg-destructive text-white hover:bg-destructive/90",
  LATE: "bg-amber-500 text-white hover:bg-amber-600",
  LEAVE: "bg-sky-600 text-white hover:bg-sky-700",
  HALF_DAY: "bg-violet-600 text-white hover:bg-violet-700",
  HOLIDAY: "bg-muted text-muted-foreground",
};

export default function AttendancePage() {
  const { selected: session } = useAcademicSession();
  const sessionId = session?.id ?? "";
  const qc = useQueryClient();

  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [date, setDate] = useState(dhakaToday());
  const [remarksFor, setRemarksFor] = useState<AttendanceSheetRow | null>(null);
  const [holidayOpen, setHolidayOpen] = useState(false);

  // Unsaved edits only. Everything else is derived from the server sheet
  // during render, so switching section/date never needs an effect to
  // re-sync (which React Compiler flags as a cascading render).
  const sheetKey = `${sectionId}:${date}`;
  const [editedKey, setEditedKey] = useState(sheetKey);
  const [statusEdits, setStatusEdits] = useState<
    Record<string, AttendanceStatus>
  >({});
  const [remarkEdits, setRemarkEdits] = useState<Record<string, string>>({});
  if (editedKey !== sheetKey) {
    setEditedKey(sheetKey);
    setStatusEdits({});
    setRemarkEdits({});
  }

  const classes = useQuery({
    queryKey: ["classes", "all"],
    queryFn: () => structureApi.classes.list({ limit: 100 }),
    staleTime: 60_000,
  });

  const sections = useQuery({
    queryKey: ["sections", { sessionId, classId }],
    queryFn: () =>
      structureApi.sections.list({ sessionId, classId, limit: 100 }),
    enabled: !!sessionId && !!classId,
  });

  const sheet = useQuery({
    queryKey: ["attendance-sheet", sectionId, date],
    queryFn: () => attendanceApi.sheet(sectionId, date),
    enabled: !!sectionId && !!date,
  });

  const markable = useMemo(
    () => (sheet.data?.rows ?? []).filter((row) => !row.beforeEnrollment),
    [sheet.data],
  );

  /**
   * A marked day shows its saved statuses; a fresh day defaults to
   * all-present (roadmap: "all-present default, tap to toggle"), except
   * students already on approved leave.
   */
  const statusOf = (row: AttendanceSheetRow): AttendanceStatus =>
    statusEdits[row.enrollmentId] ??
    row.status ??
    (row.onApprovedLeave ? "LEAVE" : "PRESENT");

  const remarkOf = (row: AttendanceSheetRow): string =>
    remarkEdits[row.enrollmentId] ?? row.remarks ?? "";

  const tally = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const row of markable) {
      const status =
        statusEdits[row.enrollmentId] ??
        row.status ??
        (row.onApprovedLeave ? "LEAVE" : "PRESENT");
      counts[status] = (counts[status] ?? 0) + 1;
    }
    return counts;
  }, [markable, statusEdits]);

  const save = useMutation({
    mutationFn: (overrideHoliday: boolean) =>
      attendanceApi.mark({
        sectionId,
        date,
        overrideHoliday,
        entries: markable.map((row) => ({
          enrollmentId: row.enrollmentId,
          status: statusOf(row),
          remarks: remarkOf(row) || undefined,
        })),
      }),
    onSuccess: (result) => {
      const extras = [
        result.skipped.length ? `${result.skipped.length} skipped` : "",
        result.leaveOverrides
          ? `${result.leaveOverrides} switched to Leave (approved leave)`
          : "",
      ].filter(Boolean);
      toast.success(
        `Saved ${result.saved} student(s)${extras.length ? ` — ${extras.join(", ")}` : "."}`,
      );
      void qc.invalidateQueries({
        queryKey: ["attendance-sheet", sectionId, date],
      });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const cycle = (row: AttendanceSheetRow) => {
    const index = CYCLE.indexOf(statusOf(row));
    setStatusEdits((prev) => ({
      ...prev,
      [row.enrollmentId]: CYCLE[(index + 1) % CYCLE.length],
    }));
  };

  const setAll = (status: AttendanceStatus) =>
    setStatusEdits(
      Object.fromEntries(markable.map((row) => [row.enrollmentId, status])),
    );

  const holiday = sheet.data?.holiday;
  const locked = sheet.data ? !sheet.data.editable : false;

  return (
    <main className="flex-1 space-y-6 p-8 pb-28">
      <PageHeader
        title="Attendance"
        description={
          session
            ? `Mark daily attendance for ${session.name}`
            : "Select a session from the header switcher"
        }
      >
        <Can permission="attendance.qr.checkin">
          <Button variant="outline" asChild>
            <Link href="/admin/attendance/scan">QR check-in</Link>
          </Button>
        </Can>
        <Can permission="attendance.view">
          <Button variant="outline" asChild>
            <Link href="/admin/attendance/reports">Reports</Link>
          </Button>
        </Can>
        <Can permission="attendance.holiday.override">
          <Button
            variant="outline"
            disabled={!sectionId}
            onClick={() => setHolidayOpen(true)}
          >
            Convert to holiday
          </Button>
        </Can>
      </PageHeader>

      {!sessionId ? (
        <EmptyState
          title="No session selected"
          description="Pick an academic session from the switcher in the header."
        />
      ) : (
        <div className="flex flex-wrap gap-3">
          <div className="w-52 space-y-1">
            <Label>Class</Label>
            <Select
              value={classId || undefined}
              onValueChange={(v) => {
                setClassId(v);
                setSectionId("");
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a class" />
              </SelectTrigger>
              <SelectContent>
                {(classes.data?.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-52 space-y-1">
            <Label>Section</Label>
            <Select
              value={sectionId || undefined}
              onValueChange={setSectionId}
              disabled={!classId}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a section" />
              </SelectTrigger>
              <SelectContent>
                {(sections.data?.data ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-44 space-y-1">
            <Label htmlFor="attendance-date">Date</Label>
            <Input
              id="attendance-date"
              type="date"
              value={date}
              max={dhakaToday()}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
        </div>
      )}

      {sectionId ? (
        sheet.isPending ? (
          <div className="flex justify-center py-12">
            <Spinner className="size-6" />
          </div>
        ) : sheet.isError ? (
          <ErrorState onRetry={() => void sheet.refetch()} />
        ) : sheet.data && markable.length > 0 ? (
          <>
            {holiday?.holiday ? (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
                <strong>{holiday.title ?? "Holiday"}</strong> — this date is a
                holiday. Saving needs the holiday-override permission.
              </div>
            ) : null}
            {sheet.data.marked ? (
              <div className="rounded-md border border-sky-500/40 bg-sky-500/10 px-4 py-3 text-sm">
                This date is already marked. Saving again updates the existing
                records (needs the attendance-edit permission) and is audited.
              </div>
            ) : null}
            {locked ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
                {sheet.data.lockReason}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Set all:</span>
              {MARKABLE_STATUSES.map((status) => (
                <Button
                  key={status}
                  size="sm"
                  variant="outline"
                  disabled={locked}
                  onClick={() => setAll(status)}
                >
                  {ATTENDANCE_STATUS_LABELS[status]}
                </Button>
              ))}
            </div>

            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Roll</TableHead>
                    <TableHead>UID</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="w-64">Status</TableHead>
                    <TableHead className="w-40">Remarks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {markable.map((row) => {
                    const status = statusOf(row);
                    return (
                      <TableRow key={row.enrollmentId}>
                        <TableCell className="font-medium">
                          {row.rollNo}
                        </TableCell>
                        <TableCell>{row.student.studentUid}</TableCell>
                        <TableCell>
                          {row.student.firstName} {row.student.lastName}
                          {row.onApprovedLeave ? (
                            <Badge variant="secondary" className="ml-2">
                              approved leave
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            <Button
                              size="sm"
                              disabled={locked}
                              className={STATUS_STYLES[status]}
                              onClick={() => cycle(row)}
                            >
                              {ATTENDANCE_STATUS_LABELS[status]}
                            </Button>
                            {status !== "LEAVE" ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={locked}
                                onClick={() =>
                                  setStatusEdits((prev) => ({
                                    ...prev,
                                    [row.enrollmentId]: "LEAVE",
                                  }))
                                }
                              >
                                Leave
                              </Button>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={locked}
                            onClick={() => setRemarksFor(row)}
                          >
                            {remarkOf(row) ? "Edit note" : "Add note"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 p-4 backdrop-blur">
              <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
                <span className="text-sm text-muted-foreground">
                  {markable.length} student(s)
                </span>
                {MARKABLE_STATUSES.filter((s) => tally[s]).map((s) => (
                  <Badge key={s} variant="secondary">
                    {ATTENDANCE_STATUS_LABELS[s]}: {tally[s]}
                  </Badge>
                ))}
                <Can permission="attendance.mark">
                  <Button
                    className="ml-auto"
                    disabled={locked || save.isPending}
                    onClick={() => save.mutate(holiday?.holiday ?? false)}
                  >
                    {save.isPending ? <Spinner className="mr-1 size-4" /> : null}
                    Save attendance
                  </Button>
                </Can>
              </div>
            </div>
          </>
        ) : (
          <EmptyState
            title="No students to mark"
            description="This section has no active enrollments for the selected date."
          />
        )
      ) : null}

      {remarksFor ? (
        <RemarksDialog
          row={remarksFor}
          value={remarkOf(remarksFor)}
          onClose={() => setRemarksFor(null)}
          onSave={(note) => {
            setRemarkEdits((prev) => ({
              ...prev,
              [remarksFor.enrollmentId]: note,
            }));
            setRemarksFor(null);
          }}
        />
      ) : null}

      {holidayOpen ? (
        <ConvertHolidayDialog
          sectionId={sectionId}
          date={date}
          onClose={() => setHolidayOpen(false)}
          onDone={() => {
            setHolidayOpen(false);
            void qc.invalidateQueries({
              queryKey: ["attendance-sheet", sectionId, date],
            });
          }}
        />
      ) : null}
    </main>
  );
}

function RemarksDialog({
  row,
  value,
  onClose,
  onSave,
}: {
  row: AttendanceSheetRow;
  value: string;
  onClose: () => void;
  onSave: (note: string) => void;
}) {
  const [note, setNote] = useState(value);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            Note — {row.student.firstName} {row.student.lastName}
          </DialogTitle>
        </DialogHeader>
        <Input
          value={note}
          maxLength={300}
          placeholder="Reason, e.g. arrived after assembly"
          onChange={(e) => setNote(e.target.value)}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSave(note)}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConvertHolidayDialog({
  sectionId,
  date,
  onClose,
  onDone,
}: {
  sectionId: string;
  date: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [wholeSchool, setWholeSchool] = useState(false);

  const convert = useMutation({
    mutationFn: () =>
      attendanceApi.convertToHoliday({
        date,
        reason,
        sectionId: wholeSchool ? undefined : sectionId,
      }),
    onSuccess: (result) => {
      toast.success(`${result.converted} record(s) converted to holiday.`);
      onDone();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Convert {date} to a holiday</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Every attendance record on this date becomes HOLIDAY, so the day
          stops counting in attendance percentages. The change is audited.
        </p>
        <div className="space-y-1">
          <Label>Reason</Label>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Government holiday announced late"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={wholeSchool}
            onChange={(e) => setWholeSchool(e.target.checked)}
          />
          Apply to the whole school (not just this section)
        </label>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={convert.isPending}
          >
            Cancel
          </Button>
          <Button
            disabled={reason.trim().length < 3 || convert.isPending}
            onClick={() => convert.mutate()}
          >
            {convert.isPending ? <Spinner className="mr-1 size-4" /> : null}
            Convert
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
