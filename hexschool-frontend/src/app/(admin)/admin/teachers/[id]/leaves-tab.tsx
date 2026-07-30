"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
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
import { leaveApi, LEAVE_STATUS_LABELS } from "@/lib/api/hr";
import { LEAVE_STATUS_VARIANT } from "@/lib/validations/hr";

/**
 * One teacher's leave, read from the **unified HR table** (M21) — the
 * M08 teacher-only inbox is gone, and the shared one at `/admin/hr` now
 * covers staff as well. What stays here is the per-person view, because
 * that genuinely is a property of the teacher's record, plus the balance
 * strip nobody could see before M21 tracked one.
 */
export function LeavesTab({ teacherId }: { teacherId: string }) {
  const leaves = useQuery({
    queryKey: ["leave-applications", "TEACHER", teacherId],
    queryFn: () =>
      leaveApi.list({ personType: "TEACHER", personId: teacherId, limit: 50 }),
  });

  const balances = useQuery({
    queryKey: ["leave-balances", "TEACHER", teacherId],
    queryFn: () => leaveApi.balances("TEACHER", teacherId),
  });

  if (leaves.isPending) return <LoadingBlock />;
  if (leaves.isError)
    return <ErrorState onRetry={() => void leaves.refetch()} />;

  return (
    <div className="space-y-4">
      {balances.data && balances.data.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {balances.data.map((row) => (
            <div
              key={row.leaveType.id}
              className="rounded-md border px-3 py-2 text-sm"
            >
              <p className="text-xs text-muted-foreground">
                {row.leaveType.name}
              </p>
              <p className="font-medium tabular-nums">
                {row.available} left
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  of {row.allocated + row.carried}
                </span>
              </p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button variant="outline" size="sm" asChild>
          <Link href="/admin/hr">Open the leave inbox</Link>
        </Button>
      </div>

      {leaves.data.rows.length === 0 ? (
        <EmptyState
          title="No leave on record"
          description="Applications filed for this teacher appear here."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>From</TableHead>
              <TableHead>To</TableHead>
              <TableHead className="text-right">Days</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leaves.data.rows.map(({ application }) => (
              <TableRow key={application.id}>
                <TableCell>{application.leaveType.name}</TableCell>
                <TableCell>{application.fromDate.slice(0, 10)}</TableCell>
                <TableCell>{application.toDate.slice(0, 10)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {Number(application.days)}
                </TableCell>
                <TableCell className="max-w-64 truncate text-muted-foreground">
                  {application.reason}
                </TableCell>
                <TableCell>
                  <Badge variant={LEAVE_STATUS_VARIANT[application.status]}>
                    {LEAVE_STATUS_LABELS[application.status]}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
