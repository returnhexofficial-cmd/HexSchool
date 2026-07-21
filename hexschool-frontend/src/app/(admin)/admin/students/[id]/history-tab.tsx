"use client";

import { useQuery } from "@tanstack/react-query";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { EmptyState } from "@/components/shared/empty-state";
import { StatCard } from "@/components/shared/stat-card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { studentsApi } from "@/lib/api/students";
import { ATTENDANCE_STATUS_LABELS } from "@/lib/validations/attendance";

/**
 * Attendance (live since M12) and results (empty until M15) summaries.
 * The attendance percentage here is over MARKED days — the working-day
 * denominator, per-section split and exports live on the attendance
 * report page.
 */
export function HistoryTab({
  studentId,
  kind,
}: {
  studentId: string;
  kind: "attendance" | "performance";
}) {
  const query = useQuery({
    queryKey: ["students", studentId, kind],
    queryFn: () =>
      kind === "attendance"
        ? studentsApi.attendanceHistory(studentId)
        : studentsApi.performanceHistory(studentId),
  });

  if (query.isPending) return <LoadingBlock />;
  if (query.isError)
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const data = query.data;

  if (!data.available) {
    return (
      <EmptyState
        title={kind === "attendance" ? "No attendance yet" : "No results yet"}
        description={
          ("reason" in data ? data.reason : undefined) ??
          "Data will appear once the relevant module is installed."
        }
      />
    );
  }

  if (kind === "performance") {
    return (
      <pre className="overflow-x-auto rounded-lg border p-4 text-sm">
        {JSON.stringify(data.items, null, 2)}
      </pre>
    );
  }

  const attendance = data as Awaited<
    ReturnType<typeof studentsApi.attendanceHistory>
  >;

  if (attendance.markedDays === 0) {
    return (
      <EmptyState
        title="No attendance yet"
        description="No day has been marked for this student's enrollments."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Attendance" value={`${attendance.percentage}%`} />
        <StatCard title="Marked days" value={String(attendance.markedDays)} />
        <StatCard
          title="Present equivalent"
          value={String(attendance.presentEquivalent)}
        />
        <StatCard
          title="Absent"
          value={String(attendance.counts.ABSENT ?? 0)}
        />
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Remarks</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {attendance.items
              .slice()
              .reverse()
              .slice(0, 60)
              .map((entry) => (
                <TableRow key={`${entry.date}-${entry.sectionId}`}>
                  <TableCell>{entry.date.slice(0, 10)}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {ATTENDANCE_STATUS_LABELS[
                        entry.status as keyof typeof ATTENDANCE_STATUS_LABELS
                      ] ?? entry.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{entry.remarks ?? "—"}</TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>
      {attendance.items.length > 60 ? (
        <p className="text-xs text-muted-foreground">
          Showing the 60 most recent days — the full register is on the
          attendance reports page.
        </p>
      ) : null}
    </div>
  );
}
