"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { analyticsApi, type ReportRun } from "@/lib/api/analytics";
import { apiErrorMessage } from "@/lib/api/auth";
import { formatDateTime } from "@/lib/utils/date";

/**
 * The export centre (roadmap §4's "my exports list").
 *
 * **It polls while anything is in flight, and stops when nothing is.** A
 * queued report finishes in seconds and a fixed interval would either be
 * too slow to feel live or would hammer the API forever on an idle page;
 * keying the interval off the rows themselves gets both.
 */
export function ExportCentreTab() {
  const [mine, setMine] = useState(true);
  const queryClient = useQueryClient();

  const q = useQuery({
    queryKey: ["report-runs", mine],
    queryFn: () => analyticsApi.runs({ mine, limit: 50 }),
    refetchInterval: (query) => {
      const rows = query.state.data?.data ?? [];
      return rows.some((r) => r.status === "QUEUED" || r.status === "RUNNING")
        ? 2000
        : false;
    },
  });

  const download = useMutation({
    mutationFn: (id: string) => analyticsApi.download(id),
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const rerun = useMutation({
    mutationFn: (id: string) => analyticsApi.rerun(id),
    onSuccess: () => {
      toast.success("Queued again");
      void queryClient.invalidateQueries({ queryKey: ["report-runs"] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;

  const rows = q.data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Checkbox
          id="mine-only"
          checked={mine}
          onCheckedChange={(v) => setMine(v === true)}
        />
        <Label htmlFor="mine-only" className="text-sm font-normal">
          Only my exports
        </Label>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No exports yet"
          description="Run a report from the catalog and it will appear here."
        />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Report</TableHead>
                <TableHead>Requested</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Rows</TableHead>
                <TableHead className="text-right">Size</TableHead>
                <TableHead className="text-right">Took</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((run) => (
                <TableRow key={run.id}>
                  <TableCell>
                    <div className="font-medium">{run.reportName}</div>
                    <div className="text-xs text-muted-foreground">
                      {run.format}
                      {run.scheduleId && " · scheduled"}
                    </div>
                    {run.strippedColumns.length > 0 && (
                      // Why the sheet is short. Without this line a
                      // permissions boundary reads as a broken export.
                      <div className="text-xs text-muted-foreground">
                        Withheld: {run.strippedColumns.join(", ")}
                      </div>
                    )}
                    {run.error && (
                      <div className="text-xs text-destructive">{run.error}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDateTime(run.createdAt)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge run={run} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {run.rowCount ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatBytes(run.fileSize)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {run.durationMs === null
                      ? "—"
                      : `${(run.durationMs / 1000).toFixed(1)}s`}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {run.downloadable && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={download.isPending}
                          onClick={() => download.mutate(run.id)}
                        >
                          Download
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={rerun.isPending}
                        onClick={() => rerun.mutate(run.id)}
                      >
                        Re-run
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Files are kept for a limited period and then removed automatically —
        re-run a report whose file has expired.
      </p>
    </div>
  );
}

function StatusBadge({ run }: { run: ReportRun }) {
  if (run.status === "DONE") {
    // A finished run whose file has gone is not the same as a failure, and
    // saying "Done" beside a missing download is how a user concludes the
    // system is broken.
    return run.downloadable ? (
      <Badge variant="secondary">Done</Badge>
    ) : (
      <Badge variant="outline">Expired</Badge>
    );
  }
  if (run.status === "FAILED") return <Badge variant="destructive">Failed</Badge>;
  return <Badge variant="outline">{run.status === "RUNNING" ? "Running" : "Queued"}</Badge>;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
