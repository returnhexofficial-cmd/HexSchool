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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { analyticsApi, type ReportSchedule } from "@/lib/api/analytics";
import { apiErrorMessage } from "@/lib/api/auth";
import { ScheduleDialog } from "./schedule-dialog";

/**
 * The schedule manager (roadmap §5).
 *
 * The column that earns its place is **"why"**: a DISABLED schedule
 * carries the reason the system stopped it — a run that failed three times
 * or an owner whose account has gone. Without it, a schedule that quietly
 * stopped emailing is indistinguishable from one somebody paused, and the
 * school goes on believing the report is arriving.
 */
export function SchedulesTab() {
  const [editing, setEditing] = useState<ReportSchedule | null>(null);
  const [creating, setCreating] = useState(false);
  const queryClient = useQueryClient();

  const q = useQuery({
    queryKey: ["report-schedules"],
    queryFn: () => analyticsApi.schedules({}),
  });

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ["report-schedules"] });

  const toggle = useMutation({
    mutationFn: (schedule: ReportSchedule) =>
      analyticsApi.updateSchedule(schedule.id, {
        status: schedule.status === "ACTIVE" ? "PAUSED" : "ACTIVE",
      }),
    onSuccess: () => {
      toast.success("Schedule updated");
      invalidate();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const testRun = useMutation({
    mutationFn: (id: string) => analyticsApi.testRun(id),
    onSuccess: () => {
      toast.success("Test run queued — see the export centre");
      void queryClient.invalidateQueries({ queryKey: ["report-runs"] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => analyticsApi.deleteSchedule(id),
    onSuccess: () => {
      toast.success("Schedule removed");
      invalidate();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;

  const rows = q.data ?? [];

  return (
    <div className="space-y-4">
      <Can permission="report.schedule.manage">
        <Button onClick={() => setCreating(true)}>Schedule a report</Button>
      </Can>

      {rows.length === 0 ? (
        <EmptyState
          title="Nothing scheduled"
          description="Schedule a report and it will be generated and emailed on its own."
        />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Schedule</TableHead>
                <TableHead>When</TableHead>
                <TableHead>Recipients</TableHead>
                <TableHead>Next run</TableHead>
                <TableHead>Last run</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {s.reportName} · {s.format}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    <div>{s.cronDescription}</div>
                    <code className="text-xs text-muted-foreground">
                      {s.cron}
                    </code>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {recipientSummary(s)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {s.nextRunAt
                      ? new Date(s.nextRunAt).toLocaleString()
                      : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {s.lastRunAt ? new Date(s.lastRunAt).toLocaleString() : "—"}
                    {s.lastStatus === "FAILED" && s.lastError && (
                      <div className="text-xs text-destructive">
                        {s.lastError}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusCell schedule={s} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Can permission="report.schedule.manage">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => testRun.mutate(s.id)}
                          disabled={testRun.isPending}
                        >
                          Test
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditing(s)}
                        >
                          Edit
                        </Button>
                        {s.status !== "DISABLED" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => toggle.mutate(s)}
                            disabled={toggle.isPending}
                          >
                            {s.status === "ACTIVE" ? "Pause" : "Resume"}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => remove.mutate(s.id)}
                          disabled={remove.isPending}
                        >
                          Remove
                        </Button>
                      </div>
                    </Can>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ScheduleDialog
        schedule={editing}
        open={creating || editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false);
            setEditing(null);
          }
        }}
      />
    </div>
  );
}

function StatusCell({ schedule }: { schedule: ReportSchedule }) {
  if (schedule.status === "DISABLED") {
    return (
      <div className="space-y-1">
        <Badge variant="destructive">Switched off</Badge>
        {schedule.disabledReason && (
          <p className="max-w-52 text-xs text-muted-foreground">
            {schedule.disabledReason}
          </p>
        )}
      </div>
    );
  }
  return schedule.status === "ACTIVE" ? (
    <Badge variant="secondary">Active</Badge>
  ) : (
    <Badge variant="outline">Paused</Badge>
  );
}

function recipientSummary(schedule: ReportSchedule): string {
  const emails = schedule.recipients.emails?.length ?? 0;
  const users = schedule.recipients.userIds?.length ?? 0;
  const parts: string[] = [];
  if (emails > 0) parts.push(`${emails} email${emails === 1 ? "" : "s"}`);
  if (users > 0) parts.push(`${users} user${users === 1 ? "" : "s"}`);
  return parts.length > 0 ? parts.join(", ") : "—";
}
