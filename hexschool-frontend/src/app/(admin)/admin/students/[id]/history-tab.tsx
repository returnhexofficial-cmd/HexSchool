"use client";

import { useQuery } from "@tanstack/react-query";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { EmptyState } from "@/components/shared/empty-state";
import { studentsApi } from "@/lib/api/students";

/**
 * Attendance / results summaries. The endpoints return empty gracefully
 * until Modules 12 and 15 land — this tab surfaces that state cleanly.
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

  if (!query.data.available) {
    return (
      <EmptyState
        title={kind === "attendance" ? "No attendance yet" : "No results yet"}
        description={
          query.data.reason ??
          "Data will appear once the relevant module is installed."
        }
      />
    );
  }

  return (
    <pre className="overflow-x-auto rounded-lg border p-4 text-sm">
      {JSON.stringify(query.data.items, null, 2)}
    </pre>
  );
}
