"use client";

import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/shared/data-table";
import { JsonDiff } from "@/components/shared/json-diff";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { rbacApi, type AuditLogEntry } from "@/lib/api/rbac";
import { AUDIT_ACTIONS } from "@/lib/constants/enums";
import { useDebounce } from "@/lib/hooks/use-debounce";

const ACTION_BADGE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  CREATE: "default",
  UPDATE: "secondary",
  DELETE: "destructive",
};

const dhaka = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Dhaka" });

/** Audit log viewer (roadmap M03 §5): filters + JSON diff dialog. */
export default function AuditLogsPage() {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [action, setAction] = useState<string>("");
  const [entityType, setEntityType] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [detail, setDetail] = useState<AuditLogEntry | null>(null);

  const debouncedEntityType = useDebounce(entityType, 300);

  const query = useQuery({
    queryKey: [
      "audit-logs",
      { page, limit, action, entityType: debouncedEntityType, dateFrom, dateTo },
    ],
    queryFn: () =>
      rbacApi.listAuditLogs({
        page,
        limit,
        action: action || undefined,
        entityType: debouncedEntityType || undefined,
        dateFrom: dateFrom ? new Date(dateFrom).toISOString() : undefined,
        dateTo: dateTo ? new Date(`${dateTo}T23:59:59`).toISOString() : undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const columns: ColumnDef<AuditLogEntry>[] = [
    {
      accessorKey: "createdAt",
      header: "When",
      cell: ({ row }) => (
        <span className="whitespace-nowrap tabular-nums">
          {dhaka(row.original.createdAt)}
        </span>
      ),
    },
    {
      accessorKey: "action",
      header: "Action",
      cell: ({ row }) => (
        <Badge variant={ACTION_BADGE[row.original.action] ?? "outline"}>
          {row.original.action}
        </Badge>
      ),
    },
    { accessorKey: "entityType", header: "Entity" },
    {
      accessorKey: "entityId",
      header: "Entity ID",
      cell: ({ row }) => (
        <span className="font-mono text-xs">
          {row.original.entityId ?? "—"}
        </span>
      ),
    },
    {
      accessorKey: "userId",
      header: "User",
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.userId ?? "—"}</span>
      ),
    },
    { accessorKey: "ip", header: "IP" },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <Button variant="ghost" size="sm" onClick={() => setDetail(row.original)}>
          Diff
        </Button>
      ),
    },
  ];

  const resetPage = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(1);
  };

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title="Audit Logs"
        description="Immutable trail of every mutation. Filter by action, entity, and date."
      />

      <DataTable
        columns={columns}
        data={query.data?.data ?? []}
        meta={query.data?.meta}
        isLoading={query.isPending}
        error={query.isError ? query.error : undefined}
        onRetry={() => void query.refetch()}
        onPageChange={setPage}
        onLimitChange={resetPage(setLimit)}
        emptyTitle="No audit entries"
        emptyDescription="Mutations will appear here as they happen."
        toolbar={
          <>
            <Select
              value={action || "ALL"}
              onValueChange={(v) => resetPage(setAction)(v === "ALL" ? "" : v)}
            >
              <SelectTrigger className="w-32" aria-label="Action filter">
                <SelectValue placeholder="Action" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All actions</SelectItem>
                {AUDIT_ACTIONS.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={entityType}
              onChange={(e) => resetPage(setEntityType)(e.target.value)}
              placeholder="Entity type (e.g. Role)"
              className="w-48"
              aria-label="Entity type filter"
            />
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => resetPage(setDateFrom)(e.target.value)}
              className="w-40"
              aria-label="From date"
            />
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => resetPage(setDateTo)(e.target.value)}
              className="w-40"
              aria-label="To date"
            />
          </>
        }
      />

      <Dialog open={detail !== null} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {detail?.action} · {detail?.entityType}
            </DialogTitle>
            <DialogDescription>
              {detail ? dhaka(detail.createdAt) : ""}
              {detail?.entityId ? ` · ${detail.entityId}` : ""}
              {detail?.userAgent ? ` · ${detail.userAgent}` : ""}
            </DialogDescription>
          </DialogHeader>
          {detail ? (
            <JsonDiff
              oldValues={detail.oldValues}
              newValues={detail.newValues}
              className="max-h-96 overflow-y-auto"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </main>
  );
}
