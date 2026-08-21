"use client";

import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/shared/data-table";
import { JsonDiff } from "@/components/shared/json-diff";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { rbacApi, type AuditLogEntry } from "@/lib/api/rbac";
import { formatDateTime } from "@/lib/utils/date";

/** Audit-log slice for one staff record (M03 provides the API). */
export function ActivityTab({ staffId }: { staffId: string }) {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [selected, setSelected] = useState<AuditLogEntry | null>(null);

  const logs = useQuery({
    queryKey: ["audit-logs", { entityType: "StaffProfile", entityId: staffId, page, limit }],
    queryFn: () =>
      rbacApi.listAuditLogs({
        entityType: "StaffProfile",
        entityId: staffId,
        page,
        limit,
      }),
    placeholderData: keepPreviousData,
  });

  const columns: ColumnDef<AuditLogEntry>[] = [
    {
      id: "createdAt",
      header: "When",
      cell: ({ row }) => formatDateTime(row.original.createdAt),
    },
    {
      id: "action",
      header: "Action",
      cell: ({ row }) => <Badge variant="outline">{row.original.action}</Badge>,
    },
    {
      id: "diff",
      header: "",
      cell: ({ row }) =>
        row.original.oldValues || row.original.newValues ? (
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelected(row.original)}
            >
              View changes
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        data={logs.data?.data ?? []}
        meta={logs.data?.meta}
        isLoading={logs.isPending}
        error={logs.isError ? logs.error : undefined}
        onRetry={() => void logs.refetch()}
        onPageChange={setPage}
        onLimitChange={(l) => {
          setLimit(l);
          setPage(1);
        }}
        emptyTitle="No recorded activity"
      />

      <Dialog
        open={selected !== null}
        onOpenChange={(open) => !open && setSelected(null)}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {selected?.action} ·{" "}
              {selected ? formatDateTime(selected.createdAt) : ""}
            </DialogTitle>
          </DialogHeader>
          {selected ? (
            <JsonDiff
              oldValues={selected.oldValues}
              newValues={selected.newValues}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
