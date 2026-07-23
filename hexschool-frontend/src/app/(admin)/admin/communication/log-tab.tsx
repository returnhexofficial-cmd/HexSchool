"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";
import { apiErrorMessage } from "@/lib/api/auth";
import {
  communicationApi,
  NotificationChannel,
  NotificationStatus,
  STATUS_TONE,
} from "@/lib/api/communication";
import {
  NOTIFICATION_CHANNEL_LABELS,
  NOTIFICATION_STATUS_LABELS,
} from "@/lib/validations/communication";

const ANY = "ALL";

export function LogTab() {
  const qc = useQueryClient();
  const [channel, setChannel] = useState<string>(ANY);
  const [status, setStatus] = useState<string>(ANY);

  const log = useQuery({
    queryKey: ["comm", "log", channel, status],
    queryFn: () =>
      communicationApi.log({
        channel: channel === ANY ? undefined : (channel as NotificationChannel),
        status: status === ANY ? undefined : (status as NotificationStatus),
        limit: 50,
      }),
  });

  const retry = useMutation({
    mutationFn: (id: string) => communicationApi.retry([id]),
    onSuccess: () => {
      toast.success("Re-queued.");
      void qc.invalidateQueries({ queryKey: ["comm", "log"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Select value={channel} onValueChange={setChannel}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Channel" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All channels</SelectItem>
            <SelectItem value="SMS">SMS</SelectItem>
            <SelectItem value="EMAIL">Email</SelectItem>
            <SelectItem value="IN_APP">In-app</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All statuses</SelectItem>
            {(Object.keys(NOTIFICATION_STATUS_LABELS) as NotificationStatus[]).map(
              (s) => (
                <SelectItem key={s} value={s}>
                  {NOTIFICATION_STATUS_LABELS[s]}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
      </div>

      {log.isLoading ? (
        <LoadingBlock />
      ) : log.isError ? (
        <ErrorState onRetry={() => void log.refetch()} />
      ) : log.data && log.data.rows.length === 0 ? (
        <EmptyState title="No messages" description="Nothing matches these filters." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Channel</TableHead>
              <TableHead>To</TableHead>
              <TableHead>Body</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {log.data?.rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {new Date(r.createdAt).toLocaleString()}
                </TableCell>
                <TableCell>{NOTIFICATION_CHANNEL_LABELS[r.channel]}</TableCell>
                <TableCell className="text-xs">{r.destination ?? "—"}</TableCell>
                <TableCell className="max-w-xs truncate text-muted-foreground">
                  {r.bodyRendered}
                  {r.error && (
                    <span className="block text-xs text-red-600">{r.error}</span>
                  )}
                </TableCell>
                <TableCell className={cn("font-medium", STATUS_TONE[r.status])}>
                  {NOTIFICATION_STATUS_LABELS[r.status]}
                </TableCell>
                <TableCell className="text-right">
                  {r.status === "FAILED" && (
                    <Can permission="notification.send">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => retry.mutate(r.id)}
                      >
                        Retry
                      </Button>
                    </Can>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
