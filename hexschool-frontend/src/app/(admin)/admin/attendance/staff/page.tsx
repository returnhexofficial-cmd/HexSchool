"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { PageHeader } from "@/components/shared/page-header";
import { Spinner } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  type AttendancePersonType,
  type AttendanceStatus,
  type StaffAttendanceRow,
} from "@/lib/api/attendance";
import {
  ATTENDANCE_STATUS_LABELS,
  MARKABLE_STATUSES,
  dhakaToday,
} from "@/lib/validations/attendance";

const CYCLE: AttendanceStatus[] = ["PRESENT", "ABSENT", "LATE", "LEAVE"];

export default function StaffAttendancePage() {
  const qc = useQueryClient();
  const [date, setDate] = useState(dhakaToday());
  const [personType, setPersonType] = useState<AttendancePersonType | "ALL">(
    "ALL",
  );

  // Unsaved edits only — saved statuses are read from the sheet during
  // render (no effect-driven re-sync; see the student marking page).
  const sheetKey = `${date}:${personType}`;
  const [editedKey, setEditedKey] = useState(sheetKey);
  const [edits, setEdits] = useState<Record<string, AttendanceStatus>>({});
  if (editedKey !== sheetKey) {
    setEditedKey(sheetKey);
    setEdits({});
  }

  const sheet = useQuery({
    queryKey: ["staff-attendance", date, personType],
    queryFn: () =>
      attendanceApi.staffSheet(
        date,
        personType === "ALL" ? undefined : personType,
      ),
    enabled: !!date,
  });

  const rows = useMemo(() => sheet.data?.rows ?? [], [sheet.data]);
  const keyOf = (row: StaffAttendanceRow) =>
    `${row.personType}:${row.personId}`;
  const statusOf = (row: StaffAttendanceRow): AttendanceStatus =>
    edits[keyOf(row)] ?? row.status ?? "PRESENT";

  const tally = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const row of rows) {
      const status =
        edits[`${row.personType}:${row.personId}`] ?? row.status ?? "PRESENT";
      counts[status] = (counts[status] ?? 0) + 1;
    }
    return counts;
  }, [rows, edits]);

  const save = useMutation({
    mutationFn: () =>
      attendanceApi.markStaff({
        date,
        overrideHoliday: sheet.data?.holiday.holiday ?? false,
        entries: rows.map((row) => ({
          personType: row.personType,
          personId: row.personId,
          status: statusOf(row),
        })),
      }),
    onSuccess: (result) => {
      toast.success(`Saved ${result.saved} employee record(s).`);
      void qc.invalidateQueries({ queryKey: ["staff-attendance", date] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const cycle = (row: StaffAttendanceRow) => {
    const index = CYCLE.indexOf(statusOf(row));
    setEdits((prev) => ({
      ...prev,
      [keyOf(row)]: CYCLE[(index + 1) % CYCLE.length],
    }));
  };

  const locked = sheet.data ? !sheet.data.editable : false;

  return (
    <main className="flex-1 space-y-6 p-8 pb-28">
      <PageHeader
        title="Staff attendance"
        description="Teachers and non-teaching staff. Approved teacher leave is marked automatically."
      />

      <div className="flex flex-wrap gap-3">
        <div className="w-44 space-y-1">
          <Label htmlFor="staff-date">Date</Label>
          <Input
            id="staff-date"
            type="date"
            value={date}
            max={dhakaToday()}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="w-52 space-y-1">
          <Label>Employee type</Label>
          <Select
            value={personType}
            onValueChange={(v) => setPersonType(v as AttendancePersonType | "ALL")}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All employees</SelectItem>
              <SelectItem value="TEACHER">Teachers</SelectItem>
              <SelectItem value="STAFF">Staff</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {sheet.isPending ? (
        <div className="flex justify-center py-12">
          <Spinner className="size-6" />
        </div>
      ) : sheet.isError ? (
        <ErrorState onRetry={() => void sheet.refetch()} />
      ) : sheet.data && rows.length > 0 ? (
        <>
          {sheet.data.holiday.holiday ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
              <strong>{sheet.data.holiday.title ?? "Holiday"}</strong> — saving
              needs the holiday-override permission.
            </div>
          ) : null}
          {locked ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
              {sheet.data.lockReason}
            </div>
          ) : null}

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Designation</TableHead>
                  <TableHead className="w-40">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const key = keyOf(row);
                  return (
                    <TableRow key={key}>
                      <TableCell className="font-medium">
                        {row.employeeId}
                      </TableCell>
                      <TableCell>{row.name}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{row.personType}</Badge>
                      </TableCell>
                      <TableCell>{row.designation}</TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={locked}
                          onClick={() => cycle(row)}
                        >
                          {ATTENDANCE_STATUS_LABELS[statusOf(row)]}
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
                {rows.length} employee(s)
              </span>
              {MARKABLE_STATUSES.filter((s) => tally[s]).map((s) => (
                <Badge key={s} variant="secondary">
                  {ATTENDANCE_STATUS_LABELS[s]}: {tally[s]}
                </Badge>
              ))}
              <Can permission="attendance.staff.mark">
                <Button
                  className="ml-auto"
                  disabled={locked || save.isPending}
                  onClick={() => save.mutate()}
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
          title="No employees to mark"
          description="Register teachers or staff first — resigned and terminated employees never appear here."
        />
      )}
    </main>
  );
}
