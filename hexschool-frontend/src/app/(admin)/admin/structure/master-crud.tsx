"use client";

import { useState } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { FieldValues, UseFormReturn } from "react-hook-form";
import { useForm, type DefaultValues } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ZodType } from "zod";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTable } from "@/components/shared/data-table";
import { FormDialog } from "@/components/shared/form-dialog";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/api/auth";
import type { Paged } from "@/lib/api/structure";
import { useDebounce } from "@/lib/hooks/use-debounce";

export interface MasterCrudConfig<T extends { id: string }, V extends FieldValues> {
  entityLabel: string;
  queryKey: string;
  managePermission: string;
  list: (query: {
    page: number;
    limit: number;
    sort?: string;
    search?: string;
  }) => Promise<Paged<T>>;
  create: (values: V) => Promise<unknown>;
  update: (id: string, values: V) => Promise<unknown>;
  remove: (id: string) => Promise<void>;
  columns: ColumnDef<T>[];
  schema: ZodType<V>;
  defaults: DefaultValues<V>;
  /** Row → form values when opening the edit dialog. */
  toFormValues: (row: T) => DefaultValues<V>;
  /** Form fields rendered inside the dialog. */
  fields: (form: UseFormReturn<V>) => React.ReactNode;
  defaultSort?: string;
  searchPlaceholder?: string;
  deleteHint?: string;
}

/**
 * Generic DataTable + FormDialog CRUD page for the M06 masters
 * (departments/shifts/classes/groups/subjects) — each page is a config,
 * not a re-implementation.
 */
export function MasterCrud<T extends { id: string }, V extends FieldValues>({
  entityLabel,
  queryKey,
  managePermission,
  list,
  create,
  update,
  remove,
  columns,
  schema,
  defaults,
  toFormValues,
  fields,
  defaultSort,
  searchPlaceholder,
  deleteHint,
}: MasterCrudConfig<T, V>) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [sort, setSort] = useState<string | undefined>(defaultSort);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);

  const [editing, setEditing] = useState<T | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<T | null>(null);

  const query = useQuery({
    queryKey: [queryKey, { page, limit, sort, search: debouncedSearch }],
    queryFn: () => list({ page, limit, sort, search: debouncedSearch }),
    placeholderData: keepPreviousData,
  });
  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: [queryKey] });

  const form = useForm<V>({
    resolver: zodResolver(schema as never) as never,
    defaultValues: defaults,
  });

  const openCreate = () => {
    setEditing(null);
    form.reset(defaults);
    setDialogOpen(true);
  };
  const openEdit = (row: T) => {
    setEditing(row);
    form.reset(toFormValues(row));
    setDialogOpen(true);
  };

  const save = useMutation({
    mutationFn: (values: V) =>
      editing ? update(editing.id, values) : create(values),
    onSuccess: () => {
      toast.success(`${entityLabel} ${editing ? "saved" : "created"}`);
      setDialogOpen(false);
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const del = useMutation({
    mutationFn: (id: string) => remove(id),
    onSuccess: () => {
      toast.success(`${entityLabel} deleted`);
      setDeleteTarget(null);
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const allColumns: ColumnDef<T>[] = [
    ...columns,
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <Can permission={managePermission}>
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="sm" onClick={() => openEdit(row.original)}>
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() => setDeleteTarget(row.original)}
            >
              Delete
            </Button>
          </div>
        </Can>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <Can permission={managePermission}>
        <div className="flex justify-end">
          <Button onClick={openCreate}>New {entityLabel.toLowerCase()}</Button>
        </div>
      </Can>

      <DataTable
        columns={allColumns}
        data={query.data?.data ?? []}
        meta={query.data?.meta}
        isLoading={query.isPending}
        error={query.isError ? query.error : undefined}
        onRetry={() => void query.refetch()}
        onPageChange={setPage}
        onLimitChange={(l) => {
          setLimit(l);
          setPage(1);
        }}
        sort={sort}
        onSortChange={setSort}
        search={search}
        onSearchChange={(s) => {
          setSearch(s);
          setPage(1);
        }}
        searchPlaceholder={searchPlaceholder ?? `Search ${entityLabel.toLowerCase()}s…`}
        emptyTitle={`No ${entityLabel.toLowerCase()}s yet`}
      />

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editing ? `Edit ${entityLabel.toLowerCase()}` : `New ${entityLabel.toLowerCase()}`}
        form={form}
        onSubmit={(values) => save.mutate(values)}
        submitLabel={editing ? "Save" : "Create"}
        isPending={save.isPending}
      >
        {fields(form)}
      </FormDialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete this ${entityLabel.toLowerCase()}?`}
        description={
          deleteHint ??
          "Blocked with an explanation while anything still references it."
        }
        confirmLabel="Delete"
        destructive
        isPending={del.isPending}
        onConfirm={() => {
          if (deleteTarget) del.mutate(deleteTarget.id);
        }}
      />
    </div>
  );
}

/** Standard labeled input + error line for master forms. */
export function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-sm text-destructive">{message}</p> : null;
}
