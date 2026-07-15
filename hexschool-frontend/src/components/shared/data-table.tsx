"use client";

import { useMemo } from "react";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, Download, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import type { PaginationMeta } from "@/lib/api/axios";
import { exportToCsv } from "@/lib/utils/csv";

const PAGE_SIZES = [10, 20, 50, 100];

export interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  /** Server pagination meta from the API envelope. */
  meta?: PaginationMeta;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;

  /** Server-driven state — parent owns it and refetches on change. */
  onPageChange?: (page: number) => void;
  onLimitChange?: (limit: number) => void;
  /** `field:asc` | `field:desc` | undefined, matching the backend contract. */
  sort?: string;
  onSortChange?: (sort: string | undefined) => void;
  search?: string;
  onSearchChange?: (search: string) => void;
  searchPlaceholder?: string;

  /** Extra filter controls rendered next to search. */
  toolbar?: React.ReactNode;
  /** Enables CSV export of the current rows. */
  exportFileName?: string;
  emptyTitle?: string;
  emptyDescription?: string;
}

/**
 * Server-driven table: pagination, sorting, and search are delegated to the
 * API (`?page&limit&sort&search`); this component only renders state and
 * reports intent. Every list page ships with search/filters/pagination/
 * sorting/export/skeleton/empty/error per the global conventions.
 */
export function DataTable<TData, TValue>({
  columns,
  data,
  meta,
  isLoading = false,
  error,
  onRetry,
  onPageChange,
  onLimitChange,
  sort,
  onSortChange,
  search,
  onSearchChange,
  searchPlaceholder = "Search…",
  toolbar,
  exportFileName,
  emptyTitle = "No records found",
  emptyDescription,
}: DataTableProps<TData, TValue>) {
  // TanStack Table is not React-Compiler-memoizable by design; the
  // server-driven state here never relies on referential stability.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
  });

  const [sortField, sortDir] = useMemo(
    () => (sort ? sort.split(":") : [undefined, undefined]),
    [sort],
  );

  const cycleSort = (columnId: string) => {
    if (!onSortChange) return;
    if (sortField !== columnId) onSortChange(`${columnId}:asc`);
    else if (sortDir === "asc") onSortChange(`${columnId}:desc`);
    else onSortChange(undefined);
  };

  const handleExport = () => {
    if (!exportFileName) return;
    const visible = table
      .getAllLeafColumns()
      .filter((c) => c.getIsVisible() && c.columnDef.header !== undefined);
    const headers = visible.map((c) =>
      typeof c.columnDef.header === "string" ? c.columnDef.header : c.id,
    );
    const rows = table
      .getRowModel()
      .rows.map((row) =>
        visible.map((col) => {
          const v = row.getValue(col.id);
          return v == null ? "" : String(v as string | number);
        }),
      );
    exportToCsv(exportFileName, headers, rows);
  };

  const showEmpty = !isLoading && !error && data.length === 0;
  const colSpan = columns.length;

  return (
    <div className="space-y-3">
      {(onSearchChange || toolbar || exportFileName) && (
        <div className="flex flex-wrap items-center gap-2">
          {onSearchChange ? (
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search ?? ""}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-64 pl-8"
                aria-label="Search"
              />
            </div>
          ) : null}
          {toolbar}
          {exportFileName ? (
            <Button
              variant="outline"
              size="sm"
              className="ml-auto"
              onClick={handleExport}
              disabled={isLoading || data.length === 0}
            >
              <Download className="size-4" />
              Export CSV
            </Button>
          ) : null}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const canSort =
                    onSortChange && header.column.columnDef.enableSorting;
                  return (
                    <TableHead key={header.id}>
                      {canSort ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 hover:text-foreground"
                          onClick={() => cycleSort(header.column.id)}
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                          {sortField === header.column.id ? (
                            sortDir === "asc" ? (
                              <ArrowUp className="size-3.5" />
                            ) : (
                              <ArrowDown className="size-3.5" />
                            )
                          ) : (
                            <ArrowUpDown className="size-3.5 opacity-40" />
                          )}
                        </button>
                      ) : (
                        flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={`skeleton-${i}`}>
                  <TableCell colSpan={colSpan}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : error ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="p-0">
                  <ErrorState
                    error={error}
                    onRetry={onRetry}
                    className="rounded-none border-0"
                  />
                </TableCell>
              </TableRow>
            ) : showEmpty ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="p-0">
                  <EmptyState
                    title={emptyTitle}
                    description={emptyDescription}
                    className="rounded-none border-0"
                  />
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {meta ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>
            {meta.total === 0
              ? "0 records"
              : `${(meta.page - 1) * meta.limit + 1}–${Math.min(
                  meta.page * meta.limit,
                  meta.total,
                )} of ${meta.total}`}
          </span>
          <div className="flex items-center gap-2">
            {onLimitChange ? (
              <Select
                value={String(meta.limit)}
                onValueChange={(v) => onLimitChange(Number(v))}
              >
                <SelectTrigger size="sm" aria-label="Rows per page">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZES.map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size} / page
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              disabled={meta.page <= 1 || isLoading}
              onClick={() => onPageChange?.(meta.page - 1)}
            >
              Previous
            </Button>
            <span className="tabular-nums">
              Page {meta.page} of {meta.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={meta.page >= meta.totalPages || isLoading}
              onClick={() => onPageChange?.(meta.page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
