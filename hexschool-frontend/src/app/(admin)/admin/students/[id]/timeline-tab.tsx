"use client";

import { useQuery } from "@tanstack/react-query";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { studentsApi } from "@/lib/api/students";

/** Status-change trail (append-only). Audit-log cross-links land with the
 *  portal/reporting work in later modules. */
export function TimelineTab({ studentId }: { studentId: string }) {
  const full = useQuery({
    queryKey: ["students", studentId, "full"],
    queryFn: () => studentsApi.getFull(studentId),
  });

  if (full.isPending) return <LoadingBlock />;
  if (full.isError)
    return <ErrorState error={full.error} onRetry={() => void full.refetch()} />;

  const history = full.data.statusHistory;

  if (history.length === 0) {
    return (
      <p className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
        No status changes recorded yet.
      </p>
    );
  }

  return (
    <div className="max-w-3xl space-y-3">
      {history.map((entry) => (
        <div key={entry.id} className="flex gap-4 rounded-md border p-3">
          <div className="text-sm text-muted-foreground">
            {new Date(entry.createdAt).toLocaleString()}
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm">
              <Badge variant="outline">{entry.fromStatus}</Badge>
              <span>→</span>
              <Badge>{entry.toStatus}</Badge>
            </div>
            {entry.reason ? (
              <p className="text-sm text-muted-foreground">{entry.reason}</p>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
